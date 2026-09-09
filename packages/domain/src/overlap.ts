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
 * How far apart, vertically, two candidates may sit and still be two readings
 * of ONE on-screen caption. A fraction of image height.
 *
 * ⚠ THIS CONSTANT IS THE WHOLE SAFETY PROPERTY OF THE FRAGMENT COLLAPSE, AND
 * IT IS MEASURED, NOT GUESSED. Text containment alone points BOTH WAYS in the
 * real corpus and cannot tell the two directions apart:
 *
 *   "wicked"         ⊂ "wicked for good"                 fragment is the false one
 *   "special edition"⊂ "stranger things vhs special edition"        ditto
 *   "true detective" ⊂ "true detective night country"    CONTAINER is the false one
 *
 * The last pair is a token PREFIX exactly like the first, so shape, length and
 * `ocrSupport` all fail to separate them - `true detective` is `exact`/`text`
 * and so is `wicked`. What separates them is that a fragment is a
 * mis-segmentation of the SAME caption and therefore sits on top of it, while
 * two different tiles are far apart. Measured gaps in the golden corpus:
 *
 *   accepted (real fragments)      0.000, 0.000, 0.000, 0.0047
 *   rejected (different tiles)     0.063, 0.083, 0.096, 0.103, 0.116
 *
 * 0.02 sits four times above the largest accepted gap and three times below
 * the smallest rejected one. ⚠ Do NOT raise it to "catch more fragments": the
 * next thing it catches is `true detective` collapsing into a title the answer
 * key marks false, which trades a false title for a RECALL loss and is
 * strictly worse than doing nothing.
 */
export const FRAGMENT_MAX_VERTICAL_GAP = 0.02;

interface Span {
  readonly top: number;
  readonly bottom: number;
}

function spansOf(candidate: ExtractionCandidate): Span[] {
  return candidate.boundingBoxes.map((box) => ({ top: box.y, bottom: box.y + box.h }));
}

/**
 * The smallest vertical gap between any box of `a` and any box of `b`, or
 * `Infinity` when either has no geometry at all. Overlapping spans give 0.
 *
 * ⚠ Missing geometry yields `Infinity`, so it never collapses. A candidate
 * with no box carries no evidence that it is the same caption as anything, and
 * defaulting it to "close enough" would collapse on text alone - which is the
 * rule this whole function exists to refuse.
 */
function verticalGap(a: ExtractionCandidate, b: ExtractionCandidate): number {
  const as = spansOf(a);
  const bs = spansOf(b);
  if (as.length === 0 || bs.length === 0) return Number.POSITIVE_INFINITY;

  let best = Number.POSITIVE_INFINITY;
  for (const x of as) {
    for (const y of bs) {
      const gap = x.top > y.bottom ? x.top - y.bottom : y.top > x.bottom ? y.top - x.bottom : 0;
      if (gap < best) best = gap;
    }
  }
  return best;
}

/**
 * Whether `host` contains `fragment` at TOKEN boundaries.
 *
 * ⚠ Token-anchored, never a bare substring: `raw` is a substring of `brawl`,
 * and a substring test would collapse WWE `Raw` into an unrelated title and
 * re-open TASK-198's recall loss. The padding spaces are what make ` raw `
 * fail against ` brawl `.
 */
export function containsAtTokenBoundary(host: string, fragment: string): boolean {
  if (host === fragment || fragment.length === 0 || host.length <= fragment.length) return false;
  return ` ${host} `.includes(` ${fragment} `);
}

function sharesAnImage(a: ExtractionCandidate, b: ExtractionCandidate): boolean {
  return a.sourceImageIds.some((id) => b.sourceImageIds.includes(id));
}

/**
 * Collapse OCR fragments into the whole title another candidate already holds
 * on the same image (`TASK-199` finding (a), `specs/ai.md` §7.4a).
 *
 * §7.4's pre-match pass reunites on EXACT text, so a caption that OCR split -
 * `wicked` beside `wicked for good`, `first` beside `ladies first` - never
 * rejoins its host and is counted as a false title. This pass is the missing
 * half, and it runs AFTER the exact pass so a fragment is never parented onto
 * a candidate that is itself about to be collapsed.
 *
 * ⚠ COLLAPSE, NEVER DROP. The loser is retained with `collapsedIntoCandidateId`
 * exactly as §7.4 does; dropping it is the silent omission REQ-012 forbids.
 *
 * ⚠ THREE GUARDS, ALL LOAD-BEARING, NONE OPTIONAL:
 *   1. token boundaries  - see `containsAtTokenBoundary`
 *   2. same image        - two tiles on two screenshots are two works
 *   3. vertical proximity - see `FRAGMENT_MAX_VERTICAL_GAP`, the only guard
 *      that separates a real fragment from a shorter DIFFERENT title
 *
 * ⚠ ONLY `title-candidate` PARTICIPATES, on both sides. `hbo` ⊂ `hbo original`
 * are both chrome; letting verdicts mix would silently reclassify a chrome
 * string as part of a title, or a title as part of chrome.
 */
export function collapseFragments(
  candidates: readonly ExtractionCandidate[],
  options: CollapseOptions,
): CollapseResult {
  const imageIndexById = new Map<string, number>();
  options.imageOrder.forEach((imageId, index) => {
    if (!imageIndexById.has(imageId)) imageIndexById.set(imageId, index);
  });

  const eligible = candidates.filter(
    (c) =>
      c.collapsedIntoCandidateId === null &&
      c.cleanupVerdict === 'title-candidate' &&
      c.normalisedText.length > 0,
  );

  const hostsFor = new Map<string, ExtractionCandidate[]>();
  for (const fragment of eligible) {
    const hosts = eligible.filter(
      (host) =>
        containsAtTokenBoundary(host.normalisedText, fragment.normalisedText) &&
        sharesAnImage(host, fragment) &&
        verticalGap(host, fragment) <= FRAGMENT_MAX_VERTICAL_GAP,
    );
    if (hosts.length > 0) hostsFor.set(fragment.id, hosts);
  }

  const absorbedBySurvivorId = new Map<string, ExtractionCandidate[]>();
  const survivorIdByLoserId = new Map<string, string>();

  for (const fragment of eligible) {
    const hosts = hostsFor.get(fragment.id);
    if (hosts === undefined) continue;
    /*
     * ⚠ ONLY A MAXIMAL HOST MAY ADOPT. `stranger things vhs` is a fragment of
     * `stranger things vhs special edition`, and could equally have been a
     * host for something shorter. Parenting onto a candidate that is itself
     * collapsing would leave `collapsedIntoCandidateId` pointing at a loser,
     * which §7.4 forbids and which no consumer expects.
     */
    const maximal = hosts.filter((host) => !hostsFor.has(host.id));
    if (maximal.length === 0) continue;
    // Deterministic among equals, by §7.4's own ordering key.
    const survivor = [...maximal].sort((a, b) =>
      compareOrderKeys(orderKeyFor(a, imageIndexById), orderKeyFor(b, imageIndexById)),
    )[0]!;
    survivorIdByLoserId.set(fragment.id, survivor.id);
    const absorbed = absorbedBySurvivorId.get(survivor.id);
    if (absorbed === undefined) absorbedBySurvivorId.set(survivor.id, [fragment]);
    else absorbed.push(fragment);
  }

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
      return {
        ...candidate,
        reviewDisposition: 'discarded' as const,
        collapsedIntoCandidateId: survivorId,
      };
    }

    return { ...candidate };
  });

  return {
    candidates: result,
    survivorIds: [...absorbedBySurvivorId.keys()],
    collapsedIds: [...survivorIdByLoserId.keys()],
  };
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
