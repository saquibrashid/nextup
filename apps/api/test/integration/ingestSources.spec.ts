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

import {
  IMAGE_DECODE_BEGIN,
  MAX_FILES_PER_REQUEST,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_BATCH,
} from '@nextup/domain';
import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { azureImageBlobStore, resetBlobStoreForTests } from '../../src/storage/blobStore.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';
import {
  INGEST_FIXTURES,
  loadIngestFixture,
} from '../../../../tests/fixtures/golden/ingest/index.js';

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
  // ⚠ 29 bytes was a header stub that stopped mid-SOF0. It was enough while
  // nothing walked the file, but the REQ-078 metadata strip does walk it, and
  // it fails closed on a stream it cannot account for -- correctly, since
  // storing bytes whose contents were never established is the thing REQ-078
  // exists to prevent. A truncated fixture is not a JPEG; complete it.
  const bytes = new Uint8Array(53);
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
  bytes.set([0xff, 0xda], 39); // SOS
  view.setUint16(41, 8);
  bytes.set([0x12, 0x34], 49); // entropy-coded data
  bytes.set([0xff, 0xd9], 51); // EOI
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
  batchTotals: { imageCount: number; uploadedByteSize: number; storedByteSize: number };
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

async function reextract(batchId: string): Promise<Response> {
  return fetch(`${origin}/api/batches/${batchId}/re-extract`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader(),
    },
    body: JSON.stringify({}),
  });
}

function isCreateBatchCall(call: Parameters<typeof fetch>): boolean {
  const [input, init] = call;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(url).pathname === '/api/batches' && init?.method === 'POST';
}

async function captureStdoutWhile<T>(
  action: () => Promise<T>,
): Promise<{ value: T; events: Record<string, unknown>[] }> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write);

  try {
    const value = await action();
    const events = chunks
      .flatMap((chunk) => chunk.split(/\r?\n/))
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    return { value, events };
  } finally {
    spy.mockRestore();
  }
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
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
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
    expect(fetchSpy.mock.calls.filter((call) => isCreateBatchCall(call)).length).toBe(1);
    expect(await testPrisma().uploadBatch.count({ where: { ownerId } })).toBe(1);
    expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(3);
  });

  it('T-PASTE-003b: paste, drop and upload all land in the SAME batch and are counted together', async () => {
    const batchId = await openBatch();

    await postImages(batchId, [{ name: 'chosen.png', bytes: pngBytes() }], 'upload');
    await postImages(batchId, [{ name: PASTED_NAME, bytes: pngBytes() }], 'paste');
    const last = await postImages(batchId, [{ name: 'dragged.png', bytes: pngBytes() }], 'drop');

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
  it('T-PASTE-006a: a paste whose bytes are a PDF is refused exactly like an upload', async () => {
    expect(INGEST_FIXTURES.lyingBlob.declaredContentType).toBe('image/png');
    const batchId = await openBatch();

    for (const source of ['paste', 'upload'] as const) {
      const res = await postImages(
        batchId,
        [
          {
            name: 'invoice.png',
            bytes: loadIngestFixture('lyingBlob'),
            declaredType: INGEST_FIXTURES.lyingBlob.declaredContentType,
          },
        ],
        source,
      );

      expect(res.status).toBe(415);
      expect(((await res.json()) as ErrorBody).error.code).toBe('UNSUPPORTED_IMAGE_FORMAT');
      expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(0);
    }
  });

  it('T-PASTE-006b: a PNG declared as application/octet-stream is accepted by magic bytes', async () => {
    const batchId = await openBatch();
    const res = await postImages(
      batchId,
      [
        {
          name: PASTED_NAME,
          bytes: loadIngestFixture('clipboardBlob'),
          declaredType: 'application/octet-stream',
        },
      ],
      'paste',
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as ImagesBody;
    expect(body.accepted[0]?.uploadedFormat).toBe('png');
    expect(body.accepted[0]?.width).toBe(1170);
    expect(body.accepted[0]?.height).toBe(2532);
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
  it('T-PASTE-007a: a pasted 48 MP PNG is refused before any decode begins', async () => {
    const batchId = await openBatch();
    const captured = await captureStdoutWhile(() =>
      postImages(
        batchId,
        [{ name: PASTED_NAME, bytes: pngBytes(8064, 5952), declaredType: 'image/png' }],
        'paste',
      ),
    );

    expect(captured.value.status).toBe(413);
    expect(((await captured.value.json()) as ErrorBody).error.code).toBe(
      'IMAGE_TOO_LARGE_TO_DECODE',
    );
    expect(captured.events.some((event) => event['event'] === IMAGE_DECODE_BEGIN)).toBe(false);
    expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(0);
  });

  it('T-PASTE-007: an 11 MiB paste is refused by the ingest byte ceiling, not multer', async () => {
    // This uses a real multipart body so the route-level multer mapper stays
    // covered on the same integration path the paste affordance exercises.
    const batchId = await openBatch();
    const tooLarge = await postImages(
      batchId,
      [
        {
          name: PASTED_NAME,
          bytes: pngBytes(1179, 2556, MAX_IMAGE_BYTES),
          declaredType: 'image/png',
        },
      ],
      'paste',
    );

    expect(tooLarge.status).toBe(413);
    expect(((await tooLarge.json()) as ErrorBody).error.code).toBe('IMAGE_TOO_LARGE');
    expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(0);
  });

  it('T-PASTE-007b: the 41st image is refused whether it arrives by paste or upload', async () => {
    for (const [index, source] of (['paste', 'upload'] as const).entries()) {
      if (index > 0) {
        await resetDatabase();
      }
      const batchId = await openBatch();

      for (let start = 0; start < MAX_IMAGES_PER_BATCH; start += MAX_FILES_PER_REQUEST) {
        const chunk = Array.from({ length: MAX_FILES_PER_REQUEST }, (_, offset) => ({
          name: `seed-${String(start + offset + 1).padStart(2, '0')}.png`,
          bytes: pngBytes(),
        }));
        const fill = await postImages(batchId, chunk, 'upload');
        expect(fill.status).toBe(201);
      }

      expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(
        MAX_IMAGES_PER_BATCH,
      );

      const res = await postImages(batchId, [{ name: PASTED_NAME, bytes: pngBytes() }], source);
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorBody;
      expect(body.error.code).toBe('TOO_MANY_IMAGES');
      expect(body.error.details).toMatchObject({
        current: MAX_IMAGES_PER_BATCH,
        incoming: 1,
      });
    }
  });

  it('T-PASTE-007c: image.decode.begin carries the source that reached the shared route', async () => {
    const batchId = await openBatch();
    const captured = await captureStdoutWhile(() =>
      postImages(batchId, [{ name: PASTED_NAME, bytes: pngBytes() }], 'paste'),
    );
    expect(captured.value.status).toBe(201);

    const begin = captured.events.find((event) => event['event'] === IMAGE_DECODE_BEGIN);
    expect(begin).toMatchObject({
      event: IMAGE_DECODE_BEGIN,
      ingestSource: 'paste',
      uploadedFormat: 'png',
      fileName: expect.stringMatching(/^pasted-\d{8}-\d{6}-01\.png$/) as unknown,
    });
  });

  it('T-PASTE-007d: the per-request file ceiling refuses a paste exactly as it refuses an upload', async () => {
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

    for (const source of ['paste', 'upload'] as const) {
      const beyondMulterBackstop = Array.from({ length: MAX_FILES_PER_REQUEST + 2 }, (_, i) => ({
        name: `backstop-${String(i)}.png`,
        bytes: pngBytes(),
      }));

      const res = await postImages(batchId, beyondMulterBackstop, source);
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe('TOO_MANY_FILES_IN_REQUEST');
      expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(0);
    }
  });

  it('T-PASTE-007e: an empty request is refused for every source', async () => {
    const batchId = await openBatch();
    for (const source of ['paste', 'upload', 'drop'] as const) {
      const res = await postImages(batchId, [], source);
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    }
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
    expect(body.batchTotals.storedByteSize).toBe(stored);
    // ⚠ These do NOT coincide even without a transcode. The metadata strip
    // (REQ-078) rewrites the file too, so a plain PNG stores smaller than it
    // arrived. Asserting equality here failed on exactly that — 106 uploaded,
    // 102 stored. The invariant is the ORDER, not equality.
    const uploaded = rows.reduce((sum, r) => sum + Number(r.uploadedByteSize), 0);
    expect(body.batchTotals.uploadedByteSize).toBe(uploaded);
    expect(uploaded).toBeGreaterThanOrEqual(stored);
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
  it('T-RET-014a: pasted-image retention is stamped once and purged like uploads', async () => {
    const batchId = await openBatch();
    const before = Date.now();
    await postImages(batchId, [{ name: 'x.png', bytes: pngBytes() }], 'paste');

    const row = await testPrisma().uploadedImage.findFirstOrThrow({ where: { ownerId, batchId } });
    const firstRetainUntil = row.retainUntil;
    const days = (firstRetainUntil.getTime() - before) / (24 * 60 * 60 * 1000);
    // ⚠ 30, and it must never be confused with `TMDB_METADATA_MAX_AGE_DAYS`
    // (183). The two 30-ish constants are separate on purpose (`T-INV-008`).
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    await postImages(batchId, [{ name: 'y.png', bytes: pngBytes() }], 'upload');
    const afterSecondAttach = await testPrisma().uploadedImage.findFirstOrThrow({
      where: { ownerId, id: row.id },
    });
    expect(afterSecondAttach.retainUntil.toISOString()).toBe(firstRetainUntil.toISOString());

    await testPrisma().uploadBatch.update({
      where: { id: batchId },
      data: { status: 'applied' },
    });
    await testPrisma().uploadedImage.update({
      where: { id: row.id },
      data: { retainUntil: new Date('2020-01-01T00:00:00.000Z') },
    });

    const res = await reextract(batchId);
    expect(res.status).toBe(410);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('IMAGES_PURGED');
    expect(body.error.message).toContain('30 days');
  });
});

/**
 * ⚠ THE ONE PLACE THE STORED BYTES THEMSELVES ARE INSPECTED.
 *
 * Everything else asserts responses and rows. REQ-078 is a claim about what
 * landed in the blob, so it is read back out of a REAL Azurite here. And it is
 * asserted for an UPLOADED image: WebKit strips EXIF on clipboard read but not
 * on file upload, so a pasted fixture would pass no matter what our code did.
 */
describe('T-SEC-032 the STORED blob carries no EXIF or GPS', () => {
  /** SOI, JFIF APP0, an APP1 EXIF block with a GPS IFD, SOF0, SOS, EOI. */
  function jpegWithGps(): Uint8Array {
    const exif = [
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00,
      0x01, 0x88, 0x25, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00,
      0x00, 0x2f, 0x00, 0x00, 0x00, 0x01,
    ];
    const app1 = [0xff, 0xe1, ((exif.length + 2) >> 8) & 0xff, (exif.length + 2) & 0xff, ...exif];
    return new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0x00,
      0x10,
      0x4a,
      0x46,
      0x49,
      0x46,
      0x00,
      0x01,
      0x02,
      0x00,
      0x00,
      0x01,
      0x00,
      0x01,
      0x00,
      0x00,
      ...app1,
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      0x06,
      0x40,
      0x04,
      0xb0,
      0x03,
      0x01,
      0x11,
      0x00,
      0x02,
      0x11,
      0x01,
      0x03,
      0x11,
      0x01,
      0xff,
      0xda,
      0x00,
      0x08,
      0x01,
      0x01,
      0x00,
      0x00,
      0x3f,
      0x00,
      0x12,
      0x34,
      0x56,
      0x78,
      0xff,
      0xd9,
    ]);
  }

  const has = (bytes: Uint8Array, needle: readonly number[]): boolean =>
    Buffer.from(bytes).includes(Buffer.from(needle));

  it('T-SEC-032g: an UPLOADED JPEG lands stripped in the blob store', async () => {
    const batchId = await openBatch();
    const source = jpegWithGps();
    // The non-vacuity guard: if the fixture ever stops carrying EXIF, the
    // assertion below would pass against a strip that did nothing at all.
    expect(has(source, [0x45, 0x78, 0x69, 0x66])).toBe(true);

    const res = await postImages(batchId, [{ name: 'IMG_0042.jpg', bytes: source }], 'upload');
    expect(res.status).toBe(201);

    const row = await testPrisma().uploadedImage.findFirst({ where: { ownerId, batchId } });
    const stored = await azureImageBlobStore.get(row?.blobPath ?? '');

    expect(stored).not.toBeNull();
    expect(has(stored ?? new Uint8Array(), [0x45, 0x78, 0x69, 0x66])).toBe(false);
    expect(has(stored ?? new Uint8Array(), [0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x01])).toBe(
      false,
    );
    // The raster survived: SOF0 and the entropy-coded data are still there.
    expect(has(stored ?? new Uint8Array(), [0xff, 0xc0])).toBe(true);
    expect(has(stored ?? new Uint8Array(), [0x12, 0x34, 0x56, 0x78])).toBe(true);
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
