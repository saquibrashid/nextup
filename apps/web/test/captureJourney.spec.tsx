import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureResume } from '../src/components/CaptureResume';
import { AppShell } from '../src/components/AppShell';
import { BatchStatusRoute, POLL_INTERVAL_MS } from '../src/containers/BatchStatusRoute';
import { ReviewRoute } from '../src/containers/ReviewRoute';
import { BatchHistoryPage } from '../src/pages/BatchHistoryPage';
import { apiClient, ApiError, type ApiClient, type BatchStatus } from '../src/lib/apiClient';
import { STATUS_DISCARD_BATCH_LABEL } from '../src/copy';

function saved(status = 'extracting', batchId = 'first'): BatchStatus {
  return {
    batchId,
    service: 'netflix',
    mode: 'append-only',
    status,
    createdAt: '2026-09-20T12:00:00Z',
    submittedAt: null,
    completedAt: null,
    derivedFromBatchId: null,
    extractionError: status === 'extraction-failed' ? 'EXTRACTOR_ERROR' : null,
    lowYield: false,
    changedNothing: true,
    provenance: { created: [], modified: [], removed: [] },
    titles: [],
    images: [],
    progress: { imagesDone: 2, imagesTotal: 5 },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred promise has not initialized.');
  };
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function mount(client: ApiClient, path = '/batches/first') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Link to="/about">Leave capture</Link>
      <Link to="/batches/second">Other capture</Link>
      <Routes>
        <Route
          path="/batches/:batchId"
          element={<BatchStatusRoute client={client} visibility={() => false} />}
        />
        <Route path="/batches/:batchId/review" element={<ReviewRoute client={client} />} />
        <Route path="/" element={<p>Library destination</p>} />
        <Route path="/about" element={<p>About destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('T-UX-165 journey continuity', () => {
  it('T-UX-165l: in-place library query changes do not remount the navigation indicator', async () => {
    const listBatches = vi.spyOn(apiClient, 'listBatches').mockResolvedValue({ batches: [] });
    render(
      <MemoryRouter>
        <Link to="/about">Leave library</Link>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Link to="/?sort=name">Change library sort</Link>} />
            <Route path="/about" element={<p>Another page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(listBatches).toHaveBeenCalledTimes(1);
    await act(async () =>
      fireEvent.click(screen.getByRole('link', { name: 'Change library sort' })),
    );
    expect(listBatches).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('link', { name: 'Leave library' }));
    await waitFor(() => expect(listBatches).toHaveBeenCalledTimes(2));
  });

  it('T-UX-165a: slow status reads are coalesced instead of starved by polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pending = deferred<BatchStatus>();
    const getBatch = vi.fn(() => pending.promise);
    mount({ ...apiClient, getBatch });
    expect(screen.getByTestId('batch-status-loading')).toHaveTextContent('Checking the saved');
    expect(screen.queryByText(/Queued/)).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4));
    expect(getBatch).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(saved()));
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2');
    await act(async () => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS));
    expect(getBatch).toHaveBeenCalledTimes(2);
  });

  it('T-UX-165b: explicit read retry supersedes a stalled response without replaying a write', async () => {
    const pending = deferred<BatchStatus>();
    const getBatch = vi
      .fn<ApiClient['getBatch']>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue(saved('discarded'));
    const discardBatch = vi.fn();
    mount({ ...apiClient, getBatch, discardBatch });
    fireEvent.click(screen.getByRole('button', { name: 'Check saved status' }));
    expect(
      await screen.findByRole('heading', { name: 'This capture was discarded' }),
    ).toBeVisible();
    expect(getBatch.mock.calls[0]?.[1]?.aborted).toBe(true);
    await act(async () => pending.resolve(saved('in-review')));
    expect(screen.getByRole('heading', { name: 'This capture was discarded' })).toBeVisible();
    expect(discardBatch).not.toHaveBeenCalled();
  });

  it('T-UX-165c: changing batch IDs clears old state before the new read resolves', async () => {
    const pending = deferred<BatchStatus>();
    const getBatch = vi.fn<ApiClient['getBatch']>((id) =>
      id === 'first' ? Promise.resolve(saved('discarded')) : pending.promise,
    );
    mount({ ...apiClient, getBatch });
    await screen.findByRole('heading', { name: 'This capture was discarded' });
    fireEvent.click(screen.getByRole('link', { name: 'Other capture' }));
    expect(screen.getByTestId('batch-status-loading')).toBeVisible();
    expect(screen.queryByText('This capture was discarded')).toBeNull();
    await act(async () => pending.resolve(saved('undone', 'second')));
    expect(screen.getByRole('heading', { name: 'This capture was undone' })).toBeVisible();
  });

  it('T-UX-165d: leaving during a discard prevents late navigation and status reads', async () => {
    const pending = deferred<object>();
    const getBatch = vi.fn().mockResolvedValue(saved('extraction-failed'));
    const discardBatch = vi.fn(() => pending.promise);
    mount({ ...apiClient, getBatch, discardBatch });
    fireEvent.click(await screen.findByRole('button', { name: STATUS_DISCARD_BATCH_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard import and continue' }));
    fireEvent.click(screen.getByRole('link', { name: 'Leave capture' }));
    await act(async () => pending.resolve({}));
    expect(screen.getByText('About destination')).toBeVisible();
    expect(screen.queryByText('Library destination')).toBeNull();
    expect(getBatch).toHaveBeenCalledTimes(1);
    expect(discardBatch).toHaveBeenCalledExactlyOnceWith('first');
  });

  it.each(['/batches/first', '/batches/first/review'])(
    'T-UX-165e: unavailable owner-scoped link %s has focused recovery, not endless retry',
    async (path) => {
      const missing = new ApiError('BATCH_NOT_FOUND', 404, 'Batch not found.', {});
      mount(
        {
          ...apiClient,
          getBatch: vi.fn().mockRejectedValue(missing),
          getReview: vi.fn().mockRejectedValue(missing),
        },
        path,
      );
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Capture unavailable' })).toHaveFocus(),
      );
      expect(screen.getByRole('link', { name: 'Capture history' })).toHaveAttribute(
        'href',
        '/batches',
      );
      expect(screen.queryByRole('button')).toBeNull();
    },
  );

  it('T-UX-165f: a failed poll preserves labelled evidence and stops until read-only retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getBatch = vi
      .fn()
      .mockResolvedValueOnce(saved())
      .mockRejectedValueOnce(
        new ApiError('INTERNAL_ERROR', 500, 'Status storage is temporarily unavailable.', {}),
      )
      .mockResolvedValue(saved('extraction-failed'));
    const retryExtraction = vi.fn();
    mount({ ...apiClient, getBatch, retryExtraction });
    await screen.findByRole('progressbar');
    await act(async () => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS));
    expect(screen.getByRole('alert')).toHaveTextContent('last reported state');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Status storage is temporarily unavailable.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This does not mean screenshot reading failed',
    );
    expect(screen.getByRole('progressbar')).toHaveAccessibleName(
      'Last reported screenshots processed',
    );
    await act(async () => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5));
    expect(getBatch).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Check saved status' }));
    await screen.findByRole('heading', { name: 'Screenshots need attention' });
    expect(retryExtraction).not.toHaveBeenCalled();
    expect(getBatch).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['draft', 'Continue adding screenshots'],
    ['submitted', 'View progress'],
    ['extracting', 'View progress'],
    ['in-review', 'Continue review'],
    ['extraction-failed', 'Resolve extraction issue'],
  ])(
    'T-UX-165g: the navigation indicator resumes %s through an authoritative read',
    async (status, label) => {
      const listBatches = vi.fn().mockResolvedValue({ batches: [saved(status)] });
      render(
        <MemoryRouter>
          <CaptureResume client={{ ...apiClient, listBatches }} />
        </MemoryRouter>,
      );
      expect(await screen.findByRole('link', { name: label })).toHaveAttribute(
        'href',
        '/batches/first',
      );
      expect(listBatches).toHaveBeenCalledWith(expect.any(AbortSignal), true);
      expect(screen.getByRole('complementary')).toHaveTextContent('Netflix');
    },
  );

  it('T-UX-165h: empty and failed lookups never invent unfinished work or claim a successful check', async () => {
    const client = { ...apiClient, listBatches: vi.fn().mockResolvedValue({ batches: [] }) };
    const view = render(
      <MemoryRouter>
        <CaptureResume client={client} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    view.unmount();
    render(
      <MemoryRouter>
        <CaptureResume
          client={{ ...apiClient, listBatches: vi.fn().mockRejectedValue(new Error('Offline')) }}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/We could not check your saved uploads/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Check uploads' })).toHaveAttribute('href', '/upload');
  });

  it('T-UX-165i: history uses the same resume vocabulary and correctly names append-only captures', () => {
    render(
      <MemoryRouter>
        <BatchHistoryPage
          items={[
            {
              ...saved('in-review'),
              undoneAt: null,
              counts: { created: 0, modified: 0, removed: 0 },
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('batch-card-status')).toHaveTextContent('Ready to review');
    expect(screen.getByTestId('batch-card-mode')).toHaveTextContent('Add to library');
    expect(screen.getByTestId('batch-card-link')).toHaveTextContent('Continue review');
    expect(screen.getByTestId('batch-card-link')).toHaveAttribute('href', '/batches/first');
  });

  it('T-UX-165j: a missing status read following a closed-review refusal uses unavailable recovery', async () => {
    mount(
      {
        ...apiClient,
        getReview: vi
          .fn()
          .mockRejectedValue(new ApiError('BATCH_NOT_IN_REVIEW', 409, 'Not in review.', {})),
        getBatch: vi.fn().mockRejectedValue(new ApiError('BATCH_NOT_FOUND', 404, 'Not found.', {})),
      },
      '/batches/first/review',
    );
    expect(await screen.findByRole('heading', { name: 'Capture unavailable' })).toBeVisible();
  });
});
