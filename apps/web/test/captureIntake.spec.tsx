import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureInputIssues } from '../src/components/CaptureInputIssues';
import { DraftBatch } from '../src/components/DraftBatch';
import { UploadRoute } from '../src/containers/UploadRoute';
import { apiClient, type ApiClient, type BatchStatus } from '../src/lib/apiClient';
import { useCaptureRefusals } from '../src/lib/useCaptureRefusals';

const issue = {
  id: 'issue',
  token: 'token',
  kind: 'upload',
  state: 'incomplete',
  failures: [{ name: 'bad.png', message: 'Memory capacity exceeded.', code: 'IMAGE_DECODE_OOM' }],
  acceptedImageIds: [],
  replacementImageIds: [],
};
const saved: BatchStatus = {
  batchId: 'draft',
  service: 'netflix',
  mode: 'full-update',
  status: 'draft',
  createdAt: '2026-09-20T12:00:00Z',
  submittedAt: null,
  completedAt: null,
  derivedFromBatchId: null,
  extractionError: null,
  lowYield: false,
  changedNothing: true,
  provenance: { created: [], modified: [], removed: [] },
  titles: [],
  batchTotals: { imageCount: 1, uploadedByteSize: 10, storedByteSize: 30 },
  images: [
    {
      imageId: 'saved',
      fileName: 'saved.png',
      ingestSource: 'upload',
      available: true,
      retainUntil: null,
      candidateCount: null,
      href: '/api/images/saved',
    },
  ],
  intake: {
    origin: 'tracked',
    complete: false,
    reason: 'unresolved-input',
    unresolvedAttemptIds: ['issue'],
    attempts: [issue],
  },
};
const storageKey = 'nextup.capture.refusals.draft';
function client() {
  return {
    ...apiClient,
    listBatches: vi.fn<ApiClient['listBatches']>(async () => ({ batches: [] })),
    getBatch: vi.fn<ApiClient['getBatch']>(async () => saved),
    createBatch: vi.fn<ApiClient['createBatch']>(async () => ({
      batchId: 'draft',
      service: 'netflix',
      mode: 'full-update',
      status: 'draft',
      createdAt: saved.createdAt,
    })),
    addBatchImages: vi.fn<ApiClient['addBatchImages']>(async () => ({
      accepted: [{ imageId: 'saved', fileName: 'saved.png' }],
      rejected: [],
      batchTotals: { imageCount: 1, uploadedByteSize: 10, storedByteSize: 30 },
    })),
    submitBatch: vi.fn<ApiClient['submitBatch']>(async () => ({})),
    reportCaptureRefusals: vi.fn<ApiClient['reportCaptureRefusals']>(async () => ({})),
    resolveCaptureInput: vi.fn<ApiClient['resolveCaptureInput']>(async () => ({})),
    removeBatchImage: vi.fn<ApiClient['removeBatchImage']>(async () => ({})),
  };
}
function draft(stub = client(), offline = false) {
  return (
    <DraftBatch
      batch={saved}
      client={stub}
      offline={offline}
      onRefresh={async () => {}}
      onRefused={vi.fn()}
      onDiscarded={vi.fn()}
    />
  );
}
function select(...files: File[]) {
  fireEvent.change(screen.getByTestId('file-input'), { target: { files } });
}
beforeEach(() => sessionStorage.clear());

describe('Persisted screenshot input recovery', () => {
  it('T-UX-164u: replacement is explicit, stale selections cannot submit, and unfinished removal is not a replacement', () => {
    const resolve = vi.fn();
    const retry = vi.fn();
    const props = { disabled: false, onResolve: resolve, onRetryRemoval: retry };
    const mounted = render(<CaptureInputIssues batch={saved} {...props} />);
    const confirm = () =>
      screen.getByRole('button', { name: 'Confirm selected screenshots cover this input' });
    expect(confirm()).toBeDisabled();
    expect(screen.getByTestId('rejected-remedy')).toHaveAttribute(
      'href',
      expect.stringContaining('scale-up-memory'),
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(confirm());
    expect(resolve).toHaveBeenCalledWith('issue', ['saved']);
    mounted.rerender(<CaptureInputIssues batch={{ ...saved, images: [] }} {...props} />);
    expect(confirm()).toBeDisabled();
    expect(screen.getByText(/Upload a replacement screenshot above/)).toBeVisible();
    const removing = {
      ...issue,
      id: 'removal',
      kind: 'image-removal',
      acceptedImageIds: ['saved'],
    };
    mounted.rerender(
      <CaptureInputIssues
        batch={{
          ...saved,
          intake: {
            origin: 'tracked',
            complete: false,
            reason: 'unresolved-input',
            unresolvedAttemptIds: ['issue', 'removal'],
            attempts: [issue, removing],
          },
        }}
        {...props}
      />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry screenshot removal' }));
    expect(retry).toHaveBeenCalledWith('saved');
    expect(resolve).toHaveBeenCalledTimes(1);
    mounted.rerender(
      <CaptureInputIssues
        batch={{
          ...saved,
          intake: {
            origin: 'unverified',
            complete: false,
            reason: 'unverified',
            unresolvedAttemptIds: [],
            attempts: [],
          },
        }}
        {...props}
      />,
    );
    expect(screen.getByText(/fresh capture is needed/)).toBeVisible();
  });

  it('T-UX-164v: local issues survive reload and rapid selections; malformed storage remains blocking until explicit discard', () => {
    const hook = renderHook(() => useCaptureRefusals(storageKey));
    act(() => {
      hook.result.current.record([{ name: 'one.gif', reason: 'Unsupported' }]);
      hook.result.current.record([{ name: 'two.gif', reason: 'Unsupported' }]);
    });
    const reports = hook.result.current.reports;
    expect(reports).toHaveLength(2);
    hook.unmount();
    const reloaded = renderHook(() => useCaptureRefusals(storageKey));
    expect(reloaded.result.current.reports).toEqual(reports);
    act(() => reloaded.result.current.saved(reports.slice(0, 1)));
    expect(reloaded.result.current.reports).toEqual(reports.slice(1));
    reloaded.unmount();
    sessionStorage.setItem(
      storageKey,
      JSON.stringify([{ token: '!invalid', name: 'a', message: 'b' }]),
    );
    const broken = renderHook(() => useCaptureRefusals(storageKey));
    expect(broken.result.current.error).toContain('could not be read');
    act(() => broken.result.current.record([{ name: 'later.gif', reason: 'Unsupported' }]));
    expect(broken.result.current.error).toContain('could not be read');
    expect(sessionStorage.getItem(storageKey)).toContain('!invalid');
    const stillBroken = renderHook(() => useCaptureRefusals(storageKey));
    expect(stillBroken.result.current.error).toContain('could not be read');
    stillBroken.unmount();
    act(() => broken.result.current.clear());
    expect(broken.result.current.error).toBeNull();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    act(() => broken.result.current.record([{ name: 'blocked.gif', reason: 'Unsupported' }]));
    expect(broken.result.current.error).toContain('could not be saved');
    expect(broken.result.current.reports).toHaveLength(1);
    write.mockRestore();
    broken.unmount();
  });

  it('T-UX-164w: rejected-only selections persist stable tokens and retry explicitly after a lost report response, never on reconnect', async () => {
    const stub = client();
    stub.reportCaptureRefusals.mockRejectedValueOnce(new Error('Response lost'));
    const mounted = render(draft(stub));
    select(new File(['gif'], 'bad.gif', { type: 'application/pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save input issues' }));
    await screen.findByText('Response lost');
    const reports = stub.reportCaptureRefusals.mock.calls[0]?.[1];
    expect(reports).toHaveLength(1);
    mounted.unmount();
    const reloaded = render(draft(stub, true));
    expect(screen.getByRole('button', { name: 'Save input issues' })).toBeDisabled();
    reloaded.rerender(draft(stub, false));
    expect(stub.reportCaptureRefusals).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save input issues' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save input issues' })).toBeNull(),
    );
    expect(stub.reportCaptureRefusals).toHaveBeenLastCalledWith('draft', reports);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(stub.addBatchImages).not.toHaveBeenCalled();
    expect(stub.submitBatch).not.toHaveBeenCalled();
    expect(screen.getByTestId('draft-submit')).toBeEnabled();
  });

  it('T-UX-164x: initial local refusals are declared atomically at creation and successful uploads never silently clear them or auto-submit', async () => {
    const stub = client();
    render(
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: '*',
              element: <UploadRoute client={stub} />,
            },
          ],
          { initialEntries: ['/upload'] },
        )}
      />,
    );
    await screen.findByRole('radio', { name: 'Netflix' });
    fireEvent.click(screen.getByRole('radio', { name: 'Netflix' }));
    fireEvent.click(screen.getByRole('radio', { name: /Full update/ }));
    select(new File(['gif'], 'bad.gif', { type: 'application/pdf' }));
    select(new File(['png'], 'saved.png', { type: 'image/png' }));
    fireEvent.click(screen.getByTestId('submit-button'));
    await screen.findByRole('heading', { name: 'Check your saved screenshots' });
    expect(stub.createBatch).toHaveBeenCalledWith('netflix', 'full-update', [
      expect.objectContaining({
        token: expect.any(String),
        name: 'bad.gif',
        message: expect.any(String),
      }),
    ]);
    expect(stub.addBatchImages).toHaveBeenCalledTimes(1);
    expect(stub.submitBatch).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('T-UX-164y: uncertain replacement locks writes until saved-state recovery; missing intake and unreadable local evidence block extraction', async () => {
    const stub = client();
    stub.resolveCaptureInput.mockRejectedValueOnce(new Error('Response lost'));
    stub.getBatch.mockResolvedValueOnce(saved).mockRejectedValueOnce(new Error('Read failed'));
    const mounted = render(draft(stub));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm selected screenshots cover this input' }),
    );
    await screen.findByText(/Saved status is unverified/);
    expect(screen.getByTestId('draft-submit')).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    const complete: BatchStatus = {
      ...saved,
      intake: {
        origin: 'tracked',
        complete: true,
        reason: null,
        unresolvedAttemptIds: [],
        attempts: [{ ...issue, state: 'resolved', replacementImageIds: ['saved'] }],
      },
    };
    stub.getBatch.mockResolvedValue(complete);
    fireEvent.click(screen.getByRole('button', { name: 'Check saved screenshots' }));
    await waitFor(() => expect(screen.getByTestId('draft-submit')).toBeEnabled());
    expect(stub.resolveCaptureInput).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('checkbox')).toBeNull();
    mounted.unmount();
    const { intake: omitted, ...legacy } = saved;
    expect(omitted).toBeDefined();
    const missing = render(
      <DraftBatch
        batch={legacy}
        client={stub}
        offline={false}
        onRefresh={async () => {}}
        onRefused={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    expect(screen.getByTestId('draft-submit')).toBeDisabled();
    missing.unmount();
    sessionStorage.setItem(storageKey, '{broken');
    render(draft(stub));
    expect(screen.getByText(/could not be read on this device/)).toBeVisible();
    expect(screen.getByTestId('draft-submit')).toBeDisabled();
  });
});
