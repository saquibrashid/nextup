/**
 * TASK-117 — the `POST /api/batches/:batchId/re-extract` HANDLER, driven
 * through the real Express app with the repository mocked.
 *
 * ⚠ THIS FILE EXISTS BECAUSE OF HOW COVERAGE IS MEASURED, and that is not a
 * bookkeeping detail. `apps/api/test/integration/reextract.spec.ts` proves the
 * route end-to-end against a real SQL Server, but the coverage job runs
 * `--project unit --project web` only — so a service proven exclusively by
 * integration tests reads as UNCOVERED and drags the API branch floor down.
 * Adding this file was not optional: the branch threshold failed CI at 84.55%
 * against an 85% floor the moment `batchReextract.ts` landed without it.
 *
 * The mock also makes something visible that integration cannot show cheaply:
 * the REFUSAL ORDER. Both refusals need contrived state to reach, and with the
 * repository stubbed the two conditions can be made true simultaneously in one
 * line, so "which one wins" is a direct assertion rather than an inference
 * from a fixture.
 *
 * ⚠ These are the same behaviours the integration suite asserts, NOT a
 * substitute for it. A mocked store agrees with whatever the code asked of it,
 * so it cannot show that the derived rows really landed, that the original is
 * byte-identical, or that the filtered unique index tolerated the result.
 * `T-REX-012`/`T-REX-012a` stay integration-only for exactly that reason.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findUploadBatch = vi.fn();
const listImagesForBatch = vi.fn();
const findOpenUploadBatch = vi.fn();
const createUploadBatch = vi.fn();
const createUploadedImage = vi.fn();

vi.mock('../../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findUploadBatch: (...args: unknown[]) => findUploadBatch(...args) as unknown,
    listImagesForBatch: (...args: unknown[]) => listImagesForBatch(...args) as unknown,
    findOpenUploadBatch: (...args: unknown[]) => findOpenUploadBatch(...args) as unknown,
    createUploadBatch: (...args: unknown[]) => createUploadBatch(...args) as unknown,
    createUploadedImage: (...args: unknown[]) => createUploadedImage(...args) as unknown,
  };
});

// ⚠ STUBBED SO THE 202 DOES NOT START A REAL EXTRACTION. The route fires
// `beginExtraction` after responding, deliberately un-awaited; left real it
// would run against a mocked store after the test had finished and surface as
// an unhandled rejection in an unrelated file.
const beginExtraction = vi.fn();
vi.mock('../../../src/jobs/startExtraction.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/jobs/startExtraction.js')>();
  return {
    ...actual,
    beginExtraction: (...args: unknown[]) => beginExtraction(...args) as unknown,
  };
});

const { createApp } = await import('../../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../../src/middleware/allowList.js');
const { reextractBatch } = await import('../../../src/services/batchReextract.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-reextract-route-unit';

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

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

interface ReextractBody {
  batchId: string;
  derivedFromBatchId: string;
  status: string;
  service: string;
  mode: string;
  imageCount: number;
}

const BATCH_ID = 'b-source';
const UPLOADED_AT = new Date('2026-08-01T09:00:00.000Z');
const RETAIN_UNTIL = new Date('2099-01-01T09:00:00.000Z');

const sourceBatch = () => ({
  id: BATCH_ID,
  ownerId: 'owner-x',
  service: 'max',
  mode: 'full-update',
  status: 'applied',
  derivedFromBatchId: null,
});

const image = (over: { id?: string; retainUntil?: Date } = {}) => ({
  id: over.id ?? 'img-1',
  ownerId: 'owner-x',
  batchId: BATCH_ID,
  blobPath: 'owner-x/img-1.png',
  fileName: 'img-1.png',
  ingestSource: 'upload',
  uploadedFormat: 'png',
  format: 'png',
  byteSize: BigInt(2048),
  uploadedByteSize: BigInt(2048),
  width: 1170,
  height: 2532,
  uploadedAt: UPLOADED_AT,
  retainUntil: over.retainUntil ?? RETAIN_UNTIL,
  candidateCount: 4,
});

let server: Server;
let app: Express;
let origin: string;

const postReextract = (batchId: string): Promise<Response> =>
  fetch(`${origin}/api/batches/${encodeURIComponent(batchId)}/re-extract`, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader,
    },
  });

beforeEach(async () => {
  vi.resetAllMocks();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  createUploadBatch.mockImplementation((_ownerId: unknown, data: { id: string }) =>
    Promise.resolve(data),
  );
  createUploadedImage.mockResolvedValue({});
  if (server === undefined) {
    app = createApp();
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('POST /api/batches/:batchId/re-extract — refusals and derivation', () => {
  it('T-REX-010c: an unknown batch is a 404, never a 403', async () => {
    findUploadBatch.mockResolvedValue(null);

    // NFR-008: a 403 would confirm the id exists. "Not yours" and "not there"
    // are deliberately indistinguishable.
    expect((await postReextract(BATCH_ID)).status).toBe(404);
    expect(createUploadBatch).not.toHaveBeenCalled();
  });

  it('T-REX-010d: a batch with no images is refused before any write', async () => {
    findUploadBatch.mockResolvedValue(sourceBatch());
    listImagesForBatch.mockResolvedValue([]);

    const res = await postReextract(BATCH_ID);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NO_IMAGES');
    expect(createUploadBatch).not.toHaveBeenCalled();
  });

  it('T-REX-013a: a purged image refuses with 410 and names what was lost', async () => {
    findUploadBatch.mockResolvedValue(sourceBatch());
    listImagesForBatch.mockResolvedValue([
      image({ id: 'live' }),
      image({ id: 'gone', retainUntil: new Date('2020-01-01T00:00:00.000Z') }),
    ]);
    findOpenUploadBatch.mockResolvedValue(null);

    const res = await postReextract(BATCH_ID);
    expect(res.status).toBe(410);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('IMAGES_PURGED');
    expect(body.error.message).toContain('30 days');
    expect(body.error.details['purgedImageIds']).toEqual(['gone']);

    // ⚠ ONE PURGED IMAGE REFUSES THE WHOLE BATCH. Re-reading only the
    // survivors would build a `full-update` from a partial view of the
    // service, and full-update reconciles by ABSENCE — so titles whose only
    // evidence was the purged screenshot would be removed from the list.
    expect(createUploadBatch).not.toHaveBeenCalled();
    expect(createUploadedImage).not.toHaveBeenCalled();
  });

  it('T-REX-014d: the permanent refusal is evaluated before the recoverable one', async () => {
    findUploadBatch.mockResolvedValue(sourceBatch());
    listImagesForBatch.mockResolvedValue([
      image({ retainUntil: new Date('2020-01-01T00:00:00.000Z') }),
    ]);
    findOpenUploadBatch.mockResolvedValue({
      id: 'b-open',
      service: 'netflix',
      mode: 'append-only',
      status: 'draft',
    });

    // Both conditions hold. `OPEN_BATCH_EXISTS` first would send the owner to
    // discard work in progress and then hit the 410 anyway, having lost the
    // batch for nothing — so the permanent refusal is the truthful answer.
    const res = await postReextract(BATCH_ID);
    expect(res.status).toBe(410);
    expect(((await res.json()) as ErrorBody).error.code).toBe('IMAGES_PURGED');
    // And it never even asked about open batches.
    expect(findOpenUploadBatch).not.toHaveBeenCalled();
  });

  it('T-REX-014e: an open batch refuses with 409 and reports which one', async () => {
    findUploadBatch.mockResolvedValue(sourceBatch());
    listImagesForBatch.mockResolvedValue([image()]);
    findOpenUploadBatch.mockResolvedValue({
      id: 'b-open',
      service: 'netflix',
      mode: 'append-only',
      status: 'draft',
    });

    const res = await postReextract(BATCH_ID);
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('OPEN_BATCH_EXISTS');
    // §6.11's contract: the id goes back so the SPA can offer "resume" or
    // "discard" rather than a dead end.
    expect(body.error.details['batchId']).toBe('b-open');
    expect(createUploadBatch).not.toHaveBeenCalled();
  });

  it('T-REX-012b: the derived batch inherits service and mode and records its source', async () => {
    findUploadBatch.mockResolvedValue(sourceBatch());
    listImagesForBatch.mockResolvedValue([image({ id: 'a' }), image({ id: 'b' })]);
    findOpenUploadBatch.mockResolvedValue(null);

    const res = await postReextract(BATCH_ID);
    expect(res.status).toBe(202);
    const body = (await res.json()) as ReextractBody;

    expect(body.derivedFromBatchId).toBe(BATCH_ID);
    expect(body.batchId).not.toBe(BATCH_ID);
    expect(body.imageCount).toBe(2);

    const created = createUploadBatch.mock.calls[0]?.[1] as Record<string, unknown>;
    // Service and mode are INHERITED, never re-asked: the pixels are of one
    // service and were captured under one mode, and re-asking would let a
    // `full-update` reconciliation be pointed at bytes captured `append-only`.
    expect(created['service']).toBe('max');
    expect(created['mode']).toBe('full-update');
    expect(created['derivedFromBatchId']).toBe(BATCH_ID);
    expect(created['status']).toBe('submitted');
  });

  it('T-REX-012c: each image is copied with the ORIGINAL retention and no inherited count', async () => {
    findUploadBatch.mockResolvedValue(sourceBatch());
    listImagesForBatch.mockResolvedValue([image({ id: 'a' }), image({ id: 'b' })]);
    findOpenUploadBatch.mockResolvedValue(null);

    await postReextract(BATCH_ID);

    expect(createUploadedImage).toHaveBeenCalledTimes(2);
    for (const call of createUploadedImage.mock.calls) {
      const data = call[1] as Record<string, unknown>;
      // ⚠ COPIED, NEVER RESTAMPED — the single most consequential line in the
      // feature. Today's date here converts NFR-019's flat 30 days into "30
      // days after you last re-extracted", so an owner who re-extracts monthly
      // retains screenshots indefinitely. The field is WRITE-ONCE.
      expect(data['retainUntil']).toEqual(RETAIN_UNTIL);
      expect(data['uploadedAt']).toEqual(UPLOADED_AT);
      // The SAME blob: two rows, one object. Duplicating would double the
      // storage the 30-day purge is sized against.
      expect(data['blobPath']).toBe('owner-x/img-1.png');
      // `null` means "not extracted yet"; `0` means "extracted, found nothing"
      // (US-006 AC-3). Inheriting 4 would report results not yet produced.
      expect(data['candidateCount']).toBeNull();
      expect(data['id']).not.toBe('a');
      expect(data['id']).not.toBe('b');
    }
  });

  it('T-REX-011a: extraction is started for the DERIVED batch, after the response', async () => {
    findUploadBatch.mockResolvedValue(sourceBatch());
    listImagesForBatch.mockResolvedValue([image()]);
    findOpenUploadBatch.mockResolvedValue(null);

    const body = (await (await postReextract(BATCH_ID)).json()) as ReextractBody;

    // ⚠ THE DERIVED ID, NOT THE SOURCE. Passing the source id here is the
    // subtlest way to get re-extraction wrong: the response would describe a
    // correct derived batch while the extractor overwrote the ORIGINAL
    // batch's candidates — the exact re-run-in-place this feature exists to
    // avoid, and invisible from the HTTP response alone.
    expect(beginExtraction).toHaveBeenCalledTimes(1);
    expect(beginExtraction.mock.calls[0]?.[1]).toBe(body.batchId);
    expect(beginExtraction.mock.calls[0]?.[1]).not.toBe(BATCH_ID);
  });
});

/**
 * The retention boundary, asserted against the service directly.
 *
 * ⚠ THIS CANNOT BE DONE OVER HTTP, AND AN HTTP VERSION OF IT PASSES
 * VACUOUSLY. The route lets `now` default to `new Date()` *inside* the
 * request, which is strictly later than any `retainUntil` a test can construct
 * beforehand — so `<` and `<=` both refuse and the assertion holds no matter
 * which one is in the source. The first draft of this test did exactly that
 * and went green against both. Passing `now` in explicitly is the only way the
 * two instants can be equal.
 */
describe('re-extract — the retainUntil boundary', () => {
  const AT = new Date('2026-09-01T00:00:00.000Z');
  const ownerId = 'o_boundary' as unknown as Parameters<typeof reextractBatch>[0];

  beforeEach(() => {
    findUploadBatch.mockResolvedValue(sourceBatch());
    findOpenUploadBatch.mockResolvedValue(null);
  });

  it('T-REX-013b: exactly AT retainUntil the bytes are already gone', async () => {
    listImagesForBatch.mockResolvedValue([image({ retainUntil: AT })]);

    // `<=`, NOT `<`. US-035 AC-1 says bytes are unavailable *at* `retainUntil`.
    // A strict comparison would offer a re-extraction the blob store then
    // refuses, turning a clean, explanatory 410 into an `extraction-failed`
    // batch the owner has to go and read to discover the same fact.
    await expect(reextractBatch(ownerId, BATCH_ID, AT)).rejects.toMatchObject({
      code: 'IMAGES_PURGED',
    });
    expect(createUploadBatch).not.toHaveBeenCalled();
  });

  it('T-REX-013c: one millisecond BEFORE retainUntil it still works', async () => {
    listImagesForBatch.mockResolvedValue([image({ retainUntil: AT })]);

    // The other side of the same boundary. Without this, a mutant that always
    // reports "purged" — `return true` — satisfies the case above.
    const result = await reextractBatch(ownerId, BATCH_ID, new Date(AT.getTime() - 1));
    expect(result.imageCount).toBe(1);
    expect(createUploadBatch).toHaveBeenCalledTimes(1);
  });
});
