/**
 * The two single-leg projections used when one reader was unavailable
 * (`specs/ai.md` §2.2 / §2.2a). TASK-055.
 *
 * These live beside the contract, not inside an extractor, because BOTH the
 * hybrid extractor (TASK-056c) and the `StubExtractor` must produce the same
 * shape on the degraded paths. Two copies of "what a degraded item looks like"
 * would drift, and the drift would only ever show up as a golden-fixture
 * mismatch weeks later.
 *
 * Both functions are PURE: no I/O, no inference, no clock, no randomness.
 *
 * ⚠ Neither applies the §3.2 length / chrome / digit gates. Those are stage 2
 * (`cleanup.ts`, TASK-057) and stage 2's governing rule is CLASSIFY AND
 * SURFACE, NEVER DROP AND HIDE — a filter here would delete a candidate before
 * anything could classify it.
 */

import type { ExtractedTextItem, LlmTile, OcrLine } from './TitleExtractor.js';

/**
 * Total, tie-free ordering: `(round(y*40), x, rawText)` — `specs/ai.md` §2.1c
 * step 4. Exported because every producer of `ExtractedTextItem[]` must sort
 * with THIS comparator; a different one makes the output non-reproducible and
 * `T-STUB-001` / `T-AI-034` are the tests that would notice.
 */
export function compareExtractedItems(a: ExtractedTextItem, b: ExtractedTextItem): number {
  const bandA = Math.round(a.boundingBox.y * 40);
  const bandB = Math.round(b.boundingBox.y * 40);
  if (bandA !== bandB) return bandA - bandB;
  if (a.boundingBox.x !== b.boundingBox.x) return a.boundingBox.x - b.boundingBox.x;
  // A plain lexicographic comparison, NOT localeCompare: locale ordering varies
  // with the host's ICU data, which would make the merge machine-dependent.
  return a.rawText < b.rawText ? -1 : a.rawText > b.rawText ? 1 : 0;
}

/**
 * OCR was unavailable; the primary reader worked (`crossCheck: 'ocr-unavailable'`).
 *
 * Every item is `ocrSupport: 'not-checked'` — NOT `'none'`. The distinction is
 * load-bearing: `'none'` means "we looked and found no corroboration",
 * `'not-checked'` means "we could not look". Collapsing them would let the
 * review pass present an unverified read as a verified-and-rejected one.
 */
export function llmOnlyItems(tiles: readonly LlmTile[]): ExtractedTextItem[] {
  return tiles
    .map((tile) => ({
      rawText: tile.visibleText ?? '',
      inferredTitle: tile.identifiedTitle,
      basis: tile.basis,
      ocrSupport: 'not-checked' as const,
      provider: 'llm' as const,
      boundingBox: { ...tile.box },
      boxSource: 'llm' as const,
      confidence: tile.confidence,
    }))
    .sort(compareExtractedItems);
}

/**
 * The primary reader was unavailable; OCR worked — degraded mode
 * (`crossCheck: 'llm-unavailable'`, `specs/ai.md` §2.2a).
 *
 * `inferredTitle` is `null` for every item, because OCR identifies nothing: it
 * reports glyphs. Populating it from `text` would manufacture an
 * identification the product never made — and in degraded mode that
 * identification is exactly what is missing.
 *
 * `ocrSupport: 'exact'` matches §2.1c step 2's treatment of OCR orphans: the
 * text IS the OCR reading, so it trivially corroborates itself.
 */
export function ocrOnlyItems(lines: readonly OcrLine[]): ExtractedTextItem[] {
  return lines
    .map((line) => ({
      rawText: line.text,
      inferredTitle: null,
      basis: 'text' as const,
      ocrSupport: 'exact' as const,
      provider: 'ocr-only' as const,
      boundingBox: { ...line.box },
      boxSource: 'ocr' as const,
      confidence: line.confidence,
    }))
    .sort(compareExtractedItems);
}
