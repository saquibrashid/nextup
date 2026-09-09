/**
 * TASK-204 — the off-list region (`specs/ai.md` §3.2 step 3b, TASK-199 part 3).
 *
 * Test id: `T-AI-049` — "`ocr-only` orphans past a `Recommended For You`
 * header are the SERVICE's promotions, not the OWNER's saved list, and are
 * reclassified `chrome-suspected` — never dropped."
 *
 * ⚠ THIS RULE IS THE MOST DANGEROUS ONE IN STAGE 2 AND ITS TESTS ARE MOSTLY
 * REFUSALS. Every other cleanup rule reclassifies ONE line on its own
 * evidence. This one reclassifies by POSITION, so a wrong anchor or a wrong
 * axis costs every title on the wrong side of the cut — the silent-omission
 * failure this product exists to avoid. The suite therefore asserts far more
 * cases where it must NOT fire than cases where it must.
 */

import { describe, expect, it } from 'vitest';

import { OFF_LIST_REGION_HEADERS, cleanup, offListCut } from '../src/extraction/index.js';
import type { ExtractedTextItem, NormalisedBox } from '../src/extraction/TitleExtractor.js';

const NOW = new Date('2026-08-19T00:00:00Z');

const box = (x: number, y: number, w = 0.2, h = 0.05): NormalisedBox => ({ x, y, w, h });

function llm(over: Partial<ExtractedTextItem> = {}): ExtractedTextItem {
  return {
    rawText: 'Arcane',
    inferredTitle: 'Arcane',
    basis: 'text',
    ocrSupport: 'exact',
    provider: 'llm',
    boundingBox: box(0.1, 0.1),
    boxSource: 'ocr',
    confidence: 0.9,
    ...over,
  };
}

function ocr(over: Partial<ExtractedTextItem> = {}): ExtractedTextItem {
  return llm({
    inferredTitle: null,
    basis: 'text',
    ocrSupport: 'not-checked',
    provider: 'ocr-only',
    boxSource: 'ocr',
    ...over,
  });
}

/** A saved list of two tiles at the top, a header, and one promo below it. */
function verticalPage(): ExtractedTextItem[] {
  return [
    llm({ rawText: 'Arcane', inferredTitle: 'Arcane', boundingBox: box(0.1, 0.1) }),
    llm({ rawText: 'Dune', inferredTitle: 'Dune', boundingBox: box(0.1, 0.3) }),
    ocr({ rawText: 'Recommended For You', boundingBox: box(0.05, 0.6) }),
    ocr({ rawText: 'Hard Knocks', boundingBox: box(0.1, 0.7) }),
  ];
}

function verdictOf(items: readonly ExtractedTextItem[], rawText: string): string {
  const found = cleanup(items, { now: NOW }).find((c) => c.item.rawText === rawText);
  expect(found, `no candidate for ${rawText}`).toBeDefined();
  return found!.cleanupVerdict;
}

describe('T-AI-049 · the off-list region', () => {
  it('T-AI-049a: an `ocr-only` orphan past the header is reclassified, and the saved tiles above it are untouched', () => {
    const items = verticalPage();

    expect(verdictOf(items, 'Hard Knocks')).toBe('chrome-suspected');
    expect(verdictOf(items, 'Arcane')).toBe('title-candidate');
    expect(verdictOf(items, 'Dune')).toBe('title-candidate');
  });

  it('T-AI-049b: nothing is dropped — the output still holds every input line', () => {
    const items = verticalPage();
    const cleaned = cleanup(items, { now: NOW });

    // REQ-012. `chrome-suspected` is rendered behind a labelled expander the
    // owner can open; a filter here would be a silent omission.
    expect(cleaned).toHaveLength(items.length);
    expect(cleaned.map((c) => c.item.rawText)).toContain('Hard Knocks');
  });

  /*
   * ⚠ THE AXIS TWIN. `rotated-01` in the golden corpus is rotated 90°, so its
   * reading axis is `x`, not `y`. A hard-coded "below the header" rule reads
   * as "to the right of it" there and silently excludes nearly the whole list.
   * The axis is DERIVED from where the header sits relative to the primary
   * reader's hull; delete that derivation and this test fails while 049a still
   * passes.
   */
  it('T-AI-049c: on a rotated page the axis is derived as `x`, and the cut runs the right way', () => {
    const rotated = [
      llm({ rawText: 'Arcane', boundingBox: box(0.5, 0.1) }),
      llm({ rawText: 'Dune', boundingBox: box(0.7, 0.1) }),
      // The header sits to the LEFT of every tile, and vertically it OVERLAPS
      // them — so `y` gives no cut at all and only `x` does.
      ocr({ rawText: 'Recommended For You', boundingBox: box(0.05, 0.1) }),
      ocr({ rawText: 'Hard Knocks', boundingBox: box(0.02, 0.3, 0.02) }),
    ];

    expect(offListCut(rotated)).toEqual({ axis: 'x', direction: -1, at: 0.25 });
    expect(verdictOf(rotated, 'Hard Knocks')).toBe('chrome-suspected');
    expect(verdictOf(rotated, 'Arcane')).toBe('title-candidate');
  });

  /*
   * ⚠ THE INSIDE-THE-HULL REFUSAL. A header with saved tiles on BOTH sides
   * cannot be cut on safely — whichever side is excluded, real titles go with
   * it. Refusing costs the status quo; cutting costs the owner's list.
   */
  it('T-AI-049d: a header INSIDE the hull produces no cut at all', () => {
    const items = [
      llm({ rawText: 'Arcane', boundingBox: box(0.1, 0.1) }),
      llm({ rawText: 'Dune', boundingBox: box(0.1, 0.9) }),
      ocr({ rawText: 'Recommended For You', boundingBox: box(0.05, 0.5) }),
      ocr({ rawText: 'Hard Knocks', boundingBox: box(0.1, 0.7) }),
    ];

    expect(offListCut(items)).toBeNull();
    expect(verdictOf(items, 'Hard Knocks')).toBe('title-candidate');
  });

  it('T-AI-049e: a header outside the hull on BOTH axes is ambiguous and produces no cut', () => {
    const items = [
      llm({ rawText: 'Arcane', boundingBox: box(0.4, 0.4) }),
      ocr({ rawText: 'Recommended For You', boundingBox: box(0.05, 0.05, 0.1, 0.05) }),
      ocr({ rawText: 'Hard Knocks', boundingBox: box(0.02, 0.02, 0.02, 0.02) }),
    ];

    expect(offListCut(items)).toBeNull();
    expect(verdictOf(items, 'Hard Knocks')).toBe('title-candidate');
  });

  it('T-AI-049f: with no primary-reader output there is no hull, so there is no cut', () => {
    const items = [
      ocr({ rawText: 'Recommended For You', boundingBox: box(0.05, 0.6) }),
      ocr({ rawText: 'Hard Knocks', boundingBox: box(0.1, 0.7) }),
    ];

    expect(offListCut(items)).toBeNull();
    expect(verdictOf(items, 'Hard Knocks')).toBe('title-candidate');
  });

  /*
   * ⚠ THE PROVIDER PROPERTY, AND IT IS STRONGER THAN THE GUARD IT REPLACED.
   * This test was first written as "an `llm` tile past the header keeps its
   * verdict" and it FAILED — because a primary-reader tile past the header
   * extends the hull, which puts the header INSIDE the hull, which cancels the
   * cut outright. That is the correct behaviour and a better one: if the
   * reader that actually knows a tile from a promo believes there is a saved
   * tile below the header, no cut is safe. The `provider !== 'ocr-only'` line
   * in step 3b is therefore belt-and-braces, not the thing doing the work, and
   * is recorded as such rather than claimed as a proven guard.
   */
  it('T-AI-049g: a primary-reader tile past the header cancels the cut for EVERYTHING, orphans included', () => {
    const items = [
      ...verticalPage(),
      llm({ rawText: 'Severance', inferredTitle: 'Severance', boundingBox: box(0.5, 0.75) }),
    ];

    expect(offListCut(items)).toBeNull();
    expect(verdictOf(items, 'Severance')).toBe('title-candidate');
    expect(verdictOf(items, 'Hard Knocks')).toBe('title-candidate');
  });

  /*
   * ⚠ THE HEADER TWIN. Matching is whole-line and exact. A substring or prefix
   * test would let a TITLE containing the phrase open a region and take every
   * line after it with it.
   */
  it('T-AI-049h: the header match is whole-line and exact, never a substring', () => {
    const items = verticalPage().map((i) =>
      i.rawText === 'Recommended For You' ? { ...i, rawText: 'Recommended For You: The Movie' } : i,
    );

    expect(offListCut(items)).toBeNull();
    expect(verdictOf(items, 'Hard Knocks')).toBe('title-candidate');
  });

  it('T-AI-049i: the header vocabulary is tiny and every entry is already normalised', () => {
    // A header that does not survive `normaliseTitleText` can never match, so
    // an un-normalised entry is a silently dead rule.
    expect(OFF_LIST_REGION_HEADERS.length).toBeLessThanOrEqual(3);
    for (const header of OFF_LIST_REGION_HEADERS) {
      expect(header).toBe(header.toLowerCase().trim());
    }
  });

  it('T-AI-049j: step 3b never overwrites a verdict another step already reached', () => {
    const items = [
      ...verticalPage(),
      // Both below the cut. `unreadable-tile` and `low-confidence` carry
      // information step 3b does not have — a promo shelf is not a reason to
      // forget that a tile could not be read, or that a reading was weak.
      ocr({ rawText: '', inferredTitle: null, basis: 'unknown', boundingBox: box(0.3, 0.8) }),
      ocr({ rawText: 'Blurry Thing', confidence: 0.1, boundingBox: box(0.6, 0.8) }),
    ];

    // ⚠ Asserted EXACTLY, not as `not.toBe('title-candidate')`. The loose form
    // passes when step 3b overwrites these with `chrome-suspected`, which is
    // the very thing being forbidden.
    expect(verdictOf(items, '')).toBe('unreadable-tile');
    expect(verdictOf(items, 'Blurry Thing')).toBe('low-confidence');
    expect(verdictOf(items, 'Hard Knocks')).toBe('chrome-suspected');
  });
});
