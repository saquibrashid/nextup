/**
 * TASK-205 — the wrapped caption continuation (`specs/ai.md` §3.2 step 1b).
 *
 * Test id: `T-AI-050` — "two OCR lines of ONE caption that wrapped are merged
 * into the whole title; two captions that merely sit above one another are
 * not."
 *
 * ⚠ THE TWO DIRECTIONS OF THIS RULE HAVE OPPOSITE COSTS, WHICH IS WHY THE
 * REFUSALS OUTNUMBER THE MERGES. A wrap left unmerged costs two false titles
 * and a missing one — bad, but every fragment is still on screen and the owner
 * can see what happened. A merge that should not have happened FUSES TWO WORKS
 * INTO ONE CANDIDATE, and the second work is then gone from the review with
 * nothing to click: a title LOST. Every guard below therefore has a twin that
 * proves it actually refuses.
 *
 * The measured separation on the golden corpus (see `CAPTION_WRAP_GAP_CEILING`
 * in `cleanup.ts`) is 0.0016 for a real wrap against 0.079–0.101 for the next
 * tile's caption — two populations three orders of magnitude apart. The
 * constants below are pinned to that gap, not chosen.
 */

import { describe, expect, it } from 'vitest';

import {
  CAPTION_WRAP_GAP_CEILING,
  CAPTION_WRAP_HEIGHT_RATIO,
  CAPTION_WRAP_X_TOLERANCE,
  groupReadingOrder,
} from '../src/extraction/index.js';
import type { ExtractedTextItem, NormalisedBox } from '../src/extraction/TitleExtractor.js';

const box = (x: number, y: number, w = 0.3, h = 0.02): NormalisedBox => ({ x, y, w, h });

function ocr(rawText: string, boundingBox: NormalisedBox, confidence = 0.9): ExtractedTextItem {
  return {
    rawText,
    inferredTitle: null,
    basis: 'text',
    ocrSupport: 'not-checked',
    provider: 'ocr-only',
    boundingBox,
    boxSource: 'ocr',
    confidence,
  };
}

function textsOf(items: readonly ExtractedTextItem[]): string[] {
  return items.map((i) => i.rawText);
}

/**
 * The real geometry, read off `low-quality-jpeg-01`'s OCR recording. Left
 * edges are flush at x = 0.350 and the gap is 0.0016.
 */
const FIRST_LINE = box(0.35, 0.7446153846153846, 0.3265625, 0.019230769230769273);
const SECOND_LINE = box(0.35, 0.7653846153846153, 0.2265625, 0.01846153846153853);

describe('T-AI-050 a wrapped caption is one title, and a stacked pair is two', () => {
  it('T-AI-050a: the corpus wrap merges into the whole title', () => {
    const out = groupReadingOrder([
      ocr('Stranger Things: VHS', FIRST_LINE),
      ocr('Special Edition', SECOND_LINE),
    ]);

    expect(textsOf(out)).toEqual(['Stranger Things: VHS Special Edition']);
  });

  it('T-AI-050b: the merged box is the union, so later geometry sees the whole caption', () => {
    const [merged] = groupReadingOrder([
      ocr('Stranger Things: VHS', FIRST_LINE),
      ocr('Special Edition', SECOND_LINE),
    ]);

    // ⚠ ASSERTED because step 3b and the overlap passes all read this box. A
    // merge that kept only the first line's box would place the candidate half
    // a line too high and could put it on the wrong side of an off-list cut.
    expect(merged?.boundingBox.x).toBe(0.35);
    expect(merged?.boundingBox.y).toBe(FIRST_LINE.y);
    expect(merged?.boundingBox.w).toBe(FIRST_LINE.w);
    expect(merged?.boundingBox.h).toBeCloseTo(
      SECOND_LINE.y + SECOND_LINE.h - FIRST_LINE.y,
      // Float noise from the recorded decimals, not a tolerance on the rule.
      12,
    );
  });

  it('T-AI-050c: confidence is worst-of, not mean', () => {
    const [merged] = groupReadingOrder([
      ocr('Stranger Things: VHS', FIRST_LINE, 0.99),
      ocr('Special Edition', SECOND_LINE, 0.41),
    ]);

    // A wrapped caption is only as trustworthy as its least trustworthy line;
    // a mean would let the confident first line carry a doubtful second one
    // over the low-confidence floor and into `title-candidate`.
    expect(merged?.confidence).toBe(0.41);
  });

  it('T-AI-050d: the NEXT TILE\u2019s caption is NOT a continuation \u2014 the discriminating twin', () => {
    // Identical in every respect to 050a except the vertical gap, which is the
    // smallest one measured between distinct works on the corpus (0.079).
    const next = box(0.35, FIRST_LINE.y + FIRST_LINE.h + 0.079, 0.2265625, 0.0185);
    const out = groupReadingOrder([ocr('Man on Fire', FIRST_LINE), ocr('His & Hers', next)]);

    expect(textsOf(out)).toEqual(['Man on Fire', 'His & Hers']);
  });

  it('T-AI-050e: a line indented past the x tolerance is NOT a continuation', () => {
    const indented = box(
      0.35 + CAPTION_WRAP_X_TOLERANCE + 0.001,
      SECOND_LINE.y,
      0.2265625,
      SECOND_LINE.h,
    );
    const out = groupReadingOrder([
      ocr('Stranger Things: VHS', FIRST_LINE),
      ocr('S2 · 8 Episodes', indented),
    ]);

    // A metadata row set flush-left under a caption is the commonest thing
    // that is vertically adjacent and is NOT part of the title.
    expect(textsOf(out)).toEqual(['Stranger Things: VHS', 'S2 · 8 Episodes']);
  });

  it('T-AI-050f: a much shorter line is NOT a continuation, however close it sits', () => {
    const tiny = box(0.35, SECOND_LINE.y, 0.1, FIRST_LINE.h * (CAPTION_WRAP_HEIGHT_RATIO - 0.05));
    const out = groupReadingOrder([ocr('Wicked: For Good', FIRST_LINE), ocr('NEW', tiny)]);

    // A badge or a rating is set in a smaller face. Height is the only signal
    // that separates it from a wrap when x and y both agree.
    expect(textsOf(out)).toEqual(['Wicked: For Good', 'NEW']);
  });

  it('T-AI-050g: chrome is never glued to a caption, in either position', () => {
    const under = box(0.35, SECOND_LINE.y, 0.2, SECOND_LINE.h);
    const below = groupReadingOrder([ocr('Wicked: For Good', FIRST_LINE), ocr('Sort By', under)]);
    const above = groupReadingOrder([ocr('Sort By', FIRST_LINE), ocr('Wicked: For Good', under)]);

    // Step 3 is exact-match and runs AFTER this pass, so a chrome label glued
    // to anything can never be recognised as chrome again — the same reason
    // step 1 refuses the horizontal case.
    expect(textsOf(below)).toEqual(['Wicked: For Good', 'Sort By']);
    expect(textsOf(above)).toEqual(['Sort By', 'Wicked: For Good']);
  });

  it('T-AI-050h: an OVERLAPPING box is not a wrap \u2014 a negative gap is refused', () => {
    // A duplicate read of the same line, which OCR does emit. Merging it would
    // produce `Wicked: For Good Wicked: For Good`.
    const overlapping = box(0.35, FIRST_LINE.y + FIRST_LINE.h / 2, 0.3, FIRST_LINE.h);
    const out = groupReadingOrder([
      ocr('Wicked: For Good', FIRST_LINE),
      ocr('Wicked: For Good', overlapping),
    ]);

    expect(textsOf(out)).toEqual(['Wicked: For Good', 'Wicked: For Good']);
  });

  it('T-AI-050i: a gap just past the ceiling is refused, and just inside it is merged', () => {
    const inside = box(
      0.35,
      FIRST_LINE.y + FIRST_LINE.h + CAPTION_WRAP_GAP_CEILING - 0.0005,
      0.2,
      0.018,
    );
    const outside = box(
      0.35,
      FIRST_LINE.y + FIRST_LINE.h + CAPTION_WRAP_GAP_CEILING + 0.0005,
      0.2,
      0.018,
    );

    expect(
      textsOf(groupReadingOrder([ocr('A Title', FIRST_LINE), ocr('Continued', inside)])),
    ).toEqual(['A Title Continued']);
    expect(
      textsOf(groupReadingOrder([ocr('A Title', FIRST_LINE), ocr('Continued', outside)])),
    ).toEqual(['A Title', 'Continued']);
  });

  it('T-AI-050j: a THREE-line caption chains, and the chain is anchored on the union', () => {
    const third = box(0.35, SECOND_LINE.y + SECOND_LINE.h + 0.002, 0.15, 0.018);
    const out = groupReadingOrder([
      ocr('Stranger Things: VHS', FIRST_LINE),
      ocr('Special Edition', SECOND_LINE),
      ocr('Volume One', third),
    ]);

    // ⚠ THIS IS WHY STEP 1b RUNS AS ITS OWN PASS OVER THE ALREADY-MERGED LIST.
    // The third line is tested against the UNION of the first two, so its gap
    // is measured from the bottom of line 2 — not from line 1, which is a full
    // line-height away and would refuse.
    expect(textsOf(out)).toEqual(['Stranger Things: VHS Special Edition Volume One']);
  });

  it('T-AI-050k: `llm` items are never merged into a caption and keep their order', () => {
    const tile: ExtractedTextItem = {
      ...ocr('Stranger Things', box(0.35, SECOND_LINE.y, 0.3, 0.019)),
      provider: 'llm',
      inferredTitle: 'Stranger Things',
    };
    const out = groupReadingOrder([ocr('Stranger Things: VHS', FIRST_LINE), tile]);

    // The primary reader is already one-per-tile. Gluing a caption onto a tile
    // would fuse a work into a neighbour's title, which is the fusion failure
    // this whole suite is built around.
    expect(textsOf(out)).toEqual(['Stranger Things', 'Stranger Things: VHS']);
  });

  it('T-AI-050l: the horizontal pass still runs, and its result is what wraps', () => {
    // Two half-lines on one row that step 1 joins, then a continuation under
    // the JOINED box whose left edge only matches the LEFT half.
    const leftHalf = box(0.35, FIRST_LINE.y, 0.16, FIRST_LINE.h);
    const rightHalf = box(0.35 + 0.16 + 0.01, FIRST_LINE.y, 0.16, FIRST_LINE.h);
    const out = groupReadingOrder([
      ocr('Stranger', leftHalf),
      ocr('Things: VHS', rightHalf),
      ocr('Special Edition', SECOND_LINE),
    ]);

    expect(textsOf(out)).toEqual(['Stranger Things: VHS Special Edition']);
  });
});
