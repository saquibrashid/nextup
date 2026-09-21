/**
 * `T-AI-058` — every §4A live band must be ACHIEVABLE by the model in
 * production, checked offline against the committed baseline.
 *
 * ⚠ THE RULE ALREADY EXISTED AND WAS ENFORCED NOWHERE. `T-AI-051k` states it
 * for L2 — *"the floor must not exceed the incumbent's measured worst pair"* —
 * inside `goldenLive.spec.ts`, which no Vitest project collects because it
 * spends real money. So the guard against an unreachable band only ran during
 * the billed run whose bands it protects (`T-CI-008`: an uncollected spec
 * passes by never running). This file replays the same rule over the committed
 * report, for free, in CI, for EVERY band the report carries.
 *
 * ⚠ IT WAS ALSO NEVER GENERALISED, AND THAT IS WHY TWO BANDS ARE STILL RED.
 * L1 has `T-AI-051j`, which pins each floor at or below what the OFFLINE
 * recordings achieve — a weaker claim, and the gap is the whole defect: replay
 * is deterministic, live resamples, so a floor calibrated on replay can be
 * unreachable live while `j` calls it honest. L2 reached 0.95 that way and sat
 * permanently red, blocking every model change through §9.7 Stage 3 by a
 * threshold the incumbent itself failed. The same derivation is still standing
 * in two places, named in `KNOWN_BREACHES` below.
 */

import { describe, expect, it } from 'vitest';

import {
  describeBreach,
  latestIncumbentReport,
  parseLiveReport,
  unachievableBands,
} from './bandAchievability.js';
import {
  COST_CEILING_USD,
  FABRICATION_CEILING,
  FALSE_TITLE_CEILING,
  MIN_RECALL,
} from './liveBands.js';

/**
 * The bands the incumbent does NOT clear today, each awaiting an owner
 * decision. ⚠ **THIS IS A CHARACTERISATION PIN, NOT AN ENDORSEMENT** — the
 * same device as `T-AI-054e`. It is bounded from BOTH sides: the gate fails if
 * a NEW band becomes unreachable, and it fails just as loudly if one of these
 * is silently fixed without this list and the note beside it moving together.
 * A "known issue" list that only shrinks by accident is how the L2 defect
 * survived three revisions of the spec.
 *
 * ⚠ THESE ARE NOT BOTH THE SAME KIND OF PROBLEM, and the difference is why
 * neither is fixed here:
 *
 * **L1 `netflix-mylist-desktop-01` (floor 0.900, measured 0.800 × 3).** Purely
 * the offline-derivation defect: the floor is the offline 10/10 dropped one
 * band, and live misses two titles (`in the hand of dante`, `wicked for good`)
 * in every run. Lowering it is arithmetic — but it would also stop reporting a
 * real, reproducible live shortfall, so it is the owner's call whether the
 * floor moves or the extraction does.
 *
 * **L5 false-title (ceiling 0.10, measured 0.1786 / 0.1321 / 0.0926).** ⚠ **DO
 * NOT "FIX" THIS BY RAISING THE CEILING.** Part of the numerator is a DOUBLE
 * COUNT the scorer already refuses elsewhere. `truncated-titles-01` presents
 * deliberately truncated captions while its answer key holds the full titles,
 * so a reader that emits `dr strangelove or how i lear` is charged twice for
 * one defect — once as a missed title (L1) and again as a false title (L5).
 * `goldenScorer.ts` excludes chrome from this numerator for exactly that
 * reason (*"counting it twice would let one defect blow two unrelated gates and
 * obscure which one actually moved"*); the rule was never extended to
 * truncation. Backing those two strings out: 10/56 → 8/54 = 0.148,
 * 7/53 → 5/51 = 0.098, 5/54 → 3/52 = 0.058 — which clears runs 2 and 3 and
 * still fails run 1. So the double count is real and is NOT the whole story.
 *
 * ⚠ AND THE BASELINE IS STALE, WHICH OUTRANKS BOTH. `golden-2026-09-18.md`
 * predates at least `recently added` entering `chromeTerms` — an entry whose
 * own source comment cites this very report as its evidence, and a false title
 * in that table which today's code would classify `chrome-suspected` and
 * exclude from the numerator. Moving a band against these numbers would
 * calibrate it to a pipeline that no longer exists, which is precisely how L2
 * got to 0.95. A fresh `npm run golden:live` (manual, ~$0.20) comes first.
 */
const KNOWN_BREACHES: readonly string[] = [
  'L1 · netflix-mylist-desktop-01 worst-run recall 0.8000 vs band 0.9000',
  'L5 · run 1 false-title rate 0.1786 vs band 0.1000',
  'L5 · run 2 false-title rate 0.1321 vs band 0.1000',
];

describe('T-AI-058 · every live band is achievable by the model in production', () => {
  const file = latestIncumbentReport();
  const report = parseLiveReport(file);

  it('T-AI-058a · no band is unreachable beyond the recorded, owner-pending set', () => {
    const breaches = unachievableBands(report, {
      falseTitleCeiling: FALSE_TITLE_CEILING,
      fabricationCeiling: FABRICATION_CEILING,
      costCeilingUsd: COST_CEILING_USD,
      minRecall: MIN_RECALL,
    }).map(describeBreach);

    // ⚠ EQUALITY, NOT SUBSET. A subset assertion would let a band be quietly
    // fixed — or a report be quietly replaced by one that measures less —
    // without this file's reasoning being revisited, and that reasoning is the
    // only record of WHY each breach is still open.
    expect(breaches.slice().sort(), `baseline: ${file}`).toEqual(KNOWN_BREACHES.slice().sort());
  });

  it('T-AI-058b · the baseline is really being read — the parse is not vacuous', () => {
    // ⚠ WITHOUT THIS, A REGEX THAT MATCHED NOTHING WOULD REPORT ZERO BREACHES
    // AND `a` WOULD READ AS A CLEAN BILL OF HEALTH. The report format is
    // markdown written by another file; a heading rename silently empties
    // every table here, and an empty table breaches no band.
    //
    // ⚠ LIMIT, FOUND WHILE MUTATION-PROVING THIS CASE: the TOTAL-emptiness
    // mutation never reaches here. `parseLiveReport` throws on a zero-row
    // table, so the suite dies at COLLECTION and reports "no tests" with zero
    // failures — the `T-CI-008` shape in miniature, where the run is red by
    // exit code but every per-test counter reads clean. That is the better
    // failure (it names the file and the missing section), so the throw stays
    // and this case covers the subtler half: a parse that matches but drops
    // data. Proven by capturing only the first of three run columns.
    expect(report.aggregates).toHaveLength(3);
    expect(report.perImage.map((i) => i.imageId).sort()).toEqual(Object.keys(MIN_RECALL).sort());
    for (const img of report.perImage) {
      expect(img.runs, `${img.imageId} must carry one recall per run`).toHaveLength(3);
    }
    expect(report.costUsd).toBeGreaterThan(0);
  });

  it('T-AI-058c · a floor is judged on the WORST run, never the best', () => {
    // §9.7 Stage 2 runs three times because one run is not a measurement. A
    // band cleared by one run of three is cleared by luck, and `T-AI-051a`
    // asserts the live floors per run — so the achievability check has to use
    // the same worst-case reading or it would certify a band the live suite
    // then fails against.
    const breaches = unachievableBands(
      {
        file: 'synthetic',
        aggregates: [
          { run: 1, recall: 1, falseTitleRate: 0, fabricationRate: 0, chromeRejection: 1 },
        ],
        perImage: [{ imageId: 'x', floor: 0.9, runs: [1, 1, 0.5] }],
        costUsd: 0.1,
      },
      {
        falseTitleCeiling: 0.1,
        fabricationCeiling: 0.05,
        costCeilingUsd: 0.5,
        minRecall: { x: 0.9 },
      },
    );
    expect(breaches.map(describeBreach)).toEqual(['L1 · x worst-run recall 0.5000 vs band 0.9000']);
  });

  it('T-AI-058d · a ceiling and a floor are compared in OPPOSITE directions', () => {
    // ⚠ AN INVERTED COMPARISON IS THE SILENT FAILURE HERE: it reports every
    // healthy band as a breach and every real breach as healthy, and the list
    // it produces still looks entirely plausible. Asserted on values that are
    // unambiguous in both directions — recall far ABOVE its floor and a false
    // -title rate far BELOW its ceiling must together yield nothing at all.
    const clean = unachievableBands(
      {
        file: 'synthetic',
        aggregates: [
          { run: 1, recall: 1, falseTitleRate: 0.01, fabricationRate: 0.001, chromeRejection: 1 },
        ],
        perImage: [{ imageId: 'x', floor: 0.5, runs: [0.99, 0.98, 0.97] }],
        costUsd: 0.01,
      },
      {
        falseTitleCeiling: 0.1,
        fabricationCeiling: 0.05,
        costCeilingUsd: 0.5,
        minRecall: { x: 0.5 },
      },
    );
    expect(clean).toEqual([]);
  });

  it('T-AI-058e · a challenger probe can never justify a band', () => {
    // ⚠ `golden-<date>-<slug>.md` IS A PROBE OF A MODEL NOBODY SHIPS. A band is
    // achievable only if the reader actually in production reaches it, so
    // reading a probe would let a threshold be justified by a candidate that
    // was measured once and rejected — and the repo holds two such probes
    // (`-probe-gpt-5-4`, `-probe-gpt-6-astra-t1`) that sort AFTER the baseline
    // and would win a naive `.sort().at(-1)`.
    expect(file).toMatch(/^golden-\d{4}-\d{2}-\d{2}\.md$/);
  });
});
