# Tau — Browser Prototype

A self-contained, playable prototype of Tau. Single file, no build step, no
server needed — just open `tau.html` in a browser (desktop or mobile).

## Controls

1. Tap one of your feet to lock it as the pivot (a curved yellow arrow shows
   the two swing directions).
2. Drag a different foot (ringed in white) around the pivot to rotate the
   piece. Release to end your turn.
3. Push your opponent's piece by swinging into it — contact is true 3D:
   the curved legs only push each other where the tubes actually touch, so a
   low foot really can slip under the high part of an opposing leg. Where they
   do touch, the push rotates the opponent based on leverage.
4. You may only cross one board line per turn (the two rings + the two side
   arcs all count); a foot that starts on a line may leave it once for free.
5. Win when any of your opponent's feet cross the outer edge. The loser
   slides off the frictionless rim and tumbles off the table.

Toggle the "3D: on" button for a live, camera-orbitable 3D side view (drag to
rotate, scroll/pinch to zoom) synced to the 2D board.

## Status / what's modelled

- Board geometry is taken from `Bord.dxf` cross-checked against the board
  design render: the playing surface ends (drop-off) at r=66.667 units with
  no line there; the two rings sit at exactly 0.60 and 0.80 of the edge
  (r=40 / 53.3); the side lens arcs (r=40) are centred on the rim and run
  rim-to-rim.
- Scale: 1 unit = 2.0mm → 266.67mm board (matches `Metal base 266.666.stl`).
- The piece is an equilateral tripod matching `tripod smoove 2021.stl`:
  hub→foot 46.19mm = 23.095 units, quarter-circle arc legs.
- Start positions: each piece's feet sit on the six printed dots — front foot
  toward the centre, the two back feet exactly halfway between the two rings.
- Collision is true 3D: each leg is the same quarter-circle arc tube the 3D
  view renders (sampled as a polyline), with 3D closest-distance contact and
  position-based resolution in the board plane. Legs pass over/under each
  other when there is real clearance and push only on actual touch.
- This is a prototype for testing rules and feel, not a finished game: no
  AI opponent, no online play, no persistence.
