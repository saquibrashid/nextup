/**
 * #396 (US-066, PRD `A57`, ADR-0010 Rev 6) — the auto-detect close, with the
 * repository mocked.
 *
 * `test/integration/autoDetect.spec.ts` (`T-AUTO-015a`–`f`) proves what the
 * STORE ends up holding. This suite walks every branch of
 * `closeAutoDetectBatch` in one place — the refusals, each Waiting outcome,
 * the services path's no-op and re-date rules, and the availability write —
 * because `npm run coverage` excludes the integration project, and a branch
 * proven only there scores zero against the `apps/api/src/**` floor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewCandidate } from '@nextup/domain';

const loadOwnedBatch = vi.fn();
const transitionBatch = vi.fn();
const loadReviewCandidates = vi.fn();
const listListedWorkIdentities = vi.fn();
const listWaitingWorkIdentities = vi.fn();
const setCandidateDestination = vi.fn();
const findActiveSuppression = vi.fn();
const findTitleByWorkIdentity = vi.fn();
const createTitle = vi.fn();
const recordBatchChange = vi.fn();
const createWatchIntent = vi.fn();
const listListingsForTitle = vi.fn();
const createServiceListing = vi.fn();
const updateTitle = vi.fn();
const setCandidateResolvedTitles = vi.fn();
const upsertServiceState = vi.fn();
const satisfyWaitingIntents = vi.fn();
const updateTitleAvailability = vi.fn();
const updateWatchIntentAvailability = vi.fn();
const applyConfirmedEditions = vi.fn();

vi.mock('../../src/services/batchLifecycle.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/batchLifecycle.js')>();
  return {
    ...actual,
    loadOwnedBatch: (...args: unknown[]) => loadOwnedBatch(...args) as unknown,
    transitionBatch: (...args: unknown[]) => transitionBatch(...args) as unknown,
  };
});

vi.mock('../../src/routes/batchReview.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/routes/batchReview.js')>();
  return {
    ...actual,
    loadReviewCandidates: (...args: unknown[]) => loadReviewCandidates(...args) as unknown,
  };
});

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  const wrap =
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args);
  return {
    ...actual,
    runInTransaction: async (work: (tx: unknown) => Promise<unknown>) => work({}),
    listListedWorkIdentities: wrap(listListedWorkIdentities),
    listWaitingWorkIdentities: wrap(listWaitingWorkIdentities),
    setCandidateDestination: wrap(setCandidateDestination),
    findActiveSuppression: wrap(findActiveSuppression),
    findTitleByWorkIdentity: wrap(findTitleByWorkIdentity),
    createTitle: wrap(createTitle),
    recordBatchChange: wrap(recordBatchChange),
    createWatchIntent: wrap(createWatchIntent),
    listListingsForTitle: wrap(listListingsForTitle),
    createServiceListing: wrap(createServiceListing),
    updateTitle: wrap(updateTitle),
    setCandidateResolvedTitles: wrap(setCandidateResolvedTitles),
    upsertServiceState: wrap(upsertServiceState),
  };
});

vi.mock('../../src/repository/watchIntents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/watchIntents.js')>();
  return {
    ...actual,
    satisfyWaitingIntents: (...args: unknown[]) => satisfyWaitingIntents(...args) as unknown,
    updateTitleAvailability: (...args: unknown[]) => updateTitleAvailability(...args) as unknown,
    updateWatchIntentAvailability: (...args: unknown[]) =>
      updateWatchIntentAvailability(...args) as unknown,
  };
});

vi.mock('../../src/services/titleEditions.js', () => ({
  applyConfirmedEditions: (...args: unknown[]) => applyConfirmedEditions(...args) as unknown,
}));

const { closeBatch } = await import('../../src/services/batchClose.js');
const { AppError } = await import('../../src/errors/AppError.js');

const OWNER = 'owner-auto-close' as Parameters<typeof closeBatch>[0];
const NOW = new Date('2026-10-08T12:00:00.000Z');
const TODAY = new Date('2026-10-08T00:00:00.000Z');
const CHECKED = new Date('2026-10-08T11:00:00.000Z');

const BATCH = {
  id: 'batch-auto',
  status: 'in-review',
  service: null,
  discoverySource: null,
  autoDetect: true,
  mode: 'append-only',
};

function candidate(over: Partial<ReviewCandidate>): ReviewCandidate {
  return {
    candidateId: 'c',
    rawText: 'Dune',
    inferredTitle: 'Dune',
    basis: 'both',
    ocrSupport: 'exact',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 0.97,
    resolvedWorkIdentity: 'tmdb:movie:1',
    match: null,
    alternatives: [],
    sourceImageIds: ['img1'],
    disposition: 'confirmed',
    collapsedIntoCandidateId: null,
    classification: 'new',
    tileCrop: null,
    destination: null,
    serviceLookup: null,
    ...over,
  };
}

function lookup(
  status: 'found' | 'none',
  services: ('netflix' | 'max')[],
): NonNullable<ReviewCandidate['serviceLookup']> {
  return { status, services, checkedAt: CHECKED.toISOString(), stale: false };
}

function lookupRow(
  id: string,
  identity: string,
  over: Partial<{
    serviceLookupStatus: string | null;
    serviceLookupAt: Date | null;
    lookedUpAvailableOn: string | null;
  }> = {},
) {
  return {
    id,
    resolvedWorkIdentity: identity,
    serviceLookupStatus: 'found',
    serviceLookupIdentity: identity,
    serviceLookupAt: CHECKED,
    lookedUpAvailableOn: '["netflix"]',
    lookedUpRentOn: '[]',
    ...over,
  };
}

function load(candidates: ReviewCandidate[], rows: unknown[] = [], suppressed: string[] = []) {
  loadReviewCandidates.mockResolvedValue({
    candidates,
    rows,
    suppressed: new Set(suppressed),
    activeListings: [],
  });
}

let titleSeq = 0;

beforeEach(() => {
  titleSeq = 0;
  loadOwnedBatch.mockResolvedValue(BATCH);
  transitionBatch.mockResolvedValue(undefined);
  listListedWorkIdentities.mockResolvedValue(new Set<string>());
  listWaitingWorkIdentities.mockResolvedValue(new Set<string>());
  setCandidateDestination.mockResolvedValue(undefined);
  findActiveSuppression.mockResolvedValue(null);
  findTitleByWorkIdentity.mockResolvedValue(null);
  createTitle.mockImplementation(async () => {
    titleSeq += 1;
  });
  recordBatchChange.mockResolvedValue(undefined);
  createWatchIntent.mockResolvedValue(undefined);
  listListingsForTitle.mockResolvedValue([]);
  createServiceListing.mockResolvedValue(undefined);
  updateTitle.mockResolvedValue(undefined);
  setCandidateResolvedTitles.mockResolvedValue(undefined);
  satisfyWaitingIntents.mockResolvedValue(undefined);
  updateTitleAvailability.mockResolvedValue(undefined);
  updateWatchIntentAvailability.mockResolvedValue(undefined);
  applyConfirmedEditions.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function refusal(promise: Promise<unknown>): Promise<InstanceType<typeof AppError>> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as InstanceType<typeof AppError>;
}

describe('T-AUTO-015 · specs/api.md §6.22 · the auto-detect close, branch by branch', () => {
  it('T-AUTO-015g: an undecided title refuses with PENDING_ADDITIONS before anything is opened', async () => {
    load([candidate({ candidateId: 'p1', disposition: 'pending' })]);
    const one = await refusal(closeBatch(OWNER, BATCH.id, NOW));
    expect(one.code).toBe('PENDING_ADDITIONS');
    expect(one.message).toBe('1 title still needs a decision.');

    load([
      candidate({ candidateId: 'p1', disposition: 'pending' }),
      candidate({ candidateId: 'p2', disposition: 'pending', resolvedWorkIdentity: 'tmdb:tv:2' }),
    ]);
    const two = await refusal(closeBatch(OWNER, BATCH.id, NOW));
    expect(two.message).toBe('2 titles still need a decision.');
    expect(transitionBatch).not.toHaveBeenCalled();
  });

  it('T-AUTO-015h: a confirmed title with no destination refuses with AUTO_DESTINATION_REQUIRED, naming it', async () => {
    load([candidate({ candidateId: 'm1' })]);
    const one = await refusal(closeBatch(OWNER, BATCH.id, NOW));
    expect(one.code).toBe('AUTO_DESTINATION_REQUIRED');
    expect(one.httpStatus).toBe(409);
    expect(one.details).toMatchObject({ candidateIds: ['m1'] });
    expect(one.message).toMatch(/^1 title still needs/);

    load([
      candidate({ candidateId: 'm1' }),
      candidate({ candidateId: 'm2', resolvedWorkIdentity: 'tmdb:tv:2' }),
    ]);
    const two = await refusal(closeBatch(OWNER, BATCH.id, NOW));
    expect(two.message).toMatch(/^2 titles still need/);
    expect(createTitle).not.toHaveBeenCalled();
  });

  it('T-AUTO-015i: every destination outcome lands in one close, with no ServiceState and no undo', async () => {
    const services = (list: ('netflix' | 'max')[]) => ({
      kind: 'services' as const,
      services: list,
    });
    const waiting = { kind: 'waiting' as const };
    const found = (list: ('netflix' | 'max')[]) => lookup('found', list);
    const none = lookup('none', []);
    load(
      [
        // New work, two looked-up services: a title and two listings.
        candidate({
          candidateId: 'a',
          resolvedWorkIdentity: 'tmdb:movie:1',
          serviceLookup: found(['netflix', 'max']),
          alternatives: [
            {
              tmdbId: 1,
              mediaType: 'movie',
              name: 'Dune',
              releaseYear: 2021,
              posterPath: null,
            } as never,
          ],
        }),
        // A second read of the same work: linked, not doubled.
        candidate({
          candidateId: 'a2',
          resolvedWorkIdentity: 'tmdb:movie:1',
          serviceLookup: found(['netflix']),
        }),
        // Already active on netflix, dated later than today: a no-op listing, re-dated title.
        candidate({
          candidateId: 'b',
          resolvedWorkIdentity: 'tmdb:movie:2',
          serviceLookup: found(['netflix']),
        }),
        // An unidentified title whose old row is removed: a brand-new row.
        candidate({
          candidateId: 'h',
          rawText: 'Mystery',
          resolvedWorkIdentity: null,
          serviceLookup: found(['max']),
          destination: services(['max']),
        }),
        // Waiting, new work, owner's own choice already stored.
        candidate({
          candidateId: 'c',
          resolvedWorkIdentity: 'tmdb:movie:3',
          serviceLookup: none,
          destination: waiting,
        }),
        // The same work again, Waiting: linked to the title just created.
        candidate({
          candidateId: 'c2',
          resolvedWorkIdentity: 'tmdb:movie:3',
          serviceLookup: none,
        }),
        // Waiting, but already in the Library.
        candidate({
          candidateId: 'd',
          resolvedWorkIdentity: 'tmdb:movie:4',
          serviceLookup: none,
        }),
        // Waiting, but already waiting, and no title row found.
        candidate({
          candidateId: 'e',
          resolvedWorkIdentity: 'tmdb:movie:5',
          serviceLookup: none,
        }),
        // Suppressed by work identity inside the transaction.
        candidate({
          candidateId: 'f',
          resolvedWorkIdentity: 'tmdb:movie:6',
          serviceLookup: found(['netflix']),
        }),
        // Waiting, an existing (removed) title reused; streaming elsewhere.
        candidate({
          candidateId: 'i',
          resolvedWorkIdentity: 'tmdb:tv:7',
          serviceLookup: none,
        }),
        // Discarded: needs no destination, writes nothing.
        candidate({
          candidateId: 'x',
          resolvedWorkIdentity: 'tmdb:movie:8',
          disposition: 'discarded',
        }),
      ],
      [
        lookupRow('a', 'tmdb:movie:1'),
        // A failed lookup stores nothing.
        lookupRow('b', 'tmdb:movie:2', { serviceLookupStatus: 'failed' }),
        // A lookup answered for a different work stores nothing.
        { ...lookupRow('c', 'tmdb:movie:999'), resolvedWorkIdentity: 'tmdb:movie:3' },
        // Never looked up.
        lookupRow('d', 'tmdb:movie:4', { serviceLookupAt: null }),
        // Status never written.
        lookupRow('e', 'tmdb:movie:5', { serviceLookupStatus: null }),
        // A gated row counts toward suppressedGated.
        lookupRow('g', 'tmdb:movie:9'),
        // Streaming somewhere, no provider list stored for one, empty list for another.
        lookupRow('i', 'tmdb:tv:7', { lookedUpAvailableOn: '["hulu"]' }),
        lookupRow('h', 'unmatched:not-this-work', { lookedUpAvailableOn: null }),
      ],
      ['tmdb:movie:9'],
    );
    listListedWorkIdentities.mockResolvedValue(new Set(['tmdb:movie:2', 'tmdb:movie:4']));
    listWaitingWorkIdentities.mockResolvedValue(new Set(['tmdb:movie:5']));
    findActiveSuppression.mockImplementation(async (_owner: unknown, identity: unknown) =>
      identity === 'tmdb:movie:6' ? { id: 's1' } : null,
    );
    findTitleByWorkIdentity.mockImplementation(async (_owner: unknown, identity: unknown) => {
      if (identity === 'tmdb:movie:2') {
        return { id: 't-b', state: 'active', sortDateAdded: new Date('2026-10-20') };
      }
      if (identity === 'tmdb:movie:4') return { id: 't-d', state: 'active', sortDateAdded: TODAY };
      if (identity === 'tmdb:tv:7') return { id: 't-i', state: 'removed', sortDateAdded: null };
      if (typeof identity === 'string' && identity.startsWith('unmatched:')) {
        return { id: 't-h-old', state: 'removed', sortDateAdded: null };
      }
      return null;
    });
    const created = new Map<string, { service: string; state: string }[]>([
      [
        't-b',
        [
          { service: 'netflix', state: 'active' },
          { service: 'max', state: 'removed' },
        ],
      ],
    ]);
    createServiceListing.mockImplementation(
      async (_owner: unknown, data: { titleId: string; service: string }) => {
        created.set(data.titleId, [
          ...(created.get(data.titleId) ?? []),
          { service: data.service, state: 'active' },
        ]);
      },
    );
    listListingsForTitle.mockImplementation(
      async (_owner: unknown, titleId: string) => created.get(titleId) ?? [],
    );

    const result = await closeBatch(OWNER, BATCH.id, NOW);

    expect(result.serviceState).toBeNull();
    expect(upsertServiceState).not.toHaveBeenCalled();
    expect(result.undoable).toBe(false);
    expect(result.autoDetect).toEqual({
      titlesListed: 3,
      intentsCreated: 2,
      alreadyOnService: 2,
      alreadyListed: 1,
      alreadyWaiting: 1,
    });
    expect(result.summary).toMatchObject({
      listingsCreated: 3,
      listingsRemoved: 0,
      unresolvedKept: 1,
      discarded: 1,
      suppressedGated: 2,
      removalGroupId: null,
    });
    // New titles: a, h (unmatched, old row removed), c (waiting).
    expect(titleSeq).toBe(3);
    expect(updateTitle).toHaveBeenCalledWith(OWNER, 't-b', { sortDateAdded: TODAY }, {});
    // Only the proposals the owner confirmed are persisted as the applied destination.
    const persisted = setCandidateDestination.mock.calls.map((call) => call[2] as string);
    expect(persisted).not.toContain('c');
    expect(persisted).not.toContain('h');
    expect(persisted).toEqual(expect.arrayContaining(['a', 'b', 'd', 'e', 'f', 'i']));
    // Intents are search-shaped with no source batch.
    expect(createWatchIntent).toHaveBeenCalledTimes(2);
    for (const call of createWatchIntent.mock.calls) {
      expect(call[1]).toMatchObject({ sourceBatchId: null, discoverySource: 'search' });
    }
    // Availability: stored for a (title) and i (intent, streaming), nothing else.
    expect(updateTitleAvailability).toHaveBeenCalledTimes(1);
    expect(updateTitleAvailability.mock.calls[0]?.[2]).toMatchObject({
      availableOn: '["netflix"]',
      availabilityCheckedAt: CHECKED,
    });
    expect(updateWatchIntentAvailability).toHaveBeenCalledTimes(1);
    expect(updateWatchIntentAvailability.mock.calls[0]?.[2]).toMatchObject({
      streamingSince: CHECKED,
    });
    expect(transitionBatch).toHaveBeenCalledTimes(1);
  });

  it('T-AUTO-015j: a services-only close stays undoable, and a no-provider lookup stores no streaming date', async () => {
    load(
      [
        candidate({
          candidateId: 'w',
          resolvedWorkIdentity: 'tmdb:movie:11',
          serviceLookup: lookup('none', []),
        }),
      ],
      [lookupRow('w', 'tmdb:movie:11', { lookedUpAvailableOn: null })],
    );
    const routed = await closeBatch(OWNER, BATCH.id, NOW);
    expect(routed.undoable).toBe(false);
    expect(updateWatchIntentAvailability.mock.calls[0]?.[2]).toMatchObject({
      streamingSince: null,
    });

    load([
      candidate({
        candidateId: 's',
        resolvedWorkIdentity: 'tmdb:movie:12',
        serviceLookup: lookup('found', ['netflix']),
      }),
    ]);
    const listed = await closeBatch(OWNER, BATCH.id, NOW);
    expect(listed.undoable).toBe(true);
    expect(listed.serviceState).toBeNull();
    expect(listed.autoDetect?.titlesListed).toBe(1);
  });
});
