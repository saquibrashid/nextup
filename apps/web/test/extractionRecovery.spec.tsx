import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchStatusRoute } from '../src/containers/BatchStatusRoute';
import { BatchStatusPage } from '../src/pages/BatchStatusPage';
import { apiClient, createApiClient, type BatchStatus } from '../src/lib/apiClient';
import { STATUS_RETRY_LABEL, STATUS_DISCARD_BATCH_LABEL, MEMORY_REMEDY_PATH } from '../src/copy';

const saved: BatchStatus = {
  batchId: 'b1',
  service: 'netflix',
  mode: 'full-update',
  status: 'extraction-failed',
  derivedFromBatchId: null,
  createdAt: '2026-09-19T00:00:00Z',
  submittedAt: null,
  completedAt: null,
  extractionError: 'EXTRACTOR_ERROR',
  lowYield: false,
  provenance: { created: [], modified: [], removed: [] },
  changedNothing: true,
  titles: [],
  images: [null, 0, 3].map((count, index) => ({
    imageId: `image-${index}`,
    fileName: `screenshot-${index}.png`,
    ingestSource: 'upload',
    available: true,
    retainUntil: null,
    candidateCount: count,
    href: `/api/images/image-${index}`,
  })),
};

function mount(stub: typeof apiClient) {
  render(
    <MemoryRouter initialEntries={['/batches/b1']}>
      <Routes>
        <Route path="/batches/:batchId" element={<BatchStatusRoute client={stub} />} />
        <Route path="/" element={<p>Library destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('T-UX-157 extraction progress and deliberate recovery', () => {
  it('T-UX-157a: retry posts the same batch once and returns to measured progress', async () => {
    let release: (() => void) | undefined;
    const retry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const getBatch = vi
      .fn()
      .mockResolvedValueOnce(saved)
      .mockResolvedValue({
        ...saved,
        status: 'extracting',
        extractionError: null,
        progress: { imagesDone: 1, imagesTotal: 3 },
      });
    mount({ ...apiClient, getBatch, retryExtraction: retry });
    fireEvent.click(await screen.findByRole('button', { name: STATUS_RETRY_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: STATUS_RETRY_LABEL }));
    expect(retry).toHaveBeenCalledExactlyOnceWith('b1');
    expect(screen.getByRole('button', { name: STATUS_RETRY_LABEL })).toBeDisabled();
    await act(async () => release?.());
    expect(await screen.findByRole('progressbar')).toHaveAttribute('value', '1');
    expect(screen.getByRole('progressbar')).toHaveAttribute('max', '3');
    expect(screen.queryByRole('button', { name: STATUS_DISCARD_BATCH_LABEL })).toBeNull();
    expect(screen.getAllByTestId('batch-status-image')).toHaveLength(3);
  });

  it('T-UX-157b: an uncertain mutation is surfaced and never automatically replayed', async () => {
    const retry = vi.fn().mockRejectedValue(new Error('Connection interrupted'));
    mount({ ...apiClient, getBatch: vi.fn().mockResolvedValue(saved), retryExtraction: retry });
    fireEvent.click(await screen.findByRole('button', { name: STATUS_RETRY_LABEL }));
    expect(await screen.findByText(/Connection interrupted/)).toHaveTextContent(
      'Nothing was automatically retried',
    );
    expect(retry).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: STATUS_RETRY_LABEL })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: STATUS_RETRY_LABEL }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(2));
  });

  it('T-UX-157c: failures retain image evidence, distinguish unknown from zero, and link memory remedies', () => {
    render(
      <BatchStatusPage
        batch={{
          ...saved,
          imageFailures: [
            {
              imageId: 'image-0',
              fileName: 'screenshot-0.png',
              code: 'IMAGE_DECODE_OOM',
              message: 'This screenshot ran out of memory.',
            },
          ],
        }}
      />,
    );
    expect(screen.getAllByTestId('batch-status-image')).toHaveLength(3);
    expect(screen.getByText('Needs attention')).toBeVisible();
    expect(screen.getByText('No titles found')).toBeVisible();
    expect(screen.getByText('3 titles found')).toBeVisible();
    expect(screen.getByRole('link')).toHaveAttribute('href', `/${MEMORY_REMEDY_PATH}`);
  });

  it('T-UX-157d: offline and busy states disable mutations; discard is separately confirmed', async () => {
    const discardBatch = vi.fn(async () => ({}));
    mount({ ...apiClient, getBatch: vi.fn().mockResolvedValue(saved), discardBatch });
    fireEvent.click(await screen.findByRole('button', { name: STATUS_DISCARD_BATCH_LABEL }));
    expect(discardBatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep batch' }));
    expect(discardBatch).not.toHaveBeenCalled();
    fireEvent(window, new Event('offline'));
    expect(screen.getByRole('button', { name: STATUS_RETRY_LABEL })).toBeDisabled();
    expect(screen.getByRole('button', { name: STATUS_DISCARD_BATCH_LABEL })).toBeDisabled();
    fireEvent(window, new Event('online'));
    fireEvent.click(screen.getByRole('button', { name: STATUS_DISCARD_BATCH_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard import and continue' }));
    expect(await screen.findByText('Library destination')).toBeVisible();
    expect(discardBatch).toHaveBeenCalledExactlyOnceWith('b1');
  });

  it('T-UX-157e: the real client uses retry-extraction, not submit or derived re-extract', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('{}', {
          status: 202,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await createApiClient({ fetchImpl }).retryExtraction('same batch');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/batches/same%20batch/retry-extraction',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('T-UX-157f: expired evidence has no broken image and unread evidence is not zero yield', () => {
    render(
      <BatchStatusPage
        batch={{
          ...saved,
          images: saved.images.map((image, index) => ({ ...image, available: index !== 2 })),
        }}
      />,
    );
    expect(screen.getByText('Screenshot expired')).toBeVisible();
    expect(screen.getByText('Not completed')).toBeVisible();
    expect(screen.getAllByTestId('batch-status-thumb')).toHaveLength(2);
  });
});
