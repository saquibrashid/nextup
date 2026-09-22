/**
 * `T-AI-055` — the §5.3a tile crop, measured end-to-end over the real corpus.
 *
 * ⚠ **THIS IS THE CASE THAT WOULD HAVE CAUGHT THE DEFECT, AND THE UNIT TESTS
 * IN `review.spec.ts` ARE NOT.** `T-AI-041` feeds `tileCropFor` boxes written
 * by hand, so it proves the arithmetic and nothing about whether the boxes the
 * pipeline really produces make a usable thumbnail. They did not: measured
 * here against ground truth, the previous rule produced 10 crops of which
 * **8 showed under half the tile they named**, and the median crop showed
 * **24%** of it. Every hand-written unit case passed throughout. The owner
 * reported it three times before it was found.
 *
 * So this spec replays the committed recordings through the **real**
 * `crossCheck()` and the **real** `tileCropFor()`, and scores the result
 * against the annotated tiles in `tests/fixtures/golden/tiles/` — geometry
 * measured independently of anything the extractor produced.
 *
 * `a` is the property that matters to the owner and it is stated as a
 * **guarantee, not an average**: NO crop may show less than half of the tile
 * it names. A thumbnail beside "is this the right match?" that frames the
 * wrong artwork does not merely fail to help — it actively misinforms the
 * decision, and the owner cannot tell it is wrong without the screenshot in
 * front of them. Aggregate coverage would let a handful of badly wrong crops
 * hide behind many good ones, which is precisely how the old rule survived.
 *
 * `b` pins the yield from below. `a` alone is satisfied perfectly and
 * vacuously by a rule that never crops anything — and "never crop" is a real
 * temptation here, because the no-crop path is safe. It is also useless: the
 * owner is then back to identifying one row among ~20 tiles from the whole
 * screenshot, which is the ORIGINAL complaint this whole thread began with.
 * The two cases are a matched pair and neither is meaningful alone.
 *
 * `c` is the inversion. `boxSource === 'llm'` means no OCR line corroborated
 * the tile, so the geometry is the reader's unverified estimate — the source
 * of all 8 bad crops above. The old rule cropped **only** that case; the new
 * rule refuses it. ⚠ It is asserted over the corpus rather than as a literal,
 * so it cannot be satisfied by a stub: it requires that real uncorroborated
 * items exist and that every one of them is refused.
 *
 * `d` proves the two halves come from the two different sources, which is the
 * whole design. Size must track the reader's TILE and not the caption line: a
 * crop sized to the caption is a strip of text, shows no artwork, and §5.3a
 * exists to prevent exactly that. ⚠ A crop that merely "looks right" on
 * position would pass `a` and `b` while being a text strip, because a text
 * strip does overlap the tile.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crossCheck, tileCropFor } from '@nextup/domain';
import type { LlmTile, OcrLine } from '@nextup/domain';
import { HybridExtractor } from '../../apps/api/src/extraction/hybridExtractor.js';

const GOLDEN = join(process.cwd(), 'tests', 'fixtures', 'golden');

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Tile extends Rect {
  title: string;
}

const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const IMAGE_IDS = readdirSync(join(GOLDEN, 'tiles'))
  .filter((f) => f.endsWith('.tiles.json'))
  .map((f) => f.replace('.tiles.json', ''))
  .sort();

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const overlapArea = (a: Rect, b: Rect): number => {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
};

interface Scored {
  imageId: string;
  title: string;
  coverage: number;
  cropW: number;
  cropH: number;
  tile: Rect;
  captionH: number;
}

/** Replay every annotated image through the real pipeline. */
function score(): { crops: Scored[]; refusedLlm: number; llmItems: number } {
  const crops: Scored[] = [];
  let refusedLlm = 0;
  let llmItems = 0;

  for (const id of IMAGE_IDS) {
    const llm = read<LlmTile[]>(join(GOLDEN, 'llm', 'gpt-4.1', `${id}.llm.json`));
    const ocr = read<OcrLine[]>(join(GOLDEN, 'ocr', `${id}.ocr.json`));
    const tiles = read<Tile[]>(join(GOLDEN, 'tiles', `${id}.tiles.json`));
    const items = crossCheck(llm, ocr);

    for (const item of items) {
      const crop = tileCropFor({
        boxSource: item.boxSource,
        boundingBoxes: [{ imageId: id, ...item.boundingBox }],
      });

      if (item.boxSource === 'llm') {
        llmItems += 1;
        if (crop === null) refusedLlm += 1;
      }
      if (crop === null) continue;

      // Pair to ground truth BY IDENTITY, never by geometry — pairing a crop
      // to its nearest tile would score a wrong crop against whatever it
      // happened to land on, and always look correct.
      const label = item.inferredTitle ?? item.rawText;
      const tile = tiles.find((t) => norm(t.title) === norm(label));
      if (tile === undefined) continue;

      crops.push({
        imageId: id,
        title: tile.title,
        coverage: overlapArea(crop, tile) / (tile.w * tile.h),
        cropW: crop.w,
        cropH: crop.h,
        tile,
        captionH: item.boundingBox.h,
      });
    }
  }
  return { crops, refusedLlm, llmItems };
}

describe('T-AI-055 - the tile crop, scored against ground truth', () => {
  it('T-AI-062h - image-derived crops retain identity-paired corpus coverage, with nonzero measured yield', async () => {
    // The new branch must face the same oracle as the old one. Scoring boxes
    // against whichever tile they hit would certify confidently wrong crops.
    // Replay the shipped hybrid with recorded reader output but REAL pixels;
    // the positive floor prevents "refuse everything" satisfying the test.
    let measuredCrops = 0;
    let crops = 0;
    const files = readdirSync(join(GOLDEN, 'images'));
    for (const id of IMAGE_IDS) {
      const file = files.find((name) => name.startsWith(`${id}.`) && /\.(png|jpg)$/.test(name));
      if (!file) throw new Error(`Missing PNG/JPEG for ${id}`);
      const llm = read<LlmTile[]>(join(GOLDEN, 'llm', 'gpt-4.1', `${id}.llm.json`));
      const ocr = read<OcrLine[]>(join(GOLDEN, 'ocr', `${id}.ocr.json`));
      const truth = read<Tile[]>(join(GOLDEN, 'tiles', `${id}.tiles.json`));
      const result = await new HybridExtractor({
        llm: { readTiles: async () => llm },
        vision: { readLines: async () => ocr },
      }).extract(
        readFileSync(join(GOLDEN, 'images', file)),
        file.endsWith('.png') ? 'image/png' : 'image/jpeg',
      );
      for (const item of result.items) {
        const tile = truth.find(
          (entry) => norm(entry.title) === norm(item.inferredTitle ?? item.rawText),
        );
        if (!tile) continue;
        const crop = tileCropFor({
          boxSource: item.boxSource,
          boundingBoxes: [{ imageId: id, ...item.boundingBox }],
        });
        if (crop === null) continue;
        crops++;
        if (item.boundingBox.gridTileBox !== undefined) measuredCrops++;
        expect(
          overlapArea(crop, tile) / (tile.w * tile.h),
          `${id}/${tile.title}`,
        ).toBeGreaterThanOrEqual(0.5);
      }
    }
    expect(crops).toBeGreaterThanOrEqual(15);
    expect(measuredCrops).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('T-AI-055a - no crop shows less than half of the tile it names', () => {
    const { crops } = score();
    const bad = crops.filter((c) => c.coverage < 0.5);
    expect(
      bad.map((c) => `${c.imageId}/${c.title} showed ${(c.coverage * 100).toFixed(0)}%`),
    ).toEqual([]);
  });

  it('T-AI-055b - and it still crops enough of them to be worth having', () => {
    const { crops } = score();
    // Measured 19 on 2026-09-20, against 10 under the previous rule. The
    // floor is what stops `a` being satisfied by refusing everything.
    expect(crops.length).toBeGreaterThanOrEqual(15);

    const sorted = [...crops].map((c) => c.coverage).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    // Measured 0.89. The previous rule's median was 0.24.
    expect(median).toBeGreaterThan(0.75);
  });

  it('T-AI-055c - an uncorroborated reader box is never cropped', () => {
    const { refusedLlm, llmItems } = score();
    // The corpus must actually contain this case, or the assertion is empty.
    expect(llmItems).toBeGreaterThan(0);
    expect(refusedLlm).toBe(llmItems);

    // ⚠ THE CORPUS ASSERTION ABOVE IS NOT SUFFICIENT AND THIS LINE IS WHY.
    // Deleting the `boxSource` guard in `tileCropFor` leaves it green:
    // `crossCheck` only attaches a `tileBox` when an OCR line corroborated
    // the tile, so today's uncorroborated items are refused by the *missing
    // tile* branch and never reach the guard at all. That is defence in
    // depth, not a test — it collapses the moment any other producer of
    // `ExtractedTextItem` sets both fields, and then the unverified reader
    // geometry that caused all of this is croppable again. So state the rule
    // directly, on the input the corpus cannot currently supply.
    expect(
      tileCropFor({
        boxSource: 'llm',
        boundingBoxes: [
          {
            imageId: 'img_1',
            x: 0.2,
            y: 0.4,
            w: 0.2,
            h: 0.02,
            tileBox: { x: 0.15, y: 0.25, w: 0.3, h: 0.25 },
          },
        ],
      }),
    ).toBeNull();
  });

  it('T-AI-055d - the crop is sized from the tile, not from the caption line', () => {
    const { crops } = score();
    expect(crops.length).toBeGreaterThan(0);

    for (const c of crops) {
      // A caption line is a few percent tall; a tile is not. If the crop were
      // sized from the caption it would be far shorter than the true tile.
      expect(c.cropH / c.tile.h, `${c.imageId}/${c.title} crop height vs tile`).toBeGreaterThan(
        0.5,
      );
      // And it is not the whole image either — that is the no-crop path.
      expect(c.cropW, `${c.imageId}/${c.title} crop width`).toBeLessThan(1);
      expect(c.cropH / Math.max(c.captionH, 1e-6)).toBeGreaterThan(1);
    }
  });
});
