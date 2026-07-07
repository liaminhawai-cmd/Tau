# Tau — business to-do

Tick things off here on github.com (the checkboxes are clickable in the file view's edit mode, or
just edit the file). A Claude Project connected to this repo can read this file, so the Project
chat always knows where things stand. Keep it ruthless: delete lines that stop mattering.

## Now (blockers & five-minute wins)
- [✔] **Supabase SQL**: run section **9** (waitlist — now with `interest`) and section **10**
      (save_count / most-watched) from `WebPrototype/server/apply_to_live_db.sql`.
- [ ] **Fix username sign-up**: Supabase rejects the synthetic `@tau-game.com` emails because the
      domain has no MX record. Cheapest fix: Cloudflare → tau-game.com → Email → **enable Email
      Routing** (adds MX records, ~2 clicks, free). Then re-test username+password sign-up.
- [✔] **Auth settings**: Supabase → Auth → Sign In / Up → turn **"Confirm email" OFF** (username
      accounts can't confirm; magic links still verify by their nature).
- [ ] **Custom SMTP**: the built-in mailer is capped at **2 emails/hour** — that's the "rate limit
      exceeded" you hit. Point Supabase at Resend/Postmark/SES (free tiers are fine) and raise the
      email rate limit. Until then magic links are effectively broken for real traffic.
- [ ] **Raise anonymous sign-in limit** (30/h per IP): a school/office/CGNAT crowd shares one IP.
      100/h is safer for a launch spike.

## Seed & polish (before any public post)
- [✔] Get ~10 friends to sign in and play ranked so the lobby isn't a ghost town.
- [ ] Save/share a few good games so Watch has content at 3am (cold-open insurance).
- [ ] Print the **test coupons** (`physical/out_cad/tau_coupon_seam*_dt.stl` + `tau_coupon_foot_*.stl`)
      — lean-test the dovetail, press-fit a 5×2 magnet, check board grip.
- [ ] Confirm build number bottom-left of tau-game.com matches the latest push after each deploy.

## Launch (week 1 — order matters)
- [ ] Cinema mode (clean UI-less capture from a share link) → record the hero clip (9:16 + 16:9).
- [ ] itch.io page (permanent shelf) — cover, clip, 3 screenshots.
- [ ] Reddit, one sub/day: r/WebGames, r/playmygame, r/boardgames (designer story), r/tabletopgamedesign.
- [ ] Show HN — lead the first comment with the determinism decision.
- [ ] BoardGameGeek thread (Abstract Games forum).
- [ ] Steam "Coming Soon" page → start banking wishlists.

## Martial-arts angle (week 2+)
- [ ] List 5 analytical BJJ/judo/sumo creators (10k–80k subs). Warm each for a week (real comments).
- [ ] 4-sentence DM template (see `docs/handover/04_gtm_playbook.md`), send in one batch.
- [ ] Mail printed sets to the top 3 gyms with a handwritten note.

## Physical product
- [ ] Decide final rim chunkiness after holding a printed segment (lean Ø283×7 is current; the
      original chunky was Ø297.5×15 — combo dovetail+magnet joints need a chunkier wall).
- [ ] Get 2 quotes for the steel disk (spec: **ferritic 430 or powder-coated mild steel — must be
      ferromagnetic**, rolled/radiused edge, UV-printed rings). Test with a magnet on receipt.
- [ ] Pick box mode per SKU: assembled hatbox (267) vs flat-pack (400) — dielines in `physical/`.
- [ ] Waitlist export when >20 names: `select email, interest, lang, created_at from public.waitlist
      order by created_at;` → CSV.

## Later / parked
- [ ] Server-side move validation (only if cheating appears).
- [ ] Steam deluxe: campaign puzzles, environments (dojo/dohyō), wood+metal and glass skins.
- [ ] "Most watched" row needs data — nudge sharing until save_count accumulates.
- [ ] Larger-board touch option in the web game (~30% bigger) for fat fingers.
