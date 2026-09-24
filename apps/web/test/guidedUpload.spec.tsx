import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  apiClient,
  ApiError,
  type ApiClient,
  type BatchStatus,
  type CreatedBatch,
} from '../src/lib/apiClient';
import { UploadRoute } from '../src/containers/UploadRoute';
import { DraftBatch } from '../src/components/DraftBatch';
import { ImageDropzone, type QueuedImage } from '../src/components/ImageDropzone';

const saved: BatchStatus = {
  intake: {
    origin: 'tracked',
    complete: true,
    reason: null,
    unresolvedAttemptIds: [],
    attempts: [],
  },
  batchId: 'bat_1',
  service: 'netflix',
  mode: 'full-update',
  status: 'draft',
  derivedFromBatchId: null,
  createdAt: '2026-09-18T00:00:00Z',
  submittedAt: null,
  completedAt: null,
  extractionError: null,
  lowYield: false,
  changedNothing: true,
  provenance: { created: [], modified: [], removed: [] },
  titles: [],
  images: [
    {
      imageId: 'img_1',
      fileName: 'saved.png',
      ingestSource: 'upload',
      available: true,
      retainUntil: null,
      candidateCount: null,
      href: '/api/images/img_1',
    },
  ],
};

function client() {
  return {
    ...apiClient,
    listBatches: vi.fn(async () => ({ batches: [] })),
    createBatch: vi.fn(async (service: string, mode: string): Promise<CreatedBatch> => ({
      batchId: 'bat_1',
      service,
      mode,
      status: 'draft',
      createdAt: saved.createdAt,
    })),
    addBatchImages: vi.fn<ApiClient['addBatchImages']>(async () => ({
      accepted: [{ imageId: 'img_1', fileName: 'saved.png' }],
      rejected: [],
      batchTotals: { imageCount: 1, uploadedByteSize: 1, storedByteSize: 1 },
    })),
    getBatch: vi.fn(async () => saved),
    submitBatch: vi.fn(async () => ({})),
    removeBatchImage: vi.fn(async () => ({})),
    discardBatch: vi.fn(async () => ({})),
  };
}

function add(name: string): File {
  const file = new File(['image'], name, { type: 'image/png' });
  fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } });
  return file;
}

async function choose(): Promise<void> {
  fireEvent.click(await screen.findByRole('radio', { name: 'Netflix' }));
  fireEvent.click(within(screen.getByTestId('mode-card-full-update')).getByRole('radio'));
}

function upload(stub = client()) {
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<UploadRoute client={stub} />} />
        <Route path="/batches/:id" element={<p>Saved batch destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return stub;
}

describe('T-UX-156 — guided capture and authoritative saved drafts', () => {
  it('T-UX-161k: discarding an in-place recovery resets capture only after the final saved-state read', async () => {
    const stub = client();
    stub.addBatchImages.mockRejectedValueOnce(new Error('Connection lost'));
    upload(stub);
    await choose();
    add('pending.png');
    fireEvent.click(screen.getByTestId('submit-button'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open saved import' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard import and start again' }));
    stub.discardBatch.mockImplementationOnce(async () => {
      stub.getBatch.mockResolvedValue({ ...saved, status: 'discarded' });
      return {};
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard import', exact: true }));
    await waitFor(() => expect(screen.getByTestId('file-input')).toBeEnabled());
    expect(screen.queryByRole('heading', { name: 'Check your saved screenshots' })).toBeNull();
    expect(screen.queryByText('Saved batch destination')).toBeNull();
    expect(screen.queryByTestId('accepted-name')).toBeNull();
    expect(stub.discardBatch).toHaveBeenCalledTimes(1);
  });

  it('T-UX-161l: leaving during an upload stops the remaining writes and cannot hijack navigation', async () => {
    const stub = client();
    let finish!: (value: Awaited<ReturnType<ApiClient['addBatchImages']>>) => void;
    stub.addBatchImages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <MemoryRouter>
        <UploadRoute client={stub} />
      </MemoryRouter>,
    );
    await choose();
    add('first.png');
    add('not-started.png');
    fireEvent.click(screen.getByTestId('submit-button'));
    await waitFor(() => expect(stub.addBatchImages).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      finish({
        accepted: [{ imageId: 'first', fileName: 'first.png' }],
        rejected: [],
        batchTotals: { imageCount: 1, uploadedByteSize: 5, storedByteSize: 5 },
      });
    });
    expect(stub.addBatchImages).toHaveBeenCalledTimes(1);
    expect(stub.submitBatch).not.toHaveBeenCalled();
  });

  it('T-UX-156a: an early attachment stays local, can be removed, and follows the final service consent', async () => {
    const stub = upload();
    add('removed.png');
    add('kept.png');
    fireEvent.click(await screen.findByRole('button', { name: 'Remove removed.png' }));
    await choose();
    fireEvent.click(screen.getByTestId('service-step-panel-change'));
    fireEvent.click(screen.getByRole('radio', { name: 'Max' }));
    expect(screen.getByTestId('submit-button')).toBeDisabled();
    fireEvent.click(within(screen.getByTestId('mode-card-append-only')).getByRole('radio'));
    expect(stub.createBatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('submit-button'));
    await screen.findByText('Saved batch destination');
    expect(stub.createBatch).toHaveBeenCalledExactlyOnceWith('max', 'append-only', []);
    const form = stub.addBatchImages.mock.calls[0]?.[1];
    expect(form?.get('ingestSource')).toBe('upload');
    expect((form?.get('files') as File).name).toBe('kept.png');
    expect(stub.addBatchImages).toHaveBeenCalledTimes(1);
    expect(stub.submitBatch).toHaveBeenCalledExactlyOnceWith('bat_1');
  });

  it('T-UX-156b: Done closes an unchanged choice without clearing consent', async () => {
    upload();
    await choose();
    fireEvent.click(screen.getByTestId('service-step-panel-change'));
    fireEvent.click(screen.getByTestId('service-step-panel-done'));
    expect(screen.getByTestId('service-step-panel')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('mode-step-panel')).toHaveAttribute('data-state', 'done');
    fireEvent.click(screen.getByTestId('mode-step-panel-change'));
    fireEvent.click(screen.getByTestId('mode-step-panel-done'));
    expect(screen.getByTestId('mode-step-panel')).toHaveAttribute('data-state', 'done');
  });

  it('T-UX-156c: a lost upload response is never replayed or silently submitted', async () => {
    const stub = client();
    stub.addBatchImages.mockRejectedValueOnce(new Error('Connection lost'));
    upload(stub);
    await choose();
    add('first.png');
    add('second.png');
    fireEvent.click(screen.getByTestId('submit-button'));
    const recovery = await screen.findByRole('button', { name: 'Open saved import' });
    expect(stub.addBatchImages).toHaveBeenCalledTimes(2);
    expect(stub.submitBatch).not.toHaveBeenCalled();
    expect(screen.getByTestId('submit-failure')).toHaveTextContent('first.png: Connection lost');
    expect(screen.getByTestId('submit-button')).toBeDisabled();
    fireEvent.click(recovery);
    await screen.findByRole('heading', { name: 'Check your saved screenshots' });
    expect(screen.getByRole('button', { name: 'Remove first.png' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Upload selected screenshots' })).toBeDisabled();
    expect(stub.addBatchImages).toHaveBeenCalledTimes(2);
  });

  it('T-UX-156d: failed creation keeps the editable queue for an explicit retry', async () => {
    const stub = client();
    stub.createBatch.mockRejectedValueOnce(new Error('Unavailable'));
    upload(stub);
    await choose();
    add('kept.png');
    fireEvent.click(screen.getByTestId('submit-button'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
    expect(screen.getByTestId('accepted-name')).toHaveTextContent('kept.png');
    fireEvent.click(screen.getByTestId('submit-button'));
    await screen.findByText('Saved batch destination');
    expect(stub.addBatchImages).toHaveBeenCalledTimes(1);
  });

  it('T-UX-156e: the local queue preserves file, drop and desktop paste sources before setup', () => {
    const changed = vi.fn<(images: readonly QueuedImage[]) => void>();
    render(<ImageDropzone onQueueChange={changed} />);
    add('file.png');
    const drop = new File(['drop'], 'drop.png', { type: 'image/png' });
    fireEvent.drop(screen.getByTestId('drop-target'), { dataTransfer: { files: [drop] } });
    const paste = new File(['paste'], 'paste.png', { type: 'image/png' });
    fireEvent.paste(document, { clipboardData: { files: [paste], items: [] } });
    expect(changed.mock.calls.at(-1)?.[0].map((item) => item.source)).toEqual([
      'upload',
      'drop',
      'paste',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove drop.png' }));
    expect(changed.mock.calls.at(-1)?.[0].map((item) => item.file.name)).toEqual([
      'file.png',
      'paste.png',
    ]);
  });

  it('T-UX-156f: a saved draft removes the server image, refreshes, and cannot extract an empty draft', async () => {
    const stub = client();
    const refresh = vi.fn(async () => {});
    const props = {
      batch: saved,
      client: stub,
      offline: false,
      onRefresh: refresh,
      onRefused: vi.fn(),
      onDiscarded: vi.fn(),
    };
    const view = render(<DraftBatch {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove saved.png' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(stub.removeBatchImage).toHaveBeenCalledExactlyOnceWith('bat_1', 'img_1');
    view.rerender(<DraftBatch {...props} batch={{ ...saved, images: [] }} />);
    expect(screen.getByTestId('draft-submit')).toBeDisabled();
    view.rerender(<DraftBatch {...props} />);
    fireEvent.click(screen.getByTestId('draft-submit'));
    await waitFor(() => expect(stub.submitBatch).toHaveBeenCalledExactlyOnceWith('bat_1'));
  });

  it('T-UX-156g: saved-draft uploads retain rejected files and preserve per-file memory diagnostics', async () => {
    const stub = client();
    stub.addBatchImages.mockRejectedValueOnce(
      new ApiError('IMAGE_DECODE_OOM', 503, 'Memory exhausted', {
        rejected: [
          { fileName: 'large.png', code: 'IMAGE_DECODE_OOM', message: 'Memory exhausted' },
        ],
      }),
    );
    const refresh = vi.fn(async () => {});
    render(
      <DraftBatch
        batch={saved}
        client={stub}
        offline={false}
        onRefresh={refresh}
        onRefused={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    add('large.png');
    expect(screen.getByTestId('draft-submit')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Upload selected screenshots' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('rejected-name')).toHaveTextContent('large.png');
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining('scale-up-memory'),
    );
    expect(screen.getByRole('button', { name: 'Upload selected screenshots' })).toBeEnabled();
    expect(screen.getByTestId('draft-submit')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove large.png' }));
    expect(screen.getByTestId('draft-submit')).toBeEnabled();
  });

  it('T-UX-156h: offline disables draft mutations and discard requires a separate explicit confirmation', async () => {
    const stub = client();
    const discarded = vi.fn();
    const props = {
      batch: saved,
      client: stub,
      onRefresh: vi.fn(async () => {}),
      onRefused: vi.fn(),
      onDiscarded: discarded,
    };
    const view = render(<DraftBatch {...props} offline />);
    expect(screen.getByTestId('draft-submit')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove saved.png' })).toBeDisabled();
    view.rerender(<DraftBatch {...props} offline={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Discard import and start again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep batch' }));
    expect(stub.discardBatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard import and start again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard import', exact: true }));
    await waitFor(() => expect(discarded).toHaveBeenCalledTimes(1));
    expect(stub.discardBatch).toHaveBeenCalledExactlyOnceWith('bat_1');
  });
});
