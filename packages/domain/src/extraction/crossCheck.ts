/**
 * The cross-check merge — `specs/ai.md` §2.1c, TASK-056c.
 *
 * **Pure. No I/O, no inference, no clock, no randomness.** Same inputs →
 * byte-identical output, always (`T-AI-034`). This is the heart of ADR-0001
 * Revision 2: it is what lets a non-deterministic primary reader be used at
 * all, by pinning its output against a deterministic second opinion.
 *
 * ⚠ PATH NOTE. `specs/ai.md` §2.1c places this at
 * `apps/api/src/extraction/crossCheck.ts`; `docs/backlog.md` TASK-056c names
 * `packages/domain/src/extraction/crossCheck.ts`. The backlog is the work
 * order, and domain is also the correct home — the function is pure, and both
 * the hybrid extractor and the `StubExtractor` must run THIS merge rather than
 * a copy (`specs/testing.md` §3.1).
 *
 * ⚠ SPEC DEFECT, IMPLEMENTED THE SAFE WAY AND REPORTED
 * ────────────────────────────────────────────────────
 * §2.1c step 2 says an OCR orphan is emitted only if it *"survives the §3.2
 * length/chrome/digit gates"*. **§3.2 has no survive semantics.** It is a
 * CLASSIFIER, not a filter: it assigns `chrome-suspected` and states in terms
 * that *"verdicts are flags on a visible candidate, not exclusions"*, and
 * `docs/backlog.md` TASK-057 owns applying it — *"grouping and chrome rules
 * apply to `ocr-only` items only"*. Filtering here would therefore:
 *
 *   1. **silently drop candidates at stage 1**, which is precisely what stage
 *      2's governing rule forbids, and
 *   2. **defeat the guarantee this step exists to provide.** Orphan recovery
 *      is REQ-012 applied to the model itself. A real title that is two
 *      characters long, or literally named *Max*, would be deleted here with
 *      no record — by the one mechanism whose entire purpose is to make sure
 *      the model cannot silently omit a title the OCR leg saw.
 *
 * So **every unconsumed OCR line is emitted**, and `cleanup.ts` (TASK-057)
 * classifies them. Chrome text becomes a `chrome-suspected` candidate in a
 * collapsed group with a one-click "this is a title" — visible and reversible,
 * instead of gone. `T-AI-039` guards it.
 */

import { OCR_BOX_OVERLAP_MIN, OCR_SUPPORT_EXACT, OCR_SUPPORT_PARTIAL } from './thresholds.js';
import { compareExtractedItems } from './degraded.js';
import { jaroWinkler } from './jaroWinkler.js';
import { normaliseTitleText } from '../identity.js';
import type { ExtractedTextItem, LlmTile, NormalisedBox, OcrLine } from './TitleExtractor.js';
import type { OcrSupport } from '../enums.js';

/**
 * Overlap as a fraction of the SMALLER box's area — see
 * {@link OCR_BOX_OVERLAP_MIN} for why this is not IoU.
 *
 * Returns `0` for a degenerate box rather than dividing by zero. A zero-area
 * box corroborates nothing, which is the honest answer; `NaN` would compare
 * false against every threshold and merely *look* like that answer.
 */
export function boxOverlapRatio(a: NormalisedBox, b: NormalisedBox): number {
  const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (overlapW <= 0 || overlapH <= 0) return 0;

  const smaller = Math.min(a.w * a.h, b.w * b.h);
  if (smaller <= 0) return 0;

  return (overlapW * overlapH) / smaller;
}

function supportFor(score: number): OcrSupport {
  if (score >= OCR_SUPPORT_EXACT) return 'exact';
  if (score >= OCR_SUPPORT_PARTIAL) return 'partial';
  return 'none';
}

/**
 * Merge the two readers' output into stage-1 items.
 *
 * @param llm tiles from the primary reader
 * @param ocr lines from the deterministic cross-check reader
 */
export function crossCheck(llm: readonly LlmTile[], ocr: readonly OcrLine[]): ExtractedTextItem[] {
  const normalisedOcr = ocr.map((line) => ({
    line,
    normalised: normaliseTitleText(line.text),
  }));

  // "Consumed" means "counted as corroboration for some tile". A line may
  // corroborate more than one tile — two tiles genuinely can overlap one
  // caption — so this is a set of lines NOT to re-emit as orphans, not a
  // one-to-one assignment.
  const consumed = new Set<number>();
  const items: ExtractedTextItem[] = [];

  for (const tile of llm) {
    // ⚠ `visibleText ?? identifiedTitle`, in that order, per §2.1c step 1.
    // Printed glyphs are what OCR can possibly corroborate; an artwork-derived
    // identification is by definition text that is NOT printed on the tile, so
    // scoring OCR against it would report 'none' for a correct read and
    // 'exact' only by coincidence.
    const subject = normaliseTitleText(tile.visibleText ?? tile.identifiedTitle ?? '');

    let bestScore = 0;
    let bestIndex = -1;

    for (const [index, entry] of normalisedOcr.entries()) {
      // Geometry scope FIRST: a coincidental text match elsewhere on the
      // screen must not corroborate this tile (§2.1c step 1).
      if (boxOverlapRatio(tile.box, entry.line.box) < OCR_BOX_OVERLAP_MIN) continue;

      // An overlapping line always counts as consumed, even if it scores
      // badly. It is the caption of THIS tile; re-emitting it as an orphan
      // would duplicate the tile as a second, text-only candidate.
      consumed.add(index);

      if (subject === '' || entry.normalised === '') continue;

      const score = subject === entry.normalised ? 1 : jaroWinkler(subject, entry.normalised);
      // Strictly greater: the FIRST best-scoring line wins, so the result does
      // not depend on the reader's arbitrary line order.
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    const ocrSupport = supportFor(bestScore);
    const corroborating = ocrSupport === 'none' ? undefined : normalisedOcr[bestIndex]?.line;

    items.push({
      rawText: tile.visibleText ?? '',
      inferredTitle: tile.identifiedTitle,
      basis: tile.basis,
      ocrSupport,
      provider: 'llm',
      // §2.1c step 3 — where OCR corroborated, ITS box wins. The model's
      // geometry is approximate; OCR's is measured. The thumbnail shown beside
      // an `inferred-unverified` candidate (`T-AI-041`) is cropped from this,
      // so a sloppy box is a visible product defect, not a detail.
      boundingBox: corroborating ? { ...corroborating.box } : { ...tile.box },
      boxSource: corroborating ? 'ocr' : 'llm',
      confidence: tile.confidence,
    });
  }

  // Step 2 — orphan recovery. See the header: NO GATES ARE APPLIED HERE.
  for (const [index, entry] of normalisedOcr.entries()) {
    if (consumed.has(index)) continue;
    items.push({
      rawText: entry.line.text,
      // OCR identifies nothing; it reports glyphs. Populating this from `text`
      // would manufacture an identification the product never made.
      inferredTitle: null,
      basis: 'text',
      // 'exact', not 'none': the text IS the OCR reading, so it trivially
      // corroborates itself. Matches `ocrOnlyItems()` in degraded.ts.
      ocrSupport: 'exact',
      provider: 'ocr-only',
      boundingBox: { ...entry.line.box },
      boxSource: 'ocr',
      confidence: entry.line.confidence,
    });
  }

  // Step 4 — a TOTAL order, so the merge is reproducible. The shared
  // comparator, never a local one (`degraded.ts`).
  return items.sort(compareExtractedItems);
}
