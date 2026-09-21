import { describe, expect, it } from 'vitest';

import {
  PRICED_MODEL_ID,
  USD_PER_1M_COMPLETION_TOKENS,
  USD_PER_1M_PROMPT_TOKENS,
  costReportLines,
  estimateCostUsd,
} from './liveCost.js';

/**
 * T-AI-056 · the L7 cost line names whose price card it used.
 *
 * ⚠ **THE DEFECT THIS EXISTS FOR ALREADY MISLED A DECISION.** The §4A report
 * rendered "Estimated cost: **$0.3783** at $2.00/1M prompt and $8.00/1M
 * completion" for the `gpt-6-astra` probe. Those rates are `gpt-4.1`'s, and
 * nothing in the file said so — the only record was a source comment nobody
 * reading the committed report could see. Set beside the incumbent's $0.2024
 * it reads as "the frontier model costs 1.9x", which is false: it is the same
 * prices applied to more tokens, and the real multiple is unmeasured and has
 * been estimated far higher elsewhere in this project. A model choice was
 * being weighed against that number.
 *
 * ⚠ **THE FIX IS NOT TO PRICE EACH ARM, AND THIS SUITE MUST NOT BE READ AS
 * ASKING FOR THAT.** L7's ceiling is a regression guard on prompt and token
 * GROWTH; holding one price card fixed across arms is what makes two reports
 * comparable on token volume, which is the only thing the guard can see.
 * Re-pricing per arm would silently convert a token-growth alarm into a
 * billing estimate and destroy the comparison. So the price card stays fixed
 * and the report is made to *say* it is fixed — `c` and `d` below pin that
 * choice, not merely the wording.
 *
 * ⚠ **LIMIT.** These cases exercise the rendering, not the live run. The §4A
 * suite is excluded from every CI project because it calls a paid API, so
 * nothing asserts here that `reportMarkdown` actually calls this helper with
 * the measured arm's deployment; that wiring is covered only by the type
 * checker. The rendering was extracted into `liveCost.ts` precisely so that
 * at least this much runs in CI (`T-CI-008` — an uncollected spec passes by
 * never executing).
 */
describe('T-AI-056 · §4A L7 the cost line is honest about its price card', () => {
  const tokens = { promptTokens: 100_000, completionTokens: 10_000 } as const;

  it('T-AI-056a · names the priced model on the incumbent arm', () => {
    const lines = costReportLines({ ...tokens, cost: 0.28, deployment: PRICED_MODEL_ID });
    const text = lines.join('\n');
    expect(text).toContain(`\`${PRICED_MODEL_ID}\` list price`);
    // No warning: on the incumbent the card and the arm are the same model,
    // and a warning that fires always is a warning nobody reads.
    expect(text).not.toContain("NOT THIS ARM'S COST");
  });

  it('T-AI-056b · warns loudly when the measured arm is not the priced model', () => {
    const lines = costReportLines({ ...tokens, cost: 0.3783, deployment: 'gpt-6-astra' });
    const text = lines.join('\n');
    expect(text).toContain("NOT THIS ARM'S COST");
    // Both models named, so the reader can see exactly which mismatch it is
    // rather than being told only that one exists.
    expect(text).toContain('`gpt-6-astra`');
    expect(text).toContain(`\`${PRICED_MODEL_ID}\``);
    // The specific misreading is named, because "may be inaccurate" would not
    // have stopped the 1.9x comparison that actually happened.
    expect(text).toContain('token-volume signal');
    expect(text.toLowerCase()).toContain('do not compare it against the incumbent');
  });

  it('T-AI-056c · prices every arm from the same card', () => {
    // The equality IS the guard. If a future change prices each arm
    // separately, L7 stops comparing token volume between reports and this
    // fails — see the header.
    const incumbent = costReportLines({ ...tokens, cost: 0.28, deployment: PRICED_MODEL_ID });
    const challenger = costReportLines({ ...tokens, cost: 0.28, deployment: 'gpt-6-astra' });
    const rate = (lines: readonly string[]): string | undefined =>
      lines.find((l) => l.startsWith('- Estimated cost:'));
    expect(rate(incumbent)).toBeDefined();
    expect(rate(challenger)).toBe(rate(incumbent));
  });

  it('T-AI-056d · the estimate uses the named rates and both token classes', () => {
    // Pinned against a hand-computed value rather than a re-expression of the
    // formula, so a swapped prompt/completion rate cannot pass by symmetry.
    expect(estimateCostUsd(1_000_000, 0)).toBeCloseTo(USD_PER_1M_PROMPT_TOKENS, 10);
    expect(estimateCostUsd(0, 1_000_000)).toBeCloseTo(USD_PER_1M_COMPLETION_TOKENS, 10);
    expect(estimateCostUsd(500_000, 250_000)).toBeCloseTo(3.0, 10);
  });

  it('T-AI-056e · reports both token counts alongside the money', () => {
    // The tokens are the real signal; the dollars are a scaling of them. A
    // report that dropped the counts would leave only the number that needs a
    // caveat to interpret.
    const text = costReportLines({ ...tokens, cost: 0.28, deployment: PRICED_MODEL_ID }).join('\n');
    expect(text).toContain('- Prompt tokens: 100000');
    expect(text).toContain('- Completion tokens: 10000');
  });
});
