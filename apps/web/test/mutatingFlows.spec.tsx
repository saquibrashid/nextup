/**
 * `T-DATA-008`, `T-DATA-009`, `T-UX-043`, `T-UX-045`…`T-UX-048` — the mutating
 * flows and the extraction poll (TASK-178, `specs/ui.md` §3.3, §12.6, §12.7).
 *
 * ⚠ **THE THREE SCREENS ASSERTED HERE WERE MOUNTED BARE.** `/upload` collected
 * screenshots into React state and posted nothing; `/batches/:batchId` rendered
 * "no batch" against a running one; `/batches/:batchId/review` offered a close
 * button with no producer behind it. Every component underneath was complete,
 * prop-driven and covered — which is exactly why nothing failed.
 *
 * ⚠ **EVERY MOUNT ASSERTION RUNS UNDER `<StrictMode>`** (§36.2). React 19
 * double-invokes effects in development only, so a `POST` in a mount effect
 * fires twice here and once in a production build: the duplicate batch and
 * duplicate extraction run would surface first in the owner's real data. A
 * plain `render()` passes on the broken code.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReviewResponse } from '@nextup/domain';

import { BatchStatusRoute, POLL_INTERVAL_MS, isRunning } from '../src/containers/BatchStatusRoute';
import { ReviewRoute } from '../src/containers/ReviewRoute';
import {
  UploadRoute,
  rejectionsFromError,
  submitBlockedReason,
} from '../src/containers/UploadRoute';
import { ApiError, type ApiClient } from '../src/lib/apiClient';
import {
  OPEN_BATCH_DISCARD_LABEL,
  OPEN_BATCH_GO_LABEL,
  SUBMIT_IN_FLIGHT,
  SUBMIT_NEEDS_IMAGES,
  SUBMIT_NEEDS_SELECTION,
} from '../src/copy';

/** The names that change server state. Nothing here may fire on a mount. */
const MUTATING = [
  'createBatch',
  'addBatchImages',
  'removeBatchImage',
  'submitBatch',
  'discardBatch',
  'undoBatch',
  'undoRemovalGroup',
  'suppressTitle',
  'unsuppress',
  'confirmAllCandidates',
  'closeBatch',
];

function attachResult(imageCount: number, rejected: unknown[] = []) {
  return {
    accepted: [{ imageId: 'img_1', fileName: 'a.png' }],
    rejected,
    batchTotals: { imageCount, uploadedByteSize: 1, storedByteSize: 1 },
  };
}

function batch(status: string) {
  return {
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'full-update',
    status,
    derivedFromBatchId: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    submittedAt: '2026-02-01T00:00:01.000Z',
    completedAt: null,
    images: [],
    extractionError: null,
    lowYield: false,
  };
}

function emptyReview() {
  // ⚠ Built by the DOMAIN's own projection, never hand-rolled. A plausible
  // literal here compiles and renders and is a different shape from what the
  // server sends — which is how a fixture ends up proving the fixture.
  return buildReviewResponse({
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [],
    disappearedListings: [],
    imagesWithNoText: [],
  });
}

function reviewWithOneAddition() {
  return buildReviewResponse({
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [
      {
        candidateId: 'cnd_1',
        rawExtractedText: 'Dune',
        normalisedText: 'dune',
        verdict: 'title',
        confidence: 0.99,
        ocrSupport: 'corroborated',
        cleanupVerdict: null,
        resolvedWorkIdentity: 'tmdb:movie:438631',
        match: {
          workIdentity: 'tmdb:movie:438631',
          mediaType: 'movie',
          name: 'Dune',
          releaseYear: 2021,
          posterPath: null,
          score: 0.99,
          uncertain: false,
          ambiguous: false,
        },
        alternatives: [],
        sourceImageIds: ['img_1'],
        disposition: 'pending',
        collapsedIntoCandidateId: null,
        classification: 'new',
      },
    ],
    disappearedListings: [],
    imagesWithNoText: [],
  });
}

/** A client whose every call is recorded and individually overridable. */
function stubClient(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const record =
    <T,>(name: string, value: T) =>
    async () => {
      calls.push(name);
      return value;
    };

  const wrapped: Record<string, unknown> = {};
  for (const [name, impl] of Object.entries(overrides)) {
    wrapped[name] = (...args: unknown[]) => {
      calls.push(name);
      return (impl as (...a: unknown[]) => unknown)(...args);
    };
  }

  const client = {
    getMe: record('getMe', {}),
    getTitles: record('getTitles', { items: [], nextCursor: null, limit: 50 }),
    getTitle: record('getTitle', {}),
    getServiceState: record('getServiceState', { services: [] }),
    getSuppressions: record('getSuppressions', { items: [] }),
    getBatch: record('getBatch', batch('extracting')),
    getReview: record('getReview', emptyReview()),
    createBatch: record('createBatch', {
      batchId: 'bat_1',
      service: 'netflix',
      mode: 'full-update',
      status: 'draft',
      createdAt: '2026-02-01T00:00:00.000Z',
    }),
    addBatchImages: record('addBatchImages', attachResult(1)),
    removeBatchImage: record('removeBatchImage', {}),
    submitBatch: record('submitBatch', {}),
    discardBatch: record('discardBatch', {}),
    undoBatch: record('undoBatch', {}),
    undoRemovalGroup: record('undoRemovalGroup', {}),
    suppressTitle: record('suppressTitle', {}),
    unsuppress: record('unsuppress', {}),
    confirmAllCandidates: record('confirmAllCandidates', {
      section: 'additions',
      confirmed: 2,
      skipped: 0,
    }),
    closeBatch: record('closeBatch', {}),
    lookupImdb: record('lookupImdb', null),
    ...wrapped,
  } as unknown as ApiClient;

  return { client, calls };
}

/** Renders a route at a real URL so `useParams` sees a batch id. */
function renderAt(url: string, element: JSX.Element, pattern: string, strict = false) {
  const tree = (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={pattern} element={element} />
        <Route path="/batches/:batchId" element={<p>status screen</p>} />
        <Route path="/batches/:batchId/review" element={<p>review screen</p>} />
        <Route path="/" element={<p>list screen</p>} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function png(name = 'a.png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
}

/** Chooses Netflix + full update, which is what makes the batch attachable. */
function chooseServiceAndMode(): void {
  fireEvent.click(screen.getByTestId('service-option-netflix').querySelector('input')!);
  fireEvent.click(screen.getByTestId('mode-card-full-update').querySelector('input')!);
}

function dropFiles(files: File[]): void {
  const input = screen.getByTestId('file-input');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
}

// ---------------------------------------------------------------------------
// T-DATA-008 — mutations only from event handlers
// ---------------------------------------------------------------------------

describe('T-DATA-008 — no mutation on mount, including under StrictMode', () => {
  it('T-DATA-008c: mounting /upload issues no mutating call', async () => {
    const { client, calls } = stubClient();
    renderAt('/upload', <UploadRoute client={client} />, '/upload', true);

    // Waited on rather than asserted immediately: a mount effect's POST is
    // issued asynchronously, so an assertion in the same tick passes on the
    // broken code by simply running first.
    await waitFor(() => {
      expect(screen.getByTestId('submit-button')).toBeInTheDocument();
    });
    expect(calls.filter((call) => MUTATING.includes(call))).toEqual([]);
  });

  it('T-DATA-008d: mounting /batches/:id reads the batch and mutates nothing', async () => {
    const { client, calls } = stubClient();
    renderAt('/batches/bat_1', <BatchStatusRoute client={client} />, '/batches/:batchId', true);

    await waitFor(() => {
      expect(calls).toContain('getBatch');
    });
    expect(calls.filter((call) => MUTATING.includes(call))).toEqual([]);
  });

  it('T-DATA-008e: mounting the review route reads the review and mutates nothing', async () => {
    const { client, calls } = stubClient();
    renderAt(
      '/batches/bat_1/review',
      <ReviewRoute client={client} />,
      '/batches/:batchId/review',
      true,
    );

    await waitFor(() => {
      expect(calls).toContain('getReview');
    });
    // ⚠ `closeBatch` on mount would APPLY THE BATCH the instant the owner
    // opened the review — the single most destructive thing this screen could
    // do, and under StrictMode it would do it twice.
    expect(calls.filter((call) => MUTATING.includes(call))).toEqual([]);
  });

  it('T-DATA-008f: two deliveries racing before the first response create one batch', async () => {
    // ⚠ THE RACE HAS TO BE REAL. Two files in ONE drop is a single `attach`
    // call and passes with no guard at all — the mutant survives. The actual
    // failure is two SEPARATE ingest events (a paste then a drop, or an
    // impatient second drop) landing before the create resolves.
    let release: ((value: { batchId: string }) => void) | null = null;
    const created = new Promise<{ batchId: string }>((resolve) => {
      release = resolve;
    });
    const { client, calls } = stubClient({ createBatch: async () => created });
    renderAt('/upload', <UploadRoute client={client} />, '/upload', true);

    chooseServiceAndMode();
    dropFiles([png('a.png')]);
    dropFiles([png('b.png')]);

    // ⚠ A BOOLEAN GUARD FAILS HERE. Both deliveries see `batchId === null`
    // and the flag is only set after the first `await`, so only the in-flight
    // PROMISE deduplicates them — and two batches means the owner's second
    // upload is refused by their own first one with 409 OPEN_BATCH_EXISTS.
    expect(calls.filter((call) => call === 'createBatch')).toHaveLength(1);

    await act(async () => {
      release?.({ batchId: 'bat_1' });
      await created;
    });

    await waitFor(() => {
      expect(calls).toContain('addBatchImages');
    });
    expect(calls.filter((call) => call === 'createBatch')).toHaveLength(1);
  });

  it('T-DATA-008g: choosing a service and a mode creates nothing on its own', async () => {
    const { client, calls } = stubClient();
    renderAt('/upload', <UploadRoute client={client} />, '/upload', true);

    chooseServiceAndMode();

    // Creating on the selection is legal under REQ-102 — it IS an event
    // handler — and still wrong: every idle change of the radios would leave
    // an abandoned server-side batch that then refuses the owner's real one.
    await waitFor(() => {
      expect(screen.getByTestId('submit-reason')).toHaveTextContent(SUBMIT_NEEDS_IMAGES);
    });
    expect(calls).not.toContain('createBatch');
  });
});

// ---------------------------------------------------------------------------
// T-DATA-009 — the poll, and the three ways it stops
// ---------------------------------------------------------------------------

describe('T-DATA-009 — polling stops three ways', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('T-DATA-009b: a running batch is re-read after the interval', async () => {
    const { client, calls } = stubClient();
    renderAt(
      '/batches/bat_1',
      <BatchStatusRoute client={client} visibility={() => false} />,
      '/batches/:batchId',
    );

    await waitFor(() => {
      expect(calls.filter((call) => call === 'getBatch')).toHaveLength(1);
    });

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    await waitFor(() => {
      expect(calls.filter((call) => call === 'getBatch').length).toBeGreaterThan(1);
    });
  });

  it('T-DATA-009c: a settled status stops the poll', async () => {
    const { client, calls } = stubClient({
      getBatch: async () => batch('extraction-failed'),
    });
    renderAt(
      '/batches/bat_1',
      <BatchStatusRoute client={client} visibility={() => false} />,
      '/batches/:batchId',
    );

    await waitFor(() => {
      expect(calls.filter((call) => call === 'getBatch')).toHaveLength(1);
    });

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    // ⚠ `extraction-failed` is an OPEN batch by the domain's own predicate,
    // because the owner must still retry or discard it. Polling on
    // `isBatchOpen` would therefore re-read it every two seconds forever, on a
    // status that cannot change by itself.
    expect(calls.filter((call) => call === 'getBatch')).toHaveLength(1);
  });

  it('T-DATA-009d: unmounting stops the poll', async () => {
    const { client, calls } = stubClient();
    const { unmount } = renderAt(
      '/batches/bat_1',
      <BatchStatusRoute client={client} visibility={() => false} />,
      '/batches/:batchId',
    );

    await waitFor(() => {
      expect(calls).toContain('getBatch');
    });
    unmount();
    const settled = calls.filter((call) => call === 'getBatch').length;

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    expect(calls.filter((call) => call === 'getBatch')).toHaveLength(settled);
  });

  it('T-DATA-009e: a hidden tab issues nothing, and resumes when visible', async () => {
    let hidden = true;
    const { client, calls } = stubClient();
    renderAt(
      '/batches/bat_1',
      <BatchStatusRoute client={client} visibility={() => hidden} />,
      '/batches/:batchId',
    );

    await waitFor(() => {
      expect(calls).toContain('getBatch');
    });
    const afterMount = calls.filter((call) => call === 'getBatch').length;

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    // ⚠ Not politeness. Without this a forgotten tab polls a single 0.25 vCPU
    // replica indefinitely, which is a background process by behaviour
    // whatever the intent (§12.7).
    expect(calls.filter((call) => call === 'getBatch')).toHaveLength(afterMount);

    hidden = false;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    await waitFor(() => {
      expect(calls.filter((call) => call === 'getBatch').length).toBeGreaterThan(afterMount);
    });
  });

  it('T-DATA-009f: only the two running statuses are polled', () => {
    // The rule stated directly, so a future status defaults to NOT polled.
    expect(isRunning('submitted')).toBe(true);
    expect(isRunning('extracting')).toBe(true);
    for (const settled of ['draft', 'in-review', 'extraction-failed', 'applied', 'discarded']) {
      expect(isRunning(settled)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// T-UX-045…048, T-UX-043 — step 3 of /upload
// ---------------------------------------------------------------------------

describe('T-UX-045 — submit states its reason rather than sitting grey', () => {
  it('T-UX-045a: before a selection the reason names the missing choice', () => {
    expect(submitBlockedReason({ service: null, mode: null }, 3)).toBe(SUBMIT_NEEDS_SELECTION);
    expect(submitBlockedReason({ service: 'netflix', mode: null }, 3)).toBe(SUBMIT_NEEDS_SELECTION);
  });

  it('T-UX-045b: with a selection and no images the reason names the images', () => {
    expect(submitBlockedReason({ service: 'netflix', mode: 'full-update' }, 0)).toBe(
      SUBMIT_NEEDS_IMAGES,
    );
  });

  it('T-UX-045c: with both, nothing blocks the submit', () => {
    expect(submitBlockedReason({ service: 'max', mode: 'append-only' }, 1)).toBeNull();
  });

  it('T-UX-045d: the reason is rendered as text beside the disabled button', async () => {
    const { client } = stubClient();
    renderAt('/upload', <UploadRoute client={client} />, '/upload');

    // §3.3: "never a silent disabled button". A tooltip would not exist at all
    // on the touch device this product is designed for first.
    expect(screen.getByTestId('submit-button')).toBeDisabled();
    expect(screen.getByTestId('submit-reason')).toHaveTextContent(SUBMIT_NEEDS_SELECTION);
    await Promise.resolve();
  });

  it('T-UX-045e: once an image is attached the button enables and the reason goes', async () => {
    const { client } = stubClient();
    renderAt('/upload', <UploadRoute client={client} />, '/upload');

    chooseServiceAndMode();
    dropFiles([png()]);

    await waitFor(() => {
      expect(screen.getByTestId('submit-button')).toBeEnabled();
    });
    expect(screen.queryByTestId('submit-reason')).not.toBeInTheDocument();
  });
});

describe('T-UX-046 — submitting says so', () => {
  it('T-UX-046a: the in-flight warning is shown and the button is disabled', async () => {
    let release: (() => void) | null = null;
    const { client } = stubClient({
      submitBatch: () =>
        new Promise<unknown>((resolve) => {
          release = () => {
            resolve({});
          };
        }),
    });
    renderAt('/upload', <UploadRoute client={client} />, '/upload');

    chooseServiceAndMode();
    dropFiles([png()]);
    await waitFor(() => {
      expect(screen.getByTestId('submit-button')).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId('submit-button'));

    await waitFor(() => {
      expect(screen.getByTestId('submit-busy')).toHaveTextContent(SUBMIT_IN_FLIGHT);
    });
    // A second press would submit the same batch twice.
    expect(screen.getByTestId('submit-button')).toBeDisabled();
    release?.();
  });
});

describe('T-UX-047 — a successful submit navigates to the status screen', () => {
  it('T-UX-047a: submit posts once and lands on /batches/:batchId', async () => {
    const { client, calls } = stubClient();
    renderAt('/upload', <UploadRoute client={client} />, '/upload');

    chooseServiceAndMode();
    dropFiles([png()]);
    await waitFor(() => {
      expect(screen.getByTestId('submit-button')).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId('submit-button'));

    // §4.9 — success IS the navigation; there is no interstitial to get stuck
    // on, and the status screen is where the owner watches the work happen.
    expect(await screen.findByText('status screen')).toBeInTheDocument();
    expect(calls.filter((call) => call === 'submitBatch')).toHaveLength(1);
  });
});

describe('T-UX-048 — the 409 offers both ways out', () => {
  const conflict = new ApiError(
    'OPEN_BATCH_EXISTS',
    409,
    'You already have a batch in progress. Finish or discard it before starting another.',
    { batchId: 'bat_old', service: 'netflix', mode: 'append-only', status: 'draft' },
  );

  it('T-UX-048a: the server message is rendered verbatim with both actions', async () => {
    const { client } = stubClient({
      createBatch: () => Promise.reject(conflict),
    });
    renderAt('/upload', <UploadRoute client={client} />, '/upload');

    chooseServiceAndMode();
    dropFiles([png()]);

    // ⚠ VERBATIM (REQ-104, §12.8). A client table keyed on the code is a
    // second source of truth that goes stale exactly where it hurts most.
    expect(await screen.findByTestId('open-batch-message')).toHaveTextContent(conflict.message);
    expect(screen.getByTestId('open-batch-go')).toHaveTextContent(OPEN_BATCH_GO_LABEL);
    expect(screen.getByTestId('open-batch-discard')).toHaveTextContent(OPEN_BATCH_DISCARD_LABEL);
  });

  it('T-UX-048b: "Go to it" opens the batch named in the envelope details', async () => {
    const { client } = stubClient({ createBatch: () => Promise.reject(conflict) });
    renderAt('/upload', <UploadRoute client={client} />, '/upload');

    chooseServiceAndMode();
    dropFiles([png()]);
    fireEvent.click(await screen.findByTestId('open-batch-go'));

    expect(await screen.findByText('status screen')).toBeInTheDocument();
  });

  it('T-UX-048c: "Discard it and start again" discards the OTHER batch', async () => {
    const discarded: string[] = [];
    const { client } = stubClient({
      createBatch: () => Promise.reject(conflict),
      discardBatch: (id: unknown) => {
        discarded.push(id as string);
        return Promise.resolve({});
      },
    });
    renderAt('/upload', <UploadRoute client={client} />, '/upload');

    chooseServiceAndMode();
    dropFiles([png()]);
    fireEvent.click(await screen.findByTestId('open-batch-discard'));

    // ⚠ The id comes from the ENVELOPE, not from anything this screen holds:
    // the conflicting batch is one the owner started elsewhere, so a
    // client-side id would either be null or, worse, the wrong batch.
    await waitFor(() => {
      expect(discarded).toEqual(['bat_old']);
    });
  });

  it('T-UX-048d: the conflict does not replace the screen', async () => {
    const { client } = stubClient({ createBatch: () => Promise.reject(conflict) });
    renderAt('/upload', <UploadRoute client={client} />, '/upload');

    chooseServiceAndMode();
    dropFiles([png()]);
    await screen.findByTestId('open-batch-conflict');

    // Taking the whole screen away would remove the third way out — changing
    // their mind and going somewhere else.
    expect(screen.getByTestId('service-step')).toBeInTheDocument();
    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
  });
});

describe('T-UX-043 — every file rejected', () => {
  it('T-UX-043a: rejections are read from the error envelope, not just the 201', () => {
    const error = new ApiError('IMAGE_DECODE_FAILED', 422, 'That file could not be read.', {
      rejected: [{ fileName: 'broken.png', code: 'IMAGE_DECODE_FAILED', message: 'Corrupt.' }],
    });
    // ⚠ `api.md` §6.12: when NOTHING is accepted the request takes the first
    // rejection's own status, so the array rides in `details` and never in a
    // success body. A client reading only the 201 shows an EMPTY rejection
    // list on the one request where every single file failed.
    expect(rejectionsFromError(error).map((entry) => entry.fileName)).toEqual(['broken.png']);
  });

  it('T-UX-043b: a non-API failure yields no rejections rather than throwing', () => {
    expect(rejectionsFromError(new Error('offline'))).toEqual([]);
    expect(rejectionsFromError(undefined)).toEqual([]);
  });

  it('T-UX-043c: the all-rejected response leaves submit disabled and names the file', async () => {
    const { client } = stubClient({
      addBatchImages: () =>
        Promise.reject(
          new ApiError('UNSUPPORTED_IMAGE_FORMAT', 415, 'nextup accepts PNG, JPEG and HEIC.', {
            rejected: [
              { fileName: 'notes.pdf', code: 'UNSUPPORTED_IMAGE_FORMAT', message: 'Not an image.' },
            ],
          }),
        ),
    });
    renderAt('/upload', <UploadRoute client={client} />, '/upload');

    chooseServiceAndMode();
    dropFiles([png('notes.png')]);

    expect(await screen.findByTestId('rejected-name')).toHaveTextContent('notes.pdf');
    // §4.5 — nothing landed, so there is nothing to extract.
    expect(screen.getByTestId('submit-button')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// The review container's mutations
// ---------------------------------------------------------------------------

describe('T-DATA-008 — the review screen mutates only on a press', () => {
  it('T-DATA-008h: a bulk confirm re-reads the review afterwards', async () => {
    const { client, calls } = stubClient({
      getReview: async () => reviewWithOneAddition(),
    });
    renderAt('/batches/bat_1/review', <ReviewRoute client={client} />, '/batches/:batchId/review');

    fireEvent.click(await screen.findByTestId('confirm-all-button'));

    await waitFor(() => {
      expect(calls).toContain('confirmAllCandidates');
    });
    // ⚠ The server is the record of what the close will act on. A local tick
    // through would show the owner decisions the batch does not hold.
    await waitFor(() => {
      expect(calls.filter((call) => call === 'getReview').length).toBeGreaterThan(1);
    });
  });
});
