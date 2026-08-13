#!/usr/bin/env python3
"""Train a JOINT value+policy net (one shared trunk, two heads) in PyTorch, on GPU if one is
available, and export it for dualnet.js/nnai.js.

WHY THIS EXISTS
Today a search node that wants a leaf score AND a move prior pays for two full forward passes:
net.js's MLP.value() plus policy.js's PolicyMLP.predict(). A dual net -- one shared tanh trunk,
then a value head (tanh) and a policy head (linear logits over N_ARMS+N_BINS) branching off the
SAME last hidden layer -- gets both from one. Whether the joint training objective helps, hurts, or
is a wash for either head relative to training them separately is an open, measured-not-assumed
question: that's what arena.js's `dual:` brain (vs `nn:` + `--policyA`) is for.

The data for this already exists with no new mining step: policy-targets.js's output carries a
value target `z` on EVERY row alongside the `arm`/`bin` policy target, for the exact same position
(see its header for how the move is reconstructed from consecutive self-play rows). So the usual
"replay games to build a new dataset" step is skipped entirely -- this just reads
nn/policy-targets.jsonl directly.

    node nn/policy-targets.js                                    # mint/refresh targets (if stale)
    python3 nn/torch-train-dual.py --epochs 40 --hidden 96,96 --out nn/models/dual-v1.json
    node nn/verify-dual-export.js nn/models/dual-v1.json          # ALWAYS run this

SHAPE SWEEP (--sweep)
Nobody knows the right trunk for a net doing two jobs a priori, and the league's games are far too
expensive to search shapes with: at ~800 games most pairs have 5-7 games and CIs run 100-140 Elo,
far wider than the difference between two reasonable shapes. So --sweep ranks candidates on the
cheap signal instead -- val loss, no games at all, seconds per shape on a GPU -- and the league
then spends its games only on the winners:

    python3 nn/torch-train-dual.py --sweep "96,96;208;128,128;64,64" --sweepEpochs 15 \
                                    --sweepOut nn/models/.dual-sweep.json

It trains nothing to keep: every candidate is trained by the same train_one() on the same split
with the same seed, ranked by the same combined objective training itself optimises, and then the
winners are retrained properly at full --epochs through the normal path above. The one bias worth
knowing: ranking happens at --sweepEpochs rather than the full --epochs, which favours shapes that
converge FAST over shapes that converge HIGH. That makes this a filter for eliminating bad trunks,
not a verdict -- which is why the winners still have to earn their rating in real games.
    node nn/arena.js --a dual:0:nn/models/dual-v1.json --b nn:0:nn/models/value.json --games 60 --depth 2
    node nn/arena.js --a dual:0:nn/models/dual-v1.json --dualPolicyA --b nn:0:nn/models/value.json \\
                      --policyB nn/models/policy.json --games 60 --depth 2   # fused vs separate

TWO INDEPENDENT LOSSES, TWO INDEPENDENT WEIGHT COLUMNS
The value head predicts an OUTCOME (train.js's job); the policy head IMITATES a mover (train-policy.js's
job). Those want different row weights for the reasons each of those files' own headers give, so this
computes both and does NOT collapse them into one:
  - value weight: train.js's default recipe -- 1/sqrt(gameLen) per row (--gameWeight), --drawWeight
    for z==0 rows. No eloWeight (train.js also defaults this off: a weak mover's position still has
    a real outcome). No familyWeight (retromine replay families are a train.js-only concern this
    reader does not attempt to detect).
  - policy weight: train-policy.js's default recipe -- loserW/drawW by the mover's own outcome,
    times eloWeight(mv) (default ON, unlike the value side -- imitation quality genuinely depends on
    who's being imitated), times the row's own `sw` (policy-targets.js's source-trust weight,
    already baked into the file, read as-is).
Both columns are normalised to mean 1 over the train split independently, same convention every
trainer in this codebase uses so the effective step size stays comparable.

THE TWO THINGS THAT SILENTLY GO WRONG (see torch-train-core.py's header -- same traps, same fix)
1. WEIGHT LAYOUT: net.js/dualnet.js index W[j*nIn + i] (j=out, i=in), the flat output-major layout
   torch.nn.Linear.weight already uses -- .flatten() is correct, .T.flatten() is not.
2. THE FINAL LAYER IS A SPLIT ACTIVATION, not tanh-everywhere and not linear-everywhere: slot 0
   (value) is tanh'd, slots 1..(N_ARMS+N_BINS) (policy logits) are left raw. Get this backwards --
   tanh the logits, or leave the value raw -- and the export loads fine and plays badly with no
   error, exactly the failure verify-dual-export.js's __probe exists to catch.
"""
import argparse, json, math, os, random, socket, sys

N_FEATURES = 94
N_ARMS = 6
N_BINS = 16
OUT = 1 + N_ARMS + N_BINS


def load_rows(targets_path):
    """Read policy-targets.jsonl rows: each already carries f, z, arm, bin, g, and optionally
    sw (source weight) / mv (mover pool id) / thrown (reconstructed-throw flag, ignored here --
    it's still a real move target, just approximate in the swing distance, per policy-targets.js)."""
    rows = []
    stale = 0
    with open(targets_path, 'r', encoding='utf-8', errors='replace') as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                j = json.loads(line)
            except Exception:
                continue
            f = j.get('f')
            if not f or len(f) != N_FEATURES:
                stale += 1
                continue
            if j.get('arm') is None or j.get('bin') is None:
                continue
            rows.append(j)
    if stale:
        print(f"skipped {stale} row(s) with a missing/wrong-length feature vector", file=sys.stderr)
    return rows


def make_elo_weighter(summary_path, scale=250.0, floor=0.25):
    """Python port of eloweight.js's makeEloWeighter -- see that file's header for the formula and
    why it's a logistic centred at the pool median rather than a raw rating lookup."""
    neutral = floor + (1 - floor) / 2
    try:
        with open(summary_path, 'r', encoding='utf-8') as fh:
            players = json.load(fh).get('players') or {}
    except Exception:
        players = {}
    elo = {pid: v.get('elo', 0) for pid, v in players.items() if (v.get('games') or 0) >= 4}
    if not elo:
        return lambda mv: 1.0, f"no ratings at {summary_path} -- all rows weighted 1"
    rated = sorted(elo.values())
    mid = rated[len(rated) // 2]
    newest_ckpt = {}   # depth -> (n, id), same "best@Dk resolves to the newest rated ckpt" rule
    import re
    for pid in elo:
        m = re.match(r'^ckpt-(\d+)@D(\d+)$', pid)
        if m:
            d, n = m.group(2), int(m.group(1))
            if d not in newest_ckpt or n > newest_ckpt[d][0]:
                newest_ckpt[d] = (n, pid)

    def resolve(mv):
        if mv in elo:
            return mv
        m = re.match(r'^best@D(\d+)$', mv or '')
        if m and m.group(1) in newest_ckpt:
            return newest_ckpt[m.group(1)][1]
        return None

    def weight(mv):
        r = resolve(mv) if mv else None
        if not r:
            return neutral
        return floor + (1 - floor) / (1 + 10 ** ((mid - elo[r]) / scale))

    return weight, f"{len(rated)} rated brains, median {mid:.0f} Elo, weights {floor:.2f}..1.00 (scale {scale})"


def split_and_weight(rows, seed, gw_mode, value_draw_w, loser_w, policy_draw_w, elo_weight_fn, no_source_weight):
    by_game = {}
    for j in rows:
        by_game.setdefault(j['g'], []).append(j)
    ids = sorted(by_game.keys())
    random.Random(seed).shuffle(ids)
    n_val = max(1, len(ids) // 10)
    out = {}
    for part, subset in (('val', ids[:n_val]), ('train', ids[n_val:])):
        part_rows = []
        for gid in subset:
            g = by_game[gid]
            n = len(g)
            gbase = 1.0 / math.sqrt(n) if gw_mode == 'sqrt' else (1.0 / n if gw_mode == 'game' else 1.0)
            for j in g:
                z = float(j.get('z', 0.0))
                vw = gbase * (value_draw_w if z == 0.0 else 1.0)
                pw = (1.0 if z > 0 else (loser_w if z < 0 else policy_draw_w)) * elo_weight_fn(j.get('mv'))
                if not no_source_weight:
                    pw *= float(j.get('sw', 1.0))
                part_rows.append({'f': j['f'], 'z': z, 'arm': int(j['arm']), 'bin': int(j['bin']),
                                   'vw': vw, 'pw': pw})
        out[part] = part_rows
    for part in ('train',):
        rs = out[part]
        if rs:
            mv = sum(r['vw'] for r in rs) / len(rs)
            mp = sum(r['pw'] for r in rs) / len(rs)
            for r in rs:
                if mv > 0: r['vw'] /= mv
                if mp > 0: r['pw'] /= mp
    return out['train'], out['val']


def export_for_netjs(linears, probe_inputs=None, probe_fn=None):
    """torch Linear layers -> dualnet.js {dual:true, sizes, W, b}. Same flat output-major layout
    as torch-train-core.py's export_for_netjs -- see that function's docstring."""
    sizes = [linears[0].in_features] + [l.out_features for l in linears]
    W = [l.weight.detach().cpu().numpy().flatten().tolist() for l in linears]
    b = [l.bias.detach().cpu().numpy().flatten().tolist() for l in linears]
    doc = {'dual': True, 'sizes': sizes, 'W': W, 'b': b}
    if probe_inputs is not None and probe_fn is not None:
        doc['__probe'] = [{'x': list(map(float, x)), 'y': list(map(float, probe_fn(x)))} for x in probe_inputs]
    return doc


def param_count(sizes):
    return sum(sizes[i] * sizes[i + 1] + sizes[i + 1] for i in range(len(sizes) - 1))


def train_one(torch, nn, device, hidden, data, args, epochs, verbose=True):
    """Train one dual net. Returns (metrics, linears). Shared by the single-shape path and --sweep
    so a swept shape is trained by EXACTLY the same code, on the same split, with the same seed --
    anything else would make the ranking a comparison of training conditions, not of shapes."""
    import time
    xtr, ztr, armtr, bintr, vwtr, pwtr, xva, zva, armva, binva = data
    torch.manual_seed(args.seed)          # re-seeded per shape: same init stream for every candidate
    sizes = [N_FEATURES] + hidden + [OUT]
    linears = [nn.Linear(sizes[i], sizes[i + 1]) for i in range(len(sizes) - 1)]
    if args.resume:
        with open(args.resume, 'r', encoding='utf-8') as fh:
            checkpoint = json.load(fh)
        if checkpoint.get('sizes') != sizes or checkpoint.get('dual') is not True:
            print(f"resume model is not a matching dual net: {checkpoint.get('sizes')} vs {sizes}",
                  file=sys.stderr)
            sys.exit(1)
        with torch.no_grad():
            for layer, weights, bias in zip(linears, checkpoint['W'], checkpoint['b']):
                layer.weight.copy_(torch.tensor(weights, dtype=torch.float32).reshape(
                    layer.out_features, layer.in_features))
                layer.bias.copy_(torch.tensor(bias, dtype=torch.float32))
        print(f"resumed weights from {args.resume}")
    # Keep the validation split fixed on args.seed, but do not replay the identical minibatch order
    # at the start of every resumed chunk.
    torch.manual_seed(args.seed + args.epochOffset)

    class DualNet(nn.Module):
        # Trunk: Linear+Tanh for every layer but the last. Last layer is a bare Linear producing
        # the full 23-wide raw vector; the split (tanh slot 0, leave 1..22 raw) happens in forward,
        # matching dualnet.js's own forward() exactly -- see that file's header.
        def __init__(self, linears):
            super().__init__()
            self.linears = nn.ModuleList(linears)

        def forward(self, x):
            a = x
            for l in self.linears[:-1]:
                a = torch.tanh(l(a))
            raw = self.linears[-1](a)
            value = torch.tanh(raw[:, :1])
            logits = raw[:, 1:]
            return torch.cat([value, logits], dim=1)   # [B, 23]: col 0 = value, 1..6 arm, 7..22 bin

    model = DualNet(linears).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)
    n = xtr.shape[0]
    best = {'score': float('inf')}
    best_state = None
    t0 = time.time()
    for ep in range(1, epochs + 1):
        model.train()
        perm = torch.randperm(n, device=device)
        vtot = ptot = 0.0
        for i in range(0, n, args.batch):
            idx = perm[i:i + args.batch]
            xb, zb, armb, binb = xtr[idx], ztr[idx], armtr[idx], bintr[idx]
            vwb, pwb = vwtr[idx], pwtr[idx]
            opt.zero_grad()
            out = model(xb)
            value_pred, arm_logits, bin_logits = out[:, :1], out[:, 1:1 + N_ARMS], out[:, 1 + N_ARMS:]
            value_loss = (vwb * (value_pred - zb) ** 2).mean()
            arm_ce = torch.nn.functional.cross_entropy(arm_logits, armb, reduction='none')
            bin_ce = torch.nn.functional.cross_entropy(bin_logits, binb, reduction='none')
            policy_loss = (pwb * (arm_ce + bin_ce)).mean()
            loss = value_loss + args.policyWeight * policy_loss
            loss.backward()
            opt.step()
            vtot += float(value_loss) * len(idx)
            ptot += float(policy_loss) * len(idx)
        model.eval()
        with torch.no_grad():
            out = model(xva)
            value_pred, arm_logits, bin_logits = out[:, :1], out[:, 1:1 + N_ARMS], out[:, 1 + N_ARMS:]
            vmse = float(((value_pred - zva) ** 2).mean())
            a1 = float((arm_logits.argmax(dim=1) == armva).float().mean())
            b1 = float((bin_logits.argmax(dim=1) == binva).float().mean())
            vce = torch.nn.functional.cross_entropy(arm_logits, armva).item() + \
                  torch.nn.functional.cross_entropy(bin_logits, binva).item()
        score = vmse + args.policyWeight * vce   # same combined objective the training loop optimises
        flag = ''
        if score < best['score']:
            best = {'score': score, 'vmse': vmse, 'vce': vce, 'a1': a1, 'b1': b1, 'epoch': ep}
            flag = '  *'
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        if verbose:
            print(f"epoch {ep}/{epochs}: train value mse {vtot/n:.5f} policy ce {ptot/n:.4f} | "
                  f"val value mse {vmse:.5f} policy ce {vce:.5f} combined {score:.5f} "
                  f"arm top1 {100*a1:.1f}% bin top1 {100*b1:.1f}%{flag}", flush=True)

    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    best['secs'] = time.time() - t0
    best['params'] = param_count(sizes)
    best['sizes'] = sizes
    best['hidden'] = ','.join(str(h) for h in hidden)
    return best, linears, model


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--targets', default=os.path.join(os.path.dirname(__file__), 'policy-targets.jsonl'))
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), 'models', 'dual.json'))
    ap.add_argument('--hidden', default='96,96')
    ap.add_argument('--epochs', type=int, default=40)
    ap.add_argument('--batch', type=int, default=256)
    ap.add_argument('--lr', type=float, default=1e-3)
    ap.add_argument('--wd', type=float, default=0.0)
    ap.add_argument('--seed', type=int, default=12345)
    ap.add_argument('--gameWeight', default='sqrt', choices=['sqrt', 'game', 'row'])
    ap.add_argument('--valueDrawWeight', type=float, default=0.25)
    ap.add_argument('--loserW', type=float, default=0.4)
    ap.add_argument('--policyDrawWeight', type=float, default=0.7)
    ap.add_argument('--policyWeight', type=float, default=1.0,
                     help='lambda balancing the policy CE loss against the value MSE loss')
    ap.add_argument('--eloSummary', default=os.path.join(os.path.dirname(__file__), 'elo-summary.json'))
    ap.add_argument('--eloScale', type=float, default=250.0)
    ap.add_argument('--eloFloor', type=float, default=0.25)
    ap.add_argument('--noEloWeight', action='store_true')
    ap.add_argument('--noSourceWeight', action='store_true')
    ap.add_argument('--device', default=None, help='cuda | cpu, default: cuda if available')
    ap.add_argument('--resume', default=None,
                    help='continue from an existing verified dualnet.js JSON checkpoint')
    ap.add_argument('--epochOffset', type=int, default=0,
                    help='completed epochs before this resumed chunk; varies training shuffle only')
    # --sweep: rank several trunk shapes cheaply instead of training one. Trains nothing to keep --
    # it writes a ranked table (and --sweepOut json) and exits, so the winner can then be trained
    # properly at full --epochs through the normal path. See the SHAPE SWEEP note in the header.
    ap.add_argument('--sweep', default=None,
                     help='semicolon-separated hidden shapes to rank, e.g. "96,96;208;128,128"')
    ap.add_argument('--sweepEpochs', type=int, default=15)
    ap.add_argument('--sweepOut', default=None, help='write the ranked sweep result as JSON here')
    args = ap.parse_args()

    try:
        import torch
        import torch.nn as nn
    except ImportError:
        print("PyTorch not installed:  pip install torch", file=sys.stderr)
        sys.exit(1)

    device = torch.device(args.device) if args.device else torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"device: {device}" + (f" ({torch.cuda.get_device_name(0)})" if device.type == 'cuda' else ''))

    torch.manual_seed(args.seed)
    rows = load_rows(args.targets)
    if not rows:
        print(f"no usable rows in {args.targets} -- run node nn/policy-targets.js first", file=sys.stderr)
        sys.exit(1)

    if args.noEloWeight:
        elo_weight_fn, elo_note = (lambda mv: 1.0), 'disabled by --noEloWeight'
    else:
        elo_weight_fn, elo_note = make_elo_weighter(args.eloSummary, args.eloScale, args.eloFloor)
    print(f"elo weighting: {elo_note}")

    train, val = split_and_weight(rows, args.seed, args.gameWeight, args.valueDrawWeight,
                                   args.loserW, args.policyDrawWeight, elo_weight_fn, args.noSourceWeight)
    n_games = len({j['g'] for j in rows})
    print(f"data: {len(train)} train / {len(val)} val moves "
          f"({n_games - max(1, n_games // 10)} / {max(1, n_games // 10)} games, game-level split)")

    def tens(rs):
        x = torch.tensor([r['f'] for r in rs], dtype=torch.float32, device=device)
        z = torch.tensor([[r['z']] for r in rs], dtype=torch.float32, device=device)
        arm = torch.tensor([r['arm'] for r in rs], dtype=torch.long, device=device)
        bin_ = torch.tensor([r['bin'] for r in rs], dtype=torch.long, device=device)
        vw = torch.tensor([[r['vw']] for r in rs], dtype=torch.float32, device=device)
        pw = torch.tensor([r['pw'] for r in rs], dtype=torch.float32, device=device)
        return x, z, arm, bin_, vw, pw

    xtr, ztr, armtr, bintr, vwtr, pwtr = tens(train)
    xva, zva, armva, binva, _, _ = tens(val)
    data = (xtr, ztr, armtr, bintr, vwtr, pwtr, xva, zva, armva, binva)

    # --- SHAPE SWEEP: rank candidate trunks cheaply, train nothing to keep -----------------------
    # The data above is loaded and split ONCE and reused for every candidate, so the sweep's cost is
    # almost entirely GPU training time -- the expensive JSON parse is paid once.
    if args.sweep:
        if args.resume:
            print('--resume cannot be combined with --sweep', file=sys.stderr)
            sys.exit(1)
        cands = [[int(h) for h in s.split(',') if h.strip()]
                 for s in args.sweep.split(';') if s.strip()]
        cands = [c for c in cands if c]
        if not cands:
            print('--sweep given no usable shapes', file=sys.stderr)
            sys.exit(1)
        print(f"\n=== SHAPE SWEEP: {len(cands)} candidates x {args.sweepEpochs} epochs ===")
        print("Ranking on the same combined val objective training optimises "
              f"(value mse + {args.policyWeight} x policy ce).")
        results = []
        for i, hid in enumerate(cands, 1):
            label = ','.join(str(h) for h in hid)
            print(f"\n[{i}/{len(cands)}] {label}", flush=True)
            m, _, _ = train_one(torch, nn, device, hid, data, args, args.sweepEpochs, verbose=False)
            print(f"    score {m['score']:.5f} | value mse {m['vmse']:.5f} | "
                  f"arm top1 {100*m['a1']:.1f}% | bin top1 {100*m['b1']:.1f}% | "
                  f"{m['params']:,} params | {m['secs']:.0f}s (best epoch {m['epoch']})")
            results.append(m)
        results.sort(key=lambda r: r['score'])
        print(f"\n{'rank':>4}  {'shape':<14} {'score':>9} {'val mse':>9} {'arm@1':>7} {'bin@1':>7} {'params':>9}")
        for i, r in enumerate(results, 1):
            print(f"{i:>4}  {r['hidden']:<14} {r['score']:>9.5f} {r['vmse']:>9.5f} "
                  f"{100*r['a1']:>6.1f}% {100*r['b1']:>6.1f}% {r['params']:>9,}")
        # The caveat that decides how much to trust this: candidates are ranked at --sweepEpochs,
        # not the full --epochs they will actually be trained at, which systematically favours
        # shapes that converge FAST over shapes that converge HIGH. It is a filter for eliminating
        # clearly-bad trunks cheaply, not a substitute for the league's own games -- which is
        # exactly why the winners still get rated against real opponents afterwards.
        print(f"\nRanked at {args.sweepEpochs} epochs (not the full {args.epochs}), so this favours")
        print("fast-converging shapes. Treat it as a filter, not a verdict -- the league still")
        print("rates the winners against real opponents.")
        if args.sweepOut:
            os.makedirs(os.path.dirname(os.path.abspath(args.sweepOut)), exist_ok=True)
            with open(args.sweepOut, 'w') as fh:
                json.dump({'sweepEpochs': args.sweepEpochs, 'policyWeight': args.policyWeight,
                           'ranked': [{k: r[k] for k in ('hidden', 'score', 'vmse', 'vce', 'a1', 'b1',
                                                          'params', 'epoch', 'secs')} for r in results]},
                          fh, indent=1)
            print(f"\nwrote {args.sweepOut}")
        return

    hidden = [int(h) for h in args.hidden.split(',') if h.strip()]
    best, linears, model = train_one(torch, nn, device, hidden, data, args, args.epochs, verbose=True)
    best_val = best['score']

    with torch.no_grad():
        probe_x = [xva[i].tolist() for i in range(min(8, xva.shape[0]))]
        def probe_fn(x):
            return model(torch.tensor([x], dtype=torch.float32, device=device))[0].tolist()
        doc = export_for_netjs(linears, probe_x, probe_fn)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    tmp_out = f"{args.out}.tmp-{os.getpid()}"
    with open(tmp_out, 'w') as fh:
        json.dump(doc, fh)
    os.replace(tmp_out, args.out)
    print(f"\nsaved {args.out} (sizes {doc['sizes']}, best combined val score {best_val:.5f})")
    print(f"NOW VERIFY:  node nn/verify-dual-export.js {args.out}")


if __name__ == '__main__':
    main()
