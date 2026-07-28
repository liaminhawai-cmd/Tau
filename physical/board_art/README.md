# Tau board print art

Vector files of the printed board face, in both colourways (Slate, Dojo) and both physical sizes
(267mm, 400mm). Generated from `physical/gen_board_art.py`, which reads the exact geometry and
colour values out of `index.html` (`CFG`, `SLATE_SKIN`, `DOJO_SKIN`) — not redrawn by hand, not
approximated. Verified against a live screenshot of the shipped game; ring/arc positions, zone
shading and the six start dots line up exactly.

## Where the colours came from

Straight answer: **not matched to your sticker.** Slate and Dojo were two of several palette
proposals from the in-game colour lab (build 49) — I designed them, they were never compared
against your sticker's actual values, because I never had those values. You said you prefer these
to the sticker, so these files reproduce *this* palette exactly (see the hex table below), not a
blend of the two.

## Files

| File | What it is |
|---|---|
| `tau_board_<sku>_<skin>.dxf` | Vector outline, opens in AutoCAD/BricsCAD/LibreCAD/Fusion/most vinyl-cutter software. Layers: OUTLINE, ZONE_V1-V4, LINES, DOTS_BLUE, DOTS_RED. |
| `tau_board_<sku>_<skin>_RGB.pdf` | Print-ready PDF, colours as the exact screen values (sRGB). |
| `tau_board_<sku>_<skin>_CMYK.pdf` | Same artwork, converted to CMYK for a traditional 4-colour press quote. |

`<sku>` is `267` or `400` (mm, matching the two sizes in `physical/tau_cad.py`). `<skin>` is
`slate` or `dojo`.

**On DWG specifically:** true `.dwg` is a closed Autodesk binary format with no legitimate open
writer — DXF is the actual universal interchange format; every CAD tool reads it identically to a
native file, and if a print/cut shop insists on literal `.dwg`, opening the DXF in AutoCAD (or the
free BricsCAD/LibreCAD) and doing Save As → DWG takes one click. I'd send the DXF first and only
convert if someone specifically can't take it.

## Real dimensions

Verified by reopening the exported files, not just computed:

| SKU | Diameter |
|---|---|
| 267mm | 266.67mm |
| 400mm | 399.95mm |

(Both within 0.05mm of the nominal target — floating-point rounding, not a scale error.)

## Colour values

| Zone | Slate | Dojo |
|---|---|---|
| v4 (centre) | `#5a636c` | `#e9d9b3` |
| v3 | `#4b535b` | `#ddc99b` |
| v2 | `#3c434a` | `#cbb47e` |
| v1 (lens, darkest) | `#2f353b` | `#b89a62` |
| Lines | `#12161a` | `#3a2f22` |
| Blue start dots | `#5487c4` | `#243f78` |
| Red start dots | `#d05a48` | `#cf3b26` |

## Print vs. screen — why they won't look identical off the bat, and how to close the gap

You're right to flag this separately; it's a real effect, not a maybe.

**Why they differ at all.** A screen is self-luminous — it emits light directly at you, so it can
render saturated colour and true black regardless of the room. A printed sticker is reflective —
it only shows you whatever light bounces off it, filtered through ink. Same hex values, physically
different mechanism. Some gap between screen and print is unavoidable; the question is how much,
and how to shrink it.

**RGB vs. CMYK — pick based on who's printing it, not by default.** Traditional offset/litho press
printing is CMYK, and CMYK's gamut is smaller than a screen's, especially in exactly the ranges
Tau uses: saturated blues (Slate) and warm oranges/tans (Dojo) are two of the colour families that
shift most in a naive conversion — usually duller, sometimes visibly greyer. But most board-game
stickers and decals aren't printed on an offset press — they go through a large-format inkjet at a
local sign/vinyl shop or a print-on-demand decal service, and those often run on RGB input with a
wider ink set (6-8 colours, not 4), holding saturation much closer to the screen. **Ask whoever's
printing it which they want before picking a file** — if they take RGB, use the RGB PDF; it'll be
the closer match. The CMYK PDF here is a reasoned conversion, not a proof — no conversion is
trustworthy until you've seen it under real ink.

**How to actually make the printed board look like the game — the concrete steps:**

1. **Get a physical proof before committing to a full run.** One test sticker, compared to the
   screen. This single step catches more than any amount of colour-theory guessing.
2. **Compare them under the same light you'll actually play under**, not a phone screen in a dark
   room next to a sticker under office fluorescents. Viewing conditions alone can swing the
   perceived match more than the file's colour values do.
3. **If the proof looks flatter/duller than the screen** (the common CMYK outcome): the fix is a
   deliberate 5-15% saturation boost in the source file before the *next* print, not a literal
   conversion — ink physically can't hit screen-level punch at 1:1, so slightly over-saturating the
   file compensates. Say the word and I'll generate a boosted CMYK variant if you go this route.
4. **Finish/laminate matters as much as the ink.** Gloss or satin vinyl reads noticeably richer and
   closer to a glowing screen than matte, which will always look chalkier by comparison however
   accurate the underlying colour is. If "looks like the game" (vibrant) is the goal over
   "looks like a paper print" (muted), lead with a gloss or satin finish.
5. **Check your own screen isn't lying to you.** Plenty of phone and laptop displays oversaturate
   by default, which makes *any* accurate print look disappointing next to it purely from the
   comparison, not from the print being wrong.

**One more manufacturing path, separate from all of the above:** if a future premium version is a
painted or dyed physical board rather than a printed sticker, that's a different pipeline entirely
— colour-matched with a physical Pantone/RAL chip against the moulder or painter's actual pigment,
not from a PDF at all. Worth knowing which path applies before ordering paint to match these files.

## Regenerating

`python3 physical/gen_board_art.py` (needs `shapely`, `ezdxf`, `reportlab`) rebuilds all 12 files
from the current `index.html` geometry/colours. Re-run it any time the digital board's colours or
ring/arc layout change, so the print files never drift out of sync with the shipped game.
