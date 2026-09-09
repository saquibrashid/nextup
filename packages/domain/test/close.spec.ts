/**
 * TASK-071 — the pure close grammar (`packages/domain/src/close.ts`).
 *
 * These are the cases that decide whether the list is written correctly, and
 * every one of them is expressible without a database. The integration suite
 * (`apps/api/test/integration/batchClose.spec.ts`) then proves the writes
 * themselves; it does not re-prove the rules.
 */

import { describe, expect, it } from 'vitest';

import {
  CLOSE_DECIDABLE_SECTIONS,
  applicableCandidates,
  discardedCount,
  discardedWorks,
  pendingAdditionIds,
  sectionForCandidate,
  type ReviewCandidate,
  type ReviewSectionName,
} from '../src/index.js';

const DUNE = 'tmdb:movie:438631';

function candidate(over: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    candidateId: over.candidateId ?? 'c1',
    rawText: 'Dune',
    inferredTitle: 'Dune',
    basis: 'both',
    ocrSupport: 'exact',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 0.97,
    resolvedWorkIdentity: DUNE,
    match: null,
    alternatives: [],
    sourceImageIds: ['img1'],
    disposition: 'pending',
    collapsedIntoCandidateId: null,
    classification: 'new',
    tileCrop: null,
    ...over,
  };
}

/** A candidate guaranteed to land in `section`, whatever the routing rules are. */
function inSection(section: ReviewSectionName, over: Partial<ReviewCandidate> = {}) {
  const base: Record<ReviewSectionName, Partial<ReviewCandidate>> = {
    additions: { classification: 'new' },
    unmatched: { resolvedWorkIdentity: 'unmatched:0123456789abcdef', classification: null },
    alreadyOnYourList: { classification: 'already-present-for-this-service' },
    probablyNotTitles: { verdict: 'chrome-suspected' },
    unreadableTiles: { verdict: 'unreadable-tile' },
  };
  const built = candidate({ ...base[section], ...over });
  // The fixture is only useful if it really does route where it claims.
  expect(sectionForCandidate(built), `fixture for ${section} routed elsewhere`).toBe(section);
  return built;
}

describe('T-REV-012 · US-012 AC-3 · close applies only decided additions', () => {
  it('T-REV-012a: a pending addition blocks, and is reported by id', () => {
    const rows = [
      inSection('additions', { candidateId: 'a', disposition: 'confirmed' }),
      inSection('additions', { candidateId: 'b' }),
    ];
    expect(pendingAdditionIds(rows)).toEqual(['b']);
  });

  it('T-REV-012b: a pending UNMATCHED item blocks too — US-008 is a decision, not a default', () => {
    // The keep-anyway path. If `unmatched` did not block, closing would
    // silently drop every title TMDB could not identify, which is the exact
    // "no accept by inaction" failure REQ-014 forbids, inverted.
    const rows = [inSection('unmatched', { candidateId: 'u' })];
    expect(pendingAdditionIds(rows)).toEqual(['u']);
  });

  it('T-REV-012c: the ids are in review order, so "the first pending card" agrees', () => {
    // `specs/ux-states.md` §6.14 scrolls to and focuses the FIRST id. If this
    // list were sorted or set-deduplicated, the client would focus a card
    // other than the first one the owner would scroll to.
    const rows = [
      inSection('additions', { candidateId: 'z' }),
      inSection('additions', { candidateId: 'a' }),
      inSection('unmatched', { candidateId: 'm' }),
    ];
    expect(pendingAdditionIds(rows)).toEqual(['z', 'a', 'm']);
  });

  it('T-REV-012d: an already-known item never blocks, however many there are', () => {
    // US-013 AC-2: "already on your list" is READ-ONLY. A full-update review
    // of a 200-title list would be unclosable if these blocked, and the owner
    // would have no control to clear them with.
    const rows = Array.from({ length: 50 }, (_, i) =>
      inSection('alreadyOnYourList', { candidateId: `k${String(i)}` }),
    );
    expect(pendingAdditionIds(rows)).toEqual([]);
    expect(applicableCandidates(rows)).toEqual([]);
  });

  it('T-REV-012e: a collapsed-by-default section never blocks', () => {
    // Blocking on a row the owner has not been shown is unresolvable from the
    // UI. REQ-012 requires these classified and surfaced, not dispositioned.
    const rows = [
      inSection('probablyNotTitles', { candidateId: 'p' }),
      inSection('unreadableTiles', { candidateId: 'r' }),
    ];
    expect(pendingAdditionIds(rows)).toEqual([]);
  });

  it('T-REV-012f: an SD-02 collapsed loser never blocks', () => {
    // It is absorbed into the survivor and never rendered, so it can never
    // leave `pending`. Counting it makes every batch with a duplicate tile
    // permanently unclosable.
    const rows = [
      inSection('additions', { candidateId: 'winner', disposition: 'confirmed' }),
      inSection('additions', { candidateId: 'loser', collapsedIntoCandidateId: 'winner' }),
    ];
    expect(pendingAdditionIds(rows)).toEqual([]);
    expect(applicableCandidates(rows).map((a) => a.candidate.candidateId)).toEqual(['winner']);
  });

  it('T-REV-012g: only confirmed and corrected are applied', () => {
    const rows = [
      inSection('additions', { candidateId: 'c', disposition: 'confirmed' }),
      inSection('additions', { candidateId: 'x', disposition: 'corrected' }),
      inSection('additions', { candidateId: 'd', disposition: 'discarded' }),
    ];
    expect(applicableCandidates(rows).map((a) => a.candidate.candidateId)).toEqual(['c', 'x']);
  });

  it('T-REV-012h: a discarded item is applied as NOTHING, but is still counted', () => {
    // REQ-012 forbids deleting the row, so the discard survives in the batch.
    // The summary reports it so "we read 30 things and added 5" is legible.
    const rows = [inSection('additions', { candidateId: 'd', disposition: 'discarded' })];
    expect(applicableCandidates(rows)).toEqual([]);
    expect(discardedCount(rows)).toBe(1);
  });

  it('T-REV-012i: discards are counted across EVERY section, not just the decidable two', () => {
    const rows = [
      inSection('additions', { candidateId: 'd1', disposition: 'discarded' }),
      inSection('probablyNotTitles', { candidateId: 'd2', disposition: 'discarded' }),
      inSection('unreadableTiles', { candidateId: 'd3', disposition: 'discarded' }),
    ];
    expect(discardedCount(rows)).toBe(3);
  });

  it('T-REV-012j: a collapsed loser is not counted as a discard either', () => {
    const rows = [
      inSection('additions', {
        candidateId: 'loser',
        disposition: 'discarded',
        collapsedIntoCandidateId: 'winner',
      }),
    ];
    expect(discardedCount(rows)).toBe(0);
  });

  it('T-REV-012k: an unmatched confirmation is applied as unresolved, not as a match', () => {
    // The two kinds write different title rows, and the database enforces the
    // difference (`title_match_coherent`). Getting the kind wrong is reported
    // by Prisma as a FOREIGN KEY error, so it must be decided here where it
    // is legible.
    const rows = [
      inSection('unmatched', { candidateId: 'u', disposition: 'confirmed' }),
      inSection('additions', { candidateId: 'a', disposition: 'confirmed' }),
    ];
    expect(applicableCandidates(rows)).toEqual([
      { candidate: rows[0], kind: 'unresolved' },
      { candidate: rows[1], kind: 'addition' },
    ]);
  });

  it('T-REV-012l: the decidable sections are exactly additions and unmatched', () => {
    // Pinned as a list rather than implied by the cases above: widening it is
    // a one-word edit that would make close block on read-only rows, and
    // narrowing it would make close silently drop confirmed additions.
    expect([...CLOSE_DECIDABLE_SECTIONS]).toEqual(['additions', 'unmatched']);
  });

  it('T-REV-012m: an empty review closes — nothing pending, nothing applied', () => {
    expect(pendingAdditionIds([])).toEqual([]);
    expect(applicableCandidates([])).toEqual([]);
    expect(discardedCount([])).toBe(0);
  });
});

describe('T-REV-011 · the disposition set close reads', () => {
  it('T-REV-011az: every disposition is either blocking, applied or ignored — none is unhandled', () => {
    // The exhaustiveness guard. A new `ReviewDisposition` added later without
    // a rule here would otherwise fall silently into "ignored", which for an
    // addition means the owner's decision is discarded without a trace.
    const dispositions = ['pending', 'confirmed', 'corrected', 'discarded'] as const;
    for (const disposition of dispositions) {
      const rows = [inSection('additions', { candidateId: 'c', disposition })];
      const blocks = pendingAdditionIds(rows).length > 0;
      const applies = applicableCandidates(rows).length > 0;
      const discards = discardedCount(rows) > 0;
      expect([blocks, applies, discards].filter(Boolean), disposition).toHaveLength(1);
    }
  });
});

describe('T-WAIT-006 · US-041 AC-2 · which discards become suppressions', () => {
  /**
   * The pure half of discard-suppresses. The behavioural claims (AC-3's "not
   * present at all on the next capture", AC-5's Netflix scoping) are proven in
   * `apps/api/test/integration/discoveryCurate.spec.ts`, because they are
   * claims about what the STORE does across two requests.
   */
  it('T-WAIT-006d: a discarded candidate yields its canonical work identity, never its row id', () => {
    // REQ-071, product invariant 1. Keying on the row id would appear to work
    // and then silently stop, because a reappearing title is a NEW row.
    const works = discardedWorks([
      inSection('additions', { candidateId: 'a', disposition: 'discarded' }),
    ]);
    expect(works).toHaveLength(1);
    expect(works[0]?.workIdentity).toBe(DUNE);
    expect(works[0]?.workIdentity).not.toBe('a');
  });

  it('T-WAIT-006e: confirmed and pending candidates yield nothing', () => {
    expect(
      discardedWorks([
        inSection('additions', { candidateId: 'a', disposition: 'confirmed' }),
        inSection('additions', { candidateId: 'b', disposition: 'pending' }),
        inSection('additions', { candidateId: 'c', disposition: 'corrected' }),
      ]),
    ).toEqual([]);
  });

  it('T-WAIT-006f: a discard is collected from EVERY section, not just the decidable two', () => {
    // A rotating editorial feed re-presents its junk tiles exactly as
    // faithfully as its additions (AC-4), so curating the pass has to reach
    // the collapsed sections too.
    const works = discardedWorks([
      inSection('probablyNotTitles', { candidateId: 'a', disposition: 'discarded' }),
      inSection('unreadableTiles', {
        candidateId: 'b',
        disposition: 'discarded',
        resolvedWorkIdentity: 'tmdb:tv:83867',
      }),
    ]);
    expect(works.map((w) => w.candidateId)).toEqual(['a', 'b']);
  });

  it('T-WAIT-006g: a candidate with NO resolved identity yields nothing', () => {
    // ⚠ Deliberate, not an oversight. The review suppression gate skips rows
    // whose `resolvedWorkIdentity` is null, so a suppression written for an
    // `unmatched:` identity could never gate anything — it would be a write
    // with no effect that also fills the "Not interested" view with junk.
    expect(
      discardedWorks([
        inSection('unmatched', {
          candidateId: 'a',
          disposition: 'discarded',
          resolvedWorkIdentity: null,
        }),
      ]),
    ).toEqual([]);
  });

  it('T-WAIT-006h: a collapsed loser (SD-02) yields nothing', () => {
    // It was absorbed into the survivor and never rendered, so nobody
    // discarded it — its `disposition` is an artefact, not a decision.
    expect(
      discardedWorks([
        candidate({ candidateId: 'a', disposition: 'discarded', collapsedIntoCandidateId: 'b' }),
      ]),
    ).toEqual([]);
  });

  it('T-WAIT-006i: two tiles for the same work are ONE suppression', () => {
    // `suppression_one_active` is a filtered unique index; writing twice in
    // one close would fail the whole batch on a duplicate the owner cannot
    // see and cannot fix.
    const works = discardedWorks([
      inSection('additions', { candidateId: 'a', disposition: 'discarded' }),
      inSection('additions', { candidateId: 'b', disposition: 'discarded' }),
    ]);
    expect(works).toHaveLength(1);
  });

  it('T-WAIT-006j: the display snapshot is frozen so the suppressed view needs no title row', () => {
    // US-029 AC-1 — the work may have no `Title` at all, and a discovery
    // discard NEVER creates one, so this is the only description that exists.
    const works = discardedWorks([
      inSection('additions', {
        candidateId: 'a',
        disposition: 'discarded',
        match: {
          tmdbId: 438631,
          mediaType: 'movie',
          name: 'Dune',
          releaseYear: 2021,
          posterPath: '/d.jpg',
          score: 1,
          uncertain: false,
          ambiguous: false,
        },
      }),
    ]);
    expect(works[0]).toMatchObject({
      displayName: 'Dune',
      displayReleaseYear: 2021,
      displayMediaType: 'movie',
      displayPosterPath: '/d.jpg',
    });
  });

  it('T-WAIT-006k: with no match, the name falls back to what was read', () => {
    const works = discardedWorks([
      inSection('additions', {
        candidateId: 'a',
        disposition: 'discarded',
        match: null,
        inferredTitle: null,
        rawText: 'DUNE PART TWO',
      }),
    ]);
    expect(works[0]?.displayName).toBe('DUNE PART TWO');
    expect(works[0]?.displayReleaseYear).toBeNull();
  });
});
