/**
 * Runtime: buckets, ordering and display (REQ-119 / REQ-035 / REQ-037, `A48`).
 *
 * ⚠ **Not to be confused with `runtime.ts`**, which is about the JavaScript
 * runtime. This module is about how long a title is.
 *
 * Everything here is pure and shared on purpose. The bucket boundaries decide
 * BOTH which rows the database returns and which bucket the UI says it asked
 * for; two implementations of `[lower, upper)` that disagree by one minute
 * produce a list whose contents contradict its own filter chip, and no test on
 * either side alone can see it.
 */

/** Canonical bucket tokens, in picker order. */
export const RUNTIME_BUCKETS = ['under30', '30-60', '60-90', '90-120', 'over120'] as const;
export type RuntimeBucket = (typeof RUNTIME_BUCKETS)[number];

/**
 * Half-open `[lower, upper)` bounds in minutes; `upper: null` is unbounded.
 *
 * ⚠ **Half-open is not a detail (`specs/api.md` §6.2).** With an inclusive
 * upper bound a 60-minute film satisfies both `30-60` and `60-90`, so the
 * same title appears under two filters and any count taken over the buckets
 * disagrees with the list it describes. `T-UX-123` pins the 60-minute case
 * precisely because it is the one that looks arbitrary and is not.
 */
export const RUNTIME_BUCKET_BOUNDS: Readonly<
  Record<RuntimeBucket, { readonly lower: number | null; readonly upper: number | null }>
> = {
  under30: { lower: null, upper: 30 },
  '30-60': { lower: 30, upper: 60 },
  '60-90': { lower: 60, upper: 90 },
  '90-120': { lower: 90, upper: 120 },
  over120: { lower: 120, upper: null },
};

/**
 * Is this a runtime at all?
 *
 * ⚠ **`0` IS NOT A RUNTIME, AND THIS IS THE ONE PLACE THAT DECIDES SO.** TMDB
 * returns `runtime: 0` for works it has no runtime for, so zero reaches the
 * column as an ordinary value. Every consumer must agree about it or the
 * product contradicts itself in a way no single test can see: a `0` that
 * DISPLAYS as "Runtime unknown" while SATISFYING the "Under 30m" filter puts a
 * row labelled unknown inside a bucket that excludes unknowns, leaves it out
 * of the hidden-unknown count that is supposed to account for it, and sorts it
 * to the very top of "Shortest first" as the shortest thing the owner owns.
 *
 * Negative and non-finite are folded in for the same reason: they are not
 * lengths either, and `Infinity` would render as `Infinityh`.
 */
export function isKnownRuntime(minutes: number | null): minutes is number {
  return minutes !== null && Number.isFinite(minutes) && minutes > 0;
}

export function isRuntimeBucket(value: string): value is RuntimeBucket {
  return (RUNTIME_BUCKETS as readonly string[]).includes(value);
}

/**
 * Expand legacy URLs and deduplicate in first-occurrence order.
 * Unknown tokens are dropped for the web parser; API callers must reject
 * any supplied token whose individual normalization is empty.
 */
export function normalizeRuntimeBuckets(values: readonly string[]): RuntimeBucket[] {
  const buckets = new Set<RuntimeBucket>();
  for (const value of values) {
    if (value === '60-120') {
      buckets.add('60-90');
      buckets.add('90-120');
    } else if (isRuntimeBucket(value)) {
      buckets.add(value);
    }
  }
  return [...buckets];
}

/**
 * Does a runtime fall in this bucket?
 *
 * ⚠ **`null` satisfies NO bucket and is never coerced to `0`** (`specs/api.md`
 * §6.2). A title whose runtime TMDB never supplied is excluded while any
 * bucket is selected — the same rule `genres: []` follows — and coercing it to
 * `0` would instead file every unknown runtime under "Under 30m", which reads
 * as a claim that those titles are short.
 *
 * ⚠ **And neither does a stored `0`** — see {@link isKnownRuntime}. Without
 * that guard `under30` (`[null, 30)`) admits it, which is the coercion above
 * arriving by the back door.
 */
export function runtimeInBucket(minutes: number | null, bucket: RuntimeBucket): boolean {
  if (!isKnownRuntime(minutes)) return false;
  const { lower, upper } = RUNTIME_BUCKET_BOUNDS[bucket];
  if (lower !== null && minutes < lower) return false;
  if (upper !== null && minutes >= upper) return false;
  return true;
}

/** OR within the dimension, exactly as `service` and `genre` are (US-019 AC-4). */
export function runtimeInAnyBucket(
  minutes: number | null,
  buckets: readonly RuntimeBucket[],
): boolean {
  if (buckets.length === 0) return true;
  return buckets.some((bucket) => runtimeInBucket(minutes, bucket));
}

/** The minimum a row must expose to be ordered by runtime. */
export interface RuntimeOrderableTitle {
  readonly runtimeMinutes: number | null;
  readonly id: string;
}

/**
 * Total order by runtime: `dir`, **`NULL`s last in BOTH directions**, ties
 * broken by `id` ascending in both directions.
 *
 * ⚠ **Nulls-last is decided BEFORE direction**, exactly as
 * {@link compareTitlesForList} decides it, and for a sharper reason here:
 * SQL Server sorts `NULL` FIRST on `ASC`, so "Shortest first" would otherwise
 * open with every title whose runtime is unknown — an absence of data
 * presented as a claim that those titles are the shortest.
 *
 * ⚠ This comparator does NOT order the list; SQL does. It exists so the
 * integration suite has something to check the query against rather than a
 * hand-written expected sequence, which would only ever agree with whatever
 * its author believed.
 */
export function compareTitlesByRuntime(
  a: RuntimeOrderableTitle,
  b: RuntimeOrderableTitle,
  dir: 'asc' | 'desc',
): number {
  // ⚠ `isKnownRuntime`, NOT `=== null`. A stored `0` is unknown everywhere
  // else (it displays as "Runtime unknown" and satisfies no bucket), so
  // ordering it as the shortest title in the library would contradict both.
  const aKnown = isKnownRuntime(a.runtimeMinutes);
  const bKnown = isKnownRuntime(b.runtimeMinutes);

  if (!aKnown || !bKnown) {
    if (!aKnown && !bKnown) return compareIdAscending(a, b);
    return aKnown ? -1 : 1;
  }

  if (a.runtimeMinutes !== b.runtimeMinutes) {
    const ascending = (a.runtimeMinutes ?? 0) < (b.runtimeMinutes ?? 0) ? -1 : 1;
    return dir === 'asc' ? ascending : -ascending;
  }

  return compareIdAscending(a, b);
}

function compareIdAscending(a: RuntimeOrderableTitle, b: RuntimeOrderableTitle): number {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * The runtime as the row displays it, or `null` when there is none to show.
 *
 * Film renders `1h 55m`; TV renders `45m/ep` (REQ-119).
 *
 * ⚠ **THE `/ep` SUFFIX ON TV IS THE REQUIREMENT, NOT A FLOURISH.** TMDB gives
 * a series an `episode_run_time` ARRAY and `tmdbClient.readRuntime` takes its
 * first element, so **the stored number is one episode**. Rendered bare beside
 * a nine-season series, `45m` is a false statement about the work — and false
 * in the direction that matters, because the owner is choosing what to watch
 * tonight. Total-series runtime cannot be had without summing every season, so
 * per-episode is the only semantic the stored data supports; naming it in the
 * label is what makes it honest.
 *
 * ⚠ **`null` is returned, NOT a string**, so the caller is forced to decide
 * what an unknown runtime says. It must say so in words (REQ-119) — the copy
 * lives in `apps/web/src/copy.ts` under `specs/ui.md` §9's governance, not
 * here.
 *
 * ⚠ **A non-positive or non-finite runtime is treated as UNKNOWN**, not
 * rendered. `0m` is not a length, and `Infinity` from a corrupt row would
 * render as `Infinityh`. The column is nullable and TMDB occasionally stores
 * `0`, so this is a real value, not a defensive hypothetical.
 */
export function formatRuntime(minutes: number | null, mediaType: 'movie' | 'tv'): string | null {
  if (!isKnownRuntime(minutes)) return null;

  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;

  // Under an hour renders as minutes alone: `0h 45m` is noise, and for TV the
  // per-episode case is overwhelmingly this branch.
  const base =
    hours === 0
      ? `${String(rest)}m`
      : rest === 0
        ? `${String(hours)}h`
        : `${String(hours)}h ${String(rest)}m`;

  return mediaType === 'tv' ? `${base}/ep` : base;
}
