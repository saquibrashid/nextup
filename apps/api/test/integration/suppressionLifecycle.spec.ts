/**
 * TASK-103 — the suppression gate that runs BEFORE record creation
 * (`specs/api.md` §6.22, REQ-071, REQ-072, US-028 AC-3/AC-5, product
 * invariant 1).
 *
 * `T-SUP-003` is the whole lifecycle in one arc: suppress a work, let it leave
 * the list, then hand the app a screenshot that has it again. The correct
 * answer is that NOTHING is created — no Title, no ServiceListing — and the
 * work never appears in the review at all.
 *
 * ⚠ This has to be an integration test, and the reason is the invariant
 * itself. Suppression is keyed on canonical WORK IDENTITY and not on a row id
 * precisely BECAUSE a reappearing work becomes a brand-new row (product
 * invariant 7): the title the owner pressed "not interested" on is gone by the
 * time the gate has to fire, so the only thing that can join the two is the
 * store. A stubbed repository would be asked for a suppression by whatever key
 * the handler chose and would agree — which is the exact defect this file
 * exists to make impossible, since a row-scoped gate appears to work right up
 * until the first reappearance and then silently stops.
 *
 * ⚠ The gate lives in TWO places on purpose and both are exercised here: the
 * review read filters suppressed identities out (`ownerData.ts`), and the
 * close RE-CHECKS inside the transaction (`batchClose.ts`), because review and
 * close are separate requests and a work suppressed from another tab between
 * the two would otherwise be created by a close the owner never asked for.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

/**
 * The one seam in this file that is not the real thing — and the reason it has
 * to exist is itself a finding.
 *
 * The close re-reads the review at close time, and that read already filters
 * suppressed identities out. So in a single-request world the in-transaction
 * re-check in `batchClose.ts` never fires, and mutation testing proved it:
 * deleting that gate outright left every black-box case green. It is NOT dead
 * code — the window it guards is real, between `loadReviewCandidates` and
 * `runInTransaction` — but the window is microseconds wide and cannot be
 * opened from outside the process.
 *
 * `hideSuppressionsFromLoad` reproduces it exactly: the LOAD sees no
 * suppressions (as it would have, moments before the owner pressed the
 * button), while the real `findActiveSuppression` inside the transaction sees
 * the row that is genuinely in the store. Nothing else is stubbed; the gate
 * under test is the shipped one. This is the same technique `T-REM-015` uses
 * for the mid-apply removal failure, and for the same reason.
 */
const hideSuppressionsFromLoad = vi.hoisted(() => ({ value: false }));

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    listActiveSuppressions: (
      ...args: Parameters<typeof actual.listActiveSuppressions>
    ): ReturnType<typeof actual.listActiveSuppressions> =>
      hideSuppressionsFromLoad.value
        ? (Promise.resolve([]) as ReturnType<typeof actual.listActiveSuppressions>)
        : actual.listActiveSuppressions(...args),
  };
});

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-sup-lifecycle';
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

const DUNE = 'tmdb:movie:438631';
const HEAT = 'tmdb:movie:949';
/**
 * A text-derived identity. US-028 AC-6′ makes unmatched works suppressible,
 * and the gate must not branch on the prefix to do it.
 */
const UNMATCHED = 'unmatched:9f2b1c4d5e6f7a80';

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

interface ReviewSection {
  count: number;
  omitted?: boolean;
  items: { candidateId?: string; rawText?: string; name?: string }[];
}

interface ReviewBody {
  sections: {
    additions: ReviewSection;
    alreadyOnYourList: ReviewSection;
    probablyNotTitles: ReviewSection;
    unmatched: ReviewSection;
    unreadableTiles: ReviewSection;
    removals: ReviewSection;
  };
}

interface CloseBody {
  summary: {
    titlesCreated: number;
    listingsCreated: number;
    unresolvedKept: number;
    suppressedGated: number;
  };
}

const getReview = (batchId: string): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/review`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });

const close = (batchId: string, body: unknown = {}): Promise<Response> =>
  fetch(`${origin}/api/batches/${batchId}/close`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader,
    },
    body: JSON.stringify(body),
  });

const suppressTitle = (titleId: string): Promise<Response> =>
  fetch(`${origin}/api/titles/${titleId}/suppress`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader,
    },
    body: '{}',
  });

const unsuppress = (suppressionId: string): Promise<Response> =>
  fetch(`${origin}/api/suppressions/${suppressionId}/unsuppress`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader,
    },
    body: '{}',
  });

/* ── fixtures ─────────────────────────────────────────────────────────── */

let batchSeq = 0;

/** An open append-only batch — the "re-upload" half of the lifecycle. */
async function makeBatch(service = 'netflix', mode = 'append-only'): Promise<string> {
  const id = `batch-sup-${++batchSeq}`;
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service,
      mode,
      status: 'in-review',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
    },
  });
  return id;
}

let candidateSeq = 0;

/**
 * A candidate the owner has already confirmed.
 *
 * `confirmed` rather than `pending` because a pending addition makes the batch
 * unclosable (`PENDING_ADDITIONS`), and the property under test is what the
 * close does with a decision that HAS been made.
 */
async function makeConfirmedCandidate(
  batchId: string,
  workIdentity: string,
  rawText: string,
): Promise<string> {
  const id = `supcand-${++candidateSeq}`;
  await testPrisma().extractionCandidate.create({
    data: {
      id,
      ownerId,
      batchId,
      rawText,
      inferredTitle: rawText,
      basis: 'both',
      ocrSupport: 'exact',
      provider: 'llm',
      normalisedText: rawText.toLowerCase(),
      boxSource: 'llm',
      cleanupVerdict: 'title-candidate',
      resolvedWorkIdentity: workIdentity,
      classification: 'new',
      reviewDisposition: 'confirmed',
      collapsedIntoCandidateId: null,
    },
  });
  return id;
}

let titleSeq = 0;

/** A title with one active listing, as an earlier capture would have left it. */
async function makeActiveTitle(
  workIdentity: string,
  service: string,
  name: string,
): Promise<{ titleId: string; listingId: string }> {
  const titleId = `suptitle-${++titleSeq}`;
  const listingId = `suplisting-${titleSeq}`;
  const matched = workIdentity.startsWith('tmdb:');
  // `title_match_coherent` is a CHECK constraint: a matched title carries a
  // tmdbId and a NULL rawExtractedText, an unmatched one the exact opposite.
  await testPrisma().title.create({
    data: {
      id: titleId,
      ownerId,
      workIdentity,
      state: 'active',
      matchState: matched ? 'matched' : 'unmatched',
      rawExtractedText: matched ? null : name,
      normalisedText: name.toLowerCase(),
      tmdbId: matched ? Number(workIdentity.split(':')[2]) : null,
      tmdbMediaType: matched ? (workIdentity.split(':')[1] ?? null) : null,
      tmdbName: matched ? name : null,
      tmdbReleaseYear: matched ? 1995 : null,
      sortDateAdded: new Date('2026-01-04'),
    },
  });
  await testPrisma().uploadBatch.upsert({
    where: { id: `batch-sup-seed-${service}` },
    update: {},
    create: {
      id: `batch-sup-seed-${service}`,
      ownerId,
      service,
      mode: 'append-only',
      status: 'applied',
      lowYield: false,
      degradedExtraction: false,
    },
  });
  await testPrisma().serviceListing.create({
    data: {
      listingId,
      ownerId,
      titleId,
      service,
      state: 'active',
      dateAdded: new Date('2026-01-04'),
      createdByBatchId: `batch-sup-seed-${service}`,
    },
  });
  return { titleId, listingId };
}

/**
 * The middle of the lifecycle: the work leaves the service.
 *
 * Written straight to the store rather than driven through a full-update
 * close, because the removal is the PREMISE of this file, not its subject —
 * `batchCloseRemovals.spec.ts` owns proving the close removes correctly.
 */
async function removeFromService(titleId: string, listingId: string): Promise<void> {
  await testPrisma().serviceListing.update({
    where: { listingId },
    data: { state: 'removed', removedAt: new Date('2026-02-01') },
  });
  await testPrisma().title.update({ where: { id: titleId }, data: { state: 'removed' } });
}

/** Suppress through the real route, so the key is whatever the app derives. */
async function suppressWork(titleId: string): Promise<string> {
  const res = await suppressTitle(titleId);
  expect(res.status).toBe(200);
  return ((await res.json()) as { suppressionId: string }).suppressionId;
}

const countsFor = async (
  workIdentity: string,
): Promise<{ titles: number; listings: number; active: number }> => {
  const titles = await testPrisma().title.findMany({ where: { ownerId, workIdentity } });
  const listings = await testPrisma().serviceListing.findMany({
    where: { ownerId, titleId: { in: titles.map((t) => t.id) } },
  });
  return {
    titles: titles.length,
    listings: listings.length,
    active: listings.filter((l) => l.state === 'active').length,
  };
};

/* ── lifecycle ────────────────────────────────────────────────────────── */

beforeEach(async () => {
  resetAllowListWarning();
  hideSuppressionsFromLoad.value = false;
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

  // Derived from a real request so the owner-id hash is never hard-coded.
  const created = await fetch(`${origin}/api/batches`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CLIENT_PRINCIPAL_HEADER]: principalHeader,
    },
    body: JSON.stringify({ service: 'netflix', mode: 'append-only' }),
  });
  const body = (await created.json()) as { batchId: string };
  const row = await testPrisma().uploadBatch.findFirst({ where: { id: body.batchId } });
  ownerId = row?.ownerId ?? '';
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

/* ── tests ────────────────────────────────────────────────────────────── */

describe('T-SUP-003 · US-028 AC-3/AC-5 · suppress → remove → re-upload creates nothing', () => {
  it('T-SUP-003a · the reappearing work is absent from the review and creates NO records', async () => {
    const { titleId, listingId } = await makeActiveTitle(DUNE, 'netflix', 'Dune');
    await suppressWork(titleId);
    await removeFromService(titleId, listingId);

    const before = await countsFor(DUNE);

    const batchId = await makeBatch();
    await makeConfirmedCandidate(batchId, DUNE, 'Dune');

    const review = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(review.sections.additions.count).toBe(0);
    expect(review.sections.alreadyOnYourList.count).toBe(0);
    expect(review.sections.unmatched.count).toBe(0);

    const res = await close(batchId);
    expect(res.status).toBe(200);
    const summary = ((await res.json()) as CloseBody).summary;
    expect(summary.titlesCreated).toBe(0);
    expect(summary.listingsCreated).toBe(0);

    // The store is the assertion: not "we did not report creating it" but
    // "there is nothing there". A second Title row under the same identity
    // would be the reappearance defect wearing a passing summary.
    expect(await countsFor(DUNE)).toEqual(before);
  });

  it('T-SUP-003b · the gated candidate is COUNTED, not silently dropped', async () => {
    // REQ-072: the close tells the owner it withheld something. A gate that
    // reports zero is indistinguishable from a batch that had nothing in it,
    // and the owner would have no way to discover why a title they can see on
    // Netflix never arrives.
    const { titleId, listingId } = await makeActiveTitle(DUNE, 'netflix', 'Dune');
    await suppressWork(titleId);
    await removeFromService(titleId, listingId);

    const batchId = await makeBatch();
    await makeConfirmedCandidate(batchId, DUNE, 'Dune');

    const summary = ((await (await close(batchId)).json()) as CloseBody).summary;
    expect(summary.suppressedGated).toBe(1);
  });

  it('T-SUP-003c · the gate is a POINT READ on identity — its neighbours still land', async () => {
    // The failure this rules out is a gate that matches too widely (a prefix
    // scan, a `startsWith`, a media-type match). It presents as titles the
    // owner never suppressed quietly failing to appear, which is invisible:
    // there is no record of a row that was never created.
    const { titleId, listingId } = await makeActiveTitle(DUNE, 'netflix', 'Dune');
    await suppressWork(titleId);
    await removeFromService(titleId, listingId);

    const batchId = await makeBatch();
    await makeConfirmedCandidate(batchId, DUNE, 'Dune');
    await makeConfirmedCandidate(batchId, HEAT, 'Heat');

    const summary = ((await (await close(batchId)).json()) as CloseBody).summary;
    expect(summary.suppressedGated).toBe(1);
    expect(summary.titlesCreated).toBe(1);
    expect(summary.listingsCreated).toBe(1);

    expect((await countsFor(HEAT)).active).toBe(1);
    expect((await countsFor(DUNE)).active).toBe(0);
  });

  it('T-SUP-003d · no branch by match state — an unmatched: identity gates identically', async () => {
    // US-028 AC-6′. `unmatched:` identities are text-derived and therefore
    // less stable, but instability is a reason to CAVEAT the suppression in
    // the UI, never a reason for the gate to treat it as a different kind of
    // key. A branch here would mean the one class of work the owner most
    // wants gone is the one that keeps coming back.
    const { titleId, listingId } = await makeActiveTitle(
      UNMATCHED,
      'netflix',
      'Somethign Unreadble',
    );
    await suppressWork(titleId);
    await removeFromService(titleId, listingId);

    const before = await countsFor(UNMATCHED);

    const batchId = await makeBatch();
    await makeConfirmedCandidate(batchId, UNMATCHED, 'Somethign Unreadble');

    const review = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(review.sections.unmatched.count).toBe(0);
    expect(review.sections.additions.count).toBe(0);

    const summary = ((await (await close(batchId)).json()) as CloseBody).summary;
    expect(summary.titlesCreated).toBe(0);
    expect(summary.unresolvedKept).toBe(0);
    expect(summary.suppressedGated).toBe(1);
    expect(await countsFor(UNMATCHED)).toEqual(before);
  });

  it('T-SUP-003e · the OLD removed rows are left exactly as they were', async () => {
    // Product invariant 7 and REQ-028: the removed view is a historical log.
    // The temptation a gated reappearance creates is to "tidy up" by
    // restoring or re-dating the old row, which would rewrite history the
    // owner is entitled to read back unchanged.
    const { titleId, listingId } = await makeActiveTitle(DUNE, 'netflix', 'Dune');
    await suppressWork(titleId);
    await removeFromService(titleId, listingId);

    const titleBefore = await testPrisma().title.findFirst({ where: { id: titleId } });
    const listingBefore = await testPrisma().serviceListing.findFirst({ where: { listingId } });

    const batchId = await makeBatch();
    await makeConfirmedCandidate(batchId, DUNE, 'Dune');
    expect((await close(batchId)).status).toBe(200);

    expect(await testPrisma().title.findFirst({ where: { id: titleId } })).toEqual(titleBefore);
    expect(await testPrisma().serviceListing.findFirst({ where: { listingId } })).toEqual(
      listingBefore,
    );
  });

  it('T-SUP-003f · un-suppressing lets the SAME re-upload through', async () => {
    // Without this the file proves only that something failed to be created,
    // not that the suppression is what stopped it. It is also the property
    // US-029 AC-3 depends on: "interested again" has to actually work.
    const { titleId, listingId } = await makeActiveTitle(DUNE, 'netflix', 'Dune');
    const suppressionId = await suppressWork(titleId);
    await removeFromService(titleId, listingId);

    const gated = await makeBatch();
    await makeConfirmedCandidate(gated, DUNE, 'Dune');
    expect(((await (await close(gated)).json()) as CloseBody).summary.titlesCreated).toBe(0);

    expect((await unsuppress(suppressionId)).status).toBe(200);

    const allowed = await makeBatch();
    await makeConfirmedCandidate(allowed, DUNE, 'Dune');
    const summary = ((await (await close(allowed)).json()) as CloseBody).summary;
    expect(summary.suppressedGated).toBe(0);
    expect(summary.titlesCreated).toBe(1);
    expect(summary.listingsCreated).toBe(1);

    // Invariant 7 again: a NEW row, not the old one brought back to life.
    const counts = await countsFor(DUNE);
    expect(counts.titles).toBe(2);
    expect(counts.active).toBe(1);
  });

  it('T-SUP-003g · a suppression landing after the review is honoured by the close', async () => {
    // The user-visible property: the owner reviewed a batch, then pressed "not
    // interested" in another tab. Whichever of the two gates fires, the close
    // must not create the record they just refused.
    const { titleId } = await makeActiveTitle(HEAT, 'max', 'Heat');

    const batchId = await makeBatch('netflix');
    await makeConfirmedCandidate(batchId, HEAT, 'Heat');

    const review = (await (await getReview(batchId)).json()) as ReviewBody;
    expect(review.sections.additions.count).toBe(1);

    await suppressWork(titleId);

    const summary = ((await (await close(batchId)).json()) as CloseBody).summary;
    expect(summary.listingsCreated).toBe(0);
    expect(summary.suppressedGated).toBe(1);
    expect(
      await testPrisma().serviceListing.count({ where: { ownerId, service: 'netflix' } }),
    ).toBe(0);
  });

  it('T-SUP-003h · the IN-TRANSACTION re-check catches a suppression the load missed', async () => {
    // Drives the gate `batchClose.ts` re-checks inside the transaction, which
    // the close-time review read otherwise makes unreachable. See the mock's
    // header: without this case, deleting that gate entirely goes unnoticed.
    const { titleId } = await makeActiveTitle(HEAT, 'max', 'Heat');
    await suppressWork(titleId);

    const batchId = await makeBatch('netflix');
    await makeConfirmedCandidate(batchId, HEAT, 'Heat');

    hideSuppressionsFromLoad.value = true;

    const summary = ((await (await close(batchId)).json()) as CloseBody).summary;
    expect(summary.titlesCreated).toBe(0);
    expect(summary.listingsCreated).toBe(0);
    // Counted from the transaction, not from the load — the load saw nothing.
    expect(summary.suppressedGated).toBe(1);
    expect(
      await testPrisma().serviceListing.count({ where: { ownerId, service: 'netflix' } }),
    ).toBe(0);
  });

  it('T-SUP-003i · the in-transaction re-check does not branch on the prefix either', async () => {
    // The same point-read rule as `T-SUP-003d`, applied to the second gate.
    // The two are separate pieces of code and a prefix branch could be added
    // to one without the other.
    const { titleId } = await makeActiveTitle(UNMATCHED, 'max', 'Somethign Unreadble');
    await suppressWork(titleId);

    const batchId = await makeBatch('netflix');
    await makeConfirmedCandidate(batchId, UNMATCHED, 'Somethign Unreadble');

    hideSuppressionsFromLoad.value = true;

    const summary = ((await (await close(batchId)).json()) as CloseBody).summary;
    expect(summary.titlesCreated).toBe(0);
    expect(summary.unresolvedKept).toBe(0);
    expect(summary.suppressedGated).toBe(1);
  });

  it('T-SUP-003j · one gated candidate does not stop its neighbours being written', async () => {
    // The gate `continue`s past a suppressed candidate; a `break`, or a throw,
    // would silently drop every candidate after it in the batch — and the
    // owner would see a partial import with no error to explain it.
    const { titleId } = await makeActiveTitle(HEAT, 'max', 'Heat');
    await suppressWork(titleId);

    const batchId = await makeBatch('netflix');
    await makeConfirmedCandidate(batchId, HEAT, 'Heat');
    await makeConfirmedCandidate(batchId, DUNE, 'Dune');

    hideSuppressionsFromLoad.value = true;

    const summary = ((await (await close(batchId)).json()) as CloseBody).summary;
    expect(summary.suppressedGated).toBe(1);
    expect(summary.titlesCreated).toBe(1);
    expect(summary.listingsCreated).toBe(1);
    expect((await countsFor(DUNE)).active).toBe(1);
    // HEAT keeps its pre-existing Max listing — the gate refuses to CREATE,
    // it never removes — so the assertion is that no Netflix one appeared.
    expect(
      await testPrisma().serviceListing.count({ where: { ownerId, service: 'netflix' } }),
    ).toBe(1);
  });
});
