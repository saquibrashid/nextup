/**
 * `T-AI-054` — the tile ground-truth corpus, and what it proves about the
 * primary reader's geometry.
 *
 * `tests/fixtures/golden/tiles/` is the first measured statement in this
 * repository of where the tiles on a golden image actually are. Everything
 * before it argued about box quality from the extractor's own output — the
 * thing under question — and that produced two confidently-reasoned, mutually
 * exclusive diagnoses of one owner-reported defect, both of which were wrong.
 * This spec exists so the corpus cannot rot and so the two facts it
 * established cannot silently drift.
 *
 * `a` and `b` are the corpus guards. A tile fixture is hand-generated and
 * committed (`annotate.mjs`, never run at test time), so nothing structural
 * stops a hand edit writing a box that runs off the image — which is exactly
 * the defect class the corpus was built to detect in the model. `b` binds each
 * annotated `title` to the answer key, because `title` is not decoration: it is
 * what pairs a tile to its caption BY IDENTITY. Pairing them geometrically
 * instead fails silently on the layouts that matter most, the ones where the
 * caption sits outside the tile it names, so a typo'd title would not surface
 * as an error — it would surface as a plausible, wrong measurement.
 *
 * `c` is the one case that validates the method rather than using it.
 * `truncated-titles-01` is drawn by `images/generate.mjs`, so its true tiles
 * are known exactly rather than observed. The detector reproduces them to a
 * worst-case coordinate error of ~0.0007. Without `c` the other seven images
 * are an unfalsifiable set of numbers that agree with themselves; with it they
 * inherit a demonstrated accuracy. ⚠ It asserts against the GENERATOR's
 * parameters, recomputed here, not against the committed fixture — comparing
 * the fixture to itself would pass no matter what either file said.
 *
 * `d` and `e` are the measurement, split along the axis the measurement itself
 * revealed. The reader's box SIZE is good (`d`: the middle half within ~20 %)
 * and its POSITION is not (`e`: 24 of 49 centres miss their own tile, by up to
 * 2.3 tiles). That split is load-bearing for the fix — it is why size may be
 * taken from the model and position may not — so it is pinned rather than left
 * in a document.
 *
 * ⚠ `e` asserts the defect is STILL PRESENT, which is deliberate and is the
 * unusual case here. It is a characterisation pin, not an endorsement: it
 * fails if the reader silently gets better as well as if it gets worse, which
 * forces the number and the evaluation note to be updated together and stops
 * `docs/evaluation/tile-geometry-2026-09-20.md` quoting a figure no longer
 * true of the recordings. A fix to the crop must change this pin on purpose.
 *
 * `f` guards the two derived images. `low-quality-jpeg-01` is a resize of
 * `netflix-mylist-mobile-01` and `rotated-01` is a 90° rotation of
 * `max-saved-mobile-01`, so their tiles are not independent observations
 * and must remain exactly the documented transform of their source. Deriving
 * them is deliberate: a detector tuned until a rotated image looks right is
 * the axis-specific reasoning the corpus exists to refute, so the transform is
 * asserted in code where it can be checked.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const GOLDEN = join(process.cwd(), 'tests', 'fixtures', 'golden');
const TILES = join(GOLDEN, 'tiles');

interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Candidate {
  identifiedTitle: string | null;
  box?: Box | null;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const IMAGE_IDS = readdirSync(TILES)
  .filter((f) => f.endsWith('.tiles.json'))
  .map((f) => f.replace('.tiles.json', ''))
  .sort();

const tilesFor = (id: string): Tile[] => readJson<Tile[]>(join(TILES, `${id}.tiles.json`));

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const centre = (b: Box): { cx: number; cy: number } => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2 });

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
};

const quantile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
};

/** Model boxes paired to their true tile by title identity, across the corpus. */
const pairs = (): { id: string; tile: Tile; box: Box }[] => {
  const out: { id: string; tile: Tile; box: Box }[] = [];
  for (const id of IMAGE_IDS) {
    const recording = readJson<Candidate[]>(join(GOLDEN, 'llm', 'gpt-4.1', `${id}.llm.json`));
    for (const tile of tilesFor(id)) {
      const match = recording.find(
        (c) => c.identifiedTitle !== null && norm(c.identifiedTitle) === norm(tile.title),
      );
      if (match?.box) out.push({ id, tile, box: match.box });
    }
  }
  return out;
};

describe('T-AI-054 — tile ground truth', () => {
  it('T-AI-054a - every annotated tile is a normalised box that lies inside its image', () => {
    expect(IMAGE_IDS.length).toBe(8);
    let total = 0;
    for (const id of IMAGE_IDS) {
      const tiles = tilesFor(id);
      expect(tiles.length, `${id} has no tiles`).toBeGreaterThan(0);
      for (const t of tiles) {
        total += 1;
        for (const k of ['x', 'y', 'w', 'h'] as const) {
          expect(Number.isFinite(t[k]), `${id}/${t.title}.${k}`).toBe(true);
        }
        expect(t.w, `${id}/${t.title} width`).toBeGreaterThan(0);
        expect(t.h, `${id}/${t.title} height`).toBeGreaterThan(0);
        expect(t.x, `${id}/${t.title} left edge`).toBeGreaterThanOrEqual(0);
        expect(t.y, `${id}/${t.title} top edge`).toBeGreaterThanOrEqual(0);
        // The defect this corpus detects in the model: a box off the image.
        expect(t.x + t.w, `${id}/${t.title} right edge`).toBeLessThanOrEqual(1.0001);
        expect(t.y + t.h, `${id}/${t.title} bottom edge`).toBeLessThanOrEqual(1.0001);
        expect(t.title.trim().length, `${id} tile with empty title`).toBeGreaterThan(0);
      }
    }
    expect(total).toBe(49);
  });

  it('T-AI-054b - every annotated title is a title the answer key expects on that image', () => {
    for (const id of IMAGE_IDS) {
      const expected = readJson<{ expectedCandidates: { title: string }[] }>(
        join(GOLDEN, 'expected', `${id}.expected.json`),
      );
      const known = new Set(expected.expectedCandidates.map((c) => norm(c.title)));
      for (const t of tilesFor(id)) {
        expect(
          known.has(norm(t.title)),
          `${id}: annotated "${t.title}" is not in the answer key`,
        ).toBe(true);
      }
    }
  });

  it('T-AI-054c - the detector reproduces the one image whose tiles are known exactly', () => {
    // Recomputed from tests/fixtures/golden/images/generate.mjs, not read back
    // from the fixture — a fixture compared with itself proves nothing.
    const CANVAS_W = 940;
    const CANVAS_H = 1260;
    const TILE_W = 380;
    const TILE_H = 400;
    const exact: Box[] = [];
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        exact.push({
          x: (60 + col * 440) / CANVAS_W,
          y: (160 + row * 540) / CANVAS_H,
          w: TILE_W / CANVAS_W,
          h: TILE_H / CANVAS_H,
        });
      }
    }

    const annotated = tilesFor('truncated-titles-01');
    expect(annotated).toHaveLength(exact.length);

    let worst = 0;
    for (const truth of exact) {
      const nearest = [...annotated].sort(
        (a, b) =>
          Math.abs(a.x - truth.x) +
          Math.abs(a.y - truth.y) -
          (Math.abs(b.x - truth.x) + Math.abs(b.y - truth.y)),
      )[0];
      expect(nearest).toBeDefined();
      for (const k of ['x', 'y', 'w', 'h'] as const) {
        worst = Math.max(worst, Math.abs((nearest as Tile)[k] - truth[k]));
      }
    }
    // Measured 0.0007. The band is the accuracy the README claims for the set.
    expect(worst).toBeLessThan(0.002);
  });

  it('T-AI-054d - the reader\u2019s box SIZE is accurate to within ~20% across the middle half', () => {
    const all = pairs();
    expect(all.length).toBeGreaterThanOrEqual(45);

    const wRatio = all.map((p) => p.box.w / p.tile.w);
    const hRatio = all.map((p) => p.box.h / p.tile.h);

    expect(median(wRatio)).toBeGreaterThan(0.9);
    expect(median(wRatio)).toBeLessThan(1.25);
    expect(median(hRatio)).toBeGreaterThan(0.9);
    expect(median(hRatio)).toBeLessThan(1.3);

    for (const ratios of [wRatio, hRatio]) {
      expect(quantile(ratios, 0.25)).toBeGreaterThan(0.95);
      expect(quantile(ratios, 0.75)).toBeLessThan(1.3);
    }
  });

  it('T-AI-054e - the reader\u2019s box POSITION still drifts off the tile it names', () => {
    const all = pairs();
    const onTile = all.filter((p) => {
      const { cx, cy } = centre(p.box);
      return (
        cx >= p.tile.x && cx <= p.tile.x + p.tile.w && cy >= p.tile.y && cy <= p.tile.y + p.tile.h
      );
    });

    // Characterisation pin. Measured 24/49 on 2026-09-20; see
    // docs/evaluation/tile-geometry-2026-09-20.md §2. A crop fix must update
    // this deliberately, and an unexplained improvement must not pass silently.
    expect(onTile.length).toBeGreaterThanOrEqual(20);
    expect(onTile.length).toBeLessThanOrEqual(30);

    // Worst drift, in tile widths/heights — the figure the note quotes.
    const drift = all.map((p) => {
      const { cx, cy } = centre(p.box);
      const t = centre(p.tile);
      return Math.max(Math.abs(cx - t.cx) / p.tile.w, Math.abs(cy - t.cy) / p.tile.h);
    });
    expect(Math.max(...drift)).toBeGreaterThan(1.5);
  });

  it('T-AI-054f - the two derived images remain the documented transform of their source', () => {
    const close = (a: number, b: number, why: string): void => {
      expect(Math.abs(a - b), why).toBeLessThan(0.01);
    };

    // A resize preserves normalised coordinates exactly.
    const source = tilesFor('netflix-mylist-mobile-01');
    const resized = tilesFor('low-quality-jpeg-01');
    expect(resized).toHaveLength(source.length);
    for (const t of resized) {
      const origin = source.find((s) => norm(s.title) === norm(t.title));
      expect(origin, `low-quality-jpeg-01: "${t.title}" has no source tile`).toBeDefined();
      const o = origin as Tile;
      close(t.x, o.x, `${t.title} x`);
      close(t.y, o.y, `${t.title} y`);
      close(t.w, o.w, `${t.title} w`);
      close(t.h, o.h, `${t.title} h`);
    }

    // sharp's rotate(90) is CLOCKWISE: (x,y,w,h) -> (1-y-h, x, h, w).
    // rotated-01 derives from max-saved-mobile-01 (manifest: derived:max-saved-mobile-01).
    const upright = tilesFor('max-saved-mobile-01');
    const rotated = tilesFor('rotated-01');
    for (const t of rotated) {
      const origin = upright.find((s) => norm(s.title) === norm(t.title));
      expect(origin, `rotated-01: "${t.title}" has no source tile`).toBeDefined();
      const o = origin as Tile;
      close(t.x, 1 - o.y - o.h, `${t.title} x <- 1-y-h`);
      close(t.y, o.x, `${t.title} y <- x`);
      close(t.w, o.h, `${t.title} w <- h`);
      close(t.h, o.w, `${t.title} h <- w`);
    }
  });
});
