/**
 * #454 (PRD `A64`, US-072 / REQ-138) — the pure re-check of a tracked show.
 * Metadata only: it returns writes, it never touches the list.
 */

import { describe, expect, it } from 'vitest';

import {
  SEASON_REFRESH_PER_REQUEST,
  isSeasonOut,
  refreshNewSeasons,
  selectForSeasonRefresh,
  type SeasonRow,
} from '../../../src/services/newSeason.js';

const NOW = new Date('2026-10-23T12:00:00Z');
const DAY = 86_400_000;
const row = (over: Partial<SeasonRow> = {}): SeasonRow => ({
  workIdentity: 'tmdb:tv:1',
  tmdbId: 1,
  seasonCheckedAt: null,
  ...over,
});

describe('T-SEAS-030 · a season is out from its air date on', () => {
  it('T-SEAS-030a · before, on and after the date', () => {
    expect(isSeasonOut('2026-10-24', '2026-10-23')).toBe(false);
    expect(isSeasonOut('2026-10-23', '2026-10-23')).toBe(true);
    expect(isSeasonOut('2026-10-22', '2026-10-23')).toBe(true);
  });
});

describe('T-SEAS-031 · which tracked shows are due', () => {
  it('T-SEAS-031a · never checked and older than a week are due; fresh and unmatched are not', () => {
    const due = selectForSeasonRefresh(
      [
        row({ workIdentity: 'never' }),
        row({ workIdentity: 'old', seasonCheckedAt: new Date(NOW.getTime() - 8 * DAY) }),
        row({ workIdentity: 'fresh', seasonCheckedAt: new Date(NOW.getTime() - DAY) }),
        row({ workIdentity: 'unmatched', tmdbId: null }),
      ],
      NOW,
    );
    expect(due.map((r) => r.workIdentity)).toEqual(['never', 'old']);
  });

  it('T-SEAS-031b · one open of Waiting re-checks a bounded page, never the whole table', () => {
    const many = Array.from({ length: 20 }, (_, i) => row({ workIdentity: `w${String(i)}` }));
    expect(selectForSeasonRefresh(many, NOW)).toHaveLength(SEASON_REFRESH_PER_REQUEST);
    expect(selectForSeasonRefresh(many, NOW, 2)).toHaveLength(2);
  });
});

describe('T-SEAS-032 · refreshing', () => {
  it('T-SEAS-032a · an answer — even "not announced" — is a write; a failed lookup writes nothing', async () => {
    const source = {
      getNextSeason: (id: number) =>
        id === 2
          ? Promise.reject(new Error('down'))
          : Promise.resolve(id === 1 ? { seasonNumber: 3, airsOn: '2027-01-01' } : null),
    };
    const result = await refreshNewSeasons(
      [
        row(),
        row({ workIdentity: 'tmdb:tv:2', tmdbId: 2 }),
        row({ workIdentity: 'tmdb:tv:3', tmdbId: 3 }),
      ],
      source,
      NOW,
    );
    expect(result.failedIds).toEqual(['tmdb:tv:2']);
    expect(result.writes).toEqual([
      {
        workIdentity: 'tmdb:tv:1',
        checkedAt: NOW,
        season: { seasonNumber: 3, airsOn: '2027-01-01' },
      },
      { workIdentity: 'tmdb:tv:3', checkedAt: NOW, season: null },
    ]);
  });
});
