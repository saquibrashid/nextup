/**
 * TASK-187 — the two rules of the availability refresh that can be got wrong
 * silently: **flatrate only** (`T-AVAIL-005`) and **the region is stored and
 * passed, never defaulted at the call site** (`T-AVAIL-010`).
 *
 * Both are unit tests on purpose. Each is a decision, not an interaction, and
 * a decision that needs a database and a network to check is a decision nobody
 * re-checks. `specs/testing.md` §38.1 pins both at level `U` for that reason.
 */

import { describe, expect, it } from 'vitest';

import { readFlatrateProviders } from '../../../src/clients/tmdbClient.js';
import {
  AVAILABILITY_REFRESH_PER_REQUEST,
  DEFAULT_AVAILABILITY_REGION,
  flaggedProvidersFor,
  isAvailabilityStale,
  refreshAvailability,
  selectForAvailabilityRefresh,
  type IntentRow,
} from '../../../src/services/watchAvailability.js';
import { WATCH_PROVIDER_MAX_AGE_DAYS } from '../../../src/config.js';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const MS_PER_DAY = 86_400_000;
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * MS_PER_DAY);

function intent(over: Partial<IntentRow> = {}): IntentRow {
  return {
    id: 'wi-1',
    workIdentity: 'tmdb:movie:438631',
    tmdbId: 438_631,
    tmdbMediaType: 'movie',
    availabilityRegion: DEFAULT_AVAILABILITY_REGION,
    availabilityCheckedAt: null,
    availableOn: null,
    ...over,
  };
}

describe('T-AVAIL-005 · US-042 AC-5 · flatrate only — a rentable work is what the owner is escaping', () => {
  it('T-AVAIL-005a · a work offered only to rent or buy is NOT reported as available', () => {
    // ⚠ This is the case that inverts the feature. The owner recorded the
    // intent BECAUSE the work was rent-only on a storefront; reporting that
    // same rent offer back as availability would flag every waiting work
    // immediately and make the whole epic noise.
    const body = {
      results: {
        US: {
          // Deliberately shaped as the real payload is, with the keys the
          // response type refuses to declare present in the data.
          rent: [{ provider_name: 'Fandango At Home' }],
          buy: [{ provider_name: 'Apple TV' }],
        },
      },
    } as never;

    // ASKED, and the answer is "no subscription offer" — `[]`, not `null`.
    expect(readFlatrateProviders(body, 'US')).toEqual([]);
    expect(flaggedProvidersFor(readFlatrateProviders(body, 'US'))).toEqual([]);
  });

  it('T-AVAIL-005b · a flatrate offer on one of the owner services IS reported and flagged', () => {
    const body = {
      results: {
        US: {
          flatrate: [{ provider_name: 'Netflix' }],
          rent: [{ provider_name: 'Fandango At Home' }],
        },
      },
    } as never;

    expect(readFlatrateProviders(body, 'US')).toEqual(['Netflix']);
    expect(flaggedProvidersFor(readFlatrateProviders(body, 'US'))).toEqual(['netflix']);
  });

  it('T-AVAIL-005c · a JustWatch name qualifier still matches the owner service', () => {
    // ⚠ TMDB's names are JustWatch's and carry qualifiers the owner's services
    // do not. Equality matching would report a work as unavailable on a
    // service that is streaming it right now.
    expect(flaggedProvidersFor(['Netflix Standard with Ads'])).toEqual(['netflix']);
    expect(flaggedProvidersFor(['Max Amazon Channel'])).toEqual(['max']);
  });

  it('T-AVAIL-005d · a provider that is not one of the owner services is not flagged', () => {
    // Available somewhere on subscription, but not somewhere the owner pays
    // for. `availableOn` still records it — the FLAG is the narrower claim.
    expect(flaggedProvidersFor(['Hulu', 'Peacock'])).toEqual([]);
  });

  it('T-AVAIL-005e · NOT KNOWN and ASKED-AND-NOBODY stay distinguishable end to end', () => {
    // ⚠ ADR-0010 Trap 4. Collapsing these two lets TASK-188 render *"not
    // streaming anywhere"* over a question that was never asked.
    expect(readFlatrateProviders(null, 'US')).toBeNull();
    expect(flaggedProvidersFor(null)).toBeNull();

    // A region key absent from the response is an ANSWER: TMDB replied, and
    // for this region the answer was nobody.
    expect(readFlatrateProviders({ results: { GB: { flatrate: [] } } }, 'US')).toEqual([]);
    expect(flaggedProvidersFor([])).toEqual([]);
  });
});

describe('T-AVAIL-010 · ASM-059/A49 · the region is stored on the row and passed explicitly', () => {
  it('T-AVAIL-010a · the declared default region is US', () => {
    expect(DEFAULT_AVAILABILITY_REGION).toBe('US');
  });

  it('T-AVAIL-010b · the refresh passes the ROW region, never a hard-coded one', async () => {
    // ⚠ The discriminating case: a row whose stored region is not the default.
    // Against a build that hard-codes `'US'` at the call site this is the only
    // assertion in the suite that fails, and it is exactly the bug that makes
    // a cached answer silently answer a different question than it claims.
    const asked: { region: string; tmdbId: number }[] = [];
    const rows = [
      intent({ id: 'wi-us', tmdbId: 1, availabilityRegion: 'US' }),
      intent({ id: 'wi-gb', tmdbId: 2, availabilityRegion: 'GB' }),
    ];

    const { writes } = await refreshAvailability(
      rows,
      {
        getWatchProviders: (_mediaType, tmdbId, region) => {
          asked.push({ region, tmdbId });
          return Promise.resolve(['Netflix']);
        },
      },
      NOW,
    );

    expect(asked).toEqual([
      { tmdbId: 1, region: 'US' },
      { tmdbId: 2, region: 'GB' },
    ]);
    // And the region travels back onto the write, so the stored answer records
    // which question it answered.
    expect(writes.map((w) => w.availabilityRegion)).toEqual(['US', 'GB']);
  });

  it('T-AVAIL-010c · a FAILED lookup writes nothing for that row', async () => {
    // ⚠ Writing `availableOn = null` on a failure would erase a known-good
    // answer and, under Trap 4's rendering rule, downgrade the row to "not
    // known" — the owner would watch their data evaporate whenever TMDB had a
    // bad minute. The row stays stale and is retried on the next render.
    const rows = [
      intent({ id: 'wi-ok', tmdbId: 1 }),
      intent({ id: 'wi-fail', tmdbId: 2 }),
      intent({ id: 'wi-ok2', tmdbId: 3 }),
    ];

    const { writes, failedIds } = await refreshAvailability(
      rows,
      {
        getWatchProviders: (_mediaType, tmdbId) =>
          tmdbId === 2 ? Promise.reject(new Error('tmdb down')) : Promise.resolve([]),
      },
      NOW,
    );

    // The failure fails ONE row, never the page.
    expect(writes.map((w) => w.id)).toEqual(['wi-ok', 'wi-ok2']);
    // ⚠ And it is REPORTED rather than swallowed (US-042 AC-7). Without this,
    // "nothing was due" and "everything was due and TMDB was down" are the
    // same empty write list, and the view has no way to say which happened.
    expect(failedIds).toEqual(['wi-fail']);
  });

  it('T-AVAIL-010d · staleness: never-checked is stale, recently-checked is not', () => {
    expect(isAvailabilityStale(intent({ availabilityCheckedAt: null }), NOW)).toBe(true);
    expect(
      isAvailabilityStale(
        intent({ availabilityCheckedAt: daysAgo(WATCH_PROVIDER_MAX_AGE_DAYS + 1) }),
        NOW,
      ),
    ).toBe(true);
    expect(isAvailabilityStale(intent({ availabilityCheckedAt: daysAgo(0) }), NOW)).toBe(false);

    // ⚠ "Asked, and nobody carries it" is a real answer with a real
    // `checkedAt`. It must NOT be re-asked on every render for ever, which is
    // what conflating it with never-checked would do.
    expect(
      isAvailabilityStale(intent({ availabilityCheckedAt: daysAgo(0), availableOn: [] }), NOW),
    ).toBe(false);

    // Nothing to ask about: an unmatched work has no TMDB id, and a request
    // for one spends the per-request budget on a guaranteed 404.
    expect(isAvailabilityStale(intent({ tmdbId: null }), NOW)).toBe(false);
    expect(isAvailabilityStale(intent({ tmdbMediaType: null }), NOW)).toBe(false);
  });

  it('T-AVAIL-010e · selection is bounded by the per-request ceiling', () => {
    // A ceiling, not a target — the rest refresh on the next render, which is
    // what "lazy" means. Lifting it to cover the whole list turns the refresh
    // into the sweep REQ-041 forbids.
    const many = Array.from({ length: AVAILABILITY_REFRESH_PER_REQUEST + 5 }, (_unused, i) =>
      intent({ id: `wi-${i}`, tmdbId: i + 1 }),
    );
    expect(selectForAvailabilityRefresh(many, NOW)).toHaveLength(AVAILABILITY_REFRESH_PER_REQUEST);

    // And a page with nothing stale asks for nothing at all.
    expect(
      selectForAvailabilityRefresh([intent({ availabilityCheckedAt: daysAgo(0) })], NOW),
    ).toEqual([]);
  });
});
