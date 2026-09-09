/**
 * §9.7 Stage 1–4 — the MEASURED bake-off (`T-AI-045a`/`b`/`c`, TASK-168).
 *
 * The pre-committed decision rule shipped first, on purpose, in
 * `packages/domain/src/extraction/chooseReader.ts` and
 * `packages/domain/test/bakeoff.spec.ts`: *"Deciding the rule after seeing the
 * results is not evaluation; it is choosing the threshold that selects the
 * answer you already preferred, and the cheaper model will always be the one
 * that benefits."* This file supplies the numbers to that rule and asserts
 * what it returns. **It does not contain a threshold.** Every constant it
 * compares against is imported from the rule it is feeding.
 *
 * ⚠ THE TWO ARMS DIFFER ONLY BY `llm/<modelId>/`, AND THAT IS ENFORCED BY
 * CONSTRUCTION, NOT BY CARE. Both are scored by the same `goldenScorer.ts`
 * against the same `expected/`, replaying the same `ocr/` — which is not
 * model-scoped precisely so it stays the constant the comparison is measured
 * against. The recordings were taken back-to-back against the same live
 * account, with `max_completion_tokens` sent to BOTH arms (§9.7 Stage 0 found
 * that `gpt-5-4-mini` rejects `max_tokens`; answering that by giving the arms
 * different parameters would have introduced the second difference Stage 1
 * forbids).
 *
 * ⚠ `stabilityJaccard` IS NOT MEASURED HERE, AND THE SUITE PROVES IT IS NOT
 * DECIDING ANYTHING. Stage 2's three-runs-per-image protocol is TASK-079b's
 * manual live suite; a single recorded run per arm cannot produce a Jaccard.
 * Rather than invent one, `T-AI-045c` runs the decision TWICE over the two
 * extreme assumptions and asserts the outcome is identical — so the missing
 * input is demonstrably not load-bearing for this result, instead of being
 * assumed harmless.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BAKEOFF_CORPUS_IMAGES,
  MIN_MEANINGFUL_TITLE_DELTA,
  chooseReader,
  normaliseTitleText,
  type ReaderMetrics,
} from '@nextup/domain';

import { goldenRecordingStore, sha256OfBytes } from '../../apps/api/src/extraction/recordings.js';

import { GOLDEN, IMAGES, aggregate, manifest, scoreAll, type Scored } from './goldenScorer.js';

const INCUMBENT = 'gpt-4.1';
const CHALLENGER = 'gpt-5-4-mini';

/**
 * Stage 0, discharged live on 2026-09-08 against the real
 * `oai-nextup-hriut4gw7lgg4` account and recorded in `specs/ai.md` §9.7.
 * Restated here as data because `chooseReader` refuses to measure a candidate
 * that has not passed it.
 */
const CHALLENGER_CAPABILITIES = {
  vision: true,
  strictStructuredOutputs: true,
  temperatureZero: true,
  seed: true,
  availableInRegion: true,
} as const;

function artworkRecall(scored: readonly Scored[]): number {
  const artwork = scored.filter((s) => s.image.expectedArtworkOnly === true);
  const expectedTotal = artwork.reduce((n, s) => n + s.expected.expectedCandidates.length, 0);
  return artwork.reduce((n, s) => n + s.found, 0) / expectedTotal;
}

/**
 * REQ-012's metric, computed per arm: an expected title the LLM leg missed but
 * the OCR leg saw must survive as an orphan.
 *
 * ⚠ THE DENOMINATOR IS ARM-SPECIFIC AND THAT IS CORRECT, NOT A BUG. A better
 * reader misses fewer titles, so it offers the OCR leg fewer chances to rescue
 * one; the metric is "of the rescues that were available to you, how many did
 * you keep", which is the property REQ-012 actually asserts.
 */
function omissionRecovery(modelId: string, scored: readonly Scored[]): number {
  const store = goldenRecordingStore(GOLDEN, modelId);
  let recoverable = 0;
  let recovered = 0;

  for (const s of scored) {
    const bytes = readFileSync(path.join(IMAGES, s.image.file));
    const recording = store.get(sha256OfBytes(bytes));
    expect(recording, `${s.image.id} has no ${modelId} recording`).toBeDefined();

    const llmTexts = new Set(
      recording!.llm.map((t) => normaliseTitleText(t.identifiedTitle ?? t.visibleText ?? '')),
    );
    const ocrTexts = new Set(recording!.ocr.map((l) => normaliseTitleText(l.text)));

    for (const c of s.expected.expectedCandidates) {
      if (llmTexts.has(c.normalisedText) || !ocrTexts.has(c.normalisedText)) continue;
      recoverable += 1;
      if (s.candidates.some((x) => x.normalisedText === c.normalisedText)) recovered += 1;
    }
  }

  return recoverable === 0 ? 1 : recovered / recoverable;
}

function metricsFor(modelId: string, scored: readonly Scored[], stability: number): ReaderMetrics {
  const agg = aggregate(scored);
  return {
    modelId,
    omissionRecovery: omissionRecovery(modelId, scored),
    fabricationRate: agg.fabricationRate,
    titleRecall: agg.recall,
    artworkOnlyRecall: artworkRecall(scored),
    falseTitleRate: agg.falseTitleRate,
    chromeRejection: agg.chromeRejectionRate,
    stabilityJaccard: stability,
    // ⚠ RECORDED, NEVER DECISIVE (§9.7, NFR-012a). Both arms are set to the
    // same value on purpose: a cost difference must not be able to move this
    // decision even by accident, and `chooseReader` already refuses to let it.
    costUsdPerImage: 0,
  };
}

const incScored = await scoreAll(INCUMBENT);
const chalScored = await scoreAll(CHALLENGER);
const expectedTitleTotal = incScored.reduce((n, s) => n + s.expected.expectedCandidates.length, 0);

function decide(stability: number) {
  return chooseReader({
    incumbent: metricsFor(INCUMBENT, incScored, stability),
    challenger: metricsFor(CHALLENGER, chalScored, stability),
    challengerCapabilities: CHALLENGER_CAPABILITIES,
    expectedTitleTotal,
    corpusImages: manifest.images.length,
  });
}

describe('T-AI-045 the bake-off is measured, and the pre-committed rule decides it', () => {
  it('T-AI-045a · both arms really ran, over the same corpus, from different recordings', () => {
    // ⚠ FIRST, BECAUSE A ONE-ARMED BAKE-OFF SCORES AS A TIE. If the challenger
    // directory were missing, `readJson` degrades every recording to `[]` and
    // the challenger posts recall 0 with fabrication 0 — which the rule would
    // correctly read as "worse", producing the RIGHT answer for entirely the
    // wrong reason and hiding the fact that nothing was compared.
    expect(manifest.images.length).toBe(BAKEOFF_CORPUS_IMAGES);
    expect(incScored).toHaveLength(BAKEOFF_CORPUS_IMAGES);
    expect(chalScored).toHaveLength(BAKEOFF_CORPUS_IMAGES);
    expect(aggregate(incScored).candidateCount).toBeGreaterThan(50);
    expect(aggregate(chalScored).candidateCount).toBeGreaterThan(50);

    // The two arms are genuinely different reads, not one directory replayed
    // twice — the failure a copy-paste of the recorder would produce.
    expect(aggregate(chalScored).candidateCount).not.toBe(aggregate(incScored).candidateCount);
    expect(expectedTitleTotal).toBe(67);
  });

  it('T-AI-045b · the measured metrics are pinned', () => {
    // Pinned for the same reason as T1's baseline: the recordings are fixed
    // bytes, so any movement here is a change in the scorer or the fixtures
    // and must be explained rather than absorbed.
    const inc = aggregate(incScored);
    const chal = aggregate(chalScored);

    expect(inc.recall).toBe(0.9402985074626866);
    // ⚠ 0.2500 → 0.3143 AT TASK-195, AND THE DEFECT GOT SMALLER, NOT BIGGER.
    // The false-title COUNT fell 26 → 22; the denominator is `title-candidate`
    // count, and 34 chrome strings stopped being counted as title candidates.
    // Both arms are scored by the same code over the same answer key, so the
    // comparison below is unaffected — which is the property §9.7 Stage 1
    // exists to protect.
    //
    // ⚠ THEN 0.3143 → 0.2857 AT TASK-198, THE ORDINARY WAY: two fewer false
    // titles (the `wwe raw` expansions), same denominator. Recall rose in the
    // same commit, which is the pairing §3.1a R2 was designed to produce —
    // the embellishment cost a recall point AND a false title, so removing it
    // repays both.
    //
    // ⚠ THEN 0.2857 → 0.2424 AT TASK-199, when the owner ruled that `HBO`,
    // `HBO ORIGINAL` and `New` are chrome. The badge vocabulary is a stage-2
    // rule and applies to BOTH arms, so the challenger moved too — 0.4405 →
    // 0.4198 — and the comparison stays like-for-like. The incumbent's lead
    // widened from 15.5 points to 17.7.
    //
    // ⚠ THE CHALLENGER'S MOVE WAS BRIEFLY RECORDED HERE AS "DID NOT MOVE AT
    // ALL", WHICH WAS FALSE AND IS NOTED SO THE MISTAKE IS NOT REPEATED: a
    // run of this file reported ONE failure, and it was read as "only the
    // incumbent drifted". `expect` throws, so the first failing assertion in
    // a test masks every later one in the same test. Re-run after fixing each
    // pin; never infer from a single failure that the others held.
    //
    // ⚠ THEN 0.2424 → 0.1935 AT TASK-203, the fragment collapse (§7.4a). Like
    // the badge vocabulary this is a pipeline rule, not an answer-key change,
    // so it applies to BOTH arms and the comparison stays like-for-like.
    // ⚠ THEN 0.1935 → 0.1525 AT TASK-204, the off-list region (§3.2 step 3b).
    // Again a pipeline rule, not an answer-key change, so both arms see it.
    expect(inc.falseTitleRate).toBe(0.15254237288135594);
    // ⚠ The fabrication rate moved with it — 0.011494 → 0.011765 — and it went
    // UP while the pipeline got BETTER. Same single fabrication, divided by a
    // denominator two candidates smaller because the two fragments collapsed.
    // A denominator artefact, exactly like TASK-195's; do not read it as a
    // regression.
    expect(inc.fabricationRate).toBe(0.011764705882352941);

    expect(chal.recall).toBe(0.9402985074626866);
    // ⚠ THE CHALLENGER MOVED FURTHER THAN THE INCUMBENT AT TASK-203 — 0.4198 →
    // 0.3472 — and that is expected, not suspicious: it emits MORE readings of
    // each caption, so it had more fragments to lose. Its lead-gap narrowed
    // and the incumbent still wins by 15.4 points.
    expect(chal.falseTitleRate).toBe(0.3472222222222222);
    // Same denominator artefact as the incumbent's: 0.035 → 0.036649.
    expect(chal.fabricationRate).toBe(0.03664921465968586);

    // ⚠ THE SHAPE OF THE RESULT, STATED AS AN ASSERTION SO IT CANNOT BE
    // MISREAD FROM THE NUMBERS ALONE: the challenger reads MORE, and much of
    // what it reads more of is wrong. ~~Its recall advantage is **one title**
    // across the whole corpus — below `MIN_MEANINGFUL_TITLE_DELTA`, i.e.
    // inside the noise band the rule was written to discount~~ — while its
    // false-title rate is nearly ten points worse and it fabricates three
    // times as often. The clearest single instance: on `blank-no-content-01`,
    // a page with no works on it at all, the challenger returned TWO tiles
    // where the incumbent returned none.
    //
    // ⚠ AT TASK-198 THE RECALL ADVANTAGE BECAME **ZERO**, AND THE DIRECTION IS
    // NOT AN ACCIDENT. The challenger's one-title lead was the incumbent's
    // `wwe raw` expansion; §3.1a R2 is a STAGE-2 rule and applies to both arms
    // equally, so it repaired the incumbent's only miss the challenger did not
    // share. Both arms now sit at 63 of 67. The decision is unchanged and
    // strictly stronger: the challenger no longer reads a single title more
    // than the incumbent, and still costs 17 points of false-title rate.
    // ~~expect(chal.recall).toBeGreaterThan(inc.recall)~~ is therefore dead —
    // asserting it would now be asserting a defect.
    expect(chal.recall).toBe(inc.recall);
    expect((chal.recall - inc.recall) * expectedTitleTotal).toBeLessThan(
      MIN_MEANINGFUL_TITLE_DELTA,
    );
    expect(chal.falseTitleRate).toBeGreaterThan(inc.falseTitleRate);
    expect(chal.fabricationRate).toBeGreaterThan(inc.fabricationRate);
  });

  it('T-AI-045c · the pre-committed rule keeps the incumbent, and stability is not what decided it', () => {
    // ⚠ THE UNMEASURED INPUT IS PROVEN INERT RATHER THAN ASSUMED INERT.
    // `stabilityJaccard` needs Stage 2's three runs per image (TASK-079b,
    // manual and live), which a single recorded run per arm cannot produce.
    // So the decision is taken twice, at both extremes of what that input
    // could be, and the outcome must be identical.
    const perfect = decide(1);
    const atFloor = decide(0.95);

    expect(perfect.outcome).toBe('incumbent-stays');
    expect(atFloor.outcome).toBe('incumbent-stays');
    expect(perfect.primaryReader).toBe(INCUMBENT);
    expect(atFloor.primaryReader).toBe(INCUMBENT);
    expect(perfect.rows.map((r) => r.status)).toEqual(atFloor.rows.map((r) => r.status));

    // And it was decided on a REAL row, not on a missing capability or on
    // invalid input — either of which would return the same verdict while
    // meaning something entirely different.
    expect(perfect.missingCapabilities).toEqual([]);

    // ⚠ THE DISTINCTION THAT MATTERS, AND IT IS EASY TO MISREAD FROM THE
    // OUTCOME ALONE. Several rows are `floor-breach` — but the INCUMBENT
    // misses those same floors, for the reasons T1's shortfall ledger records
    // (stages 3-5 unbuilt, §3.2's exact-match chrome vocabulary). A verdict
    // resting only on those would be saying little about the challenger.
    //
    // The false-title row is different in kind: it is a COMPARATIVE loss,
    // measured between two arms that share every one of those confounds, so
    // it survives them. That is the row this decision must be able to point
    // at, and asserting it is what stops "incumbent-stays" from being a
    // conclusion reached by accident.
    const byLabel = new Map(perfect.rows.map((r) => [r.metric, r]));

    // The false-title row breaches the absolute floor outright (0.348 against
    // a 0.10 ceiling) — but so, less badly, does the incumbent, so on its own
    // this row is partly about the missing stages.
    const falseTitle = byLabel.get('False-title rate');
    expect(falseTitle?.status).toBe('floor-breach');
    expect(falseTitle!.challenger).toBeGreaterThan(falseTitle!.incumbent);

    // ⚠ THIS IS THE ROW THE DECISION RESTS ON, and it is the cleanest evidence
    // in the whole corpus: the challenger PASSES the absolute fabrication
    // ceiling and still loses to the incumbent, three times over. No floor, no
    // missing stage and no shared confound is doing any work here — it is a
    // straight comparison between two arms that differ only by deployment
    // name. A reader that invents more titles is disqualified by NFR-012a
    // regardless of what it costs.
    expect(byLabel.get('Fabrication rate')?.status).toBe('worse-than-incumbent');
  });
});
