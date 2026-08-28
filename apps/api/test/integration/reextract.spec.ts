/**
 * TASK-117 — US-034: re-extract a batch's screenshots within the retention
 * window (`specs/api.md` §6.24, REQ-074).
 *
 * `T-REX-010` (available while images are retained), `T-REX-011` (results
 * enter only through review — nothing is written to the list), `T-REX-012` (a
 * NEW batch with `derivedFromBatchId`, same service and mode, the original
 * unmodified), `T-REX-013` (purged images → 410 `IMAGES_PURGED`), `T-REX-014`
 * (a failed re-extraction leaves the original batch and the list untouched)
 * and `T-SUP-017` (US-034 AC-6 — the suppression gate still applies).
 *
 * ⚠ FINDING — THE BACKLOG'S "DONE WHEN" FOR TASK-117 NAMED THE WRONG TESTS,
 * and this file is written against `specs/testing.md` instead. The backlog row
 * cited `T-BATCH-010` and `T-RET-014`; the first is US-011's *"POST
 * /api/batches without `service` → 400"* and the second is US-035/A45's
 * *"30-day retention is identical for pasted images"*. Neither is a US-034
 * test, and both are already carried elsewhere — so an implementer who trusted
 * that column would have closed TASK-117 by running two green tests that say
 * nothing whatsoever about re-extraction. `specs/testing.md` carries the
 * authoritative AC→test mapping (NFR-003), and it maps US-034 to
 * `T-REX-010`–`T-REX-014` plus `T-SUP-017`. The backlog is corrected in place;
 * the superseded citation is recorded struck through beside it.
 *
 * ⚠ WHY RE-EXTRACTION DERIVES A NEW BATCH AND DOES NOT RE-RUN THE OLD ONE.
 * `extraction-failed → submitted` RETRY (§6.16) re-enters the SAME batch and
 * is the operation this is most easily confused with. Retry is for a batch
 * that produced nothing; re-extraction is for a batch that produced something
 * the owner has read and judged wrong. Re-running in place would overwrite
 * candidates the owner is looking at, and — where the original was already
 * applied — attach a second set of results to a batch whose provenance rows
 * (REQ-068) describe the first. `T-REX-012` is the assertion that keeps the
 * two apart.
 *
 * ⚠ INTEGRATION, NOT UNIT. Every property here is about what is IN THE STORE
 * after the request: that a second batch row exists, that the original's every
 * column is unchanged, that the derived batch's image rows carry the ORIGINAL
 * `retainUntil` rather than a fresh one. A stubbed store would report whatever
 * the code asked of it, including a retention restamp that quietly converts
 * NFR-019's 30 days into "30 days after you last re-extracted".
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-reextract';
const ISSUER = 'https://sts.windows.net/tenant/';

const principalHeader = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: ISSUER },
      { typ: OID, val: SUBJECT },
      { typ: 'preferred_username', val: 'owner@example.com' },
    ],
  }),
  'utf8',
).toString('base64');

/** Comfortably inside the 30-day window, and unmistakably not "now". */
const UPLOADED_AT = new Date('2026-08-01T09:00:00.000Z');
const RETAIN_UNTIL = new Date('2099-01-01T09:00:00.000Z');

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

interface ReextractBody {
  batchId: string;
  derivedFromBatchId: string;
  status: string;
  service: string;
  mode: string;
  imageCount: number;
}

interface ErrorBody {
  error: { code: string; message: string; details?: { purgedImageIds?: string[] } };
}

const authed = { [CLIENT_PRINCIPAL_HEADER]: principalHeader };

const reextract = (batchId: string): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/re-extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authed },
    body: JSON.stringify({}),
  });

/* ── fixtures ─────────────────────────────────────────────────────────── */

let seq = 0;

async function seedBatch(
  over: { status?: string; mode?: string; service?: string } = {},
): Promise<string> {
  const id = `rex-batch-${++seq}`;
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service: over.service ?? 'netflix',
      mode: over.mode ?? 'full-update',
      // ⚠ `applied`, NOT `in-review`. A batch that is still open IS the one
      // open batch (product invariant 3), so re-extracting it would leave two
      // open at once. The intended flow is discard-then-re-extract, and it is
      // why discard RETAINS images — `services/batchLifecycle.ts` says so in
      // as many words. `T-REX-014c` pins that down.
      status: over.status ?? 'applied',
      lowYield: false,
      degradedExtraction: false,
    },
  });
  return id;
}

async function seedImage(batchId: string, over: { retainUntil?: Date } = {}): Promise<string> {
  const id = `rex-img-${++seq}`;
  await testPrisma().uploadedImage.create({
    data: {
      id,
      ownerId,
      batchId,
      blobPath: `${ownerId}/${id}.png`,
      fileName: `${id}.png`,
      uploadedFormat: 'png',
      format: 'png',
      byteSize: BigInt(2048),
      uploadedByteSize: BigInt(2048),
      width: 1170,
      height: 2532,
      uploadedAt: UPLOADED_AT,
      retainUntil: over.retainUntil ?? RETAIN_UNTIL,
      // Extracted already, and it found something. The derived batch must NOT
      // inherit this: `null` means "not extracted yet" (US-006 AC-3).
      candidateCount: 4,
    },
  });
  return id;
}

/* ── lifecycle ────────────────────────────────────────────────────────── */

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  testPrisma();
  await resetDatabase();

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const created = await fetch(`${origin}/api/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authed },
    body: JSON.stringify({ service: 'netflix', mode: 'append-only' }),
  });
  const body = (await created.json()) as { batchId: string };
  const row = await testPrisma().uploadBatch.findFirst({ where: { id: body.batchId } });
  ownerId = row?.ownerId ?? '';
  await resetDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await closeTestPrisma();
});

/* ── tests ────────────────────────────────────────────────────────────── */

describe('US-034 — re-extract a batch within the retention window', () => {
  it('T-REX-010 · AC-1 · re-extract is available while the images are retained', async () => {
    const source = await seedBatch();
    await seedImage(source);
    await seedImage(source);

    const res = await reextract(source);
    expect(res.status).toBe(202);

    const body = (await res.json()) as ReextractBody;
    expect(body.status).toBe('submitted');
    expect(body.imageCount).toBe(2);
    // ⚠ THE DERIVED ID IS NOT THE SOURCE ID. Returning the source id would be
    // the shape of a re-run-in-place and would make every other assertion in
    // this file read the wrong row.
    expect(body.batchId).not.toBe(source);
  });

  it('T-REX-011 · AC-2 · results enter only through review — nothing is written to the list', async () => {
    const source = await seedBatch();
    await seedImage(source);

    expect((await reextract(source)).status).toBe(202);

    // ⚠ THE WHOLE LIST, not "no new titles". US-034 AC-2 is the promise that a
    // re-extraction cannot change what the owner sees until they review it, so
    // the assertion is that the list-bearing tables are still EMPTY — a
    // re-extract that wrote one listing "to save a step" would satisfy a
    // count-delta check that started from a non-empty fixture.
    expect(await testPrisma().title.count({ where: { ownerId } })).toBe(0);
    expect(await testPrisma().serviceListing.count({ where: { ownerId } })).toBe(0);
    expect(await testPrisma().extractionCandidate.count({ where: { ownerId } })).toBe(0);
  });

  it('T-REX-012 · AC-3 · a NEW batch with derivedFromBatchId; the original is unmodified', async () => {
    const source = await seedBatch({ service: 'max', mode: 'full-update' });
    const imageId = await seedImage(source);

    // ⚠ SNAPSHOT THE WHOLE ROW, not chosen fields. The failure this guards
    // against is a re-extraction that "tidies" the source on its way past —
    // restamping `submittedAt`, clearing an extraction error, flipping the
    // status back to `submitted`. Naming fields protects only the ones
    // somebody already thought of.
    const before = await testPrisma().uploadBatch.findFirstOrThrow({ where: { id: source } });
    const imageBefore = await testPrisma().uploadedImage.findFirstOrThrow({
      where: { ownerId, id: imageId },
    });

    const body = (await (await reextract(source)).json()) as ReextractBody;

    expect(body.derivedFromBatchId).toBe(source);
    // Service and mode are INHERITED, never re-asked: the pixels are of one
    // service and were captured under one mode, and re-asking would let a
    // `full-update` reconciliation be pointed at bytes captured `append-only`.
    expect(body.service).toBe('max');
    expect(body.mode).toBe('full-update');

    const derived = await testPrisma().uploadBatch.findFirstOrThrow({ where: { id: body.batchId } });
    expect(derived.derivedFromBatchId).toBe(source);
    expect(derived.service).toBe('max');
    expect(derived.mode).toBe('full-update');

    expect(await testPrisma().uploadBatch.findFirstOrThrow({ where: { id: source } })).toEqual(
      before,
    );
    expect(
      await testPrisma().uploadedImage.findFirstOrThrow({ where: { ownerId, id: imageId } }),
    ).toEqual(imageBefore);
  });

  it('T-REX-012a · AC-3 · the derived images point at the same blobs and keep the ORIGINAL retention', async () => {
    const source = await seedBatch();
    const imageId = await seedImage(source);

    const body = (await (await reextract(source)).json()) as ReextractBody;
    // ⚠ ANTI-VACUITY. A refused request leaves `batchId` undefined, and a
    // Prisma `findMany` with an undefined filter returns EVERY row — so the
    // assertions below would then read the SOURCE image and quietly pass on
    // retention and blob path. That is not hypothetical: it is exactly what
    // this case did on its first run.
    expect(typeof body.batchId).toBe('string');

    const derivedImages = await testPrisma().uploadedImage.findMany({
      where: { ownerId, batchId: body.batchId },
    });

    expect(derivedImages).toHaveLength(1);
    const copy = derivedImages[0];

    // ⚠ RETENTION IS COPIED, NEVER RESTAMPED — the single most consequential
    // line in this feature. Taking today's date is the natural thing to write
    // and it converts NFR-019's flat 30 days into "30 days after you last
    // re-extracted", so an owner who re-extracts monthly would retain
    // screenshots indefinitely. `retainUntil` is documented WRITE-ONCE in the
    // schema; this path is one of the only two that could break it.
    expect(copy?.retainUntil.toISOString()).toBe(RETAIN_UNTIL.toISOString());
    expect(copy?.uploadedAt.toISOString()).toBe(UPLOADED_AT.toISOString());

    // The SAME blob. Duplicating the object would double the storage the
    // 30-day purge is sized against, and leave a second copy alive after the
    // original's lifecycle rule fired.
    expect(copy?.blobPath).toBe(`${ownerId}/${imageId}.png`);

    // ⚠ `null`, NOT the source's 4. `null` means "not extracted yet" and `0`
    // means "extracted, found nothing" (US-006 AC-3) — inheriting the count
    // would make the derived batch report results it has not produced.
    expect(copy?.candidateCount).toBeNull();

    // A distinct row, so the original is not re-parented out of its batch.
    expect(copy?.id).not.toBe(imageId);
  });

  it('T-REX-013 · AC-4 · purged images → 410 IMAGES_PURGED with the retention explanation', async () => {
    const source = await seedBatch();
    const live = await seedImage(source);
    const gone = await seedImage(source, { retainUntil: new Date('2020-01-01T00:00:00.000Z') });

    const res = await reextract(source);
    expect(res.status).toBe(410);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('IMAGES_PURGED');
    // The owner-facing sentence names the retention rule and the reason
    // (`ux-states.md` §5.7). A bare "not found" would read as a bug in the
    // product rather than the documented 30-day promise being kept.
    expect(body.error.message).toContain('30 days');
    expect(body.error.details?.purgedImageIds).toEqual([gone]);

    // ⚠ ONE PURGED IMAGE REFUSES THE WHOLE RE-EXTRACTION, and that is correct
    // rather than strict. Silently re-reading only the surviving images would
    // produce a `full-update` batch built from a PARTIAL view of the service,
    // and a full-update reconciles by absence — so the titles whose only
    // evidence was the purged screenshot would be removed from the list. That
    // is the "a failed extraction must never be misread as a removal"
    // invariant, reached by a different route.
    expect(await testPrisma().uploadBatch.count({ where: { ownerId } })).toBe(1);
    expect(live).not.toBe(gone);
  });

  it('T-REX-014 · AC-5 · a refused re-extraction leaves the original batch and the list untouched', async () => {
    const source = await seedBatch();
    await seedImage(source, { retainUntil: new Date('2020-01-01T00:00:00.000Z') });
    const before = await testPrisma().uploadBatch.findFirstOrThrow({ where: { id: source } });

    expect((await reextract(source)).status).toBe(410);

    // No half-created derived batch, no orphaned image rows, no list state.
    // The refusal happens BEFORE any write, which is why this holds without a
    // transaction: a check placed after the insert would leave exactly this
    // debris and still return the right status code.
    expect(await testPrisma().uploadBatch.findFirstOrThrow({ where: { id: source } })).toEqual(
      before,
    );
    expect(await testPrisma().uploadBatch.count({ where: { ownerId } })).toBe(1);
    expect(await testPrisma().uploadedImage.count({ where: { ownerId } })).toBe(1);
    expect(await testPrisma().title.count({ where: { ownerId } })).toBe(0);
    expect(await testPrisma().serviceListing.count({ where: { ownerId } })).toBe(0);
  });

  it('T-REX-014a · a re-extraction is refused while another batch is open', async () => {
    const source = await seedBatch({ status: 'applied' });
    await seedImage(source);
    await seedBatch({ status: 'draft' });

    const res = await reextract(source);
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('OPEN_BATCH_EXISTS');

    // Product invariant 3: one open batch, because a full-update reconciles a
    // whole service in one transaction and two open batches could reconcile
    // against each other's half-applied state.
    expect(await testPrisma().uploadBatch.count({ where: { ownerId } })).toBe(2);
  });

  it('T-REX-014b · the permanent refusal wins over the recoverable one', async () => {
    // Both conditions hold at once: images are gone AND another batch is open.
    const source = await seedBatch({ status: 'applied' });
    await seedImage(source, { retainUntil: new Date('2020-01-01T00:00:00.000Z') });
    await seedBatch({ status: 'draft' });

    // ⚠ ORDER IS A PRODUCT DECISION, NOT AN IMPLEMENTATION DETAIL. Answering
    // `OPEN_BATCH_EXISTS` first is defensible-looking and sends the owner to
    // discard work in progress, after which they hit the 410 anyway and have
    // lost the batch for nothing. `IMAGES_PURGED` is permanent, so it is the
    // truthful answer and it points at the only action that helps.
    const res = await reextract(source);
    expect(res.status).toBe(410);
    expect(((await res.json()) as ErrorBody).error.code).toBe('IMAGES_PURGED');
  });

  it('T-REX-014c · a batch that is itself still open must be discarded first', async () => {
    // ⚠ THE SOURCE IS NOT EXEMPT FROM THE ONE-OPEN-BATCH RULE, and reading
    // §6.24's "if ANOTHER batch is open" as an exemption is the tempting
    // mistake. Deriving from a still-open batch leaves TWO open at once, and
    // product invariant 3 exists because two open full-update batches can
    // reconcile against each other's half-applied state. The owner discards
    // the bad review first — which is precisely why discard RETAINS images
    // (`services/batchLifecycle.ts`), so the screenshots are still there to
    // re-read afterwards.
    const source = await seedBatch({ status: 'in-review' });
    await seedImage(source);

    const res = await reextract(source);
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('OPEN_BATCH_EXISTS');
    expect(await testPrisma().uploadBatch.count({ where: { ownerId } })).toBe(1);
  });

  it('T-SUP-017 · AC-6 · the suppression gate applies to re-extraction', async () => {
    const source = await seedBatch();
    await seedImage(source);

    const body = (await (await reextract(source)).json()) as ReextractBody;

    // ⚠ ASSERTED AS AN ABSENCE, DELIBERATELY. The gate lives in the close
    // transaction (`services/batchClose.ts`) and applies to the derived batch
    // BY CONSTRUCTION, because a derived batch closes through exactly the same
    // path as any other. The way that breaks is not a missing check here but a
    // re-extraction path that bypasses close — writing candidates straight to
    // the list, or marking the derived batch `applied` on creation. So this
    // case pins the derived batch to a REVIEWABLE, unapplied state.
    //
    // A second copy of the suppression check on this path would be worse than
    // no check: REQ-071 keys suppression on WORK IDENTITY rather than row id,
    // and a duplicated implementation is a second place to get that wrong.
    const derived = await testPrisma().uploadBatch.findFirstOrThrow({ where: { id: body.batchId } });
    expect(derived.status).not.toBe('applied');
    expect(derived.completedAt).toBeNull();
    expect(await testPrisma().serviceListing.count({ where: { ownerId } })).toBe(0);
  });

  it('T-REX-010a · a batch with no retained images cannot be re-extracted', async () => {
    const source = await seedBatch();

    const res = await reextract(source);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NO_IMAGES');
  });

  it('T-REX-010b · another owner\u2019s batch is a 404, never a 403', async () => {
    const source = await seedBatch();
    await seedImage(source);
    await testPrisma().uploadBatch.updateMany({
      where: { id: source },
      data: { ownerId: 'o_someone_else' },
    });

    // NFR-008: a 403 would confirm the id exists. The owner-scoped read makes
    // "not yours" and "not there" indistinguishable, which is the point.
    expect((await reextract(source)).status).toBe(404);
  });
});
