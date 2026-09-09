/**
 * T1 — the offline golden metric suite (`specs/ai.md` §9.2, TASK-079).
 *
 * The committed recordings are replayed through the **real** `crossCheck()`,
 * the **real** `cleanup()`, the **real** §7.4 collapse and the **real**
 * `matchCandidate()`, and scored against `expected/` — the answer key, which
 * was authored by reading the images and never from any reader's output
 * (`tools/golden-expected.mjs`). No network, no Azure account, no cost, every
 * PR.
 *
 * ⚠ THE SCORING LIVES IN `goldenScorer.ts`, NOT HERE, and it is shared with
 * the §9.7 bake-off. Two copies of the scoring code would report a difference
 * between the COPIES as a difference between the MODELS.
 *
 * ⚠ EVERY METRIC HERE HAS A ZERO-YIELD FAILURE MODE THAT READS AS A PASS.
 * If the recordings were not found, recall is 0 (caught), but the false-title
 * rate is 0, the fabrication rate is 0 and chrome rejection is vacuous — three
 * gates that a broken fixture chain would SATISFY. `T-AI-047` guards the
 * pairing itself; this suite additionally re-asserts a non-vacuity floor
 * before scoring anything, so a green run here always means the pipeline
 * actually ran.
 *
 * ⚠ THE GATES ARE THE PRODUCT'S, NOT THE INCUMBENT'S. Do not relax a floor to
 * whatever `gpt-4.1` happens to score. `NFR-012a` makes extraction
 * quality-first, so a metric drifting below its gate is a finding about the
 * reader, and §9.7's bake-off is the mechanism for changing the reader —
 * not for changing the number.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { matchCandidate, normaliseTitleText } from '@nextup/domain';

import {
  DEFAULT_RECORDING_MODEL_ID,
  goldenRecordingStore,
  sha256OfBytes,
} from '../../apps/api/src/extraction/recordings.js';

import {
  GOLDEN,
  IMAGES,
  RECALL_VERDICTS,
  manifest,
  hasTmdbFixture,
  scoreAll,
  tmdbResultsFor,
} from './goldenScorer.js';

/* ------------------------------------------------------------------ *
 * §9.2 gates. Named constants, because a bare `0.95` inside an
 * expectation is indistinguishable from a number someone tuned.
 * ------------------------------------------------------------------ */
const AGGREGATE_RECALL_FLOOR = 0.95;
const AGGREGATE_FALSE_TITLE_CEILING = 0.1;
const FABRICATION_RATE_CEILING = 0.05;
const OMISSION_RECOVERY_FLOOR = 1.0;
const CHROME_REJECTION_FLOOR = 0.8;
const MATCH_ACCURACY_FLOOR = 0.9;
const ARTWORK_RECALL_FLOOR = 0.8;

const store = goldenRecordingStore(GOLDEN, DEFAULT_RECORDING_MODEL_ID);
const scored = await scoreAll(DEFAULT_RECORDING_MODEL_ID);
/* ------------------------------------------------------------------ *
 * ⚠ WHY THE §9.2 GATES ARE NOT ASSERTED AS PASS/FAIL YET, AND WHAT IS
 *   ASSERTED INSTEAD.
 *
 * §9.2 defines every one of these metrics over `crossCheck()` **and the real
 * stages 2-5**. Stages 3-5 DO NOT EXIST. `apps/api/src/jobs/startExtraction.ts`
 * says so in terms — its stats comment reads *"stages 3-5, which have not run
 * (TASK-060)"* — and nothing in `apps/api/src` calls `collapseOverlap` or
 * `matchCandidate` at all. Turning the gates on now would grade a pipeline
 * that is missing half its stages, and the resulting number would be
 * attributed to the READER when it is really an artefact of the missing
 * stages. That is the mistake §9.7's bake-off cannot survive.
 *
 * ⚠ THE OPPOSITE MISTAKE — deferring the whole suite until TASK-060 — is
 * worse, and is the one this file exists to avoid. The recordings are fixed
 * bytes and every stage that DOES exist is deterministic, so the measurement
 * is exact and reproducible today. What is asserted, therefore, is the
 * MEASUREMENT ITSELF, pinned to the committed baseline:
 *
 *   - a regression in extraction quality fails CI immediately, and
 *   - an IMPROVEMENT also fails CI, deliberately, forcing the new number to be
 *     recorded rather than absorbed silently.
 *
 * ⚠ THE KNOWN SHORTFALLS BELOW ARE A LEDGER, NOT A SET OF RELAXED GATES.
 * The §9.2 constants above are unchanged and are asserted against the ledger,
 * so the gap between what the product requires and what the corpus currently
 * scores is stated as a number in CI rather than left as a footnote. Do NOT
 * "fix" a failure here by editing a baseline number to match new output
 * without first understanding which of the two it is.
 */

/**
 * Every departure from a §9.2 gate, with the cause established by reading the
 * recordings — not guesses.
 */
const KNOWN_SHORTFALLS = {
  /**
   * 61 of 67 expected titles. The six misses are FOUR distinct causes, all
   * real and none of them fixture defects:
   *
   *   - `louis c k ridiculous` x2 — the phone's floating nav bar OCCLUDES the
   *     caption in `netflix-mylist-mobile-01` and in the JPEG derived from it.
   *     A reader that declines to name a tile it cannot see is behaving
   *     correctly; this is the corpus being honest, not the reader failing.
   *   - `raw` x2 — the model reads the WWE logo baked into the artwork and
   *     returns `wwe raw`. The visible caption is `Raw`, so the answer key is
   *     right and the embellishment costs a recall point AND a false title.
   *   - `wicked for good` — on the desktop capture the model returned
   *     `wicked part one`, a DIFFERENT FILM. A genuine misidentification, and
   *     the most serious single finding in the corpus.
   *   - `in the hand of dante` — returned as `in the shadow of dante`, a
   *     misread of a script-face title treatment.
   */
  aggregateRecall: 0.9104477611940298,
  /**
   * Dominated by ONE systematic cause, not by many small ones: stage 1c's
   * consumption of an OCR line is GEOMETRY-scoped, and on Netflix's mobile
   * list layout the caption sits BESIDE the artwork rather than over it. The
   * line never overlaps the tile box, is never marked consumed, and is
   * re-emitted as an orphan — correctly, per `crossCheck.ts`'s header, since
   * dropping it would be the very silent-omission failure the OCR leg exists
   * to prevent. §7.4's collapse reunites the ones whose text matches exactly;
   * FRAGMENTS of a two-line caption (`stranger things vhs` + `special
   * edition`) survive as separate candidates and are counted here.
   */
  aggregateFalseTitleRate: 0.25,
  /**
   * The §3.2 vocabulary is a fixed list of 26 EXACT terms, and the corpus's
   * real chrome is mostly outside it: `sort by`, `top matches`, `haven't
   * started`, `clips`, `my netflix`, `my stuff`, `my purchases`,
   * `recommended for you`. Worse, on both desktop captures OCR returns the
   * whole navigation bar as ONE line (`netflix home shows movies`), which no
   * exact-match vocabulary can ever match however many terms it holds.
   *
   * ⚠ DO NOT FIX THIS BY ADDING TERMS. `chromeTerms.ts` says *"Do not add
   * terms without the spec"*, and it is right to: the list is exact-match
   * precisely so that a work named `Max` or `Home` survives. Widening it is a
   * spec change, and the line-merging problem is not a vocabulary problem at
   * all.
   */
  chromeRejectionRate: 0.2361111111111111,
  /**
   * 18 of 24. ⚠ THE MOST IMPORTANT FINDING IN THIS FILE, and one no synthetic
   * corpus would ever have produced: every single miss is a **2025 release
   * whose title collides exactly with a famous older work**.
   *
   *   ladies first, his & hers, man on fire, frankenstein, normal,
   *   the hitchhiker's guide to the galaxy
   *
   * The matcher returns the FAMOUS one — Tony Scott's `Man on Fire`,
   * Whale's `Frankenstein` — because a streaming caption carries no year, so
   * `extractedYear` is null and popularity is all that is left to rank on.
   * The owner's list is, by construction, mostly NEW releases, so the
   * collision is not a rare edge: it is 25% of this corpus.
   *
   * ⚠ DO NOT "FIX" THIS BY TEACHING THE ANSWER KEY TO PREFER THE RECENT ONE.
   * The key was resolved from the recorded TMDB payloads by exact normalised
   * equality and then checked by hand against the images; it is right. Making
   * the matcher agree by giving it the same recency preference would fix this
   * corpus and break every genuinely-old title in the owner's list.
   */
  matchAccuracy: 0.75,
  /**
   * 2 of 4. ⚠ §9.2 sets this floor at **1.0 and calls it non-negotiable**, so
   * this is the most serious shortfall in the ledger — and its cause is the
   * same geometry-scoped consumption as the false-title rate, seen from the
   * other side.
   *
   * Both misses are the title `Raw`. OCR read the caption correctly. The
   * vision model read the WWE logo burnt into the artwork and returned
   * `wwe raw`. On the DESKTOP layouts the caption sits *under* the artwork, so
   * its box DOES overlap the tile — stage 1c therefore marks the OCR line
   * consumed by the tile it contradicts, and the correct text is absorbed into
   * the wrong one instead of surviving as an orphan.
   *
   * ⚠ So consumption is not merely noisy: on desktop it can DESTROY the very
   * correction the OCR leg exists to supply, while on mobile it fails to
   * consume anything and floods the candidate set instead. One rule, two
   * opposite failures, both traceable to `crossCheck.ts` L106-109 scoping
   * consumption by geometry alone rather than by geometry AND text agreement.
   */
  omissionRecovery: 0.5,
} as const;

/**
 * The blank capture's three surviving strings, pinned exactly.
 *
 * ⚠ THIS TEST USED TO ASSERT AN EMPTY ARRAY, AND THAT WAS WRONG — not because
 * the reader misbehaved, but because the assertion described a property the
 * product does not have. These are the empty-state copy and a nav heading:
 * really on the screen, correctly read, and correctly NOT fabricated. They
 * survive only because §3.2's exact-match vocabulary does not contain them,
 * which is the chrome shortfall above and is already counted there.
 *
 * What matters for fabrication is that NOTHING resembling a work title
 * appears, and that is what is asserted.
 */
const BLANK_PAGE_SURVIVING_CHROME = [
  'you haven t added anything yet',
  'titles you add to your list will appear here',
  'new hot',
];

describe('T-AI-030 the golden corpus is measured, and the measurement is pinned', () => {
  it('T-AI-030a · the corpus actually ran — no metric was scored on an empty pipeline', () => {
    // ⚠ FIRST, AND NOT DECORATION. Every metric here except recall is
    // SATISFIED by a pipeline that produced nothing: a false-title rate of 0,
    // a fabrication rate of 0 and a vacuous chrome ratio all read as passes.
    // `T-AI-047` guards the recording pairing; this guards the run.
    expect(scored).toHaveLength(manifest.images.length);
    for (const s of scored) {
      if (s.expected.expectedCandidates.length === 0) continue;
      expect(s.candidates.length, `${s.image.id} produced no candidates`).toBeGreaterThan(0);
    }
    expect(scored.reduce((n, s) => n + s.candidates.length, 0)).toBeGreaterThan(50);
  });

  it('T-AI-030b · per-image recall is exactly the committed baseline', () => {
    const measured = Object.fromEntries(scored.map((s) => [s.image.id, s.found]));
    // Recorded from the live `gpt-4.1` recordings. A change to ANY of these is
    // a change in extraction quality and must be explained, in either direction.
    expect(measured).toEqual({
      'netflix-mylist-mobile-01': 7,
      'netflix-mylist-mobile-02': 8,
      'netflix-mylist-desktop-01': 8,
      'netflix-continue-watching-01': 0,
      'max-saved-mobile-01': 6,
      'max-saved-desktop-01': 6,
      'netflix-artwork-only-01': 9,
      'blank-no-content-01': 0,
      'truncated-titles-01': 4,
      'low-quality-jpeg-01': 7,
      'rotated-01': 6,
    });
  });

  it('T-AI-030c · aggregate recall is pinned, and its distance from the §9.2 floor is stated', () => {
    const expectedTotal = scored.reduce((n, s) => n + s.expected.expectedCandidates.length, 0);
    const foundTotal = scored.reduce((n, s) => n + s.found, 0);
    expect(expectedTotal).toBe(67);
    expect(foundTotal / expectedTotal).toBe(KNOWN_SHORTFALLS.aggregateRecall);
    // The gate itself, restated so the shortfall is visible in the source
    // rather than only in a document.
    expect(KNOWN_SHORTFALLS.aggregateRecall).toBeLessThan(AGGREGATE_RECALL_FLOOR);
  });

  it('T-AI-030d · the aggregate false-title rate is pinned', () => {
    const titleCandidates = scored.reduce(
      (n, s) => n + s.candidates.filter((c) => c.cleanupVerdict === 'title-candidate').length,
      0,
    );
    const falseTotal = scored.reduce((n, s) => n + s.falseTitles, 0);
    expect(titleCandidates).toBeGreaterThan(0);
    expect(falseTotal / titleCandidates).toBe(KNOWN_SHORTFALLS.aggregateFalseTitleRate);
    expect(KNOWN_SHORTFALLS.aggregateFalseTitleRate).toBeGreaterThan(AGGREGATE_FALSE_TITLE_CEILING);
  });

  it('T-AI-030e · chrome rejection is pinned', () => {
    const chromeTotal = scored.reduce((n, s) => n + s.expected.expectedChrome.length, 0);
    const rejected = scored.reduce((n, s) => n + s.chromeRejected, 0);
    expect(chromeTotal).toBeGreaterThan(0);
    expect(rejected / chromeTotal).toBe(KNOWN_SHORTFALLS.chromeRejectionRate);
    expect(KNOWN_SHORTFALLS.chromeRejectionRate).toBeLessThan(CHROME_REJECTION_FLOOR);
  });

  it('T-AI-030f · the pins clear themselves the moment the shortfalls stop being real', () => {
    // ⚠ A DEFERRAL GUARD, and it is meant to FAIL one day. Without it,
    // "measure now, gate later" quietly becomes "measure forever" — the same
    // mechanism `T-AI-045v` uses for the bake-off.
    //
    // ⚠ **THE PROXY WAS WRONG TWICE, AND BOTH ERRORS ARE RECORDED RATHER THAN
    // TIDIED.** It first read the extraction RUNNER and failed if it named
    // `collapseOverlap`/`matchCandidate`, on the reasoning that a runner
    // calling stage 3 removes the reason for pinning. TASK-190 wired stage 3
    // into the runner, and it fired exactly as designed. Re-pointing it at the
    // SCORER then failed immediately for a better reason: `goldenScorer.ts`
    // **already** applies the pre-match collapse (and `T-AI-031b` already
    // scores matching), so stage 3 was never what these numbers were waiting
    // for. ~~`expect(runner).not.toContain('collapseOverlap')`~~ and
    // ~~`expect(scorer).not.toContain('collapseOverlap')`~~ are both dead.
    //
    // What actually pins them is the LEDGER: four product findings, each
    // recorded above with its cause. So the clearing condition is the honest
    // one — every pinned shortfall must still be on the failing side of its
    // §9.2 threshold. The day extraction improves past one, this fails and
    // says: stop pinning that metric, gate it.
    expect(KNOWN_SHORTFALLS.aggregateRecall).toBeLessThan(AGGREGATE_RECALL_FLOOR);
    expect(KNOWN_SHORTFALLS.aggregateFalseTitleRate).toBeGreaterThan(AGGREGATE_FALSE_TITLE_CEILING);
    expect(KNOWN_SHORTFALLS.chromeRejectionRate).toBeLessThan(CHROME_REJECTION_FLOOR);
    expect(KNOWN_SHORTFALLS.matchAccuracy).toBeLessThan(MATCH_ACCURACY_FLOOR);
    expect(KNOWN_SHORTFALLS.omissionRecovery).toBeLessThan(OMISSION_RECOVERY_FLOOR);
    // Non-vacuity: a ledger that lost its entries would pass every line above
    // by having nothing to check.
    expect(Object.keys(KNOWN_SHORTFALLS).length).toBeGreaterThanOrEqual(5);
    // And the runner-side stage-3 deferral IS discharged (TASK-190) — asserted
    // positively so it cannot silently regress to the state this guard was
    // originally written to watch for.
    const runner = readFileSync(
      path.resolve(__dirname, '../../apps/api/src/jobs/startExtraction.ts'),
      'utf8',
    );
    expect(runner).toContain('resolveCandidates');
    expect(runner).toContain('cleanup(');
  });
});

describe('T-AI-031 recorded TMDB results resolve the expected work identity', () => {
  it('T-AI-031a · every expected title carries a ground-truth identity', () => {
    // Without this, match accuracy is computed over whichever subset someone
    // happened to fill in — and a key with two identities filled in scores
    // 1.0 exactly as easily as a key with sixty-seven.
    const all = scored.flatMap((s) => s.expected.expectedCandidates);
    expect(all).toHaveLength(67);
    expect(all.filter((c) => c.expectedWorkIdentity === null)).toEqual([]);
  });

  it('T-AI-031b · match accuracy against the recorded fixtures is pinned', () => {
    // ⚠ MEASURED HONESTLY, NOT GATED — and for a different reason than the
    // metrics above. Matching does not depend on the missing stages
    // (`matchCandidate()` is pure and its inputs are the committed TMDB
    // recordings), so this number is real. It simply does not clear §9.2's
    // floor, because of the 2025-title-collision problem recorded in
    // KNOWN_SHORTFALLS.matchAccuracy.
    const seen = new Map<string, string>();
    for (const s of scored) {
      for (const c of s.expected.expectedCandidates) {
        seen.set(c.normalisedText, c.expectedWorkIdentity!);
      }
    }
    expect(seen.size).toBe(24);

    const wrong: string[] = [];
    for (const [normalised, identity] of seen) {
      const outcome = matchCandidate(
        { normalisedText: normalised, extractedYear: null },
        tmdbResultsFor(normalised),
      );
      if (outcome.resolvedWorkIdentity !== identity) {
        wrong.push(`${normalised} -> ${outcome.resolvedWorkIdentity} (expected ${identity})`);
      }
    }

    const accuracy = (seen.size - wrong.length) / seen.size;
    expect(accuracy, `mismatched:\n  ${wrong.join('\n  ')}`).toBe(KNOWN_SHORTFALLS.matchAccuracy);
    expect(KNOWN_SHORTFALLS.matchAccuracy).toBeLessThan(MATCH_ACCURACY_FLOOR);

    // The misses are the recorded set, not a drifting one.
    expect(wrong.map((w) => w.split(' -> ')[0]).sort()).toEqual([
      'frankenstein',
      'his hers',
      'hitchhiker s guide to the galaxy',
      'ladies first',
      'man on fire',
      'normal',
    ]);
  });

  it('T-AI-031c · a work seen in several captures resolves to ONE identity', () => {
    // The Netflix list is captured four times over on purpose. If the same
    // work resolved differently in two of them, dedup would split it into two
    // rows and the combined list would show one title twice — the exact defect
    // the product exists to prevent.
    const byText = new Map<string, Set<string>>();
    for (const s of scored) {
      for (const c of s.expected.expectedCandidates) {
        const set = byText.get(c.normalisedText) ?? new Set<string>();
        set.add(c.expectedWorkIdentity!);
        byText.set(c.normalisedText, set);
      }
    }
    expect([...byText].filter(([, set]) => set.size > 1)).toEqual([]);

    // Non-vacuity: several works really do appear in more than one image.
    const all = scored.flatMap((s) => s.expected.expectedCandidates.map((c) => c.normalisedText));
    const shared = new Set(all.filter((t) => all.filter((x) => x === t).length > 1));
    expect(shared.size).toBeGreaterThan(3);
  });
});

describe('T-AI-032 fabrication is measured, and the contentless page yields nothing', () => {
  it('T-AI-032d · the aggregate fabrication rate clears the §9.2 ceiling', () => {
    // ⚠ ASSERTED, not pinned. Fabrication is a property of the READER alone —
    // an invented title is invented before any later stage sees it — so the
    // missing stages cannot flatter or penalise this number.
    const total = scored.reduce((n, s) => n + s.candidates.length, 0);
    const fabricated = scored.reduce((n, s) => n + s.fabricated, 0);
    expect(total).toBeGreaterThan(0);
    expect(fabricated / total).toBeLessThanOrEqual(FABRICATION_RATE_CEILING);
  });

  it('T-AI-032e · the two fabrications in the corpus are the known ones', () => {
    const found = scored
      .flatMap((s) =>
        s.candidates
          .filter(
            (c) =>
              c.ocrSupport === 'none' &&
              !s.expected.expectedCandidates.some((e) => e.normalisedText === c.normalisedText) &&
              !hasTmdbFixture(c.normalisedText),
          )
          .map((c) => `${s.image.id}: ${c.normalisedText}`),
      )
      .sort();
    // `wicked part one` is a real misidentification of the Wicked: For Good
    // tile; `wwe raw` survives on the degraded JPEG only, where OCR could not
    // corroborate the caption it corroborated on the clean source.
    expect(found).toEqual([
      'low-quality-jpeg-01: wwe raw',
      'netflix-mylist-desktop-01: wicked part one',
    ]);
  });

  it('T-AI-032c · the contentless page invents no work title', () => {
    // The sharpest fabrication case in the corpus: a page that renders its
    // chrome and its empty state and NOTHING else. Any *work* here was
    // invented — so what survives must be exactly the on-screen chrome, and
    // nothing that reads like a title.
    const blank = scored.find((s) => s.image.id === 'blank-no-content-01');
    expect(blank).toBeDefined();
    const titles = blank!.candidates.filter((c) => RECALL_VERDICTS.has(c.cleanupVerdict));
    expect(titles.map((c) => c.normalisedText).sort()).toEqual(
      [...BLANK_PAGE_SURVIVING_CHROME].sort(),
    );
    // Every one of them is corroborated by OCR, i.e. really on the screen.
    expect(titles.filter((c) => c.ocrSupport === 'none')).toEqual([]);
  });
});

describe('T-AI-035 the artwork-only capture is READ, not skipped', () => {
  it('T-AI-035a · artwork recall clears the §9.2 floor', () => {
    // ⚠ ASSERTED. §9.4: this fixture's meaning INVERTED at Revision 2. Under
    // Revision 1 it proved the low-yield path fired; under Revision 2 the
    // reader is expected to identify the works from their title treatment, so
    // a run that yields nothing here is now a failure rather than the expected
    // result. Reading is a stage-1 property, so the missing stages do not
    // affect it.
    const artwork = scored.filter((s) => s.image.expectedArtworkOnly === true);
    expect(artwork.length).toBeGreaterThan(0);

    const expectedTotal = artwork.reduce((n, s) => n + s.expected.expectedCandidates.length, 0);
    const foundTotal = artwork.reduce((n, s) => n + s.found, 0);
    expect(foundTotal / expectedTotal).toBeGreaterThanOrEqual(ARTWORK_RECALL_FLOOR);
  });

  it('T-AI-035b · the low-yield path is NOT what makes it pass', () => {
    for (const s of scored.filter((x) => x.image.expectedArtworkOnly === true)) {
      expect(s.candidates.length, `${s.image.id} produced nothing`).toBeGreaterThan(0);
    }
  });
});

describe('T-AI-039 a title the model missed is recovered from the OCR leg', () => {
  it('T-AI-039c · omission recovery is measured, and the two losses are named', () => {
    // ⚠ §9.2 puts this floor at 1.0 and calls it non-negotiable: the OCR leg
    // exists so that a title the vision model drops is not silently lost, and
    // a rate below 1.0 means the second reader is decorative. The corpus does
    // NOT clear it — see KNOWN_SHORTFALLS.omissionRecovery.
    let recoverable = 0;
    let recovered = 0;
    const missed: string[] = [];

    for (const s of scored) {
      const bytes = readFileSync(path.join(IMAGES, s.image.file));
      const recording = store.get(sha256OfBytes(bytes));
      expect(recording, `${s.image.id} has no recording`).toBeDefined();

      const llmTexts = new Set(
        recording!.llm.map((t) => normaliseTitleText(t.identifiedTitle ?? t.visibleText ?? '')),
      );
      const ocrTexts = new Set(recording!.ocr.map((l) => normaliseTitleText(l.text)));

      for (const c of s.expected.expectedCandidates) {
        if (llmTexts.has(c.normalisedText) || !ocrTexts.has(c.normalisedText)) continue;
        recoverable += 1;
        const survived = s.candidates.some((x) => x.normalisedText === c.normalisedText);
        if (survived) recovered += 1;
        else missed.push(`${s.image.id}: ${c.normalisedText}`);
      }
    }

    // ⚠ `recoverable` COULD legitimately be 0 — it depends on the incumbent
    // missing something the OCR leg caught, which is a property of the
    // recordings rather than of the code. It is pinned so that a corpus which
    // stops exercising this stops doing so VISIBLY, instead of leaving a
    // non-negotiable metric quietly asserting nothing.
    expect(recoverable).toBe(4);
    expect(recovered / recoverable, `not recovered:\n  ${missed.join('\n  ')}`).toBe(
      KNOWN_SHORTFALLS.omissionRecovery,
    );
    expect(KNOWN_SHORTFALLS.omissionRecovery).toBeLessThan(OMISSION_RECOVERY_FLOOR);
    expect(missed.sort()).toEqual([
      'netflix-artwork-only-01: raw',
      'netflix-mylist-desktop-01: raw',
    ]);
  });
});
