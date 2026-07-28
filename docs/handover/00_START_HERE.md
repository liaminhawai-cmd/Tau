# Tau — Claude Project handover pack

This folder is meant to be uploaded into a **Claude Project** (claude.ai → Projects → your
project → Project knowledge) so that every chat inside it already understands Tau without you
re-explaining. Upload all the `.md` files here.

## What each file is
- `00_START_HERE.md` — this file. How to set up the Project + custom-instructions text to paste.
- `01_product_overview.md` — what Tau is, the rules, current state, where it's hosted.
- `02_technical_architecture.md` — how the game is built (single-file HTML, 3D, replay, AI, physics).
- `03_backend_and_sql.md` — Supabase schema, RPCs, ELO, and what SQL has/should be applied.
- `04_gtm_playbook.md` — the launch playbook (marketing, martial-arts angle, physical product, Steam).
- `05_backlog_and_open_threads.md` — what's pending, known limitations, next builds.

## Paste this into the Project's "Custom instructions"
> You are my strategy and product partner for **Tau**, a browser-based digital adaptation of a
> physical tripod-piece balance board game (live at tau-game.com). The project knowledge has the
> full product, technical, backend, and go-to-market context — use it. When I ask for marketing,
> outreach, pricing, or business decisions, be concrete and opinionated, give a recommendation
> rather than a menu of options, and keep the physical-game origin and the sumo/kuzushi angle in
> mind. Correct me when I'm wrong. Anything that needs code, SQL, packaging dielines, or file
> output, remind me to do it in Claude Code (the repo agent), not here.

## Claude Project vs Claude Code — which to use for what
Short version: **use both.** They're different tools.

- **Claude Code** (the repo/terminal agent that built the game) is where anything touching **files**
  happens: the game itself, SQL, the replay tuner, packaging **dielines (SVG)**, a **pricing
  calculator (HTML)**, costing spreadsheets. It can read the live repo, so it always has the *code*
  context — but a fresh session starts cold and re-derives from the repo; it doesn't carry strategy,
  brand voice, or "why we decided X" between sessions.
- **A Claude Project** is your **portable business brain**. It's reachable from your phone or the car,
  it persistently *remembers* this uploaded brief across every chat, and it's the right place for
  non-code work: marketing copy, outreach drafts, pricing thinking, naming, "should I do X"
  decisions when you're away from the desk.

Rule of thumb: **build deliverables in Claude Code; think and decide in the Project.** Artifacts made
in Claude Code (pricing model, dielines, this pack) get uploaded back into the Project as it evolves,
so the two stay in sync through you.
