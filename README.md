# Tau proof-research slice for Copilot

This branch is an intentionally small proof-work snapshot, not the full Tau repository.

Start with the separate file supplied by the user:
COPILOT_MATH_HANDOFF.txt

Then read:
- docs/geometry-reviews/solving-tau-roadmap.md
- docs/geometry-reviews/response-cover-proof-status.md
- nn/contact-law.js
- nn/throw-cert.js
- nn/response-cover.js
- nn/engine.js
- index.html

Included:
- exact shipped game source (index.html)
- exact Node engine extractor
- contact-law ideal/REPLICA implementation
- forced-win / response-cover / rigorous certificate code
- focused collision audits, especially hubV and mixed-contact predecessors
- current proof roadmap/status and the current family-cover artifact

Excluded:
- neural-network training data/checkpoints
- self-play/trainer machinery
- Unity assets
- WebPrototype/server/application material
- large mined corpora unrelated to the current geometry proof

The purpose is to let an AI agent spend its context and compute on the mathematics rather than loading the entire game project.