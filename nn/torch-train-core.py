#!/usr/bin/env python3
"""Train a value net in PyTorch on Tau's existing self-play data, export it for net.js.

WHY THIS EXISTS
net.js is a hand-written tanh MLP with Adam, which is fine but pins you to one optimizer, one
init, one regularizer and one schedule. The training corpus is already plain JSONL with a fixed
94-number feature vector per row, so nothing has to be exported to train elsewhere -- this reads
nn/data/*.jsonl directly. What it writes is a net.js-format JSON that drops straight into every
existing tool: arena.js, elorank.js, the ladder sweep, the rating pool, nnai.js's search.

    python3 nn/torch-train.py --epochs 40 --hidden 96,96 --out nn/models/torch-v1.json
    node nn/verify-torch-export.js nn/models/torch-v1.json     # ALWAYS run this
    node nn/arena.js --a nn:0:nn/models/torch-v1.json --b L11 --games 60 --depth 2

THE TWO THINGS THAT SILENTLY GO WRONG

1. WEIGHT LAYOUT. net.js's forward is `s += W[j*nIn + i]*a[i]` over j=out, i=in -- a flat
   output-major array, which is exactly torch's nn.Linear.weight [out_features, in_features].
   So .flatten() transfers with NO transpose. Get this backwards and the net still loads, still
   runs, and just plays badly -- there is no error to catch it. verify-torch-export.js exists to
   catch precisely this, and this script writes a `__probe` block for it to check against.

2. EVERY LAYER IS TANH, INCLUDING THE OUTPUT. net.js applies Math.tanh inside its layer loop with
   no special case for the last one, and the value is read as acts[-1][0]. So the model must end
   tanh(Linear(h, 1)) -- not a bare Linear, not sigmoid. A linear output head would train fine in
   torch and then be squashed by a tanh that only exists on the JS side.

WHAT train.js DOES THAT THIS REPLICATES (dropping any of these makes an unfair comparison):
  * GAME-LEVEL 10% validation split, never row-level. Positions inside one game are correlated;
    splitting by row leaks the same game into both halves and inflates val accuracy. This project
    has already been bitten by that once, with retromine replay families.
  * --gameWeight sqrt: weight 1/sqrt(gameLen) per row, so a game's total say grows as sqrt of its
    length. Flat weighting lets a 139-ply shuffle outvote a 7-ply throw ~20:1, and the long game's
    rows are near-duplicates carrying the noisiest labels.
  * --drawWeight 0.25: z == 0 exactly means a drawn/adjudicated position (a discounted decided
    label can never be exactly 0). Worth teaching, shouldn't rival decided outcomes.
  * weights normalised to mean 1, so the effective step size is comparable to train.js's.
  * --familyWeight sqrt: replay siblings from one retromine seed/outcome are down-weighted as a
    family, matching train.js. Without this, large failed-rescue families dominate the corpus.
  * --resume: imports an existing net.js JSON checkpoint exactly, allowing GPU continuation of a
    JS-trained model. Adam moments reset, just as train.js resets them on every 10-epoch process.
NOT replicated: --eloWeight (off by default in train.js and Wild Mint).
"""
import argparse, glob, json, math, os, random, sys
from collections import defaultdict

N_FEATURES = 94


MOVER_FACE = None  # compiled lazily; strips "(+P)@D<n>" so mv face ids collapse to model names


def total_ram_bytes():
    """Stdlib-only, cross-platform. A wrong answer here only moves a soft default, so the
    fallback is a conservative 8 GB rather than a crash."""
    try:
        if os.name == 'nt':
            import ctypes
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [('dwLength', ctypes.c_ulong), ('dwMemoryLoad', ctypes.c_ulong),
                            ('ullTotalPhys', ctypes.c_ulonglong), ('ullAvailPhys', ctypes.c_ulonglong),
                            ('ullTotalPageFile', ctypes.c_ulonglong), ('ullAvailPageFile', ctypes.c_ulonglong),
                            ('ullTotalVirtual', ctypes.c_ulonglong), ('ullAvailVirtual', ctypes.c_ulonglong),
                            ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]
            st = MEMORYSTATUSEX(); st.dwLength = ctypes.sizeof(st)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
            return int(st.ullTotalPhys)
        return os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES')
    except Exception:
        return 8 << 30


def cap_files(paths, budget_mb):
    """Same corpus cap as train.js, same reasons, same shape of answer. There was no cap on
    either trainer, and the committed corpus quietly outgrew every machine that pulls it (~1.9 GB
    of JSONL by the time it froze two laptops); parsed into per-row Python lists that is several
    times larger again, in one process, alongside the league's other workers. Newest files first
    (mtime, then name descending -- a fresh clone stamps every file the same checkout mtime, so
    the name tiebreak does the work there), budget ~1/20 of RAM as raw text, floored at 256 MB
    and capped at 2 GB; an explicit --dataBudgetMB is honoured as given. The newest file is always
    kept, even alone over budget: a cap that can select zero data fails worse than the memory
    problem it solves."""
    budget = float(budget_mb) if budget_mb and budget_mb > 0 else \
        min(2048.0, max(256.0, total_ram_bytes() / (1 << 20) / 20.0))
    budget_bytes = int(budget * (1 << 20))
    listed = []
    for pth in paths:
        try:
            st = os.stat(pth)
            listed.append((st.st_mtime, os.path.basename(pth), pth, st.st_size))
        except OSError:
            pass
    listed.sort(key=lambda t: (t[0], t[1]), reverse=True)
    keep, kept_bytes, dropped_bytes = [], 0, 0
    for _, _, pth, size in listed:
        if not keep or kept_bytes + size <= budget_bytes:
            keep.append(pth); kept_bytes += size
        else:
            dropped_bytes += size
    if len(keep) < len(listed):
        print('data cap: training on %d of %d files (%.1f MB kept, %.1f MB of oldest data left out; '
              'budget %.1f MB from %.1f GB RAM -- --dataBudgetMB overrides)'
              % (len(keep), len(listed), kept_bytes / (1 << 20), dropped_bytes / (1 << 20),
                 budget, total_ram_bytes() / (1 << 30)))
    return sorted(keep)


def mover_name(mv):
    global MOVER_FACE
    if MOVER_FACE is None:
        import re
        MOVER_FACE = re.compile(r'(\+P)?@D[1-4]$')
    return MOVER_FACE.sub('', str(mv))


def load_rows(data_glob, budget_mb=0.0):
    """Read training rows. Mirrors train.js's filtering exactly. Also collects, per game, the
    set of mover identities (for --eloWeight) and, per row, the raw pose (for --poseInput) --
    both fields have been stamped on rows by arena.js/selfplay-legacy.js all along."""
    by_game, skipped_nof, stale, policy_rows = defaultdict(list), 0, defaultdict(int), 0
    game_movers = defaultdict(set)
    for path in cap_files(glob.glob(data_glob), budget_mb):
        name = os.path.basename(path)
        inferred, prev_abs, cur = 0, float('inf'), None
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
                if not f:                      # per-game records etc -- not training data
                    skipped_nof += 1
                    continue
                if len(f) != N_FEATURES:       # a real row from an older feature set
                    stale[name] += 1
                    continue
                if j.get('arm') is not None and j.get('bin') is not None:
                    policy_rows += 1           # policy targets re-cover positions already here
                    continue
                g = j.get('g')
                if g is None:                  # same |z| game-boundary inference train.js uses
                    a = abs(j.get('z', 0.0))
                    if a < prev_abs:
                        inferred += 1
                        cur = f"{name}#{inferred}"
                    prev_abs = a
                    g = cur
                else:
                    prev_abs = float('inf')
                by_game[g].append((f, float(j.get('z', 0.0)), j.get('m'), j.get('p')))
                if j.get('mv') is not None:
                    game_movers[g].add(mover_name(j.get('mv')))
    if stale:
        total = sum(stale.values())
        print(f"ERROR: {total} rows use a different feature set (expected {N_FEATURES}/position):",
              file=sys.stderr)
        for k, v in stale.items():
            print(f"   {k}: {v} rows", file=sys.stderr)
        sys.exit(1)
    if skipped_nof:
        print(f"skipped {skipped_nof} row(s) with no feature vector (not training data)")
    if policy_rows:
        print(f"skipped {policy_rows} policy-target row(s)")
    return by_game, game_movers


def elo_lookup(summary_path):
    """Model/ladder name -> current point Elo, clean-league summary only. Under-measured models
    (<6 games) are excluded so the weighting never chases a two-game fluke rating."""
    try:
        with open(summary_path, 'r', encoding='utf-8') as fh:
            players = json.load(fh).get('players') or {}
    except Exception:
        return {}
    best = {}
    for pid, r in players.items():
        elo = r.get('elo')
        if elo is None:
            continue
        if r.get('kind') == 'ladder':
            name = pid
        elif r.get('model'):
            base = str(r.get('model')).replace('\\', '/').split('/')[-1]
            name = base[:-5] if base.endswith('.json') else base
            if (r.get('games') or 0) < 6:
                continue
        else:
            continue
        if name not in best or float(elo) > best[name]:
            best[name] = float(elo)
    return best


def elo_game_weights(game_movers, lookup, floor, temp):
    """Per-game multiplier: floor + (1-floor) * sigmoid((game Elo - corpus median) / temp).
    Game Elo is the mean of its movers' current Elo; the reference is the corpus's own median,
    so the weighting is scale-free and survives Elo resets. Games with no resolvable mover
    (legacy rows, culled models) sit at the midpoint rather than the floor -- unknown is not
    the same as known-weak."""
    elos = {}
    for gid, movers in game_movers.items():
        vals = [lookup[m] for m in movers if m in lookup]
        if vals:
            elos[gid] = sum(vals) / len(vals)
    if not elos:
        return {}, None
    ref = sorted(elos.values())[len(elos) // 2]
    midpoint = floor + (1.0 - floor) * 0.5
    out = defaultdict(lambda: midpoint)     # unknown provenance = midpoint, for every gid asked
    for gid, e in elos.items():
        x = 1.0 / (1.0 + math.exp(-(e - ref) / max(1e-6, temp)))
        out[gid] = floor + (1.0 - floor) * x
    return out, ref, len(elos)


def _mulberry32(seed):
    """The exact PRNG train.js uses for fixed architecture-comparison splits."""
    a = seed & 0xffffffff
    while True:
        a = (a + 0x6D2B79F5) & 0xffffffff
        t = a
        t = ((t ^ (t >> 15)) * (1 | t)) & 0xffffffff
        t = (((t + (((t ^ (t >> 7)) * (61 | t)) & 0xffffffff)) & 0xffffffff) ^ t) & 0xffffffff
        yield ((t ^ (t >> 14)) & 0xffffffff) / 4294967296.0


def _js_shuffle(items, seed):
    rng = _mulberry32(seed)
    for i in range(len(items) - 1, 0, -1):
        j = int(next(rng) * (i + 1))
        items[i], items[j] = items[j], items[i]


def split_and_weight(by_game, seed, gw_mode, fw_mode, draw_w, game_w=None):
    """Game split and row/family weights matching train.js. Returns (x, y, w) rows. game_w is an
    optional per-game multiplier (e.g. --eloWeight); it composes with, never replaces, the
    existing game-size/draw/family weights, and the final mean-normalisation keeps the loss
    scale unchanged either way."""
    ids = list(by_game.keys())
    _js_shuffle(ids, seed)
    n_val = max(1, int(len(ids) * 0.1))
    val_ids, train_ids = ids[:n_val], ids[n_val:]

    def base_rows(subset):
        rows = []
        for gid in subset:
            game = by_game[gid]
            n = len(game)
            base = 1.0 / math.sqrt(n) if gw_mode == 'sqrt' else 1.0 / n if gw_mode == 'game' else 1.0
            if game_w:
                base *= game_w.get(gid, 1.0)
            for f, z, mover, _pose in game:
                rows.append([f, z, base * (draw_w if z == 0.0 else 1.0), gid, mover])
        return rows

    train, val = base_rows(train_ids), base_rows(val_ids)
    if fw_mode != 'off':
        outcomes, group_sizes = {}, defaultdict(int)
        for gid in train_ids:
            first = by_game[gid][0]
            z, mover = first[1], first[2]
            outcome = 'draw' if z == 0.0 else (mover if z > 0 else (1 - mover if mover in (0, 1) else 'unknown'))
            outcomes[gid] = outcome
            import re
            family = re.sub(r'-[0-9]+$', '', str(gid))
            group_sizes[(family, outcome)] += 1
        for row in train:
            gid = row[3]
            import re
            family = re.sub(r'-[0-9]+$', '', str(gid))
            row[2] /= math.sqrt(group_sizes[(family, outcomes[gid])])

    if train:
        mean_w = sum(r[2] for r in train) / len(train)
        if mean_w > 0:
            for row in train:
                row[2] /= mean_w
    return [(f, z, w) for f, z, w, _, _ in train], [(f, z, w) for f, z, w, _, _ in val]


def export_for_netjs(layers, probe_inputs=None, probe_fn=None, topology=None):
    """torch Linear layers -> net.js {sizes, W, b}. W is flat OUTPUT-MAJOR, matching net.js's
    W[j*nIn + i]; torch's weight is already [out, in] so .flatten() is correct with no transpose."""
    sizes = [layers[0].in_features] + [l.out_features for l in layers]
    W = [l.weight.detach().cpu().numpy().flatten().tolist() for l in layers]
    b = [l.bias.detach().cpu().numpy().flatten().tolist() for l in layers]
    doc = {'sizes': sizes, 'W': W, 'b': b}
    fan_ins = [l.in_features for l in layers]
    if topology:
        doc['topology'] = topology
        doc['fanIns'] = fan_ins
    if probe_inputs is not None and probe_fn is not None:
        # Reference outputs computed on THIS side, for verify-torch-export.js to check net.js
        # reproduces. Extra keys are ignored by net.js's fromJSON, so this is free to carry.
        doc['__probe'] = [{'x': list(map(float, x)), 'y': float(probe_fn(x))} for x in probe_inputs]
    return doc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.path.join(os.path.dirname(__file__), 'data', '*.jsonl'))
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), 'models', 'torch.json'))
    ap.add_argument('--hidden', default='96,96')
    ap.add_argument('--epochs', type=int, default=40)
    ap.add_argument('--batch', type=int, default=256)
    ap.add_argument('--lr', type=float, default=1e-3)
    ap.add_argument('--wd', type=float, default=0.0)
    ap.add_argument('--lrDecay', default='cosine', choices=['cosine', 'flat'])
    ap.add_argument('--seed', type=int, default=12345)
    ap.add_argument('--gameWeight', default='sqrt', choices=['sqrt', 'game', 'row'])
    ap.add_argument('--drawWeight', type=float, default=0.25)
    ap.add_argument('--familyWeight', default='sqrt', choices=['sqrt', 'off'])
    ap.add_argument('--resume', default=None, help='net.js JSON checkpoint to continue')
    ap.add_argument('--device', default=None, help='cuda | cpu, default: cuda if available')
    ap.add_argument('--topology', default='auto', choices=['auto', 'plain', 'dense-memory'])
    ap.add_argument('--memoryWidth', type=int, default=40)
    ap.add_argument('--residualScale', type=float, default=0.2)
    ap.add_argument('--eloWeight', default='off', choices=['off', 'logistic'],
                    help='weight each game by its players\' current league Elo (see elo_game_weights)')
    ap.add_argument('--dataBudgetMB', type=float, default=0.0,
                    help='cap on raw JSONL read into memory; 0 = scale to this machine\'s RAM')
    ap.add_argument('--eloWeightFloor', type=float, default=0.15)
    ap.add_argument('--eloWeightTemp', type=float, default=150.0)
    ap.add_argument('--eloSummary', default=os.path.join(os.path.dirname(__file__), 'elo-summary.json'))
    ap.add_argument('--poseInput', action='store_true',
                    help='EXPERIMENT: append the z-scored raw pose (6 values) to the feature vector. '
                         'Offline ablation only -- live play feeds nets the plain features, so a '
                         'pose-input model must never be placed in nn/models.')
    args = ap.parse_args()

    try:
        import torch
        import torch.nn as nn
    except ImportError:
        print("PyTorch not installed:  pip install torch", file=sys.stderr)
        sys.exit(1)

    device = torch.device(args.device) if args.device else torch.device(
        'cuda' if torch.cuda.is_available() else 'cpu')
    print(f"device: {device}" +
          (f" ({torch.cuda.get_device_name(0)})" if device.type == 'cuda' else ''))

    torch.manual_seed(args.seed)
    by_game, game_movers = load_rows(args.data, args.dataBudgetMB)
    if not by_game:
        print(f"no training rows matched {args.data}", file=sys.stderr)
        sys.exit(1)
    pose_norm = None
    if args.poseInput:
        # Keep only rows that carry a raw pose, z-score it over the corpus, append it to the
        # features. The norm constants ride in the export so a later play-time integration can
        # reproduce the exact transform; until then this is a ceiling probe, not a league player.
        dropped, kept = 0, defaultdict(list)
        for gid, rows in by_game.items():
            for f, z, m, p in rows:
                if isinstance(p, list) and len(p) == 6:
                    kept[gid].append((f, z, m, p))
                else:
                    dropped += 1
        by_game = {gid: rows for gid, rows in kept.items() if rows}
        allp = [p for rows in by_game.values() for (_f, _z, _m, p) in rows]
        if not allp:
            print('no rows carry a raw pose; cannot train with --poseInput', file=sys.stderr)
            sys.exit(1)
        mean = [sum(p[i] for p in allp) / len(allp) for i in range(6)]
        std = [max(1e-6, math.sqrt(sum((p[i] - mean[i]) ** 2 for p in allp) / len(allp))) for i in range(6)]
        pose_norm = {'mean': [round(x, 6) for x in mean], 'std': [round(x, 6) for x in std]}
        for gid in list(by_game.keys()):
            by_game[gid] = [(f + [(p[i] - mean[i]) / std[i] for i in range(6)], z, m, p)
                            for f, z, m, p in by_game[gid]]
        print(f"poseInput: appended 6 z-scored pose values; {dropped} row(s) without a pose dropped")
    game_w = None
    if args.eloWeight != 'off':
        game_w, ref, rated = elo_game_weights(game_movers, elo_lookup(args.eloSummary),
                                              args.eloWeightFloor, args.eloWeightTemp)
        if ref is None:
            print('eloWeight: no game had a rateable player in the summary; weighting off this run')
            game_w = None
        else:
            print(f"eloWeight: {rated}/{len(by_game)} games carry a current-Elo weight "
                  f"(median ref {ref:.0f}, floor {args.eloWeightFloor}, temp {args.eloWeightTemp:.0f})")
    train, val = split_and_weight(by_game, args.seed, args.gameWeight, args.familyWeight,
                                  args.drawWeight, game_w)
    print(f"data: {len(train)} train / {len(val)} val positions "
          f"({len(by_game) - max(1, len(by_game)//10)} / {max(1, len(by_game)//10)} games, "
          f"game-level split)")

    def tens(rows):
        x = torch.tensor([r[0] for r in rows], dtype=torch.float32, device=device)
        y = torch.tensor([[r[1]] for r in rows], dtype=torch.float32, device=device)
        w = torch.tensor([[r[2]] for r in rows], dtype=torch.float32, device=device)
        return x, y, w

    xtr, ytr, wtr = tens(train)
    xva, yva, _ = tens(val)

    checkpoint = None
    if args.resume:
        with open(args.resume, 'r', encoding='utf-8') as fh:
            checkpoint = json.load(fh)
    # A missing field means the old checkpoint's ancestry is genuinely unknown. Keep it unknown
    # instead of presenting the current chunk as a fake lifetime epoch count on the live ladder.
    base_trained_epochs = 0 if checkpoint is None else checkpoint.get('trainedEpochs')
    if base_trained_epochs is not None:
        try:
            base_trained_epochs = int(base_trained_epochs)
        except (TypeError, ValueError):
            base_trained_epochs = None

    hidden = [int(h) for h in args.hidden.split(',') if h.strip()]
    in_dim = len(next(iter(by_game.values()))[0][0])   # N_FEATURES, +6 under --poseInput
    sizes = [in_dim] + hidden + [1]
    checkpoint_topology = (checkpoint or {}).get('topology') or None
    topology_kind = args.topology
    if topology_kind == 'auto':
        topology_kind = 'dense-memory' if checkpoint_topology and checkpoint_topology.get('kind') == 'dense-memory-v1' else 'plain'
    topology = None
    if topology_kind == 'dense-memory':
        if len(hidden) < 2 or len(set(hidden)) != 1:
            print('dense-memory requires at least two equal-width hidden layers', file=sys.stderr)
            sys.exit(1)
        memory_width = int((checkpoint_topology or {}).get('memoryWidth', args.memoryWidth))
        residual_scale = float((checkpoint_topology or {}).get('residualScale', args.residualScale))
        if memory_width < 1 or memory_width > hidden[0]:
            print(f'memoryWidth must be between 1 and {hidden[0]}', file=sys.stderr)
            sys.exit(1)
        topology = {'kind': 'dense-memory-v1', 'memoryWidth': memory_width,
                    'residualScale': residual_scale}
        # First hidden layer sees the feature vector. Each later hidden layer sees the complete
        # previous layer plus one memory packet from every layer before that. The value head sees
        # the final layer plus packets from all nine predecessors.
        fan_ins = [in_dim]
        for i in range(1, len(hidden)):
            fan_ins.append(hidden[i - 1] + memory_width * (i - 1))
        fan_ins.append(hidden[-1] + memory_width * (len(hidden) - 1))
    else:
        fan_ins = sizes[:-1]
    linears = [nn.Linear(fan_ins[i], sizes[i + 1]) for i in range(len(sizes) - 1)]
    if checkpoint:
        if checkpoint.get('sizes') != sizes:
            print(f"resume shape {checkpoint.get('sizes')} does not match requested {sizes}", file=sys.stderr)
            sys.exit(1)
        if checkpoint.get('fanIns', sizes[:-1]) != fan_ins:
            print(f"resume fan-ins {checkpoint.get('fanIns')} do not match requested {fan_ins}", file=sys.stderr)
            sys.exit(1)
        import torch
        with torch.no_grad():
            for layer, weights, bias in zip(linears, checkpoint['W'], checkpoint['b']):
                layer.weight.copy_(torch.tensor(weights, dtype=torch.float32).reshape(
                    layer.out_features, layer.in_features))
                layer.bias.copy_(torch.tensor(bias, dtype=torch.float32))
        print(f"resumed weights from {args.resume}")
    # Plain exports tanh every layer. Dense-memory keeps a constant-width residual trunk and sends
    # the first k learned activations of every hidden layer to every layer in front.
    if topology:
        class DenseMemoryNet(nn.Module):
            def __init__(self, layers, memory_width, residual_scale):
                super().__init__()
                self.layers = nn.ModuleList(layers)
                self.memory_width = memory_width
                self.residual_scale = residual_scale
            def forward(self, x):
                a, memories = x, []
                for li, layer in enumerate(self.layers):
                    a_in = a if li == 0 else torch.cat([a] + memories[:-1], dim=1)
                    branch = torch.tanh(layer(a_in))
                    a = a + self.residual_scale * branch if 0 < li < len(self.layers) - 1 else branch
                    if li < len(self.layers) - 1:
                        memories.append(a[:, :self.memory_width])
                return a
        model = DenseMemoryNet(linears, topology['memoryWidth'], topology['residualScale']).to(device)
    else:
        seq = []
        for l in linears:
            seq += [l, nn.Tanh()]
        model = nn.Sequential(*seq).to(device)

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)
    n = xtr.shape[0]
    best_val, best_state, best_epoch = float('inf'), None, 0
    for ep in range(1, args.epochs + 1):
        t = (ep - 1) / (args.epochs - 1) if args.epochs > 1 else 0.0
        lr_ep = args.lr if args.lrDecay == 'flat' else args.lr * (0.1 + 0.9 * 0.5 * (1.0 + math.cos(math.pi * t)))
        for group in opt.param_groups:
            group['lr'] = lr_ep
        model.train()
        perm = torch.randperm(n, device=device)
        tot = 0.0
        for i in range(0, n, args.batch):
            idx = perm[i:i + args.batch]
            xb, yb, wb = xtr[idx], ytr[idx], wtr[idx]
            opt.zero_grad()
            pred = model(xb)
            loss = (wb * (pred - yb) ** 2).mean()     # weighted MSE, same objective as net.js
            loss.backward()
            opt.step()
            tot += float(loss) * len(idx)
        model.eval()
        with torch.no_grad():
            vpred = model(xva)
            vmse = float(((vpred - yva) ** 2).mean())
            decided = (yva != 0)
            sign_acc = float((torch.sign(vpred[decided]) == torch.sign(yva[decided])).float().mean()) if bool(decided.any()) else 0.0
        flag = ''
        if vmse < best_val:
            best_val, flag = vmse, '  *'
            best_epoch = ep
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        print(f"epoch {ep}/{args.epochs}: train mse {tot/n:.5f}, val mse {vmse:.5f}, "
              f"val sign-acc {sign_acc*100:.1f}% (lr {lr_ep:.6f}){flag}", flush=True)

    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()

    with torch.no_grad():
        probe_x = [xva[i].tolist() for i in range(min(8, xva.shape[0]))]
        def probe_fn(x):
            return float(model(torch.tensor([x], dtype=torch.float32, device=device))[0][0])
        doc = export_for_netjs(linears, probe_x, probe_fn, topology)
        if pose_norm:
            doc['poseInput'] = True
            doc['poseNorm'] = pose_norm
        if base_trained_epochs is not None:
            # Insert last so live-ladder.js can read the exact count from the small tail of a very
            # large JSON model without parsing all of its weights on every inbox update.
            doc['trainedEpochs'] = base_trained_epochs + best_epoch

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    tmp_out = f"{args.out}.tmp-{os.getpid()}"
    with open(tmp_out, 'w') as fh:
        json.dump(doc, fh)
    os.replace(tmp_out, args.out)
    topo_label = f", topology {topology['kind']} k={topology['memoryWidth']}" if topology else ''
    print(f"\nsaved {args.out} (sizes {doc['sizes']}{topo_label}, best val mse {best_val:.5f})")
    print(f"NOW VERIFY:  node nn/verify-torch-export.js {args.out}")


if __name__ == '__main__':
    main()
