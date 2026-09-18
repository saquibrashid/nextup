/**
 * The tile-boundary guards in `specs/ai.md` §3.2 step 1 (`mergeable`).
 *
 * Test id: `T-AI-052` — "two OCR boxes in DIFFERENT tiles are not merged into
 * one candidate just because their coordinates happen to be close, and the two
 * shapes that legitimately do merge on one line still do."
 *
 * ⚠ WHY THIS EXISTS AS A SEPARATE FILE FROM `captionWrap.spec.ts`. That file
 * guards the VERTICAL axis of step 1 (`wrapsUnder`), and it has had both a
 * non-negative-gap check and a height-comparability check since it was
 * written. `mergeable` — the HORIZONTAL axis, one rung above it in the same
 * function — had neither. The two rungs were written months apart and the
 * second never inherited the first's lessons, which is precisely why the
 * horizontal defect survived four separate rounds of false-title tuning.
 *
 * ⚠ THE COST HERE IS A LOST TITLE, NOT A UGLY ONE. Merging two tiles produces
 * ONE candidate bearing a fused string like `SOL MAN ON FIRE`; the second work
 * is then absent from the review with nothing for the owner to click. It does
 * not appear as a rejected row or a low-confidence row — it is simply gone.
 * That is the same asymmetry `captionWrap.spec.ts` opens with, and it is why
 * every guard below is pinned to geometry measured off a real recording rather
 * than to a number that merely looked safe.
 *
 * ⚠ EVERY BOX BELOW IS COPIED VERBATIM FROM `tests/fixtures/golden/ocr/`. Do
 * not "tidy" the long decimals: each pair was chosen because it isolates ONE
 * guard — it passes the other — so a rounded coordinate can silently move a
 * case onto the wrong side of a threshold and leave the test passing for the
 * wrong reason.
 */

import { describe, expect, it } from 'vitest';

import {
  OCR_MERGE_GAP,
  OCR_MERGE_HEIGHT_RATIO,
  groupReadingOrder,
} from '../src/extraction/index.js';
import type { ExtractedTextItem, NormalisedBox } from '../src/extraction/TitleExtractor.js';

function ocr(rawText: string, boundingBox: NormalisedBox): ExtractedTextItem {
  return {
    rawText,
    inferredTitle: null,
    basis: 'text',
    ocrSupport: 'not-checked',
    provider: 'ocr-only',
    boundingBox,
    boxSource: 'ocr',
    confidence: 0.9,
  };
}

const textsOf = (items: readonly ExtractedTextItem[]): string[] => items.map((i) => i.rawText);

const gapBetween = (left: NormalisedBox, right: NormalisedBox): number =>
  right.x - (left.x + left.w);

const heightRatio = (a: NormalisedBox, b: NormalisedBox): number =>
  Math.min(a.h, b.h) / Math.max(a.h, b.h);

/**
 * `netflix-artwork-only-01`, bottom row. Two artwork words in two different
 * tiles, at similar type size. `SOL` ends at x = 0.546 and `MAN ON FIRE`
 * starts at x = 0.058 — the reading-order sort emits them in this order
 * because `OCR_ROW_BUCKETS` puts them in buckets 32 and 33, so the last item
 * of one row is handed to `mergeable` with the FIRST item of the next.
 */
const SOL = { x: 0.508991008991009, y: 0.8090692124105012, w: 0.03696303696303693, h: 0.04057279236276845 }; // prettier-ignore
const MAN_ON_FIRE = { x: 0.05844155844155844, y: 0.815035799522673, w: 0.10689310689310691, h: 0.0536992840095466 }; // prettier-ignore

/**
 * `netflix-artwork-only-01`, middle row. Genuinely side by side and genuinely
 * close — the gap is +0.0215, comfortably under `OCR_MERGE_GAP` — but `HAMNET`
 * is artwork lettering 2.4x the height of `WHISPER`'s. Nothing about the
 * horizontal spacing separates these; only the type size does.
 */
const WHISPER = { x: 0.4305694305694306, y: 0.4785202863961814, w: 0.06143856143856141, h: 0.023866348448687402 }; // prettier-ignore
const HAMNET = { x: 0.5134865134865135, y: 0.4701670644391408, w: 0.13636363636363635, h: 0.05847255369928406 }; // prettier-ignore

/**
 * `truncated-titles-01`. The ellipsis the UI appends to a clipped title, read
 * as its own box. This is the TIGHTEST legitimate merge in the corpus on the
 * height axis — 0.6786 — and it is what pins `OCR_MERGE_HEIGHT_RATIO` at 0.6
 * rather than anywhere higher.
 */
const HITCHHIKER = { x: 0.5297872340425532, y: 0.8936507936507937, w: 0.3861702127659574, h: 0.022222222222222143 }; // prettier-ignore
const ELLIPSIS = { x: 0.9297872340425531, y: 0.9007936507936508, w: 0.022340425531914954, h: 0.015079365079365026 }; // prettier-ignore

/** `netflix-artwork-only-01`. A two-word badge that must stay one string. */
const LIVE = { x: 0.24225774225774227, y: 0.5715990453460621, w: 0.014485514485514495, h: 0.019093078758949833 }; // prettier-ignore
const MONDAYS = { x: 0.26223776223776224, y: 0.5704057279236276, w: 0.030969030969030975, h: 0.02028639618138428 }; // prettier-ignore

describe('T-AI-052 one line of OCR is not one title just because the numbers are close', () => {
  it('T-AI-052a: a box to the LEFT of the previous one is a new tile, not a continuation', () => {
    const out = groupReadingOrder([ocr('SOL', SOL), ocr('MAN ON FIRE', MAN_ON_FIRE)]);

    expect(textsOf(out)).toEqual(['SOL', 'MAN ON FIRE']);
  });

  it('T-AI-052b: 052a is decided by the SIGN of the gap, not by its size', () => {
    // ⚠ THE POINT OF THE WHOLE FILE, ASSERTED DIRECTLY. The pre-fix rule was
    // `gap < OCR_MERGE_GAP`, and this gap is -0.487: strongly NEGATIVE, and
    // therefore the most "mergeable" value the old comparison could produce.
    // A far-apart pair and a wrapped-around pair are indistinguishable to a
    // one-sided `<`.
    expect(gapBetween(SOL, MAN_ON_FIRE)).toBeLessThan(0);
    expect(gapBetween(SOL, MAN_ON_FIRE)).toBeLessThan(OCR_MERGE_GAP);

    // And the height guard does NOT rescue this case — it passes it. 052a is
    // the gap guard's work alone, which is what makes it a real test of it.
    expect(heightRatio(SOL, MAN_ON_FIRE)).toBeGreaterThan(OCR_MERGE_HEIGHT_RATIO);
  });

  it('T-AI-052c: two side-by-side reads at incomparable type sizes are two tiles', () => {
    const out = groupReadingOrder([ocr('WHISPER', WHISPER), ocr('HAMNET', HAMNET)]);

    expect(textsOf(out)).toEqual(['WHISPER', 'HAMNET']);
  });

  it('T-AI-052d: 052c is decided by height, because the gap alone would merge it', () => {
    // The mirror of 052b: here the GAP guard passes and the HEIGHT guard does
    // the work. Between them the two tests prove both guards are load-bearing
    // and that neither is masking the other.
    const gap = gapBetween(WHISPER, HAMNET);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(OCR_MERGE_GAP);

    expect(heightRatio(WHISPER, HAMNET)).toBeLessThan(OCR_MERGE_HEIGHT_RATIO);
  });

  it('T-AI-052e: the truncation ellipsis still joins its title \u2014 the limit', () => {
    const out = groupReadingOrder([
      ocr("The Hitchhiker's Guide to the", HITCHHIKER),
      ocr('..', ELLIPSIS),
    ]);

    expect(textsOf(out)).toEqual(["The Hitchhiker's Guide to the .."]);
  });

  it('T-AI-052f: 052e sits 0.0786 above the height floor, so the floor cannot be raised casually', () => {
    // ⚠ READ THIS BEFORE CHANGING `OCR_MERGE_HEIGHT_RATIO`. The margin is
    // small and one-sided: the nearest conflation still in the corpus,
    // `GREENLAND 2 | TRUE DETECTIVE`, sits at 0.69 — ABOVE this legitimate
    // merge's 0.6786. There is no value of this constant that separates them.
    // Raising the floor to catch GREENLAND breaks the ellipsis first.
    const ratio = heightRatio(HITCHHIKER, ELLIPSIS);
    expect(ratio).toBeGreaterThan(OCR_MERGE_HEIGHT_RATIO);
    expect(ratio).toBeLessThan(0.69);
  });

  it('T-AI-052g: an ordinary two-word badge still merges', () => {
    const out = groupReadingOrder([ocr('Live', LIVE), ocr('Mondays', MONDAYS)]);

    expect(textsOf(out)).toEqual(['Live Mondays']);
  });
});
