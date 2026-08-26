// Intra-batch overlap collapse — SD-02, `specs/data-model.md` §7.4 (TASK-063).

import type { ExtractionCandidate } from './types.js';

/**
 * The two passes of SD-02. They differ ONLY in the key they collapse on; the
 * ordering, the absorption and the loser bookkeeping are identical, which is
 * why there is one implementation parameterised by the pass rather than two.
 *
 *   pre-match   `normalisedText`        after cleanup, before TMDB
 *   post-match  `resolvedWorkIdentity`  after matching
 */
export type OverlapPass = 'pre-match' | 'post-match';

export interface CollapseOptions {
  pass: OverlapPass;
  /**
   * The batch's images in capture order. Position in this array is the
   * `imageIndex` of the SD-02 ordering key.
   *
   * ⚠ Ordering must not fall back to `sourceImageIds` array order or to
   * insertion order. Both are incidental, and a survivor chosen by an
   * incidental order is a survivor that can change between two runs over the
   * same batch — which `T-AI-007` exists to forbid.
   */
  imageOrder: readonly string[];
}

export interface CollapseResult {
  /**
   * Every input candidate, survivors and losers alike, in the input order.
   *
   * ⚠ Losers are RETAINED, never removed from this array (REQ-012). The review
   * pass shows one item per work, but the storage layer keeps the evidence that
   * two tiles were read as the same work and which one won, so the owner can
   * disagree. Filtering losers out here would make the collapse
   * indistinguishable from a failed extraction.
   */
  candidates: ExtractionCandidate[];
  /** Ids of the candidates that survived and absorbed at least one loser. */
  survivorIds: string[];
  /** Ids of the candidates marked as collapsed by this pass. */
  collapsedIds: string[];
}

interface OrderKey {
  imageIndex: number;
  yTop: number;
  xLeft: number;
  id: string;
}

/**
 * `(imageIndex, yTop, xLeft)` per §7.4, with the candidate id as a final
 * tie-breaker.
 *
 * The id tie-break is not in the spec's tuple because the spec assumes the
 * tuple is unique. It is not guaranteed to be: two candidates read from the
 * same tile by different readers can carry identical geometry. Without a total
 * order `Array.prototype.sort` may return either one, so the "first
 * occurrence" rule would silently stop being deterministic.
 */
function orderKeyFor(
  candidate: ExtractionCandidate,
  imageIndexById: ReadonlyMap<string, number>,
): OrderKey {
  let imageIndex = Number.MAX_SAFE_INTEGER;
  for (const imageId of candidate.sourceImageIds) {
    const index = imageIndexById.get(imageId);
    if (index !== undefined && index < imageIndex) imageIndex = index;
  }

  let yTop = Number.POSITIVE_INFINITY;
  let xLeft = Number.POSITIVE_INFINITY;
  for (const box of candidate.boundingBoxes) {
    if (box.y < yTop) yTop = box.y;
    if (box.x < xLeft) xLeft = box.x;
  }

  return { imageIndex, yTop, xLeft, id: candidate.id };
}

function compareOrderKeys(a: OrderKey, b: OrderKey): number {
  if (a.imageIndex !== b.imageIndex) return a.imageIndex - b.imageIndex;
  if (a.yTop !== b.yTop) return a.yTop - b.yTop;
  if (a.xLeft !== b.xLeft) return a.xLeft - b.xLeft;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The collapse key, or `null` for a candidate this pass must not touch.
 *
 * ⚠ An empty or absent key NEVER collapses. In the pre-match pass a candidate
 * whose `normalisedText` is `''` is an unreadable tile; collapsing every
 * unreadable tile in a batch into one would destroy exactly the evidence the
 * owner needs to notice a bad capture. In the post-match pass a `null`
 * `resolvedWorkIdentity` means matching has not resolved it, and grouping the
 * unresolved together would invent an identity that matching declined to
 * assert.
 */
function collapseKeyFor(candidate: ExtractionCandidate, pass: OverlapPass): string | null {
  if (pass === 'pre-match') {
    return candidate.normalisedText.length > 0 ? candidate.normalisedText : null;
  }
  const identity = candidate.resolvedWorkIdentity;
  return identity !== null && identity.length > 0 ? identity : null;
}

function unionSourceImageIds(survivor: ExtractionCandidate, loser: ExtractionCandidate): string[] {
  const merged = [...survivor.sourceImageIds];
  for (const imageId of loser.sourceImageIds) {
    if (!merged.includes(imageId)) merged.push(imageId);
  }
  return merged;
}

function maxOcrConfidence(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * Collapse candidates that name the same work within one batch (SD-02).
 *
 * Pure: it returns new candidate objects and mutates nothing the caller passed
 * in. Both passes run over the SAME array — pass B is called with the result of
 * pass A — and a candidate already collapsed by an earlier pass is skipped, so
 * a loser is never re-parented and `collapsedIntoCandidateId` always points at
 * a survivor rather than at another loser.
 */
export function collapseOverlap(
  candidates: readonly ExtractionCandidate[],
  options: CollapseOptions,
): CollapseResult {
  const { pass, imageOrder } = options;

  const imageIndexById = new Map<string, number>();
  imageOrder.forEach((imageId, index) => {
    if (!imageIndexById.has(imageId)) imageIndexById.set(imageId, index);
  });

  // Group eligible candidates by key, each group ordered by the §7.4 tuple.
  const groups = new Map<string, ExtractionCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.collapsedIntoCandidateId !== null) continue;
    const key = collapseKeyFor(candidate, pass);
    if (key === null) continue;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [candidate]);
    else group.push(candidate);
  }

  const absorbedBySurvivorId = new Map<string, ExtractionCandidate[]>();
  const survivorIdByLoserId = new Map<string, string>();

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) =>
      compareOrderKeys(orderKeyFor(a, imageIndexById), orderKeyFor(b, imageIndexById)),
    );
    const survivor = ordered[0]!;
    const losers = ordered.slice(1);
    absorbedBySurvivorId.set(survivor.id, losers);
    for (const loser of losers) survivorIdByLoserId.set(loser.id, survivor.id);
  }

  const survivorIds = [...absorbedBySurvivorId.keys()];
  const collapsedIds = [...survivorIdByLoserId.keys()];

  const result = candidates.map((candidate) => {
    const losers = absorbedBySurvivorId.get(candidate.id);
    if (losers !== undefined) {
      let sourceImageIds = candidate.sourceImageIds;
      let boundingBoxes = candidate.boundingBoxes;
      let ocrConfidence = candidate.ocrConfidence;
      for (const loser of losers) {
        sourceImageIds = unionSourceImageIds({ ...candidate, sourceImageIds }, loser);
        boundingBoxes = [...boundingBoxes, ...loser.boundingBoxes];
        ocrConfidence = maxOcrConfidence(ocrConfidence, loser.ocrConfidence);
      }
      return { ...candidate, sourceImageIds, boundingBoxes, ocrConfidence };
    }

    const survivorId = survivorIdByLoserId.get(candidate.id);
    if (survivorId !== undefined) {
      // `cleanupVerdict` is deliberately untouched (§7.4).
      return {
        ...candidate,
        reviewDisposition: 'discarded' as const,
        collapsedIntoCandidateId: survivorId,
      };
    }

    return { ...candidate };
  });

  return { candidates: result, survivorIds, collapsedIds };
}
