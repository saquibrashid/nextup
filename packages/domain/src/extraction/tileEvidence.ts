import { normaliseTitleText } from '../identity.js';
import { cleanup } from './cleanup.js';
import { tileContaining, type TileGrid, type TileGridBox } from './tileGrid.js';
import type { ExtractedTextItem, NormalisedBox, OcrLine, TileCoverage } from './TitleExtractor.js';

/**
 * Geometry is not identity. A model centre inside a measured tile is still a
 * guess, so it NEVER anchors a crop. Existing OCR anchors can use the grid;
 * otherwise require an exact, unique OCR transcription in one tile. Matching
 * the combined lines also handles logos OCR splits over several lines.
 *
 * T-AI-062 keeps ambiguous duplicates, empty subjects and gutter anchors from
 * turning "nearest tile" into apparently verified evidence. This adds no
 * candidates and does not upgrade an artwork identification's confidence.
 */
export function withTileEvidence(
  items: readonly ExtractedTextItem[],
  lines: readonly OcrLine[],
  grid: TileGrid,
): { items: ExtractedTextItem[]; tileCoverage: TileCoverage } {
  const groups = grid.tiles.map((tile) =>
    lines
      .filter((line) => containing(grid, line.box) === tile)
      .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x),
  );
  const located = items.map((item): ExtractedTextItem => {
    let anchor = item.boxSource === 'ocr' ? item.boundingBox : undefined;
    let tile = anchor === undefined ? null : containing(grid, anchor);
    if (item.boxSource !== 'ocr') {
      const subject = normaliseTitleText(item.rawText || item.inferredTitle || '');
      if (subject === '') return item;
      const matches = groups.flatMap((group, index) => {
        const exactLine = group.find((line) => normaliseTitleText(line.text) === subject);
        const combined = normaliseTitleText(group.map((line) => line.text).join(' '));
        if (exactLine === undefined && combined !== subject) return [];
        const first = exactLine ?? group[0];
        const candidateTile = grid.tiles[index];
        return first && candidateTile ? [{ anchor: first.box, tile: candidateTile }] : [];
      });
      if (matches.length !== 1) return item;
      anchor = matches[0]?.anchor;
      tile = matches[0]?.tile ?? null;
    }
    if (tile === null || anchor === undefined) return item;
    return { ...item, boxSource: 'ocr', boundingBox: { ...anchor, gridTileBox: tile } };
  });
  // Count tiles, NOT rows. Two OCR fragments or two guesses for one tile must
  // not make a missing neighbouring tile disappear from the accounting.
  const titles = cleanup(located).filter(
    (candidate) =>
      candidate.cleanupVerdict !== 'chrome-suspected' &&
      candidate.cleanupVerdict !== 'unreadable-tile',
  );
  const occupied = new Set(
    titles.flatMap(({ item }) => {
      const tile = item.boundingBox.gridTileBox;
      return tile ? [grid.tiles.indexOf(tile)] : [];
    }),
  );
  return {
    items: located,
    tileCoverage: {
      detectedTiles: grid.tiles.length,
      locatedTiles: occupied.size,
      titleCandidates: titles.length,
    },
  };
}

function containing(grid: TileGrid, box: NormalisedBox): TileGridBox | null {
  if (![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w <= 0 || box.h <= 0) {
    return null;
  }
  return tileContaining(grid, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
}
