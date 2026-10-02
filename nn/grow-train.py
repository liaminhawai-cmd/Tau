#!/usr/bin/env python3
"""Grow a value net wider WITHOUT losing what it knows, then train it on the WHOLE corpus.

    python nn/grow-train.py                         # best.json -> 640 wide, every data file
    python nn/grow-train.py --width 560 --rounds 4  # smaller grow, shorter run
    python nn/grow-train.py --shardMB 2000          # bigger shards when the trainer is stopped

WHY THIS EXISTS
Every shape change the trainer makes (mint-plan.js: mutate / scratch / skip) starts from random
weights, and a fresh 400x10 rates far under the resumed ones (mutant-060, the champion's exact
shape trained fresh: val mse 0.276 against 0.228, about -155 Elo against 0..+130). The champion's
edge is hundreds of cycles of accumulated training, not its size. And each training run only sees
the newest ~815 MB of JSONL, because parsed rows have to fit in RAM.

So this does the two things the trainer cannot:

  1. GROW. The parent's weights are copied into a wider net. Old units keep their slots and
     weights; each new unit gets fresh incoming weights and ZERO weight into every old unit and
     into the value head, so at birth the grown net computes exactly the parent's value (checked
     before training starts). Training then switches the new units on. Dense-memory packets are
     the first k units of each layer, which stay old units, so the packets are untouched too.

  2. SHARDS. Every data file is visited, a RAM-sized shard at a time, oldest to newest each round.
     Rows are parsed once into compact float32 arrays (cached under nn/grow-cache/, safe to delete)
     -- about 8x smaller than torch-train-core.py's per-row Python lists -- and only one shard is
     ever in memory or on the GPU.

VALIDATION is every data file created after the parent file was last written: games the parent
can never have trained on. Those files are held out of training. The held-out error is scored
after every shard. When a full round of shards brings no new best, the run goes back to its best
weights at half the learning rate; after --lrDrops (4) of those, the next stalled round ends it.
The best-scoring weights are kept.

The weighting mirrors what the trainer's resume runs use (torch-train-core.py): 1/sqrt(game length),
draws at 0.25, retromine families down-weighted by sqrt(family size), and --eloWeight logistic,
all normalised to mean 1 within each shard.

The result is written to nn/models/grow-w<width>-NNN.json and checked with verify-torch-export.js.
A running trainer seats it at D1 at its next roster sync like any new model, and the league and
the promotion gate judge it from there. While training, the best weights so far sit in
nn/models/grow-w<width>-NNN.partial.json (the roster ignores .partial files).

WHY 640: play cost scales with weights (~9*width^2): 640 is 4.7M weights, about 2.3x the 400x10's
compute per evaluation. Model JSON is pushed to GitHub (best.json, medals, pool slots), whose hard
limit is 100 MB a file; this script writes weights at 9 significant digits (exact for float32) to
keep 640 near 60 MB, and refuses to write anything over 95 MB.
"""
import argparse, glob, importlib.util, json, math, os, re, subprocess, sys, time
from array import array
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
_spec = importlib.util.spec_from_file_location('torch_train_core', os.path.join(HERE, 'torch-train-core.py'))
core = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(core)
N = core.N_FEATURES
MAX_FILE_MB = 95.0


def log(msg):
    print(msg, flush=True)


def created_at(path):
    """When this file appeared on this disk. On Windows st_ctime IS creation time (st_birthtime on
    3.12+): a league file created after the parent was written holds no game the parent trained on.
    Elsewhere there is no creation time, and mtime is the closest stand-in."""
    st = os.stat(path)
    born = getattr(st, 'st_birthtime', None)
    if born:
        return born
    return st.st_ctime if os.name == 'nt' else st.st_mtime


# ---------- parsing (same row filter and game-boundary rule as torch-train-core.load_rows) ----------
def parse_file(path, np):
    name = os.path.basename(path)
    feats, zs, movers, gix = array('f'), array('f'), array('b'), array('i')
    games, game_of, game_mv = [], {}, []
    inferred, prev_abs, cur, stale = 0, float('inf'), None, 0
    with open(path, 'r', encoding='utf-8', errors='replace') as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                j = json.loads(line)
            except Exception:
                continue
            f = j.get('f')
            if not f:
                continue
            if len(f) != N:
                stale += 1
                continue
            if j.get('arm') is not None and j.get('bin') is not None:
                continue
            try:
                fa = array('f', f)                 # convert first: a bad value must not half-append
                z = float(j.get('z', 0.0))
            except (TypeError, ValueError):
                continue
            g = j.get('g')
            if g is None:
                a = abs(z)
                if a < prev_abs:
                    inferred += 1
                    cur = f"{name}#{inferred}"
                prev_abs = a
                g = cur
            else:
                prev_abs = float('inf')
            gi = game_of.get(g)
            if gi is None:
                gi = game_of[g] = len(games)
                games.append(str(g))
                game_mv.append(set())
            m = j.get('m')
            feats.extend(fa)
            zs.append(z)
            movers.append(m if m in (0, 1) else -1)
            gix.append(gi)
            mv = j.get('mv')
            if mv is not None:
                game_mv[gi].add(core.mover_name(mv))
    if stale:
        log(f"  warning: {name}: {stale} row(s) with a different feature count skipped")
    return {'X': np.frombuffer(feats, dtype=np.float32).reshape(-1, N).copy(),
            'z': np.frombuffer(zs, dtype=np.float32).copy(),
            'm': np.frombuffer(movers, dtype=np.int8).copy(),
            'g': np.frombuffer(gix, dtype=np.int32).copy(),
            'games': games, 'movers': [sorted(s) for s in game_mv]}


def load_file(path, cache_dir, np):
    """Parsed rows for one data file, from the cache when the file is unchanged since it was cached
    (size + mtime in the key: the live league file grows while it is being written)."""
    if not cache_dir:
        return parse_file(path, np)
    st = os.stat(path)
    base = os.path.basename(path)
    key = f"{base}.{st.st_size}.{int(st.st_mtime)}"
    npz, meta = os.path.join(cache_dir, key + '.npz'), os.path.join(cache_dir, key + '.meta.json')
    if os.path.exists(npz) and os.path.exists(meta):
        try:
            d = np.load(npz)
            with open(meta, 'r', encoding='utf-8') as fh:
                mj = json.load(fh)
            return {'X': d['X'], 'z': d['z'], 'm': d['m'], 'g': d['g'],
                    'games': mj['games'], 'movers': mj['movers']}
        except Exception:
            pass
    rec = parse_file(path, np)
    try:
        for old in os.listdir(cache_dir):
            if old.startswith(base + '.') and not old.startswith(key + '.'):
                os.remove(os.path.join(cache_dir, old))
        tmp = os.path.join(cache_dir, f"tmp-{os.getpid()}.npz")
        np.savez(tmp, X=rec['X'], z=rec['z'], m=rec['m'], g=rec['g'])
        os.replace(tmp, npz)
        with open(meta + '.tmp', 'w', encoding='utf-8') as fh:
            json.dump({'games': rec['games'], 'movers': rec['movers']}, fh)
        os.replace(meta + '.tmp', meta)
    except OSError as e:
        log(f"  (cache write failed for {base}: {e}; continuing uncached)")
    return rec


def assemble(files, cache_dir, np):
    parts = [load_file(p, cache_dir, np) for p in files]
    parts = [p for p in parts if p['X'].shape[0]]
    if not parts:
        return None
    goff, gs, games, movers = 0, [], [], []
    for p in parts:
        gs.append(p['g'] + goff)
        goff += len(p['games'])
        games += p['games']
        movers += p['movers']
    return {'X': np.concatenate([p['X'] for p in parts]), 'z': np.concatenate([p['z'] for p in parts]),
            'm': np.concatenate([p['m'] for p in parts]), 'g': np.concatenate(gs),
            'games': games, 'movers': movers}


def row_weights(sh, args, lookup, np):
    """torch-train-core.split_and_weight's training weights, for one whole shard."""
    g, z, G = sh['g'], sh['z'], len(sh['games'])
    counts = np.maximum(np.bincount(g, minlength=G), 1).astype(np.float64)
    base = (1.0 / np.sqrt(counts) if args.gameWeight == 'sqrt' else
            1.0 / counts if args.gameWeight == 'game' else np.ones(G))
    if lookup:
        gm = {i: set(mv) for i, mv in enumerate(sh['movers']) if mv}
        out, ref, _rated = core.elo_game_weights(gm, lookup, args.eloWeightFloor, args.eloWeightTemp)
        if ref is not None:
            # the trainer reads these with game_w.get(gid, 1.0): a game with no rated mover gets 1.0
            base = base * np.array([out[i] if i in out else 1.0 for i in range(G)])
    w = base[g] * np.where(z == 0.0, args.drawWeight, 1.0)
    if args.familyWeight != 'off':
        _, first = np.unique(g, return_index=True)
        keys = []
        for gi, ri in zip(range(G), first):
            zf, mf = float(z[ri]), int(sh['m'][ri])
            outcome = 'draw' if zf == 0.0 else (mf if zf > 0 else (1 - mf if mf in (0, 1) else 'unknown'))
            keys.append((re.sub(r'-[0-9]+$', '', sh['games'][gi]), outcome))
        size = defaultdict(int)
        for k in keys:
            size[k] += 1
        w = w / np.sqrt(np.array([size[k] for k in keys], dtype=np.float64))[g]
    w = w / max(1e-12, float(w.mean()))
    return w.astype(np.float32)


# ---------- models ----------
_topo_spec = importlib.util.spec_from_file_location('value_topology', os.path.join(HERE, 'value-topology.py'))
value_topology = importlib.util.module_from_spec(_topo_spec)
_topo_spec.loader.exec_module(value_topology)
fan_ins_for = value_topology.fan_ins_for
build_model = value_topology.build_model


def parent_linears(torch, nn, parent):
    sizes, topology = parent['sizes'], parent.get('topology')
    fi = parent.get('fanIns') or fan_ins_for(sizes, topology)
    out = []
    with torch.no_grad():
        for li in range(len(sizes) - 1):
            lin = nn.Linear(fi[li], sizes[li + 1])
            lin.weight.copy_(torch.tensor(parent['W'][li], dtype=torch.float32).reshape(sizes[li + 1], fi[li]))
            lin.bias.copy_(torch.tensor(parent['b'][li], dtype=torch.float32))
            out.append(lin)
    return out


def grow_linears(torch, nn, parent, width):
    """Wider copy of the parent. For every layer: old output rows keep their weights (with zeros
    from the new input units), new output rows keep PyTorch's default init over all inputs. The
    input columns move with the layer in front: its old units keep their slots, its new units come
    next, and the memory packets shift right by however much that layer grew."""
    sizes_old, topology = parent['sizes'], parent.get('topology')
    hid_old = sizes_old[1:-1]
    if any(width < h for h in hid_old):
        raise SystemExit(f"--width {width} is narrower than the parent's widest layer ({max(hid_old)}); this only grows")
    sizes_new = [sizes_old[0]] + [width] * len(hid_old) + [1]
    fi_old = parent.get('fanIns') or fan_ins_for(sizes_old, topology)
    if fi_old != fan_ins_for(sizes_old, topology):
        raise SystemExit(f"parent fanIns {fi_old} are not the layout this script knows how to grow")
    fi_new = fan_ins_for(sizes_new, topology)
    out = []
    with torch.no_grad():
        for li in range(len(sizes_old) - 1):
            out_old, out_new = sizes_old[li + 1], sizes_new[li + 1]
            lin = nn.Linear(fi_new[li], out_new)
            w_old = torch.tensor(parent['W'][li], dtype=torch.float32).reshape(out_old, fi_old[li])
            if li == 0:
                cols = list(range(fi_old[0]))
            else:
                prev_old, prev_new = sizes_old[li], sizes_new[li]
                cols = [c if c < prev_old else c - prev_old + prev_new for c in range(fi_old[li])]
            lin.weight[:out_old, :] = 0.0
            lin.weight[:out_old, cols] = w_old
            lin.bias[:out_old] = torch.tensor(parent['b'][li], dtype=torch.float32)
            out.append(lin)
    return out, sizes_new


def evaluate(torch, model, xva, yva, batch=16384):
    model.eval()
    se, hit, dec = 0.0, 0, 0
    with torch.no_grad():
        for i in range(0, xva.shape[0], batch):
            p, y = model(xva[i:i + batch]), yva[i:i + batch]
            se += float(((p - y) ** 2).sum())
            d = y != 0
            hit += int((torch.sign(p[d]) == torch.sign(y[d])).sum())
            dec += int(d.sum())
    return se / max(1, xva.shape[0]), (hit / dec if dec else 0.0)


def write_model(doc, path):
    """Weights at 9 significant digits -- enough to reproduce every float32 exactly -- instead of
    Python's 17-digit repr, so a 4.7M-weight net is ~60 MB instead of ~100 MB."""
    doc = dict(doc)
    doc['W'] = [[float('%.9g' % v) for v in layer] for layer in doc['W']]
    doc['b'] = [[float('%.9g' % v) for v in layer] for layer in doc['b']]
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, 'w') as fh:
        json.dump(doc, fh, separators=(',', ':'))
    mb = os.path.getsize(tmp) / (1 << 20)
    if mb > MAX_FILE_MB:
        os.remove(tmp)
        raise SystemExit(f"model JSON would be {mb:.0f} MB, over the {MAX_FILE_MB:.0f} MB safety limit "
                         f"(GitHub refuses files over 100 MB and the trainer pushes model JSON); use a smaller --width")
    os.replace(tmp, path)
    return mb


def main():
    ap = argparse.ArgumentParser(description='grow a value net wider and train it on every data file')
    ap.add_argument('--from', dest='parent', default=os.path.join(HERE, 'models', 'best.json'))
    ap.add_argument('--deepStyle', choices=['plain', 'residual', 'bridges', 'wispy'])
    ap.add_argument('--depth', type=int, default=22)
    ap.add_argument('--distillPasses', type=int, default=1)
    ap.add_argument('--fileList', help='frozen corpus manifest for an experiment suite')
    ap.add_argument('--width', type=int, default=640, help='new width of every hidden layer')
    ap.add_argument('--data', default=os.path.join(HERE, 'data', '*.jsonl'))
    ap.add_argument('--maxDataMB', type=float, default=0.0, help='only the newest N MB of data (0 = all)')
    ap.add_argument('--shardMB', type=float, default=0.0,
                    help='raw JSONL per shard; 0 = the trainer\'s own budget (RAM/20), safe alongside it')
    ap.add_argument('--valMaxMB', type=float, default=300.0)
    ap.add_argument('--valMinRows', type=int, default=30000)
    ap.add_argument('--rounds', type=int, default=30, help='safety cap on passes over all the data')
    ap.add_argument('--lrDrops', type=int, default=4,
                    help='times a stalled run goes back to its best weights at half the learning rate before it stops')
    ap.add_argument('--epochsPerShard', type=int, default=1)
    ap.add_argument('--patience', type=int, default=0,
                    help='shard visits without a better held-out score before a learning-rate drop (0 = one full round)')
    ap.add_argument('--batch', type=int, default=4096)
    ap.add_argument('--lr', type=float, default=1e-3)
    ap.add_argument('--wd', type=float, default=1e-4)
    ap.add_argument('--seed', type=int, default=12345)
    ap.add_argument('--gameWeight', default='sqrt', choices=['sqrt', 'game', 'row'])
    ap.add_argument('--drawWeight', type=float, default=0.25)
    ap.add_argument('--familyWeight', default='sqrt', choices=['sqrt', 'off'])
    ap.add_argument('--eloWeight', default='logistic', choices=['off', 'logistic'])
    ap.add_argument('--eloWeightFloor', type=float, default=0.15)
    ap.add_argument('--eloWeightTemp', type=float, default=150.0)
    ap.add_argument('--cache', default=os.path.join(HERE, 'grow-cache'))
    ap.add_argument('--noCache', action='store_true')
    ap.add_argument('--out', default=None, help='default nn/models/grow-w<width>-NNN.json')
    ap.add_argument('--device', default=None)
    args = ap.parse_args()

    try:
        import numpy as np
        import torch
        import torch.nn as nn
    except ImportError as e:
        log(f"needs numpy and PyTorch ({e})")
        sys.exit(1)
    torch.manual_seed(args.seed)
    device = torch.device(args.device) if args.device else torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    log(f"device: {device}" + (f" ({torch.cuda.get_device_name(0)})" if device.type == 'cuda' else ''))

    with open(args.parent, 'r', encoding='utf-8') as fh:
        parent = json.load(fh)
    topology = parent.get('topology') or None
    if topology and topology.get('kind') != 'dense-memory-v1':
        raise SystemExit(f"unknown topology {topology.get('kind')}")
    parent_name = os.path.basename(args.parent)
    old_weights = sum(len(w) for w in parent['W'])

    # ---- data: held-out = files created after the parent was written; the rest, in shards ----
    if args.fileList:
        with open(args.fileList, encoding='utf-8') as fh:
            corpus = json.load(fh)
    else:
        corpus = glob.glob(args.data)
    files = sorted(corpus, key=lambda p: (core.file_stamp(p), os.path.basename(p)))
    if not files:
        raise SystemExit(f"no data files match {args.data}")
    if args.maxDataMB > 0:
        keep, tot = [], 0
        for p in reversed(files):
            if keep and tot + os.path.getsize(p) > args.maxDataMB * (1 << 20):
                break
            keep.append(p); tot += os.path.getsize(p)
        files = sorted(keep, key=lambda p: (core.file_stamp(p), os.path.basename(p)))
    parent_written = os.path.getmtime(args.parent)
    newest_first = sorted(files, key=lambda p: created_at(p), reverse=True)
    val_files, val_bytes, val_rule = [], 0, 'created after the parent was written'
    for p in newest_first:
        if created_at(p) <= parent_written or val_bytes >= args.valMaxMB * (1 << 20):
            break
        val_files.append(p); val_bytes += os.path.getsize(p)
    cache_dir = None if args.noCache else args.cache
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
    val = assemble(val_files, cache_dir, np) if val_files else None
    if val is None or val['X'].shape[0] < args.valMinRows:
        val_rule = 'NEWEST FILES (too few created after the parent -- it may have trained on some of these)'
        for p in newest_first[len(val_files):]:
            if val is not None and val['X'].shape[0] >= args.valMinRows:
                break
            val_files.append(p)
            val = assemble(val_files, cache_dir, np)
    vset = set(val_files)
    train_files = [p for p in files if p not in vset]
    shard_mb = args.shardMB if args.shardMB > 0 else min(2048.0, max(256.0, core.total_ram_bytes() / (1 << 20) / 20.0))
    shards, cur, cur_b = [], [], 0
    for p in train_files:
        sz = os.path.getsize(p)
        if cur and cur_b + sz > shard_mb * (1 << 20):
            shards.append(cur); cur, cur_b = [], 0
        cur.append(p); cur_b += sz
    if cur:
        shards.append(cur)
    if not shards:
        raise SystemExit('no training files left after holding out the validation set')
    train_mb = sum(os.path.getsize(p) for p in train_files) / (1 << 20)
    log(f"data: {len(train_files)} training files ({train_mb:.0f} MB) in {len(shards)} shard(s) of <= {shard_mb:.0f} MB; "
        f"held out {len(val_files)} file(s), {val['X'].shape[0]} positions -- {val_rule}")

    lookup = {}
    if args.eloWeight != 'off':
        lookup = {**core.retired_elo_lookup(os.path.join(HERE, 'models', '.evolution-roster.json')),
                  **core.elo_lookup(core.tau_paths.elo_summary_path(HERE))}
        if not lookup:
            log('eloWeight: no rated players found; weighting off')

    xva = torch.from_numpy(val['X']).to(device)
    yva = torch.from_numpy(val['z']).view(-1, 1).to(device)
    del val

    # ---- grow, and prove the grown net still IS the parent ----
    p_lin = parent_linears(torch, nn, parent)
    p_model = build_model(torch, nn, p_lin, topology, device)
    if args.deepStyle:
        spec = importlib.util.spec_from_file_location('deep_architectures', os.path.join(HERE, 'deep-architectures.py'))
        architecture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(architecture)
        linears, sizes, topology = architecture.make(torch, nn, sys.modules[__name__], parent, args.width, args.depth, args.deepStyle)
    else:
        linears, sizes = grow_linears(torch, nn, parent, args.width)
    model = build_model(torch, nn, linears, topology, device)
    with torch.no_grad():
        k = min(4096, xva.shape[0])
        drift = float((p_model(xva[:k]) - model(xva[:k])).abs().max())
    base_val, base_acc = evaluate(torch, p_model, xva, yva)
    if args.deepStyle == 'plain':
        if args.distillPasses < 1:
            raise SystemExit('plain deep requires at least one distillation pass')
        p_model.eval()
        for parameter in p_model.parameters():
            parameter.requires_grad_(False)
        distill_opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)
        for distill_pass in range(args.distillPasses):
            for si, shard in enumerate(shards, 1):
                sh = assemble(shard, cache_dir, np)
                if sh is None:
                    continue
                x = torch.from_numpy(sh['X'])  # keep the corpus on CPU; batch transfers only
                del sh
                total = 0.0
                model.train()
                for idx in torch.randperm(len(x)).split(args.batch):
                    xb = x[idx].to(device)
                    with torch.no_grad():
                        target = p_model(xb)
                    distill_opt.zero_grad()
                    loss = ((model(xb) - target) ** 2).mean()
                    if not torch.isfinite(loss):
                        raise SystemExit('nonfinite distillation loss; nothing admitted')
                    loss.backward(); distill_opt.step()
                    total += loss.item() * len(idx)
                log(f'distill {distill_pass+1}/{args.distillPasses} shard {si}/{len(shards)}: parent imitation mse {total/len(x):.6f}')
                del x
        vmse, _ = evaluate(torch, model, xva, yva)
        log(f'plain depth after distillation: held-out mse {vmse:.5f} (parent {base_val:.5f}); exact inheritance is not claimed')
        del distill_opt
    del p_model, p_lin
    new_weights = sum(l.weight.numel() + l.bias.numel() for l in linears)
    log(f"grew {parent_name} {parent['sizes'][1:-1]} -> {sizes[1:-1]}: {old_weights:,} -> {new_weights:,} weights "
        f"({new_weights / old_weights:.1f}x the compute per evaluation)")
    log(f"at birth: max |grown - parent| = {drift:.2e} on {k} held-out positions; parent held-out mse {base_val:.5f}, "
        f"sign-acc {base_acc * 100:.1f}%")
    if not math.isfinite(drift):
        raise SystemExit('nonfinite birth predictions')
    if drift > 1e-4 and args.deepStyle != 'plain':
        raise SystemExit('the grown net does not reproduce its parent -- refusing to train it')
    del parent

    models_dir = os.path.join(HERE, 'models')
    if args.out:
        out = args.out
    else:
        prefix = f'deep-{args.deepStyle}-w{args.width}-l{args.depth}' if args.deepStyle else f'grow-w{args.width}'
        taken = [int(m.group(1)) for f in os.listdir(models_dir)
                 for m in [re.match(rf'{prefix}-(\d+)(?:\.partial)?\.json$', f)] if m]
        out = os.path.join(models_dir, f"{prefix}-{max(taken, default=0) + 1:03d}.json")
    partial = out[:-5] + '.partial.json' if out.endswith('.json') else out + '.partial'
    name = os.path.basename(out)[:-5]

    # ---- train: rounds over the shards, oldest to newest, held-out score after every shard ----
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)
    patience = args.patience if args.patience > 0 else max(2, len(shards))
    best_val, best_state, best_at, since, visits, passes = float('inf'), None, None, 0, 0, 0.0
    t0 = time.time()

    def export(state, tag):
        model.load_state_dict(state)
        model.eval()
        with torch.no_grad():
            probe_x = [xva[i].tolist() for i in range(min(8, xva.shape[0]))]
            def probe_fn(x):
                return float(model(torch.tensor([x], dtype=torch.float32, device=device))[0][0])
            doc = core.export_for_netjs(linears, probe_x, probe_fn, topology)
        doc['grownFrom'] = {'parent': parent_name, 'parentWeights': old_weights, 'width': args.width,
                            'parentHeldOutMse': round(base_val, 6), 'heldOutMse': round(best_val, 6),
                            'bestAt': best_at, 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        if args.deepStyle:
            doc['deepExperiment'] = {'style': args.deepStyle, 'depth': args.depth, 'seed': args.seed,
                                     'distillPasses': args.distillPasses if args.deepStyle == 'plain' else 0,
                                     'birthDrift': drift, 'validationRule': val_rule}
        if parent_epochs is not None:
            doc['trainedEpochs'] = int(parent_epochs + round(passes))   # last key: live-ladder reads the tail
        mb = write_model(doc, tag)
        return mb

    parent_epochs = None
    try:
        with open(args.parent, 'rb') as fh:
            fh.seek(max(0, os.path.getsize(args.parent) - 8192))
            m = re.findall(rb'"trainedEpochs"\s*:\s*(\d+)', fh.read())
            parent_epochs = int(m[-1]) if m else None
    except OSError:
        pass

    if args.deepStyle:
        best_val, _ = evaluate(torch, model, xva, yva)
        best_at = 'distilled start' if args.deepStyle == 'plain' else 'inherited start'
        best_state = {key: value.detach().clone() for key, value in model.state_dict().items()}
        export(best_state, partial)

    # Train until the held-out score stops improving. A full round of shards with no new best means
    # the current rate is overshooting: go back to the best weights at half the rate and keep going.
    # After --lrDrops of those, a further stalled round ends the run -- "trained until it regresses".
    stop, lr, drops = False, args.lr, 0
    try:
        for rnd in range(1, args.rounds + 1):
            for si, shard in enumerate(shards, 1):
                for g in opt.param_groups:
                    g['lr'] = lr
                ts = time.time()
                sh = assemble(shard, cache_dir, np)
                if sh is None:
                    continue
                w = row_weights(sh, args, lookup, np)
                tensor_device = 'cpu' if args.deepStyle else device
                xtr = torch.from_numpy(sh['X']).to(tensor_device)
                ytr = torch.from_numpy(sh['z']).view(-1, 1).to(tensor_device)
                wtr = torch.from_numpy(w).view(-1, 1).to(tensor_device)
                n = xtr.shape[0]
                del sh, w
                tot = 0.0
                model.train()
                for _ in range(args.epochsPerShard):
                    perm = torch.randperm(n, device=tensor_device)
                    for i in range(0, n, args.batch):
                        idx = perm[i:i + args.batch]
                        opt.zero_grad()
                        loss = (wtr[idx].to(device) * (model(xtr[idx].to(device)) - ytr[idx].to(device)) ** 2).mean()
                        if not torch.isfinite(loss):
                            raise SystemExit('nonfinite training loss; best partial retained, nothing admitted')
                        loss.backward()
                        opt.step()
                        tot += loss.detach().item() * len(idx)
                del xtr, ytr, wtr, perm
                if device.type == 'cuda':
                    torch.cuda.empty_cache()
                passes += args.epochsPerShard / len(shards)
                visits += 1
                vmse, acc = evaluate(torch, model, xva, yva)
                flag = ''
                if vmse < best_val:
                    best_val, best_at, since, flag = vmse, f"round {rnd} shard {si}", 0, '  * best'
                    best_state = {k2: v.detach().clone() for k2, v in model.state_dict().items()}
                    mb = export(best_state, partial)
                    model.train()
                    flag += f" (saved, {mb:.0f} MB)"
                else:
                    since += 1
                log(f"round {rnd}/{args.rounds} shard {si}/{len(shards)}: {n} positions, train mse "
                    f"{tot / max(1, n * args.epochsPerShard):.5f}, held-out mse {vmse:.5f} (parent {base_val:.5f}), "
                    f"sign-acc {acc * 100:.1f}%, lr {lr:.6f}, {time.time() - ts:.0f}s{flag}")
                if since >= patience:
                    if drops >= args.lrDrops:
                        log(f"stopping: no better held-out score in {since} shard visit(s) after {drops} rate drop(s) "
                            f"({(time.time() - t0) / 60:.0f} min, {passes:.1f} passes over the data)")
                        stop = True
                        break
                    drops, since, lr = drops + 1, 0, lr / 2
                    model.load_state_dict(best_state)
                    opt.state.clear()
                    model.train()
                    log(f"no better held-out score in a full round: back to the best weights ({best_at}), "
                        f"learning rate halved to {lr:.6f} (drop {drops}/{args.lrDrops})")
            if stop:
                break
    except KeyboardInterrupt:
        log('\ninterrupted -- finishing with the best weights so far')

    if best_state is None:
        raise SystemExit('no training finished; nothing written')
    verdict = ('BETTER than' if best_val < base_val else 'NOT better than')
    log(f"\nbest held-out mse {best_val:.5f} at {best_at}: {verdict} the parent's {base_val:.5f}")
    r = subprocess.run(['node', os.path.join(HERE, 'verify-torch-export.js'), partial])
    if r.returncode != 0:
        raise SystemExit(f"verify-torch-export.js rejected {partial}; left it there, NOT in the pool")
    os.replace(partial, out)
    log(f"\n{name} is in nn/models. A running trainer seats it at D1 at its next roster sync; "
        f"the league rates it and the promotion gate judges it like any other model.")


if __name__ == '__main__':
    main()

