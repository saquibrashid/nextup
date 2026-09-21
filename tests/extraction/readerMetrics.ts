/**
 * The §9.7 Stage 3 metric set, computed once and shared by every caller.
 *
 * ⚠ THIS MODULE EXISTS BECAUSE THE THREE STAGE 3 INPUTS WERE UNMEASURED, AND
 * THAT IS THE ONLY THING NOW STANDING BETWEEN A LIVE RUN AND A DECISION.
 * `docs/evaluation/model-bakeoff-2026-09-21.md` records the consequence in
 * full: `chooseReader()` requires `omissionRecovery`, `stabilityJaccard` and
 * `costUsdPerImage` per arm; `golden:live` measured none of them; so the one
 * bake-off this project has run could not be decided by the decision function
 * the protocol names, and was resolved by reading tables instead.
 *
 * ⚠ THE FAILURE MODE THAT FOLLOWS IS THE ONE WORTH NAMING. The report is
 * markdown. Feeding it to `chooseReader` means a human retyping nine floats
 * per arm, and §9.7's own note on this is blunt: *"supplying invented values
 * would yield a fabricated decision carrying a function's authority."* A
 * transcription slip does not look like a bug — it looks like a verdict. So
 * the numbers are computed here, emitted as machine-readable JSON beside the
 * report, and never re-entered by hand.
 *
 * ⚠ ONE IMPLEMENTATION, TWO CALLERS, ON PURPOSE. `goldenLive.spec.ts` (live,
 * manual, billed) and `bakeoffMeasured.spec.ts` (offline, replayed) must
 * compute these identically or the comparison between them is meaningless.
 * This is the same rule `scoreWithStore` already states for scoring: a live
 * suite carrying its own copy of the rules would report divergence between
 * the copies as model drift, which is the single conclusion these suites
 * exist to support. L2, L3 and omission recovery previously lived as private
 * functions inside the two specs; that is exactly the arrangement that lets
 * two definitions drift apart unnoticed.
 */

import type { ExtractionCandidate, ReaderMetrics } from '@nextup/domain';
import { normaliseTitleText } from '@nextup/domain';

import type { RecordingStore } from '../../apps/api/src/extraction/recordings.js';
import { RECALL_VERDICTS, aggregate, type ManifestImage, type Scored } from './goldenScorer.js';

/** The normalised titles a run ACCEPTED, corpus-wide. Sorted set, never ordered output. */
export function acceptedTitles(scored: readonly Scored[]): Set<string> {
  const out = new Set<string>();
  for (const s of scored) {
    for (const c of s.candidates) {
      if (RECALL_VERDICTS.has(c.cleanupVerdict)) out.add(c.normalisedText);
    }
  }
  return out;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  // ⚠ TWO EMPTY SETS ARE IDENTICAL, NOT UNDEFINED. Returning NaN here would
  // make L2 pass by comparison-with-NaN semantics on a run that extracted
  // nothing at all — the zero-yield trap, arriving through the stability gate.
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Every pairwise Jaccard between the runs' accepted-title sets — L2. */
export function pairwiseJaccard(
  runs: readonly (readonly Scored[])[],
): { pair: string; value: number }[] {
  const sets = runs.map((r) => acceptedTitles(r));
  const pairs: { pair: string; value: number }[] = [];
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      pairs.push({
        pair: `${String(i + 1)}×${String(j + 1)}`,
        value: jaccard(sets[i] as Set<string>, sets[j] as Set<string>),
      });
    }
  }
  return pairs;
}

/**
 * The single L2 number a §9.7 decision consumes — the WORST pair, not the mean.
 *
 * ⚠ THE MEAN IS THE WRONG SUMMARY AND WOULD HIDE THE CASE THE BAND EXISTS FOR.
 * Stability is a floor on how far apart two runs can get, so one badly
 * divergent pair is precisely the event L2 is meant to catch; averaging it
 * against two agreeable pairs dilutes it by a factor of three. §9.7 reports
 * measured L2 as a worst pair for the same reason (`gpt-4.1` 0.7692).
 *
 * ⚠ A SINGLE RUN HAS NO PAIRS, AND THAT IS NOT STABILITY 1.0. It is an absent
 * measurement, and returning 1 would report the best possible score from
 * evidence that cannot show it — the fabricated-measurement trap this module's
 * header describes. Callers that cannot supply Stage 2's three runs must say
 * so rather than pass a number through.
 */
export function worstPairJaccard(runs: readonly (readonly Scored[])[]): number {
  const pairs = pairwiseJaccard(runs);
  if (pairs.length === 0) {
    throw new Error(
      'worstPairJaccard needs at least two runs: L2 is a pairwise measure, and a single run ' +
        'cannot produce one. See specs/ai.md §9.7 Stage 2 (three runs per image).',
    );
  }
  return Math.min(...pairs.map((p) => p.value));
}

/** Expected titles found in some runs but not all — L3, by name. */
export function unstableTitles(
  runs: readonly (readonly Scored[])[],
): { title: string; runs: number }[] {
  const expected = new Set<string>();
  for (const s of runs[0] ?? []) {
    for (const c of s.expected.expectedCandidates) expected.add(c.normalisedText);
  }
  const perRun = runs.map((r) => acceptedTitles(r));
  const out: { title: string; runs: number }[] = [];
  for (const title of [...expected].sort()) {
    const hits = perRun.filter((set) => set.has(title)).length;
    if (hits > 0 && hits < runs.length) out.push({ title, runs: hits });
  }
  return out;
}

/**
 * L3 as the rate §9.7 Stage 3 compares — unstable titles over expected titles.
 *
 * ⚠ THE DENOMINATOR IS EXPECTED TITLES, NOT ACCEPTED ONES. Over accepted
 * titles a reader could improve this number by accepting more junk, which is
 * the opposite of the property L3 asserts. Expected titles is a fixed corpus
 * fact, so the rate moves only when the reader's behaviour moves.
 */
export function unstableTitleRate(
  runs: readonly (readonly Scored[])[],
  expectedTitleTotal: number,
): number {
  if (expectedTitleTotal <= 0) {
    throw new Error('unstableTitleRate needs a positive expected-title total');
  }
  return unstableTitles(runs).length / expectedTitleTotal;
}

/**
 * REQ-012's metric, computed per arm: an expected title the LLM leg missed but
 * the OCR leg saw must survive as an orphan.
 *
 * ⚠ THE DENOMINATOR IS ARM-SPECIFIC AND THAT IS CORRECT, NOT A BUG. A better
 * reader misses fewer titles, so it offers the OCR leg fewer chances to rescue
 * one; the metric is "of the rescues that were available to you, how many did
 * you keep", which is the property REQ-012 actually asserts.
 *
 * ⚠ ZERO AVAILABLE RESCUES SCORES 1, NOT 0. §9.7 floors this row at **exactly
 * 1.0, "no trade, no exception"** — so a reader good enough to leave the OCR
 * leg nothing to do must not be failed for it. This is the one place in the
 * module where an empty denominator is a pass, and it is safe only because the
 * numerator and denominator are both counts of *rescues*, not of titles: an
 * arm that missed titles OCR never saw is penalised by recall, where it
 * belongs, not here.
 */
export function omissionRecovery(
  scored: readonly Scored[],
  store: RecordingStore,
  hashFor: (image: ManifestImage) => string,
): number {
  let recoverable = 0;
  let recovered = 0;

  for (const s of scored) {
    const recording = store.get(hashFor(s.image));
    if (recording === undefined) {
      throw new Error(
        `omissionRecovery: no recording for ${s.image.id}. A missing recording silently ` +
          'scores 1.0 (nothing recoverable), which reads as a perfect result on absent evidence.',
      );
    }

    const llmTexts = new Set(
      recording.llm.map((t) => normaliseTitleText(t.identifiedTitle ?? t.visibleText ?? '')),
    );
    const ocrTexts = new Set(recording.ocr.map((l) => normaliseTitleText(l.text)));

    for (const c of s.expected.expectedCandidates) {
      if (llmTexts.has(c.normalisedText) || !ocrTexts.has(c.normalisedText)) continue;
      recoverable += 1;
      if (s.candidates.some((x: ExtractionCandidate) => x.normalisedText === c.normalisedText)) {
        recovered += 1;
      }
    }
  }

  return recoverable === 0 ? 1 : recovered / recoverable;
}

/** Aggregate recall over the artwork-only images — §9.7's L6 row. */
export function artworkOnlyRecall(scored: readonly Scored[]): number {
  const artwork = scored.filter((s) => s.image.expectedArtworkOnly === true);
  const expectedTotal = artwork.reduce((n, s) => n + s.expected.expectedCandidates.length, 0);
  if (expectedTotal === 0) {
    throw new Error('artworkOnlyRecall: the corpus has no artwork-only images to score');
  }
  return artwork.reduce((n, s) => n + s.found, 0) / expectedTotal;
}

export interface ReaderMetricsInput {
  readonly modelId: string;
  /** Stage 2's runs, in order. Two or more, because L2 and L3 are cross-run. */
  readonly runs: readonly (readonly Scored[])[];
  readonly store: RecordingStore;
  readonly hashFor: (image: ManifestImage) => string;
  readonly expectedTitleTotal: number;
  readonly costUsdPerImage: number;
}

/**
 * Assemble the complete §9.7 Stage 3 metric set for one arm.
 *
 * ⚠ THE SINGLE-RUN METRICS ARE TAKEN FROM RUN 1, NOT AVERAGED ACROSS RUNS, AND
 * THE CHOICE IS DELIBERATE. Averaging recall across three runs reports a
 * reader nobody ever ran: it can sit above a floor that no individual run
 * cleared. §9.7's Stage 3 rows are floors on what the owner actually gets from
 * a capture, and the run-to-run variation is not discarded — it is exactly
 * what L2 and L3 measure, and they are computed across all runs here. Reading
 * a point estimate next to its stability bands is the intended shape;
 * collapsing both into one smoothed number is not.
 */
export function readerMetrics(input: ReaderMetricsInput): ReaderMetrics {
  const first = input.runs[0];
  if (first === undefined) {
    throw new Error('readerMetrics needs at least one run');
  }

  const agg = aggregate(first);

  return {
    modelId: input.modelId,
    omissionRecovery: omissionRecovery(first, input.store, input.hashFor),
    fabricationRate: agg.fabricationRate,
    titleRecall: agg.recall,
    artworkOnlyRecall: artworkOnlyRecall(first),
    falseTitleRate: agg.falseTitleRate,
    chromeRejection: agg.chromeRejectionRate,
    stabilityJaccard: worstPairJaccard(input.runs),
    unstableTitleRate: unstableTitleRate(input.runs, input.expectedTitleTotal),
    costUsdPerImage: input.costUsdPerImage,
  };
}
