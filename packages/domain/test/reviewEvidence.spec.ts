import { describe, expect, it } from 'vitest';
import {
  canBulkConfirm,
  individualReviewReason,
  withReviewEvidence,
  buildReviewResponse,
  tileCropFor,
  type ReviewCandidate,
} from '../src/index.js';

const tile = { imageId: 'image', x: 0.2, y: 0.25, w: 0.19, h: 0.65 };
function candidate(id: string, overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    candidateId: id,
    rawText: 'JO KOY BLUE IN THE FACE',
    inferredTitle: null,
    basis: 'both',
    ocrSupport: 'partial',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 1,
    resolvedWorkIdentity: 'tmdb:movie:1',
    match: {
      tmdbId: 1,
      mediaType: 'movie',
      name: 'Jo Koy: Blue in the Face',
      releaseYear: 2026,
      posterPath: null,
      score: 1,
      uncertain: false,
      ambiguous: false,
    },
    alternatives: [],
    sourceImageIds: ['image'],
    tileCrop: tile,
    measuredTiles: [tile],
    disposition: 'pending',
    collapsedIntoCandidateId: null,
    classification: 'new',
    ...overrides,
  };
}
const fragment = () =>
  candidate('ocr', {
    rawText: 'KIKY',
    provider: 'ocr-only',
    verdict: 'low-confidence',
    ocrConfidence: 0.321,
    match: null,
    resolvedWorkIdentity: 'unmatched:kiky',
  });

describe('T-AI-065 - tile-aware review evidence, not inferred identity', () => {
  it('T-AI-066e - every input tile survives empty output and shared-work deduplication', () => {
    const regions = Array.from({ length: 5 }, (_, i) => ({ x: i * 0.2, y: 0.1, w: 0.19, h: 0.8 }));
    const known = candidate('known', {
      classification: 'already-present-for-this-service',
      inputTiles: [
        { imageId: 'image', ...regions[0]! },
        { imageId: 'image', ...regions[1]! },
      ],
    });
    const response = buildReviewResponse({
      batchId: 'batch',
      mode: 'append-only',
      service: 'netflix',
      lowYield: true,
      degradedExtraction: false,
      crossCheck: 'ok',
      candidates: [known],
      disappearedListings: [],
      imagesWithNoText: [],
      tileCoverage: [
        {
          imageId: 'image',
          fileName: 'shot.png',
          href: '/api/images/image',
          detectedTiles: 5,
          locatedTiles: 2,
          titleCandidates: 1,
          tiles: regions,
        },
      ],
    });
    expect(response.tiles).toHaveLength(5);
    expect(response.tiles?.map((tile) => tile.candidates.map((item) => item.candidateId))).toEqual([
      ['known'],
      ['known'],
      [],
      [],
      [],
    ]);
    expect(response.sections.alreadyOnYourList.items).toHaveLength(1);
    expect(response.sections.alreadyOnYourList.omitted).toBe(false);
  });

  it('T-AI-066f - controlled input provenance permits artwork crops without trusting model geometry', () => {
    const box = { imageId: 'image', x: 0, y: 0, w: 0.01, h: 0.01 };
    expect(tileCropFor({ boxSource: 'llm', boundingBoxes: [box] })).toBeNull();
    expect(
      tileCropFor({ boxSource: 'llm', boundingBoxes: [{ ...box, inputTileBox: tile }] }),
    ).toEqual(tile);
    for (const invalid of [
      { ...tile, w: 0 },
      { ...tile, x: 2 },
      { ...tile, y: NaN },
    ]) {
      expect(
        tileCropFor({ boxSource: 'llm', boundingBoxes: [{ ...box, inputTileBox: invalid }] }),
      ).toBeNull();
    }
  });
  it('T-AI-065a - preserves both readings and explains their shared measured tile', () => {
    const input = [candidate('jo'), fragment()];
    const before = structuredClone(input);
    const result = withReviewEvidence(input);
    expect(input).toEqual(before);
    expect(result).toHaveLength(2);
    expect(result[1]?.relatedReadings).toEqual([
      { candidateId: 'jo', rawText: 'JO KOY BLUE IN THE FACE', relation: 'same-tile' },
    ]);
    expect(result[0]?.relatedReadings?.[0]?.rawText).toBe('KIKY');
    expect(result.map(canBulkConfirm)).toEqual([false, false]);
    expect(result[1]?.resolvedWorkIdentity).toBe('unmatched:kiky');
  });

  it('T-AI-065b - a shared catalogue alternative explains Best Ed but cannot locate Best of the Best', () => {
    const best = candidate('best', {
      rawText: 'BEST OF THE BEST',
      verdict: 'inferred-unverified',
      tileCrop: null,
      measuredTiles: [],
      resolvedWorkIdentity: 'tmdb:movie:1514863',
    });
    const ocr = candidate('best-ocr', {
      provider: 'ocr-only',
      rawText: 'BEST& BEST',
      resolvedWorkIdentity: 'tmdb:tv:18333',
      alternatives: [
        {
          tmdbId: 1514863,
          mediaType: 'movie',
          name: 'Best of the Best',
          releaseYear: 2026,
          posterPath: null,
          score: 0.8791666666666667,
        },
      ],
    });
    const result = withReviewEvidence([best, ocr]);
    expect(result[0]?.relatedReadings).toEqual([
      { candidateId: 'best-ocr', rawText: 'BEST& BEST', relation: 'possible-same-work' },
    ]);
    expect(result[1]?.relatedReadings?.[0]?.relation).toBe('possible-same-work');
    expect(result[0]?.tileCrop).toBeNull();
    expect(result[1]?.resolvedWorkIdentity).toBe('tmdb:tv:18333');
  });

  it('T-AI-065c - neither legacy crops, different images, nor neighbouring measured tiles prove a shared tile', () => {
    for (const peer of [
      fragmentWith({ measuredTiles: [] }),
      fragmentWith({ measuredTiles: [{ ...tile, imageId: 'other' }], sourceImageIds: ['other'] }),
      fragmentWith({ measuredTiles: [{ ...tile, x: 0.4 }] }),
    ]) {
      expect(withReviewEvidence([candidate('jo'), peer])[0]?.relatedReadings).toEqual([]);
    }
    const noMeasurements = candidate('old');
    const legacyFragment = fragment();
    delete noMeasurements.measuredTiles;
    delete legacyFragment.measuredTiles;
    expect(withReviewEvidence([noMeasurements, legacyFragment])[0]?.relatedReadings).toEqual([]);
  });

  it('T-AI-065d - discarded, collapsed and chrome readings never create conflicts', () => {
    for (const overrides of [
      { disposition: 'discarded' as const },
      { collapsedIntoCandidateId: 'jo' },
      { verdict: 'chrome-suspected' as const },
      { verdict: 'unreadable-tile' as const },
    ]) {
      const result = withReviewEvidence([candidate('jo'), fragmentWith(overrides)]);
      expect(result.every((item) => item.relatedReadings?.length === 0)).toBe(true);
      expect(canBulkConfirm(result[0]!)).toBe(true);
    }
  });

  it('T-AI-065e - bulk skips weak, ambiguous, unverified and low-confidence readings but not individual decisions', () => {
    const clean = candidate('clean');
    expect(canBulkConfirm(clean)).toBe(true);
    expect(individualReviewReason(clean)).toBeNull();
    for (const candidateWithRisk of [
      candidate('uncertain', { match: { ...clean.match!, uncertain: true } }),
      candidate('ambiguous', { match: { ...clean.match!, ambiguous: true } }),
      candidate('unverified', { verdict: 'inferred-unverified' }),
      fragment(),
      candidate('unreadable', { verdict: 'unreadable-tile' }),
    ]) {
      expect(canBulkConfirm(candidateWithRisk)).toBe(false);
      expect(individualReviewReason(candidateWithRisk)).not.toBeNull();
    }
    expect(canBulkConfirm(candidate('unmatched', { match: null }))).toBe(true);
    for (const disposition of ['confirmed', 'corrected', 'discarded'] as const) {
      expect(canBulkConfirm(candidate('decided', { disposition }))).toBe(false);
    }
  });

  it('T-AI-065f - known positions contradict a catalogue-only link, and media types and image scope matter', () => {
    const source = candidate('source');
    const alt = { ...source.match! };
    for (const peer of [
      fragmentWith({ alternatives: [alt], measuredTiles: [{ ...tile, x: 0.5 }] }),
      fragmentWith({ alternatives: [alt], measuredTiles: [], sourceImageIds: ['other'] }),
      fragmentWith({ alternatives: [{ ...alt, mediaType: 'tv' }], measuredTiles: [] }),
    ]) {
      expect(withReviewEvidence([source, peer])[0]?.relatedReadings).toEqual([]);
    }
    const textless = candidate('textless', { rawText: '', inferredTitle: 'Jo Koy' });
    expect(withReviewEvidence([textless, fragment()])[1]?.relatedReadings?.[0]?.rawText).toBe(
      'Jo Koy',
    );
    expect(
      withReviewEvidence([candidate('blank', { rawText: '' }), fragment()])[1]?.relatedReadings?.[0]
        ?.rawText,
    ).toBe('Unreadable text');
  });
});

function fragmentWith(overrides: Partial<ReviewCandidate>): ReviewCandidate {
  return { ...fragment(), ...overrides };
}
