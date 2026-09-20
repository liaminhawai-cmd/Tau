# A replicated geometric enrichment for dead positions

**What this is:** a region of pose space where certified-dead positions occur 2.57x more
often than outside it. **What it is not:** a dead region. Forty percent of positions
inside it are not dead, so nothing here is certified by the region alone.

## The region

Two features of `nn/features.js`, computed with the side to move as `me`:

```
victim middle-foot radius  in [0.807, 0.822] * edgeU  =  53.8 .. 54.8 u
victim rotation phase sin  in [-0.379, 0.084]
```

The first is the load-bearing one and it is geometric, not abstract: the outer printed
ring is at **53.3u**, so this is the victim's middle foot sitting **0.5 to 1.5u outside
that ring**. `maxCrossingsPerTurn` is 1, so a foot just past a line has already spent or
is about to spend the turn's crossing budget, which constrains which swings are available
— a mechanism, not just a correlation.

## How it was found, and how much of the first number was real

Fitted by searching axis-aligned boxes over ten candidate features on the 1,306 screened
positions in this directory (261 dead, 1,045 not). The best box scored **74.4% purity
against a 20.0% base rate**.

**That number was inflated by the search** — it is a maximum over thousands of candidate
boxes on 1,306 points, reported without correction. Two independent honest estimates:

| estimate | method | purity | lift |
| --- | --- | --- | --- |
| fitted | best of ~thousands of boxes | 74.4% | 3.72x |
| split-half, 20 repeats | fit on half the corpus, score on the other half | 50.5% | 2.53x |
| **held out, powered** | **fresh seeds never in the corpus** | **59.6%** | **2.57x** |

The two honest estimates agree closely (2.53x and 2.57x) and both are well below the
fitted figure. Roughly a third of the original effect was search bias.

## The held-out test

6,533 fresh seeds mined with `nn/dead-seeds.js` from `nn/data` on a different shuffle
seed, same provenance as the corpus (k=0, one loser-move before a throw). 182 overlapped
the existing corpus and were dropped, leaving 6,351 genuinely held out. 203 fell inside
the region; 203 outside were sampled at random as a control. Every one was put through
the same `deadCertificate` the corpus used.

```
INSIDE  the region: 121/203 dead = 59.6%   95% CI [52.9%, 66.4%]
OUTSIDE            :  47/203 dead = 23.2%   95% CI [17.4%, 29.0%]
difference +36.5 points, lift 2.57x, z = 7.46, two-tailed p = 8.9e-14
```

An earlier underpowered version of this test (7/16 vs 16/60) gave 1.64x at p = 0.19 and
was not informative; n=16 could not resolve the effect.

A separate test on **uniformly random legal positions** found 1/40 inside and 0/40
outside. That is not a contradiction — random positions are dead at about 1%, so the base
rate collapses and the test has no power. It does independently corroborate that dead
positions are rare and concentrated.

## What it is good for

- **Mining.** 2.57x the hit rate. A dead-position batch that screens inside the region
  first finds certified positions for roughly a third of the compute.
- **A pointer for the maths.** The mechanism — middle foot just outside a printed ring,
  crossing budget spent — is a statement about the rules, not about this dataset. Whether
  there is a provable sub-region inside it is open, and is the kind of question Brief 5's
  region criterion was written for.

## What it is not good for

It is not a certificate and must not be cited as one. Inside the region, two positions in
five are not dead. The 261-point corpus remains 261 isolated needles (nearest same-mover
pair 5.57u apart against a 0.35u largest certified radius); this enrichment does not
change that and does not enlarge the certified set by a single position.

## Reproducing

```
node nn/dead-seeds.js nn/data /tmp/seeds.jsonl 1200 6 0 <fresh-seed>
node /tmp/heldout-test.js          # featurise, split by the region, certify both arms
```
