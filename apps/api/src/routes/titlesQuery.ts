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

import { MEDIA_TYPES, SERVICES, type MediaType, type Service } from '@nextup/domain';
import type { Request } from 'express';

import { AppError } from '../errors/AppError.js';
import { decodeCursor, parseLimit, type ListCursor } from '../pagination.js';

/** `specs/api.md` §6.2 — one sort, one default direction. */
export const TITLE_SORTS = ['dateAdded'] as const;
export type TitleSort = (typeof TITLE_SORTS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/**
 * ⚠ Newest-first is the CONFIRMED default (REQ-038, owner decision A44), and
 * the oldest-first reverse control is a `must`, not a nice-to-have — it is the
 * sole escape hatch for the knowingly-accepted newest-first trade-off against
 * SUC-003. Do not "simplify" `dir` away.
 */
export const DEFAULT_SORT_DIRECTION: SortDirection = 'desc';

/** Bounds the repeatable filters so a hostile query cannot build a huge IN(). */
const MAX_REPEATED_VALUES = 20;
const MAX_GENRE_LENGTH = 60;

export interface TitleListQuery {
  services: Service[];
  mediaType: MediaType | undefined;
  genres: string[];
  sort: TitleSort;
  dir: SortDirection;
  limit: number;
  cursor: ListCursor | undefined;
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
  const services = requireEnumValues(
    toStringArray(query['service'], 'service'),
    'service',
    SERVICES,
  );

  const mediaTypes = requireEnumValues(toStringArray(query['type'], 'type'), 'type', MEDIA_TYPES);
  if (mediaTypes.length > 1) {
    // `type` is a single-valued dimension in §6.2. Accepting two would mean
    // "movie OR tv", which is the same as no filter — a request that looks
    // like a narrowing and is not.
    fail('type', '"type" may be given only once.');
  }

  const genres = toStringArray(query['genre'], 'genre').map((genre) => {
    const trimmed = genre.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_GENRE_LENGTH) {
      fail('genre', '"genre" must be a non-empty genre name.', { maxLength: MAX_GENRE_LENGTH });
    }
    return trimmed;
  });

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

  return {
    services,
    mediaType: mediaTypes[0],
    genres,
    sort: (sortRaw as TitleSort | undefined) ?? 'dateAdded',
    dir: (dirRaw as SortDirection | undefined) ?? DEFAULT_SORT_DIRECTION,
    limit: parseLimit(query['limit']),
    cursor: cursorRaw === undefined ? undefined : decodeCursor(cursorRaw),
  };
}
