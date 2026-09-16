/**
 * Query parsing for `GET /api/titles` (`specs/api.md` §6.2).
 *
 * Kept separate from the handler, and validated BEFORE any store lookup, for
 * two reasons. First, a malformed request must be a 400 regardless of what is
 * in the database — reversing the order makes the same bad request return 400
 * or 200 depending on unrelated state. Second, it keeps every rejection path
 * reachable without a database, which is what lets the unit suite (CI job 4,
 * where coverage is measured and no store exists) assert them.
 *
 * ⚠ `ownerId` is NOT read here and must never be. It comes from the
 * authenticated principal via `attachOwnerScope` and from nowhere else
 * (`T-SEC-006`); a query string that could name the owner would let any caller
 * read any owner's list.
 */

import {
  MEDIA_TYPES,
  RUNTIME_BUCKETS,
  SERVICES,
  normalizeRuntimeBuckets,
  type MediaType,
  type RuntimeBucket,
  type Service,
} from '@nextup/domain';
import type { Request } from 'express';

import { AppError } from '../errors/AppError.js';
import {
  decodeCursor,
  decodeNameCursor,
  decodeRatingCursor,
  decodeReleaseYearCursor,
  decodeRuntimeCursor,
  parseLimit,
  type AnyListCursor,
} from '../pagination.js';

/**
 * `specs/api.md` §6.2 — the sort keys, and one default direction.
 *
 * ⚠ **`rating` IS NOT AN ORDINARY KEY HERE.** It is the only MUTABLE one, and
 * REQ-095 forbade it outright until the owner reversed that at `A53`. The
 * reversal is paid for in `titles.ts` by making the rating refresh synchronous
 * — read ADR-0011 Revision 1 and `api.md` §6.2a before touching this list.
 *
 * ⚠ **`name` IS NOT AN ORDINARY KEY EITHER.** It orders by the stored
 * `sortName` column, which is declared `COLLATE Latin1_General_100_CI_AI` in
 * migration `0010` to override the BIN2 database default. Ordering by
 * `tmdbName` instead would be BINARY — `apple` after `Zebra` — and would still
 * look alphabetical on a title-cased fixture. See TASK-219.
 */
export const TITLE_SORTS = ['dateAdded', 'runtime', 'releaseYear', 'rating', 'name'] as const;
export type TitleSort = (typeof TITLE_SORTS)[number];

/**
 * One decoder per sort, keyed by the sort itself.
 *
 * ⚠ **EXHAUSTIVE BY CONSTRUCTION, ON PURPOSE.** `Record<TitleSort, …>` means
 * adding a key to `TITLE_SORTS` without a decoder is a COMPILE error. The
 * previous shape was a ternary chain with a `decodeCursor` fallback, which
 * would have silently handed a new sort the date-ordered decoder — and since
 * `decodeCursor` rejects on keys, every page-2 request for that sort would
 * have failed with `INVALID_CURSOR` long after the change that caused it.
 */
const CURSOR_DECODERS: Record<TitleSort, (raw: string) => AnyListCursor> = {
  dateAdded: decodeCursor,
  runtime: decodeRuntimeCursor,
  releaseYear: decodeReleaseYearCursor,
  rating: decodeRatingCursor,
  name: decodeNameCursor,
};

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/**
 * ⚠ Newest-first is the CONFIRMED default (REQ-038, owner decision A44), and
 * the oldest-first reverse control is a `must`, not a nice-to-have — it is the
 * sole escape hatch for the knowingly-accepted newest-first trade-off against
 * SUC-003. Do not "simplify" `dir` away.
 */
export const DEFAULT_SORT_DIRECTION: SortDirection = 'desc';

/**
 * The default direction PER SORT, for when the client sends `sort` without
 * `dir`.
 *
 * ⚠ **A SINGLE GLOBAL DEFAULT IS WRONG THE MOMENT A NON-DATE KEY EXISTS.**
 * `desc` is correct and owner-confirmed for `dateAdded` (newest first, A44),
 * and it is defensible for `runtime`, `releaseYear` and `rating`, where the
 * interesting end is the high one. Applied to `name` it means `?sort=name`
 * opens at **Z**, which no one has ever meant by "sort by name".
 *
 * ⚠ **THE FAILURE IS INVISIBLE TO THE OBVIOUS TEST.** The UI always sends an
 * explicit `dir`, so every test driven through the UI passes; only a bare
 * `?sort=name` — a bookmark, a shared link, a hand-typed URL — sees it. The
 * default is therefore asserted directly (`T-API-029f`).
 *
 * `DEFAULT_SORT_DIRECTION` remains the value for every other key, so this map
 * states only the exception and cannot drift from it.
 */
const DEFAULT_DIRECTION_BY_SORT: Record<TitleSort, SortDirection> = {
  dateAdded: DEFAULT_SORT_DIRECTION,
  runtime: DEFAULT_SORT_DIRECTION,
  releaseYear: DEFAULT_SORT_DIRECTION,
  rating: DEFAULT_SORT_DIRECTION,
  name: 'asc',
};

export function defaultDirectionFor(sort: TitleSort): SortDirection {
  return DEFAULT_DIRECTION_BY_SORT[sort];
}

/** Bounds the repeatable filters so a hostile query cannot build a huge IN(). */
const MAX_REPEATED_VALUES = 20;
const MAX_GENRE_LENGTH = 60;

/**
 * Characters refused in a genre name (TASK-037).
 *
 * ⚠ This is a CORRECTNESS guard, not decoration, and it is load-bearing for
 * the genre filter's implementation. Genres are stored as a JSON array in one
 * `NVARCHAR(MAX)` column (`specs/data-model.md` §16), and the filter matches
 * the quoted token `"Name"` inside that text. Two character classes break
 * that match in ways that are silent:
 *
 *   - `%`, `_`, `[`, `]` are LIKE metacharacters. Prisma's `contains` compiles
 *     to `LIKE '%value%'` and does **not** escape them, so `?genre=%` would
 *     match every title and read as a filter that had simply found everything.
 *   - `"` and `\` are JSON escapes. A genre containing either is stored
 *     escaped, so the literal token would never match and the filter would
 *     silently return nothing.
 *
 * No TMDB genre name contains any of them, so refusing them costs nothing real
 * and turns both silent behaviours into a loud 400.
 */
const GENRE_FORBIDDEN_CHARS = /[%_[\]"\\]/;

export interface TitleListQuery {
  q: string | undefined;
  services: Service[];
  mediaType: MediaType | undefined;
  genres: string[];
  /**
   * OR within the dimension; `[]` means "no runtime filter", which is a
   * DIFFERENT state from "every bucket selected" — only the first includes
   * titles with no runtime at all (`specs/api.md` §6.2).
   */
  runtimes: RuntimeBucket[];
  sort: TitleSort;
  dir: SortDirection;
  limit: number;
  cursor: AnyListCursor | undefined;
}

function fail(field: string, message: string, details: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', 400, message, { field, ...details });
}

/**
 * Normalise a repeatable query parameter to a string array.
 *
 * Express gives `string` for one occurrence and `string[]` for several, so a
 * handler that assumes either shape breaks on the other. Anything else —
 * Express's nested-object form, `?service[x]=y` — is refused rather than
 * coerced, because coercing it produces `"[object Object]"` as a filter value
 * and a silently empty result.
 */
function toStringArray(raw: unknown, field: string): string[] {
  if (raw === undefined) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  if (values.length > MAX_REPEATED_VALUES) {
    fail(field, `"${field}" may be repeated at most ${MAX_REPEATED_VALUES} times.`, {
      max: MAX_REPEATED_VALUES,
    });
  }
  return values.map((value) => {
    if (typeof value !== 'string') fail(field, `"${field}" must be a string.`);
    return value;
  });
}

function requireEnumValues<T extends string>(
  values: string[],
  field: string,
  permitted: readonly T[],
): T[] {
  for (const value of values) {
    if (!(permitted as readonly string[]).includes(value)) {
      // The rejected value is deliberately NOT echoed back into the message.
      fail(field, `"${field}" is not one of the supported values.`, { permitted: [...permitted] });
    }
  }
  // De-duplicated: repeating a value within a dimension is an OR against
  // itself, and a duplicate would otherwise widen the generated IN() for free.
  return [...new Set(values)] as T[];
}

export function parseTitleListQuery(query: Request['query']): TitleListQuery {
  const qRaw = query['q'];
  if (qRaw !== undefined && typeof qRaw !== 'string') {
    fail('q', '"q" must be a single string.');
  }
  const q = qRaw?.trim() || undefined;
  if (q !== undefined && q.length > 500) {
    fail('q', '"q" must be at most 500 characters.', { maxLength: 500 });
  }
  const services = requireEnumValues(
    toStringArray(query['service'], 'service'),
    'service',
    SERVICES,
  );

  const mediaTypes = requireEnumValues(toStringArray(query['type'], 'type'), 'type', MEDIA_TYPES);

  const genres = toStringArray(query['genre'], 'genre').map((genre) => {
    const trimmed = genre.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_GENRE_LENGTH) {
      fail('genre', '"genre" must be a non-empty genre name.', { maxLength: MAX_GENRE_LENGTH });
    }
    if (GENRE_FORBIDDEN_CHARS.test(trimmed)) {
      // The rejected value is deliberately not echoed back.
      fail('genre', '"genre" contains characters that are not part of a genre name.');
    }
    return trimmed;
  });
  // De-duplicated for the same reason as `service`: repeating a value within a
  // dimension is an OR against itself and only widens the generated predicate.
  const uniqueGenres = [...new Set(genres)];

  // REQ-035. An unrecognised bucket is a 400 (`T-API-021`), per §3's enum
  // rule — and deliberately NOT dropped. A dropped bucket would silently widen
  // the list past what the owner asked for, which is the opposite failure to
  // the one the disclosure count exists to prevent.
  const runtimeValues = toStringArray(query['runtime'], 'runtime');
  for (const value of runtimeValues) {
    if (normalizeRuntimeBuckets([value]).length === 0) {
      fail('runtime', '"runtime" is not one of the supported values.', {
        permitted: [...RUNTIME_BUCKETS],
      });
    }
  }
  const runtimes = normalizeRuntimeBuckets(runtimeValues);

  const sortRaw = query['sort'];
  if (sortRaw !== undefined && !(TITLE_SORTS as readonly unknown[]).includes(sortRaw)) {
    fail('sort', '"sort" is not a supported sort.', { permitted: [...TITLE_SORTS] });
  }

  const dirRaw = query['dir'];
  if (dirRaw !== undefined && !(SORT_DIRECTIONS as readonly unknown[]).includes(dirRaw)) {
    fail('dir', '"dir" must be "asc" or "desc".', { permitted: [...SORT_DIRECTIONS] });
  }

  const cursorRaw = query['cursor'];
  if (cursorRaw !== undefined && typeof cursorRaw !== 'string') {
    // Not a VALIDATION_FAILED: any unreadable cursor is INVALID_CURSOR, so the
    // client has ONE code to react to rather than two for the same situation.
    throw new AppError('INVALID_CURSOR', 400, 'That page link is no longer readable.', {
      reason: 'not-a-string',
    });
  }

  const sort = (sortRaw as TitleSort | undefined) ?? 'dateAdded';

  return {
    q,
    services,
    // Both supported types form the whole dimension, so OR means no restriction.
    mediaType: mediaTypes.length === MEDIA_TYPES.length ? undefined : mediaTypes[0],
    genres: uniqueGenres,
    runtimes,
    sort,
    dir: (dirRaw as SortDirection | undefined) ?? defaultDirectionFor(sort),
    limit: parseLimit(query['limit']),
    // ⚠ THE CURSOR IS DECODED FOR THE SORT IT IS BEING USED WITH. A keyset
    // predicate must mirror its own `ORDER BY`, so a date position is
    // meaningless against a runtime-ordered list — paging it would skip or
    // repeat rows at every boundary, which is indistinguishable from data
    // loss. `decodeCursor`'s exact-key check turns a mismatched pair into a
    // loud `INVALID_CURSOR` (the client restarts, §3) rather than a page of
    // quietly wrong rows, which is why the shapes are not unified.
    cursor: cursorRaw === undefined ? undefined : CURSOR_DECODERS[sort](cursorRaw),
  };
}
