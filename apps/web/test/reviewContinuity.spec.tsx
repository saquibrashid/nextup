import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReviewResponse, type ReviewCandidate, type ReviewResponse } from '@nextup/domain';
import { apiClient, type ApiClient, type BatchStatus } from '../src/lib/apiClient';
import { ReviewRoute } from '../src/containers/ReviewRoute';
import { ReviewPage } from '../src/pages/ReviewPage';

function candidate(id = 'one', overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    candidateId: id,
    rawText: `Title ${id}`,
    inferredTitle: null,
    basis: 'text',
    ocrSupport: 'exact',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 1,
    resolvedWorkIdentity: `tmdb:movie:${id === 'one' ? 1 : 2}`,
    match: {
      tmdbId: id === 'one' ? 1 : 2,
      mediaType: 'movie',
      name: `Title ${id}`,
      releaseYear: 2020,
      posterPath: null,
      score: 1,
      uncertain: false,
      ambiguous: false,
    },
    alternatives: [],
    sourceImageIds: ['image'],
    tileCrop: null,
    disposition: 'pending',
    collapsedIntoCandidateId: null,
    classification: 'new',
    ...overrides,
  };
}
function review(
  items: ReviewCandidate[],
  mode: 'append-only' | 'full-update' = 'full-update',
): ReviewResponse {
  return buildReviewResponse({
    batchId: 'review',
    service: 'netflix',
    mode,
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'ok',
    candidates: items,
    disappearedListings: [],
    imagesWithNoText: [],
  });
}
function fixture(items = [candidate()]) {
  const source: BatchStatus = {
    batchId: 'review',
    service: 'netflix',
    mode: 'full-update',
    status: 'in-review',
    derivedFromBatchId: null,
    createdAt: '2026-09-20T12:00:00Z',
    submittedAt: null,
    completedAt: null,
    images: [
      {
        imageId: 'image',
        fileName: 'capture.png',
        ingestSource: 'upload',
        available: true,
        retainUntil: null,
        candidateCount: items.length,
        href: '/api/images/image',
      },
    ],
    extractionError: null,
    lowYield: false,
    changedNothing: true,
    provenance: { created: [], modified: [], removed: [] },
    titles: [],
  };
  const client = {
    ...apiClient,
    getReview: vi.fn<ApiClient['getReview']>(async () => structuredClone(review(items))),
    getBatch: vi.fn<ApiClient['getBatch']>(async () => structuredClone(source)),
    listBatches: vi.fn<ApiClient['listBatches']>(async () => ({
      batches:
        source.status === 'in-review'
          ? [{ ...source, undoneAt: null, counts: { created: 0, modified: 0, removed: 0 } }]
          : [],
    })),
    patchCandidate: vi.fn<ApiClient['patchCandidate']>(async (_batch, id, body) => {
      const item = items.find((row) => row.candidateId === id);
      if (item === undefined) throw new Error('Missing fixture candidate');
      if ('reclassifyAsTitle' in body) {
        item.verdict = 'title-candidate';
        item.disposition = 'pending';
      } else {
        item.disposition = body.disposition;
        if (body.disposition === 'corrected') {
          item.resolvedWorkIdentity = `tmdb:${body.mediaType}:${body.tmdbId}`;
          item.classification = 'new';
          item.verdict = 'title-candidate';
          item.match = {
            tmdbId: body.tmdbId,
            mediaType: 'movie',
            name: body.correctedName ?? 'Chosen title',
            releaseYear: body.correctedReleaseYear ?? null,
            posterPath: body.correctedPosterPath ?? null,
            uncertain: false,
            ambiguous: false,
            score: 1,
          };
        }
      }
      return {
        candidateId: id,
        rawText: item.rawText,
        inferredTitle: null,
        verdict: item.verdict,
        resolvedWorkIdentity: item.resolvedWorkIdentity,
        correctedToTmdbId: null,
        disposition: item.disposition,
      };
    }),
    confirmAllCandidates: vi.fn<ApiClient['confirmAllCandidates']>(async (_batch, section) => {
      for (const item of items) if (item.disposition === 'pending') item.disposition = 'confirmed';
      return { section, confirmed: items.length, skipped: 0 };
    }),
    searchTmdb: vi.fn<ApiClient['searchTmdb']>(async () => ({
      items: [
        {
          tmdbId: 99,
          mediaType: 'movie',
          name: 'Correct title',
          releaseYear: 2024,
          posterPath: null,
        },
      ],
    })),
    discardBatch: vi.fn<ApiClient['discardBatch']>(async () => {
      source.status = 'discarded';
      return {};
    }),
    reextractBatch: vi.fn<ApiClient['reextractBatch']>(async () => ({
      batchId: 'derived',
      derivedFromBatchId: 'review',
      status: 'submitted',
    })),
  };
  return { client, items, source };
}
function mount(client: ApiClient) {
  return render(
    <MemoryRouter initialEntries={['/batches/review/review']}>
      <Routes>
        <Route path="/batches/:batchId/review" element={<ReviewRoute client={client} />} />
        <Route path="/batches/derived" element={<h1>New extraction</h1>} />
        <Route path="/upload" element={<h1>Fresh screenshots</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}
function online(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  fireEvent(window, new Event(value ? 'online' : 'offline'));
}
const card = (id = 'one') => within(screen.getByTestId(`candidate-${id}`));
beforeEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  online(true);
});

describe('T-UX-162 reversible review and recovery', () => {
  it('T-UX-162a: confirmed and discarded decisions stay editable on the real route', async () => {
    const f = fixture([candidate('one', { disposition: 'confirmed' })]);
    mount(f.client);
    await screen.findByTestId('candidate-one');
    fireEvent.click(card().getByRole('button', { name: 'Change decision' }));
    fireEvent.click(card().getByTestId('addition-discard'));
    await waitFor(() =>
      expect(card().getByTestId('addition-outcome')).toHaveTextContent('Discarded'),
    );
    fireEvent.click(card().getByRole('button', { name: 'Change decision' }));
    fireEvent.click(card().getByTestId('addition-keep'));
    await waitFor(() => expect(f.items[0]?.disposition).toBe('confirmed'));
    expect(f.client.patchCandidate).toHaveBeenCalledTimes(2);
  });

  it('T-UX-162b: bulk confirmation is one atomic request and its choices can be reversed individually', async () => {
    const f = fixture([candidate(), candidate('two')]);
    mount(f.client);
    fireEvent.click(await screen.findByTestId('confirm-all-button'));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Change decision' })).toHaveLength(2),
    );
    expect(f.client.confirmAllCandidates).toHaveBeenCalledExactlyOnceWith('review', 'additions');
    expect(f.client.patchCandidate).not.toHaveBeenCalled();
    fireEvent.click(card().getByRole('button', { name: 'Change decision' }));
    fireEvent.click(card().getByTestId('addition-discard'));
    await waitFor(() => expect(f.items[0]?.disposition).toBe('discarded'));
    expect(f.items[1]?.disposition).toBe('confirmed');
  });

  it('T-UX-162c: offline intent survives remount and reconnect never replays it', async () => {
    const f = fixture();
    const first = mount(f.client);
    await screen.findByTestId('candidate-one');
    online(false);
    fireEvent.click(card().getByTestId('addition-keep'));
    await screen.findByRole('region', { name: 'Unsaved review choices' });
    expect(f.client.patchCandidate).not.toHaveBeenCalled();
    first.unmount();
    mount(f.client);
    await screen.findByRole('region', { name: 'Unsaved review choices' });
    online(true);
    expect(f.client.patchCandidate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check and save choices' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Unsaved review choices' })).toBeNull(),
    );
    expect(f.client.patchCandidate).toHaveBeenCalledExactlyOnceWith('review', 'one', {
      disposition: 'confirmed',
    });
  });

  it('T-UX-162d: conflicting saved decisions win until the owner explicitly chooses otherwise', async () => {
    const item = candidate();
    const f = fixture([item]);
    mount(f.client);
    await screen.findByTestId('candidate-one');
    online(false);
    fireEvent.click(card().getByTestId('addition-discard'));
    await screen.findByRole('region', { name: 'Unsaved review choices' });
    item.disposition = 'confirmed';
    online(true);
    fireEvent.click(screen.getByRole('button', { name: 'Check and save choices' }));
    await screen.findByText(/Saved review changed/);
    expect(f.client.patchCandidate).not.toHaveBeenCalled();
    expect(card().getByTestId('addition-outcome')).toHaveTextContent('Confirmed');
    fireEvent.click(screen.getByRole('button', { name: 'Use my choice' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Unsaved review choices' })).toBeNull(),
    );
    expect(item.disposition).toBe('discarded');
  });

  it('T-UX-162e: a lost decision response is reconciled without replaying the accepted patch', async () => {
    const f = fixture();
    f.client.patchCandidate.mockImplementationOnce(async () => {
      const item = f.items[0];
      if (item !== undefined) item.disposition = 'confirmed';
      throw new Error('Response lost');
    });
    mount(f.client);
    await screen.findByTestId('candidate-one');
    fireEvent.click(card().getByTestId('addition-keep'));
    await screen.findByText(/Outcome unverified/);
    fireEvent.click(screen.getByRole('button', { name: 'Check and save choices' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Unsaved review choices' })).toBeNull(),
    );
    expect(f.client.patchCandidate).toHaveBeenCalledTimes(1);
  });

  it('T-UX-162q: an old correction cannot overwrite a changed identity even through Use my choice', async () => {
    const item = candidate();
    const f = fixture([item]);
    mount(f.client);
    await screen.findByTestId('candidate-one');
    fireEvent.click(card().getByTestId('addition-find'));
    fireEvent.change(card().getByRole('searchbox'), { target: { value: 'Correct title' } });
    fireEvent.submit(card().getByRole('searchbox').closest('form')!);
    const result = await card().findByRole('button', { name: 'Use Correct title' });
    online(false);
    fireEvent.click(result);
    await screen.findByRole('region', { name: 'Unsaved review choices' });
    item.resolvedWorkIdentity = 'tmdb:movie:900';
    online(true);
    fireEvent.click(screen.getByRole('button', { name: 'Check and save choices' }));
    await screen.findByText(/This item changed identity/);
    fireEvent.click(screen.getByRole('button', { name: 'Use my choice' }));
    await screen.findByText(/This item changed identity/);
    expect(f.client.patchCandidate).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Unsaved review choices' })).toBeVisible();
  });

  it('T-UX-162r: discarded matched and unidentified cards do not claim they will be added', () => {
    render(
      <ReviewPage
        review={review([
          candidate('one', { disposition: 'discarded' }),
          candidate('two', {
            disposition: 'discarded',
            resolvedWorkIdentity: 'unmatched:two',
            match: null,
          }),
        ])}
      />,
    );
    expect(screen.getAllByText('Not included in these changes')).toHaveLength(2);
    expect(screen.queryByText('Adds to your list')).not.toBeInTheDocument();
  });

  it('T-UX-162f: missing browser storage is explicit and local intent still works in memory', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Unavailable');
    });
    const f = fixture();
    mount(f.client);
    await screen.findByTestId('candidate-one');
    online(false);
    fireEvent.click(card().getByTestId('addition-keep'));
    await screen.findByText(/Local decision recovery is unavailable/);
    expect(screen.getByRole('region', { name: 'Unsaved review choices' })).toBeVisible();
    expect(f.client.patchCandidate).not.toHaveBeenCalled();
  });

  it('T-UX-162g: a known mismatch uses the existing correction API and follows the server section', async () => {
    const f = fixture([candidate('one', { classification: 'already-present-for-this-service' })]);
    mount(f.client);
    await screen.findByTestId('candidate-one');
    fireEvent.click(screen.getByText('Already on your list (1)'));
    fireEvent.click(card().getByTestId('correction-find'));
    fireEvent.change(card().getByRole('searchbox'), { target: { value: 'Correct title' } });
    fireEvent.submit(card().getByRole('searchbox').closest('form')!);
    fireEvent.click(await card().findByRole('button', { name: 'Use Correct title' }));
    await waitFor(() =>
      expect(
        within(screen.getByTestId('review-additions')).getByTestId('candidate-one'),
      ).toBeVisible(),
    );
    expect(f.client.patchCandidate).toHaveBeenCalledWith(
      'review',
      'one',
      expect.objectContaining({ disposition: 'corrected', tmdbId: 99 }),
    );
  });

  it('T-UX-162h: secondary evidence can be rescued without client-side reclassification', async () => {
    const f = fixture([
      candidate('one', {
        verdict: 'chrome-suspected',
        resolvedWorkIdentity: null,
        match: null,
        classification: null,
      }),
    ]);
    mount(f.client);
    await screen.findByTestId('candidate-one');
    fireEvent.click(screen.getByText('Other extracted items (1)'));
    fireEvent.click(
      within(screen.getByTestId('review-probably-not-titles')).getByText(/Probably not titles/),
    );
    fireEvent.click(card().getByRole('button', { name: 'This is a title' }));
    await waitFor(() =>
      expect(
        within(screen.getByTestId('review-unmatched')).getByTestId('candidate-one'),
      ).toBeVisible(),
    );
    expect(f.client.patchCandidate).toHaveBeenCalledWith('review', 'one', {
      reclassifyAsTitle: true,
    });
  });

  it('T-UX-162i: empty, unidentified, known-only and discarded additions have truthful distinct copy', () => {
    const view = render(<ReviewPage review={review([])} />);
    expect(screen.getByText('No extracted titles are available to review')).toBeVisible();
    view.rerender(
      <ReviewPage
        review={review(
          [candidate('one', { classification: 'already-present-for-this-service' })],
          'append-only',
        )}
      />,
    );
    expect(screen.getByText(/Everything nextup could read is already on your list/)).toBeVisible();
    expect(screen.queryByTestId('review-already-on-list')).toBeNull();
    view.rerender(
      <ReviewPage
        review={review([candidate('one', { resolvedWorkIdentity: null, match: null })])}
      />,
    );
    expect(screen.getByText('Some titles still need identification')).toBeVisible();
    view.rerender(<ReviewPage review={review([candidate('one', { disposition: 'discarded' })])} />);
    expect(screen.getByText(/discarded every proposed new title/)).toBeVisible();
  });

  it('T-UX-162j: re-extraction requires separate explicit discard and derived-read actions', async () => {
    const f = fixture();
    mount(f.client);
    fireEvent.click(await screen.findByRole('button', { name: 'Read screenshots again' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Discard this review' })).toBeEnabled(),
    );
    expect(f.client.discardBatch).not.toHaveBeenCalled();
    expect(f.client.reextractBatch).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard this review' }));
    const reread = await screen.findByRole('button', { name: 'Read saved screenshots' });
    expect(f.client.reextractBatch).not.toHaveBeenCalled();
    fireEvent.click(reread);
    await screen.findByRole('heading', { name: 'New extraction' });
    expect(f.client.reextractBatch).toHaveBeenCalledExactlyOnceWith('review');
  });

  it('T-UX-162k: expired screenshots offer fresh input instead of impossible re-extraction', async () => {
    const f = fixture();
    f.source.status = 'discarded';
    const image = f.source.images[0];
    if (image !== undefined) image.available = false;
    mount(f.client);
    fireEvent.click(await screen.findByRole('button', { name: 'Read screenshots again' }));
    const button = await screen.findByRole('button', { name: 'Upload new screenshots' });
    expect(screen.queryByRole('button', { name: 'Read saved screenshots' })).toBeNull();
    fireEvent.click(button);
    await screen.findByRole('heading', { name: 'Fresh screenshots' });
    expect(f.client.reextractBatch).not.toHaveBeenCalled();
  });

  it('T-UX-162l: offline bulk intent uses one atomic request only after an explicit save', async () => {
    const f = fixture([candidate(), candidate('two')]);
    mount(f.client);
    await screen.findByTestId('candidate-one');
    online(false);
    fireEvent.click(screen.getByTestId('confirm-all-button'));
    await screen.findByRole('region', { name: 'Unsaved review choices' });
    expect(f.client.confirmAllCandidates).not.toHaveBeenCalled();
    await act(async () => {
      online(true);
    });
    expect(f.client.confirmAllCandidates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check and save choices' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Unsaved review choices' })).toBeNull(),
    );
    expect(f.client.confirmAllCandidates).toHaveBeenCalledTimes(1);
    expect(f.client.patchCandidate).not.toHaveBeenCalled();
  });

  it('T-UX-162n: an uncertain derived read is found with a read-only check, never replayed', async () => {
    const f = fixture();
    f.source.status = 'discarded';
    f.client.reextractBatch.mockImplementationOnce(async () => {
      const derived = {
        ...f.source,
        batchId: 'derived',
        status: 'submitted',
        derivedFromBatchId: 'review',
      };
      f.client.listBatches.mockResolvedValue({
        batches: [{ ...derived, undoneAt: null, counts: { created: 0, modified: 0, removed: 0 } }],
      });
      f.client.getBatch.mockImplementation(async (id) =>
        structuredClone(id === 'derived' ? derived : f.source),
      );
      throw new Error('Response lost');
    });
    mount(f.client);
    fireEvent.click(await screen.findByRole('button', { name: 'Read screenshots again' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Read saved screenshots' }));
    await screen.findByText(/Response lost/);
    expect(screen.getByRole('button', { name: 'Read saved screenshots' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved status' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue the new read' }));
    await screen.findByRole('heading', { name: 'New extraction' });
    expect(f.client.reextractBatch).toHaveBeenCalledTimes(1);
  });

  it('T-UX-162o: removal choices remain visibly local offline and save only on explicit request', async () => {
    const f = fixture();
    const response = review([]);
    response.sections.removals.count = 1;
    response.sections.removals.items = [
      {
        listingId: 'listing',
        titleId: 'title',
        name: 'Keep this title',
        releaseYear: null,
        posterPath: null,
        service: 'netflix',
        dateAdded: '2026-09-01T00:00:00Z',
        ticked: true,
      },
    ];
    f.client.getReview.mockImplementation(async () => structuredClone(response));
    const setRemoval = vi.fn<ApiClient['setBatchRemoval']>(async (_batch, _id, ticked) => {
      const row = response.sections.removals.items[0];
      if (row !== undefined) row.ticked = ticked;
      return {};
    });
    mount({ ...f.client, setBatchRemoval: setRemoval });
    const checkbox = await screen.findByRole('checkbox', { name: 'Keep this title' });
    online(false);
    fireEvent.click(checkbox);
    await screen.findByRole('region', { name: 'Unsaved review choices' });
    expect(checkbox).toBeChecked();
    expect(setRemoval).not.toHaveBeenCalled();
    online(true);
    expect(setRemoval).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check and save choices' }));
    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(setRemoval).toHaveBeenCalledExactlyOnceWith('review', 'listing', false);
  });
});
