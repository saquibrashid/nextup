/**
 * #380 — when and where a waiting title is expected to start streaming.
 *
 * Two sources, never confused with each other:
 *
 * 1. **Announced** — a date a service has published, via Watchmode's upcoming
 *    releases feed. A fact.
 * 2. **Estimate** — a guess from the studio's current first-streaming ("pay-1")
 *    deal and the US rent/buy date, both from TMDB. ⚠ ALWAYS labelled as an
 *    estimate, never sorted on (owner decision 3 on #380), and never shown as
 *    a fact. An announced date always replaces it.
 *
 * ⚠ **"No estimate" is the answer whenever the studio is unknown or two mapped
 * studios disagree.** The #380 spike found that every mapped studio's movies
 * were on the mapped service; the misses were unmapped studios. Guessing
 * beyond the map turns a reliable hint into noise, so the map stays narrow.
 *
 * Pure: no clock of its own, no I/O.
 */

import { SERVICES, type Service } from './enums.js';

/**
 * TMDB production-company id → the service that studio's theatrical movies
 * stream on first in the US. Ids verified against TMDB `/search/company` on
 * 2026-09-24 (#380). ⚠ Deals change: this is reviewed data, not a derivation.
 */
export const STUDIO_STREAMING_HOMES: Readonly<Record<number, Service>> = {
  // Universal → Peacock
  33: 'peacock', // Universal Pictures
  6704: 'peacock', // Illumination
  10146: 'peacock', // Focus Features
  521: 'peacock', // DreamWorks Animation
  // Warner Bros. → HBO Max
  174: 'max', // Warner Bros. Pictures
  12: 'max', // New Line Cinema
  184898: 'max', // DC Studios
  429: 'max', // DC
  2785: 'max', // Warner Bros. Animation
  // Disney → Disney+
  2: 'disney-plus', // Walt Disney Pictures
  3: 'disney-plus', // Pixar
  1: 'disney-plus', // Lucasfilm Ltd.
  420: 'disney-plus', // Marvel Studios
  127928: 'disney-plus', // 20th Century Studios
  127929: 'disney-plus', // Searchlight Pictures
  6125: 'disney-plus', // Walt Disney Animation Studios
  // Paramount → Paramount+
  4: 'paramount-plus', // Paramount Pictures
  2348: 'paramount-plus', // Nickelodeon Movies
  24955: 'paramount-plus', // Paramount Animation
  // Sony → Netflix
  5: 'netflix', // Columbia Pictures
  2251: 'netflix', // Sony Pictures Animation
  3287: 'netflix', // Screen Gems
  559: 'netflix', // TriStar Pictures
  // Lionsgate → Starz
  1632: 'starz', // Lionsgate
  // Amazon MGM → Prime Video
  210099: 'prime-video', // Amazon MGM Studios
  21: 'prime-video', // Metro-Goldwyn-Mayer
  41: 'prime-video', // Orion Pictures
};

/**
 * Typical days from the US rent/buy (TMDB digital, type 4) release to the
 * first subscription window, per service. Rough by design: the estimate is
 * shown to the month.
 */
export const DAYS_FROM_DIGITAL_TO_STREAMING: Readonly<Record<Service, number>> = {
  netflix: 80,
  max: 50,
  'prime-video': 21,
  'disney-plus': 45,
  'apple-tv-plus': 45,
  'paramount-plus': 30,
  starz: 140,
  peacock: 75,
};

/** Typical days from US theatrical release to rent/buy, for the range fallback. */
export const DAYS_FROM_THEATRICAL_TO_DIGITAL = 30;

/** Half-width of the range shown when only the theatrical date is known. */
export const ESTIMATE_RANGE_HALF_WIDTH_DAYS = 45;

/**
 * Watchmode's free-plan attribution (#380). Rendered wherever an announced
 * date may appear. The two facts — the source is Watchmode, and the dates are
 * announcements — may not be dropped.
 */
export const WATCHMODE_ATTRIBUTION = 'Announced streaming dates are supplied by Watchmode.';

export const WATCHMODE_ATTRIBUTION_URL = 'https://www.watchmode.com/';

export type StreamingForecast =
  | { kind: 'announced'; service: Service; on: string }
  | { kind: 'estimate'; service: Service; month: string }
  | { kind: 'estimate-range'; service: Service; from: string; to: string }
  | { kind: 'estimate-soon'; service: Service };

export interface ForecastInput {
  mediaType: string | null;
  /** TMDB production-company ids, in TMDB's order. `null` = not known. */
  companyIds: readonly number[] | null;
  /** `YYYY-MM-DD`, US. */
  theatricalOn: string | null;
  /** `YYYY-MM-DD`, US rent/buy. */
  digitalOn: string | null;
  announced: { service: Service; on: string } | null;
  /** `YYYY-MM-DD`, the caller's today. */
  today: string;
}

const MS_PER_DAY = 86_400_000;

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

function month(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * The one service the mapped studios agree on, or `null` when none is mapped
 * or they disagree.
 */
export function studioStreamingHome(companyIds: readonly number[] | null): Service | null {
  if (companyIds === null) return null;
  const homes = new Set<Service>();
  for (const id of companyIds) {
    const home = STUDIO_STREAMING_HOMES[id];
    if (home !== undefined) homes.add(home);
  }
  if (homes.size !== 1) return null;
  const [only] = homes;
  return only ?? null;
}

export function streamingForecast(input: ForecastInput): StreamingForecast | null {
  if (input.announced !== null) return { kind: 'announced', ...input.announced };
  // TV: announced dates only. Series have no pay-1 window to estimate from.
  if (input.mediaType !== 'movie') return null;

  const service = studioStreamingHome(input.companyIds);
  if (service === null) return null;
  const days = DAYS_FROM_DIGITAL_TO_STREAMING[service];
  const thisMonth = month(input.today);

  if (input.digitalOn !== null) {
    const expected = month(addDays(input.digitalOn, days));
    return expected < thisMonth
      ? { kind: 'estimate-soon', service }
      : { kind: 'estimate', service, month: expected };
  }

  if (input.theatricalOn !== null) {
    const centre = addDays(input.theatricalOn, DAYS_FROM_THEATRICAL_TO_DIGITAL + days);
    const to = month(addDays(centre, ESTIMATE_RANGE_HALF_WIDTH_DAYS));
    if (to < thisMonth) return { kind: 'estimate-soon', service };
    const earliest = month(addDays(centre, -ESTIMATE_RANGE_HALF_WIDTH_DAYS));
    const from = earliest < thisMonth ? thisMonth : earliest;
    return from === to
      ? { kind: 'estimate', service, month: from }
      : { kind: 'estimate-range', service, from, to };
  }

  return null;
}

/** Narrow an unknown string to a `Service`, or `null`. */
export function asService(value: string | null | undefined): Service | null {
  return SERVICES.find((service) => service === value) ?? null;
}
