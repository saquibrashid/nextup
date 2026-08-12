// Domain types — `specs/data-model.md` §3.
//
// These are imported verbatim by `apps/api` and `apps/web` (ADR-0004). There is
// no `any` anywhere in this file and none may be introduced.
//
// STORAGE NOTE (R3/R4). §3 is partially superseded on *storage* framing only:
// the fields, their validation rules and their semantics below are binding and
// unchanged. Under the relational model each interface is a TABLE,
// `ServiceListing` is a CHILD TABLE, and `visible` does not exist as a stored
// column — it is the batch-visibility rule of §16. The interfaces keep
// `visible` because the API and review pass still reason in those terms;
// `specs/data-model.md` §16.3 gives the column mapping (camelCase in code,
// snake_case in the database).

import type {
  BatchMode,
  BatchStatus,
  BoxSource,
  CandidateBasis,
  CandidateClassification,
  CandidateProvider,
  CleanupVerdict,
  ExtractionErrorCode,
  ImageFormat,
  IngestSource,
  ListingState,
  MatchState,
  MediaType,
  OcrSupport,
  ReviewDisposition,
  Service,
  TitleState,
  UploadFormat,
} from './enums.js';

/** ISO-8601 UTC instant, e.g. `2026-08-11T21:04:33.000Z`. */
export type IsoDateTime = string;

/** Calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

// ── Title ──────────────────────────────────────────────────────────────────

/** `specs/data-model.md` §3.2 — the central document. */
export interface Title {
  id: string;
  type: 'title';
  ownerId: string;
  /** §2 — required, matches `WORK_IDENTITY_RE`. Immutable except by fix-match. */
  workIdentity: string;
  /** DERIVED (§5.1). Never written by a caller. */
  state: TitleState;
  /** `'matched'` ⟺ `workIdentity` starts `tmdb:` ⟺ `tmdb !== null`. */
  matchState: MatchState;
  /** Required when `matchState === 'unmatched'`; 1..500 chars. */
  rawExtractedText: string | null;
  /** Must equal `normaliseTitleText(rawExtractedText)` — `T-INV-005`. */
  normalisedText: string | null;
  /** `null` iff created outside a batch (never in v1). */
  createdByBatchId: string | null;
  /** `false` until the creating batch reaches `'applied'`. */
  visible: boolean;
  /** 1..2 in v1; at most one per service (`T-INV-002`). */
  listings: ServiceListing[];
  /** `null` iff `matchState === 'unmatched'`. */
  tmdb: TmdbMetadata | null;
  /** DERIVED (§5.2). `null` iff every listing is removed AND none had a date. */
  sortDateAdded: IsoDate | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** `specs/data-model.md` §3.3. */
export interface ServiceListing {
  listingId: string;
  service: Service;
  state: ListingState;
  /**
   * REQ-030. WRITE-ONCE (US-021 AC-6): exactly one function may set it
   * (`createListing()`), there is no `updateDateAdded`, and `T-INV-006` greps
   * for any other assignment. It is never read out of an image — its value is
   * `batch.submittedAt` rendered as a UTC date.
   */
  dateAdded: IsoDate;
  /** v1.1 (REQ-059) — modelled now, ALWAYS `false` in v1 (`T-INV-007`). */
  dateAddedEdited: boolean;
  /** REQ-062. `null` while active. */
  removedAt: IsoDateTime | null;
  removedByBatchId: string | null;
  /** REQ-056 group undo (§8.2). */
  removedByGroupId: string | null;
  createdByBatchId: string;
}

/** `specs/data-model.md` §3.4. */
export interface TmdbMetadata {
  tmdbId: number;
  mediaType: MediaType;
  name: string;
  /** 1880..currentYear+5, or `null` when TMDB has none. */
  releaseYear: number | null;
  /** Stored in v1, filtered in v1.1 (REQ-035/037). */
  runtimeMinutes: number | null;
  /**
   * May be `[]`, meaning "TMDB carries no genre". NEVER defaulted
   * (US-019 AC-6, `T-LIST-011`).
   */
  genres: string[];
  /**
   * A TMDB path, never a URL, e.g. `/d5NXS.jpg`. The web app composes
   * `https://image.tmdb.org/t/p/w342{posterPath}`; bytes are served by TMDB's
   * CDN and never proxied.
   */
  posterPath: string | null;
  /** NFR-014 / REQ-076 age test. */
  fetchedAt: IsoDateTime;
}

// ── Suppression ────────────────────────────────────────────────────────────

/**
 * `specs/data-model.md` §3.5. Keyed on canonical WORK IDENTITY, never on a row
 * id (REQ-071) — a reappearing title becomes a brand-new row, so a row-scoped
 * flag is silently bypassed on the next capture.
 */
export interface Suppression {
  id: string;
  type: 'suppression';
  ownerId: string;
  workIdentity: string;
  /** `false` === un-suppressed. NEVER DELETED (REQ-028, US-029 AC-2). */
  active: boolean;
  suppressedAt: IsoDateTime;
  unsuppressedAt: IsoDateTime | null;
  /** SD-06 — the previous `workIdentity` if migrated by fix-match. */
  migratedFrom: string | null;
  /** So the suppressed view renders without a `Title` (US-029 AC-1). */
  displaySnapshot: SuppressionDisplaySnapshot;
}

export interface SuppressionDisplaySnapshot {
  name: string;
  releaseYear: number | null;
  mediaType: MediaType | null;
  posterPath: string | null;
}

// ── Batch ──────────────────────────────────────────────────────────────────

/** `specs/data-model.md` §3.6. */
export interface UploadBatch {
  id: string;
  type: 'uploadBatch';
  ownerId: string;
  /** IMMUTABLE after submit (US-003 AC-6). */
  service: Service;
  /** IMMUTABLE after submit (US-003 AC-6). */
  mode: BatchMode;
  status: BatchStatus;
  /** Set for re-extraction batches (US-034 AC-3). */
  derivedFromBatchId: string | null;
  createdAt: IsoDateTime;
  submittedAt: IsoDateTime | null;
  extractionStartedAt: IsoDateTime | null;
  extractionError: ExtractionError | null;
  /** Set iff `status === 'applied'`. */
  completedAt: IsoDateTime | null;
  undoneAt: IsoDateTime | null;
  /** The ONLY evidence for RSK-021 / OQ-024. */
  extractionStats: ExtractionStats | null;
  /** 0..1 in v1 (§8.2). */
  removalGroups: RemovalGroup[];
  /** REQ-068 (§8.1). */
  provenance: BatchProvenance;
}

export interface ExtractionError {
  code: ExtractionErrorCode;
  message: string;
  at: IsoDateTime;
}

export interface ExtractionStats {
  imagesProcessed: number;
  imagesWithZeroCandidates: number;
  candidatesRaw: number;
  candidatesAfterCleanup: number;
  candidatesCollapsed: number;
  matched: number;
  unmatched: number;
  suppressedGated: number;
}

/**
 * `specs/data-model.md` §3.7. `modified` records the PRE-BATCH value of every
 * modified attribute (REQ-068) even though v1 undo is creates-only, because
 * REQ-075's refusal enumeration reads straight out of these three arrays. A
 * change without provenance MUST NOT be persisted (US-031 AC-6).
 */
export interface BatchProvenance {
  created: Array<{ titleId: string; listingId: string | null; titleWasCreated: boolean }>;
  modified: Array<{ titleId: string; attr: string; before: unknown; after: unknown }>;
  removed: Array<{ titleId: string; listingId: string; beforeState: 'active'; groupId: string }>;
}

export interface RemovalGroup {
  groupId: string;
  confirmedAt: IsoDateTime;
  /** May be `[]` — US-015 AC-5. */
  listingIds: string[];
  /** US-017 AC-5: cannot be reversed twice. */
  reversed: boolean;
  reversedAt: IsoDateTime | null;
  /** US-017 AC-4: suppressed works are not restored by undo. */
  heldBackListingIds: string[];
}

// ── Images ─────────────────────────────────────────────────────────────────

/** `specs/data-model.md` §3.8. */
export interface UploadedImage {
  id: string;
  type: 'uploadedImage';
  ownerId: string;
  batchId: string;
  /**
   * `${ownerId}/${batchId}/${id}.${ext}` — composed ONLY from server-generated
   * ULIDs. NEVER emitted to a client: `T-SEC-003` asserts no response body or
   * header contains a `blobPath` or `blob.core.windows.net`.
   */
  blobPath: string;
  /**
   * DISPLAY ONLY, 1..255, never empty, and NEVER used to build a path
   * (`specs/security.md` T4). Device-supplied for `'upload'`/`'drop'`;
   * synthesised by the server for `'paste'`, which supplies no name.
   */
  fileName: string;
  /**
   * HOW the bytes arrived (A45). WRITE-ONCE provenance: set at ingest, never
   * updated. Do NOT infer it from the filename prefix — the prefix is display
   * copy and may be re-worded; this field is the datum.
   */
  readonly ingestSource: IngestSource;
  /**
   * What the owner's DEVICE delivered — may be `'heic'`/`'heif'`. Determined by
   * MAGIC BYTES, never by extension or declared Content-Type (iOS commonly
   * sends `application/octet-stream`).
   */
  readonly uploadedFormat: UploadFormat;
  /**
   * The STORED format actually persisted, always `png`|`jpeg`. HEIC/HEIF is
   * transcoded to LOSSLESS PNG on ingest. Also determined by magic bytes.
   */
  format: ImageFormat;
  /** `<= 10 * 1024 * 1024`. */
  byteSize: number;
  width: number | null;
  height: number | null;
  uploadedAt: IsoDateTime;
  /**
   * `uploadedAt` + `IMAGE_RETENTION_DAYS` (30). WRITTEN ONCE, NEVER UPDATED
   * (NFR-019). Availability is DERIVED, never stored as mutable state:
   * `isAvailable = Date.now() < Date.parse(retainUntil)`. A missing blob and an
   * expired `retainUntil` are the same expected, non-error condition — never a
   * 500 (ADR-0006).
   */
  readonly retainUntil: IsoDateTime;
  /** `null` until extraction runs; `0` is meaningful (US-006 AC-3). */
  candidateCount: number | null;
}

// ── Extraction ─────────────────────────────────────────────────────────────

export interface BoundingBox {
  imageId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MatchCandidate {
  tmdbId: number;
  mediaType: MediaType;
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
  score: number;
}

/** `specs/data-model.md` §3.9. */
export interface ExtractionCandidate {
  /** `cand:${batchId}:${sourceImageId}:${seq}` — deterministic. */
  id: string;
  type: 'extractionCandidate';
  ownerId: string;
  batchId: string;
  /** >= 1. MORE THAN ONE after intra-batch overlap collapse (§7.4). */
  sourceImageIds: string[];
  /** Verbatim reader text, 1..500. `''` allowed ONLY for `'unreadable-tile'`. */
  rawText: string;
  /** The model's structured, de-truncated title. `null` for ocr-only items. */
  inferredTitle: string | null;
  basis: CandidateBasis;
  ocrSupport: OcrSupport;
  provider: CandidateProvider;
  /** `normaliseTitleText(inferredTitle ?? rawText)` — `specs/ai.md` §3.1a. */
  normalisedText: string;
  /** MATCH HINT ONLY — never enters identity (SD-05). */
  extractedYear: number | null;
  boundingBoxes: BoundingBox[];
  boxSource: BoxSource;
  /** 0..1 as reported by the provider, or `null`. */
  ocrConfidence: number | null;
  /** Classify-and-surface, never drop (`specs/ai.md` §3.3). */
  cleanupVerdict: CleanupVerdict;
  resolvedWorkIdentity: string | null;
  /** US-007 AC-4: alternatives are shown, never hidden. */
  matchCandidates: MatchCandidate[];
  /** `null` while unmatched. */
  classification: CandidateClassification | null;
  reviewDisposition: ReviewDisposition;
  correctedToTmdbId: number | null;
  createdAt: IsoDateTime;
}

// ── Service state ──────────────────────────────────────────────────────────

/**
 * `specs/data-model.md` §3.10. Written ONLY when a batch reaches `'applied'`
 * (US-022 AC-4) and rewritten to the previous applied batch when a batch is
 * undone (US-032 AC-2). Abandoned, discarded and failed batches never touch it.
 *
 * This is the factual per-service last-updated date behind REQ-039's freshness
 * strip. It is a FACT, shown plainly — there is no staleness threshold, no
 * derived `stale` flag and no nag (A46).
 */
export interface ServiceState {
  /** `svcstate:${service}`. */
  id: string;
  type: 'serviceState';
  ownerId: string;
  service: Service;
  /** `null` === "never updated" (US-022 AC-3). */
  lastCompletedBatchAt: IsoDateTime | null;
  lastCompletedBatchId: string | null;
}

// ── The discriminated union ────────────────────────────────────────────────

/**
 * Every stored document, discriminated on `type`. An exhaustive `switch` over
 * this union fails to compile when a document type is added, which is the
 * point.
 */
export type OwnerDocument =
  Title | Suppression | UploadBatch | UploadedImage | ExtractionCandidate | ServiceState;

export type OwnerDocumentType = OwnerDocument['type'];
