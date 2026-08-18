/**
 * TASK-154 (`A43-M2`) — per-image failure isolation and retryability.
 * The path `specs/testing.md` §11 names for this suite.
 *
 * `T-IMG-018` (per-image isolation, no partial commit) and `T-IMG-019` (the
 * CATCHABLE OOM path) asserted end to end through the real route, the real
 * store and a real database.
 *
 * ⚠ INTEGRATION, NOT UNIT, AND DELIBERATELY SO. `apps/api/test/unit/ingest.spec.ts`
 * already proves the pipeline builds a `rejected[]` entry; what it physically
 * cannot prove is the property TASK-154 is actually about:
 *
 *  - that the SURVIVING images of the same request reach `uploaded_image` as
 *    real rows while the failed one does not,
 *  - that the batch is still `draft` and re-attachable afterwards,
 *  - that **no LIST state** (`Title` / `ServiceListing`) came into existence,
 *    which is the whole reason a failed screenshot is survivable, and
 *  - that every row that DOES exist points at a blob that is really there —
 *    the ordering `transcode → blob write → staged row` is a property of two
 *    files cooperating and a stub would satisfy either order.
 *
 * ⚠ THE CEILING TESTS ARE NOT HERE. A ceiling the REQUEST breaches
 * (`TOO_MANY_FILES_IN_REQUEST`, `BATCH_TOO_LARGE`) refuses the whole request
 * by design; this suite is about the opposite case — a verdict about ONE
 * image — and conflating them is how per-image isolation gets "simplified"
 * into request-level failure.
 *
 * ⚠ Bytes go to a REAL Azurite (`docker compose -f docker-compose.test.yml`).
 */

import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { azureImageBlobStore, resetBlobStoreForTests } from '../../src/storage/blobStore.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

/**
 * ⚠ THE DOUBLE IS THE WASM DECODER ITSELF (`heic-convert`), NOT
 * `transcodeHeicToPng` and NOT the injected `IngestStages`.
 *
 * That choice is load-bearing. The OOM-vs-corrupt CLASSIFICATION lives inside
 * `transcodeHeicToPng`, so stubbing that function — or handing `createApp` a
 * fake stage — would move the code under test out of the test and leave the
 * classification asserted by nothing. Replacing the decoder puts the failure
 * exactly where a real allocation failure occurs and lets the real wrapper,
 * the real route and the real error envelope do their jobs.
 *
 * ⚠ `stripAllMetadata`, the guard and the sniff are all REAL. A privacy
 * control that is switched off in one suite is how it ends up switched off in
 * all of them.
 */
const decodeBehaviour: { throws: unknown | null; width: number; height: number } = {
  throws: null,
  width: 1179,
  height: 2556,
};

vi.mock('heic-convert', () => ({
  default: () => {
    if (decodeBehaviour.throws !== null) {
      return Promise.reject(decodeBehaviour.throws);
    }
    // A real PNG header at the DECLARED dimensions, so the wrapper's
    // post-decode consistency check sees what the `ispe` promised.
    return Promise.resolve(pngBytes(decodeBehaviour.width, decodeBehaviour.height));
  },
}));

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-ingest-guard';
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

/** A real PNG signature + `IHDR`. The sniff and the guard read the header only. */
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

/** `ftyp` with a HEIF brand, then one `ispe` — all the sniff and the guard read. */
function heicBytes(width = 1179, height = 2556): Uint8Array {
  const head = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
    0x68, 0x65, 0x69, 0x63, 0x6d, 0x69, 0x66, 0x31,
  ]);
  const ispe = new Uint8Array(20);
  const view = new DataView(ispe.buffer);
  view.setUint32(0, 20);
  ispe.set([0x69, 0x73, 0x70, 0x65], 4);
  view.setUint32(12, width);
  view.setUint32(16, height);
  const out = new Uint8Array(head.length + ispe.length);
  out.set(head, 0);
  out.set(ispe, head.length);
  return out;
}

/**
 * 8064 × 5952 = 48.0 MP. Above the default 25 MP budget and — the point of
 * `A43-M1` — only ~33 bytes, so the byte ceiling alone would have let it
 * through to a decode that exhausts the container.
 */
const OVER_GUARD = { width: 8064, height: 5952 };

interface AcceptedBody {
  imageId: string;
  fileName: string;
  format: string;
  byteSize: number;
}

interface ImagesBody {
  accepted: AcceptedBody[];
  rejected: { fileName: string; code: string; message: string }[];
  batchTotals: { imageCount: number; byteSize: number };
}

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

async function postImages(
  batchId: string,
  files: { name: string; bytes: Uint8Array }[],
): Promise<Response> {
  const form = new FormData();
  form.append('ingestSource', 'upload');
  for (const file of files) {
    form.append(
      'files',
      new Blob([file.bytes as unknown as BlobPart], { type: 'application/octet-stream' }),
      file.name,
    );
  }
  return fetch(`${origin}/api/batches/${batchId}/images`, {
    method: 'POST',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader() },
    body: form,
  });
}

async function openBatch(): Promise<string> {
  const res = await fetch(`${origin}/api/batches`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader(),
    },
    body: JSON.stringify({ service: 'netflix', mode: 'append-only' }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { batchId: string }).batchId;
}

/** Every stored row must point at a blob that is really there. */
async function assertNoDanglingRows(batchId: string): Promise<void> {
  const rows = await testPrisma().uploadedImage.findMany({ where: { ownerId, batchId } });
  for (const row of rows) {
    const stored = await azureImageBlobStore.get(row.blobPath);
    expect(stored, `row ${row.id} points at a missing blob ${row.blobPath}`).not.toBeNull();
  }
}

/**
 * The property the whole feature rests on: a failed screenshot leaves the
 * owner's LIST exactly as it was. Asserted directly against the two tables
 * that ARE the list, not against a response body.
 */
async function assertNoListState(): Promise<void> {
  expect(await testPrisma().title.count({ where: { ownerId } })).toBe(0);
  expect(await testPrisma().serviceListing.count({ where: { ownerId } })).toBe(0);
}

beforeEach(async () => {
  decodeBehaviour.throws = null;
  decodeBehaviour.width = 1179;
  decodeBehaviour.height = 2556;
  resetAllowListWarning();
  resetBlobStoreForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['AZURE_STORAGE_CONNECTION_STRING'] ??= 'UseDevelopmentStorage=true';
  delete process.env['NEXTUP_MAX_DECODE_PIXELS'];
  testPrisma();
  await resetDatabase();

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });

  const seedBatch = await openBatch();
  ownerId = (await testPrisma().uploadBatch.findFirst({ where: { id: seedBatch } }))?.ownerId ?? '';
  await resetDatabase();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
  delete process.env['NEXTUP_MAX_DECODE_PIXELS'];
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-IMG-018 one bad image fails ONE image', () => {
  it('T-IMG-018c: a 5-image request where image 3 trips the guard yields 4 accepted + 1 rejected', async () => {
    const batchId = await openBatch();

    const res = await postImages(batchId, [
      { name: '1.png', bytes: pngBytes() },
      { name: '2.png', bytes: pngBytes(800, 600) },
      { name: '3.heic', bytes: heicBytes(OVER_GUARD.width, OVER_GUARD.height) },
      { name: '4.png', bytes: pngBytes(1000, 1000) },
      { name: '5.png', bytes: pngBytes(1200, 900) },
    ]);

    // 201, not 4xx. Telling the owner the request failed when four screenshots
    // landed is the failure mode this whole task exists to prevent.
    expect(res.status).toBe(201);
    const body = (await res.json()) as ImagesBody;

    expect(body.accepted.map((a) => a.fileName)).toEqual(['1.png', '2.png', '4.png', '5.png']);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0]?.fileName).toBe('3.heic');
    expect(body.rejected[0]?.code).toBe('IMAGE_TOO_LARGE_TO_DECODE');
    // Only the accepted are counted — a failed image must not inflate the
    // ceiling the next paste is measured against.
    expect(body.batchTotals.imageCount).toBe(4);

    const rows = await testPrisma().uploadedImage.findMany({ where: { ownerId, batchId } });
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.fileName).sort()).toEqual(['1.png', '2.png', '4.png', '5.png']);

    // Still a DRAFT, so the owner can simply attach a smaller version.
    const batch = await testPrisma().uploadBatch.findFirst({ where: { id: batchId } });
    expect(batch?.status).toBe('draft');

    await assertNoListState();
    await assertNoDanglingRows(batchId);
  });

  it('T-IMG-018d: the SAME file re-attaches successfully once the pixel budget is raised', async () => {
    const batchId = await openBatch();
    const bytes = heicBytes(OVER_GUARD.width, OVER_GUARD.height);

    const refused = await postImages(batchId, [{ name: 'big.heic', bytes }]);
    expect(refused.status).toBe(413);
    expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(0);

    // The runbook's remedy, applied. 48.0 MP < 50 MP, so the identical bytes
    // must now succeed — if they did not, the runbook would be a dead end and
    // the owner would have no way out at all.
    process.env['NEXTUP_MAX_DECODE_PIXELS'] = '50000000';
    decodeBehaviour.width = OVER_GUARD.width;
    decodeBehaviour.height = OVER_GUARD.height;

    const accepted = await postImages(batchId, [{ name: 'big.heic', bytes }]);
    expect(accepted.status).toBe(201);
    const body = (await accepted.json()) as ImagesBody;
    expect(body.accepted).toHaveLength(1);
    // A NORMAL staged image, not a special-cased one: transcoded to PNG and
    // stored like anything else.
    expect(body.accepted[0]?.format).toBe('png');

    const row = await testPrisma().uploadedImage.findFirst({ where: { ownerId, batchId } });
    expect(row?.uploadedFormat).toBe('heic');
    expect(row?.format).toBe('png');
    await assertNoDanglingRows(batchId);
  });

  it('T-IMG-018e: a decode throw at the blob-write boundary leaves NO row pointing at a missing blob', async () => {
    const batchId = await openBatch();

    // The failure is injected at exactly the step BEFORE the blob write, which
    // is the step before the row insert. The ordering
    // `transcode → blob write → staged row` means the worst outcome available
    // is an orphan blob nothing references — never a row whose bytes are gone.
    decodeBehaviour.throws = new RangeError('Array buffer allocation failed');

    const res = await postImages(batchId, [
      { name: 'ok-before.png', bytes: pngBytes() },
      { name: 'dies.heic', bytes: heicBytes() },
      { name: 'ok-after.png', bytes: pngBytes(640, 480) },
    ]);

    expect(res.status).toBe(201);
    const body = (await res.json()) as ImagesBody;
    expect(body.accepted.map((a) => a.fileName)).toEqual(['ok-before.png', 'ok-after.png']);
    expect(body.rejected[0]?.fileName).toBe('dies.heic');

    const rows = await testPrisma().uploadedImage.findMany({ where: { ownerId, batchId } });
    expect(rows).toHaveLength(2);
    // No row for the failed file at all — not a row with a null path, not a
    // row flagged failed. It simply never existed.
    expect(rows.some((r) => r.fileName === 'dies.heic')).toBe(false);
    await assertNoDanglingRows(batchId);
    await assertNoListState();
  });

  it('T-IMG-018f: two failures of DIFFERENT kinds in one request are reported individually', async () => {
    const batchId = await openBatch();
    decodeBehaviour.throws = new RangeError('Array buffer allocation failed');

    const res = await postImages(batchId, [
      { name: 'good-1.png', bytes: pngBytes() },
      { name: 'over-guard.heic', bytes: heicBytes(OVER_GUARD.width, OVER_GUARD.height) },
      { name: 'good-2.png', bytes: pngBytes(800, 600) },
      { name: 'oom.heic', bytes: heicBytes() },
    ]);

    expect(res.status).toBe(201);
    const body = (await res.json()) as ImagesBody;
    expect(body.accepted).toHaveLength(2);
    expect(body.rejected).toHaveLength(2);

    // ⚠ EACH FILE KEEPS ITS OWN CODE. Collapsing both to one "some images
    // failed" code would send the owner of a corrupt file to buy memory.
    const byName = new Map(body.rejected.map((r) => [r.fileName, r.code]));
    expect(byName.get('over-guard.heic')).toBe('IMAGE_TOO_LARGE_TO_DECODE');
    expect(byName.get('oom.heic')).toBe('IMAGE_DECODE_OOM');

    expect(body.batchTotals.imageCount).toBe(2);
    const batch = await testPrisma().uploadBatch.findFirst({ where: { id: batchId } });
    expect(batch?.status).toBe('draft');
    await assertNoListState();
  });

  it('T-IMG-018g: already-accepted images survive a LATER failure in the same request', async () => {
    const batchId = await openBatch();

    // Two separate requests first, so the surviving rows were committed before
    // the failing request even started. A request-scoped rollback would take
    // them with it.
    await postImages(batchId, [{ name: 'earlier-1.png', bytes: pngBytes() }]);
    await postImages(batchId, [{ name: 'earlier-2.png', bytes: pngBytes(700, 700) }]);

    const res = await postImages(batchId, [
      { name: 'later.heic', bytes: heicBytes(OVER_GUARD.width, OVER_GUARD.height) },
    ]);
    // Nothing was accepted in THIS request, so it takes the rejection's own
    // status — but that is a statement about the request, not about the batch.
    expect(res.status).toBe(413);

    const rows = await testPrisma().uploadedImage.findMany({ where: { ownerId, batchId } });
    expect(rows.map((r) => r.fileName).sort()).toEqual(['earlier-1.png', 'earlier-2.png']);
    await assertNoDanglingRows(batchId);
  });
});

describe('T-IMG-019 the CATCHABLE out-of-memory path', () => {
  /**
   * ⚠ This is the COMMON OOM path (ADR-0008 R2.4): the WASM heap refuses an
   * allocation, an error is raised, and the process keeps running. The kernel
   * OOM-kill path cannot be asserted from inside a process that no longer
   * exists (`specs/testing.md` §10) — handling only one of the two is how the
   * likelier case ends up unhandled.
   */
  it('T-IMG-019a: a bare RangeError from the decoder fails that file only and the loop continues', async () => {
    const batchId = await openBatch();
    // NOT wrapped in an AppError: a raw allocation failure straight out of the
    // WASM decoder, which is what actually arrives at 0.5 GiB.
    decodeBehaviour.throws = new RangeError('Array buffer allocation failed');

    const res = await postImages(batchId, [
      { name: 'first.heic', bytes: heicBytes() },
      { name: 'second.png', bytes: pngBytes() },
    ]);

    expect(res.status).toBe(201);
    const body = (await res.json()) as ImagesBody;
    // The loop CONTINUED: the image after the failure was processed normally.
    expect(body.accepted.map((a) => a.fileName)).toEqual(['second.png']);
    expect(body.rejected[0]?.fileName).toBe('first.heic');
    expect(body.rejected[0]?.code).toBe('IMAGE_DECODE_OOM');
    // The diagnosis, not a generic 500 (`T-IMG-020`).
    expect(body.rejected[0]?.message.toLowerCase()).toContain('memory');
    expect(body.rejected[0]?.message).toContain('runbooks/scale-up-memory.md');
    await assertNoDanglingRows(batchId);
  });

  it('T-IMG-019b: an Emscripten abort(OOM)-shaped Error is classified as OOM too', async () => {
    const batchId = await openBatch();
    decodeBehaviour.throws = new Error('abort(OOM). Build with -s ASSERTIONS=1 for more info.');

    const res = await postImages(batchId, [{ name: 'aborted.heic', bytes: heicBytes() }]);

    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      error: { code: string; details: Record<string, unknown> };
    };
    expect(body.error.code).toBe('IMAGE_DECODE_OOM');
    expect(await testPrisma().uploadedImage.count({ where: { ownerId, batchId } })).toBe(0);
  });

  it('T-IMG-019c: a corrupt-file error is IMAGE_DECODE_FAILED and mentions NEITHER memory NOR the runbook', async () => {
    const batchId = await openBatch();
    decodeBehaviour.throws = new Error('bad huffman code');

    const res = await postImages(batchId, [
      { name: 'corrupt.heic', bytes: heicBytes() },
      { name: 'fine.png', bytes: pngBytes() },
    ]);

    expect(res.status).toBe(201);
    const body = (await res.json()) as ImagesBody;
    const rejected = body.rejected[0];
    expect(rejected?.fileName).toBe('corrupt.heic');
    // ⚠ The two must not collapse into one code. More memory will never fix a
    // truncated file, and offering the up-size sends the owner to buy capacity
    // they do not need.
    expect(rejected?.code).toBe('IMAGE_DECODE_FAILED');
    expect(rejected?.message.toLowerCase()).not.toContain('memory');
    expect(rejected?.message).not.toContain('up-size');
    expect(rejected?.message).not.toContain('runbooks/scale-up-memory.md');
  });
});

describe('T-IMG-018 no compensating cleanup exists to get wrong', () => {
  it('T-IMG-018h: neither the ingest pipeline nor the route deletes a blob on failure', async () => {
    // ⚠ ASSERTED NEGATIVELY, ON PURPOSE (TASK-154). An orphan blob that no row
    // references is HARMLESS and is collected by the 30-day NFR-019 lifecycle
    // purge. A compensating delete, by contrast, is a second failure path that
    // runs in exactly the conditions — out of memory, mid-request — where it is
    // least likely to work, and its worst outcome is deleting the bytes of an
    // image that DID succeed. One fewer thing to get wrong.
    const sources = await Promise.all(
      ['../../src/images/ingest.ts', '../../src/routes/batchImages.ts'].map((relative) =>
        readFile(new URL(relative, import.meta.url), 'utf8'),
      ),
    );

    for (const source of sources) {
      expect(source).not.toMatch(/\.remove\(/);
      expect(source).not.toMatch(/deleteBlob/);
    }
  });
});
