/**
 * TASK-050 (R7, `A45`) — `POST /api/batches/:batchId/images` end to end.
 * The path `specs/testing.md` §11 names for this suite.
 *
 * `T-PASTE-003` (successive pastes append to the ONE open batch, ordinals
 * `01`/`02`/`03`), `T-PASTE-005` (naming + `ingestSource` PERSISTED, never
 * inferred from a filename prefix), `T-PASTE-006` (`Blob.type` never trusted),
 * `T-PASTE-007` (every ceiling applies identically to pasted images),
 * `T-IMG-002`/`006`/`010`/`012`, `T-SEC-003` and `T-RET-014`.
 *
 * Integration, not unit, and every one of those is a property the unit suite
 * physically cannot hold:
 *
 *  - The unit pipeline is handed a `firstSeqInBatch`. Whether that ordinal is
 *    actually CONTINUED across three separate HTTP requests is a property of
 *    the ROUTE plus the stored rows, and a stub would return whatever it was
 *    told. `T-PASTE-003a` is the only place the `-01`/`-02`/`-03` claim is
 *    tested against a real second request.
 *  - `ingestSource` being persisted write-once on a real `uploaded_image` row
 *    with a real CHECK constraint is a property of the STORE.
 *  - `T-SEC-003` is about the JSON that reaches the browser. It is asserted
 *    against the whole serialised body, not against a mapped object, because
 *    the leak this guards against is a future `...spread`.
 *
 * ⚠ Bytes go to a REAL Azurite (`docker compose -f docker-compose.test.yml`).
 * `AZURE_STORAGE_CONNECTION_STRING` must be set — the store refuses to accept
 * uploads with nowhere to put them rather than reporting 201 and losing them.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { MAX_FILES_PER_REQUEST } from '@nextup/domain';
import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { resetBlobStoreForTests } from '../../src/storage/blobStore.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-ingest';
const ISSUER = 'https://sts.windows.net/tenant/';

const principalHeader = (): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: ISSUER },
        { typ: OID, val: SUBJECT },
        { typ: 'preferred_username', val: 'owner@example.com' },
      ],
    }),
    'utf8',
  ).toString('base64');

/**
 * A minimal but REAL PNG header — 8-byte signature then an `IHDR` carrying the
 * dimensions. The sniff and the pre-decode guard both read from the header
 * only, so this exercises the identical code path a phone screenshot would.
 */
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

/**
 * A JPEG: SOI, a complete APP0/JFIF segment, then SOF0 carrying the size.
 *
 * ⚠ The APP0 length must be honoured. An earlier version of this fixture put
 * SOF0 at byte 13, INSIDE the 16-byte APP0 segment, so the parser walked past
 * it and the file came back 415 — a broken fixture that reads exactly like a
 * broken sniffer.
 */
function jpegBytes(width = 1200, height = 1600): Uint8Array {
  const bytes = new Uint8Array(29);
  const view = new DataView(bytes.buffer);
  bytes.set([0xff, 0xd8], 0); // SOI
  bytes.set([0xff, 0xe0], 2); // APP0
  view.setUint16(4, 16); // segment length, so the next marker is at 20
  bytes.set([0x4a, 0x46, 0x49, 0x46, 0x00], 6); // 'JFIF\0'
  bytes.set([0xff, 0xc0], 20); // SOF0
  view.setUint16(22, 17);
  bytes[24] = 8; // sample precision
  view.setUint16(25, height);
  view.setUint16(27, width);
  return bytes;
}

/**
 * The filename a pasted blob actually arrives with.
 *
 * ⚠ NOT `''`. A multipart part with no filename is a FIELD, not a file, so an
 * empty name makes the request look empty to any parser and the test fails
 * with a 400 that has nothing to do with pasting. The point of the paste path
 * is that whatever name is sent is IGNORED — which `T-PASTE-005t` asserts
 * with a name that would be unmistakable if it leaked through.
 */
const PASTED_NAME = 'image.png';

interface AcceptedBody {
  imageId: string;
  fileName: string;
  format: string;
  uploadedFormat: string;
  ingestSource: string;
  byteSize: number;
  width: number;
  height: number;
}

interface ImagesBody {
  accepted: AcceptedBody[];
  rejected: { fileName: string; code: string; message: string }[];
  batchTotals: { imageCount: number; byteSize: number };
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

/**
 * Post files as real `multipart/form-data`.
 *
 * ⚠ `declaredType` defaults to `application/octet-stream` ON PURPOSE. That is
 * literally what iOS Safari sends for a HEIC, and it is the value
 * `T-PASTE-006` requires the server to ignore. Defaulting to `image/png` here
 * would have let a `Content-Type`-trusting implementation pass every test in
 * this file.
 */
async function postImages(
  batchId: string,
  files: { name: string; bytes: Uint8Array; declaredType?: string }[],
  ingestSource?: string,
): Promise<Response> {
  const form = new FormData();
  if (ingestSource !== undefined) {
    form.append('ingestSource', ingestSource);
  }
  for (const file of files) {
    form.append(
      'files',
      new Blob([file.bytes as unknown as BlobPart], {
        type: file.declaredType ?? 'application/octet-stream',
      }),
      file.name,
    );
  }
  return fetch(`${origin}/api/batches/${batchId}/images`, {
    method: 'POST',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader() },
    body: form,
  });
}

async function openBatch(service = 'netflix', mode = 'append-only'): Promise<string> {
  const res = await fetch(`${origin}/api/batches`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader(),
    },
    body: JSON.stringify({ service, mode }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { batchId: string }).batchId;
}

beforeEach(async () => {
  resetAllowListWarning();
  resetBlobStoreForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  // Azurite. Set here rather than assumed so a developer who forgot gets a
  // connection error naming the emulator, not a confusing 500.
  process.env['AZURE_STORAGE_CONNECTION_STRING'] ??= 'UseDevelopmentStorage=true';
  testPrisma();
  await resetDatabase();

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  // Derived from a real row so the test never hard-codes the subject hash.
  const seedBatch = await openBatch();
  ownerId = (await testPrisma().uploadBatch.findFirst({ where: { id: seedBatch } }))?.ownerId ?? '';
  await resetDatabase();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-PASTE-003 successive pastes append to the ONE open batch', () => {
  it('T-PASTE-003a: three pastes produce one batch, three images, ordinals 01/02/03', async () => {
    const batchId = await openBatch();

    const names: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await postImages(batchId, [{ name: PASTED_NAME, bytes: pngBytes() }], 'paste');
      expect(res.status).toBe(201);
      const body = (await res.json()) as ImagesBody;
      expect(body.batchTotals.imageCount).toBe(i + 1);
      names.push(body.accepted[0]?.fileName ?? '');
    }

    // ⚠ THE ASSERTION THIS WHOLE SUITE EXISTS FOR. The ordinal is continued
    // from what the batch already HOLDS, across separate requests. A route
    // that restarted at 1 per request would give three files called `-01`,
    // which passes every unit test because the pipeline is handed the start.
    expect(names.map((n) => n.slice(-7))).toEqual(['-01.png', '-02.png', '-03.png']);
    expect(names[0]).toMatch(/^pasted-\d{8}-\d{6}-01\.png$/);
    expect(new Set(names).size).toBe(3);

    // ONE batch, not three. A paste never creates or submits a batch (`A45`).
    expect(await testPrisma().uploadBatch.count({ where: { ownerId } })).toBe(1);
    expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(3);
  });

  it('T-PASTE-003b: paste, drop and upload all land in the SAME batch and are counted together', async () => {
    const batchId = await openBatch();

    await postImages(batchId, [{ name: PASTED_NAME, bytes: pngBytes() }], 'paste');
    await postImages(batchId, [{ name: 'dragged.png', bytes: pngBytes() }], 'drop');
    const last = await postImages(batchId, [{ name: 'chosen.png', bytes: pngBytes() }], 'upload');

    const body = (await last.json()) as ImagesBody;
    // The totals are across ALL sources — a per-source tally would let a batch
    // hold three times the ceiling.
    expect(body.batchTotals.imageCount).toBe(3);

    const rows = await testPrisma().uploadedImage.findMany({ where: { ownerId, batchId } });
    expect(rows.map((r) => r.ingestSource).sort()).toEqual(['drop', 'paste', 'upload']);
    expect(await testPrisma().uploadBatch.count({ where: { ownerId } })).toBe(1);
  });
});

describe('T-PASTE-005 naming and ingestSource are server facts, not client claims', () => {
  it('T-PASTE-005t: a paste IGNORES the client filename entirely', async () => {
    const batchId = await openBatch();
    const res = await postImages(
      batchId,
      [{ name: 'my-holiday-photo.png', bytes: pngBytes() }],
      'paste',
    );

    const body = (await res.json()) as ImagesBody;
    expect(body.accepted[0]?.fileName).not.toContain('holiday');
    expect(body.accepted[0]?.fileName).toMatch(/^pasted-/);

    const row = await testPrisma().uploadedImage.findFirst({ where: { ownerId, batchId } });
    expect(row?.fileName).toBe(body.accepted[0]?.fileName);
  });

  it('T-PASTE-005u: an upload KEEPS the device name', async () => {
    const batchId = await openBatch();
    const res = await postImages(batchId, [{ name: 'IMG_4821.PNG', bytes: pngBytes() }], 'upload');

    const body = (await res.json()) as ImagesBody;
    expect(body.accepted[0]?.fileName).toBe('IMG_4821.PNG');
  });

  it('T-PASTE-005v: ingestSource is read from the FIELD, never inferred from the filename prefix', async () => {
    const batchId = await openBatch();
    // A file literally named `pasted-…` arriving by upload. An implementation
    // that recovered provenance from the name would record `paste` here.
    const res = await postImages(
      batchId,
      [{ name: 'pasted-2026-08-11-154233-01.png', bytes: pngBytes() }],
      'upload',
    );
    expect(res.status).toBe(201);

    const row = await testPrisma().uploadedImage.findFirst({ where: { ownerId, batchId } });
    expect(row?.ingestSource).toBe('upload');
    expect(row?.fileName).toBe('pasted-2026-08-11-154233-01.png');
  });

  it('T-PASTE-005w: an absent ingestSource defaults to upload; an unknown one is refused', async () => {
    const batchId = await openBatch();

    const defaulted = await postImages(batchId, [{ name: 'a.png', bytes: pngBytes() }]);
    expect(defaulted.status).toBe(201);
    expect(((await defaulted.json()) as ImagesBody).accepted[0]?.ingestSource).toBe('upload');

    // Refused rather than coerced: the column is provenance, and quietly
    // recording the WRONG provenance is worse than refusing the request.
    const bogus = await postImages(batchId, [{ name: 'b.png', bytes: pngBytes() }], 'airdrop');
    expect(bogus.status).toBe(400);
    expect(((await bogus.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(1);
  });
});

describe('T-PASTE-006 the declared content type is never trusted', () => {
  it('T-PASTE-006b: a PNG declared as application/octet-stream is accepted by magic bytes', async () => {
    const batchId = await openBatch();
    const res = await postImages(
      batchId,
      [{ name: 'x.png', bytes: pngBytes(), declaredType: 'application/octet-stream' }],
      'paste',
    );

    expect(res.status).toBe(201);
    expect(((await res.json()) as ImagesBody).accepted[0]?.uploadedFormat).toBe('png');
  });

  it('T-PASTE-006c: a NON-image declared as image/png is refused', async () => {
    const batchId = await openBatch();
    const res = await postImages(
      batchId,
      [
        {
          name: 'invoice.png',
          bytes: new TextEncoder().encode('%PDF-1.7\nnot an image at all'),
          declaredType: 'image/png',
        },
      ],
      'paste',
    );

    expect(res.status).toBe(415);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('UNSUPPORTED_IMAGE_FORMAT');
    expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(0);
  });
});

describe('T-PASTE-007 every ceiling applies identically to pasted images', () => {
  it('T-PASTE-007b: the per-request file ceiling refuses a paste exactly as it refuses an upload', async () => {
    const batchId = await openBatch();
    const many = Array.from({ length: MAX_FILES_PER_REQUEST + 1 }, (_, i) => ({
      name: `f${String(i)}.png`,
      bytes: pngBytes(),
    }));

    for (const source of ['paste', 'upload'] as const) {
      const res = await postImages(batchId, many, source);
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe('TOO_MANY_FILES_IN_REQUEST');
    }
    // Refusing the REQUEST means nothing landed — not a partial accept.
    expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(0);
  });

  it('T-PASTE-007c: an empty request is refused for every source', async () => {
    const batchId = await openBatch();
    const res = await postImages(batchId, [], 'paste');
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('T-IMG-002 / T-IMG-006 / T-IMG-010 partial acceptance across a real request', () => {
  it('T-IMG-002d: a valid file beside an invalid one is 201, with the bad one named', async () => {
    const batchId = await openBatch();
    const res = await postImages(
      batchId,
      [
        { name: 'good.png', bytes: pngBytes() },
        { name: 'notes.txt', bytes: new TextEncoder().encode('just some text') },
        { name: 'also-good.png', bytes: pngBytes(800, 600) },
      ],
      'upload',
    );

    // 201 because SOMETHING was accepted. A 4xx here would tell the owner the
    // two good screenshots were lost when they were not.
    expect(res.status).toBe(201);
    const body = (await res.json()) as ImagesBody;
    expect(body.accepted.map((a) => a.fileName)).toEqual(['good.png', 'also-good.png']);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0]?.fileName).toBe('notes.txt');
    expect(body.batchTotals.imageCount).toBe(2);

    // The failed file is the ONLY one missing from the store.
    expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(2);
  });

  it('T-IMG-006e: a non-image alone is 415 and named in rejected[]', async () => {
    const batchId = await openBatch();
    const res = await postImages(
      batchId,
      [
        {
          name: 'resume.docx',
          bytes: new TextEncoder().encode('PK\u0003\u0004 zip, not an image'),
        },
      ],
      'upload',
    );

    expect(res.status).toBe(415);
    const body = (await res.json()) as ErrorBody;
    const rejected = body.error.details['rejected'] as { fileName: string; message: string }[];
    expect(rejected[0]?.fileName).toBe('resume.docx');
    // The format refusal must mention NEITHER memory NOR the runbook — more
    // memory never fixes a file that is not an image (`T-IMG-020`).
    expect(rejected[0]?.message.toLowerCase()).not.toContain('memory');
    expect(rejected[0]?.message).not.toContain('runbook');
  });

  it('T-IMG-010e: byte totals accumulate across requests and match the stored rows', async () => {
    const batchId = await openBatch();
    await postImages(batchId, [{ name: 'a.png', bytes: pngBytes(1179, 2556, 40) }], 'upload');
    const second = await postImages(batchId, [{ name: 'b.png', bytes: pngBytes() }], 'paste');

    const body = (await second.json()) as ImagesBody;
    const rows = await testPrisma().uploadedImage.findMany({ where: { ownerId, batchId } });
    const stored = rows.reduce((sum, r) => sum + Number(r.byteSize), 0);

    expect(body.batchTotals.imageCount).toBe(2);
    expect(body.batchTotals.byteSize).toBe(stored);
  });
});

describe('T-IMG-012 uploadedFormat is recorded as received', () => {
  it('T-IMG-012d: a JPEG round-trips with uploadedFormat jpeg and stored format jpeg', async () => {
    const batchId = await openBatch();
    const res = await postImages(batchId, [{ name: 'photo.jpg', bytes: jpegBytes() }], 'upload');

    expect(res.status).toBe(201);
    const row = await testPrisma().uploadedImage.findFirst({ where: { ownerId, batchId } });
    expect(row?.uploadedFormat).toBe('jpeg');
    expect(row?.format).toBe('jpeg');
    expect(row?.width).toBe(1200);
    expect(row?.height).toBe(1600);
  });
});

describe('T-SEC-003 no blob path, URL or SAS in any response', () => {
  it('T-SEC-003a: blobPath appears nowhere in the response body', async () => {
    const batchId = await openBatch();
    const res = await postImages(batchId, [{ name: 'x.png', bytes: pngBytes() }], 'paste');
    // Asserted against the RAW serialised body, not a parsed field, because
    // the leak this guards against is a future `...spread` adding a key
    // nobody named.
    const raw = await res.text();

    const row = await testPrisma().uploadedImage.findFirst({ where: { ownerId, batchId } });
    expect(row?.blobPath).toBeTruthy();
    expect(raw).not.toContain(row?.blobPath ?? '@@never@@');
    expect(raw).not.toContain('blobPath');
    expect(raw).not.toContain('sig=');
    expect(raw).not.toContain('blob.core.windows.net');
  });

  it('T-SEC-003b: blobPath is composed from ULIDs and carries no part of the client name', async () => {
    const batchId = await openBatch();
    // ⚠ NO SLASHES. `FormData` (undici, and every browser) strips path
    // segments from a part's filename before it is ever sent, so
    // `../../etc/passwd.png` arrives as `passwd.png` and a test written that
    // way asserts the CLIENT's normalisation, not the server's. The traversal
    // marker is kept in a form that survives the wire.
    const evil = '..%2F..%2Fetc%2Fpasswd-zzevil.png';
    await postImages(batchId, [{ name: evil, bytes: pngBytes() }], 'upload');

    const row = await testPrisma().uploadedImage.findFirst({ where: { ownerId, batchId } });
    // The name is kept verbatim for DISPLAY …
    expect(row?.fileName).toBe(evil);
    // … and absent from the path, which is owner/batch/image only.
    expect(row?.blobPath).not.toContain('zzevil');
    expect(row?.blobPath).not.toContain('..');
    expect(row?.blobPath).toBe(`${ownerId}/${batchId}/${row?.id ?? ''}.png`);
  });
});

describe('T-RET-014 retention is stamped at ingest', () => {
  it('T-RET-014a: retainUntil is 30 days after receipt, from the image retention constant alone', async () => {
    const batchId = await openBatch();
    const before = Date.now();
    await postImages(batchId, [{ name: 'x.png', bytes: pngBytes() }], 'paste');

    const row = await testPrisma().uploadedImage.findFirst({ where: { ownerId, batchId } });
    const days = ((row?.retainUntil?.getTime() ?? 0) - before) / (24 * 60 * 60 * 1000);
    // ⚠ 30, and it must never be confused with `TMDB_METADATA_MAX_AGE_DAYS`
    // (183). The two 30-ish constants are separate on purpose (`T-INV-008`).
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });
});

describe('T-IMG-023 images attach to a DRAFT batch only', () => {
  it('T-IMG-023d: a submitted batch refuses more images with 409 BATCH_NOT_DRAFT', async () => {
    const batchId = await openBatch();
    await postImages(batchId, [{ name: 'x.png', bytes: pngBytes() }], 'paste');
    await testPrisma().uploadBatch.updateMany({
      where: { ownerId, id: batchId },
      data: { status: 'submitted' },
    });

    const res = await postImages(batchId, [{ name: 'y.png', bytes: pngBytes() }], 'paste');
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('BATCH_NOT_DRAFT');
    expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(1);
  });

  it('T-IMG-023e: a batch belonging to nobody is 404, not 409', async () => {
    const res = await postImages('batch-that-does-not-exist', [
      { name: 'x.png', bytes: pngBytes() },
    ]);
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });
});
