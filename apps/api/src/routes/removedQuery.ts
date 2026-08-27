/**
 * Query parsing and cursor codec for `GET /api/removed` (`specs/api.md` §6.9,
 * TASK-095).
 *
 * Split from the handler for the same two reasons `titlesQuery.ts` is: a
 * malformed request must be a 400 whatever is in the database, and every
 * rejection path must stay reachable without a store so the unit suite (CI job
 * 4, where coverage is measured) can assert it.
 *
 * ⚠ THE CURSOR HERE IS NOT `ListCursor` AND MUST NOT BE MADE TO REUSE IT.
 * `ListCursor` carries `sortDateAdded`, a `YYYY-MM-DD` **date**. The removed
 * view orders by `removed_at`, a `datetime2` **timestamp**, and it has to: a
 * full-update close removes many listings inside one transaction, so a whole
 * page can share a removal instant. Truncating that key to a date would make
 * the cursor's position ambiguous across every removal on that day, and a
 * keyset predicate over an ambiguous key silently SKIPS rows — which the owner
 * reads as the removed log having lost their history. That is the exact
 * failure this product is designed against, so the two codecs stay separate.
 *
 * ⚠ `ownerId` is NOT read here and must never be (`T-SEC-006`).
 */

import { SERVICES, type Service } from '@nextup/domain';
import type { Request } from 'express';

import { AppError } from '../errors/AppError.js';
import { parseLimit } from '../pagination.js';

/** `specs/data-model.md` §11 rule 3 — newest removal first, ties by listing id. */
export interface RemovedCursor {
  removedAt: string;
  listingId: string;
}

/** `specs/api.md` §6.9 — `q` is 1..100 characters. */
export const MAX_Q_LENGTH = 100;

const MAX_CURSOR_ID_LENGTH = 200;
/** `datetime2` serialised by `Date.prototype.toISOString`, millisecond precision. */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function invalidCursor(reason: string): AppError {
  // `reason` is always a fixed string from this module, never anything derived
  // from the submitted cursor — the error envelope is not a reflection surface.
  return new AppError(
    'INVALID_CURSOR',
    400,
    'That page link is no longer readable. Reload the list to start again.',
    { reason },
  );
}

export function encodeRemovedCursor(cursor: RemovedCursor): string {
  // Key order fixed by this literal so a round trip is byte-stable;
  // `decodeRemovedCursor` re-encodes and compares.
  const json = JSON.stringify({ removedAt: cursor.removedAt, listingId: cursor.listingId });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decode a removed-view cursor, or throw `INVALID_CURSOR`.
 *
 * The re-encode comparison is load-bearing for the reason `decodeCursor` gives:
 * Node's base64 decoder is lenient enough that a tampered cursor often decodes
 * to the same bytes and would pass a shape-only check.
 *
 * ⚠ An unreadable cursor is a loud 400, NEVER a silent reset to page 1.
 * Returning the top of the list to an owner who was mid-page reads as "the rows
 * I was looking at are gone" (`T-API-017`).
 */
export function decodeRemovedCursor(raw: string): RemovedCursor {
  if (raw.length === 0 || raw.length > 512) throw invalidCursor('length');

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
  if (keys.length !== 2 || !keys.includes('removedAt') || !keys.includes('listingId')) {
    throw invalidCursor('unexpected-keys');
  }

  const { removedAt, listingId } = parsed as { removedAt: unknown; listingId: unknown };

  if (typeof removedAt !== 'string' || !ISO_INSTANT_RE.test(removedAt)) {
    throw invalidCursor('bad-removed-at');
  }
  if (Number.isNaN(Date.parse(removedAt))) throw invalidCursor('bad-removed-at');
  if (typeof listingId !== 'string' || listingId.length === 0) {
    throw invalidCursor('bad-listing-id');
  }
  if (listingId.length > MAX_CURSOR_ID_LENGTH) throw invalidCursor('bad-listing-id');

  const cursor: RemovedCursor = { removedAt, listingId };
  if (encodeRemovedCursor(cursor) !== raw) throw invalidCursor('not-canonical');
  return cursor;
}

export interface RemovedListQuery {
  q: string | undefined;
  service: Service | undefined;
  limit: number;
  cursor: RemovedCursor | undefined;
}

function fail(field: string, message: string, details: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', 400, message, { field, ...details });
}

/**
 * ⚠ `specs/data-model.md` §11 fixes v1 at exactly FOUR affordances and records
 * the rejected ones so nobody adds them: no date-range filter, no bulk restore,
 * no per-work grouping, no sort-by-date-added. An unknown query parameter is
 * therefore ignored rather than honoured, but a MALFORMED known one is refused.
 */
export function parseRemovedListQuery(query: Request['query']): RemovedListQuery {
  const qRaw = query['q'];
  let q: string | undefined;
  if (qRaw !== undefined) {
    if (typeof qRaw !== 'string') fail('q', '"q" must be a string.');
    const trimmed = qRaw.trim();
    // An empty or whitespace-only `q` is "no search", not "match nothing".
    // Refusing it would make a cleared search box an error; treating it as a
    // filter would return zero rows and read as an empty removed log.
    if (trimmed.length === 0) {
      q = undefined;
    } else {
      if (trimmed.length > MAX_Q_LENGTH) {
        fail('q', `"q" must be between 1 and ${MAX_Q_LENGTH} characters.`, {
          min: 1,
          max: MAX_Q_LENGTH,
        });
      }
      q = trimmed;
    }
  }

  const serviceRaw = query['service'];
  let service: Service | undefined;
  if (serviceRaw !== undefined) {
    if (typeof serviceRaw !== 'string' || !(SERVICES as readonly string[]).includes(serviceRaw)) {
      // The rejected value is deliberately NOT echoed back into the message.
      fail('service', '"service" is not one of the supported values.', {
        permitted: [...SERVICES],
      });
    }
    service = serviceRaw as Service;
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
    q,
    service,
    limit: parseLimit(query['limit']),
    cursor: cursorRaw === undefined ? undefined : decodeRemovedCursor(cursorRaw),
  };
}
