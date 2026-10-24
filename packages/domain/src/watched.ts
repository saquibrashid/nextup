/**
 * #325 / #465 (PRD `A66`, US-074 / REQ-140) — the pure rules of the viewing
 * record, shared by the API (validation, completeness) and the web (labels).
 *
 * A record is one MOVIE (`WHOLE_TITLE_SEASON`) or one show SEASON (1 and up).
 * Specials (season 0 on TMDB) are never recorded and never count toward "all
 * seasons".
 */

/** The season number of a movie, or of a show that has no season list. */
export const WHOLE_TITLE_SEASON = 0;
export const RATING_MIN = 1;
export const RATING_MAX = 5;

export function isStarRating(value: unknown): value is number {
  return (
    Number.isInteger(value) && (value as number) >= RATING_MIN && (value as number) <= RATING_MAX
  );
}

/** A real calendar day, `YYYY-MM-DD`. */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export interface FinishedRequest {
  seasons: number[];
  watchedOn: string | null | undefined;
  rating: number | null | undefined;
}

export interface WatchedPatch {
  watchedOn?: string | null;
  rating?: number | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function isObject(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

function readDayAndRating(
  record: Record<string, unknown>,
):
  { ok: true; watchedOn?: string | null; rating?: number | null } | { ok: false; message: string } {
  const out: { watchedOn?: string | null; rating?: number | null } = {};
  if ('watchedOn' in record) {
    const day = record['watchedOn'];
    if (day !== null && !isCalendarDay(day)) {
      return { ok: false, message: '"watchedOn" must be a date (YYYY-MM-DD) or null.' };
    }
    out.watchedOn = day;
  }
  if ('rating' in record) {
    const rating = record['rating'];
    if (rating !== null && !isStarRating(rating)) {
      return { ok: false, message: '"rating" must be 1 to 5 stars, or null for unrated.' };
    }
    out.rating = rating;
  }
  return { ok: true, ...out };
}

export function parseFinishedRequest(body: unknown): Parsed<FinishedRequest> {
  if (!isObject(body)) return { ok: false, message: 'Finished watching must be an object.' };
  if (Object.keys(body).some((key) => !['seasons', 'watchedOn', 'rating'].includes(key))) {
    return { ok: false, message: 'Supply seasons, watchedOn and/or rating, with no other fields.' };
  }
  const seasons = body['seasons'];
  if (
    !Array.isArray(seasons) ||
    seasons.length === 0 ||
    seasons.length > 100 ||
    !seasons.every((n) => Number.isInteger(n) && n >= 0 && n <= 1000)
  ) {
    return { ok: false, message: '"seasons" must list at least one season number.' };
  }
  const read = readDayAndRating(body);
  if (!read.ok) return read;
  return {
    ok: true,
    value: {
      seasons: [...new Set(seasons as number[])].sort((a, b) => a - b),
      watchedOn: read.watchedOn,
      rating: read.rating,
    },
  };
}

export function parseWatchedPatch(body: unknown): Parsed<WatchedPatch> {
  if (!isObject(body)) return { ok: false, message: 'The change must be an object.' };
  if (
    Object.keys(body).length === 0 ||
    Object.keys(body).some((k) => k !== 'watchedOn' && k !== 'rating')
  ) {
    return { ok: false, message: 'Supply watchedOn and/or rating, with no other fields.' };
  }
  const read = readDayAndRating(body);
  if (!read.ok) return read;
  return {
    ok: true,
    value: {
      ...(read.watchedOn === undefined ? {} : { watchedOn: read.watchedOn }),
      ...(read.rating === undefined ? {} : { rating: read.rating }),
    },
  };
}

export interface SeasonProgress {
  seasonNumber: number;
  airDate: string | null;
  /** Aired on or before today; an undated season has not aired. */
  aired: boolean;
  finished: boolean;
}

/** Join TMDB's season list to the owner's records. Specials never appear. */
export function seasonProgress(
  seasons: readonly { seasonNumber: number; airDate: string | null }[],
  finishedSeasons: ReadonlySet<number>,
  today: string,
): SeasonProgress[] {
  return seasons
    .filter((season) => season.seasonNumber >= 1)
    .map((season) => ({
      seasonNumber: season.seasonNumber,
      airDate: season.airDate,
      aired: season.airDate !== null && season.airDate <= today,
      finished: finishedSeasons.has(season.seasonNumber),
    }));
}

/**
 * True only when at least one season has aired and every aired season is
 * finished. A season added later is simply unwatched, so this goes false again.
 */
export function allAiredSeasonsFinished(progress: readonly SeasonProgress[]): boolean {
  const aired = progress.filter((season) => season.aired);
  return aired.length > 0 && aired.every((season) => season.finished);
}
