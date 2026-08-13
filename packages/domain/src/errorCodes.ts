// The closed error-code enumeration — `specs/api.md` §8.
//
// CLOSED means closed: every error the API can return is a member of this
// union, and `T-API-003` asserts that every code thrown anywhere in
// `apps/api/src` is one of these. An open set of strings would let a route
// invent a code the UI has never seen, which surfaces to the owner as an
// untranslated failure with no remedy.
//
// ⚠ `T-API-003` did NOT exist until TASK-048 — this comment asserted a guard
// that was implemented nowhere, which is worse than no comment because it
// stops the next reader from adding one. It now lives in
// `apps/api/test/unit/errorCodes.spec.ts`. The rest of the original claim —
// "AND that every member has at least one test" — is retained here as intent
// but is not yet asserted: most codes belong to endpoints that do not exist.
// See `specs/testing.md` §11.2.

export const ERROR_CODES = [
  // ── Generic ──────────────────────────────────────────────────────────────
  'VALIDATION_FAILED',
  'INVALID_CURSOR',
  'UNAUTHENTICATED',
  'NOT_ALLOWED',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  'STORE_SCHEMA_VIOLATION',

  // ── Batch lifecycle ──────────────────────────────────────────────────────
  'OPEN_BATCH_EXISTS',
  'BATCH_NOT_DRAFT',
  'BATCH_NOT_IN_REVIEW',
  'BATCH_NOT_FAILED',
  'BATCH_NOT_APPLIED',
  'BATCH_IMMUTABLE',
  'BATCH_ALREADY_UNDONE',
  'BATCH_NOT_CREATES_ONLY',
  'NO_IMAGES',
  'PENDING_ADDITIONS',
  'REMOVALS_NOT_CONFIRMED',
  'ALREADY_IN_BATCH',

  // ── Images and ceilings ──────────────────────────────────────────────────
  'TOO_MANY_IMAGES',
  'IMAGE_TOO_LARGE',
  'BATCH_TOO_LARGE',
  'TOO_MANY_FILES_IN_REQUEST',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_IMAGE_FORMAT',
  'IMAGE_DIMENSIONS_UNSUPPORTED',
  'IMAGE_TOO_LARGE_TO_DECODE',
  'IMAGE_DECODE_OOM',
  'IMAGE_DECODE_FAILED',
  'IMAGE_EXPIRED',
  'IMAGES_PURGED',

  // ── Works, listings, suppression ─────────────────────────────────────────
  'DUPLICATE_WORK_IDENTITY',
  'WORK_SUPPRESSED',
  'TARGET_WORK_SUPPRESSED',
  'LISTING_NOT_REMOVED',
  'GROUP_ALREADY_REVERSED',
  'PARTIAL_FAILURE_PREVENTED',

  // ── Upstream ─────────────────────────────────────────────────────────────
  'TMDB_WORK_NOT_FOUND',
  'TMDB_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

/**
 * The three memory/decode codes whose message MUST name memory as the cause
 * and link the runbook (`specs/api.md` §8, `T-IMG-020`).
 *
 * `IMAGE_DECODE_FAILED` is deliberately absent and must stay absent: a corrupt
 * or truncated file is not a memory problem, and telling the owner to scale the
 * container up would send them to spend money on a file that will never decode.
 */
export const MEMORY_RELATED_CODES = ['IMAGE_TOO_LARGE_TO_DECODE', 'IMAGE_DECODE_OOM'] as const;

/** The runbook every memory-related message must link (`REQ-080`/`REQ-081`). */
export const SCALE_UP_RUNBOOK = 'runbooks/scale-up-memory.md';
