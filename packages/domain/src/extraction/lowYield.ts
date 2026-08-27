/**
 * `specs/ai.md` §8.1 — the low-yield detector.
 *
 * ⚠ THIS EXISTS BECAUSE THE FLAG WAS UNREACHABLE. `uploadBatch.lowYield` was
 * modelled, persisted, read by `buildReviewResponse` and asserted by
 * `T-AI-021` — but nothing anywhere ever set it to `true`. Every one of those
 * tests passed against a flag production could not raise, so the low-yield
 * withholding path was dead code in the only environment that matters. That is
 * the shape of defect NFR-003 exists to catch, and it survived precisely
 * because the *behaviour given the flag* was well tested while the *flag
 * itself* had no owner.
 *
 * ⚠ WITHHOLDING IS THE SAFE DIRECTION, so every ambiguity here resolves
 * TOWARDS `true`. A batch that read nothing must never be allowed to conclude
 * the owner deleted everything (product invariant 2).
 */

/**
 * The share of processed images that may yield nothing before the batch is
 * considered too thin to reason about removals from (`specs/ai.md` §8.1).
 *
 * ⚠ `>=`, not `>`. Half the screenshots coming back empty is already the
 * condition; the spec's constant is the threshold, not the first value past it.
 */
export const ZERO_YIELD_IMAGE_RATIO = 0.5;

export interface LowYieldInput {
  /**
   * Candidates surviving stage 2 (`cleanup`). ⚠ Stage 2 MERGES fragments and
   * labels chrome, it never drops a row, so this is zero exactly when the
   * readers produced nothing at all.
   */
  readonly candidatesAfterCleanup: number;
  /** Images that completed a read. Excludes any lost to a memory failure. */
  readonly imagesProcessed: number;
  readonly imagesWithZeroCandidates: number;
}

/**
 * Is this batch too thin a read to reason about removals from?
 *
 * ⚠ `imagesProcessed === 0` IS LOW YIELD, and the naive transcription of
 * §8.1 gets this wrong. `0 / 0` is `NaN`, and `NaN >= 0.5` is `false` — so a
 * batch that processed no images at all would be declared healthy by the ratio
 * arm and would fall through to propose removing the owner's entire list. The
 * guard is written before the division rather than relying on the
 * `candidatesAfterCleanup === 0` arm to cover it, because that coupling is
 * invisible and a later edit to either arm would silently break it.
 */
export function isLowYield(input: LowYieldInput): boolean {
  if (input.imagesProcessed <= 0) return true;
  if (input.candidatesAfterCleanup <= 0) return true;
  return input.imagesWithZeroCandidates / input.imagesProcessed >= ZERO_YIELD_IMAGE_RATIO;
}
