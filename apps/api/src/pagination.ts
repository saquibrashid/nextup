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

  const keys = Object.keys(parsed);
  if (keys.length !== 2 || !keys.includes('sortDateAdded') || !keys.includes('id')) {
    // Exactly the two keys: an extra key means someone is building cursors we
    // did not issue, and accepting it would make the shape a de-facto public
    // contract that clients are explicitly forbidden to parse.
    throw invalidCursor('unexpected-keys');
  }

  const { sortDateAdded, id } = parsed as { sortDateAdded: unknown; id: unknown };

  if (typeof sortDateAdded !== 'string' || !ISO_DATE_RE.test(sortDateAdded)) {
    throw invalidCursor('bad-sort-date');
  }
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_CURSOR_ID_LENGTH) {
    throw invalidCursor('bad-id');
  }

  const cursor: ListCursor = { sortDateAdded, id };
  if (encodeCursor(cursor) !== raw) {
    throw invalidCursor('not-canonical');
  }
  return cursor;
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
