/**
 * TASK-056c — the OCR cross-check merge (`specs/ai.md` §2.1c).
 *
 * Test ids: `T-AI-034` (purity/determinism), `T-AI-019` (no inlined
 * thresholds).
 *
 * ⚠ These assertions are about a SAFETY property, not a quality metric. The
 * corpus-level recall and fabrication numbers (`T-AI-039`, `T-AI-032`) are
 * measured by the golden suite against recordings. What is proved here is the
 * narrower thing the golden suite cannot: that the merge is a pure function,
 * that it never drops an OCR line, and that its thresholds are named.
 *
 * ⚠ ALL BOXES ARE NORMALISED 0..1 (`NormalisedBox`), not pixels. A pixel-value
 * fixture still type-checks, and then every overlap silently computes to zero
 * — so every corroboration assertion fails in a way that looks like a scoring
 * bug rather than a bad fixture. This cost a debugging cycle already.
 */

import { describe, expect, it } from 'vitest';

import {
  OCR_BOX_OVERLAP_MIN,
  OCR_SUPPORT_EXACT,
  OCR_SUPPORT_PARTIAL,
  crossCheck,
  jaro,
  jaroWinkler,
  type ExtractedTextItem,
  type LlmTile,
  type NormalisedBox,
  type OcrLine,
} from '../src/index.js';

const tile = (
  identifiedTitle: string | null,
  box: NormalisedBox,
  extra: Partial<LlmTile> = {},
): LlmTile => ({
  visibleText: identifiedTitle,
  identifiedTitle,
  basis: 'text',
  confidence: 0.9,
  box,
  ...extra,
});

const line = (text: string, box: NormalisedBox): OcrLine => ({ text, box, confidence: 0.9 });

const find = (items: readonly ExtractedTextItem[], t: string): ExtractedTextItem | undefined =>
  items.find((i) => i.inferredTitle === t || i.rawText === t);

describe('jaroWinkler (T-AI-034)', () => {
  it('T-AI-034a - is symmetric, bounded, and exact on identity', () => {
    expect(jaroWinkler('Stranger Things', 'Stranger Things')).toBe(1);
    expect(jaroWinkler('', '')).toBe(1);
    expect(jaroWinkler('abc', '')).toBe(0);

    for (const [a, b] of [
      ['Stranger Things', 'Strange Things'],
      ['The Crown', 'Crown'],
      ['Ozark', 'Ozarks'],
      ['Succession', 'Severance'],
    ] as const) {
      expect(jaroWinkler(a, b)).toBe(jaroWinkler(b, a));
      expect(jaroWinkler(a, b)).toBeGreaterThanOrEqual(0);
      expect(jaroWinkler(a, b)).toBeLessThanOrEqual(1);
    }
  });

  it('T-AI-034b - applies the Winkler prefix boost ONLY at jaro >= 0.7', () => {
    // ⚠ THE VARIANT IS LOAD-BEARING. Several ports apply the prefix boost
    // unconditionally. That inflates scores for pairs that merely start alike
    // — exactly the region where OCR_SUPPORT_PARTIAL decides whether a
    // candidate counts as corroborated — so swapping in such a port would
    // silently change which candidates are marked as OCR-supported.
    const low = jaro('Max', 'Marvellous');
    expect(low).toBeLessThan(0.7);
    expect(jaroWinkler('Max', 'Marvellous')).toBe(low);

    const high = jaro('Stranger Things', 'Stranger Thing');
    expect(high).toBeGreaterThanOrEqual(0.7);
    expect(jaroWinkler('Stranger Things', 'Stranger Thing')).toBeGreaterThan(high);
  });
});

describe('crossCheck (T-AI-034)', () => {
  // Three tiles across the top row; each caption sits inside its own tile.
  const tiles: LlmTile[] = [
    tile('Stranger Things', { x: 0.0, y: 0.0, w: 0.3, h: 0.5 }),
    tile('The Crown', { x: 0.35, y: 0.0, w: 0.3, h: 0.5 }),
    tile('Wednesday', { x: 0.7, y: 0.0, w: 0.3, h: 0.5 }, { basis: 'artwork', visibleText: null }),
  ];
  const lines: OcrLine[] = [
    line('Stranger Things', { x: 0.02, y: 0.4, w: 0.26, h: 0.06 }),
    line('The Crwon', { x: 0.37, y: 0.4, w: 0.26, h: 0.06 }),
    line('Bridgerton', { x: 0.02, y: 0.8, w: 0.26, h: 0.06 }),
  ];

  it('T-AI-034c - is a pure function — three runs are byte-identical (T-AI-034)', () => {
    const runs = [crossCheck(tiles, lines), crossCheck(tiles, lines), crossCheck(tiles, lines)];
    expect(JSON.stringify(runs[1])).toBe(JSON.stringify(runs[0]));
    expect(JSON.stringify(runs[2])).toBe(JSON.stringify(runs[0]));
  });

  it('T-AI-034d - does not mutate its inputs', () => {
    const tilesBefore = JSON.stringify(tiles);
    const linesBefore = JSON.stringify(lines);
    crossCheck(tiles, lines);
    expect(JSON.stringify(tiles)).toBe(tilesBefore);
    expect(JSON.stringify(lines)).toBe(linesBefore);
  });

  it('T-AI-034e - is insensitive to input order — the output is a stable total order', () => {
    const a = crossCheck(tiles, lines);
    const b = crossCheck([...tiles].reverse(), [...lines].reverse());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('T-AI-034f - marks an exact overlapping OCR match as corroborated', () => {
    expect(find(crossCheck(tiles, lines), 'Stranger Things')?.ocrSupport).toBe('exact');
  });

  it('T-AI-034g - marks a near-miss OCR match as partial rather than none', () => {
    // 'The Crwon' is a realistic OCR transposition of 'The Crown'. Returning
    // 'none' here would make a corroborated candidate look unsupported and
    // count against the fabrication metric — a scoring bug wearing the
    // costume of a quality problem.
    expect(find(crossCheck(tiles, lines), 'The Crown')?.ocrSupport).toBe('partial');
  });

  it('T-AI-034h - reports no support for an artwork-only tile OCR never saw', () => {
    expect(find(crossCheck(tiles, lines), 'Wednesday')?.ocrSupport).toBe('none');
  });

  it('T-AI-034i - NEVER drops an unconsumed OCR line — it is emitted as an orphan', () => {
    // ⚠ THE POINT OF THE WHOLE STAGE (REQ-012, product invariant 2). An OCR
    // line the model did not report must survive to review. `crossCheck` is
    // deliberately NOT a filter: `cleanup.ts` classifies afterwards, so a
    // genuinely two-character title, or one literally named 'Max', reaches
    // the owner instead of being deleted with no record by the very mechanism
    // that exists to stop titles going missing.
    const orphan = find(crossCheck(tiles, lines), 'Bridgerton');
    expect(orphan).toBeDefined();
    expect(orphan?.provider).toBe('ocr-only');
    expect(orphan?.inferredTitle).toBeNull();
  });

  it('T-AI-034j - emits short and chrome-like OCR orphans rather than filtering them', () => {
    const noisy: OcrLine[] = [
      line('Up', { x: 0.8, y: 0.02, w: 0.05, h: 0.03 }),
      line('Max', { x: 0.8, y: 0.1, w: 0.07, h: 0.03 }),
      line('2024', { x: 0.8, y: 0.2, w: 0.09, h: 0.03 }),
    ];
    const items = crossCheck([], noisy);
    expect(items.map((i) => i.rawText).sort()).toEqual(['2024', 'Max', 'Up']);
    expect(items.every((i) => i.provider === 'ocr-only')).toBe(true);
  });

  it('T-AI-034k - handles both empty legs without throwing', () => {
    expect(crossCheck([], [])).toEqual([]);
    expect(crossCheck(tiles, []).every((i) => i.ocrSupport === 'none')).toBe(true);
    expect(crossCheck([], lines).every((i) => i.provider === 'ocr-only')).toBe(true);
  });

  it('T-AI-034l - does not re-emit a line as an orphan when it was consumed by a tile', () => {
    // ⚠ THE SPEC SAYS "not consumed in step 1 by ANY tile" (§2.1c step 2) —
    // consumption is deliberately NOT a one-to-one assignment, and an earlier
    // version of this test wrongly asserted exclusivity. Two overlapping tiles
    // may both be corroborated by one caption; what must never happen is the
    // line ALSO appearing a third time as a standalone `ocr-only` orphan,
    // which would show the owner a duplicate of a title already listed.
    const twoTiles = [
      tile('Dark', { x: 0.0, y: 0.0, w: 0.3, h: 0.5 }),
      tile('Dark', { x: 0.05, y: 0.0, w: 0.3, h: 0.5 }),
    ];
    const one = [line('Dark', { x: 0.08, y: 0.3, w: 0.15, h: 0.06 })];
    const items = crossCheck(twoTiles, one);

    expect(items.filter((i) => i.provider === 'ocr-only')).toHaveLength(0);
    expect(items).toHaveLength(2);
  });
});

describe('cross-check thresholds (T-AI-019)', () => {
  it('T-AI-019a - are named constants, ordered, and in range', () => {
    expect(OCR_SUPPORT_EXACT).toBeGreaterThan(OCR_SUPPORT_PARTIAL);
    expect(OCR_SUPPORT_PARTIAL).toBeGreaterThan(0);
    expect(OCR_SUPPORT_EXACT).toBeLessThanOrEqual(1);
    expect(OCR_BOX_OVERLAP_MIN).toBeGreaterThan(0);
    expect(OCR_BOX_OVERLAP_MIN).toBeLessThanOrEqual(1);
  });
});
