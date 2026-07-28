# Tau — product overview

## What it is
Tau is a **browser-based digital adaptation of a physical tabletop balance game**. Each player
controls one rigid piece that stands on **three feet** (a tripod). You pin one foot, swing the other
two around it, and shove your opponent's piece until one of their feet **slides off the edge** of the
circular board — a sumo-style ring-out. It's a two-player abstract strategy game with real,
physics-driven pushing.

It's designed to be zero-friction: **no download, no signup required** to play the AI or a local
friend. It's a single self-contained web page.

## The rules (whole rulebook)
- Each piece has three feet arranged as a tripod. On your turn you **pick one foot as a pivot**, pin
  it, and **swing the other two feet** in an arc around it.
- The board has concentric rings/lines. **You may cross only ONE line per turn.** That single
  constraint is the entire strategic depth — angles change every swing, so leverage is everything.
- When your swing brings your piece into the opponent, you **physically push them** across the board.
- You **lose** if any of your feet slides off the outer edge. (Digitally, the beaten piece then
  topples off — a visual flourish; the *skill* is the slide to the edge, not a tumble.)
- You must not end a turn resting on a line, and there are grace/contact rules mirrored from the
  physical magnets — see the technical doc for the exact state machine.

## Current state (build 53)
- **Live** at `tau-game.com` (custom domain, Cloudflare DNS, GitHub Pages).
- Modes: **vs AI** (5 difficulty tiers), **Local 1v1** (pass-and-play), **Online 1v1** (ranked
  matchmaking with ELO), **Private match** (invite code, unranked), **Watch** (spectate live games +
  browse finished-game replays), **post-game replay**, and **shareable replay links**.
- Accounts: Google sign-in, username/password, one-time email link, and **guest** (anonymous) play.
  Guests get a friendly auto-generated handle (e.g. *BigJumpingFish*) and a real leaderboard spot.
- Languages: **10** — English, Japanese, Simplified & Traditional Chinese, Korean, German, French,
  Spanish, Portuguese, Russian — auto-detected from device, subtle 🌐 corner toggle.
- **Board skins:** four, cycled by the ☀ button darkest→lightest and looping — Dark (default for
  dark-mode devices), Slate, Dojo (warm sand), Yellow (default for light-mode devices). Choice
  persists locally.
- **Replay:** cinematic pacing (arc-fraction blend of true timing + eased curve), audio for both
  players, in-replay Share / Skip, and a never-a-dead-end Watch menu (Live now, Most recent,
  Top-rated, Most watched, My replays, Watch another).
- **Physical game waitlist:** menu line → email modal capturing interest in free DIY print-and-play
  files and/or the full shipped kit.
- iOS safe-area aware (nothing hides behind the notch / status bar).
- Installable as a **PWA** (works offline for single-player).
- The build number shows faintly in the bottom-left corner ("build 53") — used to confirm which
  version is actually live after a deploy.

## Hosting / infra at a glance
- **Repo:** `liaminhawai-cmd/Tau` (public). Served by **GitHub Pages** from branch
  `claude/board-game-video-adaptation-cf8a93` (Pages "deploy from a branch").
- **Domain:** `tau-game.com`, bought via Cloudflare; DNS-only (grey cloud) pointing at GitHub Pages.
- **Backend:** Supabase (Postgres + Auth + Realtime). See `03_backend_and_sql.md`.
- **Deploys:** pushing to the branch triggers GitHub's "pages build and deployment". If the site
  looks stale after a push, the deploy step occasionally fails transiently ("Deployment failed, try
  again later") — re-running that workflow fixes it; the code was fine.
