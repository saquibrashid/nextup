/**
 * Stage 3 in the pipeline — the integration halves of `T-AI-007` (collapse)
 * and `T-AI-017` (TMDB outage), asserted over `resolveCandidates` with ports.
 *
 * ⚠ **WHY THESE CASES EXIST.** `collapseOverlap` and `matchCandidate` were both
 * merged, unit-tested and CALLED BY NOTHING. Every candidate reached the review
 * pass with `resolvedWorkIdentity = null`, so the product identified no title
 * at all, and `specs/testing.md` recorded `T-AI-017` as unimplemented for
 * exactly that reason (`apps/api/test/unit/clients/tmdbSearchRoute.spec.ts`
 * declines the id and says so). Unit-testing each module separately could never
 * have caught this: both suites passed throughout.
 *
 * These are the ORDERING and DEGRADATION properties, which only exist once the
 * modules are composed. The scoring rules themselves stay in
 * `packages/domain/test/tmdbMatcher.spec.ts` and the collapse rules in
 * `overlap.spec.ts`; re-asserting them here would duplicate coverage rather
 * than add any.
 */

import { describe, expect, it } from 'vitest';

import {
  resolveCandidates,
  type CandidateResolution,
  type ResolvableCandidate,
  type ResolveCandidatesPorts,
} from '../../../src/jobs/resolveCandidates.js';
import type { TmdbSearchResult } from '@nextup/domain';

const IMAGE_A = 'img-a';
const IMAGE_B = 'img-b';

function candidate(overrides: Partial<ResolvableCandidate> & { id: string }): ResolvableCandidate {
  return {
    normalisedText: 'severance',
    extractedYear: null,
    sourceImageIds: [IMAGE_A],
    boundingBoxes: [{ imageId: 'img-1', x: 0.1, y: 0.1, w: 0.2, h: 0.1 }],
    ocrConfidence: 0.9,
    collapsedIntoCandidateId: null,
    resolvedWorkIdentity: null,
    ...overrides,
  };
}

function tmdbHit(overrides: Partial<TmdbSearchResult> = {}): TmdbSearchResult {
  return {
    tmdbId: 95396,
    mediaType: 'tv',
    name: 'Severance',
    releaseYear: 2022,
    posterPath: '/poster.jpg',
    ...overrides,
  };
}

interface Harness {
  ports: ResolveCandidatesPorts;
  queries: string[];
  writes: CandidateResolution[];
  events: string[];
}

function harness(
  rows: ResolvableCandidate[],
  search: (query: string) => Promise<TmdbSearchResult[]>,
  persist?: (resolution: CandidateResolution) => Promise<void>,
): Harness {
  const queries: string[] = [];
  const writes: CandidateResolution[] = [];
  const events: string[] = [];
  return {
    queries,
    writes,
    events,
    ports: {
      listCandidates: async () => rows,
      searchTmdb: async (query) => {
        queries.push(query);
        return search(query);
      },
      persist: async (resolution) => {
        writes.push(resolution);
        if (persist) await persist(resolution);
      },
      log: (event) => events.push(event),
    },
  };
}

describe('resolveCandidates · stage 3 in the pipeline', () => {
  it('T-AI-007l · the same caption read from two overlapping screenshots collapses to one survivor, and the loser is RETAINED pointing at it', async () => {
    const rows = [
      candidate({ id: 'c-first', sourceImageIds: [IMAGE_A] }),
      candidate({ id: 'c-second', sourceImageIds: [IMAGE_B] }),
    ];
    const h = harness(rows, async () => [tmdbHit()]);

    const result = await resolveCandidates({ imageOrder: [IMAGE_A, IMAGE_B], ports: h.ports });

    expect(result.candidatesCollapsed).toBe(1);
    expect(result.matched).toBe(1);

    // Both rows are written: the loser is never deleted (REQ-012).
    expect(h.writes.map((write) => write.candidateId).sort()).toEqual(['c-first', 'c-second']);
    const loser = h.writes.find((write) => write.collapsedIntoCandidateId !== null);
    expect(loser?.candidateId).toBe('c-second');
    expect(loser?.collapsedIntoCandidateId).toBe('c-first');
  });

  it('T-AI-007m · collapse runs BEFORE matching, so a title read twice costs ONE TMDB call', async () => {
    const rows = [
      candidate({ id: 'c-first', sourceImageIds: [IMAGE_A] }),
      candidate({ id: 'c-second', sourceImageIds: [IMAGE_B] }),
    ];
    const h = harness(rows, async () => [tmdbHit()]);

    await resolveCandidates({ imageOrder: [IMAGE_A, IMAGE_B], ports: h.ports });

    // Not two. The pre-match pass removed the duplicate before it could be
    // searched, which is the whole reason §4 orders the passes this way.
    expect(h.queries).toEqual(['severance']);
  });

  it('T-AI-007n · two DIFFERENT texts resolving to the SAME work collapse in the post-match pass', async () => {
    const rows = [
      candidate({ id: 'c-full', normalisedText: 'severance', sourceImageIds: [IMAGE_A] }),
      candidate({ id: 'c-trunc', normalisedText: 'severanc', sourceImageIds: [IMAGE_B] }),
    ];
    // Both texts return the same work — a truncated caption and its full form.
    const h = harness(rows, async () => [tmdbHit()]);

    const result = await resolveCandidates({ imageOrder: [IMAGE_A, IMAGE_B], ports: h.ports });

    // TWO searches (the texts differ, so pass A cannot merge them) but ONE
    // survivor, because pass B keys on the identity pass A could not know.
    expect(h.queries).toHaveLength(2);
    expect(result.candidatesCollapsed).toBe(1);
    expect(result.matched).toBe(1);
  });

  it('T-AI-017e · a TMDB outage resolves EVERY candidate to unmatched, and never throws', async () => {
    const rows = [
      candidate({ id: 'c-1', normalisedText: 'severance', sourceImageIds: [IMAGE_A] }),
      candidate({ id: 'c-2', normalisedText: 'the bear', sourceImageIds: [IMAGE_B] }),
    ];
    const h = harness(rows, async () => {
      throw new Error('TMDB is unreachable');
    });

    const result = await resolveCandidates({ imageOrder: [IMAGE_A, IMAGE_B], ports: h.ports });

    expect(result.tmdbUnavailable).toBe(true);
    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(2);
    for (const write of h.writes) {
      expect(write.resolvedWorkIdentity).toMatch(/^unmatched:[0-9a-f]{16}$/);
      expect(write.matchCandidates).toEqual([]);
    }
  });

  it('T-AI-017f · the outage is latched, NOT retried once per candidate', async () => {
    const rows = [
      candidate({ id: 'c-1', normalisedText: 'severance' }),
      candidate({ id: 'c-2', normalisedText: 'the bear' }),
      candidate({ id: 'c-3', normalisedText: 'shrinking' }),
    ];
    const h = harness(rows, async () => {
      throw new Error('TMDB is unreachable');
    });

    await resolveCandidates({ imageOrder: [IMAGE_A], ports: h.ports });

    // One attempt, not three. Retrying per candidate turns a TMDB outage into
    // a batch that hangs for minutes on a 5-DTU database and a 0.25-vCPU box.
    expect(h.queries).toEqual(['severance']);
    expect(h.events).toContain('extraction.tmdb_unavailable');
  });

  it('T-AI-017g · a per-row write failure costs that row, never the batch', async () => {
    const rows = [
      candidate({ id: 'c-1', normalisedText: 'severance' }),
      candidate({ id: 'c-2', normalisedText: 'the bear' }),
    ];
    const h = harness(
      rows,
      async () => [tmdbHit()],
      async (resolution) => {
        if (resolution.candidateId === 'c-1') throw new Error('deadlock');
      },
    );

    const result = await resolveCandidates({ imageOrder: [IMAGE_A], ports: h.ports });

    expect(h.writes).toHaveLength(2);
    expect(h.events).toContain('extraction.resolution_write_failed');
    // The measurement is of what stage 3 DECIDED, which is unaffected by a
    // failed write — and the batch still reports rather than throwing.
    expect(result.matched + result.unmatched).toBe(2);
  });

  it('T-AI-017h · an unreadable tile is left unresolved rather than matched against nothing', async () => {
    const rows = [candidate({ id: 'c-blank', normalisedText: '' })];
    const h = harness(rows, async () => [tmdbHit()]);

    const result = await resolveCandidates({ imageOrder: [IMAGE_A], ports: h.ports });

    // No search, no identity: an empty string scores identically against every
    // TMDB result, which is a coin toss dressed as a match.
    expect(h.queries).toEqual([]);
    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(0);
    expect(result.tmdbQueries).toBe(0);
  });

  it('T-AI-017i · alternatives are persisted even for an auto-match (US-007 AC-4)', async () => {
    const rows = [candidate({ id: 'c-1', normalisedText: 'severance' })];
    const h = harness(rows, async () => [
      tmdbHit(),
      tmdbHit({ tmdbId: 1, name: 'Severance', mediaType: 'movie', releaseYear: 2006 }),
    ]);

    const result = await resolveCandidates({ imageOrder: [IMAGE_A], ports: h.ports });

    expect(result.matched).toBe(1);
    const write = h.writes[0];
    expect(write?.resolvedWorkIdentity).toMatch(/^tmdb:(movie|tv):\d+$/);
    // Hidden alternates are how a silent wrong match survives review.
    expect(write?.matchCandidates.length).toBe(2);
  });
});
