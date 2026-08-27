/**
 * TASK-058 wiring — `startExtraction`, the only caller of `runExtraction`.
 *
 * `runExtraction` itself is already proven against injected ports
 * (`runExtraction.spec.ts`). What was NOT proven, because nothing called it,
 * is everything this module owns: claiming the batch, building a reader from
 * the environment, turning items into rows, and — above all — that no failure
 * path can leave a batch sitting in `extracting` while the SPA polls it
 * forever. Those are the assertions here.
 *
 * The repository and blob store are stubbed. Every property below is a branch
 * of this module's own logic; the properties that genuinely depend on the
 * store (the claim being atomic under concurrency, a candidate row satisfying
 * its CHECK constraints) belong in the integration suite, where a stub would
 * be agreement rather than evidence.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExtractedTextItem, ExtractionResult, TitleExtractor } from '@nextup/domain';

import {
  beginExtraction,
  extractionPorts,
  extractionSettled,
  startExtraction,
} from '../../src/jobs/startExtraction.js';
import {
  createExtractionCandidate,
  listImagesForBatch,
  recordExtractionOutcome,
  transitionUploadBatchStatus,
  type OwnerId,
} from '../../src/repository/ownerData.js';

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    createExtractionCandidate: vi.fn(),
    listImagesForBatch: vi.fn(),
    recordExtractionOutcome: vi.fn(),
    transitionUploadBatchStatus: vi.fn(),
  };
});

const OWNER = 'owner-hash' as OwnerId;
const BATCH = 'batch-1';

const mockCreate = vi.mocked(createExtractionCandidate);
const mockImages = vi.mocked(listImagesForBatch);
const mockRecord = vi.mocked(recordExtractionOutcome);
const mockClaim = vi.mocked(transitionUploadBatchStatus);

function imageRow(id: string) {
  return {
    id,
    batchId: BATCH,
    fileName: `${id}.png`,
    format: 'png',
    blobPath: `o/${BATCH}/${id}.png`,
  } as never;
}

function item(over: Partial<ExtractedTextItem> = {}): ExtractedTextItem {
  return {
    rawText: 'Arcane',
    inferredTitle: 'Arcane',
    basis: 'text',
    ocrSupport: 'exact',
    provider: 'llm',
    boundingBox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
    boxSource: 'ocr',
    confidence: 0.9,
    ...over,
  };
}

function extractorReturning(result: Partial<ExtractionResult> = {}): TitleExtractor {
  return {
    name: 'hybrid',
    extract: vi.fn(async (): Promise<ExtractionResult> => ({
      items: [item()],
      crossCheck: 'ok',
      providerMeta: {},
      ...result,
    })),
  };
}

/** The bytes are never decoded here — the extractor is a stub. */
const blobStore = {
  get: vi.fn(async () => new Uint8Array([1, 2, 3])),
  put: vi.fn(),
  remove: vi.fn(),
};

/** The last `extractionStats` JSON written, parsed. */
function lastStats(): Record<string, unknown> {
  const calls = mockRecord.mock.calls;
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const stats = calls[i]?.[2]?.extractionStats;
    if (typeof stats === 'string') return JSON.parse(stats) as Record<string, unknown>;
  }
  throw new Error('no extractionStats written');
}

/** The last recorded status, whatever else was written alongside it. */
function lastStatus(): unknown {
  const calls = mockRecord.mock.calls;
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const status = calls[i]?.[2]?.status;
    if (status !== undefined) return status;
  }
  return undefined;
}

beforeEach(() => {
  vi.resetAllMocks();
  blobStore.get.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockClaim.mockResolvedValue(1);
  mockImages.mockResolvedValue([imageRow('img-1')] as never);
  mockRecord.mockResolvedValue({ count: 1 } as never);
  mockCreate.mockResolvedValue({} as never);
});

describe('startExtraction', () => {
  it('T-EXT-010f claims the batch with a conditional submitted -> extracting move', async () => {
    await startExtraction(OWNER, BATCH, { blobStore, extractor: extractorReturning() });

    // The `from` argument is the concurrency control: without it two
    // overlapping submits both extract the same batch.
    expect(mockClaim).toHaveBeenCalledWith(
      OWNER,
      BATCH,
      'submitted',
      expect.objectContaining({ status: 'extracting' }),
    );
    const data = mockClaim.mock.calls[0]?.[3] as { extractionStartedAt?: Date };
    expect(data.extractionStartedAt).toBeInstanceOf(Date);
  });

  it('T-EXT-010g does nothing at all when the claim is lost', async () => {
    mockClaim.mockResolvedValue(0);
    const extractor = extractorReturning();

    await startExtraction(OWNER, BATCH, { blobStore, extractor });

    expect(extractor.extract).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('T-EXT-010h writes one candidate per item, linked to its source image', async () => {
    await startExtraction(OWNER, BATCH, {
      blobStore,
      extractor: extractorReturning({
        items: [item(), item({ rawText: 'Dune', inferredTitle: 'Dune' })],
      }),
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    const [owner, data] = mockCreate.mock.calls[0] as [OwnerId, Record<string, unknown>];
    expect(owner).toBe(OWNER);
    expect(data).toMatchObject({
      batchId: BATCH,
      rawText: 'Arcane',
      inferredTitle: 'Arcane',
      provider: 'llm',
      ocrSupport: 'exact',
      boxSource: 'ocr',
    });
    // The collapse grouping key, not a copy of the raw text.
    expect(data['normalisedText']).toBe('arcane');
    expect(data['sourceImages']).toEqual({
      create: [{ ownerId: OWNER, imageId: 'img-1', ordinal: 0 }],
    });
  });

  it('T-EXT-010i persists degraded/crossCheck as state, not as a recomputable derivation', async () => {
    await startExtraction(OWNER, BATCH, {
      blobStore,
      extractor: extractorReturning({ crossCheck: 'llm-unavailable' }),
    });

    expect(lastStatus()).toBe('in-review');
    const written = mockRecord.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    // Anything other than `ok` forces `computeRemovals: false` downstream, so
    // it MUST survive the round trip to the separate review request.
    expect(written['crossCheck']).toBe('llm-unavailable');
    expect(written['degradedExtraction']).toBe(true);
  });

  it('T-EXT-010j records the stage-1 slice without inventing stage 3-5 zeros', async () => {
    await startExtraction(OWNER, BATCH, { blobStore, extractor: extractorReturning() });

    const stats = lastStats();
    expect(stats['stage1']).toMatchObject({ imagesProcessed: 1, candidatesRaw: 1 });
    expect(stats['progress']).toEqual({ imagesDone: 1, imagesTotal: 1 });
    // A zero is a measurement. Stages 3-5 never ran, so writing theirs would
    // record false ones into the only evidence for RSK-021.
    expect(Object.keys(stats)).not.toContain('matched');
    const stage1Keys = Object.keys(stats['stage1'] as object);
    expect(stage1Keys).not.toContain('candidatesCollapsed');
    expect(stage1Keys).not.toContain('suppressedGated');
    // ⚠ `candidatesAfterCleanup` IS written, and this case used to assert it
    // was not. Stage 2 (`cleanup`) genuinely runs — inside `recordItems`, which
    // is why it looked like it had not — so the count is a real measurement,
    // and `specs/ai.md` §8.1 reads it to decide `lowYield`. Suppressing it to
    // preserve the old "stages 2-5 never ran" wording would have left the
    // low-yield decision with nothing to decide from.
    expect(stats['stage1']).toMatchObject({ candidatesAfterCleanup: 1 });
  });

  it('T-AI-022a persists lowYield as state when the readers produced nothing', async () => {
    // ⚠ THE DEFECT TASK-084 EXISTS FOR. `lowYield` was modelled, persisted,
    // read at review and asserted by T-AI-021 a–m — and no code path anywhere
    // ever set it. This is the case that would have caught that: a batch whose
    // screenshots yielded no titles at all must reach review flagged, because
    // in full-update the flag is the only thing standing between a blank read
    // and a proposal to remove the owner's entire list.
    await startExtraction(OWNER, BATCH, {
      blobStore,
      extractor: extractorReturning({ items: [] }),
    });

    expect(lastStatus()).toBe('in-review');
    const written = mockRecord.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(written['lowYield']).toBe(true);
  });

  it('T-AI-022b writes lowYield FALSE on a healthy read, never leaving it stale', async () => {
    // ⚠ Written in both directions on purpose. A re-extraction (US-034) of a
    // batch that was low yield must clear the flag when the new read is good;
    // an implementation that only ever set it to `true` would leave the owner
    // permanently unable to remove anything from that batch, with no way to
    // tell why.
    await startExtraction(OWNER, BATCH, { blobStore, extractor: extractorReturning() });

    const written = mockRecord.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(written['lowYield']).toBe(false);
  });

  it('T-EXT-010k fails loudly with EXTRACTOR_UNAVAILABLE when no reader is configured', async () => {
    // The capability gate. Nothing here mentions an environment NAME: the
    // condition is that the endpoints are absent, which is what prod looks
    // like today and what a broken staging would look like tomorrow.
    vi.stubEnv('NEXTUP_EXTRACTOR', 'hybrid');
    vi.stubEnv('NEXTUP_VISION_ENDPOINT', '');
    vi.stubEnv('NEXTUP_AOAI_ENDPOINT', '');
    vi.stubEnv('NEXTUP_AOAI_DEPLOYMENT', '');

    await startExtraction(OWNER, BATCH, { blobStore });

    expect(lastStatus()).toBe('extraction-failed');
    const written = mockRecord.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(written['extractionErrorCode']).toBe('EXTRACTOR_UNAVAILABLE');
    expect(written['extractionErrorMessage']).toMatch(/nothing in your list changed/i);
    vi.unstubAllEnvs();
  });

  it('T-EXT-010l never leaves a batch stuck in extracting, whatever throws', async () => {
    // A batch left in `extracting` polls for ever and looks like it is
    // working. Every failure path must land on a terminal, retryable status.
    mockImages.mockRejectedValue(new Error('connection reset'));

    await expect(startExtraction(OWNER, BATCH, { blobStore })).resolves.toBeUndefined();

    expect(lastStatus()).toBe('extraction-failed');
    expect(mockRecord.mock.calls.at(-1)?.[2]?.['extractionErrorCode']).toBe('EXTRACTOR_ERROR');
  });

  it('T-EXT-010m never rejects even when recording the failure also fails', async () => {
    mockImages.mockRejectedValue(new Error('connection reset'));
    mockRecord.mockRejectedValue(new Error('store unreachable'));
    const log = vi.fn();

    // An unhandled rejection here kills a single-process container.
    await expect(startExtraction(OWNER, BATCH, { blobStore, log })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('extraction.failure_write_failed', expect.anything());
  });
});

describe('extractionPorts', () => {
  it('T-EXT-010n reports purged screenshots as IMAGES_PURGED, not a storage fault', async () => {
    blobStore.get.mockResolvedValue(null as never);
    const ports = extractionPorts(OWNER, BATCH, [], { blobStore });

    await expect(
      ports.loadImageBytes({
        imageId: 'img-1',
        fileName: 'a.png',
        format: 'png',
        blobPath: 'gone',
      }),
    ).rejects.toMatchObject({ code: 'IMAGES_PURGED', httpStatus: 410 });
  });

  it('T-EXT-010o swallows a progress write failure rather than failing the image', async () => {
    mockRecord.mockRejectedValue(new Error('transient'));
    const log = vi.fn();
    const ports = extractionPorts(OWNER, BATCH, [], { blobStore, log });

    await expect(ports.reportProgress({ imagesDone: 1, imagesTotal: 2 })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('extraction.progress_write_failed', expect.anything());
  });

  it('T-EXT-010p writes the stage-2 verdict, not a verdict of its own', async () => {
    // The column belongs to `cleanup()` (TASK-057). This asserts the wiring
    // hands the item over rather than re-deciding — an artwork-only title the
    // OCR reader could not corroborate is the RSK-028 fabrication case and
    // must reach review carrying its mandatory thumbnail caution.
    await startExtraction(OWNER, BATCH, {
      blobStore,
      extractor: extractorReturning({
        items: [
          item({ rawText: '', inferredTitle: 'Arcane', basis: 'artwork', ocrSupport: 'none' }),
        ],
      }),
    });

    expect(mockCreate.mock.calls[0]?.[1]).toMatchObject({
      cleanupVerdict: 'inferred-unverified',
      // §3.1a — the identified work drives matching, and `rawText` stays
      // verbatim beside it even when it is empty.
      normalisedText: 'arcane',
      rawText: '',
    });
  });

  it('T-EXT-010r persists the merged candidates, not the raw items', async () => {
    // `cleanup()` may return FEWER rows than it was given (step-1 fragment
    // merging). Iterating the raw items instead would write both fragments as
    // separate candidates and duplicate the title in review.
    await startExtraction(OWNER, BATCH, {
      blobStore,
      extractor: extractorReturning({
        items: [
          item({
            rawText: 'Breaking',
            inferredTitle: null,
            provider: 'ocr-only',
            boundingBox: { x: 0.1, y: 0.2, w: 0.15, h: 0.04 },
          }),
          item({
            rawText: 'Bad',
            inferredTitle: null,
            provider: 'ocr-only',
            boundingBox: { x: 0.26, y: 0.2, w: 0.08, h: 0.04 },
          }),
        ],
      }),
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0]?.[1]).toMatchObject({ rawText: 'Breaking Bad' });
  });

  it('T-EXT-010q marks a tile with neither text nor an identification unreadable', async () => {
    await startExtraction(OWNER, BATCH, {
      blobStore,
      extractor: extractorReturning({
        items: [item({ rawText: '', inferredTitle: null, basis: 'unknown' })],
      }),
    });

    expect(mockCreate.mock.calls[0]?.[1]).toMatchObject({ cleanupVerdict: 'unreadable-tile' });
  });

  it('T-EXT-010s returns before the run settles, and the seam waits for it', async () => {
    // The route must not await extraction — a 202 that waited up to fifteen
    // minutes would make the "client polls" contract a lie. The seam exists so
    // a test can be deterministic about that WITHOUT the route changing.
    let settled = false;
    const extractor: TitleExtractor = {
      name: 'stub',
      async extract() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        settled = true;
        return { items: [], degraded: false } as unknown as ExtractionResult;
      },
    } as unknown as TitleExtractor;

    beginExtraction(OWNER, BATCH, { blobStore, extractor });
    expect(settled).toBe(false);

    await extractionSettled(BATCH);
    expect(settled).toBe(true);
  });

  it('T-EXT-010t resolves immediately for a batch that was never started', async () => {
    // Otherwise a test awaiting a batch it never submitted would hang rather
    // than fail, and the suite would time out with no useful message.
    await expect(extractionSettled('never-started')).resolves.toBeUndefined();
  });

  it('T-EXT-010u never rejects, even when the run throws outright', async () => {
    // An unhandled rejection on a single-process container kills the API.
    const extractor = {
      name: 'stub',
      extract: () => Promise.reject(new Error('boom')),
    } as unknown as TitleExtractor;

    beginExtraction(OWNER, BATCH, { blobStore, extractor });
    await expect(extractionSettled(BATCH)).resolves.toBeUndefined();
  });
});
