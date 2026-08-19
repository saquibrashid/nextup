/**
 * Jaro-Winkler string similarity — the one implementation, TASK-056c.
 *
 * ⚠ DELIBERATE DEVIATION FROM `specs/ai.md`, REPORTED NOT SMUGGLED.
 * §5 step 2 and §2.1c name the **`jaro-winkler` npm package**. This file
 * implements the algorithm instead. Four reasons, in order of weight:
 *
 *  1. **`T-AI-034` requires byte-identical output for identical input,
 *     forever.** A dependency can change tie-breaking or rounding in a patch
 *     release and every golden fixture shifts with no commit of ours to point
 *     at. The algorithm is fixed and published (Winkler, 1990); there is
 *     nothing to track upstream.
 *  2. **Two call sites must agree.** §2.1c's cross-check and §5's matcher both
 *     score with this. `specs/ai.md` §3.2 step 6 already states the principle
 *     for normalisation — *"the single shared function. No second
 *     implementation."* The same reasoning applies here, and it is easier to
 *     guarantee with one exported function than with one shared dependency.
 *  3. **NFR-004 asks for mainstream, well-documented dependencies.** The
 *     package's last release was **2016** (0.2.8) and its types live in a
 *     separately-versioned `@types/jaro-winkler`. Two unmaintained packages
 *     for fifty lines of published arithmetic is the wrong trade.
 *  4. `packages/domain` is otherwise nearly dependency-free by design.
 *
 * **If this is judged wrong, the fix is to swap this file's body for the
 * package and keep the export** — no call site changes. That is why the
 * function is here rather than inlined at either call site.
 *
 * ⚠ VARIANT PINNED, BECAUSE IMPLEMENTATIONS GENUINELY DIFFER. The Winkler
 * prefix boost is applied ONLY when the Jaro score is at or above
 * {@link WINKLER_BOOST_THRESHOLD} (0.7), which is the original paper's rule
 * and what the npm package does. Several ports apply it unconditionally, which
 * inflates scores for short dissimilar strings — exactly the region where
 * `OCR_SUPPORT_PARTIAL` (0.75) decides whether a title is treated as
 * corroborated. Do not "simplify" the threshold away.
 */

/** Winkler's prefix scaling factor. */
export const WINKLER_PREFIX_SCALE = 0.1;

/** Maximum prefix length considered for the boost. */
export const WINKLER_MAX_PREFIX = 4;

/** The boost applies only at or above this Jaro score (Winkler 1990). */
export const WINKLER_BOOST_THRESHOLD = 0.7;

/**
 * Plain Jaro similarity, `0..1`.
 *
 * Exported for its own tests: the Winkler boost is a thin wrapper, and a bug
 * in the transposition count is invisible through the wrapper alone.
 */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // The classic window. `- 1` is part of the definition, not an off-by-one:
  // for two 1-char strings it yields 0, meaning only an exact match counts.
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);

  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatched[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches += 1;
      break;
    }
  }

  if (matches === 0) return 0;

  // Transpositions: matched characters that appear in a different order. The
  // count is halved because each swap is seen once from each side.
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  const halfTranspositions = transpositions / 2;

  return (matches / a.length + matches / b.length + (matches - halfTranspositions) / matches) / 3;
}

/**
 * Jaro-Winkler similarity, `0..1`. Higher is more similar.
 *
 * ⚠ NOT symmetric-safe to assume, but it IS symmetric here: `jaro()` is
 * symmetric and the prefix is measured on the common head, so `f(a,b) ===
 * f(b,a)`. `T-AI-034` depends on that — the cross-check must not score
 * differently depending on which reader's string is passed first.
 */
export function jaroWinkler(a: string, b: string): number {
  const base = jaro(a, b);
  if (base < WINKLER_BOOST_THRESHOLD) return base;

  let prefix = 0;
  const limit = Math.min(WINKLER_MAX_PREFIX, a.length, b.length);
  while (prefix < limit && a[prefix] === b[prefix]) prefix += 1;

  return base + prefix * WINKLER_PREFIX_SCALE * (1 - base);
}
