# User-supplied live-ladder snapshot

Historical readout pasted during the `/depth` request in this review thread.
The paste is not a fresh API fetch and its exact capture time was not supplied.
Use it to understand the request, not as today's live standings.

| Readout | Value |
| --- | ---: |
| Rated games | 19,562 |
| Two-game matches | 9,781 |
| Live model faces | 73 |
| Model files | 52 |
| Immortal ladder brains | 10: five rungs plus corner-opening faces from L7 |
| D1 seats / retired | 42 / 1,016 |
| D2 seats / retired | 19 / 793 |
| D3 seats / retired | 7 / 434 |
| D4 seats / retired | 5 / 142 |
| Live dual trunks | 6 |
| Cull bank | 49 |

The header also read “0 / 0 D1 / D2 zero” and “5 D3 measured”; the pasted
format does not define those counters, so no additional meaning is assigned
here. It showed “connecting…” and live/all-history filters. The readout said
cull pressure was still weighted by search cost.

Faces included value models, dual and dual+policy variants, committees and
immortal L7–L11 anchors. Recent results reported 1–1 as a draw and 2–0 or 0–2
as a match win, reinforcing the need to distinguish game and match counts.
The flattened paste is unsuitable for reconstructing every rating/CI column.

The user's point was substantive: this larger evolving self-play league is
evidence the depth explainer should use. It should be interpreted with opponent
mix, search cost, sample size and uncertainty, rather than omitted or conflated
with older fixed-rung tournaments. Model labels and high placement alone do not
establish an absolute strategic ceiling.
