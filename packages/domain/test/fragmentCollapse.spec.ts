/**
 * TASK-203 — the fragment collapse (`specs/data-model.md` §7.4a, TASK-199
 * finding (a)).
 *
 * Test id: `T-AI-048` — "An OCR fragment of a title another candidate already
 * holds WHOLE, on the same caption, collapses into it."
 *
 * ⚠ EVERY TEST BELOW HAS A DISCRIMINATING TWIN, and the twins are the point.
 * Text containment points BOTH WAYS in the real corpus — `wicked` ⊂ `wicked for
 * good` (fragment is false) but `true detective` ⊂ `true detective night
 * country` (the CONTAINER is false) — and the two are identical in shape,
 * length, prefix position and `ocrSupport`. A test suite that only asserts the
 * collapses would pass just as happily for a rule that collapses everything,
 * which loses real titles. Each guard therefore has a case that must NOT
 * collapse; delete the guard and that case fails.
 */

import { describe, expect, it } from 'vitest';

import {
  FRAGMENT_MAX_VERTICAL_GAP,
  collapseFragments,
  containsAtTokenBoundary,
} from '../src/overlap.js';
import type { ExtractionCandidate } from '../src/types.js';

const NOW = '2026-01-01T00:00:00.000Z';
const BATCH = '01J9ZQ0000000000000000BAT1';
const IMG1 = '01J9ZQ0000000000000000IMG1';
const IMG2 = '01J9ZQ0000000000000000IMG2';

const imageOrder = [IMG1, IMG2];

function aCandidate(overrides: Partial<ExtractionCandidate> = {}): ExtractionCandidate {
  return {
    id: `cand:${BATCH}:${IMG1}:1`,
    type: 'extractionCandidate',
    ownerId: 'o_9f2c1a7b',
    batchId: BATCH,
    sourceImageIds: [IMG1],
    rawText: 'Wicked',
    inferredTitle: 'Wicked',
    basis: 'text',
    ocrSupport: 'exact',
    provider: 'llm',
    normalisedText: 'wicked',
    extractedYear: null,
    boundingBoxes: [{ imageId: IMG1, x: 0.1, y: 0.5, w: 0.2, h: 0.02 }],
    boxSource: 'ocr',
    ocrConfidence: 0.9,
    cleanupVerdict: 'title-candidate',
    resolvedWorkIdentity: null,
    matchCandidates: [],
    classification: null,
    reviewDisposition: 'pending',
    correctedToTmdbId: null,
    createdAt: NOW,
    collapsedIntoCandidateId: null,
    ...overrides,
  };
}

/** A caption pair: the whole title, and a fragment sitting right on top of it. */
function pair(
  hostText: string,
  fragmentText: string,
  fragmentY: number,
): [ExtractionCandidate, ExtractionCandidate] {
  const host = aCandidate({
    id: 'cand:host',
    normalisedText: hostText,
    rawText: hostText,
    boundingBoxes: [{ imageId: IMG1, x: 0.1, y: 0.5, w: 0.3, h: 0.02 }],
  });
  const fragment = aCandidate({
    id: 'cand:fragment',
    normalisedText: fragmentText,
    rawText: fragmentText,
    boundingBoxes: [{ imageId: IMG1, x: 0.1, y: fragmentY, w: 0.15, h: 0.02 }],
  });
  return [host, fragment];
}

describe('T-AI-048 · the fragment collapse', () => {
  it('T-AI-048a: a fragment of a caption collapses into the candidate holding it whole, and is RETAINED pointing at the survivor', () => {
    const [host, fragment] = pair('wicked for good', 'wicked', 0.5);

    const result = collapseFragments([host, fragment], { pass: 'pre-match', imageOrder });

    // REQ-012 — the loser survives in the array. A collapse that removed the
    // row would be indistinguishable from a failed extraction.
    expect(result.candidates).toHaveLength(2);
    const loser = result.candidates.find((c) => c.id === 'cand:fragment')!;
    expect(loser.collapsedIntoCandidateId).toBe('cand:host');
    expect(loser.reviewDisposition).toBe('discarded');

    const survivor = result.candidates.find((c) => c.id === 'cand:host')!;
    expect(survivor.collapsedIntoCandidateId).toBeNull();
    expect(result.collapsedIds).toEqual(['cand:fragment']);
    expect(result.survivorIds).toEqual(['cand:host']);
  });

  it('T-AI-048b: the survivor absorbs the fragment\u2019s geometry and its OCR confidence', () => {
    const [host, fragment] = pair('ladies first', 'first', 0.5);
    const withConfidence = { ...fragment, ocrConfidence: 0.99 };

    const result = collapseFragments([host, withConfidence], { pass: 'pre-match', imageOrder });

    const survivor = result.candidates.find((c) => c.id === 'cand:host')!;
    expect(survivor.boundingBoxes).toHaveLength(2);
    expect(survivor.ocrConfidence).toBe(0.99);
  });

  /*
   * ⚠ THE PROXIMITY GUARD — the twin that carries the whole safety property.
   * `true detective` is a token prefix of `true detective night country`
   * exactly as `wicked` is of `wicked for good`, and the answer key marks the
   * CONTAINER false. Only the vertical gap tells them apart. Delete the guard
   * and this test fails while T-AI-048a still passes.
   */
  it('T-AI-048c: a shorter DIFFERENT title on another tile does not collapse, however cleanly it is contained', () => {
    const [host, fragment] = pair('true detective night country', 'true detective', 0.62);
    expect(
      fragment.boundingBoxes[0]!.y - (host.boundingBoxes[0]!.y + host.boundingBoxes[0]!.h),
    ).toBeGreaterThan(FRAGMENT_MAX_VERTICAL_GAP);

    const result = collapseFragments([host, fragment], { pass: 'pre-match', imageOrder });

    expect(result.collapsedIds).toEqual([]);
    expect(result.candidates.every((c) => c.collapsedIntoCandidateId === null)).toBe(true);
  });

  it('T-AI-048d: the measured corpus gaps fall on the right side of the threshold', () => {
    // Accepted gaps in the golden corpus, and rejected ones. The constant is
    // measured, not chosen: it must clear every real fragment and refuse every
    // different tile.
    for (const accepted of [0, 0, 0, 0.0047]) {
      expect(accepted).toBeLessThanOrEqual(FRAGMENT_MAX_VERTICAL_GAP);
    }
    for (const rejected of [0.063, 0.083, 0.096, 0.103, 0.116]) {
      expect(rejected).toBeGreaterThan(FRAGMENT_MAX_VERTICAL_GAP);
    }
  });

  /*
   * ⚠ THE TOKEN-BOUNDARY GUARD. WWE `Raw` is the case TASK-198 already cost
   * recall on once; a bare `includes` would collapse it into `brawl`.
   */
  it('T-AI-048e: containment is token-anchored — `raw` is not a fragment of `brawl`', () => {
    expect(containsAtTokenBoundary('celebrity brawl', 'raw')).toBe(false);
    expect(containsAtTokenBoundary('wwe raw talk', 'raw')).toBe(true);
    expect(containsAtTokenBoundary('wicked', 'wicked')).toBe(false);

    const [host, fragment] = pair('celebrity brawl', 'raw', 0.5);
    const result = collapseFragments([host, fragment], { pass: 'pre-match', imageOrder });
    expect(result.collapsedIds).toEqual([]);
  });

  /*
   * ⚠ THE SAME-IMAGE GUARD. Two tiles on two screenshots are two works, and
   * their coordinates are not comparable at all — a gap of 0 across two images
   * means nothing.
   */
  it('T-AI-048f: a containment spanning two images does not collapse, even at gap zero', () => {
    const host = aCandidate({
      id: 'cand:host',
      normalisedText: 'wicked for good',
      boundingBoxes: [{ imageId: IMG1, x: 0.1, y: 0.5, w: 0.3, h: 0.02 }],
    });
    const elsewhere = aCandidate({
      id: 'cand:fragment',
      normalisedText: 'wicked',
      sourceImageIds: [IMG2],
      boundingBoxes: [{ imageId: IMG2, x: 0.1, y: 0.5, w: 0.15, h: 0.02 }],
    });

    const result = collapseFragments([host, elsewhere], { pass: 'pre-match', imageOrder });

    expect(result.collapsedIds).toEqual([]);
  });

  /*
   * ⚠ THE VERDICT GUARD. `hbo` ⊂ `hbo original` are BOTH chrome. Letting
   * verdicts mix would silently reclassify chrome as part of a title.
   */
  it('T-AI-048g: chrome does not collapse, and a title never absorbs chrome', () => {
    const [host, fragment] = pair('hbo original', 'hbo', 0.5);
    const chromePair = [
      { ...host, cleanupVerdict: 'chrome-suspected' as const },
      { ...fragment, cleanupVerdict: 'chrome-suspected' as const },
    ];

    expect(collapseFragments(chromePair, { pass: 'pre-match', imageOrder }).collapsedIds).toEqual(
      [],
    );

    const mixed = [host, { ...fragment, cleanupVerdict: 'chrome-suspected' as const }];
    expect(collapseFragments(mixed, { pass: 'pre-match', imageOrder }).collapsedIds).toEqual([]);
  });

  /*
   * ⚠ THE MAXIMAL-HOST RULE. `stranger things vhs` is a fragment of `stranger
   * things vhs special edition` and could itself have hosted something shorter.
   * Parenting onto a candidate that is itself collapsing would leave
   * `collapsedIntoCandidateId` pointing at a LOSER, which §7.4 forbids.
   */
  it('T-AI-048h: a three-way chain parents both fragments onto the maximal host, never onto each other', () => {
    const whole = aCandidate({
      id: 'cand:whole',
      normalisedText: 'stranger things vhs special edition',
      boundingBoxes: [{ imageId: IMG1, x: 0.1, y: 0.5, w: 0.4, h: 0.02 }],
    });
    const mid = aCandidate({
      id: 'cand:mid',
      normalisedText: 'stranger things vhs',
      boundingBoxes: [{ imageId: IMG1, x: 0.1, y: 0.5, w: 0.25, h: 0.02 }],
    });
    const tail = aCandidate({
      id: 'cand:tail',
      normalisedText: 'special edition',
      boundingBoxes: [{ imageId: IMG1, x: 0.3, y: 0.5, w: 0.2, h: 0.02 }],
    });

    const result = collapseFragments([whole, mid, tail], { pass: 'pre-match', imageOrder });

    const byId = new Map(result.candidates.map((c) => [c.id, c]));
    expect(byId.get('cand:mid')!.collapsedIntoCandidateId).toBe('cand:whole');
    expect(byId.get('cand:tail')!.collapsedIntoCandidateId).toBe('cand:whole');
    expect(byId.get('cand:whole')!.collapsedIntoCandidateId).toBeNull();
    // Every pointer resolves to a survivor.
    for (const c of result.candidates) {
      if (c.collapsedIntoCandidateId !== null) {
        expect(byId.get(c.collapsedIntoCandidateId)!.collapsedIntoCandidateId).toBeNull();
      }
    }
  });

  it('T-AI-048k: when a fragment has TWO possible hosts and one of them is itself collapsing, only the maximal host adopts', () => {
    /*
     * ⚠ THE TWIN FOR 048h, AND THE ONE THAT ACTUALLY BITES. In 048h the two
     * fragments do not contain each other, so every host is already maximal
     * and the rule is unexercised. Here `stranger things` is contained by BOTH
     * `stranger things vhs` and the whole caption, and the losing host sorts
     * FIRST by §7.4's order key — so dropping the maximal filter parents a
     * loser onto a loser, which is exactly the corruption the rule prevents.
     */
    const mid = aCandidate({
      id: 'cand:mid',
      normalisedText: 'stranger things vhs',
      boundingBoxes: [{ imageId: IMG1, x: 0.1, y: 0.5, w: 0.25, h: 0.002 }],
    });
    const whole = aCandidate({
      id: 'cand:whole',
      normalisedText: 'stranger things vhs special edition',
      boundingBoxes: [{ imageId: IMG1, x: 0.1, y: 0.505, w: 0.4, h: 0.002 }],
    });
    const short = aCandidate({
      id: 'cand:short',
      normalisedText: 'stranger things',
      boundingBoxes: [{ imageId: IMG1, x: 0.1, y: 0.51, w: 0.2, h: 0.002 }],
    });

    const result = collapseFragments([mid, whole, short], { pass: 'pre-match', imageOrder });

    const byId = new Map(result.candidates.map((c) => [c.id, c]));
    expect(byId.get('cand:short')!.collapsedIntoCandidateId).toBe('cand:whole');
    expect(byId.get('cand:mid')!.collapsedIntoCandidateId).toBe('cand:whole');
    expect(byId.get('cand:whole')!.collapsedIntoCandidateId).toBeNull();
  });

  it('T-AI-048i: a candidate already collapsed by the exact pass is left alone, on both sides', () => {
    const [host, fragment] = pair('wicked for good', 'wicked', 0.5);
    const alreadyGone = { ...fragment, collapsedIntoCandidateId: 'cand:elsewhere' };

    const result = collapseFragments([host, alreadyGone], { pass: 'pre-match', imageOrder });

    expect(result.collapsedIds).toEqual([]);
    expect(result.candidates.find((c) => c.id === 'cand:fragment')!.collapsedIntoCandidateId).toBe(
      'cand:elsewhere',
    );
  });

  it('T-AI-048j: a candidate with no geometry never collapses — absent evidence is not proximity', () => {
    const [host, fragment] = pair('wicked for good', 'wicked', 0.5);
    const noBoxes = { ...fragment, boundingBoxes: [] };

    const result = collapseFragments([host, noBoxes], { pass: 'pre-match', imageOrder });

    expect(result.collapsedIds).toEqual([]);
  });
});
