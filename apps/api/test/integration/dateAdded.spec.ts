/**
 * US-021 — "date added" is recorded ONCE, from the capture, and never
 * overwritten (REQ-030, product invariant 6).
 *
 * `T-DATE-010` (a created listing carries the batch's capture date),
 * `T-DATE-011` (seeing the same listing again never moves it),
 * `T-DATE-012` (a first-run backlog import dates every listing the same, and
 * reads no date out of the screenshots) and `T-DATE-013` (a work re-created
 * after removal carries the NEW date, not the one it left with).
 *
 * ⚠ WHY THESE ARE INTEGRATION TESTS AND WHY THEY EXIST AT ALL. Before this
 * file, US-021 was covered by `T-INV-006` — a static grep asserting that
 * nothing outside `createListing` assigns `.dateAdded`. That gate is real, but
 * it can only see the shape of the source: it passes just as happily if
 * `createListing` is called a second time for a listing that already exists,
 * if the close hands it `new Date()` instead of the capture instant, or if the
 * title-level date is dragged forward by a later capture. Every one of those
 * is a silent defect — the list quietly re-orders itself and the owner has no
 * way to tell that a date they remember is now wrong. `specs/testing.md` §19.2
 * additionally claimed the re-observation path was "covered behaviourally by
 * T-DATE-011" while no such test existed. It does now.
 *
 * ⚠ THE CLOCK IS INJECTED, DELIBERATELY. `closeBatch` takes `now`, so every
 * assertion here names an exact date instead of recomputing "today" the same
 * way the implementation does. A test that derives its expectation from
 * `new Date()` agrees with an implementation that stamps the wrong instant, as
 * long as both are wrong on the same day — which is every day.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { deriveOwnerId } from '../../src/auth/ownerId.js';
import { closeBatch } from '../../src/services/batchClose.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const ownerId = deriveOwnerId({
  issuer: 'https://sts.windows.net/tenant/',
  subject: 'oid-owner-dateadded',
  email: null,
});

const DUNE = 'tmdb:movie:438631';
const ARRIVAL = 'tmdb:movie:329865';
const HEAT = 'tmdb:movie:949';

/** The capture instant used by most closes. Mid-afternoon UTC on purpose: a
 * `dateAdded` that is not truncated to midnight shows up as a time component
 * rather than as a wrong day, and would otherwise pass unnoticed. */
const CAPTURE = new Date('2026-03-05T13:45:07.512Z');
const CAPTURE_DAY = '2026-03-05';

/** Far enough from `CAPTURE` that a carried-over or refreshed date is
 * unmistakable rather than an off-by-one. */
const LONG_AGO = '2026-01-04';
const LATER = new Date('2026-06-15T09:00:00.000Z');
const LATER_DAY = '2026-06-15';

let seq = 0;

const day = (value: Date | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toISOString().slice(0, 10);

async function seedBatch(
  id: string,
  over: { mode?: string; status?: string; service?: string } = {},
): Promise<string> {
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service: over.service ?? 'netflix',
      mode: over.mode ?? 'append-only',
      status: over.status ?? 'in-review',
      lowYield: false,
      degradedExtraction: false,
    },
  });
  return id;
}

/**
 * A reviewed candidate. `classification` is what decides which review section
 * the candidate lands in, and therefore whether the close writes anything for
 * it at all — `already-present-for-this-service` is READ-ONLY by contract
 * (US-013 AC-2), which is precisely the property `T-DATE-011a` depends on.
 */
async function seedCandidate(
  batchId: string,
  over: {
    identity: string;
    name: string;
    classification?: string;
    disposition?: string;
    tmdbId: number;
  },
): Promise<string> {
  const id = `date-cand-${++seq}`;
  await testPrisma().extractionCandidate.create({
    data: {
      id,
      ownerId,
      batchId,
      rawText: over.name,
      inferredTitle: over.name,
      basis: 'both',
      ocrSupport: 'exact',
      provider: 'llm',
      normalisedText: over.name.toLowerCase(),
      boxSource: 'llm',
      cleanupVerdict: 'title-candidate',
      resolvedWorkIdentity: over.identity,
      classification: over.classification ?? 'new',
      reviewDisposition: over.disposition ?? 'confirmed',
      collapsedIntoCandidateId: null,
      matchCandidates: JSON.stringify([
        {
          tmdbId: over.tmdbId,
          mediaType: 'movie',
          name: over.name,
          releaseYear: 2021,
          posterPath: null,
          score: 1,
        },
      ]),
    },
  });
  return id;
}

/** An existing, active title with one active listing, added `LONG_AGO`. */
async function seedActiveTitle(
  over: { identity?: string; service?: string; name?: string } = {},
): Promise<{ titleId: string; listingId: string }> {
  const titleId = `date-title-${++seq}`;
  const listingId = `date-listing-${seq}`;
  const batchId = await seedBatch(`date-seed-batch-${seq}`, { status: 'applied' });
  await testPrisma().title.create({
    data: {
      id: titleId,
      ownerId,
      workIdentity: over.identity ?? DUNE,
      state: 'active',
      matchState: 'matched',
      rawExtractedText: null,
      normalisedText: (over.name ?? 'Dune').toLowerCase(),
      tmdbId: 438631,
      tmdbMediaType: 'movie',
      tmdbName: over.name ?? 'Dune',
      tmdbReleaseYear: 2021,
      sortDateAdded: new Date(LONG_AGO),
    },
  });
  await testPrisma().serviceListing.create({
    data: {
      listingId,
      ownerId,
      titleId,
      service: over.service ?? 'netflix',
      state: 'active',
      dateAdded: new Date(LONG_AGO),
      createdByBatchId: batchId,
    },
  });
  return { titleId, listingId };
}

/** The same, but the work has already been removed — `T-DATE-013`'s setup. */
async function seedRemovedTitle(): Promise<{ titleId: string; listingId: string }> {
  const titleId = `date-removed-title-${++seq}`;
  const listingId = `date-removed-listing-${seq}`;
  const batchId = await seedBatch(`date-removed-batch-${seq}`, { status: 'applied' });
  await testPrisma().title.create({
    data: {
      id: titleId,
      ownerId,
      workIdentity: DUNE,
      state: 'removed',
      matchState: 'matched',
      rawExtractedText: null,
      normalisedText: 'dune',
      tmdbId: 438631,
      tmdbMediaType: 'movie',
      tmdbName: 'Dune',
      tmdbReleaseYear: 2021,
      sortDateAdded: new Date(LONG_AGO),
    },
  });
  await testPrisma().serviceListing.create({
    data: {
      listingId,
      ownerId,
      titleId,
      service: 'netflix',
      state: 'removed',
      dateAdded: new Date(LONG_AGO),
      removedAt: new Date('2026-02-01T10:00:00Z'),
      createdByBatchId: batchId,
    },
  });
  return { titleId, listingId };
}

/** An image that arrived on some earlier day. `T-DATE-012` needs these to
 * differ from each other AND from the close, so that "every listing shares one
 * date" cannot be satisfied by reading anything off the images. */
async function seedImage(batchId: string, uploadedAt: string): Promise<void> {
  const id = `date-image-${++seq}`;
  await testPrisma().uploadedImage.create({
    data: {
      id,
      ownerId,
      batchId,
      blobPath: `${ownerId}/${batchId}/${id}.png`,
      fileName: `${id}.png`,
      uploadedFormat: 'png',
      format: 'png',
      byteSize: BigInt(1024),
      uploadedByteSize: BigInt(1024),
      uploadedAt: new Date(uploadedAt),
      retainUntil: new Date('2099-01-01T00:00:00Z'),
    },
  });
}

const listingsFor = (titleId: string) =>
  testPrisma().serviceListing.findMany({ where: { ownerId, titleId }, orderBy: { listingId: 'asc' } });

const titleFor = (identity: string) =>
  testPrisma().title.findFirst({ where: { ownerId, workIdentity: identity, state: 'active' } });

beforeEach(async () => {
  testPrisma();
  await resetDatabase();
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('US-021 — date added comes from the capture and is written once', () => {
  it('T-DATE-010 · AC-1 · a created listing carries the batch\u2019s capture date, truncated to the day', async () => {
    const batchId = await seedBatch('date-batch-010');
    await seedCandidate(batchId, { identity: DUNE, name: 'Dune', tmdbId: 438631 });

    const result = await closeBatch(ownerId, batchId, CAPTURE);
    expect(result.summary.listingsCreated).toBe(1);

    const title = await titleFor(DUNE);
    expect(title).not.toBeNull();
    const listings = await listingsFor(title?.id ?? '');
    expect(listings).toHaveLength(1);

    // The capture day, not the runner's day. If `closeBatch` ignored `now` and
    // called `new Date()` itself, this is the assertion that says so.
    expect(day(listings[0]?.dateAdded)).toBe(CAPTURE_DAY);

    // ⚠ AND MIDNIGHT — BUT READ THIS BEFORE TRUSTING IT. Both `date_added` and
    // `sort_date_added` are SQL `date` columns (`prisma/schema.prisma`), so the
    // store truncates whatever it is handed. Mutation-verified: replacing
    // `dateOnly(now)` with `now` in `batchClose` does NOT fail this file. So
    // this line pins the value that is STORED — which is what the sort and the
    // API read — and the application-side `dateOnly()` is belt-and-braces on
    // top of the column, not the thing under test. Do not "strengthen" this
    // into a claim that the code truncates; it would be false.
    expect(listings[0]?.dateAdded?.toISOString()).toBe('2026-03-05T00:00:00.000Z');

    // The title-level date is derived from the listing, so a close that dated
    // the two independently would show one date and sort by another.
    expect(day(title?.sortDateAdded)).toBe(CAPTURE_DAY);
  });

  it('T-DATE-011a · AC-2 · re-seeing a listing already on the service changes nothing', async () => {
    const seeded = await seedActiveTitle();
    const batchId = await seedBatch('date-batch-011a');
    await seedCandidate(batchId, {
      identity: DUNE,
      name: 'Dune',
      tmdbId: 438631,
      classification: 'already-present-for-this-service',
      disposition: 'pending',
    });

    const result = await closeBatch(ownerId, batchId, LATER);
    // Nothing is written for a row the owner was shown READ-ONLY. A second
    // listing here would also be the visible symptom of the same bug.
    expect(result.summary.listingsCreated).toBe(0);
    expect(result.summary.titlesCreated).toBe(0);

    const listings = await listingsFor(seeded.titleId);
    expect(listings).toHaveLength(1);
    expect(listings[0]?.listingId).toBe(seeded.listingId);
    expect(day(listings[0]?.dateAdded)).toBe(LONG_AGO);

    const title = await titleFor(DUNE);
    expect(day(title?.sortDateAdded)).toBe(LONG_AGO);
  });

  it('T-DATE-011b · AC-2 · a later capture on a SECOND service never moves the first one', async () => {
    const seeded = await seedActiveTitle({ service: 'netflix' });
    const batchId = await seedBatch('date-batch-011b', { service: 'max' });
    await seedCandidate(batchId, { identity: DUNE, name: 'Dune', tmdbId: 438631 });

    const result = await closeBatch(ownerId, batchId, LATER);
    expect(result.summary.listingsCreated).toBe(1);
    // The work is already on the list; only the badge is new.
    expect(result.summary.titlesCreated).toBe(0);

    const listings = await listingsFor(seeded.titleId);
    expect(listings).toHaveLength(2);

    const netflix = listings.find((row) => row.service === 'netflix');
    const max = listings.find((row) => row.service === 'max');
    // Per-service dates are independent facts, and the older one is the one a
    // careless "refresh the dates on this title" would destroy.
    expect(day(netflix?.dateAdded)).toBe(LONG_AGO);
    expect(day(max?.dateAdded)).toBe(LATER_DAY);

    // Product invariant 6: the title-level date is the EARLIEST across its
    // listings, so capturing a second service must not re-order the list.
    const title = await titleFor(DUNE);
    expect(day(title?.sortDateAdded)).toBe(LONG_AGO);
  });

  it('T-DATE-012 · AC-4 · a first-run backlog import dates every listing identically, and reads no date off the screenshots', async () => {
    const batchId = await seedBatch('date-batch-012');
    // Three images that arrived on three different, earlier days. A screenshot
    // is a photograph of a list, not a record of when the list changed — any
    // implementation that reached for an image timestamp would produce three
    // different dates here, and each one would be wrong.
    await seedImage(batchId, '2025-11-02T08:00:00Z');
    await seedImage(batchId, '2025-12-24T22:10:00Z');
    await seedImage(batchId, '2026-02-14T17:30:00Z');

    await seedCandidate(batchId, { identity: DUNE, name: 'Dune', tmdbId: 438631 });
    await seedCandidate(batchId, { identity: ARRIVAL, name: 'Arrival', tmdbId: 329865 });
    await seedCandidate(batchId, { identity: HEAT, name: 'Heat', tmdbId: 949 });

    const result = await closeBatch(ownerId, batchId, CAPTURE);
    expect(result.summary.listingsCreated).toBe(3);

    const created = await testPrisma().serviceListing.findMany({
      where: { ownerId, createdByBatchId: batchId },
    });
    expect(created).toHaveLength(3);

    const dates = new Set(created.map((row) => day(row.dateAdded)));
    expect([...dates]).toEqual([CAPTURE_DAY]);

    const imageDays = new Set(
      (await testPrisma().uploadedImage.findMany({ where: { ownerId, batchId } })).map((row) =>
        day(row.uploadedAt),
      ),
    );
    // Stated separately from the equality above: "all three agree" would still
    // hold if all three had been taken from the same image.
    for (const imageDay of imageDays) expect(dates.has(imageDay)).toBe(false);
  });

  it('T-DATE-013 · AC-5 · a work re-created after removal carries the NEW date, not the one it left with', async () => {
    const old = await seedRemovedTitle();
    const batchId = await seedBatch('date-batch-013');
    await seedCandidate(batchId, { identity: DUNE, name: 'Dune', tmdbId: 438631 });

    const result = await closeBatch(ownerId, batchId, LATER);
    expect(result.summary.titlesCreated).toBe(1);
    expect(result.summary.listingsCreated).toBe(1);

    const fresh = await titleFor(DUNE);
    expect(fresh?.id).not.toBe(old.titleId);
    expect(day(fresh?.sortDateAdded)).toBe(LATER_DAY);

    const freshListings = await listingsFor(fresh?.id ?? '');
    expect(freshListings).toHaveLength(1);
    expect(freshListings[0]?.listingId).not.toBe(old.listingId);
    expect(day(freshListings[0]?.dateAdded)).toBe(LATER_DAY);

    // ⚠ The other half, and the reason this is not a duplicate of `T-REAP-010`:
    // the historical row keeps ITS date. The removed view answers "when did
    // this leave", so a re-date there would rewrite history rather than record
    // it.
    const oldListing = await testPrisma().serviceListing.findFirst({
      where: { ownerId, listingId: old.listingId },
    });
    expect(day(oldListing?.dateAdded)).toBe(LONG_AGO);
    expect(oldListing?.state).toBe('removed');
  });
});
