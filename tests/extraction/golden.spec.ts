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
   * ~~61~~ **63** of 67 expected titles. The ~~six~~ **four** misses are
   * ~~FOUR~~ **THREE** distinct causes, all real and none of them fixture
   * defects:
   *
   *   - `louis c k ridiculous` x2 — the phone's floating nav bar OCCLUDES the
   *     caption in `netflix-mylist-mobile-01` and in the JPEG derived from it.
   *     A reader that declines to name a tile it cannot see is behaving
   *     correctly; this is the corpus being honest, not the reader failing.
   *   - ~~`raw` x2 — the model reads the WWE logo baked into the artwork and
   *     returns `wwe raw`. The visible caption is `Raw`, so the answer key is
   *     right and the embellishment costs a recall point AND a false title.~~
   *     **FIXED AT TASK-198 by §3.1a R2 — and note the ledger was right that
   *     the answer key was right. Both recall and the false-title rate moved,
   *     exactly as this entry predicted they would.**
   *   - `wicked for good` — on the desktop capture the model returned
   *     `wicked part one`, a DIFFERENT FILM. A genuine misidentification, and
   *     the most serious single finding in the corpus.
   *   - `in the hand of dante` — returned as `in the shadow of dante`, a
   *     misread of a script-face title treatment.
   */
  aggregateRecall: 0.9402985074626866,
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
   *
   * ⚠ THIS NUMBER WENT UP AT TASK-195 WHILE THE DEFECT GOT SMALLER, AND THE
   * DIRECTION IS A DENOMINATOR ARTEFACT, NOT A REGRESSION. The absolute count
   * of false titles fell from **26 to 22**. The rate rose from 0.2500 to
   * 0.3143 because its denominator is `title-candidate` COUNT, and 34 chrome
   * strings that used to be counted as title candidates are now correctly
   * `chrome-suspected` — so the same numerator is divided by 70 instead of
   * 104. Anyone reading this number as "false titles got worse" is reading it
   * backwards; the honest summary is that the corpus stopped hiding the rate
   * behind a padded denominator.
   *
   * ⚠ AND IT WENT DOWN AT TASK-198 FOR THE ORDINARY REASON — 0.3143 to 0.2857,
   * two fewer false titles, because the three `wwe raw` expansions stopped
   * being emitted. Denominator unchanged at 70.
   *
   * ⚠ AND DOWN AGAIN AT TASK-199 — 0.2857 to 0.2424 — when the owner ruled
   * that `HBO`, `HBO ORIGINAL` and `New` are chrome. Four badge instances left
   * BOTH sides of the fraction (20/70 -> 16/66), because a `chrome-suspected`
   * candidate is neither a false title nor a title candidate. ⚠ **THIS ONE
   * CHANGED THE ANSWER KEY, WHICH IS NORMALLY THE FORBIDDEN MOVE.** It was
   * legitimate only because the badges are genuinely printed on the images —
   * `HBO` is half the `HBO max` wordmark — and because the vocabulary and the
   * three answer keys were changed TOGETHER. Changing only the key would have
   * bought this number by degrading chrome rejection, which is a real gate.
   *
   * ⚠ AND DOWN AGAIN AT TASK-203 — 0.2424 to 0.1935 — the FRAGMENT COLLAPSE
   * (§7.4a). Two fragments (`wicked` beside `wicked for good`, `first` beside
   * `ladies first`) now collapse into the caption that holds them whole, so
   * they leave both sides of the fraction (8/33 -> 6/31). Recall is unchanged,
   * which is the point: the proximity guard is what keeps `true detective`
   * from collapsing into `true detective night country` and turning a
   * false-title win into a recall loss.
   *
   * ⚠ THE REMAINING SIX ARE NOT FRAGMENTS OF THIS KIND, and the fragment pass
   * cannot reach them. `stranger things vhs` + `special edition` sit at
   * y≈0.75 while the candidate holding the whole caption is an ARTWORK read
   * from a different tile at y≈0.88 — a caption-merge failure (§3.2 step 1),
   * not an overlap failure. The four on `max-saved-desktop-01` are a
   * recommendations region. Both are tracked separately; neither is bought by
   * widening this pass.
   */
  aggregateFalseTitleRate: 0.1935483870967742,
  /**
   * ~~2 of 4. ⚠ §9.2 sets this floor at **1.0 and calls it non-negotiable**, so
   * this is the most serious shortfall in the ledger — and its cause is the
   * same geometry-scoped consumption as the false-title rate, seen from the
   * other side.~~
   *
   * ~~Both misses are the title `Raw`. OCR read the caption correctly. The
   * vision model read the WWE logo burnt into the artwork and returned
   * `wwe raw`. On the DESKTOP layouts the caption sits *under* the artwork, so
   * its box DOES overlap the tile — stage 1c therefore marks the OCR line
   * consumed by the tile it contradicts, and the correct text is absorbed into
   * the wrong one instead of surviving as an orphan.~~
   *
   * ~~⚠ So consumption is not merely noisy: on desktop it can DESTROY the very
   * correction the OCR leg exists to supply, while on mobile it fails to
   * consume anything and floods the candidate set instead. One rule, two
   * opposite failures, both traceable to `crossCheck.ts` L106-109 scoping
   * consumption by geometry alone rather than by geometry AND text
   * agreement.~~
   *
   * ⚠ **RETIRED BY TASK-198 — NOW A GATE, SEE {@link OMISSION_RECOVERY_MEASURED}.
   * THE DIAGNOSIS ABOVE WAS FALSE AND IS KEPT STRUCK THROUGH ONLY SO IT IS NOT
   * RE-DERIVED.** The OCR line is not destroyed by consumption: it survives
   * with `basis: 'both'`, `boxSource: 'ocr'` and `rawText: 'RAW'` intact.
   * Nothing in `crossCheck.ts` needed changing.
   */
} as const;

/**
 * Chrome rejection — **A GATE, NOT A PIN, SINCE TASK-195.**
 *
 * ⚠ IT LEFT `KNOWN_SHORTFALLS` BY CLEARING §9.2, WHICH IS EXACTLY WHAT
 * `T-AI-030f` EXISTS TO FORCE. Measured 0.2361 when the ledger was written and
 * **0.8750 now** against a floor of {@link CHROME_REJECTION_FLOOR}. The two
 * causes recorded in TASK-079 finding (2) were both real and both fixed:
 *
 *   1. **The vocabulary genuinely did not cover this corpus** — `sort by`,
 *      `top matches`, `clips`, `my netflix`, `my stuff`, `my purchases`,
 *      `recommended for you` and nine more are now §3.2 terms.
 *   2. **The nav bar was never one OCR line.** The finding said no exact
 *      vocabulary could ever match `netflix home shows movies`, and that was
 *      the right conclusion from the wrong premise: the RECORDINGS hold
 *      `NETFLIX`, `Home`, `Shows`, `Movies` as four separate lines. §3.2 step
 *      1's reading-order grouping — which runs BEFORE the chrome test — glued
 *      them together, and the vocabulary was then asked to match a string the
 *      UI never rendered. `mergeable()` now refuses to merge across a chrome
 *      label.
 *
 * The residual 9 of 72 are OCR misses and rotation artefacts, not
 * classification failures: the line is absent from the reader's output
 * altogether, so no verdict can be assigned to it.
 *
 * ⚠ **0.8750 → 0.8481 AT TASK-199, AND THIS ONE GOT WORSE ON PURPOSE.** Do not
 * "fix" it by trimming the answer keys. The owner ruled that `HBO`,
 * `HBO ORIGINAL` and `New` are chrome, so seven entries were added across the
 * three Max keys — but the pipeline only isolates FOUR of them as standalone
 * candidates. On `max-saved-mobile-01` and `rotated-01`, §3.2 step 1's
 * reading-order grouping merges the badges into the adjacent tile caption
 * before step 3 can test them, so `hbo original` and `new` never exist as
 * lines to classify. Numerator 63 → 67, denominator 72 → 79.
 *
 * ⚠ THAT DROP IS THE METRIC WORKING, NOT FAILING. The badges were always on
 * those images; the key was previously silent about them, which flattered this
 * number. What the new value measures is a REAL residual defect — the same
 * grouping-runs-before-classification cause TASK-195 fixed for the nav bar,
 * surviving in a second place. It is 4.8 points clear of the 0.80 floor, and
 * the honest way to recover it is to make grouping stop swallowing the badges,
 * not to stop writing them down.
 */
const CHROME_REJECTION_MEASURED = 0.8481012658227848;

/**
 * Match accuracy — **A GATE, NOT A PIN, SINCE TASK-197.** 23 of 24.
 *
 * ⚠ THE SECOND METRIC TO LEAVE `KNOWN_SHORTFALLS` BY CLEARING §9.2. It was
 * 0.75, and the ledger entry that used to sit here was the most emphatic in
 * the file: every miss was a 2025 release colliding exactly with a famous
 * older work (`ladies first`, `his & hers`, `man on fire`, `frankenstein`,
 * `normal`, `the hitchhiker's guide to the galaxy`), 25 % of the corpus, with
 * a standing warning never to answer it by teaching the matcher to prefer
 * recent titles.
 *
 * ⚠ THAT WARNING STANDS AND WAS NOT VIOLATED. The cause was not an absence of
 * a recency signal; it was a **reverse** recency preference nobody had
 * noticed. §4.2 step 4 broke score ties by **lower `tmdbId`**, chosen because
 * it is "stable forever" — but TMDB assigns ids monotonically, so lowest-id
 * means oldest-work, every time. TASK-197 replaced it with the order TMDB
 * itself returned the results in, which is an INPUT we already depend on
 * wholly rather than a computation, and which ranks the old famous work first
 * for an old famous title — `hitchhiker s guide to the galaxy` still resolves
 * to the 2005 film over the 1981 series purely on that rule.
 *
 * ⚠ THE WORSE HALF OF THE OLD RULE WAS NEVER RECORDED AS A METRIC AT ALL: the
 * same ordering selects the **top-5 alternates**, so where more than five
 * works share a title, the recent one was pushed off the list entirely and the
 * owner could not reach it in one tap (US-007 AC-4). Measured on this corpus,
 * `ladies first` (20 results) and `frankenstein` (20 results) both had the
 * correct identity absent from their own alternates. `T-AI-031d` guards it.
 *
 * The single residual miss is `man on fire`, where TMDB ranks a 2024 series
 * above Tony Scott's 2004 film. It is genuinely ambiguous, it is flagged
 * `ambiguous: true`, and the film IS in the alternates — one tap, which is
 * exactly what the review pass exists to provide.
 */
const MATCH_ACCURACY_MEASURED = 23 / 24;

/**
 * Omission recovery — **A GATE, NOT A PIN, SINCE TASK-198.** 4 of 4.
 *
 * ⚠ THE THIRD METRIC TO LEAVE `KNOWN_SHORTFALLS` BY CLEARING §9.2, AND THE
 * ONLY ONE WHOSE LEDGER ENTRY WAS SIMPLY WRONG. It read 0.5 against a floor
 * §9.2 calls **non-negotiable**, and blamed stage 1c for consuming the `Raw`
 * OCR line on geometry and destroying it. A probe falsified that outright: the
 * candidate survives, with `rawText: 'RAW'`, `basis: 'both'` and
 * `boxSource: 'ocr'`. Nothing was destroyed and `crossCheck.ts` was not at
 * fault.
 *
 * ⚠ THE MODEL DID NOT MISREAD THE TILE EITHER. Its own `visibleText` is
 * `"RAW"` — the same glyphs OCR read. It then reported
 * `identifiedTitle: "WWE Raw"`, and §3.1a R1's `inferredTitle ?? rawText`
 * handed the matcher the embellishment over a reading two independent readers
 * agreed on. TMDB titles that work **`Raw`** (`tmdb:tv:4656`), so the expansion
 * searched for a string the provider does not use, in three separate images.
 *
 * The fix is `preferredSource()` (§3.1a R2), and its whole difficulty is that
 * "the inference differs from the caption" is **also true of every truncated
 * tile**, which is the case R1 exists for. The discriminator is that a
 * de-truncation *extends* the printed prefix and an invention does not.
 * `T-AI-043c`-`f` are the discriminating twins.
 *
 * ⚠ THE SCORER'S PREDICATE WAS NOT TOUCHED. The denominator is still 4, so
 * this is a product improvement and not a redefinition of the measurement —
 * check that first if this number is ever questioned.
 */
const OMISSION_RECOVERY_MEASURED = 1;

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
/**
 * The blank capture's surviving strings — **now none, and that is a result,
 * not a reset.**
 *
 * ⚠ READ THE HISTORY BEFORE TOUCHING THIS. It began as `[]`, and that was
 * WRONG: the assertion described a property the product did not have. Three
 * strings survived — the two empty-state sentences and the `New & Hot` nav
 * heading — really on the screen, correctly read, correctly NOT fabricated,
 * and outside §3.2's vocabulary. So the list was filled in to say what the
 * product actually did.
 *
 * TASK-195 put all three into §3.2, so the honest value is `[]` **again**, by
 * a completely different route. The empty array is now earned rather than
 * assumed, and `T-AI-032c`'s second assertion (nothing uncorroborated) is what
 * keeps it from being vacuous.
 */
const BLANK_PAGE_SURVIVING_CHROME: readonly string[] = [];

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
      'netflix-mylist-desktop-01': 9,
      'netflix-continue-watching-01': 0,
      'max-saved-mobile-01': 6,
      'max-saved-desktop-01': 6,
      'netflix-artwork-only-01': 10,
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

  it('T-AI-030e · chrome rejection CLEARS the §9.2 floor and is gated, not pinned', () => {
    const chromeTotal = scored.reduce((n, s) => n + s.expected.expectedChrome.length, 0);
    const rejected = scored.reduce((n, s) => n + s.chromeRejected, 0);
    expect(chromeTotal).toBe(79);
    // The gate, asserted first because it is the one that matters.
    expect(rejected / chromeTotal).toBeGreaterThanOrEqual(CHROME_REJECTION_FLOOR);
    // And the exact value, so an improvement is recorded rather than absorbed
    // and a silent slide toward the floor still fails.
    expect(rejected / chromeTotal).toBe(CHROME_REJECTION_MEASURED);
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
    // ⚠ AND IT HAS NOW FIRED THREE TIMES FOR REAL. `chromeRejectionRate` was
    // the fifth entry here until TASK-195, `matchAccuracy` the fourth until
    // TASK-197, and `omissionRecovery` the third until TASK-198; each cleared
    // §9.2, this guard failed as designed, and the metric was moved out of the
    // ledger and gated (by `T-AI-030e`, `T-AI-031b` and `T-AI-039c`
    // respectively). That is the whole mechanism working end to end — so none
    // of the three keys may come back, and the count below drops to match.
    expect(Object.keys(KNOWN_SHORTFALLS)).not.toContain('chromeRejectionRate');
    expect(Object.keys(KNOWN_SHORTFALLS)).not.toContain('matchAccuracy');
    expect(Object.keys(KNOWN_SHORTFALLS)).not.toContain('omissionRecovery');
    // Non-vacuity: a ledger that lost its entries would pass every line above
    // by having nothing to check.
    expect(Object.keys(KNOWN_SHORTFALLS).length).toBeGreaterThanOrEqual(2);
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
    // recordings), so this number is real. Since TASK-197 it also CLEARS
    // §9.2's floor, so it is asserted as a gate and pinned exactly — see
    // MATCH_ACCURACY_MEASURED for why the fix is not the recency preference
    // the old ledger entry warned against.
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
    expect(accuracy, `mismatched:\n  ${wrong.join('\n  ')}`).toBe(MATCH_ACCURACY_MEASURED);
    expect(accuracy).toBeGreaterThanOrEqual(MATCH_ACCURACY_FLOOR);
    // The metric is a GATE now, not a ledger entry. If it is ever put back
    // into KNOWN_SHORTFALLS the ratchet has been released.
    expect(Object.keys(KNOWN_SHORTFALLS)).not.toContain('matchAccuracy');

    // The miss is the recorded one, not a drifting set.
    expect(wrong.map((w) => w.split(' -> ')[0]).sort()).toEqual(['man on fire']);
  });

  it('T-AI-031d · the correct identity is always REACHABLE in the alternates', () => {
    // ⚠ THIS IS THE HALF OF THE OLD `lower tmdbId` TIE-BREAK THAT NO METRIC
    // MEASURED. Accuracy only asks whether the top pick is right; US-007 AC-4
    // promises that when it is wrong the owner fixes it in ONE TAP. That
    // promise is empty if the right answer is not in the five alternates —
    // and under the old rule it systematically was not, because ids are
    // monotonic, so "the five lowest ids" means "the five oldest works". Both
    // `ladies first` and `frankenstein` return 20 exact-title results here,
    // and the correct 2025/2026 identity sat outside the window entirely.
    //
    // Mutation check: restoring `x.tmdbId - y.tmdbId` as the primary
    // tie-break fails this test on those two titles, not merely `T-AI-031b`.
    const seen = new Map<string, string>();
    for (const s of scored) {
      for (const c of s.expected.expectedCandidates) {
        seen.set(c.normalisedText, c.expectedWorkIdentity!);
      }
    }

    const unreachable: string[] = [];
    for (const [normalised, identity] of seen) {
      const outcome = matchCandidate(
        { normalisedText: normalised, extractedYear: null },
        tmdbResultsFor(normalised),
      );
      const reachable = outcome.matchCandidates.some(
        (c) => `tmdb:${c.mediaType}:${c.tmdbId}` === identity,
      );
      if (!reachable) unreachable.push(normalised);
    }

    expect(unreachable, 'the one-tap correction cannot reach these').toEqual([]);
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
  it('T-AI-039c · omission recovery is measured, and it now clears the floor', () => {
    // ⚠ §9.2 puts this floor at 1.0 and calls it non-negotiable: the OCR leg
    // exists so that a title the vision model drops is not silently lost, and
    // a rate below 1.0 means the second reader is decorative. ~~The corpus does
    // NOT clear it — see KNOWN_SHORTFALLS.omissionRecovery.~~ **The corpus
    // clears it since TASK-198** — see OMISSION_RECOVERY_MEASURED.
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
      OMISSION_RECOVERY_MEASURED,
    );
    // The gate itself, now that it can be one.
    expect(OMISSION_RECOVERY_MEASURED).toBeGreaterThanOrEqual(OMISSION_RECOVERY_FLOOR);
    expect(missed).toEqual([]);
  });
});
