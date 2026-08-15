#!/usr/bin/env python3
"""CUDA/CPU trainer for Tau's 96-way joint move policy.

One class is (centre/left/right pivot, canonical signed direction, 16 distance bins). Unlike the
legacy 6+16 head, the distance distribution is conditional on the exact pivot and direction.
Exports policy.js-compatible JSON and embeds reference logits for the mandatory JS verifier.
"""
import argparse, json, math, os, random, re, sys, time

N_FEATURES = 94
N_BINS = 16
SIGNED_BINS = 32
N_ACTIONS = 96
ENCODING = 'centre-left-right-signed32-v1'


def load_rows(path):
    rows, stale = [], 0
    with open(path, 'r', encoding='utf-8', errors='replace') as fh:
        for line in fh:
            try:
                j = json.loads(line)
            except Exception:
                continue
            f, action = j.get('f'), j.get('action')
            if not f or len(f) != N_FEATURES:
                stale += 1
                continue
            if action is None or not 0 <= int(action) < N_ACTIONS:
                continue
            rows.append(j)
    if stale:
        print(f'skipped {stale} row(s) with missing/wrong-length features', file=sys.stderr)
    return rows


def make_elo_weighter(summary_path, scale, floor):
    neutral = floor + (1-floor)/2
    try:
        with open(summary_path, encoding='utf-8') as fh:
            players = json.load(fh).get('players') or {}
    except Exception:
        players = {}
    elo = {pid: float(v.get('elo', 0)) for pid, v in players.items() if (v.get('games') or 0) >= 4}
    if not elo:
        return lambda _: 1.0, 'no usable Elo table; flat mover weight 1'
    vals = sorted(elo.values()); mid = vals[len(vals)//2]
    newest = {}
    for pid in elo:
        m = re.match(r'^ckpt-(\d+)@D(\d+)$', pid)
        if m and (m.group(2) not in newest or int(m.group(1)) > newest[m.group(2)][0]):
            newest[m.group(2)] = (int(m.group(1)), pid)
    def weight(mv):
        key = mv if mv in elo else None
        m = re.match(r'^best@D(\d+)$', mv or '')
        if key is None and m and m.group(1) in newest:
            key = newest[m.group(1)][1]
        return neutral if key is None else floor + (1-floor)/(1 + 10**((mid-elo[key])/scale))
    return weight, f'{len(vals)} rated movers, median {mid:.0f} Elo, weights {floor:.2f}..1.00'


def split_rows(rows, args, elo_weight):
    by_game = {}
    for j in rows:
        by_game.setdefault(j['g'], []).append(j)
    gids = sorted(by_game, key=str)
    random.Random(args.seed).shuffle(gids)
    nv = max(1, len(gids)//10)
    lengths = sorted(len(g) for g in by_game.values())
    median_len = lengths[len(lengths)//2]
    out = []
    for subset in (gids[nv:], gids[:nv]):
        part = []
        for gid in subset:
            game = by_game[gid]
            base = 1/math.sqrt(len(game)) if args.gameWeight == 'sqrt' else \
                   (1/len(game) if args.gameWeight == 'game' else 1)
            for j in game:
                z = float(j.get('z', 0))
                w = base*(1 if z > 0 else (args.loserW if z < 0 else args.drawW))
                # Tempo is a tie-breaker inside winning play, never a substitute for winning.
                # A winner from a shorter-than-median game gets at most +quickWinBonus; a long
                # winner at most the same reduction. Losing moves receive no "fast" imitation
                # bonus merely because the opponent killed them quickly.
                if z > 0 and args.quickWinBonus:
                    pace = max(-1.0, min(1.0, (median_len-len(game))/max(1, median_len)))
                    # With sqrt game weighting, an n-row game otherwise contributes sqrt(n) total
                    # gradient and a slow win beats a quick win simply by containing more rows.
                    # Cancel that accidental volume advantage first, then apply the small tempo
                    # preference the flag names.
                    w *= max(.5, min(2.0, math.sqrt(median_len/max(1, len(game)))))
                    w *= 1.0 + args.quickWinBonus*pace
                if not args.noEloWeight:
                    w *= elo_weight(j.get('mv'))
                if not args.noSourceWeight:
                    w *= float(j.get('sw', 1))
                if j.get('thrown'):
                    w *= args.throwWeight
                part.append((j['f'], int(j['action']), w, bool(j.get('thrown'))))
        out.append(part)
    train, val = out
    counts = [0]*N_ACTIONS
    for _, action, _, _ in train:
        counts[action] += 1
    occupied = [n for n in counts if n]
    target = sum(occupied)/len(occupied)
    balance = [max(.5, min(2.0, math.sqrt(target/n))) if n else 1.0 for n in counts]
    train = [(x, a, w*balance[a]) for x, a, w, _ in train]
    val = [(x, a, w) for x, a, w, _ in val]
    mean_w = sum(r[2] for r in train)/len(train)
    train = [(x, a, w/mean_w) for x, a, w in train]
    return train, val, len(by_game), median_len, (min(balance), max(balance))


def build_model(torch, nn, hidden, args, checkpoint):
    sizes = [N_FEATURES] + hidden + [N_ACTIONS]
    topology = None
    structured = args.topology in ('dense-memory', 'pairwise-memory')
    if structured:
        if len(hidden) < 2 or len(set(hidden)) != 1:
            raise ValueError(f'{args.topology} needs at least two equal-width hidden layers')
        if not 1 <= args.memoryWidth <= hidden[0]:
            raise ValueError(f'memoryWidth must be 1..{hidden[0]}')
        topology = {'kind':'pairwise-memory-v1' if args.topology == 'pairwise-memory' else 'dense-memory-v1',
                    'memoryWidth':args.memoryWidth,
                    'residualScale':args.residualScale}
        fan_ins = [N_FEATURES]
        for i in range(1, len(hidden)):
            fan_ins.append(hidden[i-1] + args.memoryWidth*(i-1))
        fan_ins.append(hidden[-1] + args.memoryWidth*(len(hidden)-1))
    else:
        fan_ins = sizes[:-1]
    layers = [nn.Linear(fan_ins[i], sizes[i+1]) for i in range(len(sizes)-1)]
    # Dedicated low-rank messages for every non-adjacent forward layer pair. The ordinary full
    # matrix already connects adjacent layers, so only genuine skips get a four-neuron projection.
    skip_layers = nn.ModuleDict()
    if args.topology == 'pairwise-memory':
        for target in range(2, len(layers)):
            for source in range(target-1):
                skip_layers[f'{source}_to_{target}'] = nn.Linear(sizes[source+1], args.memoryWidth)

    class JointPolicy(nn.Module):
        def __init__(self):
            super().__init__(); self.layers = nn.ModuleList(layers); self.skips = skip_layers
        def forward(self, x):
            a, memories, history = x, [], []
            for li, layer in enumerate(self.layers):
                if args.topology == 'dense-memory' and li > 0:
                    a_in = torch.cat([a] + memories[:-1], dim=1)
                elif args.topology == 'pairwise-memory' and li > 1:
                    messages = [torch.tanh(self.skips[f'{source}_to_{li}'](history[source]))
                                for source in range(li-1)]
                    a_in = torch.cat([a] + messages, dim=1)
                else:
                    a_in = a
                raw = layer(a_in)
                if li == len(self.layers)-1:
                    a = raw
                else:
                    branch = torch.tanh(raw)
                    a = a + args.residualScale*branch if structured and li > 0 else branch
                    if args.topology == 'dense-memory':
                        memories.append(a[:, :args.memoryWidth])
                    elif args.topology == 'pairwise-memory':
                        history.append(a)
            return a

    model = JointPolicy()
    base_epochs = 0
    if checkpoint:
        if checkpoint.get('sizes') != sizes or checkpoint.get('policyEncoding') != ENCODING:
            raise ValueError(f"resume model does not match joint policy {sizes}")
        if (checkpoint.get('topology') or {}).get('kind') != (topology or {}).get('kind'):
            raise ValueError('resume topology does not match requested topology')
        if checkpoint.get('fanIns', sizes[:-1]) != fan_ins:
            raise ValueError('resume fanIns do not match requested topology')
        with torch.no_grad():
            for layer, w, b in zip(layers, checkpoint['W'], checkpoint['b']):
                layer.weight.copy_(torch.tensor(w, dtype=torch.float32).reshape(layer.out_features, layer.in_features))
                layer.bias.copy_(torch.tensor(b, dtype=torch.float32))
            if args.topology == 'pairwise-memory':
                sw, sb = checkpoint.get('skipW'), checkpoint.get('skipB')
                if not isinstance(sw, list) or not isinstance(sb, list):
                    raise ValueError('resume pairwise checkpoint is missing skip weights')
                for target in range(2, len(layers)):
                    for source in range(target-1):
                        proj = skip_layers[f'{source}_to_{target}']
                        try:
                            proj.weight.copy_(torch.tensor(sw[target][source], dtype=torch.float32)
                                              .reshape(proj.out_features, proj.in_features))
                            proj.bias.copy_(torch.tensor(sb[target][source], dtype=torch.float32))
                        except Exception as e:
                            raise ValueError(f'resume pairwise skip {source}->{target} is invalid') from e
        # The expedition rolls back to each chunk's best checkpoint, but its curve epoch remains
        # the attempted global epoch. The explicit offset is therefore authoritative on resume.
        base_epochs = args.epochOffset
        print(f'resumed weights from {args.resume}')
    return model, layers, skip_layers, sizes, fan_ins, topology, base_epochs


def export(layers, skip_layers, sizes, fan_ins, topology, trained_epochs, probes):
    doc = {
        'policy': True, 'policyEncoding': ENCODING, 'trainedEpochs': trained_epochs,
        'sizes': sizes,
        'W': [l.weight.detach().cpu().numpy().flatten().tolist() for l in layers],
        'b': [l.bias.detach().cpu().numpy().flatten().tolist() for l in layers],
        '__probe': probes,
    }
    if topology:
        doc['topology'], doc['fanIns'] = topology, fan_ins
    if topology and topology.get('kind') == 'pairwise-memory-v1':
        doc['skipW'], doc['skipB'] = [], []
        for target in range(len(layers)):
            wr, br = [], []
            for source in range(max(0, target-1)):
                proj = skip_layers[f'{source}_to_{target}']
                wr.append(proj.weight.detach().cpu().numpy().flatten().tolist())
                br.append(proj.bias.detach().cpu().numpy().flatten().tolist())
            doc['skipW'].append(wr); doc['skipB'].append(br)
    return doc


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(__file__)
    ap.add_argument('--targets', default=os.path.join(here, 'policy-targets.jsonl'))
    ap.add_argument('--out', default=os.path.join(here, 'models', 'policy-joint.json'))
    ap.add_argument('--hidden', default='96,64')
    ap.add_argument('--epochs', type=int, default=20)
    ap.add_argument('--batch', type=int, default=4096)
    ap.add_argument('--lr', type=float, default=8.5e-4)
    ap.add_argument('--wd', type=float, default=1e-4)
    ap.add_argument('--seed', type=int, default=43243)
    ap.add_argument('--gameWeight', choices=['sqrt','game','row'], default='sqrt')
    ap.add_argument('--loserW', type=float, default=.4)
    ap.add_argument('--drawW', type=float, default=.7)
    ap.add_argument('--throwWeight', type=float, default=1.5,
                    help='modest extra imitation weight for recovered winning throws')
    ap.add_argument('--quickWinBonus', type=float, default=.2,
                    help='max +/- policy weight for winners based on game length vs corpus median')
    ap.add_argument('--eloSummary', default=os.path.join(here, 'elo-summary.json'))
    ap.add_argument('--eloScale', type=float, default=250)
    ap.add_argument('--eloFloor', type=float, default=.25)
    ap.add_argument('--noEloWeight', action='store_true')
    ap.add_argument('--noSourceWeight', action='store_true')
    ap.add_argument('--device', default=None)
    ap.add_argument('--topology', choices=['plain','dense-memory','pairwise-memory'], default='plain')
    ap.add_argument('--memoryWidth', type=int, default=40)
    ap.add_argument('--residualScale', type=float, default=.2)
    ap.add_argument('--resume', default=None)
    ap.add_argument('--epochOffset', type=int, default=0)
    args = ap.parse_args()

    try:
        import torch
        import torch.nn as nn
    except ImportError:
        raise SystemExit('PyTorch not installed: pip install torch')
    device = torch.device(args.device) if args.device else torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f'device: {device}' + (f' ({torch.cuda.get_device_name(0)})' if device.type == 'cuda' else ''))
    rows = load_rows(args.targets)
    if not rows:
        raise SystemExit('no joint targets; run node nn/policy-targets.js after pulling this version')
    elo_weight, elo_note = make_elo_weighter(args.eloSummary, args.eloScale, args.eloFloor)
    print('elo weighting:', 'disabled' if args.noEloWeight else elo_note)
    train, val, n_games, median_len, balance_range = split_rows(rows, args, elo_weight)
    print(f'data: {len(train)} train / {len(val)} val moves from {n_games} games; '
          f'capped action balance {balance_range[0]:.2f}..{balance_range[1]:.2f}, '
          f'throw weight {args.throwWeight:.2f}, winner game-mass normalised + quick-win bonus '
          f'+/-{100*args.quickWinBonus:.0f}% around median {median_len} target moves/game')
    def tensors(part):
        return (torch.tensor([r[0] for r in part], dtype=torch.float32, device=device),
                torch.tensor([r[1] for r in part], dtype=torch.long, device=device),
                torch.tensor([r[2] for r in part], dtype=torch.float32, device=device))
    xtr, atr, wtr = tensors(train); xva, ava, _ = tensors(val)
    hidden = [int(x) for x in args.hidden.split(',') if x.strip()]
    checkpoint = None
    if args.resume:
        with open(args.resume, encoding='utf-8') as fh: checkpoint = json.load(fh)
    torch.manual_seed(args.seed + args.epochOffset)
    model, layers, skip_layers, sizes, fan_ins, topology, base_epochs = build_model(torch, nn, hidden, args, checkpoint)
    model.to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)
    best_ce, best_state, best_epoch, t0 = float('inf'), None, 0, time.time()
    for ep in range(1, args.epochs+1):
        model.train(); perm = torch.randperm(len(train), device=device); total = 0
        for i in range(0, len(train), args.batch):
            idx = perm[i:i+args.batch]; opt.zero_grad(); logits = model(xtr[idx])
            each = torch.nn.functional.cross_entropy(logits, atr[idx], reduction='none')
            loss = (wtr[idx]*each).mean(); loss.backward(); opt.step(); total += float(loss)*len(idx)
        model.eval()
        with torch.no_grad():
            logits = model(xva); ce = float(torch.nn.functional.cross_entropy(logits, ava))
            top1 = float((logits.argmax(1) == ava).float().mean())
            top3 = float((logits.topk(3, 1).indices == ava[:,None]).any(1).float().mean())
            pred = logits.argmax(1)
            leg = float(((pred//SIGNED_BINS) == (ava//SIGNED_BINS)).float().mean())
            direction = float((((pred%SIGNED_BINS)//N_BINS) == ((ava%SIGNED_BINS)//N_BINS)).float().mean())
        flag = ''
        if ce < best_ce:
            best_ce, best_epoch, flag = ce, ep, '  *'
            best_state = {k:v.detach().clone() for k,v in model.state_dict().items()}
        print(f'epoch {ep}/{args.epochs}: train ce {total/len(train):.5f}, val ce {ce:.5f}, '
              f'action@1 {100*top1:.1f}%, @3 {100*top3:.1f}%, leg {100*leg:.1f}%, dir {100*direction:.1f}%{flag}', flush=True)
    model.load_state_dict(best_state); model.eval()
    with torch.no_grad():
        probes = []
        for x in xva[:8]:
            y = model(x[None,:])[0]
            probes.append({'x':[float(v) for v in x.tolist()], 'y':[float(v) for v in y.tolist()]})
    trained_epochs = base_epochs + best_epoch
    doc = export(layers, skip_layers, sizes, fan_ins, topology, trained_epochs, probes)
    doc['training'] = {'bestValCe':best_ce, 'bestChunkEpoch':best_epoch,
                       'seconds':time.time()-t0, 'targets':len(rows)}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    tmp = f'{args.out}.tmp-{os.getpid()}'
    with open(tmp, 'w') as fh: json.dump(doc, fh)
    os.replace(tmp, args.out)
    params = sum(p.numel() for p in model.parameters())
    print(f'saved {args.out}: {params:,} params, lifetime peak epoch {trained_epochs}, val ce {best_ce:.5f}')
    print(f'NOW VERIFY: node nn/verify-joint-policy-export.js {args.out}')


if __name__ == '__main__':
    main()
