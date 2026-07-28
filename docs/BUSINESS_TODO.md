# Tau — to-do

Organised by **who does it**: 🤖 **Claude Code** (me, in the repo), 🧑 **You** (dashboards, physical,
outreach, decisions), 💬 **Project chat** (strategy, copy, research). Within each: **Now / Soon /
Later**. Tick a box by editing the file on github.com. A Claude Project connected to this repo can
read this file, so the Project chat always sees current state. Keep it ruthless — delete dead lines.

---

## 🤖 Claude Code (tell me and I'll do it)

**Now**
- [ ] **Username sign-up domain**: decide with me — switch the synthetic `@example.com` (reserved,
      often rejected) to `@tau-game.com` for NEW accounts (old logins keep working), or drop
      username sign-up and lean on Google + magic link. Waiting on your call (see your list).

**Soon**
- [✔] **Corner-cut glitch FIXED (build 62)**: a swing could chain ring + arc into one crossing by
      bridging the magnet bands near their corner (~0.85u off the point) — your "impossible game"
      replay re-simulated through the fixed engine now blocks both turns. A second line can join a
      crossing only by genuinely jumping the marked intersection (magnet on the point, ≤0.45u).
      Retest on the live site once the tag says 62 — both turn orders should now be equally blocked.
- [ ] **Tripod piece CAD**: regenerate the playing piece with a foot magnet pocket bored to a stock
      magnet + a fillet on the fragile ankle joints (finishes the physical set alongside the rim).
- [ ] **Cinema mode**: clean, UI-less render driven by a share link (the trailer pipeline) — build
      before the short-form video push.
- [ ] **Verify set-a-password** end to end once you've tested it live (built in build 59).

**Later**
- [ ] `security.txt` at `/.well-known/` (pick a contact email and I'll add it — 30 sec).
- [ ] Server-side move validation (only if cheating shows up).
- [ ] Larger-board touch option in the web game (~30% bigger) for fat fingers.
- [ ] Steam deluxe skins (antique wood + metal, glass/translucent) — needs a PBR upgrade.
- [ ] "Most watched" list fills in on its own once shared games accumulate `save_count`.

---

## 🧑 You (dashboards, physical, decisions)

**Now**
- [✔] **Custom SMTP** — Resend working. (Magic links + confirmations now send.)
- [ ] **Cloudflare Email Routing**: enable it so `contact@tau-game.com` forwards to your Gmail —
      needed for the Gmail "send as" verification below, and for branded inbound mail.
- [ ] **Gmail "Send mail as" `contact@tau-game.com`** (steps in chat) — reply to creators/waitlist
      from the branded address.
- [ ] **Raise anonymous sign-in limit** 30/h → ~100/h (Supabase → Auth → Rate limits): one shared
      IP (gym/office/campus) shouldn't lock everyone out.
- [ ] **Decide username sign-up** approach and tell me (the 🤖 Now item).
- [✔] Supabase SQL sections 9 (waitlist) + 10 (save_count).
- [✔] Supabase Auth → "Confirm email" OFF.

**Soon**
- [ ] Save/share a few good games so Watch isn't empty at 3am (cold-open insurance).
- [ ] Print the **test coupons** (`physical/out_cad/tau_coupon_seam*_dt.stl` + `tau_coupon_foot_*.stl`):
      lean-test the dovetail, press-fit a 5×2 magnet, check grip on a steel board.
- [ ] After holding a printed segment, decide **rim chunkiness** (lean Ø283×7 now; original chunky
      Ø297.5×15; a combo dovetail+magnet joint needs the chunkier wall) — then tell me.
- [ ] Get **2 quotes for the steel disk**: ferritic 430 or powder-coated mild steel (**must be
      ferromagnetic**), rolled/radiused edge, UV-printed rings. Magnet-test on receipt.
- [ ] Pick box mode per SKU: assembled hatbox (267) vs flat-pack (400) — dielines in `physical/`.
- [✔] ~10 friends seeded on the ranked ladder.

**Later**
- [ ] Cloudflare **Bot Fight Mode** on (Security → Settings) — cuts junk bot traffic, one toggle.
- [ ] Export waitlist when >20 names: `select email, interest, lang, created_at from public.waitlist
      order by created_at;` → Download CSV.
- [ ] Confirm the build tag (bottom-left of tau-game.com) matches the latest push after each deploy.

**Launch week (you post; Project chat drafts the copy)**
- [ ] itch.io page live · [ ] Reddit one sub/day · [ ] Show HN · [ ] BoardGameGeek thread ·
      [ ] Steam "Coming Soon" page · [ ] Mail printed sets to 3 gyms.

---

## 💬 Project chat (strategy, copy, research)

**Soon**
- [ ] Draft the **launch copy**: itch.io store text + 3 screenshot picks, Reddit posts (per sub),
      Show HN title + first comment (determinism angle), BGG thread.
- [ ] **Hero clip** storyboard/script (15–25s, ends on the ring-out; vertical + landscape).
- [ ] **Martial-arts outreach**: shortlist 5 analytical BJJ/judo/sumo creators (10k–80k), + the
      4-sentence DM template (see `docs/handover/04_gtm_playbook.md`).
- [ ] Steam "Coming Soon" page copy + capsule concept.

**Later**
- [ ] Steam deluxe scope & design direction (campaign puzzles, environments, premium skins).
- [ ] Ongoing GTM sequencing / channel-by-channel review as real numbers come in.
