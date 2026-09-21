/**
 * `T-AI-057` — the §9.7 Stage 3 metric set is COMPUTED, not transcribed.
 *
 * ⚠ WHY THIS SUITE EXISTS, AND IT IS NOT "COVERAGE FOR A NEW MODULE".
 * `readerMetrics.ts` is the only thing standing between a live bake-off run
 * and a §9.7 decision. Before it, `golden:live` measured none of
 * `omissionRecovery`, `stabilityJaccard` or `costUsdPerImage`, so the one
 * bake-off this project has run could not be decided by `chooseReader()` at
 * all — `docs/evaluation/model-bakeoff-2026-09-21.md` records exactly that,
 * and §9.7 names the consequence of papering over it: *"supplying invented
 * values would yield a fabricated decision carrying a function's authority."*
 *
 * ⚠ THE FAILURES THIS GUARDS AGAINST ALL LOOK LIKE SUCCESS. Every one of the
 * degenerate cases below returns a number that reads as a GOOD result:
 * averaging L2 hides the divergent pair, a single run reads as perfect
 * stability, a missing recording reads as perfect omission recovery, and an
 * empty artwork corpus reads as NaN that compares false against every floor
 * without ever saying why. None of them throws on its own. That is the whole
 * reason each is asserted rather than trusted.
 *
 * ⚠ IT RUNS OFFLINE, ON SYNTHETIC SCORED DATA. The live suite it feeds costs
 * real money and is manual (`T-AI-051`), so it cannot be a CI gate; these are
 * the arithmetic properties, which are exactly the part that can be checked
 * for free and that a live run would never surface if wrong.
 */

import { describe, expect, it } from 'vitest';

import type { ExtractionCandidate, ReaderMetrics } from '@nextup/domain';

import type { ManifestImage, Scored } from './goldenScorer.js';
import {
  acceptedTitles,
  artworkOnlyRecall,
  jaccard,
  metricsDocumentJson,
  omissionRecovery,
  parseMetricsDocument,
  unstableTitleRate,
  unstableTitles,
  worstPairJaccard,
} from './readerMetrics.js';

const image = (id: string, artworkOnly = false): ManifestImage =>
  ({
    id,
    file: `${id}.png`,
    expectedArtworkOnly: artworkOnly,
  }) as unknown as ManifestImage;

const candidate = (text: string, verdict = 'title-candidate'): ExtractionCandidate =>
  ({
    normalisedText: text,
    cleanupVerdict: verdict,
  }) as unknown as ExtractionCandidate;

/** One scored image: what was expected of it, and what a run accepted. */
const scored = (
  id: string,
  expectedTitles: readonly string[],
  acceptedList: readonly string[],
  opts: { artworkOnly?: boolean; found?: number } = {},
): Scored =>
  ({
    image: image(id, opts.artworkOnly ?? false),
    expected: {
      expectedCandidates: expectedTitles.map((t) => ({ normalisedText: t })),
      expectedChrome: [],
    },
    candidates: acceptedList.map((t) => candidate(t)),
    recall: 0,
    found: opts.found ?? acceptedList.filter((t) => expectedTitles.includes(t)).length,
    falseTitles: 0,
    fabricated: 0,
    chromeRejected: 0,
  }) as unknown as Scored;

describe('T-AI-057 · the Stage 3 metric set is computed, not transcribed', () => {
  it('T-AI-057a · L2 is the WORST pair, because the mean hides the event the band exists for', () => {
    // Runs 1 and 2 agree perfectly; run 3 diverges hard. A mean over the three
    // pairs would report ~0.67 and clear a 0.5 floor; the worst pair is 0.0
    // and does not. Stability is a floor on how far apart two runs can GET,
    // so diluting one bad pair against two good ones inverts the metric.
    const a = [scored('i1', ['alpha', 'beta'], ['alpha', 'beta'])];
    const b = [scored('i1', ['alpha', 'beta'], ['alpha', 'beta'])];
    const c = [scored('i1', ['alpha', 'beta'], ['gamma'])];

    const pairs = [
      jaccard(acceptedTitles(a), acceptedTitles(b)),
      jaccard(acceptedTitles(a), acceptedTitles(c)),
    ];
    expect(pairs[0]).toBe(1);
    expect(pairs[1]).toBe(0);

    const worst = worstPairJaccard([a, b, c]);
    expect(worst).toBe(0);

    const mean = pairs.reduce((n, v) => n + v, 0) / pairs.length;
    expect(worst).toBeLessThan(mean);
  });

  it('T-AI-057b · a single run THROWS rather than reporting perfect stability', () => {
    // ⚠ THE DEGENERATE CASE THAT READS AS A PASS. One run has no pairs, and
    // the tempting `return 1` reports the best possible score from evidence
    // that cannot produce one — the fabricated-measurement trap. A caller that
    // cannot supply Stage 2's three runs must be stopped, not scored.
    const one = [scored('i1', ['alpha'], ['alpha'])];
    expect(() => worstPairJaccard([one])).toThrow(/at least two runs/);
    expect(() => worstPairJaccard([])).toThrow(/at least two runs/);
  });

  it('T-AI-057c · two empty runs are identical, not NaN — the zero-yield trap', () => {
    // A run that reached no provider accepts nothing. `0/0` is NaN, and NaN
    // fails every comparison, so `NaN >= floor` is false — which happens to
    // LOOK like a correctly-failing band while saying nothing true. Worse, the
    // inverse spelling (`!(x < floor)`) would PASS. Pinned to 1 so the
    // zero-yield case is caught by the recall/yield assertions that exist for
    // it, not silently by stability.
    expect(jaccard(new Set(), new Set())).toBe(1);
    expect(jaccard(new Set(['a']), new Set())).toBe(0);
  });

  it('T-AI-057d · L3 counts titles found in SOME runs but not all, and rates them over EXPECTED', () => {
    const runA = [scored('i1', ['alpha', 'beta', 'gamma'], ['alpha', 'beta'])];
    const runB = [scored('i1', ['alpha', 'beta', 'gamma'], ['alpha'])];
    const runC = [scored('i1', ['alpha', 'beta', 'gamma'], ['alpha'])];

    // `alpha` is in all three → stable. `beta` is in one of three → unstable.
    // `gamma` is in none → a miss, which is RECALL's business, not L3's.
    const unstable = unstableTitles([runA, runB, runC]);
    expect(unstable).toEqual([{ title: 'beta', runs: 1 }]);

    // ⚠ THE DENOMINATOR IS EXPECTED TITLES, NOT ACCEPTED ONES. Over accepted
    // titles a reader could improve this rate by accepting more junk, which
    // inverts the property L3 asserts.
    expect(unstableTitleRate([runA, runB, runC], 3)).toBeCloseTo(1 / 3, 10);
    expect(unstableTitleRate([runA, runB, runC], 30)).toBeCloseTo(1 / 30, 10);
  });

  it('T-AI-057e · a perfectly stable arm rates 0, and a miss in every run does not count as unstable', () => {
    const run = [scored('i1', ['alpha', 'beta'], ['alpha'])];
    // `beta` missed in all three runs: consistently bad, not unstable.
    expect(unstableTitles([run, run, run])).toEqual([]);
    expect(unstableTitleRate([run, run, run], 2)).toBe(0);
  });

  it('T-AI-057f · omission recovery scores the RESCUES AVAILABLE, and an unrescued orphan fails it', () => {
    // `beta` was missed by the LLM leg but seen by OCR — one available rescue.
    const recording = {
      llm: [{ identifiedTitle: 'alpha' }],
      ocr: [{ text: 'alpha' }, { text: 'beta' }],
    };
    const store = { get: () => recording } as never;
    const hashFor = () => 'h';

    const kept = [scored('i1', ['alpha', 'beta'], ['alpha', 'beta'])];
    expect(omissionRecovery(kept, store, hashFor)).toBe(1);

    const dropped = [scored('i1', ['alpha', 'beta'], ['alpha'])];
    expect(omissionRecovery(dropped, store, hashFor)).toBe(0);
  });

  it('T-AI-057g · zero available rescues scores 1, because §9.7 floors this row at exactly 1.0', () => {
    // ⚠ THE ONE PLACE AN EMPTY DENOMINATOR IS A PASS, and it is safe only
    // because both sides count RESCUES, not titles. A reader good enough to
    // leave the OCR leg nothing to do must not be failed for it — §9.7:
    // "Omission recovery = 1.0. No trade, no exception."
    const recording = { llm: [{ identifiedTitle: 'alpha' }], ocr: [{ text: 'alpha' }] };
    const store = { get: () => recording } as never;
    expect(omissionRecovery([scored('i1', ['alpha'], ['alpha'])], store, () => 'h')).toBe(1);
  });

  it('T-AI-057h · a MISSING recording throws instead of scoring a perfect 1.0 on absent evidence', () => {
    // ⚠ THE SILENT-PASS PATH, AND IT IS THE REASON THIS FUNCTION THROWS AT
    // ALL. A wrong model id or an unpaired hash makes the store return
    // `undefined` for every image; with no recording there are no OCR texts,
    // so nothing is "recoverable", so the rate is 1 — a PERFECT score on a
    // measurement that never happened, against the strictest floor in §9.7.
    const store = { get: () => undefined } as never;
    expect(() => omissionRecovery([scored('i1', ['alpha'], ['alpha'])], store, () => 'h')).toThrow(
      /no recording/,
    );
  });

  it('T-AI-057i · artwork-only recall scores ONLY the artwork images, and an empty set throws', () => {
    const corpus = [
      scored('art', ['alpha', 'beta'], ['alpha'], { artworkOnly: true, found: 1 }),
      // A non-artwork image with perfect recall must not lift the artwork row.
      scored('text', ['gamma'], ['gamma'], { found: 1 }),
    ];
    expect(artworkOnlyRecall(corpus)).toBe(0.5);

    // ⚠ WITHOUT THIS, A CORPUS WITH NO ARTWORK IMAGES SCORES `0/0` = NaN, and
    // `NaN >= 0.80` is false — a band that fails for a reason no report states.
    expect(() => artworkOnlyRecall([scored('text', ['gamma'], ['gamma'])])).toThrow(
      /no artwork-only images/,
    );
  });
});

describe('T-AI-057 · claims j/k/l · the metrics companion survives the round trip', () => {
  const metrics: ReaderMetrics = {
    modelId: 'gpt-4.1',
    omissionRecovery: 1,
    fabricationRate: 0.02,
    titleRecall: 0.97,
    artworkOnlyRecall: 0.86,
    falseTitleRate: 0.06,
    chromeRejection: 0.91,
    stabilityJaccard: 0.82,
    unstableTitleRate: 0.03,
    costUsdPerImage: 0.0094,
  };

  it('T-AI-057j · a written document parses back to the SAME numbers a decision is made from', () => {
    // ⚠ THE PROPERTY IS EQUALITY, NOT PARSEABILITY. §9.7's whole reason for a
    // machine-readable companion is that the alternative — a human retyping
    // nine floats out of a markdown table — produces a decision carrying a
    // function's authority from numbers nobody measured. A round trip that
    // parses but rounds would reintroduce exactly that, quietly.
    const parsed = parseMetricsDocument(
      metricsDocumentJson({
        arm: { slug: '', deployment: 'gpt-4.1' },
        generatedAt: '2026-09-21T00:00:00.000Z',
        metrics,
      }),
    );
    expect(parsed.metrics).toEqual(metrics);
    expect(parsed.arm.deployment).toBe('gpt-4.1');
  });

  it('T-AI-057k · a MISSING metric is refused at write time, not at the next bake-off', () => {
    // `chooseReader` does fail closed on this — it returns `invalid-input`.
    // But that verdict arrives at the next comparison, against a file written
    // months earlier by 66 billed vision calls, and the run cannot be repeated
    // for free. Parsing strictly moves the failure to the moment of writing.
    const rest: Record<string, unknown> = { ...metrics };
    delete rest['unstableTitleRate'];
    const json = JSON.stringify({ arm: { slug: '', deployment: 'gpt-4.1' }, metrics: rest });
    expect(() => parseMetricsDocument(json)).toThrow(/unstableTitleRate/);
  });

  it('T-AI-057l · a NaN metric is refused, because NaN passes every band silently', () => {
    // ⚠ THIS IS THE CASE `typeof x === 'number'` WOULD ADMIT. Every comparison
    // against NaN is false, so `x < floor` reports no breach and the arm
    // clears a row it never measured. JSON cannot even hold NaN — it
    // serialises to `null` — so the artefact loses the distinction between
    // "not measured" and "measured as zero" unless it is rejected here.
    const json = JSON.stringify({
      arm: { slug: '', deployment: 'gpt-4.1' },
      metrics: { ...metrics, stabilityJaccard: Number.NaN },
    });
    expect(() => parseMetricsDocument(json)).toThrow(/stabilityJaccard/);
  });
});
