/**
 * `T-AI-045` — the primary-reader bake-off protocol, enforced as structure.
 * `specs/ai.md` §9.7, `specs/testing.md` §11, TASK-168.
 *
 * ⚠ SCOPE OF THIS FILE — PHASE 1, AND WHAT IT DELIBERATELY DOES NOT ASSERT.
 * `T-AI-045` names six claims, `a`–`f`. Three of them are properties of the
 * bake-off HARNESS and its recordings:
 *
 *   a — both arms differ only in deployment name
 *   b — both arms score against the same `expected/` and the same `ocr/`
 *   c — `llm/` recordings are model-scoped, so recording a challenger cannot
 *       overwrite the incumbent's evidence
 *
 * They cannot be asserted yet and are NOT stubbed here. The harness scores
 * against the 12-image corpus of §9.1 — `tests/fixtures/golden/` currently
 * holds five owner screenshots and no `expected/`, `ocr/`, `llm/` or
 * `manifest.json` (TASK-078, `todo`), and the scorer that computes these
 * metrics is TASK-079, also `todo`. A test written against fixtures that do
 * not exist would either fail for the wrong reason or, far worse, pass
 * vacuously by iterating an empty directory — and `a`/`b`/`c` are exactly the
 * claims whose violation is silent and irreversible.
 *
 * What IS asserted here is the half §9.7 insists must be merged BEFORE any
 * numbers exist: the pre-committed decision rule (`d`), the noise band (`e`),
 * and the no-CI guarantee (`f`). Deferring `a`–`c` is recorded in the report
 * for TASK-168 rather than hidden behind a `skip`.
 *
 * ⚠ ID ALLOCATION. `T-META-004` allows one lowercase letter per spec id, and
 * `specs/testing.md` has already spent `a`–`f` on the six claims. The three
 * claims delivered here need more than one case each, so `T-AI-045d`, `e` and
 * `f` carry the CANONICAL assertion for their claim and the supporting cases
 * take `g` onwards — each naming its claim in the title, so a red test still
 * points at exactly one acceptance criterion.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BAKEOFF_CORPUS_IMAGES,
  chooseReader,
  MIN_MEANINGFUL_TITLE_DELTA,
  REQUIRED_CAPABILITIES,
  type BakeoffInput,
  type ReaderCapabilities,
  type ReaderMetrics,
} from '../src/extraction/chooseReader.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const ALL_CAPABILITIES: ReaderCapabilities = {
  vision: true,
  strictStructuredOutputs: true,
  temperatureZero: true,
  seed: true,
  availableInRegion: true,
};

/**
 * The incumbent, `gpt-4.1`, scoring comfortably above every §9.7 floor.
 *
 * Deliberately NOT at the floor: if the baseline sat exactly on 0.95 recall
 * then every challenger regression would also be a floor breach, and the
 * "worse than the incumbent but still above the floor" path — the one that
 * actually decides mixed results — would never be exercised.
 */
const INCUMBENT: ReaderMetrics = {
  modelId: 'gpt-4.1',
  omissionRecovery: 1,
  fabricationRate: 0.02,
  titleRecall: 0.97,
  artworkOnlyRecall: 0.86,
  falseTitleRate: 0.04,
  chromeRejection: 0.9,
  stabilityJaccard: 0.98,
  costUsdPerImage: 0.0094,
};

/** 12 images, ~120 expected titles: one title is ~0.0083 of aggregate recall. */
const EXPECTED_TITLE_TOTAL = 120;

/** A delta guaranteed to clear the two-title band on a 120-title corpus. */
const MEASURABLE = (MIN_MEANINGFUL_TITLE_DELTA + 1) / EXPECTED_TITLE_TOTAL;
/** A delta guaranteed to fall inside it. */
const NOISE = (MIN_MEANINGFUL_TITLE_DELTA - 1) / EXPECTED_TITLE_TOTAL;

function challenger(overrides: Partial<ReaderMetrics> = {}): ReaderMetrics {
  return { ...INCUMBENT, modelId: 'gpt-5.4-mini', ...overrides };
}

function input(overrides: Partial<BakeoffInput> = {}): BakeoffInput {
  return {
    incumbent: INCUMBENT,
    challenger: challenger(),
    challengerCapabilities: ALL_CAPABILITIES,
    expectedTitleTotal: EXPECTED_TITLE_TOTAL,
    corpusImages: BAKEOFF_CORPUS_IMAGES,
    ...overrides,
  };
}

describe('T-AI-045d · the decision function is pure, total, and defaults to the incumbent', () => {
  it('T-AI-045g · claim d · a challenger that wins measurably on every row and fails none is adopted', () => {
    // NON-VACUITY. Without this, every "the incumbent stays" assertion below
    // would also pass against a function that returns the incumbent
    // unconditionally — which is the single most likely way this rule breaks.
    const decision = chooseReader(
      input({
        challenger: challenger({
          titleRecall: INCUMBENT.titleRecall + MEASURABLE,
          artworkOnlyRecall: INCUMBENT.artworkOnlyRecall + MEASURABLE,
        }),
      }),
    );

    expect(decision.outcome).toBe('challenger-adopted');
    expect(decision.primaryReader).toBe('gpt-5.4-mini');
  });

  it('T-AI-045d · claim d · MUTATION — a challenger that is CHEAPER and WORSE does not survive', () => {
    // ⚠ THE CENTRAL CLAIM OF T-AI-045d, AND THE ONE FAILURE THE WHOLE PROTOCOL
    // EXISTS TO PREVENT. `NFR-012a` says quality outranks cost; the erosion
    // path is a challenger that is a little worse and a lot cheaper being
    // waved through on the strength of the saving.
    const decision = chooseReader(
      input({
        challenger: challenger({
          // Still above the 0.95 floor, so ONLY the incumbent comparison can
          // reject it. A floor breach here would prove the wrong thing.
          titleRecall: 0.96,
          costUsdPerImage: INCUMBENT.costUsdPerImage / 20,
        }),
      }),
    );

    expect(decision.outcome).toBe('incumbent-stays');
    expect(decision.primaryReader).toBe('gpt-4.1');
    expect(decision.reasons.join(' ')).toContain('Title recall');
  });

  it('T-AI-045h · claim d · cost NEVER changes the outcome, in either direction', () => {
    // Cost is a tie-breaker only (§9.7 Stage 3). In fact, under the rule as
    // written it can never break anything: the only state in which it could is
    // a full tie, and Stage 4 calls a full tie "no measured difference", which
    // by Stage 3 means the incumbent stays. Asserted as an invariant over a
    // wide range so the property is about the rule, not about one number.
    const outcomes = new Set<string>();
    for (const cost of [0, 1e-9, 0.0001, 0.0094, 0.05, 1, 1000]) {
      const decision = chooseReader(input({ challenger: challenger({ costUsdPerImage: cost }) }));
      outcomes.add(decision.outcome);
      expect(decision.costIsNeverDecisive).toBe(true);
    }
    expect([...outcomes]).toEqual(['no-measured-difference']);
  });

  it('T-AI-045i · claim d · a mixed result — better on one row, worse on another — keeps the incumbent', () => {
    const decision = chooseReader(
      input({
        challenger: challenger({
          artworkOnlyRecall: INCUMBENT.artworkOnlyRecall + MEASURABLE * 4,
          falseTitleRate: INCUMBENT.falseTitleRate + MEASURABLE,
        }),
      }),
    );

    expect(decision.outcome).toBe('incumbent-stays');
    expect(decision.reasons.join(' ')).toContain('False-title rate');
  });

  it('T-AI-045j · claim d · omission recovery is an EQUALITY — 0.999 fails, and so does 1.001', () => {
    // REQ-012 allows no trade, so this row is `=== 1`, not `>= 1`.
    //
    // 0.999 means a title the OCR saw was dropped; in full-update mode that is
    // a removal the owner never approved. It fails on the row itself.
    const below = chooseReader(input({ challenger: challenger({ omissionRecovery: 0.999 }) }));
    expect(below.outcome).toBe('incumbent-stays');
    expect(below.reasons.join(' ')).toContain('Omission recovery');

    // 1.001 recovers more omissions than there were — arithmetically
    // impossible, so it is a SCORER bug, and rate validation rejects it before
    // the row is ever judged. That ordering is deliberate: a `>= 1` floor
    // would have read it as an exceptional pass and adopted on a broken
    // measurement. What matters for REQ-012 is that neither value adopts.
    const above = chooseReader(input({ challenger: challenger({ omissionRecovery: 1.001 }) }));
    expect(above.outcome).toBe('invalid-input');

    for (const decision of [below, above]) {
      expect(decision.primaryReader).toBe('gpt-4.1');
    }
  });

  it('T-AI-045k · claim d · each absolute floor rejects on its own, with no incumbent comparison to hide behind', () => {
    // Every floor is set BELOW the incumbent's score, so these challengers are
    // also worse than the incumbent. The floors are re-asserted against a
    // WEAKER incumbent below, where the comparison cannot be doing the work.
    const breaches: [keyof ReaderMetrics, number][] = [
      ['fabricationRate', 0.06],
      ['titleRecall', 0.94],
      ['artworkOnlyRecall', 0.79],
      ['falseTitleRate', 0.11],
      ['chromeRejection', 0.79],
      ['stabilityJaccard', 0.94],
    ];

    for (const [metric, value] of breaches) {
      const weakIncumbent: ReaderMetrics = { ...INCUMBENT, [metric]: value };
      const decision = chooseReader(
        input({
          incumbent: weakIncumbent,
          challenger: challenger({ [metric]: value }),
        }),
      );
      // Level with the incumbent, so ONLY the floor can reject it.
      expect(decision.outcome, `${metric} floor`).toBe('incumbent-stays');
      expect(decision.reasons.join(' ')).toContain('floor');
    }
  });

  it('T-AI-045l · claim d · chrome rejection has a floor but NO incumbent comparison', () => {
    // §3.1: over-rejecting chrome is worse than under-rejecting, so a
    // challenger that rejects MORE chrome is not thereby better. A challenger
    // BELOW the incumbent but above the floor must not fail on that account.
    const decision = chooseReader(input({ challenger: challenger({ chromeRejection: 0.81 }) }));

    expect(decision.outcome).toBe('no-measured-difference');
    const row = decision.rows.find((r) => r.metric === 'Chrome rejection');
    expect(row?.status).toBe('tied');
  });

  it('T-AI-045m · claim d · Stage 0 disqualifies on any missing capability, with zero images spent', () => {
    for (const capability of REQUIRED_CAPABILITIES) {
      const decision = chooseReader(
        input({
          challengerCapabilities: { ...ALL_CAPABILITIES, [capability]: false },
          // Perfect scores. A quality result must not redeem a contract gap.
          challenger: challenger({
            titleRecall: 1,
            artworkOnlyRecall: 1,
            fabricationRate: 0,
            falseTitleRate: 0,
            chromeRejection: 1,
            stabilityJaccard: 1,
          }),
        }),
      );

      expect(decision.outcome, capability).toBe('challenger-disqualified');
      expect(decision.primaryReader).toBe('gpt-4.1');
      expect(decision.missingCapabilities).toEqual([capability]);
      expect(decision.rows).toEqual([]);
    }
  });

  it('T-AI-045n · claim d · TOTALITY — malformed, hostile and missing input never throws and never adopts', () => {
    // A harness that crashed on a NaN would invite someone to "fix" the input,
    // and an exception's failure direction is whatever the caller's catch
    // block happens to do. Every one of these resolves to the incumbent.
    const hostile: unknown[] = [
      undefined,
      null,
      {},
      input({ challenger: challenger({ titleRecall: Number.NaN }) }),
      input({ challenger: challenger({ titleRecall: Number.POSITIVE_INFINITY }) }),
      input({ challenger: challenger({ titleRecall: -1 }) }),
      input({ challenger: challenger({ titleRecall: 1.5 }) }),
      input({ challenger: challenger({ modelId: '' }) }),
      input({ challenger: challenger({ costUsdPerImage: Number.NaN }) }),
      input({ expectedTitleTotal: 0 }),
      input({ expectedTitleTotal: -5 }),
      input({ expectedTitleTotal: Number.NaN }),
      input({ challengerCapabilities: undefined as unknown as ReaderCapabilities }),
    ];

    for (const [i, candidate] of hostile.entries()) {
      const decision = chooseReader(candidate as BakeoffInput);
      expect(decision.outcome, `case ${String(i)}`).not.toBe('challenger-adopted');
      expect(decision.primaryReader, `case ${String(i)}`).not.toBe('gpt-5.4-mini');
      expect(decision.costIsNeverDecisive).toBe(true);
    }
  });

  it('T-AI-045o · claim d · PURITY — the same input decides the same way, and the input is not mutated', () => {
    const one = input();
    const snapshot = JSON.stringify(one);

    const a = chooseReader(one);
    const b = chooseReader(one);
    const c = chooseReader(structuredClone(one));

    expect(JSON.stringify(one)).toBe(snapshot);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });
});

describe('T-AI-045e · a sub-two-title delta is "no measured difference", not a win', () => {
  it('T-AI-045e · claim e · a challenger better by less than two titles is NOT adopted', () => {
    const decision = chooseReader(
      input({ challenger: challenger({ titleRecall: INCUMBENT.titleRecall + NOISE }) }),
    );

    expect(decision.outcome).toBe('no-measured-difference');
    expect(decision.primaryReader).toBe('gpt-4.1');
    expect(decision.reasons.join(' ')).toContain('no measured difference');

    const row = decision.rows.find((r) => r.metric === 'Title recall (aggregate)');
    expect(row?.status).toBe('better-within-noise');
    expect(row?.deltaTitles).toBeLessThan(MIN_MEANINGFUL_TITLE_DELTA);
  });

  it('T-AI-045p · claim e · the band is the BOUNDARY — exactly two titles is evidence, one is not', () => {
    const at = chooseReader(
      input({
        challenger: challenger({
          titleRecall: INCUMBENT.titleRecall + MIN_MEANINGFUL_TITLE_DELTA / EXPECTED_TITLE_TOTAL,
        }),
      }),
    );
    const below = chooseReader(
      input({
        challenger: challenger({
          titleRecall:
            INCUMBENT.titleRecall + (MIN_MEANINGFUL_TITLE_DELTA - 1) / EXPECTED_TITLE_TOTAL,
        }),
      }),
    );

    expect(at.outcome).toBe('challenger-adopted');
    expect(below.outcome).toBe('no-measured-difference');
  });

  it('T-AI-045q · claim e · the band is measured in TITLES, so it scales with corpus size', () => {
    // ⚠ The same recall delta means a different number of titles on a
    // different corpus. A band expressed as a fixed RATE would silently
    // change meaning with corpus size; §9.7 Stage 4 defines it in titles.
    const delta = 0.02;

    const small = chooseReader(
      input({
        expectedTitleTotal: 50, // 0.02 × 50 = 1 title → noise
        challenger: challenger({ titleRecall: INCUMBENT.titleRecall + delta }),
      }),
    );
    const large = chooseReader(
      input({
        expectedTitleTotal: 500, // 0.02 × 500 = 10 titles → evidence
        challenger: challenger({ titleRecall: INCUMBENT.titleRecall + delta }),
      }),
    );

    expect(small.outcome).toBe('no-measured-difference');
    expect(large.outcome).toBe('challenger-adopted');
  });

  it('T-AI-045r · claim e · the noise band never launders a REGRESSION into a tie', () => {
    // ⚠ The band exists to stop a small difference being read as a WIN. Read
    // symmetrically it would do the opposite of its purpose: a challenger a
    // fraction of a title worse would be called "tied" and could then be
    // adopted on another row. Under uncertainty the incumbent stays.
    const decision = chooseReader(
      input({
        challenger: challenger({
          titleRecall: INCUMBENT.titleRecall - NOISE,
          artworkOnlyRecall: INCUMBENT.artworkOnlyRecall + MEASURABLE * 4,
        }),
      }),
    );

    expect(decision.outcome).toBe('incumbent-stays');
    const row = decision.rows.find((r) => r.metric === 'Title recall (aggregate)');
    expect(row?.status).toBe('worse-than-incumbent');
  });

  it('T-AI-045s · claim e · an off-corpus run is flagged, because the band is sized for 12 images', () => {
    const decision = chooseReader(
      input({
        corpusImages: 3,
        challenger: challenger({ titleRecall: INCUMBENT.titleRecall + MEASURABLE }),
      }),
    );

    expect(decision.reasons.join(' ')).toContain('not the 12');
  });
});

describe('T-AI-045f · the bake-off never runs in CI', () => {
  /** Every workflow file, read as text. */
  function workflowSources(): { file: string; text: string }[] {
    const dir = path.join(REPO_ROOT, '.github', 'workflows');
    return readdirSync(dir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => ({ file: f, text: readFileSync(path.join(dir, f), 'utf8') }));
  }

  it('T-AI-045f · claim f · no workflow references the bake-off script, its recorder or its npm script', () => {
    // ⚠ SAME REASON AS `T-CI-004`, WHICH THIS EXTENDS. The bake-off makes 72
    // real vision calls carrying real screenshots. A well-meaning "let's run
    // the evaluation in CI" would bill the owner on every push and, worse,
    // re-record the baseline the comparison is measured against — and
    // `T-CI-007` forbids egress from the test run outright.
    const forbidden = ['bakeoff', 'bake-off', 'golden:live', 'golden:record'];
    const sources = workflowSources();

    // Non-vacuity: this gate is worthless if it found no workflows to read.
    expect(sources.length).toBeGreaterThan(0);

    const hits: string[] = [];
    for (const { file, text } of sources) {
      const lower = text.toLowerCase();
      for (const token of forbidden) {
        if (lower.includes(token)) hits.push(`${file} references "${token}"`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('T-AI-045t · claim f · the decision rule imports nothing that could reach the network or the clock', () => {
    // Purity enforced at the source, not just observed at the call site: a
    // rule that read a date or a flag could decide differently on a rerun,
    // and the bake-off's whole claim is that its verdict is reproducible.
    const source = readFileSync(
      path.join(REPO_ROOT, 'packages/domain/src/extraction/chooseReader.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/from ['"]node:/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bDate\.now\b|\bnew Date\b/);
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(source).not.toMatch(/process\.env/);
  });
});

describe('T-AI-045a/b/c · deferred — the harness and the corpus do not exist yet', () => {
  it('T-AI-045u · claims a/b/c · the corpus is genuinely absent, so they are deferred rather than passing vacuously', () => {
    // ⚠ THIS TEST GUARDS THE HONESTY OF THIS FILE'S OWN SCOPE NOTE, and it is
    // the reason a/b/c are not written as empty loops over a missing
    // directory. It asserts the STATED REASON for deferral is still true. The
    // moment TASK-078 lands the corpus, this test fails — which is the
    // prompt to come back and write a, b and c for real.
    const golden = path.join(REPO_ROOT, 'tests/fixtures/golden');
    const present = readdirSync(golden).filter((entry) => {
      const full = path.join(golden, entry);
      return statSync(full).isDirectory();
    });

    expect(present).not.toContain('expected');
    expect(present).not.toContain('ocr');
    expect(present).not.toContain('llm');
  });
});
