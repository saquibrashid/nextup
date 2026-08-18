/**
 * TASK-151 — the `golden/ingest/` fixture set, exercised against the REAL
 * ingest code (`apps/api/src/images/**`).
 *
 * ⚠ WHY THIS FILE LIVES UNDER `tests/extraction/`. `specs/testing.md` §11 and
 * `vitest.config.ts` between them collect exactly six roots; of the two
 * directories TASK-151 owns, `tests/fixtures/**` is collected by NOBODY (it is
 * fixture data) and `tests/extraction/**` is the `golden` project. A `.spec.*`
 * file outside a collected path DOES NOT RUN and its assertions pass by never
 * executing (`T-CI-008`) — a canary asserting `1 === 2` has already been
 * reported inside a fully green run here. So this is the collected path, and
 * `npm run golden` is what runs it. Reported to the coordinator.
 *
 * WHAT THESE ADD OVER THE UNIT SUITES. `apps/api/test/unit/*.spec.ts` drive
 * the same code with INLINE byte literals and an INJECTED decoder. That is the
 * right shape for the out-of-memory and header-lie paths, which no well-formed
 * file can produce. It cannot tell you whether a file on disk — the thing a
 * phone actually hands over — survives the pipeline. These cases read the
 * COMMITTED bytes and, for the truncated HEIC, run the REAL `heic-convert`
 * decoder with nothing injected.
 *
 * ⚠ EVERY CASE HERE IS OFFLINE. No network, no Azure, no live provider.
 */

import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../apps/api/src/errors/AppError.js';
import { inspectDecodable } from '../../apps/api/src/images/decodeGuard.js';
import { ingestFiles, type IngestStages } from '../../apps/api/src/images/ingest.js';
import { readDimensions } from '../../apps/api/src/images/readDimensions.js';
import { sniffUploadFormat } from '../../apps/api/src/images/sniffFormat.js';
import { stripAllMetadata, transcodeHeicToPng } from '../../apps/api/src/images/transcode.js';
import type { ImageBlobStore } from '../../apps/api/src/storage/blobStore.js';
import {
  INGEST_FIXTURES,
  loadIngestFixture,
  type IngestFixtureName,
} from '../fixtures/golden/ingest/index.js';

const AT = new Date(Date.UTC(2026, 7, 18, 14, 32, 13));

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

function makeStore(): ImageBlobStore & { written: Map<string, Uint8Array> } {
  const written = new Map<string, Uint8Array>();
  return {
    written,
    put(blobPath, bytes) {
      written.set(blobPath, bytes);
      return Promise.resolve();
    },
    get(blobPath) {
      return Promise.resolve(written.get(blobPath) ?? null);
    },
    remove(blobPath) {
      written.delete(blobPath);
      return Promise.resolve();
    },
  };
}

/**
 * Stages with a transcode double that returns DIFFERENT bytes on purpose: a
 * stage that echoed its input would make "transcoded" and "passed through"
 * indistinguishable. The metadata strip is the REAL one — it is the control
 * REQ-078 is about and must never be doubled in a test that claims to assert
 * it.
 */
function makeStages(): IngestStages & {
  transcode: ReturnType<typeof vi.fn>;
  stripMetadata: ReturnType<typeof vi.fn>;
} {
  const transcodedPng = loadIngestFixture('controlPng');
  return {
    transcode: vi.fn(() => Promise.resolve({ bytes: transcodedPng, width: 1179, height: 2556 })),
    stripMetadata: vi.fn((bytes: Uint8Array, format: 'png' | 'jpeg') =>
      Promise.resolve(stripAllMetadata(bytes, format)),
    ),
  };
}

function contextFor(
  store: ImageBlobStore,
  stages: IngestStages,
  ingestSource: 'upload' | 'paste' | 'drop' = 'upload',
) {
  return {
    ownerId: 'owner-fixture',
    batchId: '01JXXXXXXXXXXXXXXXXXXXXXXX',
    ingestSource,
    firstSeqInBatch: 1,
    receivedAt: AT,
    store,
    stages,
  };
}

const fileOf = (name: IngestFixtureName) => ({
  clientFileName: INGEST_FIXTURES[name].file,
  bytes: loadIngestFixture(name),
});

// ---------------------------------------------------------------------------

describe('T-IMG-013 · a committed HEIC file is accepted by its BYTES', () => {
  it('T-IMG-013e: the same bytes sniff as heic whether declared image/heic or application/octet-stream', () => {
    // The two manifest entries are deliberately the SAME file. iOS Safari
    // sends `application/octet-stream` for a `.heic`; if the declared type
    // could reach the decision, this pair would disagree and the owner's own
    // phone images would be refused on first use (ASM-058).
    expect(INGEST_FIXTURES.heicAsOctetStream.file).toBe(INGEST_FIXTURES.heicHeader.file);
    expect(INGEST_FIXTURES.heicAsOctetStream.declaredContentType).toBe('application/octet-stream');
    expect(INGEST_FIXTURES.heicHeader.declaredContentType).toBe('image/heic');

    expect(sniffUploadFormat(loadIngestFixture('heicHeader'))).toBe('heic');
    expect(sniffUploadFormat(loadIngestFixture('heicAsOctetStream'))).toBe('heic');
  });

  it('T-IMG-013f: it is recorded as uploadedFormat heic, stored as png, and the decoder is handed the ORIGINAL bytes', async () => {
    const store = makeStore();
    const stages = makeStages();
    const original = loadIngestFixture('heicAsOctetStream');

    const outcome = await ingestFiles([fileOf('heicAsOctetStream')], contextFor(store, stages));

    expect(outcome.rejected).toEqual([]);
    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.accepted[0]?.uploadedFormat).toBe('heic');
    expect(outcome.accepted[0]?.format).toBe('png');
    // ⚠ The ORIGINAL bytes, not a re-read or a copy of the header. Handing the
    // decoder anything else would silently decode something other than what
    // the owner uploaded.
    expect(stages.transcode).toHaveBeenCalledTimes(1);
    expect(stages.transcode.mock.calls[0]?.[0]).toEqual(original);
    expect(stages.transcode.mock.calls[0]?.[1]).toBe('heic');
  });

  it('T-IMG-013g: the header dimension read takes the MASTER ispe, never the leading thumbnail', () => {
    // The fixture carries a 320x240 thumbnail ispe BEFORE the master. A
    // first-match reader reports 0.08 MP and waves the master past the pixel
    // guard — and would pass every single-`ispe` fixture on the way.
    expect(readDimensions(loadIngestFixture('heicHeader'))).toEqual({
      width: 1179,
      height: 2556,
    });
  });
});

describe('T-IMG-015 · a truncated HEIC fails gracefully, and fails ONE image', () => {
  it('T-IMG-015h: the REAL decoder refuses it with 415 IMAGE_DECODE_FAILED, naming neither memory nor the runbook', async () => {
    // ⚠ NO INJECTED DECODER. This runs `heic-convert` for real, offline,
    // against committed bytes. It is the only case in the repository that
    // does, and it is what the unit suite's decoder double cannot buy.
    const error = await transcodeHeicToPng(loadIngestFixture('heicTruncated'), 'heic').then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe('IMAGE_DECODE_FAILED');
    expect(appError.httpStatus).toBe(415);
    // `T-IMG-020`'s standing constraint: more memory can never fix a truncated
    // file, so advising an up-size here is advice that cannot work.
    expect(appError.message.toLowerCase()).not.toContain('memory');
    expect(appError.message).not.toContain('scale-up-memory');
  });

  it('T-IMG-015i: the rest of the batch still processes and the good file is still accepted', async () => {
    const store = makeStore();
    const stages = makeStages();
    stages.transcode.mockRejectedValueOnce(
      new AppError('IMAGE_DECODE_FAILED', 415, "That image couldn't be read."),
    );

    const outcome = await ingestFiles(
      [fileOf('heicTruncated'), fileOf('controlPng')],
      contextFor(store, stages),
    );

    expect(outcome.rejected.map((r) => r.code)).toEqual(['IMAGE_DECODE_FAILED']);
    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.accepted[0]?.format).toBe('png');
    // REQ-080/081: no partial commit for the failed file, and the ordinal
    // still advanced so the two files cannot collide on a synthesised name.
    expect(store.written.size).toBe(1);
    expect(outcome.accepted[0]?.seqInBatch).toBe(2);
  });
});

describe('T-IMG-016 · the pixel guard reads the HEADER, before any decoder exists', () => {
  it('T-IMG-016f: a 48.0 MP declared header is refused IMAGE_TOO_LARGE_TO_DECODE and the decoder is never invoked', async () => {
    const store = makeStore();
    const stages = makeStages();

    const outcome = await ingestFiles([fileOf('heicOversize')], contextFor(store, stages));

    expect(outcome.accepted).toEqual([]);
    expect(outcome.rejected[0]?.code).toBe('IMAGE_TOO_LARGE_TO_DECODE');
    expect(outcome.rejected[0]?.details).toMatchObject({
      width: 8000,
      height: 6000,
      megapixels: 48,
      maxMegapixels: 25,
    });
    // The whole value of the guard is its POSITION. Called after a decoder
    // exists it is decoration.
    expect(stages.transcode).not.toHaveBeenCalled();
    expect(store.written.size).toBe(0);
    // A memory refusal MUST name memory and cite the runbook (`T-IMG-020`).
    expect(outcome.rejected[0]?.message).toContain('memory');
    expect(outcome.rejected[0]?.message).toContain('docs/runbooks/scale-up-memory.md');
  });

  it('T-IMG-016g: the SAME fixture passes at NEXTUP_MAX_DECODE_PIXELS=50000000 — the ceiling is the env var, not a constant', () => {
    const bytes = loadIngestFixture('heicOversize');
    expect(inspectDecodable(bytes, { NEXTUP_MAX_DECODE_PIXELS: '25000000' }).ok).toBe(false);
    expect(inspectDecodable(bytes, { NEXTUP_MAX_DECODE_PIXELS: '50000000' }).ok).toBe(true);
  });
});

describe('T-SEC-032 · EXIF, XMP, IPTC and GPS never reach the blob store', () => {
  it('T-SEC-032h: NON-VACUITY — the fixtures really do carry a GPS payload before anything strips it', () => {
    // ⚠ Without this, every "absent" assertion below passes against a strip
    // that does nothing at all.
    const png = text(loadIngestFixture('pngWithMetadata'));
    expect(png).toContain('eXIf');
    expect(png).toContain('tEXt');
    expect(png).toContain('zTXt');
    expect(png).toContain('iTXt');
    expect(png).toContain('tIME');

    const jpeg = text(loadIngestFixture('jpegWithGps'));
    expect(jpeg).toContain('Exif\0\0');
    expect(jpeg).toContain('Apple'); // device model
    expect(jpeg).toContain('Photoshop 3.0'); // APP13 / IPTC
    expect(jpeg).toContain('Captured on iPhone 15 Pro at 51.5N 0.1W'); // COM
    // The GPSInfoIFDPointer tag (0x8825), little-endian, as it sits in IFD0.
    expect(jpeg).toContain('\x25\x88');
  });

  it('T-SEC-032i: every metadata chunk is removed from the PNG and the image chunks survive', () => {
    const stripped = text(stripAllMetadata(loadIngestFixture('pngWithMetadata'), 'png'));
    for (const chunk of ['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']) {
      expect(stripped).not.toContain(chunk);
    }
    expect(stripped).toContain('IHDR');
    expect(stripped).toContain('IDAT');
    expect(stripped).toContain('IEND');
    expect(stripped).not.toContain('\x25\x88');
  });

  it('T-SEC-032j: APP1/APP13/COM are removed from the JPEG, and the ICC profile SURVIVES', () => {
    const original = loadIngestFixture('jpegWithGps');
    const stripped = stripAllMetadata(original, 'jpeg');
    const out = text(stripped);

    expect(out).not.toContain('Exif\0\0');
    expect(out).not.toContain('Apple');
    expect(out).not.toContain('Photoshop 3.0');
    expect(out).not.toContain('Captured on iPhone 15 Pro');
    // ⚠ KEPT ON PURPOSE. The ICC profile decides how the image renders and
    // identifies nobody; dropping it is a quality regression (NFR-012a)
    // wearing a privacy badge.
    expect(out).toContain('ICC_PROFILE');
    expect(out).toContain('JFIF');
    // Structural removal, not a re-encode: the entropy-coded scan is byte
    // identical, so no pixel changed. A JPEG re-encode would be lossy.
    const scan = (bytes: Uint8Array): string => {
      const s = text(bytes);
      return s.slice(s.lastIndexOf('\xff\xda'));
    };
    expect(scan(stripped)).toBe(scan(original));
    expect(readDimensions(stripped)).toEqual({ width: 2048, height: 1536 });
  });

  it('T-SEC-032k: the bytes that reach the blob store carry no GPS', async () => {
    const store = makeStore();
    const stages = makeStages();

    const outcome = await ingestFiles(
      [fileOf('pngWithMetadata'), fileOf('jpegWithGps')],
      contextFor(store, stages),
    );

    expect(outcome.rejected).toEqual([]);
    expect(store.written.size).toBe(2);
    for (const bytes of store.written.values()) {
      const stored = text(bytes);
      expect(stored).not.toContain('eXIf');
      expect(stored).not.toContain('Exif\0\0');
      expect(stored).not.toContain('Apple');
      expect(stored).not.toContain('\x25\x88');
    }
    // The strip runs OUTSIDE the transcode condition — neither of these is a
    // HEIC, so nothing was transcoded, and both were still stripped.
    expect(stages.transcode).not.toHaveBeenCalled();
    expect(stages.stripMetadata).toHaveBeenCalledTimes(2);
  });
});

describe('T-PASTE-006 · the declared content type is never trusted, in either direction', () => {
  it('T-PASTE-006d: a PDF whose declared Blob.type claims image/png is refused UNSUPPORTED_IMAGE_FORMAT', async () => {
    expect(INGEST_FIXTURES.lyingBlob.declaredContentType).toBe('image/png');
    expect(sniffUploadFormat(loadIngestFixture('lyingBlob'))).toBeNull();

    const store = makeStore();
    const stages = makeStages();
    const outcome = await ingestFiles([fileOf('lyingBlob')], contextFor(store, stages, 'paste'));

    expect(outcome.accepted).toEqual([]);
    expect(outcome.rejected[0]?.code).toBe('UNSUPPORTED_IMAGE_FORMAT');
    expect(store.written.size).toBe(0);
  });

  it('T-PASTE-006e: a real image declared application/octet-stream is ACCEPTED — the other direction', async () => {
    // Both directions are needed. A pipeline that refused everything would
    // satisfy `T-PASTE-006d` alone and reject every iOS upload.
    const store = makeStore();
    const stages = makeStages();
    const outcome = await ingestFiles(
      [fileOf('heicAsOctetStream')],
      contextFor(store, stages, 'upload'),
    );

    expect(outcome.rejected).toEqual([]);
    expect(outcome.accepted[0]?.uploadedFormat).toBe('heic');
  });
});

describe('T-IMG-023 · the transcode branch reads the SNIFFED format, never ingestSource', () => {
  it('T-IMG-023m: a pasted PNG skips the transcode and is stored as PNG', async () => {
    const store = makeStore();
    const stages = makeStages();

    const outcome = await ingestFiles(
      [fileOf('clipboardBlob')],
      contextFor(store, stages, 'paste'),
    );

    expect(stages.transcode).not.toHaveBeenCalled();
    expect(outcome.accepted[0]?.format).toBe('png');
    expect(outcome.accepted[0]?.uploadedFormat).toBe('png');
    expect(outcome.accepted[0]?.ingestSource).toBe('paste');
    expect(outcome.accepted[0]?.width).toBe(1170);
    expect(outcome.accepted[0]?.height).toBe(2532);
    // The clipboard blob has no metadata chunks, so the strip is a no-op and
    // the stored bytes are the pasted bytes.
    expect([...store.written.values()][0]).toEqual(loadIngestFixture('clipboardBlob'));
  });

  it('T-IMG-023n: the SAME HEIC bytes labelled ingestSource paste are transcoded ANYWAY', async () => {
    // ⚠ Equivalent-today, wrong-in-principle is the whole point. WebKit's
    // clipboard exposes only `image/png`, so a pasted HEIC means a lying
    // client — and `if (ingestSource === 'paste') skipTranscode()` would make
    // a security-relevant decision from untrusted client input.
    const store = makeStore();
    const stages = makeStages();

    const outcome = await ingestFiles([fileOf('heicHeader')], contextFor(store, stages, 'paste'));

    expect(stages.transcode).toHaveBeenCalledTimes(1);
    expect(outcome.accepted[0]?.uploadedFormat).toBe('heic');
    expect(outcome.accepted[0]?.format).toBe('png');
  });
});
