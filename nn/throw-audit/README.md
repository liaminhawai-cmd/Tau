# Audit scripts for the throw checker's contact lemmas

Four checks written to test an outside review of the lemmas in
`../THROW-CONTACT-LEMMAS.md`. Section 7 of that file is the verdict; these are
the evidence. All four reproduce in under a second.

`POSE` is a six-number pose, `x,y,rot,x,y,rot`. The one used throughout is the
certified dead point `ndpxhts24`:

    POSE=-24.311269,-37.347993,1.344826,-11.759300,-23.283800,2.944200

| script | what it answers | uses POSE |
| --- | --- | --- |
| `tied-contact-counterexample.js` | Does the review's tied-interior-contact example reproduce against our engine? | no |
| `tied-contact-branches.js` | Does `analyse()` keep both tied branches, or prune one away? | no |
| `crossing-chord-data.js` | Which chord pair holds the closest contact at each substep? | yes |
| `overshoot-bound.js` | Is the finite-rotation overshoot bound actually respected? | yes |
| `vertex-park.js` | Does the victim's contact point transit the phi=30 vertex, or park on it? | yes |

`vertex-park.js` settles the other correction: the victim's contact arc angle is
30.000000 degrees exactly from substep 74 through the throw at 84 and beyond, so
what the tracer called a third crossing is an index flip during a dwell.

`overshoot-bound.js` is the one that found a real error. It deliberately keeps the old
`eta = R(1 - cos eps) + R(eps - sin eps)` inline so it can report how often the
engine beats it: 75 of 138 substeps, from the first chord-vertex crossing on.
