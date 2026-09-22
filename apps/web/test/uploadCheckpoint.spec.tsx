import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UploadRoute } from '../src/containers/UploadRoute';
import {
  apiClient,
  type ApiClient,
  type BatchHistoryItem,
  type BatchHistoryResponse,
  type BatchStatus,
  RefusedError,
} from '../src/lib/apiClient';
import { useUploadCheckpoint } from '../src/lib/useUploadCheckpoint';
import { SLOW_AFTER_MS, STALLED_AFTER_MS } from '../src/lib/useSlowRequest';

function history(status = 'draft'): BatchHistoryItem {
  return {
    batchId: 'old-upload',
    service: 'max',
    mode: 'full-update',
    status,
    createdAt: '2026-09-01T12:00:00Z',
    submittedAt: null,
    completedAt: null,
    undoneAt: null,
    counts: { created: 0, modified: 0, removed: 0 },
  };
}

function detail(status = 'draft'): BatchStatus {
  return {
    ...history(status),
    derivedFromBatchId: null,
    extractionError: null,
    lowYield: false,
    changedNothing: true,
    provenance: { created: [], modified: [], removed: [] },
    images: [],
    titles: [],
  };
}

function stub(status: string | null = 'draft') {
  return {
    ...apiClient,
    listBatches: vi.fn<ApiClient['listBatches']>(async () => ({
      batches: status === null ? [] : [history(status)],
    })),
    getBatch: vi.fn<ApiClient['getBatch']>(async () => detail(status ?? 'draft')),
    createBatch: vi.fn<ApiClient['createBatch']>(),
    discardBatch: vi.fn<ApiClient['discardBatch']>(async () => ({})),
    addBatchImages: vi.fn<ApiClient['addBatchImages']>(),
    submitBatch: vi.fn<ApiClient['submitBatch']>(),
  };
}

function mount(client = stub(), url = '/upload') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/upload" element={<UploadRoute client={client} />} />
        <Route path="/batches/:id" element={<p>Saved batch destination</p>} />
        <Route path="/batches/:id/review" element={<p>Review destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return client;
}

function paste() {
  fireEvent.paste(document, {
    clipboardData: { files: [new File(['png'], 'held.png', { type: 'image/png' })], items: [] },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('T-POL-001 entry orientation', () => {
  it('T-POL-001e: preparation progress appears only after the saved-capture check resolves', async () => {
    const pending = deferred<BatchHistoryResponse>();
    const client = stub(null);
    client.listBatches.mockReturnValueOnce(pending.promise);
    mount(client);
    expect(screen.queryByRole('list', { name: 'Capture progress' })).not.toBeInTheDocument();
    await act(async () => pending.resolve({ batches: [] }));
    expect(
      screen.getByRole('list', { name: 'Capture progress' }).querySelector('[aria-current]'),
    ).toHaveTextContent('Prepare');
    expect(client.createBatch).not.toHaveBeenCalled();
  });
});

describe('T-UX-160 entry checkpoint', () => {
  it.each([null, 'applied', 'undone', 'discarded'])(
    'T-UX-160a: %s permits preparation only after an authoritative read',
    async (status) => {
      const client = stub(status);
      mount(client, '/upload?service=netflix');
      expect(screen.getByTestId('service-step')).not.toBeVisible();
      expect(screen.getByTestId('submit-button')).toBeDisabled();
      await waitFor(() => expect(screen.getByTestId('service-step-panel-answer')).toBeVisible());
      expect(client.listBatches).toHaveBeenCalledWith(expect.any(AbortSignal), true);
      expect(screen.getByTestId('service-step-panel-answer')).toHaveTextContent('Netflix');
      expect(
        within(screen.getByTestId('mode-step')).queryAllByRole('radio', { checked: true }),
      ).toHaveLength(0);
      expect(client.createBatch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['draft', 'Continue adding screenshots', true],
    ['submitted', 'View progress', false],
    ['extracting', 'View progress', false],
    ['in-review', 'Continue review', true],
    ['extraction-failed', 'Resolve extraction issue', true],
  ] as const)(
    'T-UX-160b: %s shows the saved facts and only legal actions',
    async (status, label, discardable) => {
      const client = mount(stub(status));
      expect(await screen.findByRole('button', { name: label })).toBeEnabled();
      const checkpoint = screen.getByTestId('upload-checkpoint');
      expect(checkpoint).toHaveTextContent('Max');
      expect(checkpoint).toHaveTextContent('Full update');
      expect(checkpoint).toHaveTextContent(
        new Date(history().createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' }),
      );
      expect(Boolean(screen.queryByTestId('open-batch-discard'))).toBe(discardable);
      expect(screen.getByTestId('submit-button')).toBeDisabled();
      expect(screen.getByTestId('service-step')).not.toBeVisible();
      expect(client.discardBatch).not.toHaveBeenCalled();
    },
  );

  it('T-UX-160c: failed checks block creation, preserve early paste, and retry without uploading', async () => {
    const client = stub(null);
    client.listBatches.mockRejectedValueOnce(new Error('Network unavailable'));
    mount(client);
    paste();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check your connection and try again',
    );
    expect(screen.getByTestId('upload-checkpoint')).toHaveTextContent('1 screenshot is held');
    expect(screen.getByTestId('submit-button')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Remove held.png' })).toBeEnabled();
    expect(client.createBatch).not.toHaveBeenCalled();
    expect(client.addBatchImages).not.toHaveBeenCalled();
  });

  it('T-UX-160k: unknown or conflicting open state never silently starts a new upload', async () => {
    const client = stub('unexpected');
    mount(client);
    expect(await screen.findByRole('alert')).toHaveTextContent('unrecognized status');
    client.listBatches.mockResolvedValue({
      batches: [history(), { ...history(), batchId: 'other' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('More than one');
    expect(screen.getByTestId('submit-button')).toBeDisabled();
    expect(client.createBatch).not.toHaveBeenCalled();
  });

  it('T-UX-160d: resuming rereads the current state and confirms leaving new local input', async () => {
    const client = mount();
    await screen.findByTestId('open-batch-go');
    paste();
    fireEvent.click(screen.getByTestId('open-batch-go'));
    expect(screen.getByRole('dialog')).toHaveTextContent('not saved');
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(client.getBatch).not.toHaveBeenCalled();
    client.getBatch.mockResolvedValue(detail('in-review'));
    fireEvent.click(screen.getByTestId('open-batch-go'));
    fireEvent.click(screen.getByRole('button', { name: 'Leave and continue' }));
    await screen.findByText('Review destination');
    expect(client.getBatch).toHaveBeenCalledExactlyOnceWith('old-upload');
    expect(client.addBatchImages).not.toHaveBeenCalled();
  });

  it('T-UX-160l: a finished batch refreshes entry rather than navigating to obsolete review', async () => {
    const client = mount(stub('in-review'));
    await screen.findByTestId('open-batch-go');
    client.getBatch.mockResolvedValue(detail('applied'));
    client.listBatches.mockResolvedValue({ batches: [] });
    fireEvent.click(screen.getByTestId('open-batch-go'));
    await waitFor(() => expect(screen.getByTestId('service-step')).toBeVisible());
    expect(screen.getByText(/already finished/)).toBeVisible();
    expect(screen.queryByText('Review destination')).toBeNull();
  });

  it('T-UX-160e: confirmed discard is guarded, retains local files, and starts nothing', async () => {
    const client = mount();
    await screen.findByTestId('open-batch-discard');
    paste();
    fireEvent.click(screen.getByTestId('open-batch-discard'));
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(client.discardBatch).not.toHaveBeenCalled();
    const pending = deferred<Record<string, never>>();
    client.discardBatch.mockReturnValue(pending.promise);
    client.listBatches.mockResolvedValue({ batches: [] });
    fireEvent.click(screen.getByTestId('open-batch-discard'));
    const confirm = screen.getByRole('button', { name: 'Discard saved batch' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(client.discardBatch).toHaveBeenCalledExactlyOnceWith('old-upload'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeVisible();
    await act(async () => {
      pending.resolve({});
    });
    expect(await screen.findByRole('button', { name: 'Remove held.png' })).toBeEnabled();
    expect(screen.getByText(/saved batch was discarded/)).toBeVisible();
    expect(client.createBatch).not.toHaveBeenCalled();
  });

  it('T-UX-160m: a draft that starts running between confirmation and execution cannot be discarded', async () => {
    const client = mount();
    await screen.findByTestId('open-batch-discard');
    client.getBatch.mockResolvedValue(detail('extracting'));
    fireEvent.click(screen.getByTestId('open-batch-discard'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard saved batch' }));
    expect(await screen.findByRole('button', { name: 'View progress' })).toBeVisible();
    expect(screen.queryByTestId('open-batch-discard')).toBeNull();
    expect(client.discardBatch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('cannot be discarded');
  });

  it('T-UX-160f: a lost discard response triggers a read, never a replay or a new batch', async () => {
    const client = mount();
    await screen.findByTestId('open-batch-discard');
    client.discardBatch.mockRejectedValueOnce(new Error('Response lost'));
    client.listBatches.mockResolvedValue({ batches: [] });
    fireEvent.click(screen.getByTestId('open-batch-discard'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard saved batch' }));
    await waitFor(() => expect(screen.getByTestId('service-step')).toBeVisible());
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing was automatically retried');
    expect(client.listBatches).toHaveBeenCalledTimes(2);
    expect(client.discardBatch).toHaveBeenCalledTimes(1);
    expect(client.createBatch).not.toHaveBeenCalled();
  });

  it('T-UX-160g: offline entry cannot act and reconnect performs a fresh lookup', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const client = mount();
    expect(screen.getByTestId('submit-button')).toBeDisabled();
    expect(client.listBatches).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    fireEvent(window, new Event('online'));
    await screen.findByTestId('open-batch-discard');
    online.mockReturnValue(false);
    fireEvent(window, new Event('offline'));
    expect(screen.queryByTestId('open-batch-discard')).toBeNull();
    expect(client.discardBatch).not.toHaveBeenCalled();
  });

  it('T-UX-160h: retry aborts stale reads and resets the slow-request clock', async () => {
    vi.useFakeTimers();
    const old = deferred<BatchHistoryResponse>();
    const next = deferred<BatchHistoryResponse>();
    const client = stub();
    client.listBatches.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    mount(client);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOW_AFTER_MS);
    });
    expect(screen.getByTestId('slow-response')).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALLED_AFTER_MS);
    });
    fireEvent.click(screen.getByTestId('slow-retry'));
    expect(client.listBatches.mock.calls[0]?.[0]?.aborted).toBe(true);
    expect(screen.queryByTestId('slow-stalled')).toBeNull();
    await act(async () => {
      next.resolve({ batches: [history()] });
    });
    await act(async () => {
      old.resolve({ batches: [] });
    });
    expect(screen.getByTestId('open-batch-go')).toBeVisible();
    expect(screen.getByTestId('service-step')).not.toBeVisible();
  });

  it('T-UX-160n: refusal and unmount never permit an obsolete response to enable entry', async () => {
    const client = stub();
    client.listBatches.mockRejectedValueOnce(new RefusedError());
    const hook = renderHook(() => useUploadCheckpoint(client, true, true));
    await waitFor(() => expect(hook.result.current.state.kind).toBe('refused'));
    const pending = deferred<BatchHistoryResponse>();
    client.listBatches.mockReturnValueOnce(pending.promise);
    act(() => {
      void hook.result.current.check();
    });
    hook.unmount();
    expect(client.listBatches.mock.calls[1]?.[0]?.aborted).toBe(true);
    await act(async () => {
      pending.resolve({ batches: [] });
    });
  });
});
