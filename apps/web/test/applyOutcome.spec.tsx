import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReviewResponse } from '@nextup/domain';
import { apiClient, ApiError, type ApiClient, type BatchStatus } from '../src/lib/apiClient';
import { ReviewRoute } from '../src/containers/ReviewRoute';
import { BatchStatusRoute } from '../src/containers/BatchStatusRoute';

function fixture() {
  const review = buildReviewResponse({
    batchId: 'review',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'ok',
    candidates: [],
    disappearedListings: [],
    imagesWithNoText: [],
  });
  const source: BatchStatus = {
    batchId: 'review',
    service: 'netflix',
    mode: 'full-update',
    status: 'in-review',
    derivedFromBatchId: null,
    createdAt: '2026-09-20T12:00:00Z',
    submittedAt: null,
    completedAt: null,
    images: [],
    extractionError: null,
    lowYield: false,
    changedNothing: true,
    provenance: { created: [], modified: [], removed: [] },
    titles: [],
    application: {
      summary: { listingsCreated: 2, listingsRemoved: 1, removalGroupId: 'group' },
      undoable: false,
      removalsUndone: false,
    },
  };
  const client = {
    ...apiClient,
    getReview: vi.fn<ApiClient['getReview']>(async () => structuredClone(review)),
    getBatch: vi.fn<ApiClient['getBatch']>(async () => structuredClone(source)),
    closeBatch: vi.fn<ApiClient['closeBatch']>(async () => {
      throw new Error('Response lost');
    }),
    undoBatch: vi.fn<ApiClient['undoBatch']>(async () => ({})),
    undoRemovalGroup: vi.fn<ApiClient['undoRemovalGroup']>(async () => ({})),
  };
  return { client, source, review };
}
function mount(client: ApiClient, entry = '/batches/review/review') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/batches/:batchId/review" element={<ReviewRoute client={client} />} />
        <Route path="/batches/:batchId" element={<BatchStatusRoute client={client} />} />
        <Route path="/" element={<h1>Your list</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}
async function apply() {
  await userEvent.click(await screen.findByTestId('apply-changes-button'));
  await userEvent.click(await screen.findByRole('button', { name: 'Apply changes' }));
}
beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
describe('TASK-229 authoritative Apply outcomes', () => {
  it('T-UX-163j: a cold review read failure makes no claim about whether a previous Apply committed', async () => {
    const f = fixture();
    f.client.getReview.mockRejectedValue(new Error('Unavailable'));
    mount(f.client);
    const error = await screen.findByTestId('review-load-error');
    expect(error).toHaveTextContent('Check your connection');
    expect(error).not.toHaveTextContent(/nothing.*chang/i);
    expect(f.client.closeBatch).not.toHaveBeenCalled();
  });
  it('T-UX-163a: a lost successful response opens the saved receipt with the correct undo, never another close', async () => {
    const f = fixture();
    f.client.closeBatch.mockImplementation(async () => {
      f.source.status = 'applied';
      throw new Error('Lost');
    });
    mount(f.client);
    await apply();
    await screen.findByRole('heading', { name: 'Capture applied' });
    expect(screen.getByText('Added 2 titles, removed 1 title from Netflix.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Undo the removals' }));
    await screen.findByText('Those titles are back on your list.');
    expect(f.client.undoRemovalGroup).toHaveBeenCalledExactlyOnceWith('group');
    expect(f.client.undoBatch).not.toHaveBeenCalled();
    expect(f.client.closeBatch).toHaveBeenCalledTimes(1);
  });
  it('T-UX-163b: a saved in-review result refreshes before permitting an explicit retry', async () => {
    const f = fixture();
    mount(f.client);
    await apply();
    await screen.findByText(/The saved batch is still in review/);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeEnabled();
    expect(f.client.getBatch).toHaveBeenCalledTimes(1);
    expect(f.client.getReview).toHaveBeenCalledTimes(3);
    expect(f.client.closeBatch).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(f.client.closeBatch).toHaveBeenCalledTimes(2));
  });
  it('T-UX-163c: unreadable outcomes disable Apply and reconnect never retries the mutation', async () => {
    const f = fixture();
    f.client.getBatch.mockRejectedValueOnce(new Error('Unavailable'));
    mount(f.client);
    await apply();
    await screen.findByText(/We could not verify whether/);
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
    fireEvent(window, new Event('online'));
    expect(f.client.closeBatch).toHaveBeenCalledTimes(1);
    expect(f.client.getBatch).toHaveBeenCalledTimes(1);
    f.source.status = 'applied';
    await userEvent.click(screen.getByRole('button', { name: 'Check saved status' }));
    await screen.findByRole('heading', { name: 'Capture applied' });
    expect(f.client.closeBatch).toHaveBeenCalledTimes(1);
  });
  it.each(['applied', 'undone', 'discarded'])(
    'T-UX-163d: an old review link resolves its saved terminal state (%s)',
    async (status) => {
      const f = fixture();
      f.source.status = status;
      f.client.getReview.mockRejectedValue(new ApiError('BATCH_NOT_IN_REVIEW', 409, 'Closed', {}));
      mount(f.client);
      await screen.findByRole('heading', {
        name: status === 'applied' ? 'Capture applied' : `This capture was ${status}`,
      });
      expect(screen.queryByTestId('apply-changes-button')).not.toBeInTheDocument();
      expect(f.client.closeBatch).not.toHaveBeenCalled();
    },
  );
  it('T-UX-163e: a no-change receipt with an empty removal group never offers removal undo', async () => {
    const f = fixture();
    f.source.status = 'applied';
    f.source.application = {
      summary: { listingsCreated: 0, listingsRemoved: 0, removalGroupId: 'empty' },
      undoable: true,
      removalsUndone: false,
    };
    mount(f.client, '/batches/review');
    await screen.findByText('Nothing changed on your Netflix list.');
    expect(screen.queryByRole('button', { name: 'Undo the removals' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo this batch' }));
    await waitFor(() => expect(f.client.undoBatch).toHaveBeenCalledExactlyOnceWith('review'));
  });
  it('T-UX-163f: leaving during Apply does not trigger later reads or stale navigation', async () => {
    const f = fixture();
    let fail: (error: Error) => void = () => {
      throw new Error('Not started');
    };
    f.client.closeBatch.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const view = mount(f.client);
    await apply();
    expect(screen.getByRole('button', { name: 'Applying...' })).toBeDisabled();
    view.unmount();
    await act(async () => {
      fail(new Error('Lost'));
    });
    expect(f.client.getBatch).not.toHaveBeenCalled();
    expect(f.client.closeBatch).toHaveBeenCalledTimes(1);
  });
  it('T-UX-163g: another tab closing first resolves the saved result without replay', async () => {
    const f = fixture();
    f.client.closeBatch.mockImplementation(async () => {
      f.source.status = 'discarded';
      throw new ApiError('BATCH_NOT_IN_REVIEW', 409, 'Closed in another tab', {});
    });
    mount(f.client);
    await apply();
    await screen.findByRole('heading', { name: 'This capture was discarded' });
    expect(f.client.closeBatch).toHaveBeenCalledTimes(1);
  });
});
