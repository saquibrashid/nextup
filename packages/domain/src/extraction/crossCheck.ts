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

import {
  OCR_BOX_OVERLAP_MIN,
  OCR_LINE_STACK_GAP_MAX,
  OCR_SUPPORT_EXACT,
  OCR_SUPPORT_PARTIAL,
} from './thresholds.js';
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

/** Normalised text with its spaces removed, so a word-split difference between the two readers stops mattering. */
function squash(normalised: string): string {
  return normalised.replace(/ /g, '');
}

/**
 * Do these two OCR boxes read as consecutive lines of ONE stacked caption?
 *
 * Vertically within {@link OCR_LINE_STACK_GAP_MAX} line-heights of each other
 * and horizontally overlapping at all. Both conditions are needed: a caption
 * two rows down the grid is vertically distant, and a caption in the next
 * column is horizontally disjoint.
 */
function stacked(a: NormalisedBox, b: NormalisedBox): boolean {
  if (Math.min(a.x + a.w, b.x + b.w) <= Math.max(a.x, b.x)) return false;
  const gap = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
  return gap <= Math.max(a.h, b.h) * OCR_LINE_STACK_GAP_MAX;
}

/**
 * Every contiguous run of words in `normalised`, squashed.
 *
 * ⚠ RUNS OF WHOLE WORDS, NOT ARBITRARY SUBSTRINGS, AND THAT IS PART OF THE
 * SAFETY PROPERTY. A raw substring test would absorb an OCR line reading `UP`
 * — a real, short, real-world title — into a neighbouring tile captioned
 * `UPLOAD`. No run of `UPLOAD`'s words joins to `UP`, so the word-run form
 * cannot. Because the runs are squashed it still matches `THE XFILES` against
 * a tile the model transcribed as `THE X FILES I WANT TO BELIEVE`, which is
 * the case where the two readers disagree only about where a space goes.
 */
function transcribedWordRuns(normalised: string): Set<string> {
  const words = normalised.split(' ').filter((word) => word !== '');
  const runs = new Set<string>();
  for (let start = 0; start < words.length; start += 1) {
    let run = '';
    for (let end = start; end < words.length; end += 1) {
      run += words[end] ?? '';
      runs.add(run);
    }
  }
  return runs;
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

  /*
   * ⚠ WHAT THE MODEL ALREADY TRANSCRIBED, INDEPENDENT OF WHERE IT SAID IT WAS
   *   (TASK-290, from the owner's Disney+ capture).
   *
   * Consumption above is geometry-first, and geometry is the model's weakest
   * output. On that capture the model emitted a plainly synthetic uniform grid
   * of tile boxes — x correct, y shifted down and stretched — so it had ZERO
   * vertical overlap with the caption lines OCR had measured. Not one line was
   * consumed, and every fragment of captions the model had ALREADY READ came
   * back as its own review row: `GOOD LUCK`, `HAVE FUN`, `DEVIL`, `WEARS`,
   * `PRADA`, `THE`, `THE XFILES`. The owner saw one film split into three, and
   * correcting two of those fragments onto one work is what then made the
   * batch fail to apply.
   *
   * Orphan recovery exists to catch what the model OMITTED (REQ-012 applied to
   * the model itself — see the header). If the line's glyphs already appear in
   * glyphs the model transcribed, nothing was omitted, so there is nothing to
   * recover and emitting it can only duplicate. That argument is about TEXT,
   * so the rule is about text and asks nothing of the boxes.
   *
   * ⚠ ONLY TILES THAT ACTUALLY READ GLYPHS CONTRIBUTE. An `artwork` basis is
   * the model saying on the record that it did NOT read the printed caption,
   * so its `identifiedTitle` is not evidence about glyphs and must not consume
   * one — the same reasoning that narrows the geometric rule below.
   *
   * ⚠ KNOWN, ACCEPTED LOSS. A title the model MISSED ENTIRELY whose whole name
   * is also a word-run of a neighbouring caption — `Chuck` beside a tile
   * captioned `The Life of Chuck` — is absorbed here. It needs both failures at
   * once, and the review screen's "Add a title the reader missed" control is
   * the recovery path. The duplicate flood this replaces made the review screen
   * unusable on the owner's first real capture.
   */
  const transcribedRuns: Set<string>[] = [];
  for (const tile of llm) {
    transcribedRuns.push(
      tile.basis === 'artwork'
        ? new Set<string>()
        : transcribedWordRuns(normaliseTitleText(tile.visibleText ?? '')),
    );
  }

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

      // ⚠ GEOMETRY ALONE USED TO CONSUME, AND THAT DESTROYED THE CORRECTION
      // THIS STEP EXISTS TO SUPPLY (REQ-012, TASK-079 finding 1).
      //
      // On a desktop capture the caption sits UNDER the artwork, inside the
      // tile box, so it overlaps. When the model reads the logo baked into the
      // artwork instead of the printed caption — `wwe raw` for a tile captioned
      // `Raw` — the caption overlapped, was consumed on geometry, and was never
      // emitted. The one line that contradicted the model was deleted BY the
      // model's own tile, silently, at stage 1. ~~Both `Raw` losses in
      // `T-AI-039c` are this.~~ ⚠ **THEY ARE NOT — SEE TASK-198.** Those two
      // losses were attributed here, then to the matcher, and were finally
      // neither: the `Raw` line survives consumption intact, and the title was
      // lost in stage 2 because §3.1a preferred an `identifiedTitle` of
      // `WWE Raw` over glyphs both legs read as `RAW`. §3.1a R2 fixed it and
      // nothing in this module changed. The failure mode described above is
      // still real and still what this rule guards; it simply never had a
      // demonstrated instance in the golden corpus.
      //
      // ⚠ THE RULE IS NARROWED TO `basis: 'artwork'` ON PURPOSE, AND THE WIDE
      // VERSION WAS MEASURED BEFORE IT WAS REJECTED. Requiring agreement from
      // EVERY overlapping line — the fix as first written down in TASK-079 —
      // takes the golden false-title rate from 0.2500 to 0.4803 while moving
      // recall and omission recovery not at all: a caption that OCR splits
      // across two lines, an episode badge, a runtime, a "New episodes" flash
      // all disagree with the tile subject and would each become a candidate
      // the owner has to dismiss. That is a worse product, bought with no
      // recovery.
      //
      // An **artwork** basis is the one case where the model is on record as
      // NOT having read the printed glyphs. There, an overlapping line that
      // disagrees is the only reading of the caption anyone has, so it survives
      // as an orphan — visible, classified by `cleanup.ts`, reversible — which
      // is this module's governing rule (see the header), not an exception.
      const artworkDerived = tile.basis === 'artwork';
      if (subject === '' || entry.normalised === '') {
        // Nothing to agree or disagree with. Geometry is the only evidence
        // there is, so it still decides — withholding consumption here would
        // duplicate a caption the model simply did not transcribe, without any
        // contradiction to justify the duplicate.
        consumed.add(index);
        continue;
      }

      const score = subject === entry.normalised ? 1 : jaroWinkler(subject, entry.normalised);
      if (!artworkDerived || score >= OCR_SUPPORT_PARTIAL) consumed.add(index);

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

  // Step 1b — TEXT-CONTAINMENT CONSUMPTION, which deliberately has no
  // geometry condition ON THE MODEL'S BOXES. See the block comment above.
  const absorbedByStack: { index: number; tile: number }[] = [];
  for (const [index, entry] of normalisedOcr.entries()) {
    if (consumed.has(index)) continue;
    const text = squash(entry.normalised);
    if (text === '') continue;

    const absorbed = transcribedRuns.findIndex(
      (runs) =>
        runs.has(text) &&
        // ⚠ THE SIBLING CONDITION, AND WITHOUT IT THIS RULE DELETES REAL
        //   TITLES — measured, not feared.
        //
        // A word-run match alone absorbed `True Detective` in
        // `max-saved-desktop-01`, where the owner has saved BOTH that and
        // `True Detective: Night Country`. The shorter title is a word-run of
        // the longer one, the model missed its tile entirely, and the OCR line
        // that was its only recovery was eaten by its own sequel. Golden
        // recall fell to 0.9403, under the §9.2 floor. Franchise and
        // season naming makes that shape ordinary in a watchlist, not exotic.
        //
        // The ONLY thing this step exists to undo is OCR splitting one caption
        // across several lines, so it now requires evidence that a split
        // happened: another unconsumed line, holding a DIFFERENT part of the
        // SAME transcription, stacked directly against this one. Fragments of
        // one caption are consecutive lines; a shorter title elsewhere on the
        // grid has no such neighbour and survives.
        normalisedOcr.some((other, otherIndex) => {
          if (otherIndex === index || consumed.has(otherIndex)) return false;
          const otherText = squash(other.normalised);
          if (otherText === '' || otherText === text || !runs.has(otherText)) return false;
          return stacked(entry.line.box, other.line.box);
        }),
    );
    if (absorbed !== -1) absorbedByStack.push({ index, tile: absorbed });
  }
  /*
   * ⚠ DECIDED AGAINST THE SNAPSHOT, APPLIED AFTERWARDS. Consuming inside the
   * loop would let the two halves of one split cancel each other: `GOOD LUCK`
   * is absorbed on the evidence of `HAVE FUN`, and `HAVE FUN` then finds its
   * only sibling already consumed and survives as an orphan — the very
   * duplicate this step removes, kept by the removal of its twin, and
   * dependent on the reader's arbitrary line order.
   */
  for (const { index } of absorbedByStack) consumed.add(index);

  /*
   * ⚠ AN ABSORBED FRAGMENT IS CORROBORATION, AND MUST BE RECORDED AS SUCH.
   *
   * Consuming a line silently would leave the tile at `ocrSupport: 'none'`,
   * and `cleanup.ts` step 7a turns that into `inferred-unverified` — the
   * fabrication mitigation, which obliges the owner to check a thumbnail
   * before the title can be used (RSK-028, `T-AI-041`). That verdict would
   * then be reached for a title BOTH readers read correctly, purely because
   * the model misplaced its boxes. It is the wrong claim about the evidence
   * and it is pure added review work — measured on the golden corpus, where
   * the `Stranger Things: VHS Special Edition` row in two images flipped to
   * `inferred-unverified` until this block was added.
   *
   * The fragments are re-joined in reading order and scored by the same
   * comparison the geometric path uses, so support means one thing in this
   * module and not two.
   */
  const byTile = new Map<number, number[]>();
  for (const { index, tile } of absorbedByStack) {
    const lines = byTile.get(tile);
    if (lines) lines.push(index);
    else byTile.set(tile, [index]);
  }
  for (const [tileIndex, lineIndexes] of byTile) {
    const item = items[tileIndex];
    const tile = llm[tileIndex];
    if (!item || !tile || item.ocrSupport !== 'none') continue;

    const ordered = [...lineIndexes].sort((a, b) => {
      const boxA = normalisedOcr[a]?.line.box;
      const boxB = normalisedOcr[b]?.line.box;
      if (!boxA || !boxB) return a - b;
      return boxA.y !== boxB.y ? boxA.y - boxB.y : boxA.x - boxB.x;
    });
    const subject = squash(normaliseTitleText(tile.visibleText ?? ''));
    const joined = ordered.map((i) => squash(normalisedOcr[i]?.normalised ?? '')).join('');
    const score = subject === joined ? 1 : jaroWinkler(subject, joined);
    const support = supportFor(score);
    if (support === 'none') continue;

    item.ocrSupport = support;
    // The same rule as the geometric path: where OCR corroborated, ITS
    // measured geometry wins over the model's estimate. The union of the
    // fragments is the caption, so it is the box the caption was read from.
    item.boundingBox =
      ordered.reduce<NormalisedBox | null>((acc, i) => {
        const box = normalisedOcr[i]?.line.box;
        if (!box) return acc;
        if (!acc) return { ...box };
        const x = Math.min(acc.x, box.x);
        const y = Math.min(acc.y, box.y);
        return {
          x,
          y,
          w: Math.max(acc.x + acc.w, box.x + box.w) - x,
          h: Math.max(acc.y + acc.h, box.y + box.h) - y,
        };
      }, null) ?? item.boundingBox;
    item.boxSource = 'ocr';
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
