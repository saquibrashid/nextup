# Tile geometry, measured against ground truth

**2026-09-20. Measured against `tests/fixtures/golden/tiles/` — 49 annotated
tiles across 8 images and 3 layout families — and the committed `gpt-4.1`
recordings. No live spend.**

This supersedes the geometry reasoning in
[`tile-box-geometry-2026-09-19.md`](./tile-box-geometry-2026-09-19.md), which
argued from the extractor's own output because nothing better existed. Two of
its conclusions do not survive contact with ground truth; its central claim
does, on better evidence. Both corrections are recorded there.

## 1. The extractor's box SIZE is accurate

| model box ÷ true tile | min | p25 | med | p75 | max |
| --- | --- | --- | --- | --- | --- |
| width | 0.94 | 1.02 | **1.06** | 1.19 | 1.43 |
| height | 0.88 | 1.09 | **1.15** | 1.19 | 1.33 |

The middle half is within ~20 % on both axes, and it never differs by more than
1.43×. **Size is usable.**

## 2. The extractor's box POSITION drifts, by up to 2.3 tiles

Boxes are paired to tiles **by title identity**. 46 of the 49 tiles have a box
to compare: `netflix-artwork-only-01` and `low-quality-jpeg-01` each have one
title the reader did not return at all, and `netflix-continue-watching-01`'s
only tile is returned as *In the Shadow of Dante* rather than *In the Hand of
Dante*, so it has no pair.

Of those 46, only **22 box centres land on the tile they name**.

| image | n | on tile | mean dx | mean dy | worst \|d\| |
| --- | --- | --- | --- | --- | --- |
| `truncated-titles-01` | 4 | 4/4 | −0.00 | 0.16 | 0.20 |
| `netflix-mylist-mobile-02` | 8 | 8/8 | 0.07 | 0.20 | 0.30 |
| `max-saved-mobile-01` | 6 | 5/6 | −0.00 | 0.31 | 0.61 |
| `netflix-artwork-only-01` | 9 | 3/9 | **0.74** | −0.19 | **1.36** |
| `netflix-mylist-mobile-01` | 7 | 1/7 | 0.06 | **1.28** | **2.32** |
| `low-quality-jpeg-01` | 6 | 0/6 | 0.03 | **1.43** | **1.70** |
| `rotated-01` | 6 | 1/6 | **1.26** | 0.02 | **2.11** |
| `netflix-continue-watching-01` | 0 | — | — | — | — |

In tile units, so `2.32` means the box named for one title is centred two tiles
away from it.

The mechanism is visible directly. On `netflix-mylist-mobile-01` the model
steps its boxes by a constant `0.13` while the measured captions step by
`~0.097`: the start is right, the **pitch** is wrong, and the error accumulates
until box 7 is emitted at `y = 1.00` with `h = 0.11` — ending at `1.11`,
entirely off the bottom of the image.

`netflix-artwork-only-01` does the same across: a real pitch of `0.155`, a
model pitch of `0.189`, and a sixth box at `x = 1.000` that ends at `1.181`.

⚠ **No observation can place a tile outside the picture.** Two images, two
axes, same failure: the geometry is generated, not seen. This corroborates
corpus-wide, and for the production model, what TASK-290 recorded from a single
Disney+ capture — *"x correct, y shifted down and stretched"* — which was
treated at the time as one bad capture.

## 3. There is no caption-to-tile expansion factor to fit

This was the measurement the fix was waiting on. The answer is that the
quantity does not exist.

| true tile ÷ caption box | min | p25 | med | p75 | max |
| --- | --- | --- | --- | --- | --- |
| width | 0.44 | 1.32 | 2.05 | 2.86 | **12.15** |
| height | 1.05 | 4.04 | 5.39 | 6.76 | **14.29** |

*n = 106 caption/tile pairs.*

An order of magnitude of spread on both axes. A single factor — or one factor
per axis — cannot turn a caption box into a tile box, because the relationship
depends on the layout:

- **Caption baked into the artwork** (Netflix desktop, and the artwork column
  of the mobile list): the caption lies *inside* the tile, and its centre is
  within ±0.4 tile of the tile's centre (max |dx| 0.40). 64 of 106 pairs.
- **Caption beside or below the artwork** (the mobile list's text column, the
  synthetic grid): the caption lies *outside* the tile. The tile centre sits a
  median of **−0.91 tile widths** away — a systematic displacement that is a
  property of the layout, not a constant. 42 of 106 pairs.

⚠ **A title routinely has TWO measured caption boxes** — one baked into the
artwork, one in the adjacent text column — and they disagree about where the
tile is by most of a tile. Any rule that anchors on "the" OCR line has to say
which, and the extractor's existing choice (best text score) does not
distinguish them.

**Conclusion: anchor-and-expand is refused on measurement.** It was the plan of
record in the 2026-09-19 note; it is not viable.

## 4. Drift correction was tried and is NOT safe

Because the drift looks linear, it ought to be possible to fit it out. Using
only what the runtime already has — each model box paired with its own
best-scoring OCR line, score ≥ 0.8, no ground truth — a per-axis least-squares
fit of `measured = a·model + b` per image, applied to every box:

| | raw | corrected | slope-guarded |
| --- | --- | --- | --- |
| centres on their own tile | 22/46 | 31/46 | 25/46 |
| median \|error\| (tiles) | 0.610 | 0.287 | 0.413 |

It rescues the broken images completely — `low-quality-jpeg-01` 0/6 → 6/6,
`netflix-mylist-mobile-01` 1/7 → 7/7, `rotated-01` 1/6 → 6/6.

⚠ **And it destroys two images that were perfect**: `netflix-mylist-mobile-02`
**8/8 → 0/8** and `truncated-titles-01` **4/4 → 0/4**. Net on-tile improves;
the owner's experience does not, because a correct thumbnail turning wrong is
not paid for by a wrong one turning right.

The fitted slopes say why it cannot be patched:

| image | slope x | slope y |
| --- | --- | --- |
| `low-quality-jpeg-01` | **−1.71** | 0.91 |
| `netflix-mylist-mobile-01` | **−0.86** | 0.75 |
| `netflix-mylist-mobile-02` | **0.25** | 0.96 |
| `truncated-titles-01` | 0.71 | 1.07 |
| `netflix-artwork-only-01` | 0.63 | 0.79 |
| `rotated-01` | 0.77 | 1.00 |
| `max-saved-mobile-01` | 1.00 | 0.90 |

⚠ **Two slopes are NEGATIVE.** A negative slope mirrors the image; no
screenshot layout can produce one. The estimator is fitting noise — on a
vertical list every caption shares nearly the same `x`, so the x-fit is
near-singular and its slope is meaningless. It happens to help there only
because the constant term absorbs the error.

Constraining the slope to a plausible `0.8–1.25` was the obvious repair, and it
does not work either: it gives back most of the gain (**25/46**, median 0.413)
and **still** destroys `truncated-titles-01`, whose `ay = 1.07` passes the
guard while being wrong.

**Conclusion: linear drift correction is refused on measurement, like §3.** The
underlying reason is the same one — it fits box centres to *caption* centres,
and §3 shows those two differ by a layout-dependent amount up to most of a
tile. No estimator can be robust against an anchor that is systematically
displaced.

~~*An earlier draft of this note reported 73/98 → 86/98 and a median of
0.152 → 0.070 for this experiment. Those figures came from a pre-publication
pairing over caption matches rather than title identity, and do not reproduce
against the committed corpus. The numbers above are the reproducible ones.*~~

## 5. What this leaves as the supported next step

Two facts are now solid enough to build on:

1. The box **size** is accurate (§1).
2. Measured caption **position** is exact but ambiguous (§3), and the model's
   position is not trustworthy (§2).

The cheapest correct move is therefore to take **position from the measured
caption and size from the model's box**, restricted to the unambiguous case —
a caption that lies inside the model's own box, which is the baked-in-artwork
case where §3 shows the centre agrees to within ±0.4 tile. That covers the
majority of the corpus and degrades to "no crop" rather than to a wrong crop
everywhere else.

⚠ **"No crop" is not harmless, and must be fixed at the same time.** A null
crop renders the whole screenshot into a 96 px box under `object-fit: cover`,
which on a wide strip shows its middle ~22 % and looks exactly like a confident
crop of the wrong tiles. That is what an owner reported as a mis-cropped
thumbnail on a 1246×205 Netflix strip; all three affected cards showed the
*identical* region, which is what a shared uncropped render predicts and what
independent bad crops do not.

## 6. What was built, and what it measured (same day)

§5's rule was implemented in `tileCropFor` and re-measured through the **same
harness** — the committed recordings driven through the real `crossCheck()`,
scored against the §1 annotations. `T-AI-055` is that measurement, kept as a
test.

⚠ **The baseline below is worse than any figure in §§1–4, and only this
measurement could have produced it.** §§1–4 score the extractor's boxes. The
product crops only the *non-corroborated* subset of them, which is a different
and much worse population — so the honest before-figure is not "22 of 46
centres are on-tile" but this:

| | before | after |
| --- | --- | --- |
| crops offered (of 48 matched tiles) | 10 | **22** |
| crops showing **< 50 %** of their tile | **8** | **0** |
| median tile coverage | 0.24 | **0.89** |
| minimum tile coverage | 0.00 | **0.59** |
| suppressed (whole screenshot shown) | 38 | 26 |

**Only 2 of 48 thumbnails were useful.** The cause was a single inverted
condition — `tileCropFor` refused a crop unless `boxSource === 'llm'`, and
`crossCheck` sets `'llm'` to mean *no OCR line corroborated this tile*. The
crop was offered exactly when the geometry was fabricated and refused exactly
when it had been measured. Three separate owner reports — "the whole
screenshot", "the wrong tile", "two other tiles" — are that one condition seen
from its two sides.

⚠ **The agreement gate is most of the value, not the position source.**
Scored across the four candidate rules, what removes the misleading crops is
requiring the caption centre to fall inside the model's box — i.e. that the
two readers agree where the title is — rather than which of them supplies the
coordinates. A variant that took position from the caption but skipped the
gate still produced crops below 0.5 coverage.

⚠ **Two thirds of the earlier analysis in this note funded a plan that was
then refuted** (§§3–4: no expansion factor exists, drift correction destroys
two images). That is the note working as intended: the measurement was
commissioned to choose between two confident diagnoses and it eliminated
both, leaving a third option that neither had proposed.
