import { describe, expect, it } from 'vitest';

import {
  detectTileGrid,
  tileContaining,
  MIN_GUTTER_SCORE,
  MIN_TILES,
  type LuminanceRaster,
} from '../src/extraction/tileGrid.js';

/**
 * `T-AI-060` — the tile-grid detector (`packages/domain/src/extraction/tileGrid.ts`).
 *
 * ⚠ THESE TESTS ARE SYNTHETIC ON PURPOSE, AND THAT IS NOT A WEAKNESS HERE.
 * The corpus sweep (`T-AI-061`) proves the detector works on real captures;
 * what it CANNOT prove is behaviour on inputs the corpus happens not to
 * contain. The octave trap is the worked example: a perfectly uniform grid
 * makes lag `P` and lag `2P` score within 0.3% of each other, and every real
 * screenshot breaks that tie by accident because artwork varies. So the one
 * input that exposes the bug is the one input nature never supplies — it has
 * to be constructed. `T-AI-060a` is that construction.
 *
 * ⚠ The refusal cases matter more than the acceptance case. `detectTileGrid`
 * returning `null` is what stops it re-introducing the confidently-wrong crops
 * that `T-AI-055` removed, so every guard has a test that fails if the guard is
 * deleted.
 */

const BG = 10;
const FG = 200;

interface GridSpec {
  width: number;
  height: number;
  bandY0: number;
  bandY1: number;
  /** Tile pitch in px. */
  period: number;
  /** Gutter width in px. */
  gutter: number;
  /** Offset of the first gutter's left edge. */
  phase: number;
}

/**
 * A raster of bright tiles on a dark background, laid out exactly as a
 * streaming row is: uniform pitch, uniform gutters, one content band.
 */
function syntheticGrid(
  spec: GridSpec,
  paint?: (x: number, y: number, current: number) => number,
): LuminanceRaster {
  const { width, height } = spec;
  const data = new Uint8Array(width * height).fill(BG);
  for (let y = spec.bandY0; y <= spec.bandY1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (x - spec.phase + spec.period * 4) % spec.period;
      const inGutter = offset < spec.gutter;
      let v = inGutter ? BG : FG;
      if (paint) v = paint(x, y, v);
      data[y * width + x] = v;
    }
  }
  return { width, height, data };
}

const UNIFORM: GridSpec = {
  width: 600,
  height: 100,
  bandY0: 20,
  bandY1: 79,
  period: 100,
  gutter: 10,
  phase: 0,
};

/** 600px of 100px pitch. See `T-AI-060a` for why the width is not arbitrary. */
const UNIFORM_TILES = 6;

describe('T-AI-060 - tile grid detection', () => {
  it('T-AI-060a - locks the FUNDAMENTAL period of a perfectly uniform grid, not an octave of it', () => {
    const grid = detectTileGrid(syntheticGrid(UNIFORM));
    expect(grid).not.toBeNull();
    const found = grid as NonNullable<typeof grid>;

    // ⚠ THE WIDTH IS LOAD-BEARING AND WAS CHOSEN BY MEASUREMENT, not taste.
    // At 400px the detector locks the true 100px pitch whether or not the
    // subharmonic correction exists, so an earlier version of this case passed
    // with the correction disabled - it proved nothing. Swept across widths
    // with the correction off, the failure appears at 500px (locks 200, two
    // tiles for five) and 600px (locks 300, two tiles for SIX). 600 is used
    // because it exposes a third harmonic, not merely an octave.
    expect(found.tiles).toHaveLength(UNIFORM_TILES);
    expect(found.rows).toHaveLength(1);
    const row = found.rows[0] as NonNullable<(typeof found.rows)[0]>;
    expect(row.period * UNIFORM.width).toBeCloseTo(UNIFORM.period, 0);
    expect(found.gutterScore).toBeGreaterThanOrEqual(MIN_GUTTER_SCORE);

    // Each tile's centre lands inside the true tile it represents, and no tile
    // is more than a gutter's worth off the true pitch.
    found.tiles.forEach((tile, i) => {
      const centre = (tile.x + tile.w / 2) * UNIFORM.width;
      const trueLeft = i * UNIFORM.period + UNIFORM.gutter;
      const trueRight = (i + 1) * UNIFORM.period;
      expect(centre).toBeGreaterThan(trueLeft);
      expect(centre).toBeLessThan(trueRight);
      expect(tile.w * UNIFORM.width).toBeGreaterThan(UNIFORM.period * 0.85);
      expect(tile.w * UNIFORM.width).toBeLessThan(UNIFORM.period);
    });
  });

  it('T-AI-060b - survives dark artwork INSIDE a tile, which defeated the mean projection', () => {
    // The first attempt at this detector thresholded per-column MEAN brightness
    // and took bright runs as tiles. On the owner's live capture the dark
    // `Nimesh Patel` and `Best of the Best` artwork split their own tiles in
    // two and it reported seven tiles where there were five. Here the second
    // tile is blacked out over most - but not all - of the band height, which
    // is exactly what real artwork does.
    const raster = syntheticGrid(UNIFORM, (x, y, current) => {
      const inSecondTile = x >= 110 && x < 190;
      const upperPortion = y <= 70;
      return inSecondTile && upperPortion ? BG : current;
    });
    const grid = detectTileGrid(raster);
    expect(grid).not.toBeNull();
    expect((grid as NonNullable<typeof grid>).tiles).toHaveLength(UNIFORM_TILES);
  });

  it('T-AI-060c - takes the WIDEST band, not the first, so a section header cannot hijack the lock', () => {
    // "My List" sits above the row on every Netflix capture and is itself a
    // bright run. Taking the first run would analyse the heading's letter
    // spacing; measured on the live capture that produced a period near 40px.
    //
    // ⚠ THE HEADER MUST BE A GENUINE COMPETING RUN OR THIS TEST GUARDS
    // NOTHING. It has to clear the row-brightness threshold on its own, which
    // means spanning a realistic fraction of the width — an earlier version
    // scribbled a fixed 120px which, once the raster widened to 600px, no
    // longer lifted its rows above the threshold at all. The band search then
    // saw ONE run and "widest" and "first" became the same answer: mutating
    // widest-to-first left all nine tests passing. It is deliberately SHORTER
    // than the content band (11 rows vs 60) so that "first" and "widest"
    // genuinely disagree.
    const raster = syntheticGrid(UNIFORM);
    const mutable = raster.data as Uint8Array;
    const headerWidth = Math.round(raster.width * 0.55);
    for (let y = 2; y <= 12; y += 1) {
      for (let x = 0; x < headerWidth; x += 1) {
        // A short caption-like scribble with fine pitch.
        mutable[y * raster.width + x] = x % 12 < 7 ? FG : BG;
      }
    }
    const grid = detectTileGrid(raster);
    expect(grid).not.toBeNull();
    const found = grid as NonNullable<typeof grid>;
    expect(found.tiles).toHaveLength(UNIFORM_TILES);
    const row = found.rows[0] as NonNullable<(typeof found.rows)[0]>;
    expect(row.band.y0 * UNIFORM.height).toBeGreaterThan(10);
  });

  it('T-AI-060d - refuses an image with no periodic gutters', () => {
    const { width, height } = UNIFORM;
    const data = new Uint8Array(width * height).fill(BG);
    // One solid bright blob - content, but no repeating structure at all.
    for (let y = 20; y < 80; y += 1) {
      for (let x = 40; x < width - 40; x += 1) data[y * width + x] = FG;
    }
    expect(detectTileGrid({ width, height, data })).toBeNull();
  });

  it('T-AI-060e - refuses a flat raster on the contrast guard', () => {
    const { width, height } = UNIFORM;
    const data = new Uint8Array(width * height).fill(128);
    expect(detectTileGrid({ width, height, data })).toBeNull();
  });

  it('T-AI-060f - refuses a degenerate single-tile lock', () => {
    // Two gutters only - one cell. This is the answer the search falls back to
    // when it finds nothing, so accepting it would turn every failure into a
    // confident whole-image crop.
    const grid = detectTileGrid(syntheticGrid({ ...UNIFORM, width: 300, period: 290, gutter: 10 }));
    if (grid !== null) expect(grid.tiles.length).toBeGreaterThanOrEqual(MIN_TILES);
  });

  it('T-AI-060g - refuses a raster smaller than a plausible layout', () => {
    expect(detectTileGrid({ width: 20, height: 20, data: new Uint8Array(400) })).toBeNull();
    expect(detectTileGrid({ width: 400, height: 1, data: new Uint8Array(400) })).toBeNull();
  });

  it('T-AI-060h - refuses a raster whose data is shorter than its declared size', () => {
    expect(detectTileGrid({ width: 400, height: 100, data: new Uint8Array(100) })).toBeNull();
  });

  it('T-AI-060i - tileContaining is CONTAINMENT, never nearest', () => {
    const grid = detectTileGrid(syntheticGrid(UNIFORM));
    expect(grid).not.toBeNull();
    const found = grid as NonNullable<typeof grid>;
    const first = found.tiles[0];
    const second = found.tiles[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const tile = second as NonNullable<typeof second>;
    const left = first as NonNullable<typeof first>;

    const centre = { x: tile.x + tile.w / 2, y: tile.y + tile.h / 2 };
    expect(tileContaining(found, centre)).toEqual(tile);

    // A point in the gutter belongs to NO tile. Snapping it to the nearest
    // neighbour is how an unreliable anchor produces a confident wrong crop,
    // which is the defect T-AI-055 removed.
    const gutter = { x: (left.x + left.w + tile.x) / 2, y: centre.y };
    expect(gutter.x).toBeGreaterThan(left.x + left.w);
    expect(gutter.x).toBeLessThan(tile.x);
    expect(tileContaining(found, gutter)).toBeNull();

    // Above the band is likewise not evidence about any tile.
    expect(tileContaining(found, { x: centre.x, y: 0.01 })).toBeNull();
  });
});
