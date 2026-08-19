/**
 * TASK-056c — `HybridExtractor` (`specs/ai.md` §2.2 / §2.2a).
 *
 * Test id: `T-AI-036` (degraded mode). `T-AI-036` is also asserted by lane C
 * at the batch-runner level; this file proves the half the runner cannot —
 * that the extractor reports the `crossCheck` outcome the runner branches on.
 * If this layer mislabels a degraded read as `'ok'`, the runner's assertions
 * still pass and a full-update batch proposes removals from a half-read
 * screenshot (product invariant 2).
 */

import { describe, expect, it, vi } from 'vitest';

import { ExtractorError, type LlmTile, type OcrLine } from '@nextup/domain';

import { HybridExtractor } from '../../../src/extraction/hybridExtractor.js';

const BYTES = new Uint8Array([1, 2, 3]);

const tiles: LlmTile[] = [
  {
    visibleText: 'Stranger Things',
    identifiedTitle: 'Stranger Things',
    basis: 'text',
    confidence: 0.9,
    box: { x: 0, y: 0, w: 0.3, h: 0.5 },
  },
];
const lines: OcrLine[] = [
  { text: 'Stranger Things', box: { x: 0.02, y: 0.4, w: 0.26, h: 0.06 }, confidence: 0.9 },
];

const okLlm = { readTiles: vi.fn(async () => tiles) };
const okVision = { readLines: vi.fn(async () => lines) };
const deadLlm = {
  readTiles: vi.fn(async () => {
    throw new ExtractorError('unavailable', 'llm-vision', 'AOAI down');
  }),
};
const deadVision = {
  readLines: vi.fn(async () => {
    throw new ExtractorError('unavailable', 'azure-vision-read', 'Vision down');
  }),
};

describe('HybridExtractor (T-AI-036)', () => {
  it('T-AI-036a - reports crossCheck "ok" and merges both legs when both succeed', async () => {
    const x = new HybridExtractor({ llm: okLlm, vision: okVision });
    const result = await x.extract(BYTES, 'image/png');

    expect(result.crossCheck).toBe('ok');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.ocrSupport).toBe('exact');
    expect(result.providerMeta['llmOk']).toBe(true);
    expect(result.providerMeta['visionOk']).toBe(true);
  });

  it('T-AI-036b - issues both legs in PARALLEL, not one after the other', async () => {
    // Reader concurrency 2 (§2.2). Sequential legs would double per-image
    // latency against the 15-minute batch ceiling for no memory saving —
    // both legs share the one already-decoded raster.
    const order: string[] = [];
    const slowLlm = {
      readTiles: vi.fn(async () => {
        order.push('llm:start');
        await new Promise((r) => setTimeout(r, 20));
        order.push('llm:end');
        return tiles;
      }),
    };
    const slowVision = {
      readLines: vi.fn(async () => {
        order.push('ocr:start');
        await new Promise((r) => setTimeout(r, 20));
        order.push('ocr:end');
        return lines;
      }),
    };

    await new HybridExtractor({ llm: slowLlm, vision: slowVision }).extract(BYTES, 'image/png');

    // Both must have STARTED before either finished.
    expect(order.slice(0, 2).sort()).toEqual(['llm:start', 'ocr:start']);
  });

  it('T-AI-036c - LLM down + OCR up → degraded "llm-unavailable" (removals withheld)', async () => {
    const x = new HybridExtractor({ llm: deadLlm, vision: okVision });
    const result = await x.extract(BYTES, 'image/png');

    // ⚠ Anything other than 'ok' forces computeRemovals: false downstream.
    // This is the row that matters most: an OCR-only read is Revision 1
    // quality, so a full-update batch read this way must never conclude a
    // title was removed.
    expect(result.crossCheck).toBe('llm-unavailable');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.provider).toBe('ocr-only');
    expect(result.providerMeta['llmOk']).toBe(false);
  });

  it('T-AI-036d - OCR down + LLM up → "ocr-unavailable" with ocrSupport not-checked', async () => {
    const x = new HybridExtractor({ llm: okLlm, vision: deadVision });
    const result = await x.extract(BYTES, 'image/png');

    // Removals ARE still permitted here (the primary reader worked) — the
    // asymmetry with the previous case is deliberate, not an oversight.
    expect(result.crossCheck).toBe('ocr-unavailable');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.provider).toBe('llm');
    // 'not-checked' is safety state, NOT a score of zero. Reporting 'none'
    // here would make every candidate look actively uncorroborated and
    // poison the fabrication metric.
    expect(result.items[0]?.ocrSupport).toBe('not-checked');
  });

  it('T-AI-036e - both legs down → throws, preserving the primary reader error', async () => {
    const x = new HybridExtractor({ llm: deadLlm, vision: deadVision });
    await expect(x.extract(BYTES, 'image/png')).rejects.toThrow(ExtractorError);
    await expect(x.extract(BYTES, 'image/png')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('T-AI-036f - never swallows a leg failure into an empty successful read', async () => {
    // The failure mode this guards: catching both rejections and returning
    // `{ items: [], crossCheck: 'ok' }`. In full-update mode zero titles
    // reads as "remove everything", so a silent empty success is the most
    // destructive possible response to an outage.
    const x = new HybridExtractor({ llm: deadLlm, vision: deadVision });
    await expect(x.extract(BYTES, 'image/png')).rejects.toBeInstanceOf(ExtractorError);
  });

  it('T-AI-036g - logs statuses and counts only — never extracted text', async () => {
    const log = vi.fn();
    await new HybridExtractor({ llm: okLlm, vision: okVision, log }).extract(BYTES, 'image/png');

    const event = JSON.stringify(log.mock.calls[0]?.[0]);
    // NFR-009/NFR-015: nothing derived from the owner's screenshot.
    expect(event).not.toContain('Stranger Things');
    expect(log.mock.calls[0]?.[0]).toMatchObject({
      extractor: 'hybrid',
      llmOk: true,
      visionOk: true,
      crossCheck: 'ok',
    });
  });

  it('T-AI-036h - delegates the merge rather than re-implementing one', async () => {
    const spy = vi.fn(() => []);
    const x = new HybridExtractor({ llm: okLlm, vision: okVision, crossCheck: spy });
    await x.extract(BYTES, 'image/png');
    expect(spy).toHaveBeenCalledWith(tiles, lines);
  });
});
