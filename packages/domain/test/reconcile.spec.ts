/**
 * TASK-073 — `reconcile()` (US-005 AC-2, REQ-006, `T-BATCH-004`).
 *
 * ⚠ THE ASSERTION THAT MATTERS IS NOT "REMOVALS ARE CORRECT" — `removals.spec.ts`
 * already owns that. It is that the union spans the WHOLE BATCH: a work
 * photographed only on image 4 must keep its listing alive for images 1, 2, 3,
 * 5 and 6 too. Per-image reconciliation would propose removing nearly the
 * entire service on a capture that in fact confirmed it, and every failing
 * assertion below is that failure in a different disguise.
 */

import { describe, expect, it } from 'vitest';

import { reconcile, type ReconcileCandidate } from '../src/reconcile.js';
import type { RemovalCandidateListing } from '../src/removals.js';

const listing = (n: number, workIdentity: string): RemovalCandidateListing => ({
  listingId: `l-${String(n)}`,
  titleId: `t-${String(n)}`,
  workIdentity,
  state: 'active',
  service: 'netflix',
  tmdbName: `Film ${String(n)}`,
  rawExtractedText: null,
  releaseYear: 2021,
  posterPath: null,
  dateAdded: '2026-01-05',
});

const candidate = (
  workIdentity: string | null,
  sourceImageIds: readonly string[],
  collapsedInto: string | null = null,
): ReconcileCandidate => ({
  resolvedWorkIdentity: workIdentity,
  collapsedIntoCandidateId: collapsedInto,
  sourceImageIds,
});

/** A six-image full-update: one distinct work photographed on each image. */
const sixImageBatch = () => ({
  service: 'netflix' as const,
  candidates: [
    candidate('tmdb:movie:1', ['img-1']),
    candidate('tmdb:movie:2', ['img-2']),
    candidate('tmdb:movie:3', ['img-3']),
    candidate('tmdb:movie:4', ['img-4']),
    candidate('tmdb:movie:5', ['img-5']),
    candidate('tmdb:movie:6', ['img-6']),
  ],
  activeListings: [
    listing(1, 'tmdb:movie:1'),
    listing(2, 'tmdb:movie:2'),
    listing(3, 'tmdb:movie:3'),
    listing(4, 'tmdb:movie:4'),
    listing(5, 'tmdb:movie:5'),
    listing(6, 'tmdb:movie:6'),
  ],
  suppressed: new Set<string>(),
});

describe('reconcile', () => {
  it('T-BATCH-004: a six-image batch reconciles against the UNION, removing nothing', () => {
    // The whole list was photographed, across six screenshots. Reconciling
    // per image would find five of the six "missing" from each one and
    // propose removing 30 of the 36 (image, listing) pairs.
    const result = reconcile(sixImageBatch());

    expect(result.removals).toEqual([]);
    expect([...result.extractedWorkIdentities].sort()).toEqual([
      'tmdb:movie:1',
      'tmdb:movie:2',
      'tmdb:movie:3',
      'tmdb:movie:4',
      'tmdb:movie:5',
      'tmdb:movie:6',
    ]);
  });

  it('T-BATCH-004b: the union spans every image, evidenced not assumed', () => {
    expect(reconcile(sixImageBatch()).contributingImageIds).toEqual([
      'img-1',
      'img-2',
      'img-3',
      'img-4',
      'img-5',
      'img-6',
    ]);
  });

  it('T-BATCH-004c: a work seen ONLY on the last image still saves its listing', () => {
    // The single-image failure mode, isolated: if the union were built from
    // any proper subset of the batch, `tmdb:movie:6` would be proposed for
    // removal here.
    const input = sixImageBatch();
    const result = reconcile({
      ...input,
      candidates: input.candidates.filter((c) => c.sourceImageIds[0] === 'img-6'),
    });

    expect(result.removals.map((r) => r.listingId)).toEqual(['l-1', 'l-2', 'l-3', 'l-4', 'l-5']);
    expect(result.removals.map((r) => r.listingId)).not.toContain('l-6');
  });

  it('T-BATCH-004d: the same work on several overlapping images counts ONCE', () => {
    // Expected input, not an edge case: the owner scrolls and shoots, and the
    // rows either side of the seam appear twice (SD-02).
    const input = sixImageBatch();
    const result = reconcile({
      ...input,
      candidates: [
        candidate('tmdb:movie:1', ['img-1']),
        candidate('tmdb:movie:1', ['img-2']),
        ...input.candidates.slice(1),
      ],
    });

    expect(result.extractedWorkIdentities.size).toBe(6);
    expect(result.removals).toEqual([]);
    // …and the seam image is listed ONCE, not once per repeated row.
    expect(result.contributingImageIds.filter((id) => id === 'img-1')).toEqual(['img-1']);
  });

  it('T-BATCH-004n: two candidates from the SAME image contribute that image once', () => {
    const result = reconcile({
      ...sixImageBatch(),
      candidates: [candidate('tmdb:movie:1', ['img-1']), candidate('tmdb:movie:2', ['img-1'])],
    });

    expect(result.contributingImageIds).toEqual(['img-1']);
  });

  it('T-BATCH-004o: the batch service is honoured, not assumed', () => {
    // A Max batch reconciles Max. Hard-coding a service here would make a Max
    // full-update propose removing the owner's whole Netflix list while
    // leaving Max untouched — and every Netflix-only test would still pass.
    const result = reconcile({
      service: 'max',
      candidates: [],
      activeListings: [
        { ...listing(1, 'tmdb:movie:1'), service: 'netflix' },
        { ...listing(2, 'tmdb:movie:2'), service: 'max' },
      ],
      suppressed: new Set<string>(),
    });

    expect(result.removals.map((r) => r.listingId)).toEqual(['l-2']);
  });

  it('T-BATCH-004e: one candidate spanning two images contributes both', () => {
    const result = reconcile({
      ...sixImageBatch(),
      candidates: [candidate('tmdb:movie:1', ['img-1', 'img-2'])],
    });

    expect(result.contributingImageIds).toEqual(['img-1', 'img-2']);
  });

  it('T-BATCH-004f: an SD-02 collapse loser is excluded from the union AND from the images', () => {
    // Excluding it changes nothing — its identity lives on in the survivor —
    // and it is excluded anyway, because reading an identity off a discarded
    // row is indistinguishable from letting a REJECTED candidate keep a title
    // alive.
    const input = sixImageBatch();
    const result = reconcile({
      ...input,
      candidates: [...input.candidates, candidate('tmdb:movie:99', ['img-7'], 'cand-survivor')],
    });

    expect(result.extractedWorkIdentities.has('tmdb:movie:99')).toBe(false);
    expect(result.contributingImageIds).not.toContain('img-7');
  });

  it('T-BATCH-004g: an unresolved candidate keeps NOTHING alive', () => {
    // A candidate the extraction could not identify is not evidence that any
    // particular listing is still on the service.
    const input = sixImageBatch();
    const result = reconcile({
      ...input,
      candidates: [candidate(null, ['img-1']), ...input.candidates.slice(1)],
    });

    expect(result.removals.map((r) => r.listingId)).toEqual(['l-1']);
    expect(result.contributingImageIds).not.toContain('img-1');
  });

  it('T-BATCH-004h: reconciliation is service-scoped even over the union', () => {
    const input = sixImageBatch();
    const result = reconcile({
      ...input,
      candidates: [],
      activeListings: [
        { ...listing(9, 'tmdb:movie:9'), service: 'max' },
        listing(1, 'tmdb:movie:1'),
      ],
    });

    expect(result.removals.map((r) => r.listingId)).toEqual(['l-1']);
  });

  it('T-BATCH-004i: an empty batch is reconciliation over an empty union, not a no-op', () => {
    // A full-update that extracted nothing is a claim that the service is
    // empty. Whether the owner is SHOWN that is `buildReviewResponse`'s
    // decision (low-yield withholding); this function must still compute it,
    // or "found nothing" and "not telling you" become the same value.
    const result = reconcile({ ...sixImageBatch(), candidates: [] });

    expect(result.removals).toHaveLength(6);
    expect(result.contributingImageIds).toEqual([]);
  });
});
