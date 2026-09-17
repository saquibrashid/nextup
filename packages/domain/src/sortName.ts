/**
 * TASK-219 — the stored sort key behind `sort=name` (`T-API-029`).
 *
 * WHY THIS IS A STORED COLUMN AND NOT AN `ORDER BY tmdb_name`
 * ----------------------------------------------------------
 * The database default collation is `Latin1_General_100_BIN2`
 * (`specs/data-model.md` §16.2.1), which is BINARY. It is not a style choice:
 * Prisma's `create()` joins a `DECLARE @generated_keys table([id] …)` variable
 * back to a `BIN2` `[id]` column, and any other database default makes every
 * insert fail with `Msg 468`. So it cannot be relaxed.
 *
 * Under binary order `apple` sorts after `Zebra`, and `Amélie` (`0xE9`) sorts
 * after every unaccented word. ⚠ **On a title-cased fixture that still looks
 * alphabetical**, which is precisely how this feature would ship broken while
 * every obvious test passed.
 *
 * The fix is a column declared `COLLATE Latin1_General_100_CI_AI` — see
 * migration `0010_title_sort_name`. SQL Server applies the COLUMN's collation
 * to a bare `ORDER BY`, so Prisma's ordinary `orderBy` yields case- and
 * accent-insensitive human order with no raw SQL, and therefore without taking
 * the list query outside `T-SEC-021`'s textual `ownerId` check.
 *
 * WHY THE VALUE IS COMPUTED HERE AND NOWHERE ELSE
 * -----------------------------------------------
 * `specs/data-model.md` §16 I-4 states the rule: derived values stay in one
 * TypeScript function, because a generated column or a hand-written backfill
 * splits the logic across two languages that then drift in silence. The
 * backfill script calls THIS function; so does every write site. `T-INV-025`
 * asserts the stored column equals what this function returns, for every row.
 */

/**
 * Matches `title.sort_name NVARCHAR(400)` — see migration `0010`.
 *
 * ⚠ **400, NOT 500, AND THE LIMIT IS THE INDEX — NOT THE TITLE.** `sort_name`
 * is the third key column of `title_list_name (owner_id, state, sort_name,
 * id)`, and SQL Server caps a nonclustered index key at **1700 bytes**. The
 * other three columns spend 832 (`owner_id` 400 + `state` 32 + `id` 400), so
 * `NVARCHAR(500)` at 1000 bytes totals 1832 and SQL Server accepts the
 * `CREATE INDEX` with only a **warning** — then fails the INSERT at runtime
 * for any row whose combined key actually exceeds the limit. 400 chars = 800
 * bytes = 1632 total, comfortably inside it.
 *
 * This truncates the SORT KEY only, never the displayed name, and it can only
 * affect the relative order of two titles sharing their first 400 characters.
 */
export const SORT_NAME_MAX_LENGTH = 400;

/**
 * The articles stripped before ordering.
 *
 * ⚠ **ENGLISH ONLY, AND THE ABSENCE OF THE OTHERS IS THE DECISION** (owner,
 * 2026-09-15). In an English-market streaming list a foreign article reads
 * as part of the title, not as grammar: the owner looks for *Les Misérables*
 * under **L**, *El Camino* under **E** and *Das Boot* under **D**, and both
 * services file them that way too.
 *
 * ⚠ **DO NOT "COMPLETE" THIS LIST.** Adding `le/la/les/el/los/der/die/das`
 * looks like an improvement and is a regression against an explicit decision.
 * It also reintroduces a collision that has no clean fix: `die` is both a
 * German article and a common English verb, so *Die Hard* would file under
 * **H**. There is no `original_language` column to disambiguate with, so the
 * only way to get it right is not to guess.
 *
 * `T-API-029` pins *Les Misérables* under **L** and *El Camino* under **E** so
 * that re-adding them fails loudly rather than quietly reordering the list.
 */
const LEADING_ARTICLES = ['a', 'an', 'the'] as const;

/**
 * Whitespace normalisation applied before anything else.
 *
 * ⚠ It is not cosmetic. `rawExtractedText` comes from OCR of a screenshot and
 * routinely carries newlines and runs of spaces; a leading space sorts BEFORE
 * every letter under any collation, so one stray character would pin a title
 * to the top of the list for a reason nothing on screen could explain.
 */
function normaliseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/**
 * The ordering key for a title, or `null` when it has no usable name.
 *
 * ⚠ **THE SOURCE IS THE DISPLAYED NAME, NOT `tmdbName`** (owner decision,
 * 2026-09-15). `tmdbName` is `null` for an unmatched title and the UI shows
 * its `rawExtractedText` instead, so ordering by `tmdbName` alone would sort a
 * chunk of the owner's list by a value they cannot see — a row filed under a
 * letter its visible title does not start with.
 *
 * `null` is returned when neither source has content. Those rows sort LAST in
 * both directions, exactly as the runtime, release-year and rating keys treat
 * their unknowns: an absence of data must never be presented as a claim.
 */
export function deriveSortName(title: {
  readonly tmdbName: string | null;
  readonly rawExtractedText: string | null;
}): string | null {
  const source = title.tmdbName ?? title.rawExtractedText;
  if (source === null) return null;

  const normalised = normaliseWhitespace(source);
  if (normalised.length === 0) return null;

  return truncate(stripLeadingArticle(normalised));
}

/**
 * Remove one leading article, if doing so leaves a title behind.
 *
 * ⚠ **THE "SOMETHING REMAINS" GUARD IS LOAD-BEARING, NOT DEFENSIVE.** Films
 * called *A*, *Us* and *Them* exist, and a screenshot line can legitimately
 * read just `The`. Stripping unconditionally turns those into an empty key,
 * which collapses them into one indistinguishable block at the top of the
 * list. Requiring a following word means the article is only removed when it
 * is functioning as an article.
 *
 * Only ONE article is removed. *"The A Team"* files under **A**, not under
 * *Team*; repeated stripping would keep eating real words.
 */
function stripLeadingArticle(value: string): string {
  const lower = value.toLowerCase();

  for (const article of LEADING_ARTICLES) {
    const prefix = `${article} `;
    if (!lower.startsWith(prefix)) continue;

    const remainder = value.slice(prefix.length).trim();
    // Never strip down to nothing — see the guard note above.
    return remainder.length === 0 ? value : remainder;
  }

  return value;
}

/**
 * ⚠ Truncation happens AFTER the article is stripped, so the 500 characters
 * stored are 500 characters of the part that actually orders the row. A
 * silently over-long value would be rejected by SQL Server as a write error
 * rather than sorted wrongly, but the write would be the owner's upload
 * failing — so it is capped here instead.
 */
function truncate(value: string): string {
  return value.length > SORT_NAME_MAX_LENGTH ? value.slice(0, SORT_NAME_MAX_LENGTH) : value;
}
