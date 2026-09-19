import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReviewResponse, type BuildReviewInput, type ReviewCandidate } from '@nextup/domain';

import { ReviewPage } from '../src/pages/ReviewPage';
import { ReviewRoute } from '../src/containers/ReviewRoute';
import { apiClient, createApiClient, type ApiClient } from '../src/lib/apiClient';

const candidate: ReviewCandidate = {
  candidateId: 'addition',
  rawText: 'ORIGINAL READING',
  inferredTitle: null,
  basis: 'text',
  ocrSupport: 'exact',
  provider: 'llm',
  verdict: 'title-candidate',
  ocrConfidence: 0.9,
  resolvedWorkIdentity: 'tmdb:movie:1',
  match: {
    tmdbId: 1,
    mediaType: 'movie',
    name: 'Corrected identity',
    releaseYear: 1984,
    posterPath: null,
    score: 1,
    uncertain: false,
    ambiguous: false,
  },
  alternatives: [],
  sourceImageIds: [],
  tileCrop: null,
  disposition: 'corrected',
  collapsedIntoCandidateId: null,
  classification: 'new',
};

function review(overrides: Partial<BuildReviewInput> = {}) {
  return buildReviewResponse({
    batchId: 'final',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'ok',
    candidates: [candidate, { ...candidate, candidateId: 'discarded', disposition: 'discarded' }],
    disappearedListings: [
      {
        listingId: 'remove',
        titleId: 'old',
        name: 'Keep this title',
        releaseYear: 2020,
        posterPath: null,
        service: 'netflix',
        dateAdded: '2020-01-01',
      },
    ],
    imagesWithNoText: [],
    ...overrides,
  });
}

function mount(client: ApiClient) {
  render(
    <MemoryRouter initialEntries={['/batches/final/review']}>
      <Routes>
        <Route path="/batches/:batchId/review" element={<ReviewRoute client={client} />} />
        <Route path="/" element={<p>Applied successfully</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => sessionStorage.clear());

describe('T-UX-159 single final confirmation', () => {
  it('T-UX-159a: both modes require one summary with exact effective additions; Back and Escape preserve review', async () => {
    const onApply = vi.fn();
    const { rerender } = render(
      <ReviewPage review={review({ mode: 'append-only' })} onApply={onApply} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    let dialog = screen.getByRole('dialog', { name: 'Confirm changes' });
    expect(onApply).not.toHaveBeenCalled();
    expect(within(dialog).getByTestId('confirmation-additions').children).toHaveLength(1);
    expect(dialog).toHaveTextContent('Corrected identity (1984, film)');
    expect(dialog).not.toHaveTextContent('ORIGINAL READING');
    expect(dialog).toHaveTextContent('Nothing will be removed');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<ReviewPage review={review()} onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('removal-confirm-list')).toHaveTextContent('Keep this title');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back to review' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Keep this title' })).toBeChecked();
  });

  it('T-UX-159b: pending titles block the final summary and receive focus', async () => {
    const onApply = vi.fn();
    render(
      <ReviewPage
        review={review({ candidates: [{ ...candidate, disposition: 'pending' }] })}
        onApply={onApply}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByTestId('review-pending-error')).toHaveTextContent('1 title');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('candidate-addition')).toHaveFocus();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('T-UX-159c: the real removal PATCH is reread; zero-selected confirmation survives failure and retries explicitly', async () => {
    let unticked = false;
    let closes = 0;
    const writes: unknown[] = [];
    const client = createApiClient({
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/review'))
          return json(review({ untickedListingIds: new Set(unticked ? ['remove'] : []) }));
        if (url.endsWith('/removals')) {
          writes.push(JSON.parse(String(init?.body)));
          unticked = true;
          return json({ batchId: 'final', tickedCount: 0, untickedCount: 1 });
        }
        if (url.endsWith('/close')) {
          closes += 1;
          expect(JSON.parse(String(init?.body))).toEqual({ confirmRemovals: true });
          return closes === 1
            ? json({ error: { code: 'INTERNAL', message: 'Unavailable' } }, 500)
            : json({
                batchId: 'final',
                status: 'applied',
                serviceState: { service: 'netflix' },
                summary: { listingsCreated: 1, listingsRemoved: 0, removalGroupId: null },
                undoable: true,
              });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });
    mount(client);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Keep this title' }));
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
    expect(
      within(screen.getByTestId('removal-card')).getByTestId('candidate-consequence'),
    ).toHaveTextContent('Stays on your list');
    expect(writes).toEqual([{ tick: [], untick: ['remove'] }]);
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Nothing will be removed');
    expect(closes).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await screen.findByTestId('review-apply-error');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(closes).toBe(1);
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await screen.findByText('Applied successfully');
    expect(closes).toBe(2);
    expect(writes).toHaveLength(1);
  });

  it('T-UX-159d: an unavailable preflight never presents an authoritative summary or closes', async () => {
    const closeBatch = vi.fn();
    const getReview = vi
      .fn()
      .mockResolvedValueOnce(review())
      .mockRejectedValue(new Error('offline'));
    mount({ ...apiClient, getReview, closeBatch });
    await userEvent.click(await screen.findByRole('button', { name: 'Review changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(closeBatch).not.toHaveBeenCalled();
  });

  it('T-UX-159e: rapid final presses issue one close; Escape cannot dismiss an in-flight apply', async () => {
    const closeBatch = vi.fn(() => new Promise<never>(() => {}));
    mount({ ...apiClient, getReview: async () => review(), closeBatch });
    await userEvent.click(await screen.findByRole('button', { name: 'Review changes' }));
    const apply = await screen.findByRole('button', { name: 'Apply changes' });
    act(() => {
      fireEvent.click(apply);
      fireEvent.click(apply);
    });
    expect(closeBatch).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to review' })).toBeDisabled();
  });
});
