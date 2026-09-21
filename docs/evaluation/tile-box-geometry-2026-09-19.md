# Tile-box geometry — the primary reader emits a synthetic grid

**Measured 2026-09-19 against the committed `gpt-4.1` recordings in
`tests/fixtures/golden/llm/gpt-4.1/`. No live spend.**

## The finding

The primary reader's `box` output is **not a measurement**. It is a generated
uniform grid. Across all eleven golden images, every tile on an image has an
**identical width**, and the `x` values form a **perfect arithmetic
progression** that wraps into rows.

| Image | n | box `w` (min / med / max) |
| --- | --- | --- |
| `low-quality-jpeg-01` | 7 | 0.308 / 0.308 / 0.308 |
| `max-saved-desktop-01` | 6 | 0.234 / 0.234 / 0.234 |
| `max-saved-mobile-01` | 6 | 0.372 / 0.372 / 0.372 |
| `netflix-artwork-only-01` | 10 | 0.181 / 0.181 / 0.181 |
| `netflix-continue-watching-01` | 1 | 0.282 / 0.282 / 0.282 |
| `netflix-mylist-desktop-01` | 10 | 0.170 / 0.170 / 0.170 |
| `netflix-mylist-mobile-01` | 7 | 0.290 / 0.290 / 0.290 |
| `netflix-mylist-mobile-02` | 8 | 0.320 / 0.320 / 0.320 |
| `rotated-01` | 6 | 0.143 / 0.143 / 0.143 |
| `truncated-titles-01` | 4 | 0.380 / 0.380 / 0.380 |

Ten images, ten times `min == med == max`.

⚠ **Corrected 2026-09-20 — this table is true but is WEAK evidence on its own.**
Real streaming grids genuinely do render every tile at an identical width, so
uniformity is equally consistent with an accurate reading of a uniform grid.
It does not by itself show the boxes are generated. The claim survives on the
two arguments below — the off-image box, and now direct comparison against
measured ground truth (`tests/fixtures/golden/tiles/`, recorded in
[`tile-geometry-2026-09-20.md`](./tile-geometry-2026-09-20.md)), which shows
**24 of 46 box centres miss the tile they name**, by up to 2.3 tiles, on
layouts whose real pitch differs from the model's.

~~Real artwork tiles are not all exactly equal to three decimal places.~~

The positions confirm it:

```
netflix-mylist-desktop-01  x: 0.044 0.217 0.390 0.563 0.736 0.909 0.044 0.217 0.390 0.563
                           y: 0.312 0.312 0.312 0.312 0.312 0.312 0.507 0.507 0.507 0.507
max-saved-desktop-01       x: 0.025 0.265 0.505 0.745 0.025 0.265
netflix-artwork-only-01    x: 0.058 0.247 0.436 0.625 0.814 1.000 0.058 0.247 0.436 0.625
```

Constant steps — 0.173, 0.240, 0.189 — resetting to the first column on a new
row.

⚠ **The decisive one: `netflix-artwork-only-01`'s sixth box is at `x = 1.000`
with `w = 0.181`, so it ends at 1.181 — entirely off the right edge of the
image.** No observation can place a tile outside the picture. The generator
simply ran past the edge of its own grid.

This corroborates, corpus-wide and for the production model, what TASK-290
recorded from a single Disney+ capture: *"the model emitted a plainly synthetic
uniform grid of tile boxes — x correct, y shifted down and stretched."* It was
treated then as one bad capture. It is the model's normal behaviour.

## Why it reaches the owner

`tileCropFor` (`packages/domain/src/review.ts`) crops **only** when
`boxSource === 'llm'`, and refuses when `boxSource === 'ocr'`.

`crossCheck.ts` sets `boxSource = 'ocr'` exactly when an OCR line corroborated
the tile, with the comment *"The model's geometry is approximate; OCR's is
measured."* So `boxSource === 'llm'` means **no measured box exists** — the
geometry is the synthetic grid and nothing else.

⚠ **The crop is therefore offered precisely when the box is fabricated, and
refused precisely when it was measured.** Both halves of the rule are
individually well-argued — an OCR box is a text strip a few percent tall and
makes a useless artwork thumbnail (§5.3a) — but together they guarantee that
every crop the owner is ever shown is derived from a generated rectangle.

`TILE_CROP_PADDING = 0.08` then widens it 8 % on each side, so a grid cell
straddling two real tiles smears across both.

## The owner-visible defect this explains

From a live Netflix "My List" capture (4 tiles in one wide 1246×205 strip): the
thumbnails shown for **Jo Koy: Blue in the Face** and two others each depicted
*Best of the Best* and *Stranger Things*.

⚠ **Corrected 2026-09-20 — the diagnosis below was WRONG.** All three cards
showed the **identical** region. Independent fabricated crops carry different
boxes and cannot coincide; a shared *uncropped* render must. This capture is
the `null` branch: with no crop, `CandidateCard` renders the whole screenshot
into a ~96 px box under `object-fit: cover`, which on a 6:1 strip displays its
middle ~22 % — `x ≈ 0.387–0.613`, spanning exactly the tile-2/tile-3 boundary.

So this is the **same branch as the earlier "it shows me the whole screenshot"
report**, presenting differently because a wide strip makes a centre-crop look
deliberate. The inverted rule is still the root cause, but both owner reports
land on the `'ocr' → null` side of it, not one on each side.

⚠ **`crop === null` is therefore a defect in its own right**, not a safe
fallback: it presents an arbitrary slice of the screenshot with the same
framing and confidence as a real tile crop.

~~The model's habitual ~6-across grid does not match a 4-across strip, so cell
boundaries fall mid-tile, and padding smears each crop across the join.~~

~~⚠ **This is the same root cause as the earlier "it shows me the whole
screenshot" report, not a separate bug.** That was the `boxSource === 'ocr'`
branch returning `null`; this is the `'llm'` branch returning a fabricated
rectangle. One inverted rule, two complaints.~~

## What this rules out

- **A sibling-outlier guard cannot work.** Every box on an image is identical
  by construction, so no box is ever an outlier among its peers.
- **Clamping to the image is not sufficient.** It fixes the `x = 1.000` box
  and nothing else; the interior cells stay misaligned.
- **A larger `TILE_CROP_PADDING` makes it worse**, by widening the smear.

## What the fix has to do, and why it is not in this commit

⚠ **Corrected 2026-09-20 — the plan below was REFUTED by the measurement it
asked for.** The caption-to-tile ratio was measured across 106 pairs and it is
not a stable quantity: **1.32–12.15 in width, 4.04–14.29 in height** (p25–max).
Anchor-and-expand cannot work, because the relationship depends on whether the
caption is baked into the artwork or sits beside it — and a title frequently
has **both** kinds of box at once, disagreeing by most of a tile.

The note was right that the factor had to be measured before it could be
written, and right to refuse to guess it. It was wrong to assume a factor
exists. See [`tile-geometry-2026-09-20.md`](./tile-geometry-2026-09-20.md) §3
for the numbers and §5 for the supported alternative: measured caption for
**position**, the model's box for **size** (which measurement did validate,
p25–p75 of 1.02–1.19), restricted to the unambiguous baked-in case.

~~The tile region must be **anchored to measured geometry** — the OCR line
boxes — rather than to the model's grid, and then expanded so artwork is
visible as §5.3a requires.~~

~~That expansion needs a measurement this note does not yet have. OCR line
boxes are text strips (median height 0.015–0.027) and tiles are ten-plus times
taller, so the expansion factor is large and cannot be guessed responsibly.
⚠ **It cannot be a fixed per-axis factor either: `rotated-01` is rotated 90°,
where the text strips are tall and narrow (median `w` 0.016, `h` 0.089) and an
axis-fixed rule inverts.**~~

~~Writing that factor from intuition is exactly what §4A's discipline exists to
prevent, so it is deliberately left to a task that can measure the
caption-to-tile ratio across the corpus first.~~

