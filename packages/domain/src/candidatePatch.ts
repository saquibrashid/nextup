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

/**
 * REQ-109 — what the owner's chosen match LOOKS like, so the review card can
 * show the identity they corrected TO instead of the one they rejected.
 *
 * ⚠ **Display, never identity.** The stored `resolvedWorkIdentity` is derived
 * solely from `tmdbId` + `mediaType`; nothing here reaches it (SD-05).
 */
export interface CorrectedDisplay {
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
}

/** The longest display string the correction path will store (schema: 500). */
const MAX_DISPLAY_LENGTH = 500;

export type CandidatePatch =
  | { kind: 'disposition'; disposition: SettableDisposition }
  | {
      kind: 'corrected';
      tmdbId: number;
      mediaType: MediaType;
      /**
       * REQ-109 — DISPLAY ONLY. Never identity; see `parseCorrection`.
       * `null` when the client did not send them (an older client, or a
       * correction made with no search result in hand).
       */
      display: CorrectedDisplay | null;
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
  //
  // ⚠ The REQ-109 display fields are refused here for the same reason and NOT
  // merely ignored. Silently dropping them would store a candidate whose card
  // then shows the rejected identity — the very defect REQ-109 exists to fix —
  // while the request reported success.
  if (
    'tmdbId' in record ||
    'mediaType' in record ||
    'correctedName' in record ||
    'correctedReleaseYear' in record ||
    'correctedPosterPath' in record
  ) {
    return reject(
      '"tmdbId", "mediaType" and the corrected display fields are only valid with "disposition": "corrected".',
      {
        field: 'disposition',
        disposition,
      },
    );
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

  // ⚠ `confirmDuplicate` IS DELIBERATELY NOT PARSED, and it is not rejected
  // either. It existed solely to escape a duplicate gate in `applyCorrection`
  // that contradicted US-012 AC-5 and has been removed — see the long note on
  // that function. With no gate there is nothing to confirm, so the field is
  // meaningless in both directions: accepting it would imply a decision the
  // server no longer makes, and refusing it would 400 a correction an older
  // client is entitled to make over a field that changes nothing. It is
  // therefore ignored like any other unknown key, and `specs/api.md` §6.18
  // never documented it.

  const display = parseCorrectedDisplay(record);
  if (!display.ok) return display;

  return {
    ok: true,
    value: {
      kind: 'corrected',
      tmdbId,
      mediaType: mediaType as MediaType,
      display: display.value,
    },
  };
}

/**
 * REQ-109 — the optional display fields that accompany a correction.
 *
 * ⚠ **THIS ACCEPTS DISPLAY TEXT WHERE `parseManualEntry` REFUSES IT, AND THAT
 * INCONSISTENCY IS DELIBERATE — DO NOT "TIDY" IT.** The two endpoints are
 * under different constraints:
 *
 *   - `parseManualEntry` (§6.20) refuses a caller-supplied `name` because its
 *     route fetches the work from TMDB anyway, so refusing costs nothing and
 *     guarantees the owner sees what TMDB actually holds.
 *   - `applyCorrection` (§6.18) is **network-free by an explicit recorded
 *     decision** — "a TMDB outage must not stop the owner fixing a wrong
 *     match". The same refusal here would cost REQ-109 entirely: the review
 *     screen runs before any `Title` row exists, so if the client does not
 *     carry the name, nothing on the server has one to show.
 *
 * What makes that safe is that these values are **display only**. Identity is
 * still derived solely from `tmdbId` + `mediaType`, and the lazy refresh
 * (REQ-076, NFR-014) replaces these with TMDB's own values on first access.
 *
 * ⚠ Absent is NOT an error. An older client, or a correction made from a path
 * with no search result in hand, sends none of these; the review read then
 * falls back to its previous behaviour rather than failing a correction the
 * owner is entitled to make.
 *
 * ⚠ A PARTIAL payload is refused rather than half-stored. `{ posterPath }`
 * with no `name` would render a corrected poster under the rejected title —
 * the two-facts-disagreeing failure this requirement exists to end.
 */
function parseCorrectedDisplay(
  record: Record<string, unknown>,
): ParseResult<CorrectedDisplay | null> {
  const name = record['correctedName'];
  const releaseYear = record['correctedReleaseYear'];
  const posterPath = record['correctedPosterPath'];

  if (name === undefined && releaseYear === undefined && posterPath === undefined) {
    return { ok: true, value: null };
  }

  if (typeof name !== 'string' || name.trim() === '') {
    return reject('"correctedName" is required when any corrected display field is sent.', {
      field: 'correctedName',
    });
  }
  if (name.length > MAX_DISPLAY_LENGTH) {
    return reject('"correctedName" is too long.', {
      field: 'correctedName',
      maxLength: MAX_DISPLAY_LENGTH,
    });
  }

  if (
    releaseYear !== undefined &&
    releaseYear !== null &&
    (typeof releaseYear !== 'number' || !Number.isInteger(releaseYear))
  ) {
    return reject('"correctedReleaseYear" must be an integer or null.', {
      field: 'correctedReleaseYear',
    });
  }

  if (
    posterPath !== undefined &&
    posterPath !== null &&
    (typeof posterPath !== 'string' || posterPath.length > MAX_DISPLAY_LENGTH)
  ) {
    return reject('"correctedPosterPath" must be a string or null.', {
      field: 'correctedPosterPath',
      maxLength: MAX_DISPLAY_LENGTH,
    });
  }

  return {
    ok: true,
    value: {
      name,
      releaseYear: typeof releaseYear === 'number' ? releaseYear : null,
      posterPath: typeof posterPath === 'string' && posterPath !== '' ? posterPath : null,
    },
  };
}

/** One §6.20 manual entry: a work the extraction missed entirely. */
export interface ManualEntry {
  tmdbId: number;
  mediaType: MediaType;
}

/**
 * Parses one §6.20 body (`{ "tmdbId": 66732, "mediaType": "tv" }`).
 *
 * ⚠ **A manual entry carries NO disposition field and none is accepted.** The
 * owner picked this work out of a TMDB search themselves, so §6.20 fixes the
 * stored disposition at `confirmed`; letting a client send its own would allow
 * `{ tmdbId, disposition: 'discarded' }`, which writes a row nobody can act on
 * and which the review pass then reports as a decision the owner made.
 *
 * ⚠ **`name` is REFUSED, not ignored.** A caller-supplied display name would
 * be the one piece of a manual entry that did not come from TMDB, and SD-05
 * keeps text out of identity: the name is read from the work itself at the
 * route, so what the owner sees back is what TMDB actually holds for the id
 * they picked, not what their client believed it was.
 */
export function parseManualEntry(body: unknown): ParseResult<ManualEntry> {
  const record = asRecord(body);
  if (record === null) {
    return reject('That request body could not be read as an object.');
  }

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
  if ('disposition' in record) {
    return reject('A manual entry is confirmed by definition; do not send "disposition".', {
      field: 'disposition',
    });
  }
  if ('name' in record) {
    return reject('"name" is read from TMDB, not supplied.', { field: 'name' });
  }

  return { ok: true, value: { tmdbId, mediaType: mediaType as MediaType } };
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
