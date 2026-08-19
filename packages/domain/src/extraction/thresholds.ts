/**
 * The cross-check thresholds — `specs/ai.md` §7, TASK-056c.
 *
 * ⚠ PATH NOTE, AND IT IS NOT COSMETIC. §7 lists every threshold in
 * `apps/api/src/config.ts`. These three are DEFINED HERE instead, because
 * `crossCheck()` lives in `packages/domain` (`docs/backlog.md` TASK-056c is
 * the work order) and a pure domain package cannot import from `apps/api` —
 * the dependency runs the other way. `apps/api/src/config.ts` RE-EXPORTS them,
 * so §7's promise ("every threshold in one place") still holds for anyone
 * looking there, and there is still exactly ONE definition.
 *
 * ⚠ `T-AI-019` greps the cross-check module for numeric literals. That gate is
 * why these are named constants rather than numbers at the comparison site,
 * and why a future threshold belongs here rather than inline.
 */

/** Best geometry-scoped score at or above this → `ocrSupport: 'exact'`. */
export const OCR_SUPPORT_EXACT = 0.95;

/** Best geometry-scoped score at or above this → `ocrSupport: 'partial'`. */
export const OCR_SUPPORT_PARTIAL = 0.75;

/**
 * Minimum box overlap, as a fraction of the SMALLER box's area, for an OCR
 * line to be considered as corroboration for a tile.
 *
 * ⚠ "Of the smaller area" is the whole point of the rule. A caption line is
 * tiny next to the tile it belongs to, so intersection-over-union would be
 * near zero for a perfect corroboration and the geometry scope would reject
 * exactly the pairs it exists to accept.
 */
export const OCR_BOX_OVERLAP_MIN = 0.2;

/**
 * Provider confidence below this → `cleanupVerdict: 'low-confidence'`
 * (`specs/ai.md` §3.2 step 7, §7).
 *
 * ⚠ A FLAG ON A VISIBLE CANDIDATE, NEVER AN EXCLUSION (§3.1). Nothing below
 * this floor is dropped, hidden or withheld from matching — it is shown in the
 * main review list carrying a "low confidence — check this" caution. Using it
 * as a filter would make a heuristic silently delete real titles, which is the
 * single failure class this product exists to avoid.
 */
export const EXTRACT_CONFIDENCE_FLOOR = 0.55;
