/**
 * #380 — the forecast refresh: lazy, on access, metadata-only.
 *
 * ⚠ **THIS IS NOT A JOB.** Like the availability refresh beside it, it runs
 * only inside `GET /api/waiting`, only for the rows being rendered, and only
 * writes the six forecast columns of `watch_intent`. It changes no `Title`,
 * no `ServiceListing`, no intent state and no order (product invariant 5,
 * REQ-041). An estimate never sorts a row (owner decision 3 on #380).
 *
 * It stores FACTS (studio ids, release dates, an announced date), never the
 * estimate: `streamingForecast` in `@nextup/domain` computes that on read.
 */

import { type Service } from '@nextup/domain';

import { WATCH_PROVIDER_MAX_AGE_DAYS } from '../config.js';
import { AVAILABILITY_REFRESH_PER_REQUEST } from './watchAvailability.js';

export interface ForecastRow {
  id: string;
  tmdbId: number | null;
  tmdbMediaType: string | null;
  availabilityRegion: string;
  forecastCheckedAt: Date | null;
  companyIds: number[] | null;
  theatricalOn: string | null;
  digitalOn: string | null;
  announced: { service: Service; on: string } | null;
  /** Already streaming on a supported service: the forecast is moot. */
  streamingOnAService: boolean;
}

export interface ForecastWrite {
  id: string;
  forecastCheckedAt: Date;
  companyIds: number[] | null;
  theatricalOn: string | null;
  digitalOn: string | null;
  announced: { service: Service; on: string } | null;
}

export interface ReleaseFactsSource {
  getReleaseFacts(
    tmdbId: number,
    region: string,
  ): Promise<{
    companyIds: number[];
    theatricalOn: string | null;
    digitalOn: string | null;
  } | null>;
}

export interface AnnouncementSource {
  /** Earliest announced release per work, keyed `movie:123` / `tv:456`. Throws on failure. */
  announcements(now: Date): Promise<Map<string, { service: Service; on: string }>>;
}

const MS_PER_DAY = 86_400_000;

export function isForecastStale(row: ForecastRow, now: Date): boolean {
  if (row.tmdbId === null || (row.tmdbMediaType !== 'movie' && row.tmdbMediaType !== 'tv')) {
    return false;
  }
  if (row.streamingOnAService) return false;
  if (row.forecastCheckedAt === null) return true;
  const ageDays = (now.getTime() - row.forecastCheckedAt.getTime()) / MS_PER_DAY;
  return ageDays >= WATCH_PROVIDER_MAX_AGE_DAYS;
}

/** Pure. ⚠ `rows` is the page being rendered, never a table scan (REQ-041). */
export function selectForForecastRefresh(
  rows: readonly ForecastRow[],
  now: Date,
  limit: number = AVAILABILITY_REFRESH_PER_REQUEST,
): ForecastRow[] {
  const due: ForecastRow[] = [];
  for (const row of rows) {
    if (due.length >= limit) break;
    if (isForecastStale(row, now)) due.push(row);
  }
  return due;
}

export interface ForecastRefreshResult {
  writes: ForecastWrite[];
  failedIds: string[];
}

/**
 * Read the facts for the due rows.
 *
 * ⚠ **A FAILED LOOKUP WRITES NOTHING FOR THAT ROW**, and a failed or
 * unconfigured announcement feed keeps each row's last-known announced date:
 * a Watchmode outage must never read as "nothing announced". Serial, as for
 * availability, on a 0.25 vCPU container.
 */
export async function refreshForecast(
  rows: readonly ForecastRow[],
  sources: { tmdb: ReleaseFactsSource; announcements: AnnouncementSource | null },
  now: Date,
): Promise<ForecastRefreshResult> {
  const writes: ForecastWrite[] = [];
  const failedIds: string[] = [];
  if (rows.length === 0) return { writes, failedIds };

  let feed: Map<string, { service: Service; on: string }> | null = null;
  if (sources.announcements !== null) {
    try {
      feed = await sources.announcements.announcements(now);
    } catch {
      feed = null;
    }
  }

  for (const row of rows) {
    const mediaType = row.tmdbMediaType;
    if (row.tmdbId === null || (mediaType !== 'movie' && mediaType !== 'tv')) continue;

    let facts: { companyIds: number[]; theatricalOn: string | null; digitalOn: string | null } = {
      companyIds: [],
      theatricalOn: null,
      digitalOn: null,
    };
    if (mediaType === 'movie') {
      try {
        facts = (await sources.tmdb.getReleaseFacts(row.tmdbId, row.availabilityRegion)) ?? facts;
      } catch {
        failedIds.push(row.id);
        continue;
      }
    }

    writes.push({
      id: row.id,
      forecastCheckedAt: now,
      companyIds: facts.companyIds,
      theatricalOn: facts.theatricalOn,
      digitalOn: facts.digitalOn,
      announced: feed === null ? row.announced : (feed.get(`${mediaType}:${row.tmdbId}`) ?? null),
    });
  }

  return { writes, failedIds };
}
