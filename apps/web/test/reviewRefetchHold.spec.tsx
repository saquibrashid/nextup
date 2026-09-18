/**
 * `T-UX-149` — the review list survives its own refetch.
 *
 * ⚠ **WHAT THE OWNER ACTUALLY REPORTED, AND WHY IT IS NOT A STYLE COMPLAINT.**
 * Working through a real capture on a phone: *"as I confirmed or searched or
 * did anything, it would navigate me back to the top of the page rather than
 * keeping me in line."* With ~19 rows to decide, every single decision cost
 * them their place in the list.
 *
 * The cause was structural, not a stray `scrollTo`. Every decision bumps the
 * generation counter that keys `useResource`, and that hook resets to
 * `{ kind: 'loading' }` on every key change — so `ReviewPage` swapped the whole
 * list for the §6.1 skeleton, the document collapsed to skeleton height, and
 * the browser had nowhere to keep the scroll offset. `ReviewRoute` now holds
 * the last good value across a refetch.
 *
 * ⚠ **THE SCROLL OFFSET ITSELF IS NOT ASSERTED HERE, DELIBERATELY.** jsdom does
 * not lay out, so `scrollY` is always 0 and an assertion on it would pass
 * whatever the component did — the classic test that cannot fail. What is
 * asserted is the *cause*: the rows stay mounted, and the loading state that
 * replaced them does not appear. `T-E2E-001` owns the real browser.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildReviewResponse } from '@nextup/domain';

import { ReviewRoute } from '../src/containers/ReviewRoute';
import { createApiClient, setUnauthorizedHandler } from '../src/lib/apiClient';

function reviewBody() {
  return buildReviewResponse({
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'append',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [
      {
        candidateId: 'cnd_1',
        rawExtractedText: 'Dune',
        normalisedText: 'dune',
        verdict: 'title' as const,
        confidence: 0.99,
        ocrSupport: 'corroborated' as const,
        cleanupVerdict: null,
        resolvedWorkIdentity: 'tmdb:movie:1',
        match: {
          workIdentity: 'tmdb:movie:1',
          mediaType: 'movie' as const,
          name: 'Dune',
          releaseYear: 2021,
          posterPath: null,
          score: 0.99,
          uncertain: false,
          ambiguous: false,
        },
        alternatives: [],
        sourceImageIds: ['img_1'],
        disposition: 'pending' as const,
        collapsedIntoCandidateId: null,
        classification: 'new' as const,
      },
    ],
    disappearedListings: [],
    imagesWithNoText: [],
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('T-UX-149 — a decision does not tear down the review list', () => {
  beforeEach(() => {
    setUnauthorizedHandler(null);
    window.sessionStorage.clear();
  });

  afterEach(() => {
    setUnauthorizedHandler(null);
    vi.restoreAllMocks();
  });

  it('T-UX-149a: the rows stay mounted while the refetch after a decision is in flight', async () => {
    let reviewLoads = 0;
    /** Resolves the SECOND review load, so the refetch can be held open. */
    let releaseRefetch: (() => void) | null = null;

    const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (method === 'GET' && url.includes('/review')) {
        reviewLoads += 1;
        if (reviewLoads === 1) return Promise.resolve(json(reviewBody()));
        // ⚠ HELD OPEN ON PURPOSE. The defect is only visible DURING the
        // refetch; a refetch that resolves immediately repaints the list
        // before anything can observe that it went away.
        return new Promise<Response>((resolve) => {
          releaseRefetch = () => resolve(json(reviewBody()));
        });
      }
      // The bulk confirm, whose success is what bumps the generation.
      return Promise.resolve(json({ confirmed: 1 }));
    };

    render(
      <MemoryRouter initialEntries={['/batches/bat_1/review']}>
        <Routes>
          <Route
            path="/batches/:batchId/review"
            element={
              <ReviewRoute client={createApiClient({ fetchImpl: fetchImpl as typeof fetch })} />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Dune')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /^Confirm all/ }));

    // The refetch has started and is deliberately unresolved.
    await waitFor(() => {
      expect(reviewLoads).toBe(2);
    });

    // ⚠ THE ASSERTION THAT FAILS WITHOUT THE FIX. Before it, `useResource`
    // returned `loading`, `ReviewPage` rendered the skeleton, and the row was
    // gone from the document — taking the scroll position with it.
    expect(screen.queryByTestId('review-loading')).toBeNull();
    expect(screen.getByText('Dune')).toBeTruthy();

    releaseRefetch?.();
    await waitFor(() => {
      expect(screen.getByText('Dune')).toBeTruthy();
    });
  });

  it('T-UX-149b: the FIRST load still shows the loading state — nothing to preserve yet', async () => {
    // ⚠ The limit on `a`. Holding a previous value must not suppress §6.1's
    // skeleton on a cold arrival, where the owner is waiting on content rather
    // than looking at it, and suppressing it would leave a blank screen.
    const fetchImpl = (): Promise<Response> => new Promise<Response>(() => {});

    render(
      <MemoryRouter initialEntries={['/batches/bat_1/review']}>
        <Routes>
          <Route
            path="/batches/:batchId/review"
            element={
              <ReviewRoute client={createApiClient({ fetchImpl: fetchImpl as typeof fetch })} />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('review-loading')).toBeTruthy();
  });
});
