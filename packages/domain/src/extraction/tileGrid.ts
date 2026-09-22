/**
 * Tile-grid detection — measuring the row geometry FROM THE IMAGE.
 *
 * ⚠ THIS EXISTS BECAUSE WE ONLY EVER ASKED THE MODEL WHERE THINGS WERE.
 * `T-AI-054` measured the vision reader's own bounding boxes against a
 * hand-annotated ground truth and found the *sizes* broadly right but the
 * *positions* unusable — only 22 of 46 box centres landed inside their own
 * tile. `T-AI-055` responded the only way it honestly could: refuse a crop
 * unless OCR corroborated it (`review.tileCropFor`, `boxSource !== 'ocr'`).
 * That removed the misleading crops, but it left the owner looking at "Whole
 * screenshot" for every artwork-only read — which is precisely the read they
 * most need to eyeball, because it is also the fabrication-prone one
 * (`specs/ai.md` §9.2/§9.4, `RSK-021`).
 *
 * The missing move was never to trust the reader harder. It was to stop asking
 * it. A streaming "row" is a strictly periodic strip of identical tiles
 * separated by gutters of pure background, so the geometry is *measurable*
 * rather than inferable, and a measurement can be checked.
 *
 * ⚠ WHY PERIODICITY AND NOT SEGMENTATION. The obvious approach — threshold the
 * column brightness and take each bright run as a tile — was tried first and
 * FAILS on real captures, because tile artwork contains its own dark regions.
 * On the owner's live Netflix capture it split the dark `Nimesh Patel` and
 * `Best of the Best` tiles into two runs each and reported 7 tiles where there
 * were 5. Locking onto the *period* is immune to that: artwork varies, the
 * pitch does not.
 *
 * ⚠ THE GUTTERS ARE THE SIGNAL, NOT THE TILES. A gutter column is background
 * for the WHOLE height of the band; a dark patch of artwork is not. Measured on
 * the live capture: gutter columns peaked at 20–22 (of 255) while the darkest
 * artwork column still peaked at 40–70. Hence `columnMaxima` — a per-column
 * MAXIMUM, never a mean. A mean is what the failed segmentation attempt used.
 *
 * ⚠ REFUSING IS A FEATURE, AND IT IS THE WHOLE REASON THIS IS SAFE. A detector
 * that always answers reproduces exactly the defect `T-AI-055` was written to
 * stop — confidently wrong geometry. `gutterScore` is the honest confidence:
 * the mean darkness of the columns the locked period predicts are gutters. If
 * the image is not a uniform row, the prediction lands on artwork and the score
 * collapses. Measured across the golden corpus (`T-AI-060c`):
 *
 *     ACCEPT  live netflix capture      1.000   5 tiles   (visually verified)
 *     ACCEPT  truncated-titles-01       1.000   2 tiles   (period 468 vs the
 *                                                          generator's exact
 *                                                          440/940 pitch)
 *     ACCEPT  netflix-artwork-only-01   0.962   6 tiles
 *     ─────── MIN_GUTTER_SCORE = 0.95 ──────────────────────────────────────
 *     refuse  rotated-01                0.844
 *     refuse  netflix-mylist-mobile-02  0.859   (also 1 tile)
 *     refuse  netflix-continue-watching 0.788
 *     refuse  max-saved-mobile-01       0.625
 *     refuse  low-quality-jpeg-01       0.569
 *     refuse  blank-no-content-01       0.534
 *     refuse  netflix-mylist-mobile-01  0.531
 *
 * ⚠ The threshold sits in a 0.962/0.859 gap that is an order of magnitude
 * wider than the spacing between neighbouring refusals. Do NOT lower it to
 * "rescue" a mobile grid — mobile is a MULTI-ROW layout and the single-band
 * assumption below does not hold for it. Rescuing it means teaching this to
 * find several bands, not weakening the evidence rule.
 *
 * ⚠ PURE. No `sharp`, no I/O, no `Buffer`. It takes a greyscale raster and
 * returns normalised boxes, which is what makes the corpus sweep in
 * `T-AI-060c` cheap enough to run on every commit.
 */

/** A box in normalised image coordinates: every field is a fraction in `[0,1]`. */
export interface TileGridBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * A greyscale raster to analyse.
 *
 * ⚠ ASPECT RATIO NEED NOT BE PRESERVED by whatever produced this. Every
 * coordinate returned is a FRACTION of `width`/`height`, and an independent
 * linear scale on each axis leaves fractions unchanged. The caller is expected
 * to downsample hard (a fixed working width) for stability and speed.
 */
export interface LuminanceRaster {
  readonly width: number;
  readonly height: number;
  /** Row-major, one byte per pixel, `length === width * height`. */
  readonly data: Readonly<Uint8Array>;
}

export interface TileGridRow {
  /** The detected row strip, normalised. */
  readonly band: { readonly y0: number; readonly y1: number };
  /** Tile pitch as a fraction of image width. */
  readonly period: number;
  /** Mean darkness of the predicted gutter columns, in `[0,1]`. */
  readonly gutterScore: number;
  /** Left-to-right, never fewer than `MIN_TILES`. */
  readonly tiles: readonly TileGridBox[];
}

export interface TileGrid {
  /** Top-to-bottom. At least one; see `detectTileGrid`. */
  readonly rows: readonly TileGridRow[];
  /**
   * Every row's tiles, flattened in reading order.
   *
   * ⚠ NOT disjoint in `x` across rows — two tiles in different rows share a
   * column by definition. Only `TileGridRow.tiles` is a left-to-right series.
   */
  readonly tiles: readonly TileGridBox[];
  /** The weakest row's score: the confidence in the grid as a whole. */
  readonly gutterScore: number;
}

/**
 * The confidence a locked period must reach before its geometry is usable.
 * See the corpus table above — this sits inside a measured 0.962/0.859 gap.
 */
export const MIN_GUTTER_SCORE = 0.95;

/**
 * ⚠ Two tiles is the floor, and it is not arbitrary. One "tile" is the
 * degenerate answer the search returns when it finds no periodicity at all
 * (it simply picks the longest admissible period), so accepting it would turn
 * every failure into a confident whole-image crop. `netflix-mylist-mobile-02`
 * scores 0.859 with exactly one tile and is refused twice over.
 */
export const MIN_TILES = 2;

/**
 * Minimum spread between the darkest and brightest column before periodicity
 * is even meaningful. A blank or uniformly-lit image has no gutters to find,
 * and normalising by a near-zero range would amplify sensor noise into a
 * confident lock.
 */
export const MIN_COLUMN_CONTRAST = 20;

/** Below this many working pixels a "period" is noise, not a layout. */
export const MIN_PERIOD_PX = 40;

/**
 * How well a subharmonic must score, relative to the winning lag, to be taken
 * as the true fundamental. See the octave-trap note on `lockPeriod`.
 *
 * ⚠ Generous by design (0.9, not 0.99). A genuine half-period lands in the
 * MIDDLE of a tile, where the gutter signal is near zero, so a spurious
 * subharmonic scores nowhere near the peak — there is no near-miss regime to
 * protect against, and a tight ratio would simply fail to catch the real
 * octave errors it exists for.
 */
export const SUBHARMONIC_RATIO = 0.9;

/**
 * How dark a neighbouring phase must be, relative to the darkest, to count as
 * part of the same gutter when centring the cut. See `lockPhase`.
 */
export const PLATEAU_RATIO = 0.98;

/**
 * How much of a full tile must remain against the raster edge before a closing
 * boundary is admitted there. See the edge-tile note in `detectTileGrid`.
 *
 * ⚠ High on purpose. A streaming row habitually shows a half-scrolled tile at
 * its edge, and cropping that to a sliver would present the owner with a
 * fragment of artwork as if it were a whole title.
 */
export const EDGE_TILE_RATIO = 0.9;

/**
 * How far two rows' pitches may differ and still be called the same grid.
 *
 * ⚠ Unused while detection is single-band; kept because it is the rule a
 * multi-row generalisation needs (see the note on `widestBand`), and
 * re-deriving it later from nothing invites picking a looser value.
 */
export const PITCH_TOLERANCE = 0.08;

/**
 * Shortest content strip that can hold a row of tiles, in working pixels.
 *
 * ⚠ This is a floor on NOISE, not a judgement about tile height. A one- or
 * two-pixel bright streak is a JPEG artefact or a divider rule, and admitting
 * it gives the period search a band with no vertical extent to take a column
 * maximum over.
 */
export const MIN_BAND_PX = 12;

/**
 * Half the gutter, as a fraction of the period, trimmed off each tile edge so
 * a crop never carries a stripe of its neighbour's artwork.
 */
export const TILE_INSET_RATIO = 0.015;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.round((sorted.length - 1) * p);
  return sorted[Math.min(sorted.length - 1, Math.max(0, i))] as number;
}

function sortedCopy(values: Float64Array): number[] {
  return Array.from(values).sort((a, b) => a - b);
}

/**
 * The content strip: the longest contiguous run of rows brighter than a
 * fraction of the image's own dynamic range.
 *
 * ⚠ LONGEST, not first. A section header ("My List") is also a bright run, and
 * on the owner's capture it is the first one. Taking the first would analyse
 * the heading's letter-spacing and lock a period near 40px.
 *
 * ⚠ ONE BAND, DELIBERATELY — AND MULTI-ROW WAS TRIED AND MEASURED WORSE.
 * A desktop or mobile "My List" really is a multi-row grid, so analysing every
 * band and keeping the rows that agree on a pitch looks like the obvious
 * generalisation. It was built and swept over the corpus, and it regressed:
 *
 *     truncated-titles-01     2 tiles @ pitch 0.468  ->  24 @ 0.040  WRONG
 *     netflix-mylist-mobile-01      refused          ->  15 @ 0.061  WRONG
 *     blank-no-content-01           refused          ->   2 @ 0.322  WRONG
 *     low-quality-jpeg-01           refused          ->   2 @ 0.455  WRONG
 *     netflix-mylist-desktop-01     refused          ->  refused     (the
 *                                                        multi-row fixture it
 *                                                        was built for)
 *
 * The cause is structural, not a tuning miss: a band of TEXT locks a strong
 * period at its letter spacing, and because such a band yields many narrow
 * "tiles" it outvotes the real row on any tile-count-weighted agreement rule.
 * Discriminating a caption strip from a tile row needs a size prior this
 * module does not have — the raster's axes are scaled independently, so true
 * aspect ratio is not recoverable from it. Generalising to multi-row means
 * carrying the source dimensions and gating on tile aspect, NOT relaxing
 * anything here.
 */
function widestBand(rowMeans: Float64Array): { y0: number; y1: number } | null {
  const sorted = sortedCopy(rowMeans);
  const lo = percentile(sorted, 0.05);
  const hi = percentile(sorted, 0.95);
  const threshold = lo + (hi - lo) * 0.25;
  let best: { y0: number; y1: number } | null = null;
  let start = -1;
  for (let y = 0; y <= rowMeans.length; y += 1) {
    const on = y < rowMeans.length && (rowMeans[y] as number) > threshold;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      const run = { y0: start, y1: y - 1 };
      if (best === null || run.y1 - run.y0 > best.y1 - best.y0) best = run;
      start = -1;
    }
  }
  return best === null || best.y1 - best.y0 + 1 < MIN_BAND_PX ? null : best;
}

/** Per-column MAXIMUM luminance across the band. See the gutter note above. */
function columnMaxima(raster: LuminanceRaster, y0: number, y1: number): Float64Array {
  const { width, data } = raster;
  const out = new Float64Array(width);
  for (let y = y0; y <= y1; y += 1) {
    const rowStart = y * width;
    for (let x = 0; x < width; x += 1) {
      const v = data[rowStart + x] as number;
      if (v > (out[x] as number)) out[x] = v;
    }
  }
  return out;
}

/**
 * Autocorrelation peak of the mean-removed gutter signal, corrected to the
 * fundamental.
 *
 * ⚠ Mean-removed, otherwise every lag scores alike and the search degenerates
 * to "longest admissible period". The DC term carries no layout information.
 *
 * ⚠ THE OCTAVE TRAP — MEASURED, not assumed. On a *perfectly* uniform grid,
 * lag `2P` aligns every gutter with a gutter just as lag `P` does, and the
 * scores differ only by the edge effects of a finite window. With the
 * correction below disabled and the gutter pitch held at 100px, a width sweep
 * shows the true pitch winning at 400px but LOSING at 500px (locks 200, two
 * tiles for five) and at 600px (locks 300 — a third harmonic, two tiles for
 * six). `T-AI-060a` is therefore built 600px wide, not 400: an earlier version
 * of it used 400 and passed with this whole block disabled, which is to say it
 * guarded nothing. Real captures break the tie by themselves because artwork
 * varies, so this is the one failure mode a synthetic test surfaces and a live
 * image hides — the reverse of the usual direction, and the reason it is
 * guarded explicitly rather than left to the corpus sweep.
 *
 * The standard pitch-detection remedy applies: having found a peak, ask whether
 * a SUBHARMONIC of it scores comparably, and prefer the smallest that does.
 */
function lockPeriod(gutterness: Float64Array): number {
  const width = gutterness.length;
  let sum = 0;
  for (let x = 0; x < width; x += 1) sum += gutterness[x] as number;
  const mean = sum / width;
  const centred = Float64Array.from(gutterness, (v) => v - mean);

  const maxPeriod = Math.floor(width / 2);
  const scoreAt = (period: number): number => {
    let acc = 0;
    let n = 0;
    for (let x = 0; x + period < width; x += 1) {
      acc += (centred[x] as number) * (centred[x + period] as number);
      n += 1;
    }
    return n === 0 ? -Infinity : acc / n;
  };

  let bestPeriod = 0;
  let bestScore = -Infinity;
  for (let period = MIN_PERIOD_PX; period <= maxPeriod; period += 1) {
    const score = scoreAt(period);
    if (score > bestScore) {
      bestScore = score;
      bestPeriod = period;
    }
  }
  if (bestPeriod === 0) return 0;

  // Walk k upwards so the SMALLEST qualifying subharmonic is the one kept.
  let fundamental = bestPeriod;
  for (let k = 2; k <= 4; k += 1) {
    const target = Math.round(bestPeriod / k);
    if (target < MIN_PERIOD_PX) break;
    let localPeriod = target;
    let localScore = -Infinity;
    for (let p = target - 2; p <= target + 2; p += 1) {
      if (p < MIN_PERIOD_PX || p > maxPeriod) continue;
      const score = scoreAt(p);
      if (score > localScore) {
        localScore = score;
        localPeriod = p;
      }
    }
    if (localScore >= bestScore * SUBHARMONIC_RATIO) fundamental = localPeriod;
  }
  return fundamental;
}

/**
 * The offset at which the locked period's predicted cuts are darkest, taken at
 * the CENTRE of the dark run rather than its leading edge.
 *
 * ⚠ CENTRING IS NOT COSMETIC. A gutter is several columns wide and every one
 * of them scores identically, so the raw argmax is whichever edge the scan
 * reached first — which biases every cut to one side by half a gutter and
 * makes each tile straddle its neighbour's boundary. Measured on the synthetic
 * raster in `T-AI-060a`: phases 0-9 all scored 1.0, the argmax returned 0, and
 * every tile came out shifted 4.5px left of truth in a 100px pitch.
 */
function lockPhase(
  gutterness: Float64Array,
  period: number,
): { phase: number; gutterScore: number } {
  const scores = new Float64Array(period);
  let best = -Infinity;
  for (let candidate = 0; candidate < period; candidate += 1) {
    let acc = 0;
    let n = 0;
    for (let x = candidate; x < gutterness.length; x += period) {
      acc += gutterness[x] as number;
      n += 1;
    }
    const score = n < 2 ? -Infinity : acc / n;
    scores[candidate] = score;
    if (score > best) best = score;
  }
  if (best === -Infinity) return { phase: 0, gutterScore: 0 };

  let argmax = 0;
  for (let i = 0; i < period; i += 1) {
    if ((scores[i] as number) === best) {
      argmax = i;
      break;
    }
  }
  // Walk out over the plateau of equally-dark phases, wrapping, then take its
  // midpoint. `PLATEAU_RATIO` admits the gutter's slightly-lit outer columns.
  const floor = best * PLATEAU_RATIO;
  let back = 0;
  while (back < period && (scores[(argmax - back - 1 + period) % period] as number) >= floor) {
    back += 1;
  }
  let forward = 0;
  while (forward < period && (scores[(argmax + forward + 1) % period] as number) >= floor) {
    forward += 1;
  }
  const phase = (argmax - back + Math.round((back + forward) / 2) + period) % period;
  return { phase, gutterScore: best };
}

/** Analyse one content band. `null` when it is not a uniform row of tiles. */
function rowFor(raster: LuminanceRaster, band: { y0: number; y1: number }): TileGridRow | null {
  const { width, height } = raster;
  const maxima = columnMaxima(raster, band.y0, band.y1);
  const sorted = sortedCopy(maxima);
  const lo = percentile(sorted, 0.02);
  const hi = percentile(sorted, 0.95);
  if (hi - lo < MIN_COLUMN_CONTRAST) return null;

  // 1 where the column is background (a gutter), 0 where it is artwork.
  const gutterness = Float64Array.from(maxima, (v) =>
    Math.min(1, Math.max(0, 1 - (v - lo) / (hi - lo))),
  );

  const period = lockPeriod(gutterness);
  if (period < MIN_PERIOD_PX) return null;

  const { phase, gutterScore } = lockPhase(gutterness, period);
  if (gutterScore < MIN_GUTTER_SCORE) return null;

  const cuts: number[] = [];
  for (let x = phase % period; x < width; x += period) cuts.push(x);

  // ⚠ EDGE TILES ARE LOST WITHOUT THIS, and the loss is silent. The cut series
  // only ever lands strictly inside the raster, so a row whose last tile runs
  // to the right-hand edge has no closing cut and is simply dropped - on the
  // synthetic 400x100 / 100px-pitch raster of `T-AI-060a` that turned four
  // tiles into three. A boundary is admitted only when a near-complete tile's
  // worth of image remains, so a partially-scrolled tile stays excluded rather
  // than being cropped to a sliver.
  const firstCut = cuts[0] ?? 0;
  if (firstCut >= period * EDGE_TILE_RATIO) cuts.unshift(0);
  const lastCut = cuts[cuts.length - 1] ?? 0;
  if (width - lastCut >= period * EDGE_TILE_RATIO) cuts.push(width);

  if (cuts.length - 1 < MIN_TILES) return null;

  const inset = period * TILE_INSET_RATIO;
  const tiles: TileGridBox[] = [];
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const left = (cuts[i] as number) + inset;
    const right = (cuts[i + 1] as number) - inset;
    if (right <= left) return null;
    tiles.push({
      x: left / width,
      y: band.y0 / height,
      w: (right - left) / width,
      h: (band.y1 - band.y0 + 1) / height,
    });
  }

  return {
    band: { y0: band.y0 / height, y1: band.y1 / height },
    period: period / width,
    gutterScore,
    tiles,
  };
}

/**
 * Measure the tile grid of an image, or return `null` when it does not present
 * one.
 *
 * ⚠ `null` IS A NORMAL, FREQUENT AND CORRECT ANSWER — most of the golden
 * corpus returns it. Callers must keep their existing "no crop / whole
 * screenshot" behaviour rather than substituting a guess.
 *
 * ⚠ ROWS. `rows` always has exactly one entry today: detection is
 * single-band, for the measured reasons recorded on `widestBand`. The shape is
 * plural because the caller-visible contract should not have to change when
 * multi-row lands, and because a `TileGridBox` is meaningless without the row
 * whose pitch produced it.
 */
export function detectTileGrid(raster: LuminanceRaster): TileGrid | null {
  const { width, height, data } = raster;
  if (width < MIN_PERIOD_PX * 2 || height < 2) return null;
  if (data.length < width * height) return null;

  const rowMeans = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    let acc = 0;
    const rowStart = y * width;
    for (let x = 0; x < width; x += 1) acc += data[rowStart + x] as number;
    rowMeans[y] = acc / width;
  }

  const candidates: TileGridRow[] = [];
  const band = widestBand(rowMeans);
  if (band !== null) {
    const row = rowFor(raster, band);
    if (row !== null) candidates.push(row);
  }
  if (candidates.length === 0) return null;

  return {
    rows: candidates,
    tiles: candidates.flatMap((row) => row.tiles),
    gutterScore: Math.min(...candidates.map((row) => row.gutterScore)),
  };
}

/**
 * The single tile that contains `point`, or `null` when it falls in a gutter
 * or outside the band.
 *
 * ⚠ CONTAINMENT, NEVER NEAREST. "Nearest tile" always returns something, which
 * would re-admit the confidently-wrong crop that `T-AI-055` removed: an
 * unreliable anchor landing in a gutter would be snapped to an arbitrary
 * neighbour. A point that is not inside a tile is not evidence about any tile.
 */
export function tileContaining(
  grid: TileGrid,
  point: { readonly x: number; readonly y: number },
): TileGridBox | null {
  for (const tile of grid.tiles) {
    if (
      point.x >= tile.x &&
      point.x <= tile.x + tile.w &&
      point.y >= tile.y &&
      point.y <= tile.y + tile.h
    ) {
      return tile;
    }
  }
  return null;
}
