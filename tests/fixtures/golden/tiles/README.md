# `golden/tiles/` — ground-truth tile geometry

Where the tiles on each golden image **actually are**, measured independently
of anything the extraction pipeline produced.

They are **committed** and read from disk by the tests. They are written by
[`annotate.mjs`](./annotate.mjs), which is run **by hand** and never at test
time — an annotation regenerated during the run can drift with its generator
and still agree with it, which is agreement, not evidence.

```
node tests/fixtures/golden/tiles/annotate.mjs            # rewrite the JSON
node tests/fixtures/golden/tiles/annotate.mjs --overlay   # verification PNGs
```

## Why this set exists

`boundingBox` reaches the owner as the §5.3a tile thumbnail beside "is this
the right match?". Before this set there was no measured statement anywhere of
where the tiles really are, so every claim about box quality had to be argued
from the extractor's own output — the thing under question. Two opposite
diagnoses of the same owner-reported defect were each argued that way, and
both were wrong.

## What a file contains

One array per image, one entry per **list tile**, in reading order:

```json
{ "x": 0.0383, "y": 0.3904, "w": 0.1517, "h": 0.2112, "title": "Hamnet" }
```

Normalised `0..1` against the image's own width and height, like every other
box in the pipeline.

⚠ **`title` is part of the ground truth.** It pairs a tile to a caption **by
identity**, which is the whole point: pairing them by overlap instead fails
silently on exactly the layouts that matter, where the caption sits _outside_
the tile it names.

⚠ **List tiles only.** A recommendation carousel, a "Continue Watching" rail
and the bottom nav are not entries in the owner's list. Annotating them would
inflate any recall figure computed against this set.

## How far to trust the numbers

| Image                 | Provenance                                                                 |
| --------------------- | -------------------------------------------------------------------------- |
| `truncated-titles-01` | **Exact** — read off `../images/generate.mjs`, which drew the tiles        |
| `low-quality-jpeg-01` | **Derived** — a resize preserves normalised coordinates                    |
| `rotated-01`          | **Derived** — `rotate(90)` is clockwise, so `(x,y,w,h) → (1-y-h, x, h, w)` |
| the other five        | **Detected, then verified by eye** against a rendered overlay              |

`truncated-titles-01` is the only image that can _validate_ the method rather
than use it, and it does: the contrast detector in `annotate.mjs`, run blind,
reproduces the generator's tiles to a worst-case coordinate error of **0.0007**.

⚠ **These are human-verified, not machine-certified.** Treat them as accurate
to about a percent of the image — far inside the errors they are used to
measure, which are whole tiles — and do not re-purpose them for sub-pixel work.

⚠ **`rotated-01` is derived on purpose.** A detector tuned until a rotated
image "looks right" is precisely the axis-specific reasoning this corpus
exists to refute.

## What was measured with it

See [`docs/evaluation/tile-geometry-2026-09-20.md`](../../../../docs/evaluation/tile-geometry-2026-09-20.md).
In short: the extractor's box **size** is accurate and its **position** drifts.
