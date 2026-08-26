/**
 * TASK-066 — the pure half of `PATCH /api/batches/:batchId/candidates/:candidateId`
 * and `POST /api/batches/:batchId/candidates/confirm-all` (`specs/api.md`
 * §6.18, §6.19).
 *
 * Body parsing is here, not in the route, because every rejection below is a
 * decision about what the owner MEANT, and each one is only observable as a
 * wrong row on the list if it is got wrong. Keeping it pure means those
 * decisions are asserted by fast unit tests rather than only by an integration
 * test that has to stand a batch up first.
 *
 * ⚠ **The bodies are mutually exclusive and this module refuses a mixture
 * rather than picking a winner.** `specs/api.md` §6.18 says "exactly one
 * form". A body carrying both `disposition` and `reclassifyAsTitle` has two
 * readings, and silently honouring one of them applies a change the owner did
 * not ask for — to a row they are about to add to their list. REQ-014's
 * no-accept-by-inaction rule is about the same hazard from the other end.
 */

import { MEDIA_TYPES, type MediaType } from './enums.js';

/** The three sections whose items `confirm-all` may act on (§6.19). */
export const CONFIRMABLE_SECTIONS = ['additions', 'unmatched', 'alreadyOnYourList'] as const;
export type ConfirmableSection = (typeof CONFIRMABLE_SECTIONS)[number];

/**
 * A disposition a CLIENT may set.
 *
 * ⚠ Deliberately NOT `ReviewDisposition`. `'corrected'` is a member of the
 * stored enum but is never set on its own: it always arrives with a `tmdbId`
 * and a `mediaType`, and accepting a bare `{ "disposition": "corrected" }`
 * would leave a candidate marked corrected with nothing to correct it TO —
 * which then applies at close as whatever the original match was, under a
 * label saying the owner fixed it.
 */
export const SETTABLE_DISPOSITIONS = ['confirmed', 'discarded', 'pending'] as const;
export type SettableDisposition = (typeof SETTABLE_DISPOSITIONS)[number];

export type CandidatePatch =
  | { kind: 'disposition'; disposition: SettableDisposition }
  | {
      kind: 'corrected';
      tmdbId: number;
      mediaType: MediaType;
      /** US-012 AC-5 — the owner has seen the duplicate warning and meant it. */
      confirmDuplicate: boolean;
    }
  | { kind: 'reclassify' };

export type ParseResult<T> =
  { ok: true; value: T } | { ok: false; message: string; details: Record<string, unknown> };

function reject<T>(message: string, details: Record<string, unknown> = {}): ParseResult<T> {
  return { ok: false, message, details };
}

function asRecord(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

/**
 * Parses one §6.18 body.
 *
 * The order of the checks is load-bearing in one place: the mixture check runs
 * BEFORE either form is validated, so a body carrying both keys is reported as
 * ambiguous rather than as whichever key happens to be malformed. Reversed,
 * a client sending `{ disposition: 'confirmed', reclassifyAsTitle: true }`
 * would be told its disposition was fine and be left to guess why nothing
 * changed.
 */
export function parseCandidatePatch(body: unknown): ParseResult<CandidatePatch> {
  const record = asRecord(body);
  if (record === null) {
    return reject('That request body could not be read as an object.');
  }

  const hasDisposition = 'disposition' in record;
  const hasReclassify = 'reclassifyAsTitle' in record;

  if (hasDisposition && hasReclassify) {
    return reject('Send either "disposition" or "reclassifyAsTitle", not both.', {
      fields: ['disposition', 'reclassifyAsTitle'],
    });
  }
  if (!hasDisposition && !hasReclassify) {
    return reject('Send either "disposition" or "reclassifyAsTitle".', {
      permitted: [...SETTABLE_DISPOSITIONS, 'corrected', 'reclassifyAsTitle'],
    });
  }

  if (hasReclassify) {
    // ⚠ `false` is REFUSED, not treated as a no-op. There is no un-rescue
    // affordance in the API, so `{ reclassifyAsTitle: false }` is a client
    // bug; answering 200 to it reports success for a change that never
    // happened, and the item stays collapsed behind the chrome expander with
    // nothing to say why.
    if (record['reclassifyAsTitle'] !== true) {
      return reject('"reclassifyAsTitle" must be true.', { field: 'reclassifyAsTitle' });
    }
    return { ok: true, value: { kind: 'reclassify' } };
  }

  const disposition = record['disposition'];
  if (disposition === 'corrected') {
    return parseCorrection(record);
  }

  if (
    typeof disposition !== 'string' ||
    !(SETTABLE_DISPOSITIONS as readonly string[]).includes(disposition)
  ) {
    return reject('"disposition" is not one of the permitted values.', {
      field: 'disposition',
      permitted: [...SETTABLE_DISPOSITIONS, 'corrected'],
    });
  }

  // ⚠ A correction payload alongside a NON-corrected disposition is refused.
  // `{ disposition: 'confirmed', tmdbId: 41733 }` almost certainly means "I
  // fixed the match and I confirm it"; confirming the ORIGINAL match and
  // discarding the tmdbId silently adds the wrong work to the owner's list —
  // the exact failure US-007 exists to prevent, and one that leaves no trace.
  if ('tmdbId' in record || 'mediaType' in record) {
    return reject('"tmdbId" and "mediaType" are only valid with "disposition": "corrected".', {
      field: 'disposition',
      disposition,
    });
  }

  return {
    ok: true,
    value: { kind: 'disposition', disposition: disposition as SettableDisposition },
  };
}

function parseCorrection(record: Record<string, unknown>): ParseResult<CandidatePatch> {
  const tmdbId = record['tmdbId'];
  const mediaType = record['mediaType'];

  if (typeof tmdbId !== 'number' || !Number.isInteger(tmdbId) || tmdbId <= 0) {
    return reject('"tmdbId" must be a positive integer.', { field: 'tmdbId' });
  }
  if (typeof mediaType !== 'string' || !(MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    return reject('"mediaType" is not one of the permitted values.', {
      field: 'mediaType',
      permitted: [...MEDIA_TYPES],
    });
  }

  const confirmDuplicate = record['confirmDuplicate'];
  if (confirmDuplicate !== undefined && typeof confirmDuplicate !== 'boolean') {
    return reject('"confirmDuplicate" must be a boolean.', { field: 'confirmDuplicate' });
  }

  return {
    ok: true,
    value: {
      kind: 'corrected',
      tmdbId,
      mediaType: mediaType as MediaType,
      confirmDuplicate: confirmDuplicate === true,
    },
  };
}

/** Parses one §6.19 body. */
export function parseConfirmAllSection(body: unknown): ParseResult<ConfirmableSection> {
  const record = asRecord(body);
  if (record === null) {
    return reject('That request body could not be read as an object.');
  }

  const section = record['section'];
  if (
    typeof section !== 'string' ||
    !(CONFIRMABLE_SECTIONS as readonly string[]).includes(section)
  ) {
    // ⚠ `probablyNotTitles`, `unreadableTiles` and `removals` are deliberately
    // absent from the permitted set. Bulk-confirming a section the owner has
    // NOT read is exactly the accept-by-inaction REQ-014 forbids, and the
    // first two are collapsed by default — the owner may never have seen
    // their contents at all. Removals have their own ticked/unticked
    // affordance (§6.21) with its own confirmation at close.
    return reject('"section" is not one of the permitted values.', {
      field: 'section',
      permitted: [...CONFIRMABLE_SECTIONS],
    });
  }

  return { ok: true, value: section as ConfirmableSection };
}

/**
 * Whether a candidate in `section` is eligible for `confirm-all`.
 *
 * Only `pending` items move. An item the owner already discarded must NOT be
 * resurrected by a bulk press — that would silently reverse an explicit
 * decision — and an already-`confirmed` or `corrected` item is counted as
 * skipped rather than re-written, so the reported `confirmed` count is the
 * number of decisions this press actually made.
 */
export function isConfirmable(disposition: string): boolean {
  return disposition === 'pending';
}
