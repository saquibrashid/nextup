import { describe, expect, it } from 'vitest';
import {
  cleanup,
  tileCropFor,
  withTileEvidence,
  type ExtractedTextItem,
  type OcrLine,
  type TileGrid,
} from '../src/index.js';

const left = { x: 0.02, y: 0.2, w: 0.45, h: 0.6 };
const right = { x: 0.52, y: 0.2, w: 0.45, h: 0.6 };
const grid: TileGrid = { tiles: [left, right], rows: [], gutterScore: 1 };
const anchor = { x: 0.1, y: 0.3, w: 0.2, h: 0.03 };
const item = (overrides: Partial<ExtractedTextItem> = {}): ExtractedTextItem => ({
  rawText: 'The Film',
  inferredTitle: 'The Film',
  basis: 'text',
  ocrSupport: 'exact',
  provider: 'llm',
  boundingBox: anchor,
  boxSource: 'ocr',
  confidence: 0.9,
  ...overrides,
});
const crop = (candidate: ExtractedTextItem) =>
  tileCropFor({
    boxSource: candidate.boxSource,
    boundingBoxes: [{ imageId: 'image-1', ...candidate.boundingBox }],
  });

/**
 * The live report had five tiles but three candidates and mostly whole-image
 * thumbnails. The denominator and crop geometry must come from pixels, while
 * title location must come from OCR, not the reader's drifting rectangles.
 * These cases separate those claims. A correct crop is the full measured tile
 * even when its caption is off-centre; a model-only centre proves nothing.
 * Unique exact text can recover an artwork item's location, not its confidence.
 * Counts must remain honest after duplicate guesses, chrome and OCR merging.
 */
describe('T-AI-062 - measured tile evidence', () => {
  it('T-AI-062a - uses the whole measured tile rather than centring on its caption', () => {
    const result = withTileEvidence([item()], [], grid);
    expect(crop(result.items[0]!)).toEqual({ imageId: 'image-1', ...left });
    expect(result.tileCoverage).toEqual({ detectedTiles: 2, locatedTiles: 1, titleCandidates: 1 });
  });

  it('T-AI-062b - a model centre in a tile is not an anchor, nor is an OCR gutter centre', () => {
    const model = item({ boxSource: 'llm', ocrSupport: 'none' });
    const gutter = item({ boundingBox: { x: 0.48, y: 0.3, w: 0.02, h: 0.02 } });
    const result = withTileEvidence([model, gutter], [], grid);
    expect(result.items.map(crop)).toEqual([null, null]);
    expect(result.tileCoverage.locatedTiles).toBe(0);
  });

  it('T-AI-062c - uniquely matching stacked OCR can locate artwork without upgrading confidence', () => {
    const artwork = item({
      rawText: '',
      inferredTitle: 'The Film',
      boxSource: 'llm',
      basis: 'artwork',
      ocrSupport: 'none',
      boundingBox: right,
    });
    const lines: OcrLine[] = [
      { text: 'THE', box: anchor, confidence: 0.9 },
      { text: 'FILM', box: { ...anchor, y: 0.36 }, confidence: 0.9 },
    ];
    const found = withTileEvidence([artwork], lines, grid).items[0]!;
    expect(crop(found)).toEqual({ imageId: 'image-1', ...left });
    expect(found.ocrSupport).toBe('none');
    expect(found.basis).toBe('artwork');
    expect(cleanup([found])[0]?.cleanupVerdict).toBe('inferred-unverified');
  });

  it('T-AI-062d - duplicate exact titles, fuzzy titles and empty text cannot choose a tile', () => {
    const lines: OcrLine[] = [
      { text: 'The Film', box: anchor, confidence: 1 },
      { text: 'The Film', box: { ...anchor, x: 0.6 }, confidence: 1 },
    ];
    const ambiguous = item({ boxSource: 'llm', ocrSupport: 'none' });
    const fuzzy = item({ rawText: 'The Films', boxSource: 'llm', ocrSupport: 'none' });
    const empty = item({
      rawText: '',
      inferredTitle: null,
      basis: 'unknown',
      boxSource: 'llm',
      ocrSupport: 'none',
    });
    expect(withTileEvidence([ambiguous, fuzzy, empty], lines, grid).items.map(crop)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('T-AI-062e - counts occupied tiles once and excludes chrome and unreadable candidates', () => {
    const result = withTileEvidence(
      [
        item(),
        item(),
        item({
          rawText: 'My List',
          inferredTitle: null,
          provider: 'ocr-only',
          boundingBox: { ...anchor, x: 0.6 },
        }),
        item({
          rawText: '',
          inferredTitle: null,
          basis: 'unknown',
          boundingBox: { ...anchor, x: 0.6 },
        }),
      ],
      [],
      grid,
    );
    expect(result.tileCoverage).toEqual({ detectedTiles: 2, locatedTiles: 1, titleCandidates: 2 });
  });

  it('T-AI-062f - same-tile fragments retain evidence through cleanup, different tiles never merge', () => {
    const first = item({
      rawText: 'The',
      inferredTitle: null,
      provider: 'ocr-only',
      boundingBox: { ...anchor, w: 0.08 },
    });
    const next = item({
      rawText: 'Film',
      inferredTitle: null,
      provider: 'ocr-only',
      boundingBox: { ...anchor, x: 0.181, w: 0.08 },
    });
    const result = withTileEvidence([first, next], [], grid);
    const cleaned = cleanup(result.items);
    expect(cleaned).toHaveLength(1);
    expect(crop(cleaned[0]!.item)).toEqual({ imageId: 'image-1', ...left });
    expect(result.tileCoverage.locatedTiles).toBe(1);
    const closeTiles = {
      ...grid,
      tiles: [
        { x: 0, y: 0.2, w: 0.18, h: 0.6 },
        { x: 0.181, y: 0.2, w: 0.3, h: 0.6 },
      ],
    };
    expect(cleanup(withTileEvidence([first, next], [], closeTiles).items)).toHaveLength(2);
  });

  it('T-AI-062g - persisted measured boxes still require finite bounds and an OCR anchor inside', () => {
    for (const bad of [{ ...left, w: 0 }, { ...left, x: NaN }, { ...left, w: 2 }, right]) {
      expect(crop(item({ boundingBox: { ...anchor, gridTileBox: bad } }))).toBeNull();
    }
    expect(
      crop(item({ boxSource: 'llm', boundingBox: { ...anchor, gridTileBox: left } })),
    ).toBeNull();
    expect(
      withTileEvidence([item({ boundingBox: { ...anchor, w: -1 } })], [], grid).tileCoverage
        .locatedTiles,
    ).toBe(0);
  });
});
