/**
 * `T-UNDO-001` — `isCreatesOnly` is a pure predicate over provenance, and undo
 * is offered only when it is true (US-032 AC-1, SD-03,
 * `specs/data-model.md` §8.3).
 *
 * ⚠ WHY A PURE-DATA TEST IS THE RIGHT LEVEL HERE. `undoable` is reported from
 * three places — close (`specs/api.md` §6.22), the batch history view, and the
 * undo route's own admission gate. An integration test proves one of them; a
 * data test proves the answer they all read. The failure this guards is not a
 * wrong badge, it is an undo offering itself for a batch it cannot correctly
 * reverse.
 */

import { describe, expect, it } from 'vitest';

import {
  createsOnlyRefusalReason,
  detectLaterOwnerEdits,
  isCreatesOnly,
  planCreatesOnlyUndo,
  toBatchProvenance,
  type BatchProvenance,
} from '@nextup/domain';

function provenance(partial: Partial<BatchProvenance> = {}): BatchProvenance {
  return { created: [], modified: [], removed: [], ...partial };
}

describe('T-UNDO-001 isCreatesOnly is a pure predicate over provenance', () => {
  it('T-UNDO-001a: a batch that only created is creates-only', () => {
    expect(
      isCreatesOnly(
        provenance({
          created: [{ titleId: 't1', listingId: 'l1', titleWasCreated: true }],
        }),
      ),
    ).toBe(true);
  });

  it('T-UNDO-001b: a batch that created NOTHING is still creates-only (US-032 AC-5)', () => {
    // The no-op undo. Defining the predicate as `created.length > 0` would
    // refuse the one batch that is trivially safe to reverse, and the button
    // would vanish for it — which reads to the owner as a bug.
    expect(isCreatesOnly(provenance())).toBe(true);
  });

  it('T-UNDO-001c: a batch that modified anything is NOT creates-only', () => {
    expect(
      isCreatesOnly(
        provenance({
          created: [{ titleId: 't1', listingId: 'l1', titleWasCreated: true }],
          modified: [{ titleId: 't2', attr: 'workIdentity', before: 'tmdb:tv:1', after: null }],
        }),
      ),
    ).toBe(false);
  });

  it('T-UNDO-001d: a batch that removed anything is NOT creates-only', () => {
    expect(
      isCreatesOnly(
        provenance({
          removed: [{ titleId: 't3', listingId: 'l3', beforeState: 'active', groupId: 'g1' }],
        }),
      ),
    ).toBe(false);
  });

  it('T-UNDO-001e: the predicate is pure — it does not mutate its input', () => {
    const input = provenance({
      created: [{ titleId: 't1', listingId: 'l1', titleWasCreated: true }],
    });
    const before = JSON.stringify(input);
    isCreatesOnly(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('T-UNDO-001f: it reads provenance as STORED, not as re-derived from rows', () => {
    // The whole point of TASK-074: a batch closed with provenance recorded can
    // be judged tomorrow. Fold real `batch_change` rows and ask the predicate.
    const creates = toBatchProvenance([
      {
        kind: 'title_created',
        titleId: 't1',
        listingId: null,
        attr: null,
        prevValue: null,
        nextValue: null,
      },
      {
        kind: 'listing_added',
        titleId: 't1',
        listingId: 'l1',
        attr: null,
        prevValue: null,
        nextValue: null,
      },
    ]);
    expect(isCreatesOnly(creates)).toBe(true);

    const withRemoval = toBatchProvenance([
      {
        kind: 'listing_added',
        titleId: 't1',
        listingId: 'l1',
        attr: null,
        prevValue: null,
        nextValue: null,
      },
      {
        kind: 'listing_removed',
        titleId: 't9',
        listingId: 'l9',
        attr: null,
        prevValue: null,
        nextValue: '"g1"',
      },
    ]);
    expect(isCreatesOnly(withRemoval)).toBe(false);
  });
});

describe('T-UNDO-001 the refusal reason', () => {
  it('T-UNDO-001g: creates-only yields no reason', () => {
    expect(createsOnlyRefusalReason(provenance())).toBeNull();
  });

  it('T-UNDO-001h: modified-or-removed is the §8.4 reason string, exactly', () => {
    expect(
      createsOnlyRefusalReason(
        provenance({
          modified: [{ titleId: 't2', attr: 'name', before: 'a', after: 'b' }],
        }),
      ),
    ).toBe('modified-or-removed');
  });

  it('T-UNDO-001i: missing provenance is provenance-unavailable, not creates-only', () => {
    // US-033 AC-7. Failing OPEN here would undo a batch whose record of what it
    // did is gone — the one case where undo cannot possibly be correct.
    expect(createsOnlyRefusalReason(null)).toBe('provenance-unavailable');
  });
});

describe('T-UNDO-001 planCreatesOnlyUndo splits the two reversal shapes', () => {
  it('T-UNDO-001j: a created title is DISCARDED and never re-derived', () => {
    const plan = planCreatesOnlyUndo(
      provenance({ created: [{ titleId: 't1', listingId: 'l1', titleWasCreated: true }] }),
    );
    expect(plan.titleIdsToDiscard).toEqual(['t1']);
    // Its listing goes with it via the cascade — naming it too would issue a
    // delete for a row that is already gone.
    expect(plan.listingIdsToDiscard).toEqual([]);
    expect(plan.titleIdsToRederive).toEqual([]);
  });

  it('T-UNDO-001k: a listing added to a PRE-EXISTING title is spliced, title survives', () => {
    const plan = planCreatesOnlyUndo(
      provenance({ created: [{ titleId: 't2', listingId: 'l2', titleWasCreated: false }] }),
    );
    expect(plan.titleIdsToDiscard).toEqual([]);
    expect(plan.listingIdsToDiscard).toEqual(['l2']);
    expect(plan.titleIdsToRederive).toEqual(['t2']);
  });

  it('T-UNDO-001l: titleWasCreated is authoritative, not inferred from the listing', () => {
    // Both entries carry a listingId; only the flag distinguishes them. If the
    // plan ever inferred "created" from anything else — say, from the title
    // having exactly one listing — a work that gained a second service after
    // the batch would be discarded whole instead of spliced.
    const plan = planCreatesOnlyUndo(
      provenance({
        created: [
          { titleId: 't1', listingId: 'l1', titleWasCreated: true },
          { titleId: 't2', listingId: 'l2', titleWasCreated: false },
        ],
      }),
    );
    expect(plan.titleIdsToDiscard).toEqual(['t1']);
    expect(plan.listingIdsToDiscard).toEqual(['l2']);
    expect(plan.titleIdsToRederive).toEqual(['t2']);
  });

  it('T-UNDO-001m: a title both created and extended discards once and re-derives never', () => {
    const plan = planCreatesOnlyUndo(
      provenance({
        created: [
          { titleId: 't1', listingId: 'l1', titleWasCreated: true },
          { titleId: 't1', listingId: 'l2', titleWasCreated: false },
        ],
      }),
    );
    expect(plan.titleIdsToDiscard).toEqual(['t1']);
    // Neither: the cascade takes l2, and re-deriving a discarded title would
    // read zero listings and throw the I-3 RangeError inside the transaction.
    expect(plan.listingIdsToDiscard).toEqual([]);
    expect(plan.titleIdsToRederive).toEqual([]);
  });

  it('T-UNDO-001n: an empty provenance plans nothing at all', () => {
    const plan = planCreatesOnlyUndo(provenance());
    expect(plan.titleIdsToDiscard).toEqual([]);
    expect(plan.listingIdsToDiscard).toEqual([]);
    expect(plan.titleIdsToRederive).toEqual([]);
  });
});

/**
 * `T-UNDO-013` — `detectLaterOwnerEdits` is a pure function over the CURRENT
 * rows (US-032 AC-4, TASK-113).
 *
 * ⚠ **WHY THIS CANNOT BE A PROVENANCE PREDICATE.** Suppress and un-suppress
 * write no `batch_change` row at all (US-031 AC-5, `T-PROV-013`) and fix-match
 * is an out-of-batch edit, so `isCreatesOnly` returns true for a batch whose
 * created titles the owner has since re-decided. SD-03 then DISCARDS those
 * rows outright — a hard delete of a decision the batch never recorded and
 * cannot put back. The refusal is the only safe answer.
 */
describe('T-UNDO-013 · detectLaterOwnerEdits', () => {
  function input(
    over: Partial<{
      created: { titleId: string }[];
      current: [string, string][];
      resolved: string[];
      suppressed: string[];
    }> = {},
  ) {
    return {
      created: over.created ?? [{ titleId: 't1' }],
      currentIdentityByTitleId: new Map(over.current ?? [['t1', 'tmdb:movie:1']]),
      identitiesResolvedByBatch: new Set(over.resolved ?? ['tmdb:movie:1']),
      suppressedWorks: new Set(over.suppressed ?? []),
    };
  }

  it('T-UNDO-013a: an untouched created title is not an edit', () => {
    expect(detectLaterOwnerEdits(input())).toEqual([]);
  });

  it('T-UNDO-013b: an active suppression on a created work is a later edit', () => {
    // Sound WITHOUT a timestamp: a suppressed work is filtered out before any
    // Title is created (REQ-071), so the suppression can only postdate the batch.
    expect(detectLaterOwnerEdits(input({ suppressed: ['tmdb:movie:1'] }))).toEqual([
      { titleId: 't1', edit: 'suppressed' },
    ]);
  });

  it('T-UNDO-013c: an identity that MOVED since close is a fix-match', () => {
    expect(detectLaterOwnerEdits(input({ current: [['t1', 'tmdb:movie:99']] }))).toEqual([
      { titleId: 't1', edit: 'fix-matched' },
    ]);
  });

  it('T-UNDO-013d: when both apply it reports fix-matched ONCE, not two edits', () => {
    // The suppression against the moved identity is the one fix-match migrated
    // (SD-06, TASK-110); reporting both describes one owner action as two.
    const edits = detectLaterOwnerEdits(
      input({ current: [['t1', 'tmdb:movie:99']], suppressed: ['tmdb:movie:99'] }),
    );
    expect(edits).toEqual([{ titleId: 't1', edit: 'fix-matched' }]);
  });

  it('T-UNDO-013e: a suppression on a work this batch did NOT create is ignored', () => {
    expect(detectLaterOwnerEdits(input({ suppressed: ['tmdb:movie:2'] }))).toEqual([]);
  });

  it('T-UNDO-013f: a title with no CURRENT identity is not an edit', () => {
    // It is gone or unreadable — reported via `currentState`. Refusing an undo
    // on the strength of a failed read would strand the owner.
    expect(detectLaterOwnerEdits(input({ current: [] }))).toEqual([]);
  });

  it('T-UNDO-013g: an EMPTY resolved set is judged on suppression alone', () => {
    // ⚠ Missing or unreadable candidate rows are NOT evidence of a move.
    // Treating them as one refuses every undo whose candidates are incomplete.
    expect(detectLaterOwnerEdits(input({ resolved: [] }))).toEqual([]);
    expect(detectLaterOwnerEdits(input({ resolved: [], suppressed: ['tmdb:movie:1'] }))).toEqual([
      { titleId: 't1', edit: 'suppressed' },
    ]);
  });

  it('T-UNDO-013k: a move onto an identity the batch ALSO resolved is not reported', () => {
    // ⚠ A KNOWN, DELIBERATE LIMIT, and it is unreachable in practice: the
    // work-identity unique index refuses a fix-match onto an identity another
    // CONFIRMED candidate of the batch already holds a title for, and the
    // service therefore builds the set from confirmed candidates only.
    expect(
      detectLaterOwnerEdits(
        input({ current: [['t1', 'tmdb:movie:2']], resolved: ['tmdb:movie:1', 'tmdb:movie:2'] }),
      ),
    ).toEqual([]);
  });

  it('T-UNDO-013h: a title created twice in one provenance is reported once', () => {
    // SD-02 collapses duplicate reads onto one title, so `created` can repeat.
    const edits = detectLaterOwnerEdits(
      input({ created: [{ titleId: 't1' }, { titleId: 't1' }], suppressed: ['tmdb:movie:1'] }),
    );
    expect(edits).toEqual([{ titleId: 't1', edit: 'suppressed' }]);
  });

  it('T-UNDO-013i: every edited title is reported, in created order', () => {
    const edits = detectLaterOwnerEdits(
      input({
        created: [{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }],
        current: [
          ['t1', 'tmdb:movie:1'],
          ['t2', 'tmdb:movie:22'],
          ['t3', 'tmdb:movie:3'],
        ],
        resolved: ['tmdb:movie:1', 'tmdb:movie:2', 'tmdb:movie:3'],
        suppressed: ['tmdb:movie:3'],
      }),
    );
    expect(edits).toEqual([
      { titleId: 't2', edit: 'fix-matched' },
      { titleId: 't3', edit: 'suppressed' },
    ]);
  });

  it('T-UNDO-013j: a batch that created nothing has nothing to refuse', () => {
    expect(detectLaterOwnerEdits(input({ created: [] }))).toEqual([]);
  });
});
