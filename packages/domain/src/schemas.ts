// Zod schemas mirroring `types.ts` — `specs/data-model.md` §3.
//
// These validate EVERY store read and every external payload (extraction, TMDB,
// HTTP body). Each schema is bound to its interface with
// `satisfies z.ZodType<T>`, so a field added to the type without a matching
// schema rule is a COMPILE error rather than a silently unvalidated field.
//
// Schemas are `.strict()`: an unexpected key is an ERROR, not something to
// quietly strip. Stripping hides a producer/consumer mismatch until it matters.

import { z } from 'zod';

import {
  BATCH_MODES,
  BATCH_STATUSES,
  BOX_SOURCES,
  CANDIDATE_BASES,
  CANDIDATE_CLASSIFICATIONS,
  CANDIDATE_PROVIDERS,
  CLEANUP_VERDICTS,
  EXTRACTION_ERROR_CODES,
  IMAGE_FORMATS,
  INGEST_SOURCES,
  LISTING_STATES,
  MATCH_STATES,
  MEDIA_TYPES,
  OCR_SUPPORTS,
  REVIEW_DISPOSITIONS,
  SERVICES,
  TITLE_STATES,
  UPLOAD_FORMATS,
} from './enums.js';
import { WORK_IDENTITY_RE } from './identity.js';
import type {
  BatchProvenance,
  BoundingBox,
  ExtractionCandidate,
  ExtractionError,
  ExtractionStats,
  MatchCandidate,
  RemovalGroup,
  ServiceListing,
  ServiceState,
  Suppression,
  SuppressionDisplaySnapshot,
  Title,
  TmdbMetadata,
  UploadBatch,
  UploadedImage,
} from './types.js';

// ── Primitives ─────────────────────────────────────────────────────────────

/** ISO-8601 UTC instant. */
export const isoDateTimeSchema = z.iso.datetime();

/** Calendar date, `YYYY-MM-DD`. */
export const isoDateSchema = z.iso.date();

const idSchema = z.string().min(1).max(64);

export const workIdentitySchema = z.string().regex(WORK_IDENTITY_RE, {
  message: 'workIdentity must be tmdb:{movie|tv}:{id} or unmatched:{16 hex}',
});

export const serviceSchema = z.enum(SERVICES);
export const batchModeSchema = z.enum(BATCH_MODES);
export const batchStatusSchema = z.enum(BATCH_STATUSES);
export const listingStateSchema = z.enum(LISTING_STATES);
export const titleStateSchema = z.enum(TITLE_STATES);
export const matchStateSchema = z.enum(MATCH_STATES);
export const mediaTypeSchema = z.enum(MEDIA_TYPES);
export const candidateClassificationSchema = z.enum(CANDIDATE_CLASSIFICATIONS);
export const reviewDispositionSchema = z.enum(REVIEW_DISPOSITIONS);
export const uploadFormatSchema = z.enum(UPLOAD_FORMATS);
export const ingestSourceSchema = z.enum(INGEST_SOURCES);
export const imageFormatSchema = z.enum(IMAGE_FORMATS);
export const cleanupVerdictSchema = z.enum(CLEANUP_VERDICTS);

// ── Title ──────────────────────────────────────────────────────────────────

export const serviceListingSchema = z
  .object({
    listingId: idSchema,
    service: serviceSchema,
    state: listingStateSchema,
    dateAdded: isoDateSchema,
    dateAddedEdited: z.boolean(),
    removedAt: isoDateTimeSchema.nullable(),
    removedByBatchId: idSchema.nullable(),
    removedByGroupId: idSchema.nullable(),
    createdByBatchId: idSchema,
  })
  .strict() satisfies z.ZodType<ServiceListing>;

export const tmdbMetadataSchema = z
  .object({
    tmdbId: z.number().int().positive(),
    mediaType: mediaTypeSchema,
    name: z.string().min(1).max(300),
    // The upper bound is deliberately generous: TMDB carries announced titles.
    releaseYear: z
      .number()
      .int()
      .min(1880)
      .max(new Date().getUTCFullYear() + 5)
      .nullable(),
    runtimeMinutes: z.number().int().positive().nullable(),
    // `[]` means "TMDB carries no genre" and is NEVER replaced by a default
    // (US-019 AC-6). Nothing here may supply one.
    genres: z.array(z.string().min(1)),
    // A TMDB *path*, never a URL — the web app composes the CDN URL.
    posterPath: z
      .string()
      .regex(/^\/[\w./-]+$/, { message: 'posterPath is a TMDB path, not a URL' })
      .nullable(),
    fetchedAt: isoDateTimeSchema,
  })
  .strict() satisfies z.ZodType<TmdbMetadata>;

export const titleSchema = z
  .object({
    id: idSchema,
    type: z.literal('title'),
    ownerId: idSchema,
    workIdentity: workIdentitySchema,
    // `'suppressed'` is not a member of TITLE_STATES and must never become one
    // (REQ-071, `T-INV-004`).
    state: titleStateSchema,
    matchState: matchStateSchema,
    rawExtractedText: z.string().min(1).max(500).nullable(),
    normalisedText: z.string().max(500).nullable(),
    createdByBatchId: idSchema.nullable(),
    visible: z.boolean(),
    listings: z.array(serviceListingSchema).min(1).max(SERVICES.length),
    tmdb: tmdbMetadataSchema.nullable(),
    sortDateAdded: isoDateSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  // `'matched'` ⟺ workIdentity starts `tmdb:` ⟺ tmdb !== null (§3.2). All three
  // are one fact; letting them disagree is how a "matched" title with no
  // metadata reaches the list.
  .refine((t) => (t.matchState === 'matched') === t.workIdentity.startsWith('tmdb:'), {
    message: "matchState 'matched' must agree with a tmdb: workIdentity",
    path: ['matchState'],
  })
  .refine((t) => (t.matchState === 'matched') === (t.tmdb !== null), {
    message: "matchState 'matched' must agree with tmdb metadata being present",
    path: ['tmdb'],
  })
  // An unmatched title carries the text it was read from, and its normalised
  // form. Without these the row cannot be re-matched or explained.
  .refine((t) => t.matchState !== 'unmatched' || t.rawExtractedText !== null, {
    message: 'rawExtractedText is required when matchState is unmatched',
    path: ['rawExtractedText'],
  })
  .refine((t) => t.matchState !== 'unmatched' || t.normalisedText !== null, {
    message: 'normalisedText is required when matchState is unmatched',
    path: ['normalisedText'],
  })
  // At most one listing per service (`T-INV-002`).
  .refine((t) => new Set(t.listings.map((l) => l.service)).size === t.listings.length, {
    message: 'at most one listing per service',
    path: ['listings'],
  }) satisfies z.ZodType<Title>;

// ── Suppression ────────────────────────────────────────────────────────────

export const suppressionDisplaySnapshotSchema = z
  .object({
    name: z.string().min(1).max(300),
    releaseYear: z.number().int().min(1880).nullable(),
    mediaType: mediaTypeSchema.nullable(),
    posterPath: z.string().nullable(),
  })
  .strict() satisfies z.ZodType<SuppressionDisplaySnapshot>;

export const suppressionSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.literal('suppression'),
    ownerId: idSchema,
    workIdentity: workIdentitySchema,
    active: z.boolean(),
    suppressedAt: isoDateTimeSchema,
    unsuppressedAt: isoDateTimeSchema.nullable(),
    migratedFrom: workIdentitySchema.nullable(),
    displaySnapshot: suppressionDisplaySnapshotSchema,
  })
  .strict() satisfies z.ZodType<Suppression>;

// ── Batch ──────────────────────────────────────────────────────────────────

export const extractionErrorSchema = z
  .object({
    code: z.enum(EXTRACTION_ERROR_CODES),
    message: z.string().min(1),
    at: isoDateTimeSchema,
  })
  .strict() satisfies z.ZodType<ExtractionError>;

const countSchema = z.number().int().min(0);

export const extractionStatsSchema = z
  .object({
    imagesProcessed: countSchema,
    imagesWithZeroCandidates: countSchema,
    candidatesRaw: countSchema,
    candidatesAfterCleanup: countSchema,
    candidatesCollapsed: countSchema,
    matched: countSchema,
    unmatched: countSchema,
    suppressedGated: countSchema,
  })
  .strict() satisfies z.ZodType<ExtractionStats>;

export const batchProvenanceSchema = z
  .object({
    created: z.array(
      z
        .object({
          titleId: idSchema,
          listingId: idSchema.nullable(),
          titleWasCreated: z.boolean(),
        })
        .strict(),
    ),
    modified: z.array(
      z
        .object({
          titleId: idSchema,
          attr: z.string().min(1),
          // `unknown`, not `any`: the pre-batch value of an arbitrary attribute
          // is genuinely unknown, and REQ-075's refusal enumeration reads it
          // back out without interpreting it.
          before: z.unknown(),
          after: z.unknown(),
        })
        .strict(),
    ),
    removed: z.array(
      z
        .object({
          titleId: idSchema,
          listingId: idSchema,
          beforeState: z.literal('active'),
          groupId: idSchema,
        })
        .strict(),
    ),
  })
  .strict() satisfies z.ZodType<BatchProvenance>;

export const removalGroupSchema = z
  .object({
    groupId: idSchema,
    confirmedAt: isoDateTimeSchema,
    listingIds: z.array(idSchema),
    reversed: z.boolean(),
    reversedAt: isoDateTimeSchema.nullable(),
    heldBackListingIds: z.array(idSchema),
  })
  .strict() satisfies z.ZodType<RemovalGroup>;

export const uploadBatchSchema = z
  .object({
    id: idSchema,
    type: z.literal('uploadBatch'),
    ownerId: idSchema,
    service: serviceSchema,
    mode: batchModeSchema,
    status: batchStatusSchema,
    derivedFromBatchId: idSchema.nullable(),
    createdAt: isoDateTimeSchema,
    submittedAt: isoDateTimeSchema.nullable(),
    extractionStartedAt: isoDateTimeSchema.nullable(),
    extractionError: extractionErrorSchema.nullable(),
    completedAt: isoDateTimeSchema.nullable(),
    undoneAt: isoDateTimeSchema.nullable(),
    extractionStats: extractionStatsSchema.nullable(),
    removalGroups: z.array(removalGroupSchema),
    provenance: batchProvenanceSchema,
  })
  .strict()
  // `completedAt` is set iff the batch is applied (§3.6).
  .refine((b) => (b.status === 'applied') === (b.completedAt !== null), {
    message: "completedAt is set if and only if status is 'applied'",
    path: ['completedAt'],
  }) satisfies z.ZodType<UploadBatch>;

// ── Images ─────────────────────────────────────────────────────────────────

/** 10 MiB per image — `specs/api.md` §5. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const uploadedImageSchema = z
  .object({
    id: idSchema,
    type: z.literal('uploadedImage'),
    ownerId: idSchema,
    batchId: idSchema,
    blobPath: z.string().min(1),
    // Never empty, never whitespace-only: the whole per-image error-reporting
    // model works by NAMING the file, and a batch may hold 40 of them.
    fileName: z
      .string()
      .min(1)
      .max(255)
      .refine((v) => v.trim().length > 0, { message: 'fileName must not be blank' }),
    ingestSource: ingestSourceSchema,
    uploadedFormat: uploadFormatSchema,
    // Always png|jpeg by the time it is persisted: HEIC/HEIF is transcoded to
    // lossless PNG on ingest, before storage and before extraction.
    format: imageFormatSchema,
    byteSize: z.number().int().positive().max(MAX_IMAGE_BYTES),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    uploadedAt: isoDateTimeSchema,
    retainUntil: isoDateTimeSchema,
    candidateCount: countSchema.nullable(),
  })
  .strict() satisfies z.ZodType<UploadedImage>;

// ── Extraction ─────────────────────────────────────────────────────────────

export const boundingBoxSchema = z
  .object({
    imageId: idSchema,
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
  })
  .strict() satisfies z.ZodType<BoundingBox>;

export const matchCandidateSchema = z
  .object({
    tmdbId: z.number().int().positive(),
    mediaType: mediaTypeSchema,
    name: z.string().min(1).max(300),
    releaseYear: z.number().int().min(1880).nullable(),
    posterPath: z.string().nullable(),
    score: z.number(),
  })
  .strict() satisfies z.ZodType<MatchCandidate>;

export const extractionCandidateSchema = z
  .object({
    id: z.string().min(1).max(256),
    type: z.literal('extractionCandidate'),
    ownerId: idSchema,
    batchId: idSchema,
    sourceImageIds: z.array(idSchema).min(1),
    // `''` is allowed ONLY for an unreadable tile — refined below.
    rawText: z.string().max(500),
    inferredTitle: z.string().min(1).max(500).nullable(),
    basis: z.enum(CANDIDATE_BASES),
    ocrSupport: z.enum(OCR_SUPPORTS),
    provider: z.enum(CANDIDATE_PROVIDERS),
    normalisedText: z.string().max(500),
    // MATCH HINT ONLY — never enters identity (SD-05).
    extractedYear: z.number().int().min(1880).nullable(),
    boundingBoxes: z.array(boundingBoxSchema),
    boxSource: z.enum(BOX_SOURCES),
    ocrConfidence: z.number().min(0).max(1).nullable(),
    cleanupVerdict: cleanupVerdictSchema,
    resolvedWorkIdentity: workIdentitySchema.nullable(),
    matchCandidates: z.array(matchCandidateSchema),
    classification: candidateClassificationSchema.nullable(),
    reviewDisposition: reviewDispositionSchema,
    correctedToTmdbId: z.number().int().positive().nullable(),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .refine((c) => c.rawText.length > 0 || c.cleanupVerdict === 'unreadable-tile', {
    message: "rawText may only be empty for the 'unreadable-tile' verdict",
    path: ['rawText'],
  }) satisfies z.ZodType<ExtractionCandidate>;

// ── Service state ──────────────────────────────────────────────────────────

export const serviceStateSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z.literal('serviceState'),
    ownerId: idSchema,
    service: serviceSchema,
    lastCompletedBatchAt: isoDateTimeSchema.nullable(),
    lastCompletedBatchId: idSchema.nullable(),
  })
  .strict() satisfies z.ZodType<ServiceState>;

// ── The discriminated union ────────────────────────────────────────────────

/**
 * Every stored document, discriminated on `type`. `titleSchema` carries
 * refinements, so this is a plain union rather than `discriminatedUnion` —
 * the `type` literals still make the failure message unambiguous.
 */
export const ownerDocumentSchema = z.union([
  titleSchema,
  suppressionSchema,
  uploadBatchSchema,
  uploadedImageSchema,
  extractionCandidateSchema,
  serviceStateSchema,
]);
