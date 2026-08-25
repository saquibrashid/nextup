/**
 * `T-IMDB-001…005` — the rating cache and its lazy refresh (REQ-090, REQ-093,
 * REQ-095, ADR-0011). Epic M.
 *
 * Every case is offline. `refreshRatings` is handed a stub client; nothing here
 * touches OMDb (`specs/testing.md` §3.2).
 */

import { describe, expect, it } from 'vitest';

import { IMDB_RATING_MAX_AGE_DAYS } from '../../../src/config.js';
import {
  IMDB_REFRESH_PER_REQUEST,
  fromTenths,
  isRatingStale,
  refreshRatings,
  selectForRefresh,
  toTenths,
  type RatingRow,
} from '../../../src/services/imdbRatings.js';

const NOW = new Date('2026-06-01T12:00:00.000Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

function row(over: Partial<RatingRow> = {}): RatingRow {
  return {
    id: 'title-1',
    imdbId: 'tt1375666',
    imdbRatingTenths: 88,
    imdbRatingFetchedAt: daysAgo(1),
    ...over,
  };
}

/** A client that answers from a table and records what it was asked. */
function stubClient(table: Record<string, number | null> = {}): {
  asked: string[];
  client: {
    getRating: (
      imdbId: string,
    ) => Promise<{ imdbId: string; rating: number | null; voteCount: number | null }>;
  };
} {
  const asked: string[] = [];
  return {
    asked,
    client: {
      getRating: (imdbId: string) => {
        asked.push(imdbId);
        return Promise.resolve({ imdbId, rating: table[imdbId] ?? null, voteCount: null });
      },
    },
  };
}

describe('T-IMDB-001 · REQ-090 · staleness distinguishes "never asked" from "no rating"', () => {
  it('T-IMDB-001a · a fresh rating is not stale', () => {
    expect(isRatingStale(row({ imdbRatingFetchedAt: daysAgo(1) }), NOW)).toBe(false);
  });

  it('T-IMDB-001b · a rating older than the max age is stale, boundary included', () => {
    expect(
      isRatingStale(row({ imdbRatingFetchedAt: daysAgo(IMDB_RATING_MAX_AGE_DAYS + 1) }), NOW),
    ).toBe(true);
    // Exactly at the boundary counts as due. A `>` would leave a row that is
    // precisely max-age old sitting on the wrong side of the comparison.
    expect(
      isRatingStale(row({ imdbRatingFetchedAt: daysAgo(IMDB_RATING_MAX_AGE_DAYS) }), NOW),
    ).toBe(true);
  });

  it('T-IMDB-001c · NEVER ASKED is stale — a null timestamp is not "no rating"', () => {
    // ⚠ The whole point. `fetchedAt === null` means the question has not been
    // put yet. Reading it as "there is no rating" means nothing is EVER
    // fetched, and the feature silently does nothing at all while looking fine.
    expect(isRatingStale(row({ imdbRatingTenths: null, imdbRatingFetchedAt: null }), NOW)).toBe(
      true,
    );
  });

  it('T-IMDB-001d · ASKED AND THERE WAS NONE is NOT stale until it ages out', () => {
    // The mirror of the case above, and the one that protects the budget: a
    // work OMDb has no rating for must not be re-queried on every render.
    const unrated = row({ imdbRatingTenths: null, imdbRatingFetchedAt: daysAgo(1) });
    expect(isRatingStale(unrated, NOW)).toBe(false);

    // …but it does age out, so a rating IMDb adds later is eventually picked up.
    expect(
      isRatingStale(
        { ...unrated, imdbRatingFetchedAt: daysAgo(IMDB_RATING_MAX_AGE_DAYS + 1) },
        NOW,
      ),
    ).toBe(true);
  });

  it('T-IMDB-001e · a work with no usable IMDb id is never stale — nothing to ask', () => {
    for (const imdbId of [null, '', 'nm0000138', 'tt', 'not-an-id']) {
      expect(isRatingStale(row({ imdbId, imdbRatingFetchedAt: null }), NOW)).toBe(false);
    }
  });
});

describe('T-IMDB-002 · REQ-093 · selection is bounded, deduplicated and budget-aware', () => {
  it('T-IMDB-002a · only stale rows are selected, in page order', () => {
    const rows = [
      row({ id: 'fresh', imdbId: 'tt0000001', imdbRatingFetchedAt: daysAgo(1) }),
      row({ id: 'stale-1', imdbId: 'tt0000002', imdbRatingFetchedAt: null }),
      row({ id: 'no-id', imdbId: null, imdbRatingFetchedAt: null }),
      row({ id: 'stale-2', imdbId: 'tt0000003', imdbRatingFetchedAt: daysAgo(365) }),
    ];
    expect(selectForRefresh(rows, NOW, 100).map((r) => r.id)).toEqual(['stale-1', 'stale-2']);
  });

  it('T-IMDB-002b · the per-request ceiling caps a large page', () => {
    // A 200-row first load must not fire 200 serial requests and hold the page
    // open for minutes. The rest refresh on the next render — that is "lazy".
    const rows = Array.from({ length: 200 }, (_, i) =>
      row({ id: `t${i}`, imdbId: `tt${String(1_000_000 + i)}`, imdbRatingFetchedAt: null }),
    );
    expect(selectForRefresh(rows, NOW, 10_000)).toHaveLength(IMDB_REFRESH_PER_REQUEST);
  });

  it('T-IMDB-002c · the daily budget caps it below the per-request ceiling', () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      row({ id: `t${i}`, imdbId: `tt${String(2_000_000 + i)}`, imdbRatingFetchedAt: null }),
    );
    expect(selectForRefresh(rows, NOW, 3)).toHaveLength(3);
    // Exhausted — and a negative budget, which should never happen, is not a
    // licence to spend.
    expect(selectForRefresh(rows, NOW, 0)).toEqual([]);
    expect(selectForRefresh(rows, NOW, -5)).toEqual([]);
  });

  it('T-IMDB-002d · one IMDb id is asked once, however many rows carry it', () => {
    // A reappearing title is a brand-new row (product invariant 7), so a page
    // can legitimately hold several rows for one work. Asking twice in one
    // render spends budget to get the same answer.
    const rows = [
      row({ id: 'a', imdbId: 'tt1375666', imdbRatingFetchedAt: null }),
      row({ id: 'b', imdbId: 'tt1375666', imdbRatingFetchedAt: null }),
      row({ id: 'c', imdbId: 'tt1375666', imdbRatingFetchedAt: null }),
    ];
    expect(selectForRefresh(rows, NOW, 100).map((r) => r.id)).toEqual(['a']);
  });

  it('T-IMDB-002e · an empty page asks nothing', () => {
    expect(selectForRefresh([], NOW, 1_000)).toEqual([]);
  });
});

describe('T-IMDB-003 · REQ-091 · the tenths conversion never invents a rating', () => {
  it('T-IMDB-003a · a rating round-trips exactly, with no float drift', () => {
    // 8.8 is the case a FLOAT column gets wrong: it stores as
    // 8.800000000000001 and formats differently depending on the layer.
    for (const rating of [0.1, 1, 5.5, 7.3, 8.8, 9.9, 10]) {
      expect(fromTenths(toTenths(rating))).toBe(rating);
    }
    expect(toTenths(8.8)).toBe(88);
  });

  it('T-IMDB-003b · unknown stays unknown and NEVER becomes zero', () => {
    // ⚠ REQ-091. A 0 here renders as "rated 0.0 out of 10" — the worst film
    // ever made — for every work nobody has rated yet.
    expect(toTenths(null)).toBeNull();
    expect(fromTenths(null)).toBeNull();
    expect(toTenths(0)).toBeNull();
    expect(fromTenths(0)).toBeNull();
  });

  it('T-IMDB-003c · a value off the 1–10 scale is refused, not clamped', () => {
    // Clamping would turn an upstream bug into a plausible-looking rating,
    // which is strictly worse than recording "unknown" — which is true.
    for (const bad of [-1, 10.1, 11, 1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(toTenths(bad)).toBeNull();
    }
    for (const bad of [0, 101, -1, 8.5, Number.NaN]) {
      expect(fromTenths(bad)).toBeNull();
    }
  });
});

describe('T-IMDB-004 · REQ-093 · the refresh is serial, silent on failure, and caches "none"', () => {
  it('T-IMDB-004a · a rating is fetched and returned as a write', async () => {
    const { client, asked } = stubClient({ tt1375666: 8.8 });
    const writes = await refreshRatings([row({ imdbRatingFetchedAt: null })], {
      client,
      budget: 100,
      now: () => NOW,
    });

    expect(asked).toEqual(['tt1375666']);
    expect(writes).toEqual([{ id: 'title-1', imdbRatingTenths: 88, imdbRatingFetchedAt: NOW }]);
  });

  it('T-IMDB-004b · "OMDb has no rating" is WRITTEN, with a timestamp', async () => {
    // ⚠ Skipping this write because the value is null makes every unrated work
    // permanently stale and re-queried on every render — the budget leak
    // REQ-093 exists to prevent. The timestamp IS the cached answer.
    const { client } = stubClient({});
    const writes = await refreshRatings([row({ imdbRatingFetchedAt: null })], {
      client,
      budget: 100,
      now: () => NOW,
    });

    expect(writes).toEqual([{ id: 'title-1', imdbRatingTenths: null, imdbRatingFetchedAt: NOW }]);
  });

  it('T-IMDB-004c · requests are issued one at a time, not in parallel', async () => {
    // A page render is not a reason to open eight sockets to a free-tier API.
    let inFlight = 0;
    let peak = 0;
    const client = {
      getRating: async (imdbId: string) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return { imdbId, rating: 7, voteCount: null };
      },
    };

    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ id: `t${i}`, imdbId: `tt${String(3_000_000 + i)}`, imdbRatingFetchedAt: null }),
    );
    await refreshRatings(rows, { client, budget: 100, now: () => NOW });

    expect(peak).toBe(1);
  });

  it('T-IMDB-004d · a transport failure ENDS the pass and never throws', async () => {
    // If OMDb is down for one id it is down for all of them; continuing would
    // spend the whole per-request ceiling discovering that eight times over.
    const asked: string[] = [];
    const client = {
      getRating: (imdbId: string) => {
        asked.push(imdbId);
        if (asked.length === 2) return Promise.reject(new Error('OMDb unavailable'));
        return Promise.resolve({ imdbId, rating: 6.5, voteCount: null });
      },
    };

    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ id: `t${i}`, imdbId: `tt${String(4_000_000 + i)}`, imdbRatingFetchedAt: null }),
    );

    // It RESOLVES rather than rejecting — the list page must not 500 because a
    // decoration could not be fetched.
    const writes = await refreshRatings(rows, { client, budget: 100, now: () => NOW });

    expect(asked).toHaveLength(2);
    expect(writes.map((w) => w.id)).toEqual(['t0']);
  });

  it('T-IMDB-004e · an exhausted budget refreshes nothing and asks nothing', async () => {
    const { client, asked } = stubClient({ tt1375666: 8.8 });
    const writes = await refreshRatings([row({ imdbRatingFetchedAt: null })], {
      client,
      budget: 0,
      now: () => NOW,
    });

    expect(writes).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('T-IMDB-004f · a fully fresh page issues no request at all', async () => {
    const { client, asked } = stubClient({ tt1375666: 8.8 });
    const writes = await refreshRatings([row(), row({ id: 'b', imdbId: 'tt0111161' })], {
      client,
      budget: 100,
      now: () => NOW,
    });

    expect(writes).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('T-IMDB-004g · an off-scale answer is stored as unknown, not as itself', async () => {
    const { client } = stubClient({ tt1375666: 42 });
    const writes = await refreshRatings([row({ imdbRatingFetchedAt: null })], {
      client,
      budget: 100,
      now: () => NOW,
    });

    expect(writes[0]?.imdbRatingTenths).toBeNull();
  });
});

describe('T-IMDB-005 · REQ-095 / invariant 5 · the refresh cannot touch list state', () => {
  it('T-IMDB-005a · a write names ONLY the rating and its timestamp', async () => {
    // ⚠ This is what keeps the refresh on the legal side of invariant 5. If a
    // write could carry any other field, an access-triggered background write
    // could change membership, ordering or a service badge.
    const { client } = stubClient({ tt1375666: 8.8 });
    const writes = await refreshRatings([row({ imdbRatingFetchedAt: null })], {
      client,
      budget: 100,
      now: () => NOW,
    });

    expect(Object.keys(writes[0] ?? {}).sort()).toEqual([
      'id',
      'imdbRatingFetchedAt',
      'imdbRatingTenths',
    ]);
  });

  it('T-IMDB-005b · the module exports no sort, filter or ranking helper', async () => {
    // REQ-095: the rating is display-only. A sort key here would let a
    // background write reorder the list, which invariant 5 forbids outright —
    // so its absence is asserted rather than assumed.
    const mod: Record<string, unknown> = await import('../../../src/services/imdbRatings.js');
    const names = Object.keys(mod).join(' ').toLowerCase();
    expect(names).not.toMatch(/sort|orderby|compare|rank/);
  });

  it('T-IMDB-005c · the max age is the rating constant, not one of its siblings', () => {
    // T-INV-008's family: 30 / 183 / 14, three day-constants that must never be
    // unified. A refresh accidentally keyed on the screenshot-retention or the
    // TMDB constant would be wrong quietly and for ever.
    expect(IMDB_RATING_MAX_AGE_DAYS).toBe(14);
  });
});
