/**
 * Keyset pagination (`specs/api.md` §3, `specs/data-model.md` §15.6).
 *
 * WHY KEYSET AND NOT `OFFSET`
 * ---------------------------
 * `OFFSET n` makes the database walk and discard `n` rows, so page 40 costs
 * forty times page 1. NFR-018 promises the removed view stays fast as history
 * grows, and an offset scan is precisely the thing that would quietly stop
 * honouring that — no error, just a list that gets slower every month.
 *
 * WHY A BAD CURSOR IS A 400 AND NOT A SILENT RESET
 * ------------------------------------------------
 * The tempting failure mode is to shrug at an unreadable cursor and return
 * page 1. That is the one behaviour this product must not have: the owner is
 * paging through their list, the client sends a cursor the server cannot
 * read, and the response is the top of the list again — which reads as
 * "the rows I was looking at are gone". Losing rows silently is the failure
 * mode the whole product is designed against, so `INVALID_CURSOR` is a loud
 * 400 and the client restarts deliberately (`T-API-017`).
 *
 * WHY THERE IS NO SIGNATURE
 * -------------------------
 * `specs/data-model.md` §15.6 fixes the cursor as plain
 * `base64url(JSON.stringify(...))`, with no HMAC, and that is right here: the
 * cursor names a position in the CALLER'S OWN list, every query is owner-scoped
 * regardless of what the cursor says, and forging one can therefore only move
 * the owner around their own rows. A signature would add a key to manage and
 * secure nothing. What replaces it is strict validation — see `decodeCursor`.
 */

import { AppError } from './errors/AppError.js';

/** `specs/api.md` §3 — `limit` is 1..200, default 50. */
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/**
 * A position in the combined list: the sort key plus the tie-breaker.
 *
 * The tie-breaker is not tidiness. Several titles legitimately share a
 * `sortDateAdded` — a first import gives every title the same date — and
 * without a second, unique key the comparison is not a total order, so rows
 * on the boundary are either repeated or skipped between pages. Skipped rows
 * would look exactly like data loss.
 */
export interface ListCursor {
  sortDateAdded: string;
  id: string;
}

/**
 * A position in the RUNTIME-ordered list (REQ-037, `A48`).
 *
 * ⚠ **THE CURSOR MUST CARRY THE KEY THE LIST IS ACTUALLY ORDERED BY.** A
 * keyset predicate that does not mirror its own `ORDER BY` skips or repeats
 * rows at every page boundary, and that is indistinguishable from data loss —
 * the failure mode this whole product is designed against. Paging a
 * runtime-sorted list with a date cursor is exactly that mistake, and it
 * cannot be caught by any test that never asks for a second page.
 *
 * ⚠ **`runtimeMinutes` is NULLABLE here, and that is the hard part.** Runtime
 * sorts `NULL`s last in both directions, so a cursor sitting in the `NULL`
 * block must page WITHIN it by id and must not re-admit the non-null rows it
 * has already passed. See the three-branch keyset in `listTitlePage`.
 */
export interface RuntimeListCursor {
  runtimeMinutes: number | null;
  id: string;
}

/**
 * A position in the RELEASE-YEAR-ordered list (`A53`, OQ-3).
 *
 * ⚠ Same nullable-key problem as runtime, and the same three-branch keyset.
 * `tmdbReleaseYear` is `null` for an unmatched title, those rows sort LAST in
 * both directions, and a cursor sitting inside that block must page within it
 * by id alone.
 */
export interface ReleaseYearListCursor {
  releaseYear: number | null;
  id: string;
}

/**
 * A position in the RATING-ordered list (`A53`, OQ-3b, ADR-0011 Rev 1).
 *
 * ⚠ **THE KEY IS TENTHS, THE STORED INTEGER — NEVER THE DISPLAYED FLOAT.**
 * `fromTenths` divides by 10 at the display edge, and a cursor carrying `8.4`
 * would compare a float against an integer column: the boundary row is then
 * matched by neither the "greater" nor the "equal" branch and silently
 * vanishes between pages. Storing the integer keeps the keyset total.
 *
 * ⚠ **THIS IS THE ONLY MUTABLE SORT KEY IN THE PRODUCT.** Every other
 * ordering is stable between requests: date-added is owner-supplied and
 * immutable once captured; name, year and runtime are properties of the work.
 * A rating can change under the owner's feet, which is the whole reason the
 * refresh had to move inside the request — see `titles.ts` and ADR-0011 Rev 1.
 */
export interface RatingListCursor {
  ratingTenths: number | null;
  id: string;
}

/**
 * The cursor for whichever sort issued it.
 *
 * ⚠ **The shapes are DISCRIMINATED BY KEY SET, not by a `sort` field**, and
 * `decodeCursor`'s existing exact-key check is what makes that safe for free:
 * a cursor issued under `sort=dateAdded` cannot be read as a runtime cursor,
 * so switching sort mid-page is a loud `INVALID_CURSOR` rather than a page of
 * quietly wrong rows. Adding a `sort` field would make the two shapes
 * structurally identical and lose that property.
 *
 * ⚠ **EVERY SHAPE MUST THEREFORE KEEP A DISTINCT KEY NAME.** `releaseYear`
 * and `ratingTenths` are named differently for exactly this reason — two
 * nullable-integer sorts that both called their key `value` would be
 * indistinguishable, and a year cursor would silently page a rating-ordered
 * list at the wrong boundary.
 */
export type AnyListCursor =
  ListCursor | RuntimeListCursor | ReleaseYearListCursor | RatingListCursor;

export function isRuntimeCursor(cursor: AnyListCursor): cursor is RuntimeListCursor {
  return 'runtimeMinutes' in cursor;
}

export function isReleaseYearCursor(cursor: AnyListCursor): cursor is ReleaseYearListCursor {
  return 'releaseYear' in cursor;
}

export function isRatingCursor(cursor: AnyListCursor): cursor is RatingListCursor {
  return 'ratingTenths' in cursor;
}

/** Guards against a hostile or corrupt id being echoed into a query. */
const MAX_CURSOR_ID_LENGTH = 200;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function invalidCursor(reason: string): AppError {
  // `reason` is a fixed string chosen from this module, never anything derived
  // from the submitted cursor — the envelope is not a reflection surface.
  return new AppError(
    'INVALID_CURSOR',
    400,
    'That page link is no longer readable. Reload the list to start again.',
    { reason },
  );
}

export function encodeCursor(cursor: ListCursor): string {
  // Key order is fixed by this object literal so a round trip is byte-stable;
  // `decodeCursor` re-encodes and compares, and a different key order would
  // make every cursor we ourselves issued fail that comparison.
  const json = JSON.stringify({ sortDateAdded: cursor.sortDateAdded, id: cursor.id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * The runtime-ordered counterpart. Same byte-stability rule: key order is
 * fixed here and `decodeRuntimeCursor` re-encodes and compares.
 *
 * ⚠ `runtimeMinutes: null` is a REAL, encodable position — the `NULL` block
 * sits at the end of the order in both directions and has to be pageable like
 * any other. Refusing to encode it would silently truncate the list at the
 * first unknown runtime, which is the data-loss shape again.
 */
export function encodeRuntimeCursor(cursor: RuntimeListCursor): string {
  const json = JSON.stringify({ runtimeMinutes: cursor.runtimeMinutes, id: cursor.id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decode a cursor, or throw `INVALID_CURSOR`.
 *
 * ⚠ The re-encode comparison at the end is load-bearing, not belt-and-braces.
 * Node's base64 decoder is lenient: it ignores trailing junk and tolerates
 * characters that are not in the alphabet, so a tampered cursor frequently
 * decodes to the SAME bytes as the original and would sail through a
 * shape-only check. Re-encoding the parsed value and demanding it equal the
 * input is what makes "tampered" detectable at all without a signature.
 */
export function decodeCursor(raw: string): ListCursor {
  const parsed = decodeEnvelope(raw);

  const keys = Object.keys(parsed);
  if (keys.length !== 2 || !keys.includes('sortDateAdded') || !keys.includes('id')) {
    // Exactly the two keys: an extra key means someone is building cursors we
    // did not issue, and accepting it would make the shape a de-facto public
    // contract that clients are explicitly forbidden to parse.
    //
    // ⚠ It is ALSO what makes the two sort shapes safe to discriminate by key
    // set (see `AnyListCursor`): a runtime cursor fed to the date sort lands
    // here as a loud 400 rather than being read as a date position.
    throw invalidCursor('unexpected-keys');
  }

  const { sortDateAdded, id } = parsed as { sortDateAdded: unknown; id: unknown };

  if (typeof sortDateAdded !== 'string' || !ISO_DATE_RE.test(sortDateAdded)) {
    throw invalidCursor('bad-sort-date');
  }
  requireCursorId(id);

  const cursor: ListCursor = { sortDateAdded, id: id as string };
  if (encodeCursor(cursor) !== raw) {
    throw invalidCursor('not-canonical');
  }
  return cursor;
}

/**
 * The runtime-ordered cursor (REQ-037).
 *
 * ⚠ `runtimeMinutes` must be `null` OR a non-negative safe integer. A float or
 * a `NaN` would compare unpredictably against an integer column and produce a
 * page boundary that moves; refusing it keeps the keyset total.
 */
export function decodeRuntimeCursor(raw: string): RuntimeListCursor {
  const parsed = decodeEnvelope(raw);

  const keys = Object.keys(parsed);
  if (keys.length !== 2 || !keys.includes('runtimeMinutes') || !keys.includes('id')) {
    throw invalidCursor('unexpected-keys');
  }

  const { runtimeMinutes, id } = parsed as { runtimeMinutes: unknown; id: unknown };

  if (
    runtimeMinutes !== null &&
    (typeof runtimeMinutes !== 'number' ||
      !Number.isSafeInteger(runtimeMinutes) ||
      runtimeMinutes < 0)
  ) {
    throw invalidCursor('bad-runtime');
  }
  requireCursorId(id);

  const cursor: RuntimeListCursor = {
    runtimeMinutes: runtimeMinutes as number | null,
    id: id as string,
  };
  if (encodeRuntimeCursor(cursor) !== raw) {
    throw invalidCursor('not-canonical');
  }
  return cursor;
}

/**
 * The shared encode/decode pair for a nullable-integer sort key.
 *
 * ⚠ **FACTORED SO A THIRD NULLABLE SORT CANNOT GET THE `null` CASE WRONG.**
 * Runtime, release year and rating all order `NULL`s last in both directions,
 * so `null` is a REAL, encodable position at the end of the list — not an
 * error. Refusing to encode it truncates the list at the first unknown value,
 * silently, and exactly where the owner is least able to notice. That rule was
 * previously written out once per sort, which is three chances to omit it.
 *
 * Key order is fixed here so a round trip is byte-stable: the decoder
 * re-encodes and compares, and a different key order would make every cursor
 * we ourselves issued fail that comparison.
 */
function encodeNullableIntCursor(key: string, value: number | null, id: string): string {
  const json = JSON.stringify({ [key]: value, id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

function decodeNullableIntCursor(
  raw: string,
  key: string,
  badValueReason: string,
): { value: number | null; id: string } {
  const parsed = decodeEnvelope(raw);

  const keys = Object.keys(parsed);
  if (keys.length !== 2 || !keys.includes(key) || !keys.includes('id')) {
    throw invalidCursor('unexpected-keys');
  }

  const value = parsed[key];
  const id = parsed['id'];

  // ⚠ A float or a NaN would compare unpredictably against an integer column
  // and produce a page boundary that MOVES between requests. Refusing it is
  // what keeps the keyset a total order.
  if (value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value))) {
    throw invalidCursor(badValueReason);
  }
  requireCursorId(id);

  const cursor = { value: value as number | null, id: id as string };
  if (encodeNullableIntCursor(key, cursor.value, cursor.id) !== raw) {
    throw invalidCursor('not-canonical');
  }
  return cursor;
}

/** The release-year-ordered cursor (`A53`, OQ-3). */
export function encodeReleaseYearCursor(cursor: ReleaseYearListCursor): string {
  return encodeNullableIntCursor('releaseYear', cursor.releaseYear, cursor.id);
}

export function decodeReleaseYearCursor(raw: string): ReleaseYearListCursor {
  const { value, id } = decodeNullableIntCursor(raw, 'releaseYear', 'bad-release-year');
  return { releaseYear: value, id };
}

/**
 * The rating-ordered cursor (`A53`, OQ-3b).
 *
 * ⚠ **TENTHS, NOT THE DISPLAYED FLOAT** — see `RatingListCursor`. The integer
 * check in `decodeNullableIntCursor` is what enforces it: a cursor carrying
 * `8.4` is rejected as `bad-rating` rather than quietly losing the boundary
 * row.
 */
export function encodeRatingCursor(cursor: RatingListCursor): string {
  return encodeNullableIntCursor('ratingTenths', cursor.ratingTenths, cursor.id);
}

export function decodeRatingCursor(raw: string): RatingListCursor {
  const { value, id } = decodeNullableIntCursor(raw, 'ratingTenths', 'bad-rating');
  return { ratingTenths: value, id };
}

function requireCursorId(id: unknown): void {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_CURSOR_ID_LENGTH) {
    throw invalidCursor('bad-id');
  }
}

/** The decode steps both cursor shapes share, up to "it is a plain object". */
function decodeEnvelope(raw: string): Record<string, unknown> {
  if (raw.length === 0 || raw.length > 512) {
    throw invalidCursor('length');
  }

  let json: string;
  try {
    json = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw invalidCursor('not-base64url');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw invalidCursor('not-json');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalidCursor('not-an-object');
  }

  return parsed as Record<string, unknown>;
}

/**
 * Parse `limit`, or throw `VALIDATION_FAILED`.
 *
 * Out of range is refused rather than clamped. Clamping `limit=5000` to 200
 * would return a page the caller did not ask for and give no hint why the
 * remaining rows are missing; refusing says what happened.
 */
export function parseLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_PAGE_LIMIT;

  if (typeof raw !== 'string' || !/^\d{1,4}$/.test(raw)) {
    throw new AppError('VALIDATION_FAILED', 400, '"limit" must be a whole number.', {
      field: 'limit',
      min: 1,
      max: MAX_PAGE_LIMIT,
    });
  }

  const value = Number(raw);
  if (value < 1 || value > MAX_PAGE_LIMIT) {
    throw new AppError(
      'VALIDATION_FAILED',
      400,
      `"limit" must be between 1 and ${MAX_PAGE_LIMIT}.`,
      { field: 'limit', min: 1, max: MAX_PAGE_LIMIT },
    );
  }
  return value;
}
