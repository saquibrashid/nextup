/**
 * TASK-064 — `T-CLS-010`, `T-CLS-011`, `T-CLS-012`.
 *
 * `specs/testing.md` US-009:
 *   AC-1 `T-CLS-010` — classification is computed against ACTIVE listings of
 *        the batch's service
 *   AC-2 `T-CLS-011` — a work active on the *other* service only classifies as
 *        `new` for this service
 *   AC-3 `T-CLS-012` — a `removed` listing for this service classifies as
 *        `new` (a new row will be created — L1)
 */

import { describe, expect, it } from 'vitest';

import {
  buildActiveListingIndex,
  classifyCandidates,
  classifyWorkIdentity,
  type ListingSnapshot,
} from '../src/classify.js';

const DUNE = 'tmdb:movie:438631';
const ANDOR = 'tmdb:tv:83867';
const RAW = 'unmatched:9f2b1c4d5e6f7a80';

function listing(
  workIdentity: string,
  service: ListingSnapshot['service'],
  state: ListingSnapshot['state'],
): ListingSnapshot {
  return { workIdentity, service, state };
}

describe('T-CLS-010 — classification is computed against active listings of the batch service', () => {
  it('T-CLS-010a · an active listing on this service is already-present', () => {
    const index = buildActiveListingIndex([listing(DUNE, 'netflix', 'active')]);
    expect(classifyWorkIdentity(DUNE, 'netflix', index)).toBe('already-present-for-this-service');
  });

  it('T-CLS-010b · a work with no listing at all is new', () => {
    const index = buildActiveListingIndex([listing(ANDOR, 'netflix', 'active')]);
    expect(classifyWorkIdentity(DUNE, 'netflix', index)).toBe('new');
  });

  it('T-CLS-010c · an empty index classifies everything as new', () => {
    const index = buildActiveListingIndex([]);
    expect(index.size).toBe(0);
    expect(classifyWorkIdentity(DUNE, 'netflix', index)).toBe('new');
  });

  it('T-CLS-010d · unmatched work identities classify by the same rule, with no branch on prefix', () => {
    const index = buildActiveListingIndex([listing(RAW, 'max', 'active')]);
    expect(classifyWorkIdentity(RAW, 'max', index)).toBe('already-present-for-this-service');
    expect(classifyWorkIdentity(RAW, 'netflix', index)).toBe('new');
  });

  it('T-CLS-010e · removed listings are dropped when the index is built, not at query time', () => {
    const index = buildActiveListingIndex([
      listing(DUNE, 'netflix', 'removed'),
      listing(ANDOR, 'netflix', 'active'),
    ]);
    // Only ANDOR survives — a caller that passes its full listing set cannot
    // accidentally classify against a removed row.
    expect(index.size).toBe(1);
  });

  it('T-CLS-010f · the same work on both services is held as two distinct entries', () => {
    const index = buildActiveListingIndex([
      listing(DUNE, 'netflix', 'active'),
      listing(DUNE, 'max', 'active'),
    ]);
    expect(index.size).toBe(2);
    expect(classifyWorkIdentity(DUNE, 'netflix', index)).toBe('already-present-for-this-service');
    expect(classifyWorkIdentity(DUNE, 'max', index)).toBe('already-present-for-this-service');
  });

  it('T-CLS-010g · an unmatched candidate is not classified at all — never guessed as new', () => {
    const index = buildActiveListingIndex([listing(DUNE, 'netflix', 'active')]);
    expect(classifyWorkIdentity(null, 'netflix', index)).toBeNull();
  });

  it('T-CLS-010h · an empty work identity never matches and is never classified', () => {
    const index = buildActiveListingIndex([listing('', 'netflix', 'active')]);
    expect(index.size).toBe(0);
    expect(classifyWorkIdentity('', 'netflix', index)).toBeNull();
  });
});

describe('T-CLS-011 — a work active on the OTHER service only is new for this service', () => {
  it('T-CLS-011a · active on max only → new for netflix', () => {
    const index = buildActiveListingIndex([listing(DUNE, 'max', 'active')]);
    expect(classifyWorkIdentity(DUNE, 'netflix', index)).toBe('new');
  });

  it('T-CLS-011b · active on netflix only → new for max', () => {
    const index = buildActiveListingIndex([listing(DUNE, 'netflix', 'active')]);
    expect(classifyWorkIdentity(DUNE, 'max', index)).toBe('new');
  });

  it('T-CLS-011c · the two services do not leak into one another across a whole batch', () => {
    const index = buildActiveListingIndex([
      listing(DUNE, 'max', 'active'),
      listing(ANDOR, 'max', 'active'),
    ]);
    const classified = classifyCandidates(
      [
        { candidateId: 'c1', resolvedWorkIdentity: DUNE },
        { candidateId: 'c2', resolvedWorkIdentity: ANDOR },
      ],
      'netflix',
      index,
    );
    expect(classified.map((c) => c.classification)).toEqual(['new', 'new']);
  });
});

describe('T-CLS-012 — a removed listing for THIS service classifies as new (L1)', () => {
  it('T-CLS-012a · removed on this service → new, so a brand-new row is created', () => {
    const index = buildActiveListingIndex([listing(DUNE, 'netflix', 'removed')]);
    expect(classifyWorkIdentity(DUNE, 'netflix', index)).toBe('new');
  });

  it('T-CLS-012b · a removed listing does not shadow an active one for the same work', () => {
    // The reappearance case mid-migration: an old removed row plus a live one.
    const index = buildActiveListingIndex([
      listing(DUNE, 'netflix', 'removed'),
      listing(DUNE, 'netflix', 'active'),
    ]);
    expect(classifyWorkIdentity(DUNE, 'netflix', index)).toBe('already-present-for-this-service');
  });

  it('T-CLS-012c · several historical removed rows for the same work still classify as new', () => {
    // The removed view is a LOG, not a recycle bin (invariant 7), so multiple
    // rows for one work over time are legitimate.
    const index = buildActiveListingIndex([
      listing(DUNE, 'netflix', 'removed'),
      listing(DUNE, 'netflix', 'removed'),
      listing(DUNE, 'netflix', 'removed'),
    ]);
    expect(index.size).toBe(0);
    expect(classifyWorkIdentity(DUNE, 'netflix', index)).toBe('new');
  });

  it('T-CLS-012d · removed here and active on the other service is still new here', () => {
    const index = buildActiveListingIndex([
      listing(DUNE, 'netflix', 'removed'),
      listing(DUNE, 'max', 'active'),
    ]);
    expect(classifyWorkIdentity(DUNE, 'netflix', index)).toBe('new');
  });
});

describe('T-CLS-010 — classifyCandidates preserves the input candidates', () => {
  it('T-CLS-010i · every candidate is returned, in order, with its id intact', () => {
    const index = buildActiveListingIndex([listing(DUNE, 'netflix', 'active')]);
    const classified = classifyCandidates(
      [
        { candidateId: 'c1', resolvedWorkIdentity: DUNE },
        { candidateId: 'c2', resolvedWorkIdentity: ANDOR },
        { candidateId: 'c3', resolvedWorkIdentity: null },
      ],
      'netflix',
      index,
    );
    expect(classified.map((c) => c.candidateId)).toEqual(['c1', 'c2', 'c3']);
    expect(classified.map((c) => c.classification)).toEqual([
      'already-present-for-this-service',
      'new',
      null,
    ]);
  });

  it('T-CLS-010j · extra candidate fields survive classification', () => {
    const index = buildActiveListingIndex([]);
    const [only] = classifyCandidates(
      [{ candidateId: 'c1', resolvedWorkIdentity: DUNE, rawText: 'Dune' }],
      'netflix',
      index,
    );
    expect(only?.rawText).toBe('Dune');
    expect(only?.classification).toBe('new');
  });

  it('T-CLS-010k · the input array is not mutated', () => {
    const index = buildActiveListingIndex([listing(DUNE, 'netflix', 'active')]);
    const input = [{ candidateId: 'c1', resolvedWorkIdentity: DUNE }];
    const frozen = JSON.stringify(input);
    classifyCandidates(input, 'netflix', index);
    expect(JSON.stringify(input)).toBe(frozen);
  });
});
