/**
 * `POST /api/batches/:batchId/images` — the HANDLER's branch arms, over real
 * HTTP with the repository and the blob store mocked (TASK-050).
 *
 * This is not a duplicate of `test/integration/ingestSources.spec.ts`. That
 * suite proves what the STORE does with real rows; this one proves what the
 * HANDLER does on the arms a real database and a real Azurite cannot be driven
 * onto cheaply or deterministically:
 *
 *  - the whole-request ceilings, which would otherwise need 40 real images and
 *    a genuine 60 MiB body;
 *  - the all-rejected mapping, where the request takes the FAILING code's own
 *    status — including `IMAGE_DECODE_OOM` → **503, not 500**;
 *  - the transcode-refusal arm, which is the answer to an undecodable HEIC.
 *
 * It also carries the coverage. `npm run coverage` scores only the `unit` and
 * `web` projects, so a route proven only in integration scores ~6% against the
 * `apps/api/src/**` floor — a gate failure, not a formality.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { MAX_BATCH_UPLOAD_BYTES, MAX_IMAGE_BYTES, MAX_IMAGES_PER_BATCH } from '@nextup/domain';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findUploadBatch = vi.fn();
const batchImageTotals = vi.fn();
const createUploadedImage = vi.fn();

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findUploadBatch: (...args: unknown[]) => findUploadBatch(...args) as unknown,
    batchImageTotals: (...args: unknown[]) => batchImageTotals(...args) as unknown,
    createUploadedImage: (...args: unknown[]) => createUploadedImage(...args) as unknown,
  };
});

/**
 * The blob store is mocked at the MODULE boundary rather than injected,
 * because `createApp()` wires the route with its defaults — and the default
 * wiring is what a request in production actually goes through. Injecting a
 * double here would test a composition that never ships.
 */
const put = vi.fn(() => Promise.resolve());
vi.mock('../../src/storage/blobStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/storage/blobStore.js')>();
  return {
    ...actual,
    azureImageBlobStore: {
      put: (...args: unknown[]) => put(...(args as [])) as unknown,
      get: () => Promise.resolve(null),
      remove: () => Promise.resolve(),
    },
  };
});

const { createApp } = await import('../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../src/middleware/allowList.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-images-unit';

const principalHeader = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
      { typ: OID, val: SUBJECT },
      { typ: 'preferred_username', val: 'owner@example.com' },
    ],
  }),
  'utf8',
).toString('base64');

function pngBytes(width = 1179, height = 2556, pad = 0): Uint8Array {
  const bytes = new Uint8Array(33 + pad);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** `ftyp`/`heic` plus a single `ispe`, which is all the sniff and the guard read. */
function heicBytes(width = 1179, height = 2556): Uint8Array {
  const out = new Uint8Array(44);
  const view = new DataView(out.buffer);
  view.setUint32(0, 24);
  out.set([0x66, 0x74, 0x79, 0x70], 4);
  out.set([0x68, 0x65, 0x69, 0x63], 8);
  view.setUint32(12, 0);
  out.set([0x68, 0x65, 0x69, 0x63], 16);
  out.set([0x6d, 0x69, 0x66, 0x31], 20);
  view.setUint32(24, 20);
  out.set([0x69, 0x73, 0x70, 0x65], 28);
  view.setUint32(32, 0);
  view.setUint32(36, width);
  view.setUint32(40, height);
  return out;
}

let server: Server;
let app: Express;
let origin: string;

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

async function postImages(
  files: { name: string; bytes: Uint8Array }[],
  ingestSource = 'upload',
  batchId = 'batch-1',
): Promise<Response> {
  const form = new FormData();
  form.append('ingestSource', ingestSource);
  for (const file of files) {
    form.append(
      'files',
      new Blob([file.bytes as unknown as BlobPart], { type: 'application/octet-stream' }),
      file.name,
    );
  }
  return fetch(`${origin}/api/batches/${batchId}/images`, {
    method: 'POST',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
    body: form,
  });
}

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;

  findUploadBatch.mockResolvedValue({ id: 'batch-1', status: 'draft', service: 'netflix' });
  batchImageTotals.mockResolvedValue({ imageCount: 0, uploadedByteSize: 0, storedByteSize: 0 });
  createUploadedImage.mockResolvedValue(undefined);
  put.mockClear();

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  vi.clearAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
});

describe('T-IMG-010 whole-request ceilings refuse the request, not a file', () => {
  it('T-IMG-010f: a batch already at the image ceiling refuses with 400 TOO_MANY_IMAGES', async () => {
    batchImageTotals.mockResolvedValue({
      imageCount: MAX_IMAGES_PER_BATCH,
      uploadedByteSize: 0,
      storedByteSize: 0,
    });

    const res = await postImages([{ name: 'a.png', bytes: pngBytes() }]);

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('TOO_MANY_IMAGES');
    expect(body.error.details['max']).toBe(MAX_IMAGES_PER_BATCH);
    // Refusing the REQUEST means nothing was written — not a partial accept.
    expect(createUploadedImage).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('T-IMG-010g: a batch already at the byte ceiling refuses with 413 BATCH_TOO_LARGE', async () => {
    batchImageTotals.mockResolvedValue({
      imageCount: 1,
      uploadedByteSize: MAX_BATCH_UPLOAD_BYTES,
      storedByteSize: MAX_BATCH_UPLOAD_BYTES,
    });

    const res = await postImages([{ name: 'a.png', bytes: pngBytes() }]);

    // 413, not 400: this is a size condition, and the distinction is what
    // lets the SPA say "this batch is full" rather than "bad request".
    expect(res.status).toBe(413);
    expect(((await res.json()) as ErrorBody).error.code).toBe('BATCH_TOO_LARGE');
    expect(createUploadedImage).not.toHaveBeenCalled();
  });

  it('T-IMG-010h: the ceiling counts what is ALREADY in the batch, not just what arrived', async () => {
    // One short of the ceiling: one more file is fine, two is not. A route
    // that compared only the incoming count would accept both.
    batchImageTotals.mockResolvedValue({
      imageCount: MAX_IMAGES_PER_BATCH - 1,
      uploadedByteSize: 0,
      storedByteSize: 0,
    });

    const ok = await postImages([{ name: 'a.png', bytes: pngBytes() }]);
    expect(ok.status).toBe(201);

    const tooMany = await postImages([
      { name: 'a.png', bytes: pngBytes() },
      { name: 'b.png', bytes: pngBytes() },
    ]);
    expect(tooMany.status).toBe(400);
    expect(((await tooMany.json()) as ErrorBody).error.code).toBe('TOO_MANY_IMAGES');
  });

  // ── The unit rule ────────────────────────────────────────────────────────
  // The batch ceiling bounds UPLOADED bytes. It used to be enforced as
  // `storedSoFar + uploadedIncoming`, summing two units that differ by the
  // HEIC→PNG transcode ratio (measured on the owner's phone: 1.49 MiB →
  // 12.7 MiB, 1.76 MiB → 17.8 MiB). Both of these fail on that code, and
  // neither would be caught by a PNG-only fixture, because for PNG the two
  // totals are identical.
  it('T-IMG-010i: a batch whose STORED bytes exceed the ceiling still accepts, if uploads do not', async () => {
    // The realistic HEIC case: the owner has sent ~7 MiB of phone photos that
    // store as ~60 MiB of lossless PNG. They are nowhere near the 60 MiB
    // UPLOAD ceiling and must not be refused.
    batchImageTotals.mockResolvedValue({
      imageCount: 4,
      uploadedByteSize: 7 * 1024 * 1024,
      storedByteSize: MAX_BATCH_UPLOAD_BYTES + 8 * 1024 * 1024,
    });

    const res = await postImages([{ name: 'a.png', bytes: pngBytes() }]);

    // On the old comparison this was a 413 quoting "at most 60 MiB" after
    // about 7 MiB of files — a number the owner cannot reconcile with
    // anything they can see.
    expect(res.status).toBe(201);
    expect(createUploadedImage).toHaveBeenCalled();
  });

  it('T-IMG-010j: the ceiling reports the UPLOADED total, not the stored one', async () => {
    // Same batch, now genuinely at the upload ceiling. `details.current` is
    // what the SPA renders, so it has to be in the unit the message names.
    batchImageTotals.mockResolvedValue({
      imageCount: 4,
      uploadedByteSize: MAX_BATCH_UPLOAD_BYTES,
      storedByteSize: MAX_BATCH_UPLOAD_BYTES * 3,
    });

    const res = await postImages([{ name: 'a.png', bytes: pngBytes() }]);

    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('BATCH_TOO_LARGE');
    expect(body.error.details['max']).toBe(MAX_BATCH_UPLOAD_BYTES);
    expect(body.error.details['current']).toBe(MAX_BATCH_UPLOAD_BYTES);
    expect(body.error.details['current']).not.toBe(MAX_BATCH_UPLOAD_BYTES * 3);
  });

  /**
   * ⚠ THESE TWO CASES EXIST BECAUSE THE ROUTE RETURNED 500 FOR AN OVERSIZED
   * IMAGE. Multer's own `limits` abort the multipart stream and raise a
   * `MulterError`, which nothing mapped — so the envelope's catch-all turned a
   * ceiling the product deliberately enforces into `INTERNAL_ERROR`, telling
   * the owner that nextup had broken when in fact their file was too big. The
   * distinction is not cosmetic: `IMAGE_TOO_LARGE` is actionable and
   * `INTERNAL_ERROR` is not, and this is the one screen where the owner is
   * adding data and most needs to be told what to do next.
   *
   * Found by the TASK-163 ingest-parity suite (`T-PASTE-007`), which requires
   * an 11 MB paste to be 413 `IMAGE_TOO_LARGE`.
   *
   * ⚠ The bytes here must exceed `MAX_IMAGE_BYTES` by more than one byte:
   * multer's `fileSize` is set to `MAX_IMAGE_BYTES + 1` so that a file AT the
   * limit still reaches the pipeline, which judges it per-file. A fixture of
   * exactly `MAX_IMAGE_BYTES + 1` would take the pipeline path and pass this
   * assertion for the wrong reason.
   */
  it('T-IMG-010k: an image past multer’s backstop is 413 IMAGE_TOO_LARGE, never 500', async () => {
    const oversized = pngBytes(1179, 2556, MAX_IMAGE_BYTES);

    const res = await postImages([{ name: 'huge.png', bytes: oversized }]);

    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('IMAGE_TOO_LARGE');
    expect(body.error.code).not.toBe('INTERNAL_ERROR');
    // The owner is told the actual ceiling, not just that something was wrong.
    expect(body.error.details['maxByteSize']).toBe(MAX_IMAGE_BYTES);
    expect(createUploadedImage).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('T-IMG-010l: the oversize refusal is identical for a pasted image (invariant 17)', async () => {
    const oversized = pngBytes(1179, 2556, MAX_IMAGE_BYTES);

    const res = await postImages([{ name: 'pasted.png', bytes: oversized }], 'paste');

    // Ceilings are not conditioned on the client-declared ingest source. A
    // route that mapped this error only on the upload path would leave paste
    // returning 500 while every upload-path test stayed green.
    expect(res.status).toBe(413);
    expect(((await res.json()) as ErrorBody).error.code).toBe('IMAGE_TOO_LARGE');
  });
});

describe('T-IMG-002 when NOTHING is accepted the request takes the failing code status', () => {
  it('T-IMG-002e: an over-guard image alone is 413, and the rejection list is carried in details', async () => {
    // 8064 × 5952 = 48.0 MP, over the 25 MP budget the container is sized for.
    const res = await postImages([{ name: 'huge.png', bytes: pngBytes(8064, 5952) }]);

    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('IMAGE_TOO_LARGE_TO_DECODE');
    const rejected = body.error.details['rejected'] as { fileName: string }[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.fileName).toBe('huge.png');
    expect(createUploadedImage).not.toHaveBeenCalled();
  });

  it('T-IMG-002f: a dimension-bounds failure is 400, not 413', async () => {
    // 10 px on a side: readable as a header, far too small to be a screenshot.
    const res = await postImages([{ name: 'tiny.png', bytes: pngBytes(10, 10) }]);

    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('IMAGE_DIMENSIONS_UNSUPPORTED');
  });
});

describe('T-IMG-020 the surfaced error is diagnostic', () => {
  it('T-IMG-020a: the memory refusal names memory, renders MEGApixels, and cites the runbook', async () => {
    const res = await postImages([{ name: 'huge.png', bytes: pngBytes(8064, 5952) }]);
    const body = (await res.json()) as ErrorBody;
    const message = (body.error.details['rejected'] as { message: string }[])[0]?.message ?? '';

    expect(message).toContain('memory limit');
    expect(message).toContain('docs/runbooks/scale-up-memory.md');
    // ⚠ MEGApixels to one decimal place, NOT the raw pixel budget. A field
    // holding pixels renders "25000000.0 MP", which compiles and satisfies
    // every comparison — see `specs/testing.md` §28.3(a).
    expect(message).toContain('48.0 MP');
    expect(message).toContain('25.0 MP');
    expect(message).not.toContain('25000000');
  });

  it('T-IMG-020b: the unsupported-format refusal names NEITHER memory NOR the runbook', async () => {
    const res = await postImages([
      { name: 'notes.txt', bytes: new TextEncoder().encode('plain text, not an image') },
    ]);
    const body = (await res.json()) as ErrorBody;
    const message = (body.error.details['rejected'] as { message: string }[])[0]?.message ?? '';

    // More memory never fixes a file that is not an image, and offering the
    // runbook here would send the owner to spend money on the wrong problem.
    expect(res.status).toBe(415);
    expect(message.toLowerCase()).not.toContain('memory');
    expect(message).not.toContain('runbook');
    expect(message).toContain('PNG');
  });
});

describe('T-IMG-023 an undecodable HEIC is refused — nothing is stored raw', () => {
  it('T-IMG-023f: a HEIC is sniffed and guarded, then refused by the transcode', async () => {
    const res = await postImages([{ name: 'IMG_0001.HEIC', bytes: heicBytes() }]);

    // ⚠ CORRECTED IN PLACE (TASK-149): the transcode is BUILT now, and this
    // fixture is a bare `ftyp`+`ispe` header with no HEVC payload, so the real
    // decoder refuses it. The assertions are unchanged and still load-bearing.
    // ~~Superseded wording: "fails at the missing transcode stage".~~
    //
    // 415 with a re-export remedy, NOT a 500. And critically: nothing was
    // stored. Passing HEIC bytes through would break the `format in
    // {png,jpeg}` invariant and hand extraction bytes it cannot read.
    expect(res.status).toBe(415);
    expect(((await res.json()) as ErrorBody).error.code).toBe('IMAGE_DECODE_FAILED');
    expect(put).not.toHaveBeenCalled();
    expect(createUploadedImage).not.toHaveBeenCalled();
  });

  it('T-IMG-023g: a HEIC claiming ingestSource paste fails the SAME way — the branch reads the sniff', async () => {
    const res = await postImages([{ name: 'x.heic', bytes: heicBytes() }], 'paste');

    // A lying client cannot talk its way past the transcode. If this returned
    // 201 while the upload path returned 415, `ingestSource` would be
    // selecting a code path — the one thing `A45` forbids.
    expect(res.status).toBe(415);
    expect(((await res.json()) as ErrorBody).error.code).toBe('IMAGE_DECODE_FAILED');
  });
});

describe('T-PASTE-007 the happy path writes the blob before the row', () => {
  it('T-PASTE-007d: an accepted image is stored, then inserted, and echoed without blobPath', async () => {
    const res = await postImages([{ name: 'shot.png', bytes: pngBytes() }], 'paste');

    expect(res.status).toBe(201);
    expect(put).toHaveBeenCalledTimes(1);
    expect(createUploadedImage).toHaveBeenCalledTimes(1);

    // Bytes first: a row pointing at a blob that was never written is
    // unrecoverable, whereas an orphan blob is purged in 30 days anyway.
    expect(put.mock.invocationCallOrder[0]).toBeLessThan(
      createUploadedImage.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );

    const raw = await res.text();
    expect(raw).not.toContain('blobPath');
  });
});
