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
  DiscoverySource,
  MediaType,
  OcrSupport,
  ReviewDisposition,
  Service,
} from './enums.js';
import { CANDIDATE_CLASSIFICATIONS } from './enums.js';
import { mediaTypeForWorkIdentity } from './identity.js';
import type { IsoDate } from './types.js';
import { DEGRADED_EXTRACTION_BANNER, TMDB_UNAVAILABLE_BANNER, SERVICE_LABELS } from './copy.js';

/**
 * What the review RESPONSE may say about a candidate — a superset of the
 * stored `CANDIDATE_CLASSIFICATIONS`.
 *
 * ⚠ **This is derived at read time and never written to a column,** which is
 * exactly why it is separate. `ck_cand_classification` constrains the stored
 * column, a CHECK can only be widened by dropping it, and `T-MIG-001` forbids
 * `DROP CONSTRAINT`. Adding a read-time value to the stored vocabulary would
 * have obliged a migration for a value that column can never hold; the enum
 * parity gate catches that, and this split is the answer to it.
 *
 * `already-in-your-list` deliberately does NOT reuse
 * `already-present-for-this-service`: that value names a service the owner can
 * act on, and a discovery batch has no service (ADR-0010 D-1), so the same
 * word would answer a question nobody asked. The review pass must SAY the work
 * is already held (US-040 AC-5) and cannot say it in service-scoped terms.
 */
export const REVIEW_CLASSIFICATIONS = [
  ...CANDIDATE_CLASSIFICATIONS,
  'already-in-your-list',
] as const;
export type ReviewClassification = (typeof REVIEW_CLASSIFICATIONS)[number];

/**
 * ⚠ `ZERO_YIELD_IMAGE_RATIO` USED TO BE DECLARED HERE AND WAS NEVER READ.
 * It is now defined once, next to the only thing that applies it, in
 * `extraction/lowYield.ts`. A threshold living beside the code that *consumes*
 * the flag rather than the code that *raises* it is how this project ended up
 * with a fully tested withholding path and nothing anywhere setting
 * `lowYield`.
 */

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

/** The stored candidate columns `chosenReviewMatch` reads. */
export interface ChosenMatchInput {
  reviewDisposition: string;
  resolvedWorkIdentity: string | null;
  correctedToTmdbId: number | null;
  correctedDisplayName: string | null;
  correctedDisplayYear: number | null;
  correctedDisplayPoster: string | null;
  alternatives: readonly ReviewMatchRef[];
}

/**
 * REQ-109 — the match a review card should SHOW: the owner's correction when
 * there is one, otherwise the extraction's best guess.
 *
 * ⚠ **WITHOUT THE CORRECTED BRANCH THIS RETURNS THE IDENTITY THE OWNER JUST
 * REJECTED.** `applyCorrection` deliberately does not rewrite
 * `matchCandidates` — the extraction's guesses and the owner's decision are
 * two different facts (`services/batchClose.ts`) — so after a correction
 * `resolvedWorkIdentity` starts with `tmdb:`, the fallback guard passes, and
 * `alternatives[0]` is served: the original wrong match. That was the defect.
 *
 * ⚠ **`alternatives` is NOT filtered or reordered here.** US-007 AC-4 shows
 * what the extraction guessed, and it still guessed exactly that; only the
 * CHOSEN match reflects the owner's decision.
 *
 * ⚠ **`score: 1`, `uncertain: false`, `ambiguous: false` are not computed.**
 * The owner picked this identity by hand, so there is nothing uncertain about
 * it — and deriving those flags from the alternatives' scores would describe a
 * DIFFERENT candidate, chipping the owner's own choice as a doubtful match.
 *
 * ⚠ A corrected candidate with no stored display name falls through to the
 * previous behaviour rather than inventing one. Corrections stored before
 * those columns existed have no name, and `null` there is honest.
 */
export function chosenReviewMatch(input: ChosenMatchInput): ReviewMatch | null {
  const corrected = correctedReviewMatch(input);
  if (corrected !== null) return corrected;

  const top = input.alternatives[0];
  if (top === undefined || input.resolvedWorkIdentity?.startsWith('tmdb:') !== true) return null;

  const second = input.alternatives[1];
  return {
    ...top,
    uncertain: top.score < 1,
    ambiguous: second !== undefined && top.score - second.score < 0.05,
  };
}

function correctedReviewMatch(input: ChosenMatchInput): ReviewMatch | null {
  // A later discard/confirmation changes the decision, not the chosen identity.
  if (input.correctedToTmdbId === null || input.correctedDisplayName === null) return null;

  const mediaType = mediaTypeForWorkIdentity(input.resolvedWorkIdentity);
  if (mediaType === null) return null;

  return {
    tmdbId: input.correctedToTmdbId,
    mediaType,
    name: input.correctedDisplayName,
    releaseYear: input.correctedDisplayYear,
    posterPath: input.correctedDisplayPoster,
    score: 1,
    uncertain: false,
    ambiguous: false,
  };
}

/** The candidate shape this module routes. Mirrors `specs/api.md` §6.17. */
/**
 * The region of one source image to render as a candidate's tile thumbnail
 * (`specs/ui.md` §5.3a). Normalised `0..1`, origin top-left, so it is
 * independent of the stored image's pixel dimensions.
 *
 * ⚠ `imageId` is carried rather than assumed to be `sourceImageIds[0]`. A
 * candidate can be evidenced by boxes on more than one image (SD-02 collapse
 * merges them), and cropping image A's rectangle out of image B renders a
 * confidently-wrong region of the wrong screenshot — which is worse than
 * showing the whole image, because it still looks like evidence.
 */
export interface ReviewTileCrop {
  imageId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  /**
   * §5.3a — the region of a source image to render as the tile thumbnail, or
   * `null` when no honest crop exists and the whole image must be shown.
   *
   * ⚠ Computed SERVER-SIDE by `tileCropFor`, never derived in the client. The
   * rule it encodes ("only a tile box, never a text-line box") is a statement
   * about what the extractor produced, and the client cannot see `boxSource`.
   */
  tileCrop: ReviewTileCrop | null;
  disposition: ReviewDisposition;
  /** SD-02. Non-null ⇒ absorbed by the survivor; not rendered again. */
  collapsedIntoCandidateId: string | null;
  /** `null` for an unmatched candidate (`T-CLS-013`). */
  classification: ReviewClassification | null;
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

/**
 * An image the extractor read and found nothing in (`specs/ai.md` §8.2,
 * US-006 AC-3, `T-AI-020`).
 *
 * ⚠ **NAMED *AND* THUMBNAILED — both, and `href` is why.** A file name alone
 * does not identify one screenshot among twenty near-identical ones in a
 * camera roll, which is the whole action this surfacing exists to enable:
 * retake *that* screenshot. §8.2 says "the image thumbnail is shown. Never a
 * silent skip."
 *
 * ⚠ `href` is an **API path** (`/api/images/:id`), never a blob URL (NFR-020).
 * The container is private, so a storage URL would either 403 or leak a SAS.
 */
export interface ReviewImageWithNoText {
  imageId: string;
  fileName: string;
  href: string;
}

export interface BuildReviewInput {
  batchId: string;
  /**
   * `null` for a DISCOVERY capture (TASK-186, ADR-0010 D-1).
   *
   * ⚠ Not a missing value — a discovery source is not a service, has no badge
   * and owns no `ServiceListing` (ADR-0010 Trap 3). Defaulting it to a service
   * to keep the type narrow would tell the owner a rental storefront had
   * updated their Netflix list.
   */
  service: Service | null;
  /** Which storefront this capture came from, or `null` for a service batch. */
  discoverySource?: DiscoverySource | null;
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
  /**
   * Listing ids the owner has explicitly UNTICKED in this batch (TASK-085,
   * REQ-021).
   *
   * ⚠ It is a set of exceptions, never a set of ticks: REQ-055 says every
   * proposal arrives ticked, so the default has to be expressible without any
   * stored row. An omitted or empty set therefore means "everything is
   * ticked", which is exactly what a batch nobody has touched should mean.
   */
  untickedListingIds?: ReadonlySet<string>;
  imagesWithNoText: readonly ReviewImageWithNoText[];
  /**
   * Did stage 3 fail to reach TMDB for this batch (`specs/ai.md` §4.3,
   * US-007 AC-6)?
   *
   * ⚠ **WITHOUT THIS, A TMDB OUTAGE IS INDISTINGUISHABLE FROM A BATCH OF
   * GENUINELY UNIDENTIFIABLE TITLES.** Both render the same way: every
   * candidate lands in "Couldn't identify these" with an `unmatched:<hash>`
   * identity. The difference matters because the remedies are opposite — an
   * outage clears by itself and the batch is worth discarding and retrying
   * later, whereas unidentifiable titles will still be unidentifiable
   * tomorrow and are worth confirming now.
   *
   * Optional so that a caller which cannot know (an older payload, a batch
   * extracted before stage 3 existed) is treated as "no outage reported"
   * rather than forced to assert one either way.
   */
  tmdbUnavailable?: boolean;
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
  candidateSummary?: { total: number; alreadyKnown: number };
  batchId: string;
  /** `null` for a discovery capture — see `BuildReviewInput.service`. */
  service: Service | null;
  discoverySource: DiscoverySource | null;
  mode: BatchMode;
  lowYield: boolean;
  degradedExtraction: boolean;
  crossCheck: CrossCheckOutcome;
  banner: string | null;
  /** See `BuildReviewInput.tmdbUnavailable`. Always present on the response. */
  tmdbUnavailable: boolean;
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
export function removalsLabel(service: Service | null): string {
  // ⚠ A discovery capture has NO service and never reconciles (ADR-0010 D-1
  // and D-2, US-040 AC-4), so its removal section is always `omitted: true`
  // and this string is never rendered. It still has to BE a string; naming the
  // reason beats an empty label that would read as a missing translation if a
  // future change ever did render it.
  if (service === null) return 'Removals do not apply to a discovery capture';
  return `No longer on ${SERVICE_LABELS[service]}`;
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
  // ⚠ BOTH "already" classifications route here. `already-in-your-list` is
  // the discovery form of the same fact (US-040 AC-5) — the work is already
  // held, so it is not an addition. Omitting it would put a work the owner
  // already has into the additions section, where confirming it would be an
  // instruction to add what is already there.
  return candidate.classification === 'already-present-for-this-service' ||
    candidate.classification === 'already-in-your-list'
    ? 'alreadyOnYourList'
    : 'additions';
}

// ── The §5.3a tile crop ────────────────────────────────────────────────────

/**
 * How much of the surrounding image to keep around the tile, as a fraction of
 * the tile's own size on each axis.
 *
 * A pixel-exact crop of the model's box clips the artwork it is supposed to
 * make legible — reported boxes sit tight against the tile edge and are
 * routinely a few percent off. The padding is proportional rather than
 * absolute so it behaves the same on a phone screenshot and a desktop one.
 */
export const TILE_CROP_PADDING = 0.08;

/**
 * The region to crop for a candidate's tile thumbnail, or `null` to show the
 * whole image.
 *
 * ⚠ **A crop is only offered for a TILE box (`boxSource === 'llm'`), never an
 * OCR box.** §5.3a requires a thumbnail "at a size where the ARTWORK is
 * legible". An OCR box is a text-LINE rectangle — a strip a few percent tall
 * containing the caption — so cropping to it fills the thumbnail with the
 * words the owner is already being shown as `rawText`, and shows none of the
 * artwork that is the entire reason the thumbnail is mandatory. That failure
 * is invisible in a test that only asserts "a crop was produced".
 *
 * ⚠ **NO VERDICT GATE — and one must not be re-added (`T-UX-154`).** This
 * function used to refuse every verdict outside `inferred-unverified` and
 * `unreadable-tile`, the two §5.3a singles out. That reads §5.3a's table as a
 * *ceiling*; it is a **floor**. §5.3a says those two verdicts MUST carry a
 * thumbnail. It nowhere says they are the only ones that MAY.
 *
 * The gate became a live defect the moment `T-UX-151b` widened the client:
 * `CandidateCard` now renders the source tile for **any** card with no TMDB
 * poster, because a card the owner is asked to decide must show what it is
 * asking about. Those cards reached the crop branch, got `null` here, and fell
 * through to the uncropped `<img>` — so the owner was shown the **entire
 * pasted screenshot** beside the question "is this the right match?". Reported
 * from a phone: *"it's asking me to confirm the match but the image shown is
 * the entire screenshot that I pasted — that's not useful… if there are other
 * titles that overlap or are too similar, I won't know which tile I'm actually
 * addressing."* That is the failure whole: with ~20 tiles on one screenshot,
 * an uncropped thumbnail identifies the *batch*, not the *row*, and the owner
 * is answering a question about a tile they cannot locate.
 *
 * ⚠ Widening this is safe **because the crop is inert unless rendered.**
 * `CandidateCard` reads `tileCrop` only inside `needsThumbnail &&
 * thumbnailUrl !== null`; a matched card with a poster takes the poster branch
 * and never looks at it. So the verdicts newly granted a crop here are exactly
 * the ones already showing a thumbnail — the change cannot introduce a
 * thumbnail where there was none, only replace a whole screenshot with the
 * tile it was supposed to be.
 *
 * ⚠ Returns `null` rather than a whole-image `{0,0,1,1}` box for the no-crop
 * case, so the client renders its existing uncropped `<img>` path instead of a
 * crop that happens to be the identity. A degenerate rectangle is refused for
 * the same reason: a zero-width box scaled to fill a thumbnail is an infinite
 * magnification of one column of pixels.
 *
 * ⚠ `verdict` is deliberately **not** a parameter. Keeping it "in case the
 * rule comes back" would leave the defect one uncommented line away, and a
 * caller passing it would imply it is consulted. The two mandatory-thumbnail
 * verdicts are enforced where they belong — in `CandidateCard`'s
 * `needsThumbnail`, which is the thing §5.3a actually constrains.
 */
export function tileCropFor(input: {
  boxSource: string;
  boundingBoxes: readonly { imageId: string; x: number; y: number; w: number; h: number }[];
}): ReviewTileCrop | null {
  if (input.boxSource !== 'llm') return null;

  const first = input.boundingBoxes[0];
  if (first === undefined) return null;

  // Only the boxes on the SAME image as the first are unioned — see the
  // `imageId` note on `ReviewTileCrop`.
  const onImage = input.boundingBoxes.filter((box) => box.imageId === first.imageId);

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const box of onImage) {
    if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) return null;
    if (!Number.isFinite(box.w) || !Number.isFinite(box.h)) return null;
    if (box.x < left) left = box.x;
    if (box.y < top) top = box.y;
    if (box.x + box.w > right) right = box.x + box.w;
    if (box.y + box.h > bottom) bottom = box.y + box.h;
  }

  const padX = (right - left) * TILE_CROP_PADDING;
  const padY = (bottom - top) * TILE_CROP_PADDING;
  const x = clampUnit(left - padX);
  const y = clampUnit(top - padY);
  const w = clampUnit(right + padX) - x;
  const h = clampUnit(bottom + padY) - y;
  if (w <= 0 || h <= 0) return null;

  return { imageId: first.imageId, x, y, w, h };
}

function clampUnit(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
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
  tmdbUnavailable?: boolean;
}): string | null {
  // ⚠ **THE TWO BANNERS COMPOSE; THEY DO NOT COMPETE.** A batch can be both
  // under-read AND unmatched, and each sentence answers a different question
  // ("will anything be removed?" versus "why is nothing identified?").
  // Picking one and dropping the other would silently withhold an answer the
  // owner needs at exactly the moment they are deciding whether to confirm —
  // which is the same defect §5.10 fixed by making one event raise one banner
  // on both screens. `T-AI-017j`, `T-AI-017k`.
  //
  // The read-safety sentence comes FIRST: it is the one that governs whether
  // anything is about to be deleted.
  const readBanner = readSafetyBanner(input);
  const tmdbBanner = input.tmdbUnavailable === true ? TMDB_UNAVAILABLE_BANNER : null;
  if (readBanner !== null && tmdbBanner !== null) return `${readBanner} ${tmdbBanner}`;
  return readBanner ?? tmdbBanner;
}

function readSafetyBanner(input: {
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
  // ⚠ The SHARED constant, not a review-specific paraphrase. `ux-states.md`
  // §5.9 requires the same banner here and on `/batches/:batchId`; this used
  // to be a second, differently-worded string, which meant the owner read one
  // explanation on the status page and another on review for one event.
  //
  // ⚠ **BOTH OUTCOMES RAISE IT, NOT JUST THE SEVERE ONE.** §5.10 (the
  // cross-check reader down, `ocr-unavailable`) is explicitly "same banner
  // wording, milder consequence": removals are still permitted, but the read
  // went one-legged and the owner is entitled to know before they confirm.
  // `ocr-unavailable` returned `null` here while `isDegraded()` on the status
  // page accepted it, so ONE event produced a banner on one screen and silence
  // on the other — the exact drift the shared constant above exists to stop,
  // and the half `T-UX-008h`'s title ("identical to the review page banner")
  // asserted about itself without ever rendering the review page.
  if (input.crossCheck === 'llm-unavailable' || input.crossCheck === 'ocr-unavailable') {
    return DEGRADED_EXTRACTION_BANNER;
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
  const discovery = input.service === null;
  // ⚠ US-041 AC-1 — a discovery pass shows EVERY extracted title, including
  // the ones already on the combined list. In append-only for a SERVICE the
  // "already on your list" section is omitted because the answer is "nothing
  // to do, it is already there"; for a discovery capture that same answer is
  // the useful reporting US-040 AC-5 asks for ("you already have this"), and
  // omitting it would hide a title the owner definitely captured.
  const showAlready = fullUpdate || discovery;
  const withheldReason = fullUpdate
    ? removalWithheldReason({ lowYield: input.lowYield, crossCheck: input.crossCheck })
    : null;
  const showRemovals = fullUpdate && withheldReason === null;

  return {
    batchId: input.batchId,
    candidateSummary: { total: visible.length, alreadyKnown: buckets.alreadyOnYourList.length },
    service: input.service,
    discoverySource: input.discoverySource ?? null,
    mode: input.mode,
    lowYield: input.lowYield,
    degradedExtraction: input.degradedExtraction,
    crossCheck: input.crossCheck,
    tmdbUnavailable: input.tmdbUnavailable ?? false,
    banner: reviewBanner({
      mode: input.mode,
      lowYield: input.lowYield,
      crossCheck: input.crossCheck,
      candidateCount: visible.length,
      imageCount: input.imagesWithNoText.length + countDistinctImages(visible),
      tmdbUnavailable: input.tmdbUnavailable ?? false,
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
        count: showAlready ? buckets.alreadyOnYourList.length : 0,
        collapsedByDefault: true,
        omitted: !showAlready,
        items: showAlready ? buckets.alreadyOnYourList : [],
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
          ? input.disappearedListings.map((listing) => ({
              ...listing,
              // REQ-055 — ticked unless the owner said otherwise. The default
              // lives HERE, in the one place that builds the item, so a
              // missing decisions read degrades to "everything ticked", which
              // is the state the owner already saw, rather than to a silently
              // empty removal group.
              ticked: input.untickedListingIds?.has(listing.listingId) !== true,
            }))
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
