/**
 * TASK-036 — the combined list's ordering rule, stated once (US-020).
 *
 * The list is ordered in SQL, not in JavaScript, so it is fair to ask what a
 * comparator is doing here. It exists because the ordering rule has three
 * parts that are easy to get individually right and collectively wrong —
 * the sort key, the tie-breaker, and the null placement — and SQL expresses
 * all three implicitly, in dialect-specific defaults that are invisible at
 * the call site:
 *
 *   - SQL Server sorts `NULL` **first** on `ASC` and **last** on `DESC`. So
 *     "nulls last" is free in the default direction and silently wrong the
 *     moment the owner reverses it (`T-LIST-027`). Nothing about the query
 *     text says so.
 *   - A tie-breaker written `ORDER BY date <dir>, id <dir>` looks symmetric
 *     and reads correctly, but it makes the tie order **flip with the sort
 *     direction**, which `T-LIST-016` forbids: ties break by `id` ASCENDING
 *     in both directions, or reversing the list silently reshuffles rows
 *     that share a date.
 *
 * Stating the rule as a total order here gives the integration suite
 * something to check the database against (`T-LIST-016`, `T-LIST-025`,
 * `T-LIST-026`, `T-LIST-027`) rather than re-deriving the expected sequence
 * by hand in each case — a hand-written expectation agrees with whatever the
 * author believed, which is the failure mode this whole rule exists to avoid.
 *
 * ⚠ This comparator is NOT a substitute for the SQL `ORDER BY`. Ordering in
 * the application would require reading every row before paging, which §3
 * forbids. The two must agree; the tests are what make that true.
 */

/** Sort direction. `desc` (newest-first) is the confirmed default — REQ-038, A44. */
export type SortDirection = 'asc' | 'desc';

/** The minimum a row must expose to be ordered. */
export interface OrderableTitle {
  /**
   * Earliest `dateAdded` across the title's non-removed listings, as
   * `YYYY-MM-DD`. `null` when the title holds no non-removed listing.
   */
  readonly sortDateAdded: string | null;
  readonly id: string;
}

/**
 * Total order over list rows: `sortDateAdded` in `dir`, nulls always last,
 * ties broken by `id` ascending in **both** directions.
 *
 * Dates compare lexicographically. `YYYY-MM-DD` sorts correctly as text and
 * carries no time or zone, so no host timezone can shift a row by a day —
 * the same reasoning as `deriveSortDateAdded` (`T-INV-010`).
 */
export function compareTitlesForList(
  a: OrderableTitle,
  b: OrderableTitle,
  dir: SortDirection,
): number {
  // Nulls last is absolute: it is decided BEFORE direction is considered, so
  // reversing the list cannot lift a dateless row to the top.
  if (a.sortDateAdded === null || b.sortDateAdded === null) {
    if (a.sortDateAdded === null && b.sortDateAdded === null) return compareIdAscending(a, b);
    return a.sortDateAdded === null ? 1 : -1;
  }

  if (a.sortDateAdded !== b.sortDateAdded) {
    const ascending = a.sortDateAdded < b.sortDateAdded ? -1 : 1;
    return dir === 'asc' ? ascending : -ascending;
  }

  return compareIdAscending(a, b);
}

/**
 * The tie-breaker, ascending regardless of `dir`.
 *
 * Extracted so the two call sites above cannot drift apart, and so that a
 * change to it is a change to one named thing rather than to two expressions
 * that merely happen to match.
 */
function compareIdAscending(a: OrderableTitle, b: OrderableTitle): number {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * `rows` sorted by {@link compareTitlesForList}. Does not mutate its input —
 * an in-place sort of a caller's array is exactly the kind of surprise a pure
 * domain package should not hold.
 */
export function sortTitlesForList<T extends OrderableTitle>(
  rows: readonly T[],
  dir: SortDirection,
): T[] {
  return [...rows].sort((a, b) => compareTitlesForList(a, b, dir));
}
