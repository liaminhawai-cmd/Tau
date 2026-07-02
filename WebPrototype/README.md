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

On open, pick a mode from the menu: **Local 1v1** (pass-and-play), **vs AI**
(see below), or **Online** (see "Online accounts" below). "Menu" returns to
this screen at any time; "Reset" replays the same mode.

Toggle the "3D: on" button for a live, camera-orbitable 3D side view (drag to
rotate, scroll/pinch to zoom) synced to the 2D board. Toggle "Auto cam: on"
to have the camera frame both pieces automatically — it stays exactly
equidistant from both piece centres and keeps the whole board in view,
zooming out only as far as needed.

## The AI opponent

Deliberately dumb — one fixed rule, no lookahead, no evaluation:

- If the AI is currently closer to the board centre than you are, it goes on
  **offense**: pins the foot second-furthest from your piece, and swings the
  foot furthest from your piece toward you, as far as the rules allow.
- Otherwise (it's further from the centre than you) it plays **defense**:
  pins the foot second-furthest from the centre, and swings the foot furthest
  from the centre back toward the centre, as far as the rules allow.

"As far as the rules allow" means it keeps swinging that one direction until
the line-crossing limit stops it — it doesn't look for a better stopping
point along the way.

## Online accounts (in progress)

Backed by a free [Supabase](https://supabase.com) project (Postgres +
auth + realtime) rather than a custom server — one service to host
instead of a database and a relay separately.

To enable it on your own deployment:
1. Create a free Supabase project, then run `server/schema.sql` once in its
   SQL Editor — this creates the `profiles` table (username, ELO rating,
   wins/losses) and a trigger that gives every new signed-up user a profile
   automatically, with rating columns locked so only server-side logic (added
   in a later chunk) can change them.
2. In `tau.html`, fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` near the
   bottom of the file with your project's values (Project Settings → API).
   Both are safe to embed in client code — access is controlled by the
   database's row/column policies in `schema.sql`, not by hiding that key.

Currently working: email magic-link sign-in, and an auto-created profile
with a starting rating of 1200. Matchmaking, live move sync, and ELO
updates on match results are the next chunks — until then "Find match" is a
placeholder. Without the two config values filled in, the Online panel says
so and the rest of the game is completely unaffected (no network calls are
made unless you open that panel).

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
- Ring/arc line width is proportional to the board (measured off the design
  photo: ~0.79% of the edge radius), matching the printed board at any zoom.
- This is a prototype for testing rules and feel, not a finished game: the AI
  is a simple fixed heuristic (see above), and online play is still being
  built out (see "Online accounts").
