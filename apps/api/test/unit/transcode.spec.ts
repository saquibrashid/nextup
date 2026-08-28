/**
 * TASK-149 — the HEIC/HEIF → lossless PNG transcode
 * (`apps/api/src/images/transcode.ts`, `specs/api.md` §5.1).
 *
 * `T-IMG-013` (HEIC → valid PNG), `T-IMG-015` (corrupt/truncated fails
 * gracefully — no crash, no OOM), `T-IMG-016` (the guard runs FIRST and the
 * bounds are re-asserted on the decoded raster), `T-IMG-023` (the branch is
 * chosen by the sniffed format, never by `ingestSource`).
 *
 * ⚠ WHAT THIS FILE CANNOT ASSERT, AND WHY IT IS NOT A GAP HERE. There is no
 * real `.heic` fixture in the tree yet, and there CANNOT be a generated one:
 * `T-DEP-002` forbids a HEIC ENCODER anywhere in the dependency tree (patents
 * + a GPL licence floor), so nothing in this repo can produce HEIC bytes. A
 * real decode therefore needs a COMMITTED fixture, which is TASK-151's job —
 * its row explicitly wires `T-IMG-013/015/016` against `golden/ingest/`. Until
 * then the decoder is injected, which buys something the fixture cannot: the
 * out-of-memory and header-lie paths, neither of which a well-formed fixture
 * can reach. Recorded in `specs/testing.md` §29.2.
 */

import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/errors/AppError.js';
import { ingestFiles, type IngestStages } from '../../src/images/ingest.js';
import { transcodeHeicToPng, type HeicDecoder } from '../../src/images/transcode.js';
import { DEFAULT_STAGES } from '../../src/routes/batchImages.js';
import type { ImageBlobStore } from '../../src/storage/blobStore.js';

const AT = new Date(Date.UTC(2026, 7, 11, 15, 42, 33, 0));

/** A PNG that is nothing but a valid signature + IHDR — enough to be READ. */
function pngBytes(width: number, height: number, pad = 0): Uint8Array {
  const bytes = new Uint8Array(33 + pad);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** `ftyp` (major brand `heic`) + a single `ispe` declaring the extent. */
function heicBytes(width: number, height: number): Uint8Array {
  const head = new Uint8Array(24);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, 24);
  head.set([0x66, 0x74, 0x79, 0x70], 4);
  head.set([0x68, 0x65, 0x69, 0x63], 8);
  hv.setUint32(12, 0);
  head.set([0x68, 0x65, 0x69, 0x63], 16);
  head.set([0x6d, 0x69, 0x66, 0x31], 20);

  const ispe = new Uint8Array(20);
  const iv = new DataView(ispe.buffer);
  iv.setUint32(0, 20);
  ispe.set([0x69, 0x73, 0x70, 0x65], 4);
  iv.setUint32(8, 0);
  iv.setUint32(12, width);
  iv.setUint32(16, height);

  const out = new Uint8Array(head.length + ispe.length);
  out.set(head, 0);
  out.set(ispe, head.length);
  return out;
}

function decoderReturning(bytes: Uint8Array): HeicDecoder & ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.resolve(bytes)) as never;
}

function decoderThrowing(error: unknown): HeicDecoder & ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.reject(error)) as never;
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the transcode to reject, but it resolved');
}

describe('transcodeHeicToPng', () => {
  it('T-IMG-013a converts HEIC to PNG and returns the decoded raster', async () => {
    const decoder = decoderReturning(pngBytes(1179, 2556));
    const result = await transcodeHeicToPng(heicBytes(1179, 2556), 'heic', { decoder });

    expect(Array.from(result.bytes.subarray(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(result.width).toBe(1179);
    expect(result.height).toBe(2556);
    expect(decoder).toHaveBeenCalledTimes(1);
  });

  it('T-IMG-013b asks the decoder for PNG — never a lossy re-encode', async () => {
    // NFR-012a. A JPEG re-encode would produce a perfectly valid image and
    // pass every other assertion in this file while degrading the tile
    // captions the extractor reads, so the requested format is asserted
    // directly rather than inferred from the output.
    const decoder = decoderReturning(pngBytes(400, 400));
    await transcodeHeicToPng(heicBytes(400, 400), 'heic', { decoder });

    expect(decoder).toHaveBeenCalledWith(expect.objectContaining({ format: 'PNG' }));
  });

  it('T-IMG-013c hands the decoder the ORIGINAL bytes, unmodified', async () => {
    const source = heicBytes(640, 480);
    const decoder = decoderReturning(pngBytes(640, 480));
    await transcodeHeicToPng(source, 'heic', { decoder });

    const passed = decoder.mock.calls[0]?.[0] as { buffer: Uint8Array };
    expect(Array.from(passed.buffer)).toEqual(Array.from(source));
  });

  it('T-IMG-013d accepts the `heif` brand as well as `heic`', async () => {
    const decoder = decoderReturning(pngBytes(300, 300));
    await expect(
      transcodeHeicToPng(heicBytes(300, 300), 'heif', { decoder }),
    ).resolves.toBeDefined();
  });

  it('T-IMG-015a maps a decoder failure to IMAGE_DECODE_FAILED, gracefully', async () => {
    const error = await rejection(
      transcodeHeicToPng(heicBytes(1179, 2556), 'heic', {
        decoder: decoderThrowing(new Error('libheif: invalid box size')),
      }),
    );

    expect(error.code).toBe('IMAGE_DECODE_FAILED');
    expect(error.httpStatus).toBe(415);
  });

  it('T-IMG-015b a corrupt-file refusal names NEITHER memory NOR the runbook', async () => {
    // `T-IMG-020`'s standing constraint: more memory can never fix a truncated
    // file, so advising an up-size is advice that cannot work.
    const error = await rejection(
      transcodeHeicToPng(heicBytes(800, 600), 'heic', {
        decoder: decoderThrowing(new Error('unexpected end of file')),
      }),
    );

    expect(error.message.toLowerCase()).not.toContain('memory');
    expect(error.message).not.toContain('scale-up-memory');
  });

  it('T-IMG-015c rejects an empty decoder result rather than storing zero bytes', async () => {
    const error = await rejection(
      transcodeHeicToPng(heicBytes(800, 600), 'heic', {
        decoder: decoderReturning(new Uint8Array(0)),
      }),
    );

    expect(error.code).toBe('IMAGE_DECODE_FAILED');
  });

  it('T-IMG-015d rejects output that is not a readable PNG', async () => {
    const error = await rejection(
      transcodeHeicToPng(heicBytes(800, 600), 'heic', {
        decoder: decoderReturning(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])),
      }),
    );

    expect(error.code).toBe('IMAGE_DECODE_FAILED');
  });

  it('T-IMG-015e maps a WASM allocation failure to IMAGE_DECODE_OOM, not a crash', async () => {
    // ADR-0008 R2.4 — the COMMON out-of-memory path. It is a catchable
    // `RangeError` and the container keeps running; the kernel OOM kill (no
    // error, process restarted) cannot be handled in-process at all, which is
    // why the pre-decode guard exists. Handling only one of the two misses the
    // likelier case.
    const error = await rejection(
      transcodeHeicToPng(heicBytes(4000, 3000), 'heic', {
        decoder: decoderThrowing(new RangeError('Array buffer allocation failed')),
      }),
    );

    expect(error.code).toBe('IMAGE_DECODE_OOM');
    expect(error.httpStatus).toBe(503);
    expect(error.message.toLowerCase()).toContain('memory');
    expect(error.message).toContain('docs/runbooks/scale-up-memory.md');
  });

  it('T-IMG-015f recognises every WASM out-of-memory wording', async () => {
    const wordings = [
      'WebAssembly.Memory(): could not allocate memory',
      'Aborted(OOM): out of memory',
      'Cannot enlarge memory arrays',
      'memory allocation failed',
    ];

    for (const wording of wordings) {
      const error = await rejection(
        transcodeHeicToPng(heicBytes(4000, 3000), 'heic', {
          decoder: decoderThrowing(new RangeError(wording)),
        }),
      );
      expect(error.code, wording).toBe('IMAGE_DECODE_OOM');
    }
  });

  it('T-IMG-015g classifies by the MESSAGE, not by the error being a RangeError', async () => {
    // The discriminating case: a `RangeError` that has nothing to do with
    // memory must NOT be reported as an out-of-memory condition, or the owner
    // is told to up-size compute to fix a malformed file.
    const error = await rejection(
      transcodeHeicToPng(heicBytes(800, 600), 'heic', {
        decoder: decoderThrowing(new RangeError('Offset is outside the bounds of the DataView')),
      }),
    );

    expect(error.code).toBe('IMAGE_DECODE_FAILED');
  });

  it('T-IMG-016a runs the pixel guard FIRST and allocates nothing', async () => {
    // 8064 × 5952 = 48.0 MP against the default 25 MP ceiling. The decoder
    // must never be constructed: this is the whole value of the guard's
    // position in the order (`specs/api.md` §5.0).
    const decoder = decoderReturning(pngBytes(8064, 5952));
    const error = await rejection(
      transcodeHeicToPng(heicBytes(8064, 5952), 'heic', { decoder, env: {} }),
    );

    expect(error.code).toBe('IMAGE_TOO_LARGE_TO_DECODE');
    expect(decoder).not.toHaveBeenCalled();
  });

  it('T-IMG-016b accepts the SAME image once NEXTUP_MAX_DECODE_PIXELS is raised', async () => {
    // Proves the ceiling is the env var and not a hard-coded constant — the
    // reactive up-size in `docs/runbooks/scale-up-memory.md` depends on it.
    const decoder = decoderReturning(pngBytes(8064, 5952));
    const result = await transcodeHeicToPng(heicBytes(8064, 5952), 'heic', {
      decoder,
      env: { NEXTUP_MAX_DECODE_PIXELS: '50000000' },
    });

    expect(result.width).toBe(8064);
    expect(decoder).toHaveBeenCalledTimes(1);
  });

  it('T-IMG-016c rejects a raster that contradicts the header', async () => {
    // §5.1 step 4 — a secondary consistency check, not the guard. A file that
    // lies in its header is malformed, so this is `IMAGE_DECODE_FAILED` and
    // never `IMAGE_TOO_LARGE_TO_DECODE`.
    const error = await rejection(
      transcodeHeicToPng(heicBytes(1179, 2556), 'heic', {
        decoder: decoderReturning(pngBytes(100, 100)),
      }),
    );

    expect(error.code).toBe('IMAGE_DECODE_FAILED');
  });

  it('T-IMG-016d accepts a TRANSPOSED raster — `irot` is not a header lie', async () => {
    // `ispe` records the stored extent and ignores the rotation properties;
    // libheif applies them. A portrait iPhone photo therefore decodes to the
    // transpose of its header, and refusing that would reject ordinary
    // camera-roll uploads — the exact case A42 exists to support.
    const result = await transcodeHeicToPng(heicBytes(4032, 3024), 'heic', {
      decoder: decoderReturning(pngBytes(3024, 4032)),
    });

    expect(result.width).toBe(3024);
    expect(result.height).toBe(4032);
  });

  it('T-IMG-016e rejects an under-size image before decoding', async () => {
    const decoder = decoderReturning(pngBytes(10, 10));
    const error = await rejection(transcodeHeicToPng(heicBytes(10, 10), 'heic', { decoder }));

    expect(error.code).toBe('IMAGE_DIMENSIONS_UNSUPPORTED');
    expect(decoder).not.toHaveBeenCalled();
  });

  it('T-IMG-023h refuses to transcode a PNG — the condition is the caller\u2019s', async () => {
    // Not an `AppError`: reaching here means the CALLER's branch is wrong,
    // which is a bug, not a bad image. Silently transcoding a PNG would hide
    // exactly the regression `T-IMG-023` exists to catch.
    await expect(
      transcodeHeicToPng(pngBytes(400, 400), 'png', {
        decoder: decoderReturning(pngBytes(400, 400)),
      }),
    ).rejects.toThrow(/condition/i);
  });
});

/**
 * The wiring. These run the REAL `heic-convert` through the route's default
 * stages — no injected decoder — because the property under test is that the
 * seam is connected at all.
 */
describe('DEFAULT_STAGES.transcode', () => {
  function makeStore(): ImageBlobStore & { written: Map<string, Uint8Array> } {
    const written = new Map<string, Uint8Array>();
    return {
      written,
      put(path, bytes) {
        written.set(path, bytes);
        return Promise.resolve();
      },
      get(path) {
        return Promise.resolve(written.get(path) ?? null);
      },
      remove(path) {
        written.delete(path);
        return Promise.resolve();
      },
    };
  }

  function context(stages: IngestStages, ingestSource: 'upload' | 'paste' = 'upload') {
    return {
      ownerId: 'owner_1',
      batchId: 'batch_1',
      ingestSource,
      firstSeqInBatch: 1,
      receivedAt: AT,
      store: makeStore(),
      stages,
      correlationId: 'corr-transcode-spec',
      logSink: () => {},
    };
  }

  it('T-IMG-023i is the real transcode — the guard fires from inside it', async () => {
    // The discriminator against the old throwing stub: the stub answered
    // `IMAGE_DECODE_FAILED` for everything. Only a real implementation that
    // calls `assertDecodable` first can answer `IMAGE_TOO_LARGE_TO_DECODE`.
    const error = await rejection(DEFAULT_STAGES.transcode(heicBytes(8064, 5952), 'heic'));
    expect(error.code).toBe('IMAGE_TOO_LARGE_TO_DECODE');
  });

  it('T-IMG-023j transcodes a HEIC that a lying client labelled a paste', async () => {
    // The structural half of `T-IMG-023`. WebKit's clipboard exposes only
    // `image/png`, so this cannot happen honestly — the point is that the
    // branch reads the SNIFFED format, and an untrusted field cannot buy a
    // skip past the decoder.
    const stages: IngestStages = {
      transcode: vi.fn(() => Promise.resolve({ bytes: pngBytes(1179, 2556) })),
      stripMetadata: vi.fn((bytes: Uint8Array) => Promise.resolve(bytes)),
    };

    const outcome = await ingestFiles(
      [{ clientFileName: undefined, bytes: heicBytes(1179, 2556) }],
      context(stages, 'paste'),
    );

    expect(stages.transcode).toHaveBeenCalledTimes(1);
    expect(outcome.accepted[0]?.format).toBe('png');
    expect(outcome.accepted[0]?.uploadedFormat).toBe('heic');
  });

  it('T-IMG-023k fails ONE image on a transcode failure, never the batch', async () => {
    // REQ-080/081. The failing file becomes a `rejected[]` entry carrying its
    // own code; the good file that follows it still lands. Before the transcode
    // was real this could not happen, because nothing per-file could throw.
    const stages: IngestStages = {
      transcode: vi.fn(() =>
        Promise.reject(new AppError('IMAGE_DECODE_OOM', 503, 'ran out of memory')),
      ),
      stripMetadata: vi.fn((bytes: Uint8Array) => Promise.resolve(bytes)),
    };

    const outcome = await ingestFiles(
      [
        { clientFileName: 'a.heic', bytes: heicBytes(1179, 2556) },
        { clientFileName: 'b.png', bytes: pngBytes(1179, 2556) },
      ],
      context(stages),
    );

    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]?.code).toBe('IMAGE_DECODE_OOM');
    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.accepted[0]?.fileName).toBe('b.png');
  });

  it('T-IMG-023l lets a NON-AppError propagate rather than blaming the image', async () => {
    // An Azure outage or a programming error is not a verdict about one
    // screenshot, and reporting it as one would tell the owner to re-export a
    // file that is perfectly fine.
    const stages: IngestStages = {
      transcode: vi.fn(() => Promise.reject(new TypeError('stages.transcode is not a function'))),
      stripMetadata: vi.fn((bytes: Uint8Array) => Promise.resolve(bytes)),
    };

    await expect(
      ingestFiles([{ clientFileName: 'a.heic', bytes: heicBytes(1179, 2556) }], context(stages)),
    ).rejects.toThrow(TypeError);
  });
});
