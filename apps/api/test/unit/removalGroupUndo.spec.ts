/**
 * TASK-090 — `undoRemovalGroup` with the store mocked (`specs/api.md` §6.26,
 * US-017).
 *
 * ⚠ THIS FILE EXISTS BECAUSE CI JOB 4 RUNS `--project unit` ONLY, so a module
 * proven solely by the integration suite scores zero against the
 * `apps/api/src/**` floor. Splitting it out also buys something real: with the
 * store mocked, the ORDER and the ABSENCE of writes are observable, and the
 * two properties that matter most here — that a held-back item is never
 * restored, and that a failed member stops the whole group — become assertions
 * about which calls were issued rather than inferences from a final state.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const findRemovalGroup = vi.fn();
const listListingsInRemovalGroup = vi.fn();
const findActiveSuppressedWorks = vi.fn();
const restoreServiceListing = vi.fn();
const markRemovalGroupUndone = vi.fn();
const listListingsForTitle = vi.fn();
const updateTitle = vi.fn();

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findRemovalGroup: (...args: unknown[]) => findRemovalGroup(...args) as unknown,
    listListingsInRemovalGroup: (...args: unknown[]) =>
      listListingsInRemovalGroup(...args) as unknown,
    findActiveSuppressedWorks: (...args: unknown[]) =>
      findActiveSuppressedWorks(...args) as unknown,
    restoreServiceListing: (...args: unknown[]) => restoreServiceListing(...args) as unknown,
    markRemovalGroupUndone: (...args: unknown[]) => markRemovalGroupUndone(...args) as unknown,
    listListingsForTitle: (...args: unknown[]) => listListingsForTitle(...args) as unknown,
    updateTitle: (...args: unknown[]) => updateTitle(...args) as unknown,
    // Pass-through: what is under test is WHICH writes are issued, not that the
    // store groups them. The integration suite proves the grouping.
    runInTransaction: async (work: (tx: unknown) => Promise<unknown>) => work(undefined),
  };
});

const { undoRemovalGroup, toHeldBack } = await import('../../src/services/removalGroupUndo.js');
const { AppError } = await import('../../src/errors/AppError.js');
const { asOwnerId } = await import('../../src/repository/ownerData.js');

const OWNER = asOwnerId('o_0123456789abcdef');

const member = (
  n: number,
  overrides: {
    workIdentity?: string;
    tmdbName?: string | null;
    rawExtractedText?: string | null;
  } = {},
) => ({
  listingId: `l-${String(n)}`,
  titleId: `t-${String(n)}`,
  service: 'netflix',
  state: 'removed',
  title: {
    workIdentity: overrides.workIdentity ?? `tmdb:movie:${String(100 + n)}`,
    tmdbName: overrides.tmdbName === undefined ? `Film ${String(n)}` : overrides.tmdbName,
    rawExtractedText: overrides.rawExtractedText ?? null,
  },
});

const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
  } catch (error) {
    return error instanceof AppError ? error.code : 'NOT-AN-APP-ERROR';
  }
  return 'NO-ERROR';
};

beforeEach(() => {
  vi.clearAllMocks();
  findRemovalGroup.mockResolvedValue({ id: 'g-1', batchId: 'b-1', undoneAt: null });
  listListingsInRemovalGroup.mockResolvedValue([]);
  findActiveSuppressedWorks.mockResolvedValue(new Set());
  restoreServiceListing.mockResolvedValue({ count: 1 });
  markRemovalGroupUndone.mockResolvedValue({ count: 1 });
  listListingsForTitle.mockResolvedValue([
    { listingId: 'l-1', service: 'netflix', state: 'active', dateAdded: new Date('2026-04-02') },
  ]);
  updateTitle.mockResolvedValue({});
});

describe('undoRemovalGroup', () => {
  it('T-GRP-010e: restores every member and reports their ids', async () => {
    listListingsInRemovalGroup.mockResolvedValue([member(1), member(2)]);

    const result = await undoRemovalGroup(OWNER, 'g-1');

    expect(result).toEqual({
      groupId: 'g-1',
      restoredListingIds: ['l-1', 'l-2'],
      heldBack: [],
    });
    expect(restoreServiceListing).toHaveBeenCalledTimes(2);
  });

  it('T-GRP-010f: never writes dateAdded, state or sortDateAdded onto the LISTING', async () => {
    // `dateAdded` is write-once (REQ-030) and the default sort is built from
    // it. The restore is the one place a stray write would move every restored
    // title to the top of the owner's list without any visible edit.
    listListingsInRemovalGroup.mockResolvedValue([member(1)]);

    await undoRemovalGroup(OWNER, 'g-1');

    // The repository writer takes only (ownerId, listingId, tx) — there is no
    // argument through which a date could travel.
    expect(restoreServiceListing).toHaveBeenCalledWith(OWNER, 'l-1', undefined);
  });

  it('T-GRP-010g: re-derives the title of every listing it restored', async () => {
    listListingsInRemovalGroup.mockResolvedValue([member(1), member(2)]);

    await undoRemovalGroup(OWNER, 'g-1');

    expect(updateTitle.mock.calls.map((call) => call[1])).toEqual(['t-1', 't-2']);
    expect(updateTitle.mock.calls[0]?.[2]).toEqual({
      state: 'active',
      sortDateAdded: new Date('2026-04-02T00:00:00.000Z'),
    });
  });

  it('T-GRP-012e: a suppressed work is held back and NEVER restored', async () => {
    listListingsInRemovalGroup.mockResolvedValue([
      member(1),
      member(2, { workIdentity: 'tmdb:movie:949', tmdbName: 'Heat' }),
    ]);
    findActiveSuppressedWorks.mockResolvedValue(new Set(['tmdb:movie:949']));

    const result = await undoRemovalGroup(OWNER, 'g-1');

    expect(result.restoredListingIds).toEqual(['l-1']);
    expect(result.heldBack).toEqual([
      {
        listingId: 'l-2',
        reason: 'work-suppressed',
        name: 'Heat',
        unsuppressHref: '/api/suppressions/supp%3Atmdb%3Amovie%3A949/unsuppress',
      },
    ]);
    // Not merely absent from the result — never written at all.
    expect(restoreServiceListing).toHaveBeenCalledTimes(1);
    expect(restoreServiceListing).not.toHaveBeenCalledWith(OWNER, 'l-2', undefined);
  });

  it('T-GRP-012f: a held-back title is not re-derived either', async () => {
    // Re-deriving it would recompute `state` from listings none of which
    // changed — harmless today, and a write to a row the owner asked to leave
    // alone.
    listListingsInRemovalGroup.mockResolvedValue([member(1, { workIdentity: 'tmdb:movie:949' })]);
    findActiveSuppressedWorks.mockResolvedValue(new Set(['tmdb:movie:949']));

    await undoRemovalGroup(OWNER, 'g-1');

    expect(updateTitle).not.toHaveBeenCalled();
  });

  it('T-GRP-013c: an already-reversed group is refused before anything is read', async () => {
    findRemovalGroup.mockResolvedValue({
      id: 'g-1',
      batchId: 'b-1',
      undoneAt: new Date('2026-07-14T09:31:02.117Z'),
    });

    expect(await codeOf(() => undoRemovalGroup(OWNER, 'g-1'))).toBe('GROUP_ALREADY_REVERSED');
    expect(listListingsInRemovalGroup).not.toHaveBeenCalled();
    expect(restoreServiceListing).not.toHaveBeenCalled();
  });

  it('T-GRP-013d: losing the race to mark the group reversed aborts the undo', async () => {
    // Both requests read `undoneAt: null` before either wrote. The guarded
    // update is what makes the read-then-check true under a double submit;
    // letting both proceed would double-apply the re-derive.
    listListingsInRemovalGroup.mockResolvedValue([member(1)]);
    markRemovalGroupUndone.mockResolvedValue({ count: 0 });

    expect(await codeOf(() => undoRemovalGroup(OWNER, 'g-1'))).toBe('GROUP_ALREADY_REVERSED');
  });

  it('T-GRP-013e: the group is marked reversed even when every member was held back', async () => {
    listListingsInRemovalGroup.mockResolvedValue([member(1, { workIdentity: 'tmdb:movie:949' })]);
    findActiveSuppressedWorks.mockResolvedValue(new Set(['tmdb:movie:949']));

    const result = await undoRemovalGroup(OWNER, 'g-1');

    expect(result.restoredListingIds).toEqual([]);
    expect(markRemovalGroupUndone).toHaveBeenCalledTimes(1);
  });

  it('T-GRP-014c: a member that is no longer removed stops the whole group', async () => {
    listListingsInRemovalGroup.mockResolvedValue([member(1), member(2), member(3)]);
    restoreServiceListing.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    expect(await codeOf(() => undoRemovalGroup(OWNER, 'g-1'))).toBe('PARTIAL_FAILURE_PREVENTED');
    // Stops at the failure: the third member is never attempted, and the group
    // is never marked reversed. The transaction rolls the first one back.
    expect(restoreServiceListing).toHaveBeenCalledTimes(2);
    expect(markRemovalGroupUndone).not.toHaveBeenCalled();
  });

  it('T-GRP-014d: the failure carries applied:false and names the listing', async () => {
    listListingsInRemovalGroup.mockResolvedValue([member(1)]);
    restoreServiceListing.mockResolvedValue({ count: 0 });

    let thrown: InstanceType<typeof AppError> | undefined;
    try {
      await undoRemovalGroup(OWNER, 'g-1');
    } catch (error) {
      thrown = error as InstanceType<typeof AppError>;
    }

    expect(thrown?.httpStatus).toBe(500);
    expect(thrown?.details).toMatchObject({ groupId: 'g-1', listingId: 'l-1', applied: false });
  });

  it('T-SEC-002i: an unknown or foreign group is a flat 404', async () => {
    findRemovalGroup.mockResolvedValue(null);

    let thrown: InstanceType<typeof AppError> | undefined;
    try {
      await undoRemovalGroup(OWNER, 'g-nope');
    } catch (error) {
      thrown = error as InstanceType<typeof AppError>;
    }

    expect(thrown?.code).toBe('NOT_FOUND');
    expect(thrown?.httpStatus).toBe(404);
  });

  it('T-GRP-010h: a zero-member group succeeds and is still marked reversed', async () => {
    const result = await undoRemovalGroup(OWNER, 'g-1');

    expect(result).toEqual({ groupId: 'g-1', restoredListingIds: [], heldBack: [] });
    expect(markRemovalGroupUndone).toHaveBeenCalledTimes(1);
  });

  it('T-GRP-012g: a held-back unmatched item is named by its extracted text', () => {
    expect(
      toHeldBack({
        listingId: 'l-9',
        titleId: 't-9',
        state: 'removed',
        title: {
          workIdentity: 'unmatched:00000000deadbeef',
          tmdbName: null,
          rawExtractedText: 'Bladerunner 2049',
        },
      }),
    ).toEqual({
      listingId: 'l-9',
      reason: 'work-suppressed',
      name: 'Bladerunner 2049',
      unsuppressHref: '/api/suppressions/supp%3Aunmatched%3A00000000deadbeef/unsuppress',
    });
  });

  it('T-GRP-012h: an item with neither name renders empty, never a placeholder', () => {
    // A placeholder would tell the owner a title was held back and give them no
    // way to know which one.
    expect(
      toHeldBack({
        listingId: 'l-9',
        titleId: 't-9',
        state: 'removed',
        title: { workIdentity: 'tmdb:movie:949', tmdbName: null, rawExtractedText: null },
      }).name,
    ).toBe('');
  });
});
