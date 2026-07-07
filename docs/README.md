# Tau — reference docs

Curated, human-readable context for the Tau project. Safe to point a Claude Project (or any teammate)
at this folder — it's the "what is this and where does everything live" pack.

## Handover pack (`handover/`)
Read in order:
1. **00_START_HERE.md** — orientation.
2. **01_product_overview.md** — what Tau is, the whole rulebook, current live state (build 53).
3. **02_technical_architecture.md** — single-file game, inlined Three.js, how the pieces fit.
4. **03_backend_and_sql.md** — Supabase schema, RPCs, ELO, and *what SQL has been applied*.
5. **04_gtm_playbook.md** — launch plan, martial-arts angle, colourway decisions.
6. **05_backlog_and_open_threads.md** — what's shipped, in flight, and deferred.
7. **06_morning_report.md** — a point-in-time status snapshot.

Keep the "what SQL has been applied" section in `03` and the build number in `01` current — those go
stale fastest.

## Physical game (`../physical/`)
- **make_box.py** — parametric dieline generator (pure Python stdlib; `python make_box.py`).
- **tau_box_dieline.svg** / **tau_insert_tray.svg** — the generated print-true dielines (1 unit = 1 mm).
- **tau_cost_model_v2.1.html** — open in a browser; interactive unit-cost / margin calculator.

Confirmed base footprint (from `chunky.stl`): **297.5 × 277.5 × 15 mm**, disk recessed in the base.
