import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { tileCropFor, type LlmTile, type OcrLine } from '@nextup/domain';
import { HybridExtractor } from '../../../src/extraction/hybridExtractor.js';
import { luminanceRasterFrom } from '../../../src/images/luminanceRaster.js';
import { parseBoundingBoxes, readTileCoverage } from '../../../src/routes/batchReview.js';
import { runExtraction } from '../../../src/jobs/runExtraction.js';

async function screenshot(alpha = false): Promise<Buffer> {
  const channels = alpha ? 4 : 3;
  const data = Buffer.alloc(1000 * 100 * channels, 10);
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 1000; x++) {
      const start = (y * 1000 + x) * channels;
      if (y >= 20 && y < 80 && x % 200 >= 10) data.fill(200, start, start + 3);
      if (alpha) data[start + 3] = 255;
    }
  }
  return sharp(data, { raw: { width: 1000, height: 100, channels } })
    .png()
    .toBuffer();
}

/**
 * T-AI-063 crosses the seams that made the old crop tests vacuous: real image
 * bytes -> shipped hybrid -> measured geometry -> JSON parser -> review crop.
 * Fake reader responses isolate paid services; neither the detector nor merge
 * is mocked. Additional cases make refusal, alpha PNGs and stored-stat parsing
 * observable. Historical payloads must not claim that an unmeasured image was
 * empty, and stats cannot mint a link to an image outside this owner's batch.
 */
describe('T-AI-063 - image evidence wiring', () => {
  it('T-AI-063h - a corrupt raster fails only its image and keeps the batch reviewable', async () => {
    const valid = await screenshot();
    const extractor = new HybridExtractor({
      llm: { readTiles: async () => [] },
      vision: { readLines: async () => [] },
    });
    const recorded: string[] = [];
    const outcome = await runExtraction({
      batchId: 'batch',
      images: ['bad', 'good'].map((imageId) => ({
        imageId,
        fileName: `${imageId}.png`,
        format: 'png',
        blobPath: imageId,
      })),
      extractor,
      ports: {
        loadImageBytes: async (image) =>
          image.imageId === 'bad' ? Buffer.from('not an image') : valid,
        recordItems: async (image) => {
          recorded.push(image.imageId);
          return 0;
        },
        reportProgress: () => undefined,
        now: () => 0,
      },
    });
    expect(outcome.status).toBe('in-review');
    expect(recorded).toEqual(['good']);
    expect(outcome.imageFailures).toHaveLength(1);
    expect(outcome.imageFailures[0]).toMatchObject({ imageId: 'bad', code: 'IMAGE_DECODE_FAILED' });
    expect(outcome.imageFailures[0]?.message).not.toMatch(/memory|runbook/i);
  });

  it('T-AI-063a - real pixels reach the review crop and coverage without extra reader calls', async () => {
    const llm: LlmTile[] = [
      {
        visibleText: 'The Film',
        identifiedTitle: 'The Film',
        basis: 'text',
        confidence: 0.9,
        box: { x: 0.7, y: 0.2, w: 0.2, h: 0.6 },
      },
    ];
    const ocr: OcrLine[] = [
      {
        text: 'The Film',
        confidence: 0.9,
        box: { x: 0.04, y: 0.3, w: 0.1, h: 0.04 },
      },
    ];
    const readTiles = vi.fn(async () => llm);
    const readLines = vi.fn(async () => ocr);
    const result = await new HybridExtractor({
      llm: { readTiles },
      vision: { readLines },
    }).extract(await screenshot(), 'image/png');
    expect(readTiles).toHaveBeenCalledTimes(1);
    expect(readLines).toHaveBeenCalledTimes(1);
    // The OCR orphan is retained, never silently deleted. Two candidate rows
    // still occupy ONE tile, so they cannot cover a missing neighbour.
    expect(result.tileCoverage).toEqual({ detectedTiles: 5, locatedTiles: 1, titleCandidates: 2 });
    const candidate = result.items[0]!;
    const crop = tileCropFor({
      boxSource: candidate.boxSource,
      boundingBoxes: parseBoundingBoxes(
        JSON.stringify([{ imageId: 'img', ...candidate.boundingBox }]),
      ),
    });
    expect(crop).not.toBeNull();
    expect(crop?.x).toBeLessThan(0.02);
    expect(crop?.w).toBeGreaterThan(0.18);
    expect(crop?.w).toBeLessThan(0.21);
    expect(crop?.h).toBeCloseTo(0.6, 1);
  });

  it('T-AI-063b - a rejected layout preserves the original extraction without invented counts', async () => {
    const bytes = await sharp({
      create: {
        width: 200,
        height: 100,
        channels: 3,
        background: '#141414',
      },
    })
      .png()
      .toBuffer();
    const result = await new HybridExtractor({
      llm: { readTiles: async () => [] },
      vision: { readLines: async () => [] },
    }).extract(bytes, 'image/png');
    expect(result.items).toEqual([]);
    expect(result.tileCoverage).toBeUndefined();
  });

  it('T-AI-063c - opaque alpha PNGs produce the same single-channel raster as RGB', async () => {
    const a = await luminanceRasterFrom(await screenshot(false));
    const b = await luminanceRasterFrom(await screenshot(true));
    expect(b.data).toHaveLength(b.width * b.height);
    expect(b).toEqual(a);
  });

  it('T-AI-063d - persisted coverage is validated and scoped to the batch images', () => {
    const images = [{ id: 'img', fileName: 'shot.png' }];
    const entry = { imageId: 'img', detectedTiles: 5, locatedTiles: 2, titleCandidates: 3 };
    const stats = (value: unknown) => JSON.stringify({ stage1: { tileCoverage: value } });
    expect(readTileCoverage(stats([entry, { ...entry, imageId: 'foreign' }]), images)).toEqual([
      {
        ...entry,
        fileName: 'shot.png',
        href: '/api/images/img',
      },
    ]);
    for (const raw of [
      null,
      '',
      '{',
      '{}',
      '{"stage1":null}',
      '{"stage1":{"tileCoverage":null}}',
      stats([null]),
      stats([{ ...entry, locatedTiles: 6 }]),
      stats([{ ...entry, detectedTiles: 1.5 }]),
      stats([{ ...entry, titleCandidates: -1 }]),
      stats([{ ...entry, detectedTiles: '5' }]),
    ]) {
      expect(readTileCoverage(raw, images)).toEqual([]);
    }
    expect(
      parseBoundingBoxes(
        JSON.stringify([
          {
            imageId: 'img',
            x: 0,
            y: 0,
            w: 0.1,
            h: 0.1,
            gridTileBox: { x: 'bad' },
          },
        ]),
      ),
    ).toEqual([{ imageId: 'img', x: 0, y: 0, w: 0.1, h: 0.1 }]);
    const boxes = parseBoundingBoxes(
      JSON.stringify([
        {
          imageId: 'img',
          x: 0.1,
          y: 0.3,
          w: 0.1,
          h: 0.03,
          gridTileBox: { imageId: 'foreign', x: 0, y: 0.2, w: 0.4, h: 0.5 },
        },
      ]),
    );
    expect(tileCropFor({ boxSource: 'ocr', boundingBoxes: boxes })?.imageId).toBe('img');
  });
});
