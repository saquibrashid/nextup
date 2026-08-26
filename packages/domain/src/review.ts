/**
 * TASK-065 — the review response, assembled.
 *
 * `specs/api.md` §6.17 (`GET /api/batches/:batchId/review`), serving US-012,
 * US-013 and US-014. This module is the PURE half: given the batch's safety
 * state, its candidates and the service's active listings, it decides which
 * section every candidate belongs to and whether the removal section may be
 * shown at all. The route (`apps/api/src/routes/batchReview.ts`) does the I/O.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠ THE SINGLE MOST IMPORTANT SAFETY PROPERTY IN THE PRODUCT
 * ─────────────────────────────────────────────────────────────────────────
 * **In `full-update` mode the review pass shows ALL extracted titles**,
 * including the ones already present for that service (REQ-057, US-013 AC-6,
 * `specs/ai.md` §6.3).
 *
 * In a full-update batch, *absence means removal*. If the review pass hid
 * already-known titles, the owner would have no way to see that a title they
 * know is on the service **failed to extract** — and its absence would be
 * silently reconciled as a removal. Showing all extracted titles turns a
 * silent data-loss bug into a visible discrepancy the owner can act on.
 *
 * That is why `alreadyOnYourList.omitted` is `true` ONLY in `append-only`
 * mode, where absence means nothing, and why there is no "hide known titles"
 * option anywhere in this file. `T-REV-006`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠ NOTHING IS EVER DROPPED
 * ─────────────────────────────────────────────────────────────────────────
 * REQ-012: every candidate is reachable in this response (`T-AI-004`). Chrome
 * and unreadable tiles are COLLAPSED, never omitted, and they carry a visible
 * count. `assertEveryCandidateRouted` proves the partition is total, so a new
 * `CleanupVerdict` added later cannot silently vanish from review.
 *
 * The one exception is a candidate collapsed by SD-02 intra-batch overlap
 * (`collapsedIntoCandidateId !== null`). It is not dropped — its provenance
 * was absorbed into the survivor, which IS in the response — so showing it
 * again would double-count one work. `T-AI-007`.
 *
 * Pure: no I/O, no clock, no database.
 */

import type {
  BatchMode,
  CandidateBasis,
  CandidateProvider,
  CleanupVerdict,
  CrossCheckOutcome,
  MediaType,
  OcrSupport,
  ReviewDisposition,
  Service,
} from './enums.js';
import type { IsoDate } from './types.js';

/** `specs/ai.md` §8.1 — half the images yielding nothing is a low-yield read. */
export const ZERO_YIELD_IMAGE_RATIO = 0.5;

// ── Inputs ─────────────────────────────────────────────────────────────────

/** One scored TMDB alternative, as rendered inline (US-007 AC-4). */
export interface ReviewMatchRef {
  tmdbId: number;
  mediaType: MediaType;
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
  score: number;
}

export interface ReviewMatch extends ReviewMatchRef {
  uncertain: boolean;
  ambiguous: boolean;
}

/** The candidate shape this module routes. Mirrors `specs/api.md` §6.17. */
export interface ReviewCandidate {
  candidateId: string;
  rawText: string;
  inferredTitle: string | null;
  basis: CandidateBasis;
  ocrSupport: OcrSupport;
  provider: CandidateProvider;
  verdict: CleanupVerdict;
  ocrConfidence: number | null;
  resolvedWorkIdentity: string | null;
  match: ReviewMatch | null;
  alternatives: ReviewMatchRef[];
  sourceImageIds: string[];
  disposition: ReviewDisposition;
  /** SD-02. Non-null ⇒ absorbed by the survivor; not rendered again. */
  collapsedIntoCandidateId: string | null;
  /** `null` for an unmatched candidate (`T-CLS-013`). */
  classification: 'new' | 'already-present-for-this-service' | null;
}

/** A listing that may be proposed for removal. */
export interface ReviewRemovalItem {
  listingId: string;
  titleId: string;
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
  service: Service;
  dateAdded: IsoDate;
  /** REQ-055, US-015 AC-1 — ALWAYS `true` on arrival. */
  ticked: boolean;
}

export interface ReviewImageWithNoText {
  imageId: string;
  fileName: string;
}

export interface BuildReviewInput {
  batchId: string;
  service: Service;
  mode: BatchMode;
  lowYield: boolean;
  degradedExtraction: boolean;
  crossCheck: CrossCheckOutcome;
  candidates: readonly ReviewCandidate[];
  /**
   * Active listings for this service that NO surviving candidate resolved to.
   * The caller computes the set difference; this module decides whether the
   * owner is allowed to see it.
   */
  disappearedListings: readonly Omit<ReviewRemovalItem, 'ticked'>[];
  imagesWithNoText: readonly ReviewImageWithNoText[];
}

// ── Output ─────────────────────────────────────────────────────────────────

export interface ReviewSection<T> {
  label: string;
  count: number;
  items: T[];
}

export interface CollapsibleSection<T> extends ReviewSection<T> {
  collapsedByDefault: boolean;
  omitted: boolean;
}

export interface RemovalSection extends ReviewSection<ReviewRemovalItem> {
  omitted: boolean;
  withheld: boolean;
  withheldReason: RemovalWithheldReason | null;
}

export type RemovalWithheldReason = 'low-yield' | 'degraded-extraction';

export interface ReviewResponse {
  batchId: string;
  service: Service;
  mode: BatchMode;
  lowYield: boolean;
  degradedExtraction: boolean;
  crossCheck: CrossCheckOutcome;
  banner: string | null;
  sections: {
    additions: ReviewSection<ReviewCandidate>;
    alreadyOnYourList: CollapsibleSection<ReviewCandidate>;
    probablyNotTitles: CollapsibleSection<ReviewCandidate>;
    unmatched: ReviewSection<ReviewCandidate>;
    unreadableTiles: ReviewSection<ReviewCandidate>;
    removals: RemovalSection;
  };
  imagesWithNoText: ReviewImageWithNoText[];
}

// ── Section labels (`specs/api.md` §6.17) ──────────────────────────────────

export const REVIEW_LABELS = {
  additions: 'New to your list',
  alreadyOnYourList: 'Already on your list',
  probablyNotTitles: 'Probably not titles',
  unmatched: "Couldn't identify these",
  unreadableTiles: "Couldn't read these",
} as const;

/** The removal label names the SERVICE, so the scope is unmistakable. */
export function removalsLabel(service: Service): string {
  return service === 'netflix' ? 'No longer on Netflix' : 'No longer on Max';
}

// ── Routing ────────────────────────────────────────────────────────────────

export type ReviewSectionName =
  'additions' | 'alreadyOnYourList' | 'probablyNotTitles' | 'unmatched' | 'unreadableTiles';

/**
 * Which section one candidate belongs to. TOTAL over every `CleanupVerdict`.
 *
 * Order matters and is deliberate:
 *
 * 1. `unreadable-tile` first — it has no text to match on, so every later test
 *    would misfire. This mirrors TASK-057's verdict precedence, where deciding
 *    `unreadable-tile` first is what stops it being buried in the chrome group.
 * 2. `chrome-suspected` next — probably not a title at all, so it must not be
 *    presented as an addition even if a match was somehow resolved.
 * 3. Unmatched (`resolvedWorkIdentity` null or `unmatched:`-prefixed) — the
 *    owner is asked to identify it, not to confirm it.
 * 4. Then, and only then, the classification decides additions vs already-present.
 */
export function sectionForCandidate(candidate: ReviewCandidate): ReviewSectionName {
  if (candidate.verdict === 'unreadable-tile') return 'unreadableTiles';
  if (candidate.verdict === 'chrome-suspected') return 'probablyNotTitles';
  if (
    candidate.resolvedWorkIdentity === null ||
    candidate.resolvedWorkIdentity.startsWith('unmatched:')
  ) {
    return 'unmatched';
  }
  return candidate.classification === 'already-present-for-this-service'
    ? 'alreadyOnYourList'
    : 'additions';
}

// ── Removal withholding (`specs/ai.md` §8.2) ───────────────────────────────

/**
 * May this batch propose removals, and if not, why?
 *
 * Two independent conditions each force withholding, and **`lowYield` is
 * reported first** because it is the one the owner can act on (re-extract, add
 * screenshots). Both mean the same thing: an incomplete read would propose
 * removing titles that are still on the list.
 *
 * ⚠ `crossCheck === 'ocr-unavailable'` does NOT withhold. The primary reader —
 * the one that identifies works — ran; only the deterministic corroboration
 * leg is missing. Withholding there would make an OCR outage block every
 * full-update batch. `T-AI-036`, `apps/api/src/extraction/llmVisionExtractor.ts`.
 */
export function removalWithheldReason(input: {
  lowYield: boolean;
  crossCheck: CrossCheckOutcome;
}): RemovalWithheldReason | null {
  if (input.lowYield) return 'low-yield';
  if (input.crossCheck === 'llm-unavailable') return 'degraded-extraction';
  return null;
}

// ── Banner copy (`specs/ai.md` §8.2, `specs/ux-states.md` §5.9/§5.10) ──────

export function reviewBanner(input: {
  mode: BatchMode;
  lowYield: boolean;
  crossCheck: CrossCheckOutcome;
  candidateCount: number;
  imageCount: number;
}): string | null {
  if (input.lowYield && input.mode === 'full-update') {
    return (
      'Not enough titles were read from these screenshots to safely work out ' +
      "what's been removed, so nothing will be removed by this batch. You can " +
      're-extract these images, add more screenshots, or discard this batch.'
    );
  }
  if (input.lowYield) {
    return (
      `Only ${input.candidateCount} ${input.candidateCount === 1 ? 'title was' : 'titles were'} ` +
      `read from ${input.imageCount} ${input.imageCount === 1 ? 'screenshot' : 'screenshots'}. ` +
      'Check the list below before confirming.'
    );
  }
  if (input.crossCheck === 'llm-unavailable') {
    return (
      'Only part of the reading pipeline was available for these screenshots, ' +
      'so this read is incomplete. Check the list below before confirming.'
    );
  }
  return null;
}

// ── Assembly ───────────────────────────────────────────────────────────────

/**
 * Build the whole §6.17 response.
 *
 * The two `omitted` flags are the mode contract, and they are NOT symmetric:
 *
 * | section | `append-only` | `full-update` |
 * |---|---|---|
 * | `alreadyOnYourList` | omitted — absence means nothing here | **present, always** |
 * | `removals` | omitted (REQ-022) | present unless withheld |
 */
export function buildReviewResponse(input: BuildReviewInput): ReviewResponse {
  const visible = input.candidates.filter((c) => c.collapsedIntoCandidateId === null);

  const buckets: Record<ReviewSectionName, ReviewCandidate[]> = {
    additions: [],
    alreadyOnYourList: [],
    probablyNotTitles: [],
    unmatched: [],
    unreadableTiles: [],
  };
  for (const candidate of visible) {
    buckets[sectionForCandidate(candidate)].push(candidate);
  }

  const fullUpdate = input.mode === 'full-update';
  const withheldReason = fullUpdate
    ? removalWithheldReason({ lowYield: input.lowYield, crossCheck: input.crossCheck })
    : null;
  const showRemovals = fullUpdate && withheldReason === null;

  return {
    batchId: input.batchId,
    service: input.service,
    mode: input.mode,
    lowYield: input.lowYield,
    degradedExtraction: input.degradedExtraction,
    crossCheck: input.crossCheck,
    banner: reviewBanner({
      mode: input.mode,
      lowYield: input.lowYield,
      crossCheck: input.crossCheck,
      candidateCount: visible.length,
      imageCount: input.imagesWithNoText.length + countDistinctImages(visible),
    }),
    sections: {
      additions: {
        label: REVIEW_LABELS.additions,
        count: buckets.additions.length,
        items: buckets.additions,
      },
      alreadyOnYourList: {
        label: REVIEW_LABELS.alreadyOnYourList,
        // ⚠ In full-update the TRUE count and ALL items, never a summary.
        count: fullUpdate ? buckets.alreadyOnYourList.length : 0,
        collapsedByDefault: true,
        omitted: !fullUpdate,
        items: fullUpdate ? buckets.alreadyOnYourList : [],
      },
      probablyNotTitles: {
        label: REVIEW_LABELS.probablyNotTitles,
        count: buckets.probablyNotTitles.length,
        collapsedByDefault: true,
        // NEVER omitted in either mode — REQ-012.
        omitted: false,
        items: buckets.probablyNotTitles,
      },
      unmatched: {
        label: REVIEW_LABELS.unmatched,
        count: buckets.unmatched.length,
        items: buckets.unmatched,
      },
      unreadableTiles: {
        label: REVIEW_LABELS.unreadableTiles,
        count: buckets.unreadableTiles.length,
        items: buckets.unreadableTiles,
      },
      removals: {
        label: removalsLabel(input.service),
        count: showRemovals ? input.disappearedListings.length : 0,
        omitted: !fullUpdate,
        withheld: fullUpdate && withheldReason !== null,
        withheldReason,
        items: showRemovals
          ? input.disappearedListings.map((listing) => ({ ...listing, ticked: true }))
          : [],
      },
    },
    imagesWithNoText: [...input.imagesWithNoText],
  };
}

function countDistinctImages(candidates: readonly ReviewCandidate[]): number {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    for (const imageId of candidate.sourceImageIds) ids.add(imageId);
  }
  return ids.size;
}

/**
 * `T-AI-004` — the partition is TOTAL: every candidate the caller passed is
 * reachable in exactly one section, with exactly two documented exceptions.
 *
 * 1. An SD-02 collapse loser (`collapsedIntoCandidateId !== null`) — its
 *    provenance lives in a survivor that IS present, so rendering it again
 *    would double-count one work (`T-AI-007`).
 * 2. An already-present candidate in `append-only` mode — REQ-057 shows only
 *    the new ones there, and absence means nothing in that mode. ⚠ This
 *    exception must NEVER extend to `full-update`; that is the safety
 *    property in this file's header.
 *
 * Exported so the route and the tests can both assert it rather than trusting
 * the routing function to stay total as verdicts are added.
 */
export function assertEveryCandidateRouted(
  candidates: readonly ReviewCandidate[],
  response: ReviewResponse,
): void {
  const rendered = new Set<string>();
  for (const section of [
    response.sections.additions,
    response.sections.alreadyOnYourList,
    response.sections.probablyNotTitles,
    response.sections.unmatched,
    response.sections.unreadableTiles,
  ]) {
    for (const item of section.items) rendered.add(item.candidateId);
  }
  const appendOnly = response.mode === 'append-only';
  const missing = candidates
    .filter((c) => c.collapsedIntoCandidateId === null)
    .filter((c) => !(appendOnly && sectionForCandidate(c) === 'alreadyOnYourList'))
    .filter((c) => !rendered.has(c.candidateId))
    .map((c) => c.candidateId);
  if (missing.length > 0) {
    throw new Error(
      `REQ-012 violated: ${missing.length} candidate(s) reachable in no review section: ${missing.join(', ')}`,
    );
  }
}
