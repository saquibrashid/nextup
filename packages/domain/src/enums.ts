// Enumerations — `specs/data-model.md` §3.1, enumerated in full.
//
// Every enum is a `readonly` tuple plus a derived union type. The tuple is the
// single source of truth: Zod validates against it, exhaustive `switch`
// statements narrow against it, and a new member cannot be added without both
// updating in lockstep.

export const SERVICES = ['netflix', 'max'] as const; // REQ-002, REQ-053
export type Service = (typeof SERVICES)[number];

export const BATCH_MODES = ['append-only', 'full-update'] as const; // REQ-003
export type BatchMode = (typeof BATCH_MODES)[number];

export const BATCH_STATUSES = [
  'draft', // created, images being attached; nothing extracted
  'submitted', // owner pressed submit; extraction queued in-process
  'extracting', // OCR/matching running
  'extraction-failed', // US-006 AC-4; images retained; retry offered
  'in-review', // candidates staged, review pass renderable
  'applied', // CLOSED. The only status list queries accept.
  'undone', // reversed by US-032
  'discarded', // abandoned by the owner before close (US-005 AC-4)
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/**
 * The statuses from which a batch can never become active again — the batch is
 * finished with, and the owner is free to start another.
 *
 * ⚠ Everything NOT in this tuple counts as an OPEN batch, and that direction
 * is deliberate (`specs/api.md` §5, "Open batches per owner: 1"). Enumerating
 * the OPEN statuses positively would mean a status added to `BATCH_STATUSES`
 * later silently counts as closed, letting a second batch open alongside it.
 * Defined this way round, a new status defaults to open, which fails safe.
 *
 * `'extraction-failed'` is deliberately ABSENT: that batch keeps its images
 * and offers a retry (US-006 AC-4), so the owner must retry or discard it
 * before starting another.
 */
export const TERMINAL_BATCH_STATUSES = ['applied', 'undone', 'discarded'] as const;
export type TerminalBatchStatus = (typeof TERMINAL_BATCH_STATUSES)[number];

/** A batch the owner still has to resolve. The complement of the above. */
export function isBatchOpen(status: BatchStatus): boolean {
  return !(TERMINAL_BATCH_STATUSES as readonly string[]).includes(status);
}

export const LISTING_STATES = ['active', 'removed'] as const; // REQ-027/028
export type ListingState = (typeof LISTING_STATES)[number];

// ⚠ `'suppressed'` is DELIBERATELY ABSENT. Suppression is the existence of a
// `Suppression` row evaluated against the WORK, never a field on the title
// (REQ-071, ADR-0005). A reappearing title becomes a brand-new row, so a
// row-scoped suppression flag would appear to work and then silently stop.
// Collapsing the two is the highest-risk silent defect in the product
// (PRD R-5); `T-INV-004` asserts no title schema accepts `'suppressed'`.
export const TITLE_STATES = ['active', 'removed'] as const;
export type TitleState = (typeof TITLE_STATES)[number];

export const MATCH_STATES = ['matched', 'unmatched'] as const;
export type MatchState = (typeof MATCH_STATES)[number];

export const MEDIA_TYPES = ['movie', 'tv'] as const; // REQ-033
export type MediaType = (typeof MEDIA_TYPES)[number];

export const CANDIDATE_CLASSIFICATIONS = [
  'new', // REQ-010
  'already-present-for-this-service',
] as const;
export type CandidateClassification = (typeof CANDIDATE_CLASSIFICATIONS)[number];

export const REVIEW_DISPOSITIONS = [
  'pending', // default; NOT confirmed (REQ-014 / US-012 AC-3: no accept-by-inaction)
  'confirmed',
  'corrected', // owner re-pointed the match, then treated as confirmed
  'discarded',
  'unresolved', // unmatched and left unresolved at close (US-008 AC-4)
] as const;
export type ReviewDisposition = (typeof REVIEW_DISPOSITIONS)[number];

// Formats ACCEPTED AT UPLOAD (`specs/api.md` §5). An iOS Safari file input can
// deliver any of these depending on the capture/export path: camera photos
// default to HEIC, screenshots are normally PNG, "Most Compatible" photos are
// JPEG, and the laptop-web capture path produces PNG.
//
// ⚠ ALL FOUR ARE ACCEPTED. Do NOT "tidy" this list by dropping HEIC/HEIF or by
// swapping PNG out for it — the phone is the primary capture device, and
// rejecting HEIC rejects the owner's own photos at attach time (A42; ASM-034
// falsified, superseded by ASM-058).
export const UPLOAD_FORMATS = ['png', 'jpeg', 'heic', 'heif'] as const;
export type UploadFormat = (typeof UPLOAD_FORMATS)[number];

// HOW the bytes reached nextup (A45). THREE affordances, all first-class, all
// landing on the SAME endpoint and the SAME open batch (`specs/api.md` §5.3):
//   'paste'  — clipboard: a desktop `paste` event (Ctrl/Cmd+V) or the iOS
//              "Paste screenshot" button calling navigator.clipboard.read().
//              The owner's PRIMARY path. Bytes are always image/png in
//              practice — but still sniffed, never assumed.
//   'upload' — <input type="file">: the iOS Photos picker and the laptop file
//              picker. STILL FULLY SUPPORTED and NOT deprecated: it is the
//              only path that delivers raw HEIC, and the only one that works
//              when the owner missed the screenshot preview's "Copy".
//   'drop'   — drag-and-drop onto the batch screen.
//
// ⚠ This is an ADD, not a SWAP. Do NOT remove 'upload' on the grounds that
// paste is primary — that is the A42 mistake repeated.
export const INGEST_SOURCES = ['paste', 'upload', 'drop'] as const;
export type IngestSource = (typeof INGEST_SOURCES)[number];

// Formats STORED and handed to extraction. Neither extraction service accepts
// HEIC/HEIF, so HEIC/HEIF is transcoded to LOSSLESS PNG on ingest
// (`specs/api.md` §5.1) BEFORE it is stored or analysed. By the time bytes are
// persisted or reach the extractor they are ONLY 'png' | 'jpeg'.
export const IMAGE_FORMATS = ['png', 'jpeg'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

// `specs/data-model.md` §3.9 — every verdict is RENDERED somewhere in the
// review pass. None of them is a drop path: no candidate is ever deleted or
// hidden (REQ-012, US-006 AC-2, `T-AI-004`).
export const CLEANUP_VERDICTS = [
  'title-candidate', // passes every heuristic
  'low-confidence', // surfaced in review, flagged, NOT dropped (REQ-012)
  'inferred-unverified', // model title with no corroborating OCR text — artwork read OR
  // fabrication, indistinguishable from inside, so BOTH are shown
  'unreadable-tile', // a tile the model could not name at all
  'chrome-suspected', // collapsed behind a labelled expander, NEVER omitted
] as const;
export type CleanupVerdict = (typeof CLEANUP_VERDICTS)[number];

/** What the primary reader read a candidate from (`specs/ai.md`). */
export const CANDIDATE_BASES = ['text', 'artwork', 'both', 'unknown'] as const;
export type CandidateBasis = (typeof CANDIDATE_BASES)[number];

/** The deterministic OCR cross-check verdict for a candidate. */
export const OCR_SUPPORTS = ['exact', 'partial', 'none', 'not-checked'] as const;
export type OcrSupport = (typeof OCR_SUPPORTS)[number];

/** Which reader produced a candidate. `'ocr-only'` is a model orphan. */
export const CANDIDATE_PROVIDERS = ['llm', 'ocr-only'] as const;
export type CandidateProvider = (typeof CANDIDATE_PROVIDERS)[number];

/** Which reader produced a candidate's geometry; OCR is exact and preferred. */
export const BOX_SOURCES = ['ocr', 'llm'] as const;
export type BoxSource = (typeof BOX_SOURCES)[number];

/**
 * Whether the deterministic OCR pass and the vision model could be cross-checked
 * against each other for a batch (`specs/ai.md` §2.2, D-4).
 *
 * ⚠ This is SAFETY STATE, not a statistic. Anything other than `'ok'` means one
 * of the two readers was unavailable, so the extraction was never corroborated —
 * which forces `computeRemovals: false` on the batch. A batch that could not be
 * cross-checked must never be allowed to conclude that a title was removed:
 * that is product invariant 2 (a failed extraction is not a removal).
 *
 * Mirrors `ck_batch_cross_check` in `prisma/migrations/0001_init/migration.sql`.
 */
export const CROSS_CHECK_OUTCOMES = ['ok', 'ocr-unavailable', 'llm-unavailable'] as const;
export type CrossCheckOutcome = (typeof CROSS_CHECK_OUTCOMES)[number];

/** Batch extraction failure codes (`specs/data-model.md` §3.6). */
export const EXTRACTION_ERROR_CODES = [
  'EXTRACTOR_UNAVAILABLE',
  'EXTRACTOR_ERROR',
  'IMAGES_PURGED',
] as const;
export type ExtractionErrorCode = (typeof EXTRACTION_ERROR_CODES)[number];
