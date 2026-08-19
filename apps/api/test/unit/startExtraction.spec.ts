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

import { extractionPorts, startExtraction } from '../../src/jobs/startExtraction.js';
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

  it('T-EXT-010j records the stage-1 slice without inventing stage 2-5 zeros', async () => {
    await startExtraction(OWNER, BATCH, { blobStore, extractor: extractorReturning() });

    const stats = lastStats();
    expect(stats['stage1']).toMatchObject({ imagesProcessed: 1, candidatesRaw: 1 });
    expect(stats['progress']).toEqual({ imagesDone: 1, imagesTotal: 1 });
    // A zero is a measurement. Stages 2-5 never ran, so writing theirs would
    // record five false ones into the only evidence for RSK-021.
    expect(Object.keys(stats)).not.toContain('matched');
    expect(Object.keys(stats['stage1'] as object)).not.toContain('candidatesAfterCleanup');
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

  it('T-EXT-010p marks a model title with no legible text as inferred-unverified', async () => {
    // Provisional until TASK-057 owns the column, and deliberately erring
    // toward a visible caution: `title-candidate` would assert it passed
    // heuristics that have not been written.
    await startExtraction(OWNER, BATCH, {
      blobStore,
      extractor: extractorReturning({
        items: [item({ rawText: '', inferredTitle: 'Arcane', basis: 'artwork' })],
      }),
    });

    expect(mockCreate.mock.calls[0]?.[1]).toMatchObject({ cleanupVerdict: 'inferred-unverified' });
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
});
