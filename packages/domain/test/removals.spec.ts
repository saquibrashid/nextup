/**
 * TASK-083 — `computeRemovals` (US-014, REQ-015 / REQ-019 / REQ-073).
 *
 * Every rule here decides whether the app proposes taking something OFF the
 * owner's list. Before this file each one was reachable only through a
 * database and an HTTP round trip; the three exclusions are safety rules, and
 * a safety rule that is expensive to assert gets asserted thinly.
 *
 * Integration keeps the wired halves (`T-REM-010a`, `T-REM-013a`,
 * `T-SUP-004a`); these are the same properties driven directly.
 */

import { describe, expect, it } from 'vitest';

import { computeRemovals, type RemovalCandidateListing } from '../src/removals.js';

const DUNE = 'tmdb:movie:438631';
const HEAT = 'tmdb:movie:949';

function listing(over: Partial<RemovalCandidateListing> = {}): RemovalCandidateListing {
  return {
    listingId: over.listingId ?? 'listing-1',
    titleId: over.titleId ?? 'title-1',
    workIdentity: over.workIdentity ?? HEAT,
    state: over.state ?? 'active',
    service: over.service ?? 'netflix',
    tmdbName: over.tmdbName === undefined ? 'Heat' : over.tmdbName,
    rawExtractedText: over.rawExtractedText === undefined ? null : over.rawExtractedText,
    releaseYear: over.releaseYear === undefined ? 1995 : over.releaseYear,
    posterPath: over.posterPath === undefined ? '/heat.jpg' : over.posterPath,
    dateAdded: over.dateAdded ?? '2024-01-02',
  };
}

function run(
  listings: RemovalCandidateListing[],
  extracted: string[] = [],
  suppressed: string[] = [],
  service: 'netflix' | 'max' = 'netflix',
) {
  return computeRemovals({
    service,
    activeListings: listings,
    extractedWorkIdentities: new Set(extracted),
    suppressed: new Set(suppressed),
  });
}

describe('T-REM-010 · full-update removals are the service-scoped set difference', () => {
  it('T-REM-010b · an active listing no candidate resolved to is proposed for removal', () => {
    const out = run([listing()], [DUNE]);
    expect(out.map((r) => r.listingId)).toEqual(['listing-1']);
    expect(out[0]?.name).toBe('Heat');
  });

  it('T-REM-010c · an extracted listing is NOT proposed', () => {
    // The accepting half. Without it, a function returning [] unconditionally
    // passes every exclusion test in this file.
    expect(run([listing()], [HEAT])).toEqual([]);
  });

  it('T-REM-010d · a listing on ANOTHER service is out of scope entirely', () => {
    // A Netflix screenshot is evidence about Netflix. Nothing in it says a
    // title left Max, and proposing so would empty the other service on the
    // owner's first full-update.
    expect(run([listing({ service: 'max' })], [], [], 'netflix')).toEqual([]);
  });

  it('T-REM-010e · scope is checked per listing, not per batch', () => {
    const out = run(
      [
        listing({ listingId: 'nf', service: 'netflix' }),
        listing({ listingId: 'mx', service: 'max' }),
      ],
      [],
    );
    expect(out.map((r) => r.listingId)).toEqual(['nf']);
  });

  it('T-REM-010f · the extracted set is matched on work identity, not on name', () => {
    // Two works can share a name; one work can be named two ways across a
    // rename. Identity is the only thing that survives both.
    const out = run([listing({ workIdentity: HEAT, tmdbName: 'Dune' })], [DUNE]);
    expect(out).toHaveLength(1);
  });

  it('T-REM-010g · input order is preserved so the owner sees the same list twice', () => {
    const out = run(
      [
        listing({ listingId: 'a', workIdentity: 'tmdb:movie:1' }),
        listing({ listingId: 'b', workIdentity: 'tmdb:movie:2' }),
        listing({ listingId: 'c', workIdentity: 'tmdb:movie:3' }),
      ],
      [],
    );
    expect(out.map((r) => r.listingId)).toEqual(['a', 'b', 'c']);
  });

  it('T-REM-010h · nothing is ticked here — REQ-055 belongs to the response builder', () => {
    // If this module set `ticked`, two places would own the default and only
    // one of them is tested for it.
    expect(run([listing()], [])[0]).not.toHaveProperty('ticked');
  });

  it('T-UNM-011c · an unmatched title falls back to its raw text, never to an empty name', () => {
    // An anonymous row is a row the owner can tick without knowing what they
    // are removing.
    const out = run(
      [listing({ tmdbName: null, rawExtractedText: 'The Bear', workIdentity: 'unmatched:x' })],
      [],
    );
    expect(out[0]?.name).toBe('The Bear');
  });
});

describe('T-REM-013 · an already-removed listing is never proposed again', () => {
  it('T-REM-013b · a `removed` listing is excluded even when nothing extracted it', () => {
    // It already disappeared. Proposing it again lets a second full-update
    // re-remove a listing the owner restored in between.
    expect(run([listing({ state: 'removed' })], [])).toEqual([]);
  });

  it('T-REM-013c · the guard is a positive `active` test, not a `!== removed` test', () => {
    // A state added later (or a relaxed repository read) must be refused by
    // default rather than admitted by omission.
    expect(run([listing({ state: 'archived' })], [])).toEqual([]);
    expect(run([listing({ state: '' })], [])).toEqual([]);
  });
});

describe('T-SUP-004 · a suppressed work is excluded from the removal set (REQ-073)', () => {
  it('T-SUP-004b · a suppressed work holding an active listing is not proposed', () => {
    // The owner said "not interested". Asking about it on every full-update
    // batch is the app arguing with them.
    expect(run([listing()], [], [HEAT])).toEqual([]);
  });

  it('T-SUP-004c · suppression is keyed on identity with no branch on the prefix', () => {
    // REQ-071, product invariant 1. `unmatched:` identities suppress exactly
    // like `tmdb:` ones.
    expect(run([listing({ workIdentity: 'unmatched:abc' })], [], ['unmatched:abc'])).toEqual([]);
  });

  it('T-SUP-004d · suppressing one work leaves the others proposable', () => {
    const out = run(
      [
        listing({ listingId: 'a', workIdentity: HEAT }),
        listing({ listingId: 'b', workIdentity: DUNE }),
      ],
      [],
      [HEAT],
    );
    expect(out.map((r) => r.listingId)).toEqual(['b']);
  });
});
