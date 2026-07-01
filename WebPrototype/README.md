# Tau — Browser Prototype

A self-contained, playable prototype of Tau. Single file, no build step, no
server needed — just open `tau.html` in a browser (desktop or mobile).

## Controls

1. Tap one of your feet to lock it as the pivot (a curved yellow arrow shows
   the two swing directions).
2. Drag a different foot (ringed in white) around the pivot to rotate the
   piece. Release to end your turn.
3. Push your opponent's piece by swinging into it — contact is solid and
   rotates the opponent based on leverage, per their weight distribution.
4. You may only cross one board line per turn (rings + the two side arcs all
   count); a foot that starts on a line may leave it once for free.
5. Win when any of your opponent's feet cross the outer edge. The loser
   slides off the frictionless rim and tumbles off the table.

Toggle the "3D: on" button for a live, camera-orbitable 3D side view (drag to
rotate, scroll/pinch to zoom) synced to the 2D board.

## Status / what's modelled

- Board geometry (rings + side arcs) and the six starting foot positions are
  taken directly from the project's `Bord.dxf` / `board design.pdf`.
- The piece is an equilateral tripod matching `tripod smoove 2021.stl`
  (46.19mm hub-to-foot on the real board, scaled into board units).
- Board scale: edge radius 73.333 units = 266.7mm physical board
  (1 unit ≈ 1.818mm).
- Collision is 2D top-down (straight hub→foot legs) with position-based
  contact resolution — solid contact, no pass-through.
- This is a prototype for testing rules and feel, not a finished game: no
  AI opponent, no online play, no persistence.
