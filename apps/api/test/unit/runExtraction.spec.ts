/**
 * The inline extraction runner — TASK-058.
 *
 * WHY THESE ARE UNIT TESTS WHEN THE SPEC TYPES THE IDS `I`
 * -------------------------------------------------------
 * `specs/testing.md` types `T-BATCH-007`, `T-EXT-010` and `T-AI-036` as
 * INTEGRATION. Every property they name — serial processing, the batch
 * ceiling, progress, the degraded verdict — lives in the runner's state
 * machine, which takes injected ports and touches no database, so this is the
 * layer where the behaviour actually is.
 *
 * It also has to be. `npm run coverage` excludes the integration project, so a
 * state machine proven only by an integration test scores as UNCOVERED against
 * a 90/85 floor. The integration legs that genuinely need a database — a real
 * batch reaching `in-review`, `provenance.removed` being empty — need the
 * review-close endpoint (TASK-072) and the matching pipeline (TASK-057/060),
 * neither of which exists. That split is reported, not papered over.
 *
 * The `T-AI-036` case below therefore proves the runner's HALF of the
 * requirement: a degraded batch completes and carries `degradedExtraction`
 * as state. The other half — that the flag forces `computeRemovals: false`
 * and yields `provenance.removed.length === 0` — belongs to review-close and
 * is NOT claimed here.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  ExtractorError,
  type ExtractedTextItem,
  type ExtractionResult,
  type TitleExtractor,
} from '@nextup/domain';

import { AppError } from '../../src/errors/AppError.js';
import {
  EXTRACTION_BATCH_TIMEOUT_MS,
  EXTRACTION_IMAGE_CONCURRENCY,
  runExtraction,
  type ExtractionImageRef,
  type RunExtractionPorts,
} from '../../src/jobs/runExtraction.js';

function image(n: number, format: 'png' | 'jpeg' = 'png'): ExtractionImageRef {
  return {
    imageId: `img-${String(n)}`,
    fileName: `shot-${String(n)}.${format === 'png' ? 'PNG' : 'JPG'}`,
    format,
    blobPath: `owner/batch/img-${String(n)}.${format}`,
  };
}

function item(rawText: string): ExtractedTextItem {
  return {
    rawText,
    inferredTitle: rawText,
    basis: 'text',
    ocrSupport: 'exact',
    provider: 'llm',
    boundingBox: { x: 0, y: 0, w: 0.2, h: 0.3 },
    boxSource: 'ocr',
    confidence: 0.9,
  };
}

function result(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    items: [item('Dune')],
    crossCheck: 'ok',
    providerMeta: {},
    ...overrides,
  };
}

interface Harness {
  ports: RunExtractionPorts;
  recorded: Array<{ imageId: string; count: number }>;
  progressLog: Array<{ imagesDone: number; imagesTotal: number }>;
  logs: Array<{ event: string; fields: Record<string, unknown> }>;
  /** Advance the fake clock, in ms. */
  advance(ms: number): void;
}

function harness(overrides: Partial<RunExtractionPorts> = {}): Harness {
  const recorded: Harness['recorded'] = [];
  const progressLog: Harness['progressLog'] = [];
  const logs: Harness['logs'] = [];
  let clock = 1_000;

  const ports: RunExtractionPorts = {
    loadImageBytes: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    recordItems: (img, items) => {
      recorded.push({ imageId: img.imageId, count: items.length });
      // The stub stands in for stage 2, which never drops a row — so the
      // post-cleanup count is the item count unless a case overrides it.
      return Promise.resolve(items.length);
    },
    reportProgress: (p) => {
      progressLog.push({ ...p });
    },
    now: () => clock,
    log: (event, fields) => {
      logs.push({ event, fields });
    },
    ...overrides,
  };

  return {
    ports,
    recorded,
    progressLog,
    logs,
    advance: (ms) => {
      clock += ms;
    },
  };
}

/** An extractor whose behaviour per call is scripted. */
function scripted(
  script: Array<ExtractionResult | Error>,
  hooks: { onCall?: () => void; onSettle?: () => void } = {},
): TitleExtractor {
  let index = 0;
  return {
    name: 'stub',
    extract: async (): Promise<ExtractionResult> => {
      hooks.onCall?.();
      const step = script[index] ?? script[script.length - 1];
      index += 1;
      // A microtask boundary, so a concurrency bug would actually interleave.
      await Promise.resolve();
      hooks.onSettle?.();
      if (step instanceof Error) throw step;
      return step as ExtractionResult;
    },
  };
}

describe('T-EXT-010 the runner processes every image and advances progress', () => {
  it('T-EXT-010 · US-006 AC-1 · every image is processed and imagesDone advances to the total', async () => {
    const h = harness();
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2), image(3)],
      extractor: scripted([result()]),
      ports: h.ports,
    });

    expect(outcome.status).toBe('in-review');
    expect(outcome.progress).toEqual({ imagesDone: 3, imagesTotal: 3 });
    // Progress is reported AFTER each image, monotonically — a status page
    // polling mid-batch must never see it go backwards or jump to the end.
    expect(h.progressLog.map((p) => p.imagesDone)).toEqual([1, 2, 3]);
  });

  it('T-EXT-010a · per-image candidate counts are recorded, in order', async () => {
    const h = harness();
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2)],
      extractor: scripted([
        result({ items: [item('Dune'), item('Arrival')] }),
        result({ items: [item('Heat')] }),
      ]),
      ports: h.ports,
    });

    expect(h.recorded).toEqual([
      { imageId: 'img-1', count: 2 },
      { imageId: 'img-2', count: 1 },
    ]);
    expect(outcome.stats.candidatesRaw).toBe(3);
    expect(outcome.stats.imagesProcessed).toBe(2);
  });

  it('T-EXT-010b · an image that yields nothing is counted, not dropped', async () => {
    const h = harness();
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2)],
      extractor: scripted([result({ items: [] }), result()]),
      ports: h.ports,
    });

    expect(outcome.stats.imagesWithZeroCandidates).toBe(1);
    expect(outcome.stats.imagesProcessed).toBe(2);
  });

  it('T-EXT-010c · the correct MIME type is derived from the STORED format, and HEIC never appears', async () => {
    const seen: string[] = [];
    const extractor: TitleExtractor = {
      name: 'stub',
      extract: (_b, mime) => {
        seen.push(mime);
        return Promise.resolve(result());
      },
    };
    await runExtraction({
      batchId: 'batch-1',
      images: [image(1, 'png'), image(2, 'jpeg')],
      extractor,
      ports: harness().ports,
    });

    expect(seen).toEqual(['image/png', 'image/jpeg']);
  });

  it('T-EXT-010d · an empty batch completes without inventing progress', async () => {
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [],
      extractor: scripted([result()]),
      ports: harness().ports,
    });

    expect(outcome.status).toBe('in-review');
    expect(outcome.progress).toEqual({ imagesDone: 0, imagesTotal: 0 });
  });

  it('T-EXT-010e · the decode sentinel brackets every image (A43-M5)', async () => {
    const h = harness();
    await runExtraction({
      batchId: 'batch-1',
      images: [image(1)],
      extractor: scripted([result()]),
      ports: h.ports,
    });

    // A `begin` with no `end` is the ONLY signal that names the image which
    // killed the container, because a kernel OOM kill raises nothing to catch.
    expect(h.logs.map((l) => l.event)).toEqual(['image.decode.begin', 'image.decode.end']);
    expect(h.logs[0]?.fields['imageId']).toBe('img-1');
  });
});

describe('T-BATCH-007 the runner honours its operational ceilings', () => {
  it('T-BATCH-007 · RSK-016 · images are processed STRICTLY SERIALLY, never two in flight', async () => {
    // The discriminating shape. Each in-flight image holds a decoded raster,
    // and the 25 MP pre-decode guard is sized for ONE: two 24 MP images each
    // pass it individually and together exhaust a 0.5 GiB container, which the
    // guard cannot see. A `Promise.all` here would show peak 2.
    let inFlight = 0;
    let peak = 0;
    const extractor = scripted([result()], {
      onCall: () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
      },
      onSettle: () => {
        inFlight -= 1;
      },
    });

    await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2), image(3), image(4)],
      extractor,
      ports: harness().ports,
    });

    expect(peak).toBe(1);
    expect(EXTRACTION_IMAGE_CONCURRENCY).toBe(1);
  });

  it('T-BATCH-007a · the whole-batch ceiling is 15 minutes', () => {
    expect(EXTRACTION_BATCH_TIMEOUT_MS).toBe(900_000);
  });

  it('T-BATCH-007b · a batch that overruns the ceiling between images fails, and changes nothing', async () => {
    const h = harness();
    // Two images: the first succeeds, then the clock jumps past the ceiling.
    const extractor = scripted([result()], {
      onSettle: () => {
        h.advance(EXTRACTION_BATCH_TIMEOUT_MS + 1);
      },
    });

    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2)],
      extractor,
      ports: h.ports,
    });

    expect(outcome.status).toBe('extraction-failed');
    if (outcome.status !== 'extraction-failed') throw new Error('unreachable');
    expect(outcome.errorCode).toBe('EXTRACTOR_ERROR');
    expect(outcome.errorMessage).toContain('15-minute');
    // A failed batch changes no list state (`T-AI-015`) and says so.
    expect(outcome.errorMessage).toContain('Nothing was changed');
    // The second image was never read.
    expect(h.recorded).toHaveLength(1);
  });

  it('T-BATCH-007c · a reader that HANGS is stopped by the ceiling rather than running forever', async () => {
    vi.useFakeTimers();
    try {
      const hanging: TitleExtractor = {
        name: 'stub',
        extract: () =>
          new Promise<ExtractionResult>(() => {
            // never settles
          }),
      };
      const run = runExtraction({
        batchId: 'batch-1',
        images: [image(1)],
        extractor: hanging,
        ports: harness().ports,
        timeoutMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(1_001);
      const outcome = await run;

      expect(outcome.status).toBe('extraction-failed');
      if (outcome.status !== 'extraction-failed') throw new Error('unreachable');
      expect(outcome.errorCode).toBe('EXTRACTOR_ERROR');
    } finally {
      vi.useRealTimers();
    }
  });

  it('T-BATCH-007d · estimatedCostUsd is summed across images into extractionStats', async () => {
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2)],
      extractor: scripted([
        result({ providerMeta: { estimatedCostUsd: 0.012 } }),
        result({ providerMeta: { estimatedCostUsd: 0.008 } }),
      ]),
      ports: harness().ports,
    });

    expect(outcome.stats.estimatedCostUsd).toBeCloseTo(0.02, 6);
  });

  it('T-BATCH-007e · NFR-012a · a missing or malformed cost never fails the import', async () => {
    // Cost is observability. Losing the figure must not cost the owner their
    // extraction — and it must not silently become NaN either, which would
    // poison the whole batch's total.
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2), image(3)],
      extractor: scripted([
        result({ providerMeta: {} }),
        result({ providerMeta: { estimatedCostUsd: Number.NaN } }),
        result({ providerMeta: { estimatedCostUsd: 0.005 } }),
      ]),
      ports: harness().ports,
    });

    expect(outcome.status).toBe('in-review');
    expect(outcome.stats.estimatedCostUsd).toBeCloseTo(0.005, 6);
  });
});

describe('T-AI-036 degraded extraction completes and is carried as state', () => {
  it('T-AI-036 · US-014 AC-6 · an OCR-only batch COMPLETES and is flagged degraded', async () => {
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2)],
      extractor: scripted([result({ crossCheck: 'llm-unavailable' }), result()]),
      ports: harness().ports,
    });

    // Degraded is strictly better than failing: the owner keeps the read.
    expect(outcome.status).toBe('in-review');
    if (outcome.status !== 'in-review') throw new Error('unreachable');
    expect(outcome.degradedExtraction).toBe(true);
    expect(outcome.crossCheck).toBe('llm-unavailable');
  });

  it('T-AI-036a · the cross-check verdict is WORST-OF, never last-wins', async () => {
    // The discriminating order: the degraded image comes FIRST and a clean one
    // LAST. Under a last-wins fold the batch would report `ok`, and `ok` is
    // what permits full-update removals — so a batch that lost a reader would
    // propose deletions. Product invariant 2, in the direction that loses data.
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2)],
      extractor: scripted([
        result({ crossCheck: 'llm-unavailable' }),
        result({ crossCheck: 'ok' }),
      ]),
      ports: harness().ports,
    });

    if (outcome.status !== 'in-review') throw new Error('unreachable');
    expect(outcome.crossCheck).toBe('llm-unavailable');
    expect(outcome.degradedExtraction).toBe(true);
  });

  it('T-AI-036b · a missing OCR leg is NOT degraded — the primary reader worked', async () => {
    // `specs/ai.md` §2.2: with the LLM up and OCR down, removals are still
    // permitted. Collapsing the two outcomes into one "something failed" flag
    // would needlessly withhold every removal the owner asked for.
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1)],
      extractor: scripted([result({ crossCheck: 'ocr-unavailable' })]),
      ports: harness().ports,
    });

    if (outcome.status !== 'in-review') throw new Error('unreachable');
    expect(outcome.crossCheck).toBe('ocr-unavailable');
    expect(outcome.degradedExtraction).toBe(false);
  });

  it('T-AI-036c · llm-unavailable outranks ocr-unavailable across images', async () => {
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2)],
      extractor: scripted([
        result({ crossCheck: 'ocr-unavailable' }),
        result({ crossCheck: 'llm-unavailable' }),
      ]),
      ports: harness().ports,
    });

    if (outcome.status !== 'in-review') throw new Error('unreachable');
    expect(outcome.crossCheck).toBe('llm-unavailable');
  });
});

describe('T-AI-036 batch-fatal reader failures never stage a partial extraction', () => {
  it('T-AI-036d · T-AI-014 · a reader failure after retries fails the WHOLE batch', async () => {
    // The safety property that matters most here: a partially-extracted
    // full-update batch is indistinguishable from a shelf of titles the owner
    // deleted. No partial extraction is ever staged for review.
    const h = harness();
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2), image(3)],
      extractor: scripted([
        result(),
        new ExtractorError('invalid-response', 'llm-vision', 'schema invalid after retries'),
        result(),
      ]),
      ports: h.ports,
    });

    expect(outcome.status).toBe('extraction-failed');
    if (outcome.status !== 'extraction-failed') throw new Error('unreachable');
    expect(outcome.errorCode).toBe('EXTRACTOR_ERROR');
    // It stopped: image 3 was never read.
    expect(h.recorded.map((r) => r.imageId)).toEqual(['img-1']);
  });

  it('T-AI-036e · US-006 AC-5 · exhausted availability maps to EXTRACTOR_UNAVAILABLE', async () => {
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1)],
      extractor: scripted([new ExtractorError('unavailable', 'llm-vision', '429 after retries')]),
      ports: harness().ports,
    });

    if (outcome.status !== 'extraction-failed') throw new Error('unreachable');
    expect(outcome.errorCode).toBe('EXTRACTOR_UNAVAILABLE');
  });

  it('T-AI-036f · a truncated tile list is an ERROR, never a complete result', async () => {
    // `finish_reason: 'length'`. A short list of tiles reads, in full-update
    // mode, as a wave of removals — so it must never be treated as success.
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1)],
      extractor: scripted([new ExtractorError('truncated', 'llm-vision', 'finish_reason=length')]),
      ports: harness().ports,
    });

    expect(outcome.status).toBe('extraction-failed');
  });

  it('T-AI-036g · US-034 AC-5 · purged images fail the batch as IMAGES_PURGED', async () => {
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1)],
      extractor: scripted([result()]),
      ports: harness({
        loadImageBytes: () =>
          Promise.reject(
            new AppError('IMAGES_PURGED', 410, 'Those screenshots have passed their 30 days.'),
          ),
      }).ports,
    });

    if (outcome.status !== 'extraction-failed') throw new Error('unreachable');
    expect(outcome.errorCode).toBe('IMAGES_PURGED');
  });

  it('T-AI-036h · an infrastructure fault PROPAGATES, and is never reported as a bad screenshot', async () => {
    // A storage outage is not a verdict about the owner's image. Swallowing it
    // into `rejected[]` would tell them to re-export a perfectly good file.
    await expect(
      runExtraction({
        batchId: 'batch-1',
        images: [image(1)],
        extractor: scripted([result()]),
        ports: harness({ loadImageBytes: () => Promise.reject(new Error('socket hang up')) }).ports,
      }),
    ).rejects.toThrow('socket hang up');
  });

  it('T-AI-036i · a non-extractor programming fault propagates rather than failing the batch quietly', async () => {
    await expect(
      runExtraction({
        batchId: 'batch-1',
        images: [image(1)],
        extractor: scripted([new TypeError("Cannot read properties of undefined (reading 'x')")]),
        ports: harness().ports,
      }),
    ).rejects.toThrow(TypeError);
  });
});

describe('T-BATCH-007 a memory failure fails ONE image, never the batch', () => {
  it('T-BATCH-007f · A43-M2 · an OOM on image 2 of 3 leaves the other two extracted', async () => {
    const h = harness();
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2), image(3)],
      extractor: scripted([
        result(),
        new AppError(
          'IMAGE_DECODE_OOM',
          503,
          'ran out of memory — see runbooks/scale-up-memory.md',
        ),
        result(),
      ]),
      ports: h.ports,
    });

    // The blast radius is exactly one image.
    expect(outcome.status).toBe('in-review');
    if (outcome.status !== 'in-review') throw new Error('unreachable');
    expect(outcome.imageFailures).toHaveLength(1);
    expect(outcome.imageFailures[0]?.imageId).toBe('img-2');
    expect(h.recorded.map((r) => r.imageId)).toEqual(['img-1', 'img-3']);
    // Progress still reaches the total: the owner is not left at 2/3 forever.
    expect(outcome.progress).toEqual({ imagesDone: 3, imagesTotal: 3 });
  });

  it('T-BATCH-007g · A43-M3 · the compliant memory message is passed through, not rewritten', async () => {
    // The wording that satisfies `T-IMG-020` is composed at the layer that
    // knows the megapixel numbers (`images/transcode.ts`). The runner must
    // carry it verbatim — re-writing it here would produce a second, drifting
    // copy of the one message A43-M3 specifies.
    const compliant =
      'That image ran out of memory while being opened. This is a memory limit, ' +
      'not a problem with your image. No other image in this batch was affected; ' +
      're-attach this file after up-sizing compute — see docs/runbooks/scale-up-memory.md.';
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2)],
      extractor: scripted([new AppError('IMAGE_TOO_LARGE_TO_DECODE', 413, compliant), result()]),
      ports: harness().ports,
    });

    if (outcome.status !== 'in-review') throw new Error('unreachable');
    // RSK-016's complaint was never "it runs out of memory", it was "the
    // failure is undiagnosable". A named cause plus a named remedy fixes that.
    expect(outcome.imageFailures[0]?.code).toBe('IMAGE_TOO_LARGE_TO_DECODE');
    expect(outcome.imageFailures[0]?.message).toBe(compliant);
    expect(outcome.imageFailures[0]?.message).toContain('memory');
    expect(outcome.imageFailures[0]?.message).toContain('runbooks/scale-up-memory.md');
  });

  it('T-BATCH-007h · a BARE RangeError from an unwrapped decoder is still recognised as OOM', async () => {
    // The likelier of the two catchable shapes. `heic-convert` raises a plain
    // `RangeError` with nothing but a message; classifying only pre-wrapped
    // `AppError`s would let this one fail the entire batch as a reader fault.
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2)],
      extractor: scripted([new RangeError('Array buffer allocation failed'), result()]),
      ports: harness().ports,
    });

    expect(outcome.status).toBe('in-review');
    if (outcome.status !== 'in-review') throw new Error('unreachable');
    expect(outcome.imageFailures[0]?.code).toBe('IMAGE_DECODE_OOM');
    expect(outcome.imageFailures[0]?.message).toContain('memory');
    expect(outcome.imageFailures[0]?.message).toContain('runbooks/scale-up-memory.md');
  });

  it('T-BATCH-007i · a corrupt file fails one image and mentions NEITHER memory NOR the runbook', async () => {
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2)],
      extractor: scripted([
        new AppError(
          'IMAGE_DECODE_FAILED',
          415,
          "That image couldn't be read. Try re-exporting it.",
        ),
        result(),
      ]),
      ports: harness().ports,
    });

    if (outcome.status !== 'in-review') throw new Error('unreachable');
    const failure = outcome.imageFailures[0];
    expect(failure?.code).toBe('IMAGE_DECODE_FAILED');
    // Sending the owner to buy memory for a truncated file is advice that can
    // never work (`T-IMG-020`).
    expect(failure?.message.toLowerCase()).not.toContain('memory');
    expect(failure?.message).not.toContain('scale-up-memory');
  });

  it('T-BATCH-007j · when EVERY image fails on memory the batch fails rather than reviewing nothing', async () => {
    // An `in-review` batch that read nothing at all would, in full-update
    // mode, propose removing the owner's entire list.
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2)],
      extractor: scripted([new AppError('IMAGE_DECODE_OOM', 503, 'oom')]),
      ports: harness().ports,
    });

    expect(outcome.status).toBe('extraction-failed');
    if (outcome.status !== 'extraction-failed') throw new Error('unreachable');
    expect(outcome.errorCode).toBe('EXTRACTOR_ERROR');
  });
});

describe('T-AI-021 the runner raises lowYield from what it actually read', () => {
  it('T-AI-021v · a healthy batch reports lowYield false and a post-cleanup count', async () => {
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2)],
      extractor: scripted([result({ items: [item('Dune'), item('Arrival')] })]),
      ports: harness().ports,
    });

    expect(outcome.status).toBe('in-review');
    if (outcome.status !== 'in-review') throw new Error('unreachable');
    expect(outcome.lowYield).toBe(false);
    expect(outcome.stats.candidatesAfterCleanup).toBe(4);
  });

  it('T-AI-021w · a batch that read nothing reports lowYield true', async () => {
    // The blank-screenshot case, at the runner boundary. Until TASK-084 this
    // batch reached review with lowYield false and, in full-update, proposed
    // removing every title the owner had.
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2)],
      extractor: scripted([result({ items: [] })]),
      ports: harness().ports,
    });

    expect(outcome.status).toBe('in-review');
    if (outcome.status !== 'in-review') throw new Error('unreachable');
    expect(outcome.lowYield).toBe(true);
    expect(outcome.stats.candidatesAfterCleanup).toBe(0);
  });

  it('T-AI-021x · half the images blank is low yield even though the rest read fine', async () => {
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1), image(2)],
      extractor: scripted([result({ items: [] }), result({ items: [item('Dune')] })]),
      ports: harness().ports,
    });

    expect(outcome.status).toBe('in-review');
    if (outcome.status !== 'in-review') throw new Error('unreachable');
    expect(outcome.stats.candidatesAfterCleanup).toBe(1);
    expect(outcome.lowYield).toBe(true);
  });

  it('T-AI-021y · the count comes from recordItems, NOT from the raw item count', async () => {
    // Stage 2 lives behind the port and MERGES fragments of one caption, so
    // the runner cannot substitute `items.length`. A three-fragment read of a
    // single title is a one-candidate image; counting it as three would report
    // a healthy read of a screenshot that yielded one title.
    const h = harness({
      recordItems: () => Promise.resolve(1),
    });
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1)],
      extractor: scripted([result({ items: [item('Du'), item('ne'), item('Part Two')] })]),
      ports: h.ports,
    });

    expect(outcome.status).toBe('in-review');
    if (outcome.status !== 'in-review') throw new Error('unreachable');
    expect(outcome.stats.candidatesRaw).toBe(3);
    expect(outcome.stats.candidatesAfterCleanup).toBe(1);
  });

  it('T-AI-021z · lowYield is independent of degradedExtraction', async () => {
    // Two separate flags with two separate causes. A fully corroborated read
    // of blank screenshots is low yield and NOT degraded; conflating them
    // would make a clean reader outage look like a thin read, and vice versa.
    const outcome = await runExtraction({
      batchId: 'batch-1',
      images: [image(1)],
      extractor: scripted([result({ items: [], crossCheck: 'ok' })]),
      ports: harness().ports,
    });

    expect(outcome.status).toBe('in-review');
    if (outcome.status !== 'in-review') throw new Error('unreachable');
    expect(outcome.lowYield).toBe(true);
    expect(outcome.degradedExtraction).toBe(false);
  });
});
