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


def load_rows(data_glob):
    """Read training rows. Mirrors train.js's filtering exactly."""
    by_game, skipped_nof, stale, policy_rows = defaultdict(list), 0, defaultdict(int), 0
    for path in sorted(glob.glob(data_glob)):
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
                by_game[g].append((f, float(j.get('z', 0.0)), j.get('m')))
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
    return by_game


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


def split_and_weight(by_game, seed, gw_mode, fw_mode, draw_w):
    """Game split and row/family weights matching train.js. Returns (x, y, w) rows."""
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
            for f, z, mover in game:
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


def export_for_netjs(layers, probe_inputs=None, probe_fn=None):
    """torch Linear layers -> net.js {sizes, W, b}. W is flat OUTPUT-MAJOR, matching net.js's
    W[j*nIn + i]; torch's weight is already [out, in] so .flatten() is correct with no transpose."""
    sizes = [layers[0].in_features] + [l.out_features for l in layers]
    W = [l.weight.detach().cpu().numpy().flatten().tolist() for l in layers]
    b = [l.bias.detach().cpu().numpy().flatten().tolist() for l in layers]
    doc = {'sizes': sizes, 'W': W, 'b': b}
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
    by_game = load_rows(args.data)
    if not by_game:
        print(f"no training rows matched {args.data}", file=sys.stderr)
        sys.exit(1)
    train, val = split_and_weight(by_game, args.seed, args.gameWeight, args.familyWeight, args.drawWeight)
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

    hidden = [int(h) for h in args.hidden.split(',') if h.strip()]
    sizes = [N_FEATURES] + hidden + [1]
    linears = [nn.Linear(sizes[i], sizes[i + 1]) for i in range(len(sizes) - 1)]
    if args.resume:
        with open(args.resume, 'r', encoding='utf-8') as fh:
            checkpoint = json.load(fh)
        if checkpoint.get('sizes') != sizes:
            print(f"resume shape {checkpoint.get('sizes')} does not match requested {sizes}", file=sys.stderr)
            sys.exit(1)
        import torch
        with torch.no_grad():
            for layer, weights, bias in zip(linears, checkpoint['W'], checkpoint['b']):
                layer.weight.copy_(torch.tensor(weights, dtype=torch.float32).reshape(
                    layer.out_features, layer.in_features))
                layer.bias.copy_(torch.tensor(bias, dtype=torch.float32))
        print(f"resumed weights from {args.resume}")
    # tanh after EVERY layer, output included -- net.js does exactly this and reads acts[-1][0].
    seq, model = [], None
    for l in linears:
        seq += [l, nn.Tanh()]
    model = nn.Sequential(*seq).to(device)

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)
    n = xtr.shape[0]
    best_val, best_state = float('inf'), None
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
        doc = export_for_netjs(linears, probe_x, probe_fn)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    tmp_out = f"{args.out}.tmp-{os.getpid()}"
    with open(tmp_out, 'w') as fh:
        json.dump(doc, fh)
    os.replace(tmp_out, args.out)
    print(f"\nsaved {args.out} (sizes {doc['sizes']}, best val mse {best_val:.5f})")
    print(f"NOW VERIFY:  node nn/verify-torch-export.js {args.out}")


if __name__ == '__main__':
    main()
