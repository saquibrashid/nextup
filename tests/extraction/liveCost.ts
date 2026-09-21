/**
 * L7 cost accounting for the §4A live quality suite.
 *
 * ⚠ **WHY THIS IS A MODULE AND NOT PART OF `goldenLive.spec.ts`.** The live
 * suite is excluded from every CI project on purpose — it calls a paid API —
 * so nothing inside it is ever executed by a gate. That is correct for the
 * measurement, and wrong for the *reporting*, because the report is the
 * artifact a model decision is made from months later and a silent defect in
 * it is invisible until it has already misled someone. Pulling the pure part
 * out gives the rendering a home the `golden` project collects, so
 * `T-AI-056` actually runs.
 *
 * See `specs/testing.md` §4A.
 */

/**
 * Azure OpenAI `gpt-4.1` global-standard list price, USD per 1M tokens.
 *
 * ⚠ L7 IS A REGRESSION GUARD ON PROMPT AND TOKEN GROWTH, NOT A BILLING
 * RECONCILIATION. The dollar figure only scales the token counts, so a list
 * price that drifts by a few percent moves the number without changing what
 * the assertion detects — a prompt that doubled, an image detail setting that
 * changed, or a reader that started emitting far more output. The Azure AI
 * Vision leg is the **F0 free tier** (`docs/architecture.md`), so it
 * contributes 0 and is reported as such rather than silently omitted.
 */
export const USD_PER_1M_PROMPT_TOKENS = 2.0;
export const USD_PER_1M_COMPLETION_TOKENS = 8.0;

/**
 * Whose price card the two constants above are.
 *
 * ⚠ **NAMED, NOT ASSUMED.** The prices were documented as `gpt-4.1`'s in a
 * comment and nowhere else, and the rendered report said only "at $2.00/1M
 * prompt" — so a bake-off report for another arm printed a dollar figure that
 * read as that arm's cost and was really the incumbent's rates applied to a
 * different model's tokens. The `gpt-6-astra` probe was read exactly that
 * way: $0.3783 against the incumbent's $0.2024 looks like a 1.9x cost
 * increase, and is in fact the same prices on more tokens, with the true
 * multiple unmeasured and estimated far higher elsewhere in the project.
 *
 * Binding the identity to a constant lets the report state which card it used
 * and warn when that is not the arm being measured. Keeping the price card
 * fixed across arms is deliberate and must stay: L7's ceiling compares token
 * volume between reports, and re-pricing each arm would make two reports
 * incomparable on the one thing the guard exists to see.
 */
export const PRICED_MODEL_ID = 'gpt-4.1';

export function estimateCostUsd(promptTokens: number, completionTokens: number): number {
  return (
    (promptTokens / 1_000_000) * USD_PER_1M_PROMPT_TOKENS +
    (completionTokens / 1_000_000) * USD_PER_1M_COMPLETION_TOKENS
  );
}

/**
 * The L7 section of the report, for `deployment`.
 *
 * Returns markdown lines. When `deployment` is not {@link PRICED_MODEL_ID} the
 * lines carry an explicit warning that the figure is not that arm's cost —
 * see the constant's note for the misreading this prevents.
 */
export function costReportLines(input: {
  readonly cost: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly deployment: string;
}): string[] {
  const lines: string[] = [
    `- Prompt tokens: ${String(input.promptTokens)}`,
    `- Completion tokens: ${String(input.completionTokens)}`,
    `- Estimated cost: **$${input.cost.toFixed(4)}** at ` +
      `$${USD_PER_1M_PROMPT_TOKENS.toFixed(2)}/1M prompt and ` +
      `$${USD_PER_1M_COMPLETION_TOKENS.toFixed(2)}/1M completion ` +
      `(the \`${PRICED_MODEL_ID}\` list price). The Azure AI Vision leg is F0 ` +
      '(free tier) and contributes $0.',
  ];
  if (input.deployment !== PRICED_MODEL_ID) {
    lines.push('');
    lines.push(
      `> ⚠ **NOT THIS ARM'S COST.** The figure above prices \`${input.deployment}\`'s tokens ` +
        `at \`${PRICED_MODEL_ID}\`'s rates, because L7 exists to detect prompt and token ` +
        'growth rather than to reconcile billing. It is comparable with another report ' +
        '**only** as a token-volume signal. Do **not** read it as what ' +
        `\`${input.deployment}\` costs, and do not compare it against the incumbent's ` +
        'report to justify a model change on cost.',
    );
  }
  return lines;
}
