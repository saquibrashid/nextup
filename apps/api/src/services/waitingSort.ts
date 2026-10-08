/**
 * #415 (PRD `A56`, US-065, REQ-131) — the order of `GET /api/waiting`.
 *
 * Pure: no clock, no I/O. The route sorts the page IN MEMORY, after it has
 * built every item, because the expected-availability date is the forecast
 * computed in that same request (#380) — SQL has nothing to order it by.
 *
 * Rules, in priority order, for every key and both directions:
 *
 * 1. **A row streaming on one of the owner's services leads** (#378: noticing
 *    that moment is what the view is for). Before #415 the client moved those
 *    rows up; that is now this module's job, so the client never re-orders.
 * 2. The chosen key, in the chosen direction. ⚠ A row with NO value for the
 *    key (no forecast, no release year) sorts LAST in BOTH directions.
 * 3. Stable tie-breakers, fixed whatever the direction: sort name A→Z, then
 *    intent id. The same page always comes back in the same order.
 */

import { deriveSortName, type StreamingForecast } from '@nextup/domain';

export const WAITING_SORTS = ['expected', 'discovered', 'name', 'releaseYear'] as const;
export type WaitingSort = (typeof WAITING_SORTS)[number];
export type WaitingSortDirection = 'asc' | 'desc';

/** Expected availability, soonest first: the question the page answers. */
export const DEFAULT_WAITING_SORT: WaitingSort = 'expected';

/** Each key's natural direction (cf. the Library's `DEFAULT_DIRECTION_BY_SORT`). */
export const DEFAULT_WAITING_DIRECTION: Readonly<Record<WaitingSort, WaitingSortDirection>> = {
  expected: 'asc',
  discovered: 'desc',
  name: 'asc',
  releaseYear: 'desc',
};

/** The facts one row is ordered by. */
export interface WaitingSortFacts {
  intentId: string;
  tmdbName: string | null;
  rawExtractedText: string | null;
  discoveredAt: Date;
  releaseYear: number | null;
  forecast: StreamingForecast | null;
  /** Streaming on a service the owner uses — the row leads (#378). */
  onYourServices: boolean;
}

const collator = new Intl.Collator('en', { sensitivity: 'base' });

/**
 * Where a forecast falls: announced dates (a published fact) before estimates
 * (a guess), each dated to the day. An `estimate-soon` row's expected month
 * has already passed, so it is the soonest estimate there can be. `null` is
 * "no date" — the caller puts it last.
 */
export function expectedPosition(
  forecast: StreamingForecast | null,
): { tier: 0 | 1; date: string } | null {
  if (forecast === null) return null;
  switch (forecast.kind) {
    case 'announced':
      return { tier: 0, date: forecast.on };
    case 'estimate':
      return { tier: 1, date: `${forecast.month}-01` };
    case 'estimate-range':
      return { tier: 1, date: `${forecast.from}-01` };
    case 'estimate-soon':
      return { tier: 1, date: '' };
  }
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Compares two present values; `undefined` is absent and always last. */
function compareKey(
  a: number | string | undefined,
  b: number | string | undefined,
  dir: WaitingSortDirection,
): number {
  if (a === undefined || b === undefined) {
    return a === b ? 0 : a === undefined ? 1 : -1;
  }
  const raw = typeof a === 'number' && typeof b === 'number' ? a - b : compareText(`${a}`, `${b}`);
  return dir === 'asc' ? raw : -raw;
}

/**
 * ⚠ The expected key encodes tier and date in ONE string so that `desc` is
 * the exact mirror of `asc` over the dated rows (latest estimate first, the
 * soonest announced date last), while undated rows stay last either way.
 */
function keyOf(facts: WaitingSortFacts, sort: WaitingSort): number | string | undefined {
  switch (sort) {
    case 'expected': {
      const position = expectedPosition(facts.forecast);
      return position === null ? undefined : `${position.tier}:${position.date}`;
    }
    case 'discovered':
      return facts.discoveredAt.getTime();
    case 'name':
      return undefined;
    case 'releaseYear':
      return facts.releaseYear ?? undefined;
  }
}

const sortNameOf = (facts: WaitingSortFacts): string =>
  deriveSortName({ tmdbName: facts.tmdbName, rawExtractedText: facts.rawExtractedText }) ?? '';

/** The comparator. Exported for the unit tests; the route calls {@link sortWaiting}. */
export function compareWaiting(
  a: WaitingSortFacts,
  b: WaitingSortFacts,
  sort: WaitingSort,
  dir: WaitingSortDirection,
): number {
  if (a.onYourServices !== b.onYourServices) return a.onYourServices ? -1 : 1;
  const nameOrder = collator.compare(sortNameOf(a), sortNameOf(b));
  if (sort === 'name') {
    if (nameOrder !== 0) return dir === 'asc' ? nameOrder : -nameOrder;
  } else {
    const byKey = compareKey(keyOf(a, sort), keyOf(b, sort), dir);
    if (byKey !== 0) return byKey;
    if (nameOrder !== 0) return nameOrder;
  }
  return compareText(a.intentId, b.intentId);
}

/** A new array in the requested order; `factsOf` reads each row's facts. */
export function sortWaiting<T>(
  rows: readonly T[],
  factsOf: (row: T) => WaitingSortFacts,
  sort: WaitingSort,
  dir: WaitingSortDirection,
): T[] {
  const facts = new Map(rows.map((row) => [row, factsOf(row)]));
  return [...rows].sort((a, b) =>
    compareWaiting(facts.get(a) as WaitingSortFacts, facts.get(b) as WaitingSortFacts, sort, dir),
  );
}
