/**
 * TASK-065 — the pure half of `GET /api/batches/:batchId/review`.
 *
 * `specs/testing.md`:
 *   `T-REV-010` — new-to-this-service candidates appear in `additions`
 *   `T-UX-063`  — unmatched candidates render in their own section with raw text
 *   `T-AI-004`  — every candidate is reachable in the review response; all
 *                 verdicts represented; nothing dropped
 *   `T-REV-006` — full-update shows ALL extracted titles (the safety property)
 *   `T-AI-021`  — low-yield full-update withholds the removal section entirely
 */

import { describe, expect, it } from 'vitest';

import { CLEANUP_VERDICTS } from '../src/enums.js';
import { DEGRADED_EXTRACTION_BANNER } from '../src/copy.js';
import {
  assertEveryCandidateRouted,
  buildReviewResponse,
  removalWithheldReason,
  removalsLabel,
  reviewBanner,
  sectionForCandidate,
  tileCropFor,
  type BuildReviewInput,
  type ReviewCandidate,
} from '../src/review.js';

const DUNE = 'tmdb:movie:438631';
const ANDOR = 'tmdb:tv:83867';

function candidate(over: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    candidateId: over.candidateId ?? 'c1',
    rawText: 'Dune',
    inferredTitle: 'Dune',
    basis: 'both',
    ocrSupport: 'exact',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 0.97,
    resolvedWorkIdentity: DUNE,
    match: null,
    alternatives: [],
    sourceImageIds: ['img1'],
    disposition: 'pending',
    collapsedIntoCandidateId: null,
    classification: 'new',
    ...over,
  };
}

function input(over: Partial<BuildReviewInput> = {}): BuildReviewInput {
  return {
    batchId: 'batch1',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'ok',
    candidates: [],
    disappearedListings: [],
    imagesWithNoText: [],
    ...over,
  };
}

const removal = {
  listingId: 'l1',
  titleId: 't1',
  name: 'Heat',
  releaseYear: 1995,
  posterPath: '/h.jpg',
  service: 'netflix' as const,
  dateAdded: '2026-01-04',
};

describe('T-REV-010 — new-to-this-service candidates appear in additions', () => {
  it('T-REV-010a · a new, matched, title-candidate lands in additions', () => {
    const res = buildReviewResponse(input({ candidates: [candidate()] }));
    expect(res.sections.additions.count).toBe(1);
    expect(res.sections.additions.items[0]?.candidateId).toBe('c1');
    expect(res.sections.additions.label).toBe('New to your list');
  });

  it('T-REV-010b · an already-present candidate does NOT land in additions', () => {
    const res = buildReviewResponse(
      input({
        candidates: [candidate({ classification: 'already-present-for-this-service' })],
      }),
    );
    expect(res.sections.additions.count).toBe(0);
    expect(res.sections.alreadyOnYourList.count).toBe(1);
  });

  it('T-REV-010c · a low-confidence verdict is still an addition — surfaced, not dropped', () => {
    const res = buildReviewResponse(
      input({ candidates: [candidate({ verdict: 'low-confidence' })] }),
    );
    expect(res.sections.additions.count).toBe(1);
  });

  it('T-REV-010d · an inferred-unverified verdict is still an addition (RSK-028 path)', () => {
    const res = buildReviewResponse(
      input({ candidates: [candidate({ verdict: 'inferred-unverified' })] }),
    );
    expect(res.sections.additions.count).toBe(1);
  });

  it('T-REV-010e · an SD-02 collapse loser is not rendered again', () => {
    const res = buildReviewResponse(
      input({
        candidates: [
          candidate({ candidateId: 'winner' }),
          candidate({
            candidateId: 'loser',
            collapsedIntoCandidateId: 'winner',
            disposition: 'discarded',
          }),
        ],
      }),
    );
    expect(res.sections.additions.count).toBe(1);
    expect(res.sections.additions.items[0]?.candidateId).toBe('winner');
  });
});

describe('T-UX-063 — unmatched candidates render in their own section with raw text', () => {
  it('T-UX-063a · an unmatched: work identity routes to unmatched, not additions', () => {
    const res = buildReviewResponse(
      input({
        candidates: [
          candidate({
            resolvedWorkIdentity: 'unmatched:9f2b1c4d5e6f7a80',
            classification: null,
            rawText: 'Somethign Unreadble',
          }),
        ],
      }),
    );
    expect(res.sections.additions.count).toBe(0);
    expect(res.sections.unmatched.count).toBe(1);
    expect(res.sections.unmatched.items[0]?.rawText).toBe('Somethign Unreadble');
    expect(res.sections.unmatched.label).toBe("Couldn't identify these");
  });

  it('T-UX-063b · a null work identity also routes to unmatched, never guessed as an addition', () => {
    const res = buildReviewResponse(
      input({
        candidates: [candidate({ resolvedWorkIdentity: null, classification: null })],
      }),
    );
    expect(res.sections.unmatched.count).toBe(1);
    expect(res.sections.additions.count).toBe(0);
  });

  it('T-UX-063c · the unmatched section is present in BOTH modes', () => {
    for (const mode of ['append-only', 'full-update'] as const) {
      const res = buildReviewResponse(
        input({
          mode,
          candidates: [candidate({ resolvedWorkIdentity: null, classification: null })],
        }),
      );
      expect(res.sections.unmatched.count).toBe(1);
    }
  });
});

describe('T-AI-004 — nothing is dropped; every verdict is reachable', () => {
  it('T-AI-004v · every CleanupVerdict routes to a real section', () => {
    for (const verdict of CLEANUP_VERDICTS) {
      const section = sectionForCandidate(candidate({ verdict }));
      expect(section).toBeTruthy();
    }
  });

  it('T-AI-004w · one candidate of every verdict is reachable in the response', () => {
    const candidates = CLEANUP_VERDICTS.map((verdict, i) =>
      candidate({ candidateId: `c${i}`, verdict }),
    );
    const res = buildReviewResponse(input({ candidates }));
    expect(() => assertEveryCandidateRouted(candidates, res)).not.toThrow();
  });

  it('T-AI-004x · chrome-suspected is collapsed but NEVER omitted, and carries a count', () => {
    const res = buildReviewResponse(
      input({ candidates: [candidate({ verdict: 'chrome-suspected' })] }),
    );
    expect(res.sections.probablyNotTitles.omitted).toBe(false);
    expect(res.sections.probablyNotTitles.collapsedByDefault).toBe(true);
    expect(res.sections.probablyNotTitles.count).toBe(1);
  });

  it('T-AI-004y · unreadable-tile gets its OWN section, never buried in the chrome group', () => {
    const res = buildReviewResponse(
      input({
        candidates: [candidate({ verdict: 'unreadable-tile', rawText: '', inferredTitle: null })],
      }),
    );
    expect(res.sections.unreadableTiles.count).toBe(1);
    expect(res.sections.probablyNotTitles.count).toBe(0);
    expect(res.sections.unreadableTiles.label).toBe("Couldn't read these");
  });

  it('T-AI-004z · an unreadable tile with no work identity does not leak into unmatched', () => {
    const res = buildReviewResponse(
      input({
        candidates: [
          candidate({
            verdict: 'unreadable-tile',
            resolvedWorkIdentity: null,
            classification: null,
          }),
        ],
      }),
    );
    expect(res.sections.unreadableTiles.count).toBe(1);
    expect(res.sections.unmatched.count).toBe(0);
  });

  it('T-AI-004aa · a chrome candidate that somehow resolved is still not an addition', () => {
    const res = buildReviewResponse(
      input({
        candidates: [candidate({ verdict: 'chrome-suspected', resolvedWorkIdentity: DUNE })],
      }),
    );
    expect(res.sections.additions.count).toBe(0);
    expect(res.sections.probablyNotTitles.count).toBe(1);
  });

  it('T-AI-004ab · assertEveryCandidateRouted actually throws when a candidate is lost', () => {
    const c = candidate();
    const res = buildReviewResponse(input({ candidates: [c] }));
    res.sections.additions.items = [];
    expect(() => assertEveryCandidateRouted([c], res)).toThrow(/REQ-012/);
  });

  it('T-AI-004ac · images that yielded no text are named, never silently skipped', () => {
    const res = buildReviewResponse(
      input({ imagesWithNoText: [{ imageId: 'i9', fileName: 'IMG_0428.PNG' }] }),
    );
    expect(res.imagesWithNoText).toEqual([{ imageId: 'i9', fileName: 'IMG_0428.PNG' }]);
  });
});

describe('T-REV-006 — full-update shows ALL extracted titles (the safety property)', () => {
  it('T-REV-006a · full-update shows alreadyOnYourList with the true count and all items', () => {
    const res = buildReviewResponse(
      input({
        mode: 'full-update',
        candidates: [
          candidate({ candidateId: 'a', classification: 'already-present-for-this-service' }),
          candidate({
            candidateId: 'b',
            classification: 'already-present-for-this-service',
            resolvedWorkIdentity: ANDOR,
          }),
        ],
      }),
    );
    expect(res.sections.alreadyOnYourList.omitted).toBe(false);
    expect(res.sections.alreadyOnYourList.count).toBe(2);
    expect(res.sections.alreadyOnYourList.items).toHaveLength(2);
  });

  it('T-REV-006b · append-only omits alreadyOnYourList — absence means nothing there', () => {
    const res = buildReviewResponse(
      input({
        mode: 'append-only',
        candidates: [candidate({ classification: 'already-present-for-this-service' })],
      }),
    );
    expect(res.sections.alreadyOnYourList.omitted).toBe(true);
    expect(res.sections.alreadyOnYourList.count).toBe(0);
    expect(res.sections.alreadyOnYourList.items).toEqual([]);
  });

  it('T-REV-006c · append-only omits removals entirely (REQ-022)', () => {
    const res = buildReviewResponse(input({ mode: 'append-only', disappearedListings: [removal] }));
    expect(res.sections.removals.omitted).toBe(true);
    expect(res.sections.removals.count).toBe(0);
    expect(res.sections.removals.items).toEqual([]);
    expect(res.sections.removals.withheld).toBe(false);
  });

  it('T-REV-006d · full-update surfaces removals, every one ticked by default (REQ-055)', () => {
    const res = buildReviewResponse(input({ disappearedListings: [removal] }));
    expect(res.sections.removals.omitted).toBe(false);
    expect(res.sections.removals.withheld).toBe(false);
    expect(res.sections.removals.count).toBe(1);
    expect(res.sections.removals.items[0]?.ticked).toBe(true);
  });

  it('T-REV-006e · the removal label names the service so the scope is unmistakable', () => {
    expect(removalsLabel('netflix')).toBe('No longer on Netflix');
    expect(removalsLabel('max')).toBe('No longer on Max');
  });
});

describe('T-AI-021 — low yield in full-update withholds the removal section entirely', () => {
  it('T-AI-021a · lowYield full-update withholds removals with reason low-yield', () => {
    const res = buildReviewResponse(input({ lowYield: true, disappearedListings: [removal] }));
    expect(res.sections.removals.withheld).toBe(true);
    expect(res.sections.removals.withheldReason).toBe('low-yield');
    expect(res.sections.removals.items).toEqual([]);
    expect(res.sections.removals.count).toBe(0);
  });

  it('T-AI-021b · lowYield full-update STILL shows additions and alreadyOnYourList', () => {
    const res = buildReviewResponse(
      input({
        lowYield: true,
        candidates: [
          candidate({ candidateId: 'a' }),
          candidate({ candidateId: 'b', classification: 'already-present-for-this-service' }),
        ],
      }),
    );
    expect(res.sections.additions.count).toBe(1);
    expect(res.sections.alreadyOnYourList.count).toBe(1);
  });

  it('T-AI-021c · lowYield append-only does NOT withhold — there is nothing to withhold', () => {
    const res = buildReviewResponse(input({ mode: 'append-only', lowYield: true }));
    expect(res.sections.removals.withheld).toBe(false);
    expect(res.sections.removals.omitted).toBe(true);
  });

  it('T-AI-021d · crossCheck llm-unavailable withholds removals as degraded-extraction', () => {
    const res = buildReviewResponse(
      input({
        crossCheck: 'llm-unavailable',
        degradedExtraction: true,
        disappearedListings: [removal],
      }),
    );
    expect(res.sections.removals.withheld).toBe(true);
    expect(res.sections.removals.withheldReason).toBe('degraded-extraction');
  });

  it('T-AI-021e · crossCheck ocr-unavailable still PERMITS removals — the primary reader ran', () => {
    const res = buildReviewResponse(
      input({ crossCheck: 'ocr-unavailable', disappearedListings: [removal] }),
    );
    expect(res.sections.removals.withheld).toBe(false);
    expect(res.sections.removals.count).toBe(1);
  });

  it('T-AI-021f · lowYield is reported ahead of degradation — it is the actionable one', () => {
    expect(removalWithheldReason({ lowYield: true, crossCheck: 'llm-unavailable' })).toBe(
      'low-yield',
    );
  });

  it('T-AI-021g · a healthy batch withholds nothing', () => {
    expect(removalWithheldReason({ lowYield: false, crossCheck: 'ok' })).toBeNull();
  });
});

describe('T-AI-021 — banner copy', () => {
  it('T-AI-021h · lowYield full-update explains that nothing will be removed', () => {
    const res = buildReviewResponse(input({ lowYield: true }));
    expect(res.banner).toContain('nothing will be removed by this batch');
  });

  it('T-AI-021i · lowYield append-only counts titles and screenshots, and pluralises', () => {
    expect(
      reviewBanner({
        mode: 'append-only',
        lowYield: true,
        crossCheck: 'ok',
        candidateCount: 1,
        imageCount: 1,
      }),
    ).toContain('Only 1 title was read from 1 screenshot.');
    expect(
      reviewBanner({
        mode: 'append-only',
        lowYield: true,
        crossCheck: 'ok',
        candidateCount: 3,
        imageCount: 7,
      }),
    ).toContain('Only 3 titles were read from 7 screenshots.');
  });

  it('T-AI-021j · a healthy batch has no banner at all', () => {
    expect(buildReviewResponse(input({ candidates: [candidate()] })).banner).toBeNull();
  });

  it('T-AI-021k · a degraded read is announced even when yield was fine', () => {
    const res = buildReviewResponse(
      input({ crossCheck: 'llm-unavailable', degradedExtraction: true }),
    );
    // ⚠ Asserted against the SHARED constant, not a substring. `ux-states.md`
    // §5.9 requires the same banner here and on `/batches/:batchId`, so the
    // thing under test is the identity, not the presence of some wording.
    expect(res.banner).toBe(DEGRADED_EXTRACTION_BANNER);
  });
});

describe('T-REV-010 — the response echoes the batch safety state verbatim', () => {
  it('T-REV-010f · batchId, service, mode and the three flags are passed through', () => {
    const res = buildReviewResponse(
      input({
        batchId: 'b9',
        service: 'max',
        mode: 'append-only',
        lowYield: true,
        degradedExtraction: true,
        crossCheck: 'llm-unavailable',
      }),
    );
    expect(res.batchId).toBe('b9');
    expect(res.service).toBe('max');
    expect(res.mode).toBe('append-only');
    expect(res.lowYield).toBe(true);
    expect(res.degradedExtraction).toBe(true);
    expect(res.crossCheck).toBe('llm-unavailable');
  });

  it('T-REV-010g · the input candidate array is not mutated', () => {
    const candidates = [candidate(), candidate({ candidateId: 'c2', verdict: 'chrome-suspected' })];
    const frozen = JSON.stringify(candidates);
    buildReviewResponse(input({ candidates }));
    expect(JSON.stringify(candidates)).toBe(frozen);
  });
});

// ── T-AI-041 · specs/ui.md §5.3a · the CROPPED tile thumbnail ──────────────
//
// §5.3a: "the cropped tile thumbnail must be rendered immediately beside the
// proposed title, at a size where the ARTWORK is legible (>= 96 px on the
// short edge)". `tileCropFor` decides WHICH region that is, or refuses.
describe('T-AI-041 - tileCropFor selects the tile region, or refuses', () => {
  const box = (
    over: Partial<{ imageId: string; x: number; y: number; w: number; h: number }> = {},
  ) => ({
    imageId: 'img_1',
    x: 0.2,
    y: 0.4,
    w: 0.2,
    h: 0.2,
    ...over,
  });

  it('T-AI-041f: an inferred-unverified candidate with an LLM tile box gets a padded crop', () => {
    const crop = tileCropFor({
      verdict: 'inferred-unverified',
      boxSource: 'llm',
      boundingBoxes: [box()],
    });

    expect(crop).not.toBeNull();
    expect(crop?.imageId).toBe('img_1');
    // ⚠ LITERALS, deliberately not `TILE_CROP_PADDING`. Expressing the
    // expectation in terms of the constant makes the assertion recompute the
    // implementation: setting the padding to 0 then satisfies it, and the
    // padding that stops the artwork being clipped can be deleted silently.
    // 0.2 wide, padded by 8% of its own width on each side => 0.184 .. 0.416.
    expect(crop?.x).toBeCloseTo(0.184, 6);
    expect(crop?.w).toBeCloseTo(0.232, 6);
  });

  it('T-AI-041g: an unreadable-tile candidate is cropped too - the tile is all it has', () => {
    expect(
      tileCropFor({ verdict: 'unreadable-tile', boxSource: 'llm', boundingBoxes: [box()] }),
    ).not.toBeNull();
  });

  // ⚠ THE LOAD-BEARING CASE. An OCR box is a text-LINE strip, not artwork.
  // Cropping to it fills the thumbnail with the caption the owner is already
  // shown as `rawText` and shows none of the artwork that is the entire
  // reason §5.3a makes the thumbnail mandatory. An implementation that
  // "crops the box" without reading `boxSource` passes every other case here.
  it('T-AI-041h: an OCR box yields NO crop - it is a text line, not the artwork', () => {
    expect(
      tileCropFor({
        verdict: 'inferred-unverified',
        boxSource: 'ocr',
        boundingBoxes: [box({ h: 0.02 })],
      }),
    ).toBeNull();
  });

  it('T-AI-041i: a verdict with no mandatory thumbnail gets no crop', () => {
    expect(
      tileCropFor({ verdict: 'title-candidate', boxSource: 'llm', boundingBoxes: [box()] }),
    ).toBeNull();
  });

  it('T-AI-041j: no boxes at all degrades to the whole image, not a throw', () => {
    expect(
      tileCropFor({ verdict: 'unreadable-tile', boxSource: 'llm', boundingBoxes: [] }),
    ).toBeNull();
  });

  it('T-AI-041k: boxes are unioned, but only those on the SAME image as the first', () => {
    const crop = tileCropFor({
      verdict: 'inferred-unverified',
      boxSource: 'llm',
      boundingBoxes: [
        box({ x: 0.2, y: 0.4, w: 0.1, h: 0.1 }),
        box({ x: 0.35, y: 0.4, w: 0.1, h: 0.1 }),
        // A box on a DIFFERENT image must not widen the rectangle - the crop
        // is only meaningful against the image it was measured on.
        box({ imageId: 'img_2', x: 0.9, y: 0.9, w: 0.05, h: 0.05 }),
      ],
    });

    expect(crop?.imageId).toBe('img_1');
    // Union spans 0.2 -> 0.45, i.e. 0.25 wide, plus 8% padding on both sides.
    expect(crop?.w).toBeCloseTo(0.29, 6);
    // and does NOT reach img_2's box at 0.9.
    expect((crop?.x ?? 0) + (crop?.w ?? 0)).toBeLessThan(0.9);
  });

  it('T-AI-041l: a crop is clamped into the image, never negative or past the edge', () => {
    const crop = tileCropFor({
      verdict: 'inferred-unverified',
      boxSource: 'llm',
      boundingBoxes: [box({ x: 0, y: 0, w: 1, h: 1 })],
    });

    expect(crop?.x).toBe(0);
    expect(crop?.y).toBe(0);
    expect(crop?.w).toBe(1);
    expect(crop?.h).toBe(1);
  });

  // A zero-width box scaled to fill a 96px thumbnail is an infinite
  // magnification of one column of pixels, which renders as a smear.
  it('T-AI-041m: a degenerate box is refused rather than magnified infinitely', () => {
    expect(
      tileCropFor({
        verdict: 'unreadable-tile',
        boxSource: 'llm',
        boundingBoxes: [box({ w: 0, h: 0 })],
      }),
    ).toBeNull();
  });

  it('T-AI-041n: a non-finite coordinate degrades to the whole image', () => {
    expect(
      tileCropFor({
        verdict: 'unreadable-tile',
        boxSource: 'llm',
        boundingBoxes: [box({ x: Number.NaN })],
      }),
    ).toBeNull();
  });
});
