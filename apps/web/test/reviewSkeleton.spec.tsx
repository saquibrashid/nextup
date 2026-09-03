/**
 * `T-UX-060` — `specs/ux-states.md` §6.1, the review's loading state.
 *
 * ⚠ **§6.1 AS FIRST WRITTEN NAMED A SOURCE THAT CANNOT SUPPLY IT.** It said the
 * section counts were "already shown from `GET /api/batches/:batchId`". That
 * payload carries `candidateCount` PER IMAGE and nothing about sections —
 * sectioning is `sectionForCandidate` (`packages/domain/src/review.ts`) and
 * happens when the review itself is built. So there is no per-section count to
 * show, from that endpoint or any other, before the review has loaded. The spec
 * has been corrected in place; what ships is a card count, carried forward in
 * history state from the screen the owner came from.
 *
 * ⚠ **NO SECOND REQUEST, BY DECISION.** A request issued to decide how big to
 * draw a loading state races the load it is covering for and frequently loses.
 * `d`, `i` and `j` exist to keep the carried count honest instead: an absent or
 * unusable one draws the COUNTLESS skeleton rather than a guess, because a
 * placeholder count is a claim about how much was read from the owner's
 * screenshots and a wrong one is a lie told on the screen that exists to show
 * what was found.
 *
 * ⚠ `c` and `d` are not input-validation box-ticking. History state survives a
 * reload, is restored by the back button, and can be handed to this build by a
 * browser session restored across a deploy — and it reaches a LOOP BOUND here.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildReviewResponse } from '@nextup/domain';

import {
  ReviewSkeleton,
  REVIEW_SKELETON_MAX,
  parseSkeletonCount,
} from '../src/components/ReviewSkeleton';
import { ReviewRoute } from '../src/containers/ReviewRoute';
import { BatchStatusRoute, skeletonState } from '../src/containers/BatchStatusRoute';
import type { ApiClient, BatchStatus } from '../src/lib/apiClient';

function emptyReview() {
  return buildReviewResponse({
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'append',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [],
    disappearedListings: [],
    imagesWithNoText: [],
  });
}

/** A client whose review load never settles, so the loading state holds still. */
function pendingClient(): ApiClient {
  return { getReview: () => new Promise<never>(() => {}) } as unknown as ApiClient;
}

function image(candidateCount: number | null): BatchStatus['images'][number] {
  return {
    imageId: `img_${String(candidateCount)}`,
    fileName: 'shot.png',
    ingestSource: 'file',
    available: true,
    retainUntil: null,
    candidateCount,
    href: '/api/images/img_1',
  };
}

function batch(images: BatchStatus['images'], status = 'in-review'): BatchStatus {
  return {
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'append',
    status,
    derivedFromBatchId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    submittedAt: null,
    completedAt: null,
    images,
    extractionError: null,
    lowYield: false,
    provenance: { created: [], modified: [], removed: [] },
    changedNothing: false,
    titles: [],
  } as unknown as BatchStatus;
}

function renderReview(state: unknown, client: ApiClient = pendingClient()) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/batches/bat_1/review', state }]}>
      <Routes>
        <Route path="/batches/:batchId/review" element={<ReviewRoute client={client} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('T-UX-060 — review loading skeleton (§6.1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T-UX-060a: a known count draws that many placeholder cards', () => {
    render(<ReviewSkeleton count={3} />);

    expect(screen.getAllByTestId('review-skeleton-card')).toHaveLength(3);
  });

  it('T-UX-060b: no count draws the countless skeleton and NO cards', () => {
    render(<ReviewSkeleton count={null} />);

    expect(screen.getByTestId('review-skeleton').getAttribute('data-count')).toBe('unknown');
    expect(screen.queryAllByTestId('review-skeleton-card')).toHaveLength(0);
    expect(screen.getByTestId('review-skeleton-block')).toBeTruthy();
  });

  it('T-UX-060c: unusable history state yields no count rather than a guess', () => {
    expect(parseSkeletonCount(undefined)).toBe(null);
    expect(parseSkeletonCount(null)).toBe(null);
    expect(parseSkeletonCount({})).toBe(null);
    expect(parseSkeletonCount({ skeletonCount: '4' })).toBe(null);
    expect(parseSkeletonCount({ skeletonCount: 2.5 })).toBe(null);
    expect(parseSkeletonCount({ skeletonCount: Number.NaN })).toBe(null);
    expect(parseSkeletonCount({ skeletonCount: -1 })).toBe(null);
    // ⚠ Zero is UNUSABLE, not "none": a batch with nothing extracted is §6.2 /
    // §6.3 and never reaches this state, so a zero here means the count was lost.
    expect(parseSkeletonCount({ skeletonCount: 0 })).toBe(null);
    expect(parseSkeletonCount({ skeletonCount: 4 })).toBe(4);
  });

  it('T-UX-060d: an absurd carried count is capped before it becomes a loop bound', () => {
    expect(parseSkeletonCount({ skeletonCount: 10_000 })).toBe(REVIEW_SKELETON_MAX);
    expect(REVIEW_SKELETON_MAX).toBeLessThan(100);

    render(<ReviewSkeleton count={parseSkeletonCount({ skeletonCount: 10_000 }) ?? 0} />);
    expect(screen.getAllByTestId('review-skeleton-card')).toHaveLength(REVIEW_SKELETON_MAX);
  });

  it('T-UX-060e: the review sizes its skeleton from the carried count', async () => {
    renderReview({ skeletonCount: 5 });

    expect((await screen.findAllByTestId('review-skeleton-card')).length).toBe(5);
  });

  it('T-UX-060f: a cold deep-link gets the countless skeleton, not an empty one', async () => {
    renderReview(undefined);

    expect((await screen.findByTestId('review-skeleton')).getAttribute('data-count')).toBe(
      'unknown',
    );
    expect(screen.queryAllByTestId('review-skeleton-card')).toHaveLength(0);
  });

  it('T-UX-060g: NO second request is issued to size the skeleton', async () => {
    const getReview = vi.fn(() => new Promise<never>(() => {}));
    const getBatch = vi.fn();
    renderReview({ skeletonCount: 2 }, { getReview, getBatch } as unknown as ApiClient);

    await screen.findByTestId('review-skeleton');
    expect(getBatch).not.toHaveBeenCalled();
    expect(getReview).toHaveBeenCalledTimes(1);
  });

  it('T-UX-060h: the skeleton is hidden from assistive tech, the status text is not', async () => {
    renderReview({ skeletonCount: 2 });

    // The wait is announced ONCE, by the status paragraph. A screen reader that
    // also walked the placeholders would hear it again, meaninglessly.
    expect((await screen.findByTestId('review-skeleton')).getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('review-loading').getAttribute('aria-hidden')).toBe(null);
  });

  it('T-UX-060i: the skeleton is gone once the review has loaded', async () => {
    const client = { getReview: () => Promise.resolve(emptyReview()) } as unknown as ApiClient;
    renderReview({ skeletonCount: 5 }, client);

    await screen.findByTestId('review-action-bar');
    expect(screen.queryByTestId('review-skeleton')).toBe(null);
  });

  it('T-UX-060j: the carried count is the sum across the batch images', () => {
    expect(skeletonState(batch([image(3), image(4)]))).toEqual({ skeletonCount: 7 });
    expect(skeletonState(null)).toBe(undefined);
  });

  it('T-UX-060k: an image that has not reported carries NO count rather than a short one', () => {
    // Summing `null` as zero would draw a confidently-too-small skeleton.
    expect(skeletonState(batch([image(3), image(null)]))).toBe(undefined);
  });

  it('T-UX-060l: the batch screen hands the count to the review on the way through', async () => {
    let seen: unknown = 'never rendered';
    function Spy(): null {
      seen = useLocation().state;
      return null;
    }
    const client = {
      getBatch: () => Promise.resolve(batch([image(2), image(6)])),
    } as unknown as ApiClient;

    render(
      <MemoryRouter initialEntries={['/batches/bat_1']}>
        <Routes>
          <Route path="/batches/:batchId" element={<BatchStatusRoute client={client} />} />
          <Route path="/batches/:batchId/review" element={<Spy />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(seen).toEqual({ skeletonCount: 8 });
    });
  });

  it('T-UX-060m: the count is fixed on arrival, not re-read as history changes', async () => {
    // ⚠ A LIVE STATE CHANGE ON A MOUNTED ROUTE, not a re-render of a new tree —
    // remounting would reset the state this case exists to pin. `ReviewRoute`
    // itself replaces `location.state` when a close navigates away, and the
    // browser restores it on a back button; a skeleton that re-read it would
    // change shape underneath a load already in flight.
    function StateChanger(): null {
      const navigate = useNavigate();
      useEffect(() => {
        navigate('/batches/bat_1/review', { replace: true, state: { skeletonCount: 1 } });
      }, [navigate]);
      return null;
    }

    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/batches/bat_1/review', state: { skeletonCount: 5 } }]}
      >
        <Routes>
          <Route
            path="/batches/:batchId/review"
            element={
              <>
                <ReviewRoute client={pendingClient()} />
                <StateChanger />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findAllByTestId('review-skeleton-card');
    expect(screen.getAllByTestId('review-skeleton-card')).toHaveLength(5);
  });
});
