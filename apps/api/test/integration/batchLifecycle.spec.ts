/**
 * TASK-054 — submit and discard, through the real app (`specs/api.md` §6.14,
 * §6.23).
 *
 * Integration rather than unit because both properties under test are
 * properties of the DATABASE, not of the handlers:
 *
 *   • `T-BATCH-006` asserts that an abandoned batch writes nothing to the
 *     list. A stubbed repository proves nothing about that — the only
 *     convincing evidence is a list read back from real rows before and after.
 *
 *   • `T-BATCH-018` asserts that two concurrent submits produce exactly ONE
 *     transition. That is a race between two statements reaching SQL Server,
 *     and it cannot exist in a test that fakes the store: an in-memory stub
 *     has no interleaving to lose.
 *
 * ⚠ `T-BATCH-018` is defined in `specs/testing.md` §24.1 with its reason. It
 * is not a hypothetical: `submitBatch` reads the batch, decides, and then
 * writes, and every `await` between those is a window. The naive
 * implementation passes every single-threaded test in this file.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { extractionSettled } from '../../src/jobs/startExtraction.js';
import {
  asOwnerId,
  createServiceListing,
  createTitle,
  createUploadBatch,
  createUploadedImage,
  findUploadBatch,
  listImagesForBatch,
  transitionUploadBatchStatus,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

/**
 * A switch that suppresses the fire-and-forget extraction for ONE test.
 *
 * ⚠ This exists because of a real, diagnosed CI failure, and the diagnosis is
 * worth keeping: `T-BATCH-018c` failed intermittently with `[202, 202]`, and
 * the second 202 was CORRECT BEHAVIOUR rather than a lost race.
 *
 * The sequence is: request A wins the `draft -> submitted` transition and
 * answers 202; `beginExtraction` then drives the batch to `extraction-failed`
 * "in microseconds", because CI configures no reader (see the docblock on
 * `beginExtraction`, and `T-BATCH-019a`, which asserts exactly that status).
 * If request B's `loadOwnedBatch` happens to resolve after all of that, B
 * observes `extraction-failed` — from which `submitted` is a LEGAL transition,
 * because retry deliberately re-enters the same batch (§6.16). B is therefore
 * not a duplicate submit at all; it is a valid retry of a failed extraction,
 * and 202 is the specified answer.
 *
 * That confound also explains why the earlier attempts to "fix" this failed:
 * both `UPDATE`s genuinely matched a row, so neither the row-count plumbing
 * nor the `status: from` predicate was ever implicated. The two statements
 * simply had different `from` values.
 *
 * Suppressing extraction removes the confound WITHOUT weakening the case: the
 * request still travels the whole route -> service -> SQL Server path, so a
 * route that bypassed the service is still caught. What is removed is an
 * asynchronous job this test was never about.
 */
const extraction = vi.hoisted(() => ({ suppressed: false }));

vi.mock('../../src/jobs/startExtraction.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/jobs/startExtraction.js')>();
  return {
    ...actual,
    beginExtraction: (...args: Parameters<typeof actual.beginExtraction>): void => {
      if (!extraction.suppressed) actual.beginExtraction(...args);
    },
  };
});

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-lifecycle';
const OTHER_SUBJECT = 'oid-owner-lifecycle-other';
const ISSUER = 'https://sts.windows.net/tenant/';

const principalHeader = (subject: string): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: ISSUER },
        { typ: OID, val: subject },
      ],
    }),
    'utf8',
  ).toString('base64');

let server: Server;
let app: Express;
let origin: string;
let owner: OwnerId;

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

const post = (path: string, subject = SUBJECT, body?: unknown): Promise<Response> =>
  fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A batch in an arbitrary status, so every edge of the table is reachable. */
async function seedBatch(id: string, status: string, service = 'netflix') {
  return createUploadBatch(owner, { id, service, mode: 'append-only', status });
}

/** One image on a batch, so a submit is not refused for being empty. */
async function seedImage(batchId: string, id: string) {
  return createUploadedImage(owner, {
    id,
    batchId,
    blobPath: `owner/${batchId}/${id}.png`,
    fileName: 'IMG_0001.PNG',
    ingestSource: 'upload',
    uploadedFormat: 'png',
    format: 'png',
    byteSize: BigInt(1024),
    uploadedByteSize: BigInt(1088),
    retainUntil: new Date('2026-09-09T00:00:00.000Z'),
  });
}

/** A snapshot of everything the OWNER'S LIST is made of. */
async function listSnapshot(): Promise<string> {
  const prisma = testPrisma();
  const [titles, listings, states] = await Promise.all([
    prisma.title.findMany({ orderBy: { id: 'asc' } }),
    prisma.serviceListing.findMany({ orderBy: { listingId: 'asc' } }),
    prisma.serviceState.findMany({ orderBy: { service: 'asc' } }),
  ]);
  return JSON.stringify({ titles, listings, states }, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = `${SUBJECT},${OTHER_SUBJECT}`;
  testPrisma();
  await resetDatabase();

  app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Read the owner id back from the API rather than composing it here. It is
  // a hash of the verified principal (`deriveOwnerId`), and a locally
  // reconstructed copy would seed rows under an id no request can ever reach —
  // which shows up as a wall of 404s that look like missing routes.
  const me = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });
  owner = asOwnerId(((await me.json()) as { ownerId: string }).ownerId);
});

afterEach(async () => {
  extraction.suppressed = false;
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('POST /api/batches/:batchId/submit (§6.14)', () => {
  it('T-BATCH-019a: accepts a draft with images and answers 202', async () => {
    await seedBatch('b-submit', 'draft');
    await seedImage('b-submit', 'i-1');

    const res = await post('/api/batches/b-submit/submit');
    expect(res.status).toBe(202);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body['status']).toBe('submitted');
    expect(body['imageCount']).toBe(1);
    expect(body['pollAfterMs']).toBe(2000);
    expect(typeof body['submittedAt']).toBe('string');

    // ⚠ The 202 body is a SNAPSHOT taken before extraction starts; the stored
    // row is not, because extraction is already running by the time this line
    // executes. Reading the row without settling first asserted a transient
    // and got `extraction-failed` roughly whenever CI was fast.
    await extractionSettled('b-submit');

    const stored = await findUploadBatch(owner, 'b-submit');
    // No reader is configured here, and refusing LOUDLY is the specified
    // behaviour — a batch left in `extracting` while the SPA polls looks like
    // it is working. This is the wired end of `T-EXT-010k`.
    expect(stored?.status).toBe('extraction-failed');
    // `submittedAt` is what `GET /api/batches/:batchId` reports and what the
    // 15-minute extraction ceiling is measured from; a transition that moved
    // the status without stamping it would look correct in every response.
    expect(stored?.submittedAt).toBeInstanceOf(Date);
  });

  it('T-BATCH-019b: refuses an empty batch with 400 NO_IMAGES', async () => {
    await seedBatch('b-empty', 'draft');

    const res = await post('/api/batches/b-empty/submit');
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NO_IMAGES');

    // And it did NOT move: a refused submit that had already transitioned
    // would strand the batch in `submitted` with nothing to extract.
    expect((await findUploadBatch(owner, 'b-empty'))?.status).toBe('draft');
  });

  it('T-BATCH-019c: refuses a second submit with 409 BATCH_NOT_DRAFT', async () => {
    // ⚠ SEEDED `extracting`, NOT "submit twice". Submitting twice used to be
    // deterministic; it no longer is, because the first submit now starts
    // extraction, and an unconfigured reader lands the batch on
    // `extraction-failed` — which is a RESUBMITTABLE state by design, so the
    // second request would sometimes answer 202 and sometimes 409 depending on
    // who won the race. Seeding the state the rule is actually about asserts
    // the rule instead of the timing.
    await seedBatch('b-twice', 'extracting');
    await seedImage('b-twice', 'i-2');

    const res = await post('/api/batches/b-twice/submit');
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('BATCH_NOT_DRAFT');
    // The remedy hint: the SPA can say what state the batch would have to be
    // in, rather than only that the request was refused.
    expect(body.error.details['expectedOneOf']).toEqual(['draft', 'extraction-failed']);
  });

  it('T-BATCH-019e: lets the owner retry a batch whose extraction failed', async () => {
    // The other half of the hint above, and the reason 019c can no longer
    // submit twice: `extraction-failed` is deliberately NOT terminal.
    await seedBatch('b-retry', 'extraction-failed');
    await seedImage('b-retry', 'i-r');

    expect((await post('/api/batches/b-retry/submit')).status).toBe(202);
    await extractionSettled('b-retry');
  });

  it('T-AI-014a: extractor failure leaves the list unchanged, keeps images, and can retry', async () => {
    await seedBatch('b-extraction-error', 'draft');
    await seedImage('b-extraction-error', 'i-extraction-error');
    const batchForListing = await createUploadBatch(owner, {
      id: 'b-existing-listing',
      service: 'netflix',
      mode: 'append-only',
      status: 'applied',
    });
    const title = await createTitle(owner, {
      id: 't-existing-listing',
      workIdentity: 'tmdb:movie:438631',
      state: 'active',
      matchState: 'matched',
      tmdbId: 438631,
      tmdbMediaType: 'movie',
      tmdbName: 'Dune',
      tmdbReleaseYear: 2021,
      sortDateAdded: new Date('2026-04-02T00:00:00.000Z'),
      createdByBatchId: batchForListing.id,
    });
    await createServiceListing(owner, {
      listingId: 'l-existing-listing',
      titleId: title.id,
      service: 'netflix',
      state: 'active',
      dateAdded: new Date('2026-04-02T00:00:00.000Z'),
      createdByBatchId: batchForListing.id,
    });
    const before = await listSnapshot();

    const res = await post('/api/batches/b-extraction-error/submit');
    expect(res.status).toBe(202);
    await extractionSettled('b-extraction-error');

    const failed = await findUploadBatch(owner, 'b-extraction-error');
    expect(failed?.status).toBe('extraction-failed');
    expect(failed?.extractionErrorCode).toBe('EXTRACTOR_UNAVAILABLE');
    expect(await listSnapshot()).toBe(before);
    expect((await listImagesForBatch(owner, 'b-extraction-error')).map((i) => i.id)).toEqual([
      'i-extraction-error',
    ]);

    const retry = await post('/api/batches/b-extraction-error/submit');
    expect(retry.status).toBe(202);
    expect(((await retry.json()) as Record<string, unknown>)['status']).toBe('submitted');
    await extractionSettled('b-extraction-error');
  });

  it('T-BATCH-019d: answers 404, never 403, for another owner’s batch', async () => {
    await seedBatch('b-mine', 'draft');
    await seedImage('b-mine', 'i-3');

    const res = await post('/api/batches/b-mine/submit', OTHER_SUBJECT);
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });
});

describe('T-BATCH-018 — submit is atomic under concurrency (TASK-054)', () => {
  it('T-BATCH-018a: two concurrent transitions from the same status change exactly one row', async () => {
    // ⚠ This case is written against `transitionUploadBatchStatus` and NOT
    // through HTTP, and that is the whole point. The first draft of this test
    // fired two simultaneous `POST …/submit` requests and asserted
    // `[202, 409]` — it passed, and it passed IDENTICALLY when the
    // `status: from` predicate was deleted from the query. Mutation-verified,
    // and the mutation survived.
    //
    // The reason is that the adversarial interleaving never actually occurred:
    // both handlers `await` a load before writing, and in practice the second
    // load resolved after the first write, so the JavaScript-level
    // `canTransition` check refused it. A window that does not open cannot be
    // proven closed. Here both calls are issued from the same already-read
    // state, which is exactly the shape of the bug: two requests that both
    // observed `draft`.
    await seedBatch('b-atomic', 'draft');

    const results = await Promise.all([
      transitionUploadBatchStatus(owner, 'b-atomic', 'draft', { status: 'submitted' }),
      transitionUploadBatchStatus(owner, 'b-atomic', 'draft', { status: 'submitted' }),
    ]);

    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect((await findUploadBatch(owner, 'b-atomic'))?.status).toBe('submitted');
  });

  it('T-BATCH-018b: a transition from the right status does change a row', async () => {
    // `018a`'s non-vacuity guard: a predicate that matched nothing at all
    // would make the sum 0, not 1, but a helper that always returned 0 would
    // need this case to be caught.
    await seedBatch('b-atomic-solo', 'draft');
    expect(
      await transitionUploadBatchStatus(owner, 'b-atomic-solo', 'draft', { status: 'submitted' }),
    ).toBe(1);
  });

  it('T-BATCH-018c: two simultaneous submit requests never both succeed', async () => {
    // The end-to-end companion. It is NOT the discriminating case — see the
    // note on `018a` — but it asserts the property the owner actually
    // experiences, and it would catch a route that bypassed the service.
    //
    // ⚠ Extraction is suppressed for this case ONLY, and the reason is on
    // `extraction` at the top of this file: without it the loser of the race
    // can legitimately answer 202, because A's extraction has already failed
    // and `extraction-failed -> submitted` is a lawful retry. That made this
    // case intermittently red while the product was behaving correctly.
    extraction.suppressed = true;

    await seedBatch('b-race', 'draft');
    await seedImage('b-race', 'i-4');

    const [a, b] = await Promise.all([
      post('/api/batches/b-race/submit'),
      post('/api/batches/b-race/submit'),
    ]);

    expect([a.status, b.status].sort()).toEqual([202, 409]);
    const loser = a.status === 409 ? a : b;
    expect(((await loser.json()) as ErrorBody).error.code).toBe('BATCH_NOT_DRAFT');

    // The batch moved exactly once, and stayed moved.
    expect((await findUploadBatch(owner, 'b-race'))?.status).toBe('submitted');
  });

  it('T-BATCH-018d: a second submit after a FAILED extraction is a lawful retry, not a race', async () => {
    // The non-vacuity guard for `018c`'s suppression. If suppressing
    // extraction were quietly disabling the submit path rather than just the
    // job, `018c` would still be green and mean nothing. This case runs with
    // extraction LIVE and pins the behaviour that used to leak into `018c`:
    // once extraction has failed, a further submit is accepted (§6.16), so
    // `018c`'s 409 must come from the concurrency guard and not from submit
    // being refused a second time in general.
    await seedBatch('b-retry-race', 'draft');
    await seedImage('b-retry-race', 'i-5');

    expect((await post('/api/batches/b-retry-race/submit')).status).toBe(202);
    await extractionSettled('b-retry-race');
    expect((await findUploadBatch(owner, 'b-retry-race'))?.status).toBe('extraction-failed');

    expect((await post('/api/batches/b-retry-race/submit')).status).toBe(202);
    await extractionSettled('b-retry-race');
  });
});

describe('T-BATCH-006 · US-005 AC-4 · a discarded batch writes nothing to the list', () => {
  /** An existing list, so "nothing changed" has something to be true of. */
  async function seedExistingList(): Promise<void> {
    const applied = await createUploadBatch(owner, {
      id: 'b-applied',
      service: 'netflix',
      mode: 'append-only',
      status: 'applied',
    });
    await createTitle(owner, {
      id: 't-existing',
      workIdentity: 'tmdb:movie:7001',
      state: 'active',
      matchState: 'matched',
      tmdbId: 7001,
      tmdbMediaType: 'movie',
      tmdbName: 'Existing',
      tmdbGenres: JSON.stringify(['Drama']),
      sortDateAdded: new Date('2026-03-01T00:00:00.000Z'),
      createdByBatchId: applied.id,
    });
    await createServiceListing(owner, {
      listingId: 'l-existing',
      titleId: 't-existing',
      service: 'netflix',
      state: 'active',
      dateAdded: new Date('2026-03-01T00:00:00.000Z'),
      createdByBatchId: applied.id,
    });
  }

  it('T-BATCH-006a: discarding a draft leaves every title, listing and service state byte-identical', async () => {
    await seedExistingList();
    await seedBatch('b-discard', 'draft', 'max');
    await seedImage('b-discard', 'i-6');
    const before = await listSnapshot();

    const res = await post('/api/batches/b-discard/discard');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      batchId: 'b-discard',
      status: 'discarded',
      listStateChanged: false,
    });

    expect(await listSnapshot()).toBe(before);
  });

  it('T-BATCH-006b: the snapshot is not vacuously equal', async () => {
    // `006a`'s guard. A snapshot function that returned a constant — a typo in
    // a table name, a serialiser that dropped everything — would make
    // "nothing changed" true no matter what the discard did.
    const empty = await listSnapshot();
    await seedExistingList();
    expect(await listSnapshot()).not.toBe(empty);
  });

  it('T-BATCH-006c: the images are RETAINED, not deleted', async () => {
    // §6.23. Discard abandons the review, it does not destroy the capture —
    // NFR-019's 30-day purge governs the bytes, and deleting here would take
    // away the owner's ability to re-extract (§6.24).
    await seedBatch('b-discard-img', 'draft');
    await seedImage('b-discard-img', 'i-7');

    expect((await post('/api/batches/b-discard-img/discard')).status).toBe(200);
    expect(await listImagesForBatch(owner, 'b-discard-img')).toHaveLength(1);
  });

  it('T-BATCH-006d: discarding releases the one-open-batch ceiling', async () => {
    // The reason discard exists (US-005 AC-5 / §5): an abandoned batch that
    // still counted as open would lock the owner out of every future capture.
    await seedBatch('b-blocking', 'draft');

    const blocked = await post('/api/batches', SUBJECT, {
      service: 'max',
      mode: 'append-only',
    });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as ErrorBody).error.code).toBe('OPEN_BATCH_EXISTS');

    expect((await post('/api/batches/b-blocking/discard')).status).toBe(200);

    const allowed = await post('/api/batches', SUBJECT, {
      service: 'max',
      mode: 'append-only',
    });
    expect(allowed.status).toBe(201);
  });

  it('T-BATCH-006e: discard is refused from a status §6.23 does not list', async () => {
    // `submitted` and `extracting` are deliberately absent from the
    // discardable set: extraction is running against that batch in-process.
    await seedBatch('b-mid-extract', 'extracting');

    const res = await post('/api/batches/b-mid-extract/discard');
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('BATCH_IMMUTABLE');
    expect((await findUploadBatch(owner, 'b-mid-extract'))?.status).toBe('extracting');
  });

  it('T-BATCH-006f: a second discard is refused rather than silently repeated', async () => {
    // Not made idempotent on purpose: a 200 to a discard of an already
    // discarded batch would let the SPA report that it threw away work it
    // never touched.
    await seedBatch('b-double-discard', 'draft');
    expect((await post('/api/batches/b-double-discard/discard')).status).toBe(200);

    const res = await post('/api/batches/b-double-discard/discard');
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('BATCH_IMMUTABLE');
  });
});
