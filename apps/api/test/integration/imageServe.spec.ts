/**
 * TASK-052 — `GET /api/images/:imageId` end to end (`specs/api.md` §6.27).
 * The path `specs/testing.md` §11 names for an API integration suite.
 *
 * `T-IMG-002` (bytes are only ever served authenticated, with the mandated
 * headers), `T-IMG-004` (at `retainUntil`, bytes are unavailable to the
 * application), `T-IMG-005` (a missing blob is 410, never 500), `T-SEC-003`
 * (no blob path, URL or SAS in any response).
 *
 * Integration rather than unit because every claim here is about the ROUND
 * TRIP. The unit suite proves what the handler does when the store answers in
 * each of four ways; this one proves that the bytes a real upload put into a
 * real Azurite come back out byte-identical through the route, and that the
 * 410 arms are reachable from a genuinely stored image rather than from a
 * mocked row that asserts the mock.
 *
 * ⚠ `T-IMG-004` is asserted by moving `retainUntil` on the stored row, not by
 * waiting. Azurite does not implement lifecycle rules at all
 * (`specs/testing.md` §3.4), so the 30-day purge cannot be provoked here; the
 * infrastructure half is asserted separately against the Bicep. What this
 * suite owns is the APPLICATION boundary — that the API stops serving the
 * bytes on time, whatever storage has or has not got round to doing.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { azureImageBlobStore, resetBlobStoreForTests } from '../../src/storage/blobStore.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-image-serve-int';
const OTHER_SUBJECT = 'oid-other-image-serve-int';
const ISSUER = 'https://sts.windows.net/tenant/';

const principalHeader = (subject = SUBJECT): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: ISSUER },
        { typ: OID, val: subject },
        { typ: 'preferred_username', val: 'owner@example.com' },
      ],
    }),
    'utf8',
  ).toString('base64');

/** A real PNG header — signature then `IHDR`. The sniff reads only this. */
function pngBytes(width = 1179, height = 2556): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

interface ImagesBody {
  accepted: { imageId: string; format: string }[];
  rejected: { fileName: string; code: string }[];
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

let server: Server;
let app: Express;
let origin: string;

async function openBatch(): Promise<string> {
  const res = await fetch(`${origin}/api/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CLIENT_PRINCIPAL_HEADER]: principalHeader() },
    body: JSON.stringify({ service: 'netflix', mode: 'append-only' }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { batchId: string }).batchId;
}

/** Upload one PNG and return its id — the only way an image ever exists. */
async function uploadImage(): Promise<string> {
  const batchId = await openBatch();
  const form = new FormData();
  form.append(
    'files',
    new Blob([pngBytes() as unknown as BlobPart], { type: 'application/octet-stream' }),
    'IMG_0042.PNG',
  );
  const res = await fetch(`${origin}/api/batches/${batchId}/images`, {
    method: 'POST',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader() },
    body: form,
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as ImagesBody;
  expect(body.rejected).toHaveLength(0);
  return body.accepted[0]?.imageId ?? '';
}

const getImage = (imageId: string, subject = SUBJECT): Promise<Response> =>
  fetch(`${origin}/api/images/${imageId}`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject) },
  });

beforeEach(async () => {
  resetAllowListWarning();
  resetBlobStoreForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = `${SUBJECT},${OTHER_SUBJECT}`;
  process.env['AZURE_STORAGE_CONNECTION_STRING'] ??= 'UseDevelopmentStorage=true';
  testPrisma();
  await resetDatabase();

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-IMG-002 · US-035 AC-4 · bytes come back through the route, authenticated', () => {
  it('T-IMG-002n: the stored bytes round-trip byte-identical, with every mandated header', async () => {
    const imageId = await uploadImage();

    const res = await getImage(imageId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('inline');

    // Compared against what is actually IN the container, read directly, so a
    // route that served a different blob than the row names would fail. The
    // uploaded bytes are not the reference: the metadata strip may rewrite
    // them, and asserting against the upload would make REQ-078 look like a
    // corruption bug the first time it did something.
    const row = await testPrisma().uploadedImage.findFirst({ where: { id: imageId } });
    const stored = await azureImageBlobStore.get(row?.blobPath ?? '');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(stored);
    expect(res.headers.get('content-length')).toBe(String(stored?.byteLength ?? -1));
  });

  it('T-IMG-002o: an anonymous request gets 401, never the bytes', async () => {
    const imageId = await uploadImage();
    const res = await fetch(`${origin}/api/images/${imageId}`);
    expect(res.status).toBe(401);
  });

  it('T-SEC-002i: another owner’s image is 404, indistinguishable from missing', async () => {
    // US-036 AC-3. A 403 would confirm the row exists; a 200 would be the
    // whole product's worst failure.
    const imageId = await uploadImage();
    const res = await getImage(imageId, OTHER_SUBJECT);
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('T-SEC-002j: an unknown id is 404 with the same envelope', async () => {
    const res = await getImage('01J000000000000000000X');
    expect(res.status).toBe(404);
  });
});

describe('T-IMG-004 · US-035 AC-1 · at retainUntil the application stops serving', () => {
  it('T-IMG-004e: a reached retainUntil is 410 IMAGE_EXPIRED even though the BLOB IS STILL THERE', async () => {
    // ⚠ The blob is deliberately left in place. The application boundary is
    // what US-035 AC-1 is about: the API must stop serving on time regardless
    // of when the storage lifecycle rule actually runs. If this passed only
    // because the bytes were gone, the assertion would be `T-IMG-005`'s.
    const imageId = await uploadImage();
    await testPrisma().uploadedImage.updateMany({
      where: { id: imageId },
      data: { retainUntil: new Date(Date.now() - 60_000) },
    });

    const row = await testPrisma().uploadedImage.findFirst({ where: { id: imageId } });
    expect(await azureImageBlobStore.get(row?.blobPath ?? '')).not.toBeNull();

    const res = await getImage(imageId);
    expect(res.status).toBe(410);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('IMAGE_EXPIRED');
    expect(body.error.details['retainUntil']).toBe(row?.retainUntil.toISOString());
  });

  it('T-IMG-004f: the ROW survives the expiry — REQ-028, nothing is deleted', async () => {
    const imageId = await uploadImage();
    await testPrisma().uploadedImage.updateMany({
      where: { id: imageId },
      data: { retainUntil: new Date(Date.now() - 60_000) },
    });

    await getImage(imageId);
    await getImage(imageId);

    // The row is the record that a capture happened and outlives the bytes
    // forever. A route that tidied it up would make the batch unreadable.
    expect(await testPrisma().uploadedImage.count({ where: { id: imageId } })).toBe(1);
  });

  it('T-IMG-004g: retainUntil is stamped ahead of now at ingest, so a fresh image serves', async () => {
    // Non-vacuity for the two above: if `retainUntil` were stamped in the past
    // by mistake, every image would 410 and both assertions would still pass.
    const imageId = await uploadImage();
    const row = await testPrisma().uploadedImage.findFirst({ where: { id: imageId } });
    expect(row?.retainUntil.getTime()).toBeGreaterThan(Date.now());
    expect((await getImage(imageId)).status).toBe(200);
  });
});

describe('T-IMG-005 · US-035 AC-6 · a missing blob is 410, never 500', () => {
  it('T-IMG-005c: a live, in-retention row whose blob is gone answers 410', async () => {
    // The steady state from day 31: the lifecycle rule removed the bytes and
    // wrote nothing back to the row. Reproduced by removing the blob directly,
    // which is what the rule does. A 500 here would turn designed behaviour
    // into an error page and an alert every day.
    const imageId = await uploadImage();
    const row = await testPrisma().uploadedImage.findFirst({ where: { id: imageId } });
    await azureImageBlobStore.remove(row?.blobPath ?? '');

    const res = await getImage(imageId);
    expect(res.status).toBe(410);
    expect(((await res.json()) as ErrorBody).error.code).toBe('IMAGE_EXPIRED');
  });
});

describe('T-SEC-003 · no blob path, URL or SAS reaches the client', () => {
  it('T-SEC-003j: neither the 200 headers nor the 410 body name the blob', async () => {
    const imageId = await uploadImage();
    const row = await testPrisma().uploadedImage.findFirst({ where: { id: imageId } });
    const blobPath = row?.blobPath ?? '';
    expect(blobPath.length).toBeGreaterThan(0);

    const ok = await getImage(imageId);
    const headers = JSON.stringify([...ok.headers.entries()]);
    expect(headers).not.toContain(blobPath);
    expect(headers.toLowerCase()).not.toContain('blob.core.windows.net');
    expect(headers.toLowerCase()).not.toContain('sig=');
    // A 302 to storage would BE the SAS leak, with a 200 body to hide it.
    expect(ok.redirected).toBe(false);

    await azureImageBlobStore.remove(blobPath);
    const gone = await getImage(imageId);
    expect(await gone.text()).not.toContain(blobPath);
  });
});
