/**
 * TASK-063 — intra-batch overlap collapse (SD-02, `specs/data-model.md` §7.4).
 *
 * Test id: `T-AI-007` — "Overlapping screenshots collapse to one candidate;
 * `sourceImageIds` holds both."
 *
 * ⚠ The load-bearing half of SD-02 is not the collapse, it is the RETENTION.
 * REQ-012 says nothing is silently discarded, so a loser must survive in the
 * candidate array carrying `collapsedIntoCandidateId`. A collapse that removed
 * the row would be indistinguishable from a failed extraction — which is the
 * one failure class this product exists to avoid. Several assertions below
 * exist only to fail if a future "tidy-up" filters losers out.
 */

import { describe, expect, it } from 'vitest';

import { collapseOverlap } from '../src/overlap.js';
import type { ExtractionCandidate } from '../src/types.js';

const NOW = '2026-01-01T00:00:00.000Z';
const BATCH = '01J9ZQ0000000000000000BAT1';
const IMG1 = '01J9ZQ0000000000000000IMG1';
const IMG2 = '01J9ZQ0000000000000000IMG2';

function aCandidate(overrides: Partial<ExtractionCandidate> = {}): ExtractionCandidate {
  return {
    id: `cand:${BATCH}:${IMG1}:1`,
    type: 'extractionCandidate',
    ownerId: 'o_9f2c1a7b',
    batchId: BATCH,
    sourceImageIds: [IMG1],
    rawText: 'Dune',
    inferredTitle: 'Dune',
    basis: 'text',
    ocrSupport: 'exact',
    provider: 'llm',
    normalisedText: 'dune',
    extractedYear: 2021,
    boundingBoxes: [{ imageId: IMG1, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
    boxSource: 'ocr',
    ocrConfidence: 0.9,
    cleanupVerdict: 'title-candidate',
    resolvedWorkIdentity: 'tmdb:movie:438631',
    matchCandidates: [],
    classification: null,
    reviewDisposition: 'pending',
    correctedToTmdbId: null,
    collapsedIntoCandidateId: null,
    createdAt: NOW,
    ...overrides,
  };
}

const imageOrder = [IMG1, IMG2];

describe('T-AI-007 · intra-batch overlap collapse (SD-02)', () => {
  it('T-AI-007a: the same title on two overlapping screenshots collapses to one candidate, and the survivor holds both source images', () => {
    const onImage1 = aCandidate({ id: 'cand:a', sourceImageIds: [IMG1] });
    const onImage2 = aCandidate({
      id: 'cand:b',
      sourceImageIds: [IMG2],
      boundingBoxes: [{ imageId: IMG2, x: 0.1, y: 0.8, w: 0.2, h: 0.2 }],
    });

    const result = collapseOverlap([onImage1, onImage2], { pass: 'pre-match', imageOrder });

    const survivors = result.candidates.filter((c) => c.collapsedIntoCandidateId === null);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.id).toBe('cand:a');
    expect(survivors[0]!.sourceImageIds).toEqual([IMG1, IMG2]);
  });

  it('T-AI-007b: the loser is RETAINED, marked discarded, and points at the survivor', () => {
    const first = aCandidate({ id: 'cand:a' });
    const second = aCandidate({
      id: 'cand:b',
      sourceImageIds: [IMG2],
      boundingBoxes: [{ imageId: IMG2, x: 0.1, y: 0.8, w: 0.2, h: 0.2 }],
    });

    const result = collapseOverlap([first, second], { pass: 'pre-match', imageOrder });

    // Nothing is removed from the array — this is REQ-012 at the storage layer.
    expect(result.candidates).toHaveLength(2);
    const loser = result.candidates.find((c) => c.id === 'cand:b')!;
    expect(loser.reviewDisposition).toBe('discarded');
    expect(loser.collapsedIntoCandidateId).toBe('cand:a');
    // §7.4: written with `cleanupVerdict` unchanged.
    expect(loser.cleanupVerdict).toBe('title-candidate');
  });

  it('T-AI-007c: the survivor absorbs bounding boxes and takes the MAX ocrConfidence', () => {
    const weak = aCandidate({
      id: 'cand:a',
      ocrConfidence: 0.4,
      boundingBoxes: [{ imageId: IMG1, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
    });
    const strong = aCandidate({
      id: 'cand:b',
      sourceImageIds: [IMG2],
      ocrConfidence: 0.97,
      boundingBoxes: [{ imageId: IMG2, x: 0.5, y: 0.5, w: 0.2, h: 0.2 }],
    });

    const result = collapseOverlap([weak, strong], { pass: 'pre-match', imageOrder });
    const survivor = result.candidates.find((c) => c.id === 'cand:a')!;

    expect(survivor.ocrConfidence).toBe(0.97);
    expect(survivor.boundingBoxes).toHaveLength(2);
    expect(survivor.boundingBoxes.map((b) => b.imageId)).toEqual([IMG1, IMG2]);
  });

  it('T-AI-007d: the survivor is the first occurrence by (imageIndex, yTop, xLeft), not by input order', () => {
    // Listed first, but sits lower on the LATER image.
    const later = aCandidate({
      id: 'cand:later',
      sourceImageIds: [IMG2],
      boundingBoxes: [{ imageId: IMG2, x: 0.0, y: 0.0, w: 0.2, h: 0.2 }],
    });
    // Listed second, but is on the earlier image.
    const earlier = aCandidate({
      id: 'cand:earlier',
      sourceImageIds: [IMG1],
      boundingBoxes: [{ imageId: IMG1, x: 0.9, y: 0.9, w: 0.2, h: 0.2 }],
    });

    const result = collapseOverlap([later, earlier], { pass: 'pre-match', imageOrder });

    expect(result.survivorIds).toEqual(['cand:earlier']);
    expect(result.candidates.find((c) => c.id === 'cand:later')!.collapsedIntoCandidateId).toBe(
      'cand:earlier',
    );
  });

  it('T-AI-007e: within one image the topmost then leftmost tile survives', () => {
    const lower = aCandidate({
      id: 'cand:lower',
      boundingBoxes: [{ imageId: IMG1, x: 0.1, y: 0.7, w: 0.2, h: 0.2 }],
    });
    const upperRight = aCandidate({
      id: 'cand:upper-right',
      boundingBoxes: [{ imageId: IMG1, x: 0.8, y: 0.2, w: 0.2, h: 0.2 }],
    });
    const upperLeft = aCandidate({
      id: 'cand:upper-left',
      boundingBoxes: [{ imageId: IMG1, x: 0.1, y: 0.2, w: 0.2, h: 0.2 }],
    });

    const result = collapseOverlap([lower, upperRight, upperLeft], {
      pass: 'pre-match',
      imageOrder,
    });

    expect(result.survivorIds).toEqual(['cand:upper-left']);
    expect(result.collapsedIds.sort()).toEqual(['cand:lower', 'cand:upper-right']);
  });

  it('T-AI-007f: the result is independent of input order (determinism)', () => {
    const a = aCandidate({ id: 'cand:a' });
    const b = aCandidate({
      id: 'cand:b',
      sourceImageIds: [IMG2],
      boundingBoxes: [{ imageId: IMG2, x: 0.3, y: 0.3, w: 0.2, h: 0.2 }],
    });
    const c = aCandidate({
      id: 'cand:c',
      sourceImageIds: [IMG2],
      boundingBoxes: [{ imageId: IMG2, x: 0.4, y: 0.4, w: 0.2, h: 0.2 }],
    });

    const forward = collapseOverlap([a, b, c], { pass: 'pre-match', imageOrder });
    const reversed = collapseOverlap([c, b, a], { pass: 'pre-match', imageOrder });

    expect(forward.survivorIds).toEqual(reversed.survivorIds);
    expect(forward.collapsedIds.sort()).toEqual(reversed.collapsedIds.sort());
  });

  it('T-AI-007g: distinct titles are never collapsed', () => {
    const dune = aCandidate({ id: 'cand:a', normalisedText: 'dune' });
    const arrival = aCandidate({ id: 'cand:b', normalisedText: 'arrival' });

    const result = collapseOverlap([dune, arrival], { pass: 'pre-match', imageOrder });

    expect(result.survivorIds).toEqual([]);
    expect(result.collapsedIds).toEqual([]);
    expect(result.candidates.every((c) => c.collapsedIntoCandidateId === null)).toBe(true);
  });

  it('T-AI-007h: unreadable tiles (empty normalisedText) never collapse into one another', () => {
    const blankA = aCandidate({ id: 'cand:a', rawText: '', normalisedText: '' });
    const blankB = aCandidate({ id: 'cand:b', rawText: '', normalisedText: '' });

    const result = collapseOverlap([blankA, blankB], { pass: 'pre-match', imageOrder });

    expect(result.collapsedIds).toEqual([]);
  });

  it('T-AI-007i: the post-match pass collapses on resolvedWorkIdentity, and never groups the unresolved', () => {
    // Different raw text, same work — only pass B can see this.
    const spelling1 = aCandidate({
      id: 'cand:a',
      normalisedText: 'dune part two',
      resolvedWorkIdentity: 'tmdb:movie:693134',
    });
    const spelling2 = aCandidate({
      id: 'cand:b',
      normalisedText: 'dune part 2',
      resolvedWorkIdentity: 'tmdb:movie:693134',
      boundingBoxes: [{ imageId: IMG1, x: 0.5, y: 0.5, w: 0.2, h: 0.2 }],
    });
    const unresolvedA = aCandidate({ id: 'cand:c', resolvedWorkIdentity: null });
    const unresolvedB = aCandidate({ id: 'cand:d', resolvedWorkIdentity: null });

    const result = collapseOverlap([spelling1, spelling2, unresolvedA, unresolvedB], {
      pass: 'post-match',
      imageOrder,
    });

    expect(result.survivorIds).toEqual(['cand:a']);
    expect(result.collapsedIds).toEqual(['cand:b']);
    expect(result.candidates.find((c) => c.id === 'cand:d')!.collapsedIntoCandidateId).toBeNull();
  });

  it('T-AI-007j: a candidate already collapsed by pass A is not re-parented by pass B', () => {
    const survivor = aCandidate({ id: 'cand:a' });
    const loser = aCandidate({
      id: 'cand:b',
      sourceImageIds: [IMG2],
      boundingBoxes: [{ imageId: IMG2, x: 0.3, y: 0.3, w: 0.2, h: 0.2 }],
    });
    const third = aCandidate({
      id: 'cand:c',
      normalisedText: 'something else',
      boundingBoxes: [{ imageId: IMG1, x: 0.6, y: 0.6, w: 0.2, h: 0.2 }],
    });

    const passA = collapseOverlap([survivor, loser, third], { pass: 'pre-match', imageOrder });
    const passB = collapseOverlap(passA.candidates, { pass: 'post-match', imageOrder });

    // All three share `resolvedWorkIdentity`, but `cand:b` is already spoken for.
    const b = passB.candidates.find((c) => c.id === 'cand:b')!;
    expect(b.collapsedIntoCandidateId).toBe('cand:a');
    expect(passB.collapsedIds).toEqual(['cand:c']);
    expect(passB.candidates.find((c) => c.id === 'cand:c')!.collapsedIntoCandidateId).toBe(
      'cand:a',
    );
  });

  it('T-AI-007k: the input candidates are not mutated', () => {
    const first = aCandidate({ id: 'cand:a' });
    const second = aCandidate({
      id: 'cand:b',
      sourceImageIds: [IMG2],
      boundingBoxes: [{ imageId: IMG2, x: 0.3, y: 0.3, w: 0.2, h: 0.2 }],
    });
    const input = [first, second];
    const snapshot = structuredClone(input);

    collapseOverlap(input, { pass: 'pre-match', imageOrder });

    expect(input).toEqual(snapshot);
  });
});
