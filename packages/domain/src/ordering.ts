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
function compareIdAscending(a: { readonly id: string }, b: { readonly id: string }): number {
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

/** The minimum a row must expose to be ordered by a nullable numeric key. */
export interface NullableKeyOrderableTitle {
  readonly key: number | null;
  readonly id: string;
}

/**
 * Total order by a NULLABLE NUMERIC key — release year, or IMDb rating tenths
 * (`A53`). `dir`, **`NULL`s last in BOTH directions**, ties broken by `id`
 * ascending in both directions.
 *
 * ⚠ **NULLS-LAST IS DECIDED BEFORE DIRECTION**, the same rule as
 * {@link compareTitlesForList} and `compareTitlesByRuntime`, and for the same
 * sharp reason. SQL Server sorts `NULL` FIRST on `ASC`, so "Oldest first"
 * would open with every title whose year is unknown, and "Lowest rated first"
 * would open with every title nobody has rated — presenting an absence of data
 * as a claim about the work. The rating case is the worse of the two, because
 * the list would then read as an opinion the product does not hold.
 *
 * ⚠ This comparator does NOT order the list; SQL does. It exists so the
 * integration suite has something to check the query against rather than a
 * hand-written expected sequence, which would only ever agree with whatever
 * its author believed.
 *
 * ⚠ **The rating key is TENTHS, the stored integer — never the displayed
 * float.** `8.4` and `84` order identically among themselves, so a test fed
 * floats passes; the cursor built from the last row then carries a float into
 * an integer keyset and the boundary row vanishes.
 */
export function compareTitlesByNullableKey(
  a: NullableKeyOrderableTitle,
  b: NullableKeyOrderableTitle,
  dir: SortDirection,
): number {
  if (a.key === null || b.key === null) {
    if (a.key === null && b.key === null) return compareIdAscending(a, b);
    return a.key === null ? 1 : -1;
  }

  if (a.key !== b.key) {
    const ascending = a.key < b.key ? -1 : 1;
    return dir === 'asc' ? ascending : -ascending;
  }

  return compareIdAscending(a, b);
}

/** The minimum a row must expose to be ordered by name (TASK-219). */
export interface NameOrderableTitle {
  /** The stored `sortName` — see `deriveSortName`. `null` sorts last. */
  readonly sortName: string | null;
  readonly id: string;
}

/**
 * Case- and accent-insensitive comparison, mirroring the `sort_name` column's
 * `Latin1_General_100_CI_AI` collation.
 *
 * ⚠ **`sensitivity: 'base'` IS THE POINT, NOT A DETAIL.** It makes `amelie`,
 * `Amelie` and `Amélie` compare EQUAL, which is what CI_AI does — the second
 * `I` is accent-INsensitive, and it is easy to read the name as case-only.
 * A comparator that distinguished accents would disagree with the database on
 * exactly the rows this feature exists to order correctly, and the integration
 * suite would then be asserting the wrong sequence with total confidence.
 *
 * ⚠ It follows that equal keys are COMMON here, not a corner case, and the
 * `id` tie-break is what keeps the order total. Without it the keyset boundary
 * between `Amelie` and `Amélie` is ambiguous and one of them can vanish
 * between pages.
 */
const NAME_COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: false });

/**
 * Total order by name: `sortName` in `dir`, **`NULL`s last in BOTH
 * directions**, ties broken by `id` ascending in both directions.
 *
 * ⚠ **THIS DOES NOT ORDER THE LIST; SQL DOES** (`ORDER BY [sort_name]`, which
 * picks up the column's CI_AI collation). It exists so the integration suite
 * has something to check the query against rather than a hand-written expected
 * sequence, which would only ever agree with whatever its author believed —
 * and for a collation-dependent order that is a very easy thing to get wrong.
 *
 * ⚠ **NULLS-LAST IS DECIDED BEFORE DIRECTION**, the same rule as every other
 * key here. SQL Server sorts `NULL` FIRST on `ASC`, so "A–Z" would otherwise
 * open with every title whose name could not be read from the screenshot.
 */
export function compareTitlesByName(
  a: NameOrderableTitle,
  b: NameOrderableTitle,
  dir: SortDirection,
): number {
  if (a.sortName === null || b.sortName === null) {
    if (a.sortName === null && b.sortName === null) return compareIdAscending(a, b);
    return a.sortName === null ? 1 : -1;
  }

  const ascending = NAME_COLLATOR.compare(a.sortName, b.sortName);
  if (ascending !== 0) {
    return dir === 'asc' ? ascending : -ascending;
  }

  return compareIdAscending(a, b);
}
