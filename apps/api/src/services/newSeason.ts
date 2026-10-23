/**
 * #454 (PRD `A64`, US-072 / REQ-138) — the lazy re-check of a tracked removed
 * TV show. Pure: it is handed rows and a source and returns what to write.
 *
 * ⚠ METADATA ONLY, and only ever called from `GET /api/waiting` — the lazy
 * watch-availability refresh's trigger (REQ-086). It is not a fifth background
 * process: no timer, no queue, no sweep. It never creates an intent or a
 * title and never touches the list; the owner confirms every move.
 */

import { WATCH_PROVIDER_MAX_AGE_DAYS } from '../config.js';

const DAY_MS = 86_400_000;

/** As many tracked shows as one waiting-view open will re-check. */
export const SEASON_REFRESH_PER_REQUEST = 4;

export interface SeasonRow {
  workIdentity: string;
  tmdbId: number | null;
  seasonCheckedAt: Date | null;
}

export interface SeasonSource {
  getNextSeason(
    tmdbId: number,
    today: string,
  ): Promise<{ seasonNumber: number; airsOn: string } | null>;
}

export interface SeasonWrite {
  workIdentity: string;
  checkedAt: Date;
  season: { seasonNumber: number; airsOn: string } | null;
}

/** A season is "out" from its air date on. Dates are `YYYY-MM-DD`. */
export function isSeasonOut(airsOn: string, today: string): boolean {
  return airsOn <= today;
}

/** Never checked, or last checked longer ago than the provider-data age. */
export function selectForSeasonRefresh(
  rows: readonly SeasonRow[],
  now: Date,
  limit: number = SEASON_REFRESH_PER_REQUEST,
): SeasonRow[] {
  const cutoff = now.getTime() - WATCH_PROVIDER_MAX_AGE_DAYS * DAY_MS;
  return rows
    .filter(
      (row) =>
        row.tmdbId !== null &&
        (row.seasonCheckedAt === null || row.seasonCheckedAt.getTime() <= cutoff),
    )
    .slice(0, limit);
}

/**
 * ⚠ A failed lookup writes NOTHING (the last answer and its date stay), and
 * is counted so the caller can say so. "Not announced" is an answer.
 */
export async function refreshNewSeasons(
  rows: readonly SeasonRow[],
  source: SeasonSource,
  now: Date,
): Promise<{ writes: SeasonWrite[]; failedIds: string[] }> {
  const today = now.toISOString().slice(0, 10);
  const writes: SeasonWrite[] = [];
  const failedIds: string[] = [];
  for (const row of rows) {
    try {
      const season = await source.getNextSeason(row.tmdbId as number, today);
      writes.push({ workIdentity: row.workIdentity, checkedAt: now, season });
    } catch {
      failedIds.push(row.workIdentity);
    }
  }
  return { writes, failedIds };
}
