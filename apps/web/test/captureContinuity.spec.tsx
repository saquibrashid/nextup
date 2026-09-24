import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Link, RouterProvider, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MAX_BATCH_UPLOAD_BYTES, MAX_IMAGES_PER_BATCH } from '@nextup/domain';
import { CaptureNavigationProvider } from '../src/components/CaptureNavigation';
import { DraftBatch } from '../src/components/DraftBatch';
import { ImageDropzone, reviewFiles } from '../src/components/ImageDropzone';
import { UploadRoute } from '../src/containers/UploadRoute';
import { apiClient, ApiError, type ApiClient, type BatchStatus } from '../src/lib/apiClient';
import { ScreenshotPreview } from '../src/components/ScreenshotPreview';

const saved: BatchStatus = {
  intake: {
    origin: 'tracked',
    complete: true,
    reason: null,
    unresolvedAttemptIds: [],
    attempts: [],
  },
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
};

function client() {
  return {
    ...apiClient,
    listBatches: vi.fn<ApiClient['listBatches']>(async () => ({ batches: [] })),
    getBatch: vi.fn<ApiClient['getBatch']>(async () => saved),
    addBatchImages: vi.fn<ApiClient['addBatchImages']>(async () => ({
      accepted: [{ imageId: 'new', fileName: 'new.png' }],
      rejected: [],
      batchTotals: { imageCount: 2, uploadedByteSize: 20, storedByteSize: 40 },
    })),
    submitBatch: vi.fn<ApiClient['submitBatch']>(async () => ({})),
    removeBatchImage: vi.fn<ApiClient['removeBatchImage']>(async () => ({})),
  };
}

function file(name = 'new.png') {
  return new File(['png'], name, { type: 'image/png' });
}
function select(...files: File[]) {
  fireEvent.change(screen.getByTestId('file-input'), { target: { files } });
}
function draft(stub = client()) {
  render(
    <DraftBatch
      batch={saved}
      client={stub}
      offline={false}
      onRefresh={async () => {}}
      onRefused={vi.fn()}
      onDiscarded={vi.fn()}
    />,
  );
  return stub;
}
function unload() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('T-POL-001 saved preparation', () => {
  it.each(['draft', 'extracting'])(
    'T-POL-001f: %s advertises preparation only while the saved capture is editable',
    (status) => {
      render(
        <DraftBatch
          batch={{ ...saved, status }}
          client={client()}
          offline={false}
          onRefresh={async () => {}}
          onRefused={vi.fn()}
          onDiscarded={vi.fn()}
        />,
      );
      expect(Boolean(screen.queryByRole('list', { name: 'Capture progress' }))).toBe(
        status === 'draft',
      );
    },
  );
});

describe('T-UX-161 local and saved capture continuity', () => {
  it('T-UX-161a: route links and Back preserve unsaved input until explicit leave; reload/sign-out use the native warning', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <CaptureNavigationProvider>
              <Link to="/library">Your library</Link>
              <Routes>
                <Route path="/upload" element={<UploadRoute client={client()} />} />
                <Route path="/library" element={<h1>Library destination</h1>} />
              </Routes>
            </CaptureNavigationProvider>
          ),
        },
      ],
      { initialEntries: ['/library', '/upload'], initialIndex: 1 },
    );
    render(<RouterProvider router={router} />);
    await screen.findByRole('radio', { name: 'Netflix' });
    expect(unload()).toBe(false);
    select(file());
    expect(unload()).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Your library' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('not safely saved');
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(screen.getByRole('button', { name: 'Remove new.png' })).toBeVisible();
    await act(async () => {
      await router.navigate(-1);
    });
    expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Leave capture' }));
    await screen.findByRole('heading', { name: 'Library destination' });
    expect(unload()).toBe(false);
  });

  it('T-UX-161b: removing the final local file releases navigation without a blanket warning', async () => {
    render(
      <RouterProvider
        router={createMemoryRouter([
          {
            path: '*',
            element: (
              <CaptureNavigationProvider>
                <UploadRoute client={client()} />
              </CaptureNavigationProvider>
            ),
          },
        ])}
      />,
    );
    await screen.findByRole('radio', { name: 'Netflix' });
    select(file());
    expect(unload()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove new.png' }));
    expect(unload()).toBe(false);
  });

  it('T-UX-161c: count and uploaded-byte ceilings include saved files and reject only the excess', () => {
    const one = file('one.png');
    const two = file('two.png');
    expect(reviewFiles([one, two], MAX_IMAGES_PER_BATCH - 1).accepted).toEqual([one]);
    expect(reviewFiles([one], 1, MAX_BATCH_UPLOAD_BYTES - one.size).accepted).toEqual([one]);
    expect(reviewFiles([one], 1, MAX_BATCH_UPLOAD_BYTES - one.size + 1).rejected).toHaveLength(1);
    render(<ImageDropzone savedCount={MAX_IMAGES_PER_BATCH - 1} savedUploadedBytes={10} />);
    select(one, two);
    expect(screen.getAllByTestId('accepted-name')).toHaveLength(1);
    expect(screen.getByTestId('rejected-name')).toHaveTextContent('two.png');
  });

  it('T-UX-161d: partial success keeps rejected and unknown files while never replaying saved images', async () => {
    const stub = client();
    const next = {
      ...saved,
      images: [...saved.images, { ...saved.images[0]!, imageId: 'new', fileName: 'ok.png' }],
    };
    stub.getBatch.mockResolvedValueOnce(saved).mockResolvedValue(next);
    stub.addBatchImages.mockRejectedValueOnce(new Error('Response lost')).mockRejectedValueOnce(
      new ApiError('IMAGE_DECODE_FAILED', 422, 'Unreadable', {
        rejected: [{ fileName: 'bad.png', code: 'IMAGE_DECODE_FAILED', message: 'Unreadable' }],
      }),
    );
    draft(stub);
    select(file('unknown.png'), file('bad.png'), file('ok.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Upload selected screenshots' }));
    await waitFor(() => expect(stub.getBatch).toHaveBeenCalledTimes(2));
    expect(
      within(screen.getByRole('list', { name: 'Saved screenshots' })).getByText('ok.png'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove unknown.png' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove bad.png' })).toBeEnabled();
    expect(screen.getByTestId('accepted-list')).not.toHaveTextContent('ok.png');
    expect(screen.getByRole('button', { name: 'Upload selected screenshots' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved screenshots' }));
    await waitFor(() => expect(stub.getBatch).toHaveBeenCalledTimes(3));
    expect(stub.addBatchImages).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: 'Remove unknown.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove bad.png' }));
    expect(screen.getByTestId('draft-submit')).toBeEnabled();
    expect(stub.submitBatch).not.toHaveBeenCalled();
  });

  it('T-UX-161e: an unreadable saved outcome pauses all writes until an explicit successful check', async () => {
    const stub = client();
    stub.getBatch
      .mockResolvedValueOnce(saved)
      .mockRejectedValueOnce(new Error('Read failed'))
      .mockResolvedValue(saved);
    draft(stub);
    select(file());
    fireEvent.click(screen.getByRole('button', { name: 'Upload selected screenshots' }));
    await screen.findByText(/Saved status is unverified/);
    expect(screen.getByTestId('draft-submit')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove saved.png' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved screenshots' }));
    await waitFor(() => expect(screen.getByTestId('draft-submit')).toBeEnabled());
    expect(stub.addBatchImages).toHaveBeenCalledTimes(1);
  });

  it('T-UX-161f: a draft changed in another tab retains local input and sends no upload', async () => {
    const stub = client();
    stub.getBatch.mockResolvedValue({ ...saved, status: 'extracting' });
    draft(stub);
    select(file());
    fireEvent.click(screen.getByRole('button', { name: 'Upload selected screenshots' }));
    await screen.findByText(/This batch is now extracting/);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove new.png' })).toBeEnabled(),
    );
    expect(stub.addBatchImages).not.toHaveBeenCalled();
    expect(screen.getByTestId('draft-submit')).toBeDisabled();
  });

  it('T-UX-161g: HEIC needs no browser decoder and object URLs are revoked on removal', async () => {
    const create = vi.fn(() => 'blob:preview');
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static override createObjectURL = create;
        static override revokeObjectURL = revoke;
      },
    );
    try {
      const view = render(<ScreenshotPreview source={file()} name="new.png" />);
      expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:preview');
      view.rerender(
        <ScreenshotPreview source={file('photo.heic')} name="photo.heic" unsupported />,
      );
      expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:preview');
      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.getByText('HEIC / HEIF')).toBeVisible();
      view.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('T-UX-161h: expired saved screenshots cannot be extracted, while offline file selection remains local', () => {
    const stub = client();
    render(
      <DraftBatch
        batch={{ ...saved, images: saved.images.map((image) => ({ ...image, available: false })) }}
        client={stub}
        offline
        onRefresh={async () => {}}
        onRefused={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    select(file());
    expect(screen.getByTestId('draft-submit')).toBeDisabled();
    expect(screen.getByTestId('file-input')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove new.png' })).toBeEnabled();
    expect(stub.addBatchImages).not.toHaveBeenCalled();
    expect(screen.getByText(/Remove expired screenshots/)).toBeVisible();
  });
});
