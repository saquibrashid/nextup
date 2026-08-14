/**
 * TASK-033 — the `GET /api/titles` response shaping, unit level.
 *
 * The handler's behaviour against a real store is asserted in
 * `test/integration/titles.spec.ts`; what lives here is the pure row →
 * response-item mapping, which needs no database and therefore belongs in the
 * suite where coverage is actually measured (CI job 4 has no store, so an
 * assertion that exists only in the integration suite counts as zero).
 *
 * These are not coverage filler. Each one pins a decision that is invisible
 * when it goes wrong: a date rendered a day early, a corrupt metadata blob
 * taking the whole list down, or an unmatched title rendering as a blank row.
 */

import { describe, expect, it } from 'vitest';

import { parseGenres, toDetailItem, toIsoDate, toListItem } from '../../src/routes/titles.js';

/** The shape `listTitlePage` returns, with sensible defaults per test. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    workIdentity: 'tmdb:movie:438631',
    matchState: 'matched',
    rawExtractedText: null,
    sortDateAdded: new Date('2026-04-02T00:00:00.000Z'),
    tmdbMediaType: 'movie',
    tmdbName: 'Dune',
    tmdbReleaseYear: 2021,
    tmdbRuntimeMinutes: 155,
    tmdbGenres: JSON.stringify(['Science Fiction', 'Adventure']),
    tmdbPosterPath: '/poster.jpg',
    listings: [
      {
        listingId: 'l-1',
        service: 'netflix',
        dateAdded: new Date('2026-04-02T00:00:00.000Z'),
      },
    ],
    ...overrides,
  } as Parameters<typeof toListItem>[0];
}

describe('T-LIST-031 the list item is shaped exactly as the contract says', () => {
  it('T-LIST-031a: a matched title carries every documented field', () => {
    const item = toListItem(row());

    expect(item).toMatchObject({
      titleId: 't-1',
      workIdentity: 'tmdb:movie:438631',
      matchState: 'matched',
      name: 'Dune',
      mediaType: 'movie',
      releaseYear: 2021,
      runtimeMinutes: 155,
      posterPath: '/poster.jpg',
      sortDateAdded: '2026-04-02',
      dateAddedLabel: 'Added to nextup 2 Apr 2026',
    });
    expect(item['genres']).toEqual(['Science Fiction', 'Adventure']);
  });

  it('T-LIST-031b: badges carry the service, listing id and date', () => {
    const item = toListItem(
      row({
        listings: [
          { listingId: 'l-1', service: 'netflix', dateAdded: new Date('2026-04-02T00:00:00.000Z') },
          { listingId: 'l-2', service: 'max', dateAdded: new Date('2026-06-11T00:00:00.000Z') },
        ],
      }),
    );

    expect(item['badges']).toEqual([
      { service: 'netflix', listingId: 'l-1', dateAdded: '2026-04-02' },
      { service: 'max', listingId: 'l-2', dateAdded: '2026-06-11' },
    ]);
  });

  it('T-LIST-031c: an UNMATCHED title falls back to the raw extracted text', () => {
    // A blank name would render an unusable row and hide from the owner that
    // the title never matched — which is the state fix-match exists to fix.
    const item = toListItem(
      row({ matchState: 'unmatched', tmdbName: null, rawExtractedText: 'Duen 2021' }),
    );

    expect(item['name']).toBe('Duen 2021');
    expect(item['matchState']).toBe('unmatched');
  });

  it('T-LIST-031d: a title with neither name is an empty string, never undefined', () => {
    // `undefined` disappears from JSON entirely, so the SPA would receive a row
    // with no `name` key at all and render `undefined` into the DOM.
    const item = toListItem(row({ tmdbName: null, rawExtractedText: null }));
    expect(item['name']).toBe('');
  });

  it('T-LIST-031e: the date label is absent, not invented, when there is no date', () => {
    const item = toListItem(row({ sortDateAdded: null }));
    expect(item['sortDateAdded']).toBeNull();
    expect(item['dateAddedLabel']).toBeNull();
  });

  it('T-LIST-031f: no listings means no badges rather than a failure', () => {
    expect(toListItem(row({ listings: [] }))['badges']).toEqual([]);
  });
});

describe('T-LIST-032 genres are never defaulted', () => {
  it('T-LIST-032a: an empty stored array stays empty', () => {
    // ⚠ US-019 AC-6: `[]` is MEANINGFUL. A title with no genres matches no
    // genre filter, and must never be defaulted into one.
    expect(parseGenres('[]')).toEqual([]);
    expect(toListItem(row({ tmdbGenres: '[]' }))['genres']).toEqual([]);
  });

  it('T-LIST-032b: a corrupt metadata blob yields [] rather than a 500', () => {
    // `tmdb_genres` is the one column the database cannot shape-check. Genres
    // are decoration on a row; refusing to render the owner's ENTIRE list
    // because one blob is corrupt is far worse than a missing genre chip.
    for (const corrupt of ['', 'not json', '{', '{"a":1}', 'null', '"Drama"', '42']) {
      expect(parseGenres(corrupt), corrupt).toEqual([]);
    }
  });

  it('T-LIST-032c: non-string entries are dropped, valid ones kept', () => {
    expect(parseGenres('["Drama", 7, null, "Comedy"]')).toEqual(['Drama', 'Comedy']);
  });
});

describe('T-LIST-033 dates never shift by a day', () => {
  it('T-LIST-033a: a UTC-midnight date renders as its own calendar day', () => {
    // The bug this guards: `toLocaleDateString` or a local-time getter renders
    // 1 Apr for a 2 Apr row on any host west of UTC. Nobody would connect a
    // date that is off by one to a timezone, and the owner would see a date
    // that is simply wrong.
    expect(toIsoDate(new Date('2026-04-02T00:00:00.000Z'))).toBe('2026-04-02');
    expect(toIsoDate(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01');
    expect(toIsoDate(new Date('2026-12-31T00:00:00.000Z'))).toBe('2026-12-31');
  });
});

/* ================================================================== *
 * T-LIST-035 — the DETAIL item (`specs/api.md` §6.3, TASK-034)
 * ================================================================== */

/** The shape `findTitleDetail` returns: every listing, active and removed. */
function detailRow(listings: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    ...row(),
    createdByBatchId: 'b-1',
    createdAt: new Date('2026-04-02T09:15:00.000Z'),
    listings,
    ...overrides,
  } as Parameters<typeof toDetailItem>[0];
}

const activeListing = {
  listingId: 'l-netflix',
  service: 'netflix',
  state: 'active',
  dateAdded: new Date('2026-04-02T00:00:00.000Z'),
  removedAt: null,
};

const removedListing = {
  listingId: 'l-max',
  service: 'max',
  state: 'removed',
  dateAdded: new Date('2026-06-11T00:00:00.000Z'),
  removedAt: new Date('2026-07-01T10:30:00.000Z'),
};

describe('T-LIST-035 the detail item is the list item plus the removal history', () => {
  it('T-LIST-035a: carries the list-item fields and the three §6.3 extras', () => {
    const item = toDetailItem(detailRow([activeListing]));

    expect(item).toMatchObject({
      titleId: 't-1',
      name: 'Dune',
      sortDateAdded: '2026-04-02',
      createdByBatchId: 'b-1',
      createdAt: '2026-04-02T09:15:00.000Z',
    });
    expect(item['removedListings']).toEqual([]);
  });

  it('T-LIST-035b: badges are built from the ACTIVE listings alone', () => {
    // ⚠ The load-bearing case. This function is handed ALL listings — that is
    // the point, `removedListings[]` needs the others — so passing the array
    // straight through to `toListItem` is the natural mistake, and it puts a
    // removed service's badge back on the row in the one view that shows the
    // removal right beside it.
    const item = toDetailItem(detailRow([activeListing, removedListing]));

    expect((item['badges'] as { service: string }[]).map((b) => b.service)).toEqual(['netflix']);
    expect(item['removedListings']).toHaveLength(1);
  });

  it('T-LIST-035c: a removed listing keeps its write-once dateAdded', () => {
    // REQ-030: `dateAdded` is written once and never rewritten, so removal
    // must not restamp it. A removal that reset the date would silently
    // rewrite the owner's own history of when they saved the title.
    const item = toDetailItem(detailRow([removedListing]));
    const removed = (item['removedListings'] as Record<string, unknown>[])[0];

    expect(removed).toMatchObject({
      listingId: 'l-max',
      service: 'max',
      state: 'removed',
      dateAdded: '2026-06-11',
    });
  });

  it('T-LIST-035d: removedAt is a full timestamp, not a date', () => {
    // The removed view is an ordered LOG, not a set. Truncating to a day makes
    // two removals on one day indistinguishable and unorderable — and the log
    // is exactly what the owner reads to answer "what did that batch take?".
    const item = toDetailItem(detailRow([removedListing]));
    const removed = (item['removedListings'] as Record<string, unknown>[])[0];

    expect(removed?.['removedAt']).toBe('2026-07-01T10:30:00.000Z');
    expect(removed?.['removedAt']).not.toBe('2026-07-01');
  });

  it('T-LIST-035e: a removed listing with no removedAt yields null, not a crash', () => {
    // The column is nullable, and a row soft-deleted by an older path may
    // carry no stamp. A `.toISOString()` on null would take down the detail
    // page for the one title whose history is already incomplete.
    const item = toDetailItem(detailRow([{ ...removedListing, removedAt: null }]));
    const removed = (item['removedListings'] as Record<string, unknown>[])[0];

    expect(removed?.['removedAt']).toBeNull();
  });

  it('T-LIST-035f: a title with no listings at all is still renderable', () => {
    // Reachable: every listing removed leaves the title row alive (REQ-028,
    // soft delete forever). Empty badges plus empty removals must not be an
    // error — the row is the thing restore acts on.
    const item = toDetailItem(detailRow([]));

    expect(item['badges']).toEqual([]);
    expect(item['removedListings']).toEqual([]);
  });

  it('T-LIST-035g: any non-active state counts as removed, not just "removed"', () => {
    // The split tests `state === active`, not `state === removed`. If a third
    // state is ever added, an unknown value must fall to the removal log
    // rather than silently earning a badge it has no right to.
    const item = toDetailItem(detailRow([{ ...removedListing, state: 'unknown-future-state' }]));

    expect(item['badges']).toEqual([]);
    expect(item['removedListings']).toHaveLength(1);
  });

  it('T-LIST-035h: createdByBatchId survives as null', () => {
    const item = toDetailItem(detailRow([activeListing], { createdByBatchId: null }));

    expect(item['createdByBatchId']).toBeNull();
  });
});
