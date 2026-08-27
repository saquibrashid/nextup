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
