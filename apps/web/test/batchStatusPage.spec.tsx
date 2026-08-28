/**
 * TASK-059 — `/batches/:batchId` extraction status (`ux-states.md` §5).
 *
 * `specs/testing.md`:
 *   `T-UX-007` — per-image progress and per-image failure states render
 *                WITHOUT navigating away (this screen is visible for minutes)
 *   `T-UX-008` — the degraded / cross-check-unavailable banner renders when
 *                either extraction leg is missing
 *
 * ⚠ The `T-UX-008` cases are the load-bearing ones. Whenever that banner
 * shows, full-update removals were withheld (product invariant 2), so a
 * silently-absent banner leaves the owner with no explanation for a missing
 * removal section — a failure that looks like nothing at all.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEGRADED_EXTRACTION_BANNER } from '@nextup/domain';

import {
  BatchStatusPage,
  isDegraded,
  statusHeadline,
  zeroYieldImages,
} from '../src/pages/BatchStatusPage';
import {
  STATUS_CONTINUE_LABEL,
  STATUS_DISCARD_BATCH_LABEL,
  STATUS_DISCARD_LABEL,
  STATUS_ERROR_EXTRACTOR,
  STATUS_ERROR_PURGED,
  STATUS_ERROR_UNAVAILABLE,
  STATUS_OFFLINE,
  STATUS_PURGED_ACTION_LABEL,
  STATUS_RETRY_LABEL,
} from '../src/copy';
import type { BatchImage, BatchStatus } from '../src/lib/apiClient';

afterEach(cleanup);

function image(overrides: Partial<BatchImage> = {}): BatchImage {
  return {
    imageId: `img-${String(Math.random()).slice(2, 8)}`,
    fileName: 'IMG_0421.PNG',
    ingestSource: 'upload',
    available: true,
    retainUntil: '2026-09-09T20:03:00.000Z',
    candidateCount: 14,
    href: '/api/images/img-1',
    ...overrides,
  };
}

function batch(overrides: Partial<BatchStatus> = {}): BatchStatus {
  return {
    batchId: 'b-1',
    service: 'netflix',
    mode: 'full-update',
    status: 'extracting',
    derivedFromBatchId: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    submittedAt: '2026-08-01T10:01:00.000Z',
    completedAt: null,
    images: [image({ imageId: 'a' }), image({ imageId: 'b' })],
    extractionError: null,
    lowYield: false,
    progress: { imagesDone: 4, imagesTotal: 7 },
    provenance: { created: [], modified: [], removed: [] },
    changedNothing: true,
    titles: [],
    ...overrides,
  };
}

describe('T-UX-007 — per-image progress without navigating away', () => {
  it('T-UX-007a: a submitted batch reads as QUEUED, with both counts', () => {
    render(<BatchStatusPage batch={batch({ status: 'submitted' })} />);
    expect(screen.getByTestId('batch-status-headline')).toHaveTextContent(
      'Queued — 4 of 7 screenshots read.',
    );
  });

  it('T-UX-007b: an extracting batch reads as RUNNING, not queued', () => {
    render(<BatchStatusPage batch={batch()} />);
    expect(screen.getByTestId('batch-status-headline')).toHaveTextContent('Reading 4 of 7…');
  });

  it('T-UX-007c: status, not imagesDone, decides queued vs running', () => {
    // ⚠ The regression this exists for: a batch that IS extracting but has
    // finished nothing yet must not be reported as still queued.
    expect(
      statusHeadline(batch({ status: 'extracting', progress: { imagesDone: 0, imagesTotal: 7 } })),
    ).toBe('Reading 0 of 7…');
  });

  it('T-UX-007d: a batch with no progress block shows no headline', () => {
    expect(statusHeadline(batch({ status: 'in-review', progress: undefined }))).toBeNull();
  });

  it('T-UX-007e: every image renders its own tile — progress is per-image', () => {
    render(
      <BatchStatusPage
        batch={batch({
          images: [image({ imageId: 'a' }), image({ imageId: 'b' }), image({ imageId: 'c' })],
        })}
      />,
    );
    expect(screen.getAllByTestId('batch-status-image')).toHaveLength(3);
  });

  it('T-UX-007f: each tile NAMES its file, not just a thumbnail (US-006 AC-3)', () => {
    render(
      <BatchStatusPage
        batch={batch({
          images: [image({ imageId: 'a', fileName: 'IMG_0001.HEIC' })],
        })}
      />,
    );
    expect(screen.getByTestId('batch-status-filename')).toHaveTextContent('IMG_0001.HEIC');
  });

  it('T-UX-007g: the thumbnail is the API href, never a blob URL (NFR-020)', () => {
    render(
      <BatchStatusPage
        batch={batch({ images: [image({ imageId: 'a', href: '/api/images/01J8ZG' })] })}
      />,
    );
    expect(screen.getByTestId('batch-status-thumb')).toHaveAttribute('src', '/api/images/01J8ZG');
  });

  it('T-UX-007h: an unavailable image renders a placeholder, not a broken img', () => {
    render(
      <BatchStatusPage batch={batch({ images: [image({ imageId: 'a', available: false })] })} />,
    );
    expect(screen.getByTestId('batch-status-thumb-missing')).toBeInTheDocument();
    expect(screen.queryByTestId('batch-status-thumb')).not.toBeInTheDocument();
  });

  it('T-UX-007i: §5.3 names how many screenshots yielded nothing', () => {
    render(
      <BatchStatusPage
        batch={batch({
          images: [
            image({ imageId: 'a', candidateCount: 0 }),
            image({ imageId: 'b', candidateCount: 14 }),
          ],
        })}
      />,
    );
    expect(screen.getByTestId('batch-status-zero-yield')).toHaveTextContent(
      'No text was found in 1 of 2 screenshots',
    );
  });

  it('T-UX-007j: an unread image is NOT counted as zero-yield', () => {
    // ⚠ `candidateCount: null` means "not read yet". Counting it as a failure
    // would accuse every in-flight screenshot of being unreadable.
    expect(
      zeroYieldImages([image({ candidateCount: null }), image({ candidateCount: 0 })]),
    ).toHaveLength(1);
  });

  it('T-UX-007k: no zero-yield notice at all when every image yielded', () => {
    render(<BatchStatusPage batch={batch()} />);
    expect(screen.queryByTestId('batch-status-zero-yield')).not.toBeInTheDocument();
  });

  it('T-UX-007l: an in-progress batch offers Discard and NOT Continue', async () => {
    const onDiscard = vi.fn();
    render(<BatchStatusPage batch={batch()} onDiscard={onDiscard} onContinue={vi.fn()} />);
    expect(screen.queryByRole('button', { name: STATUS_CONTINUE_LABEL })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: STATUS_DISCARD_LABEL }));
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it('T-UX-007m: a finished batch offers Continue and NOT Discard', () => {
    render(
      <BatchStatusPage
        batch={batch({ status: 'in-review', progress: undefined })}
        onDiscard={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: STATUS_CONTINUE_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: STATUS_DISCARD_LABEL })).not.toBeInTheDocument();
  });

  it('T-UX-007n: §5.5 EXTRACTOR_ERROR reassures AND offers both actions', async () => {
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    render(
      <BatchStatusPage
        batch={batch({ extractionError: 'EXTRACTOR_ERROR' })}
        onRetry={onRetry}
        onDiscard={onDiscard}
      />,
    );
    const alert = screen.getByTestId('batch-status-error');
    expect(within(alert).getByTestId('batch-status-error-message')).toHaveTextContent(
      STATUS_ERROR_EXTRACTOR,
    );
    await userEvent.click(within(alert).getByRole('button', { name: STATUS_RETRY_LABEL }));
    await userEvent.click(within(alert).getByRole('button', { name: STATUS_DISCARD_BATCH_LABEL }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it('T-UX-007o: §5.6 EXTRACTOR_UNAVAILABLE is transient — retry only, no discard', () => {
    render(
      <BatchStatusPage
        batch={batch({ extractionError: 'EXTRACTOR_UNAVAILABLE' })}
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByTestId('batch-status-error-message')).toHaveTextContent(
      STATUS_ERROR_UNAVAILABLE,
    );
    // The service is merely busy; the batch is still good, so offering to
    // destroy it here would be wrong.
    expect(
      screen.queryByRole('button', { name: STATUS_DISCARD_BATCH_LABEL }),
    ).not.toBeInTheDocument();
  });

  it('T-UX-007p: §5.7 IMAGES_PURGED offers new screenshots and NEVER a retry', async () => {
    const onUploadNew = vi.fn();
    render(
      <BatchStatusPage
        batch={batch({ extractionError: 'IMAGES_PURGED' })}
        onRetry={vi.fn()}
        onUploadNew={onUploadNew}
      />,
    );
    expect(screen.getByTestId('batch-status-error-message')).toHaveTextContent(STATUS_ERROR_PURGED);
    // ⚠ The blobs are gone under the 30-day purge; a retry could only loop.
    expect(screen.queryByRole('button', { name: STATUS_RETRY_LABEL })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: STATUS_PURGED_ACTION_LABEL }));
    expect(onUploadNew).toHaveBeenCalledOnce();
  });

  it('T-UX-007q: an error replaces the progress view, not sits beside it', () => {
    render(<BatchStatusPage batch={batch({ extractionError: 'EXTRACTOR_ERROR' })} />);
    expect(screen.queryByTestId('batch-status-headline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('batch-status-images')).not.toBeInTheDocument();
  });

  it('T-UX-007r: §5.8 offline shows a banner and invents no error', () => {
    render(<BatchStatusPage batch={batch()} offline />);
    expect(screen.getByTestId('batch-status-offline')).toHaveTextContent(STATUS_OFFLINE);
    expect(screen.queryByTestId('batch-status-error')).not.toBeInTheDocument();
    // Polling paused — the last known progress must survive on screen.
    expect(screen.getByTestId('batch-status-headline')).toBeInTheDocument();
  });

  it('T-UX-007s: a failed load renders an alert, never an empty progress view', () => {
    render(<BatchStatusPage loadFailed onRetry={vi.fn()} />);
    expect(screen.getByTestId('batch-status-load-error')).toBeInTheDocument();
    expect(screen.queryByTestId('batch-status-images')).not.toBeInTheDocument();
  });
  it('T-UX-007t: a load failure OVER a stale batch still alerts, never shows stale progress as live', () => {
    // ⚠ The distinguishing case. With no batch at all the two branches happen
    // to agree; the failure that matters is a poll erroring after progress was
    // already on screen, where continuing to render it would present a frozen
    // count as a live one.
    render(<BatchStatusPage batch={batch()} loadFailed onRetry={vi.fn()} />);
    expect(screen.getByTestId('batch-status-load-error')).toBeInTheDocument();
    expect(screen.queryByTestId('batch-status-headline')).not.toBeInTheDocument();
  });
});

describe('T-UX-008 — the degraded / cross-check-unavailable banner', () => {
  it('T-UX-008a: §5.9 — the tile reader was unavailable', () => {
    render(<BatchStatusPage batch={batch({ crossCheck: 'llm-unavailable' })} />);
    expect(screen.getByTestId('batch-status-degraded')).toHaveTextContent(
      DEGRADED_EXTRACTION_BANNER,
    );
  });

  it('T-UX-008b: §5.10 — the CROSS-CHECK reader down shows the same banner', () => {
    // ⚠ The likely bug: treating `ocr-unavailable` as healthy because removals
    // are still permitted. §5.10 says same wording, milder consequence — the
    // owner still needs to know this read was uncorroborated.
    render(<BatchStatusPage batch={batch({ crossCheck: 'ocr-unavailable' })} />);
    expect(screen.getByTestId('batch-status-degraded')).toHaveTextContent(
      DEGRADED_EXTRACTION_BANNER,
    );
  });

  it('T-UX-008c: `degradedExtraction` alone is enough to raise it', () => {
    render(<BatchStatusPage batch={batch({ degradedExtraction: true })} />);
    expect(screen.getByTestId('batch-status-degraded')).toBeInTheDocument();
  });

  it('T-UX-008d: a healthy batch shows NO banner', () => {
    render(<BatchStatusPage batch={batch({ crossCheck: 'ok' })} />);
    expect(screen.queryByTestId('batch-status-degraded')).not.toBeInTheDocument();
  });

  it('T-UX-008e: a batch with neither field set shows no banner', () => {
    expect(isDegraded(batch())).toBe(false);
  });

  it('T-UX-008f: the banner survives COMPLETION — the read still went one-legged', () => {
    render(
      <BatchStatusPage
        batch={batch({ status: 'in-review', progress: undefined, crossCheck: 'llm-unavailable' })}
      />,
    );
    expect(screen.getByTestId('batch-status-degraded')).toBeInTheDocument();
  });

  it('T-UX-008g: it is NOT dismissible — no control can remove it', () => {
    // §5.9 requires a persistent, non-dismissible banner. A close button is
    // the natural thing to add and would defeat the whole purpose.
    render(<BatchStatusPage batch={batch({ crossCheck: 'llm-unavailable' })} />);
    const banner = screen.getByTestId('batch-status-degraded');
    expect(within(banner).queryAllByRole('button')).toHaveLength(0);
  });

  it('T-UX-008h: the wording is IDENTICAL to the review page banner', () => {
    // ⚠ `ux-states.md` §5.9 demands the same banner on both surfaces. This
    // asserts the shared domain constant is what renders, so the two cannot
    // drift apart on the next copy edit.
    render(<BatchStatusPage batch={batch({ crossCheck: 'llm-unavailable' })} />);
    expect(screen.getByTestId('batch-status-degraded').textContent).toBe(
      DEGRADED_EXTRACTION_BANNER,
    );
  });

  it('T-UX-008j: the banner text is pinned VERBATIM to `ux-states.md` §5.9', () => {
    // ⚠ Every other case compares against the imported constant, so a change
    // to the constant would move both sides and go unnoticed. This one spells
    // the spec text out so the copy cannot drift from §5.9 silently.
    expect(DEGRADED_EXTRACTION_BANNER).toBe(
      'One of the two readers was unavailable, so these results may be less ' +
        'complete than usual. Nothing has been removed from your list \u2014 you ' +
        'can still add titles, and you can re-read these screenshots later.',
    );
  });

  it('T-UX-008i: the banner shows ALONGSIDE progress, not instead of it', () => {
    render(<BatchStatusPage batch={batch({ crossCheck: 'llm-unavailable' })} />);
    expect(screen.getByTestId('batch-status-degraded')).toBeInTheDocument();
    expect(screen.getByTestId('batch-status-headline')).toBeInTheDocument();
  });
});
