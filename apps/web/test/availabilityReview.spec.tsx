/**
 * US-064 (PRD `A55`) — the "Availability changes" screen on the web: its two
 * sections, the selection, the confirmed bulk answers, the per-row results,
 * "Check more titles", and the Library page's factual count line.
 *
 * ⚠ Invariant 8a: the screen and the Library line state facts. Nothing here
 * may render a reminder or a "you should".
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TitleAvailability, TitleListItem } from '../src/components/TitleRow';
import { AvailabilityReviewRoute } from '../src/containers/AvailabilityReviewRoute';
import {
  AVREV_APPLY_FAILED,
  AVREV_CHECK_FAILED,
  AVREV_EMPTY,
  AVREV_LOAD_FAILED,
  AVREV_LOADING,
  JUSTWATCH_ATTRIBUTION,
  WAITING_ADD_TO_LIBRARY_FAILED,
} from '../src/copy';
import {
  RefusedError,
  type ApiClient,
  type AvailabilityReviewApplyResponse,
  type AvailabilityReviewLibraryItem,
  type AvailabilityReviewResponse,
  type AvailabilityReviewWaitingItem,
} from '../src/lib/apiClient';
import {
  AVAILABILITY_REVIEW_APPLY_MAX,
  AvailabilityReviewPage,
  eligibleRows,
} from '../src/pages/AvailabilityReviewPage';
import { ListPage } from '../src/pages/ListPage';
import { LibraryNavigation } from '../src/components/LibraryNavigation';
import { ListRoute } from '../src/containers/ListRoute';
import { apiClient } from '../src/lib/apiClient';

const LEFT: TitleAvailability = {
  accessState: 'rent-only',
  checkedAt: '2026-09-20T10:00:00.000Z',
  region: 'US',
  streamingOn: [],
  rentOn: ['Apple TV'],
  left: ['netflix'],
  joined: [],
  signature: 'left=netflix;joined=',
  kept: false,
  canMoveToWaiting: true,
};

const JOINED: TitleAvailability = {
  ...LEFT,
  accessState: 'streaming',
  streamingOn: ['netflix', 'max'],
  rentOn: [],
  left: [],
  joined: ['max'],
  signature: 'left=;joined=max',
  canMoveToWaiting: false,
};

function libraryItem(
  id: string,
  name: string,
  availability: TitleAvailability = LEFT,
  extra: Partial<AvailabilityReviewLibraryItem> = {},
): AvailabilityReviewLibraryItem {
  return {
    titleId: id,
    workIdentity: `tmdb:movie:${id}`,
    name,
    releaseYear: 2021,
    posterPath: '/p.jpg',
    badges: [{ service: 'netflix', listingId: `l-${id}`, dateAdded: '2026-01-05' }],
    availability,
    ...extra,
  };
}

function waitingItem(
  id: string,
  name: string,
  extra: Partial<AvailabilityReviewWaitingItem> = {},
): AvailabilityReviewWaitingItem {
  return {
    intentId: `i-${id}`,
    titleId: id,
    workIdentity: `tmdb:tv:${id}`,
    name,
    releaseYear: null,
    posterPath: null,
    flaggedOn: ['netflix', 'max'],
    service: 'netflix',
    availabilityCheckedAt: '2026-09-21T10:00:00.000Z',
    availabilityRegion: 'US',
    ...extra,
  };
}

const DUNE = libraryItem('t-1', 'Dune');
const ARRIVAL = libraryItem('t-2', 'Arrival', JOINED, { releaseYear: null, posterPath: null });
const SEVERANCE = waitingItem('t-3', 'Severance');

function review(over: Partial<AvailabilityReviewResponse> = {}): AvailabilityReviewResponse {
  return {
    library: [DUNE, ARRIVAL],
    nowStreaming: [SEVERANCE],
    check: { checked: 142, notCheckedRecently: 37 },
    ...over,
  };
}

function applied(
  action: AvailabilityReviewApplyResponse['action'],
  results: AvailabilityReviewApplyResponse['results'],
): AvailabilityReviewApplyResponse {
  const done = results.filter((r) => r.outcome === 'done').length;
  return { action, results, done, refused: results.length - done };
}

function actions() {
  return {
    removeBadge: vi.fn().mockResolvedValue({}),
    moveToWaiting: vi.fn().mockResolvedValue({}),
    keepAvailability: vi.fn().mockResolvedValue({}),
    addBadge: vi.fn().mockResolvedValue({}),
    promoteWaiting: vi.fn().mockResolvedValue({}),
    checkMoreAvailability: vi.fn().mockResolvedValue({
      lookedUp: 20,
      failed: 0,
      checked: 162,
      notCheckedRecently: 17,
    }),
    applyAvailabilityReview: vi.fn(),
  };
}

function mount(
  data: AvailabilityReviewResponse | null,
  options: { offline?: boolean; loading?: boolean; loadFailed?: boolean } = {},
) {
  const acts = actions();
  const onChanged = vi.fn();
  const onRetry = vi.fn();
  render(
    <MemoryRouter>
      <AvailabilityReviewPage
        data={data}
        loading={options.loading ?? false}
        loadFailed={options.loadFailed ?? false}
        onRetry={onRetry}
        offline={options.offline ?? false}
        actions={acts as never}
        onChanged={onChanged}
      />
    </MemoryRouter>,
  );
  return { acts, onChanged, onRetry };
}

const select = (name: string) => screen.getByRole('checkbox', { name: `Select ${name}` });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('T-AVREV-009 sections, facts and attribution', () => {
  it('T-AVREV-009a: two labelled sections, each row with its fact, as-of date and answers', () => {
    mount(review());
    const library = screen.getByRole('region', { name: 'Library titles that changed' });
    const waiting = screen.getByRole('region', { name: 'Waiting titles now streaming' });
    expect(within(library).getAllByTestId('avrev-library-row')).toHaveLength(2);
    expect(within(waiting).getAllByTestId('avrev-waiting-row')).toHaveLength(1);
    expect(within(library).getByRole('link', { name: 'Dune (2021)' })).toHaveAttribute(
      'href',
      '/titles/t-1',
    );
    expect(within(library).getAllByTestId('avrev-asof')[0]).toHaveTextContent('Checked');
    expect(within(library).getAllByTestId('availability-keep')).toHaveLength(2);
    expect(within(waiting).getByTestId('avrev-waiting-fact')).toHaveTextContent(
      /Now streaming on Netflix and Max · Checked .* \(US\)/,
    );
    expect(within(waiting).getByRole('link', { name: 'Severance' })).toHaveAttribute(
      'href',
      '/waiting/t-3',
    );
    expect(screen.getByTestId('avrev-attribution')).toHaveTextContent(JUSTWATCH_ATTRIBUTION);
    expect(screen.queryByTestId('availability-attribution')).toBeNull();
    expect(screen.getByTestId('avrev-check-counts')).toHaveTextContent(
      '142 titles checked · 37 not checked recently',
    );
    expect(document.body.textContent).not.toMatch(/you should|remind|haven't/i);
  });

  it('T-AVREV-009b: an empty screen says what it is for, not that anything is due', () => {
    mount(review({ library: [], nowStreaming: [] }));
    expect(screen.getByTestId('avrev-empty')).toHaveTextContent(AVREV_EMPTY);
    expect(screen.queryByTestId('avrev-bar')).toBeNull();
    expect(screen.getByTestId('avrev-attribution')).toBeInTheDocument();
  });

  it('T-AVREV-009c: one empty section says so; unknown dates and years are left out', () => {
    mount(
      review({
        library: [libraryItem('t-9', 'Unknown', { ...LEFT, checkedAt: null })],
        nowStreaming: [],
      }),
    );
    expect(screen.queryByTestId('avrev-asof')).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Waiting titles now streaming' })).getByText(
        'None right now.',
      ),
    ).toBeInTheDocument();
    cleanup();
    mount(
      review({
        library: [],
        nowStreaming: [waitingItem('t-8', 'Later', { availabilityCheckedAt: null })],
      }),
    );
    expect(screen.getByTestId('avrev-waiting-fact')).toHaveTextContent(
      /^Now streaming on Netflix and Max$/,
    );
    expect(
      within(screen.getByRole('region', { name: 'Library titles that changed' })).getByText(
        'None right now.',
      ),
    ).toBeInTheDocument();
  });

  it('T-AVREV-009d: loading, failure and retry before any data', async () => {
    mount(null, { loading: true });
    expect(screen.getByText(AVREV_LOADING)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Availability changes');
    cleanup();
    const { onRetry } = mount(null, { loadFailed: true });
    expect(screen.queryByText(AVREV_LOADING)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent(AVREV_LOAD_FAILED);
  });
});

describe('T-AVREV-010 selection and eligibility', () => {
  it('T-AVREV-010a: checkboxes are labelled by title and counts follow each answer', async () => {
    mount(review());
    await userEvent.click(select('Dune'));
    await userEvent.click(select('Arrival'));
    expect(screen.getByTestId('avrev-selected-count')).toHaveTextContent('2 selected');
    expect(screen.getByTestId('avrev-bulk-keep')).toHaveTextContent('Keep as is (2)');
    expect(screen.getByTestId('avrev-bulk-remove-left-badges')).toHaveTextContent('(1)');
    expect(screen.getByTestId('avrev-bulk-move-to-waiting')).toHaveTextContent('(1)');
    expect(screen.getByTestId('avrev-bulk-add-to-library')).toBeDisabled();
    await userEvent.click(select('Dune'));
    expect(screen.getByTestId('avrev-selected-count')).toHaveTextContent('1 selected');
    await userEvent.click(screen.getByTestId('avrev-clear'));
    expect(screen.getByTestId('avrev-selected-count')).toHaveTextContent('0 selected');
    expect(screen.getByTestId('avrev-clear')).toBeDisabled();
  });

  it('T-AVREV-010b: select-all toggles one section at a time', async () => {
    mount(review());
    await userEvent.click(screen.getByTestId('avrev-select-all-waiting'));
    expect(select('Severance')).toBeChecked();
    expect(select('Dune')).not.toBeChecked();
    expect(screen.getByTestId('avrev-bulk-add-to-library')).toHaveTextContent('(1)');
    await userEvent.click(screen.getByTestId('avrev-select-all-library'));
    expect(screen.getByTestId('avrev-selected-count')).toHaveTextContent('3 selected');
    await userEvent.click(screen.getByTestId('avrev-select-all-library'));
    expect(select('Dune')).not.toBeChecked();
    expect(select('Severance')).toBeChecked();
  });

  it('T-AVREV-010c: eligibleRows applies each answer only where it means something', () => {
    const data = review({
      library: [DUNE, ARRIVAL, libraryItem('t-5', 'Nosig', { ...LEFT, signature: null })],
      nowStreaming: [SEVERANCE, waitingItem('t-6', 'Gone', { service: null })],
    });
    const all = new Set(['title:t-1', 'title:t-2', 'title:t-5', 'intent:i-t-3', 'intent:i-t-6']);
    expect(eligibleRows('keep', data, all).map((r) => r.id)).toEqual(['t-1', 't-2', 't-5']);
    expect(eligibleRows('keep', data, all)[2]?.signature).toBe('');
    expect(eligibleRows('remove-left-badges', data, all).map((r) => r.id)).toEqual(['t-1', 't-5']);
    expect(eligibleRows('move-to-waiting', data, all).map((r) => r.id)).toEqual(['t-1', 't-5']);
    expect(eligibleRows('add-to-library', data, all)).toEqual([
      { key: 'intent:i-t-3', id: 'i-t-3', name: 'Severance' },
    ]);
    expect(eligibleRows('keep', data, new Set())).toEqual([]);
  });
});

describe('T-AVREV-011 destructive bulk answers are confirmed', () => {
  it('T-AVREV-011a: Cancel has initial focus; Cancel and Escape change nothing', async () => {
    const { acts } = mount(review());
    await userEvent.click(select('Dune'));
    await userEvent.click(screen.getByTestId('avrev-bulk-remove-left-badges'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('avrev-confirm-body')).toHaveTextContent('removal history');
    expect(within(dialog).getByText('Dune')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByTestId('avrev-bulk-move-to-waiting'));
    expect(screen.getByTestId('avrev-confirm-body')).toHaveTextContent('Move these titles');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(acts.applyAvailabilityReview).not.toHaveBeenCalled();
  });

  it('T-AVREV-011b: confirming sends one request with each row and links removal history', async () => {
    const { acts, onChanged } = mount(review());
    acts.applyAvailabilityReview.mockResolvedValue(
      applied('remove-left-badges', [{ id: 't-1', outcome: 'done' }]),
    );
    await userEvent.click(select('Dune'));
    await userEvent.click(screen.getByTestId('avrev-bulk-remove-left-badges'));
    await userEvent.click(screen.getByTestId('avrev-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('avrev-result')).toHaveTextContent(
        "1 done, 0 couldn't be changed.",
      ),
    );
    expect(acts.applyAvailabilityReview).toHaveBeenCalledWith('remove-left-badges', [
      { id: 't-1', signature: 'left=netflix;joined=' },
    ]);
    expect(within(screen.getByTestId('avrev-result')).getByRole('link')).toHaveAttribute(
      'href',
      '/removed',
    );
    expect(screen.getByTestId('avrev-live')).toHaveAttribute('aria-live', 'polite');
    expect(onChanged).toHaveBeenCalledOnce();
  });
});

describe('T-AVREV-012 per-row results', () => {
  it('T-AVREV-012a: "N done, M couldn\'t be changed"; refused rows stay selected with their reason', async () => {
    const { acts } = mount(review());
    acts.applyAvailabilityReview.mockResolvedValue(
      applied('keep', [
        { id: 't-1', outcome: 'done' },
        {
          id: 't-2',
          outcome: 'refused',
          code: 'AVAILABILITY_CHANGED',
          message: 'Its availability changed since this screen loaded.',
        },
      ]),
    );
    await userEvent.click(screen.getByTestId('avrev-select-all-library'));
    await userEvent.click(screen.getByTestId('avrev-bulk-keep'));
    await waitFor(() =>
      expect(screen.getByTestId('avrev-result')).toHaveTextContent(
        "1 done, 1 couldn't be changed.",
      ),
    );
    expect(screen.getByTestId('avrev-refused')).toHaveTextContent(
      'Arrival — Its availability changed since this screen loaded.',
    );
    expect(screen.getByTestId('avrev-row-reason')).toHaveTextContent('Its availability changed');
    expect(select('Arrival')).toBeChecked();
    expect(select('Dune')).not.toBeChecked();
    expect(within(screen.getByTestId('avrev-result')).queryByRole('link')).toBeNull();
  });

  it('T-AVREV-012b: a refusal without a message, or a row the server never answered, is not counted as refused twice', async () => {
    const { acts } = mount(review());
    acts.applyAvailabilityReview.mockResolvedValue({
      action: 'add-to-library',
      results: [{ id: 'i-t-3', outcome: 'refused', code: 'NOT_FOUND' }],
      done: 0,
      refused: 1,
    } as AvailabilityReviewApplyResponse);
    await userEvent.click(select('Severance'));
    await userEvent.click(screen.getByTestId('avrev-bulk-add-to-library'));
    await waitFor(() =>
      expect(screen.getByTestId('avrev-row-reason')).toHaveTextContent(AVREV_APPLY_FAILED),
    );
    expect(acts.applyAvailabilityReview).toHaveBeenCalledWith('add-to-library', [{ id: 'i-t-3' }]);
  });

  it('T-AVREV-012c: a removal with nothing done offers no history link; a missing result is not a refusal', async () => {
    const { acts } = mount(review());
    acts.applyAvailabilityReview.mockResolvedValue(applied('move-to-waiting', []));
    await userEvent.click(select('Dune'));
    await userEvent.click(screen.getByTestId('avrev-bulk-move-to-waiting'));
    await userEvent.click(screen.getByTestId('avrev-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('avrev-result')).toHaveTextContent(
        "0 done, 0 couldn't be changed.",
      ),
    );
    expect(within(screen.getByTestId('avrev-result')).queryByRole('link')).toBeNull();
    expect(screen.queryByTestId('avrev-refused')).toBeNull();
  });

  it('T-AVREV-012d: a failed request says nothing changed', async () => {
    const { acts } = mount(review());
    acts.applyAvailabilityReview.mockRejectedValue(new Error('offline'));
    await userEvent.click(select('Dune'));
    await userEvent.click(screen.getByTestId('avrev-bulk-keep'));
    await waitFor(() =>
      expect(screen.getByTestId('avrev-apply-error')).toHaveTextContent(AVREV_APPLY_FAILED),
    );
  });

  it('T-AVREV-012e: a selection larger than the server cap goes in chunks', async () => {
    const many = Array.from({ length: AVAILABILITY_REVIEW_APPLY_MAX + 1 }, (_, i) =>
      libraryItem(`m-${String(i)}`, `Movie ${String(i)}`),
    );
    const { acts } = mount(review({ library: many, nowStreaming: [] }));
    acts.applyAvailabilityReview.mockImplementation(
      (action: 'keep', items: readonly { id: string }[]) =>
        Promise.resolve(
          applied(
            action,
            items.map((item) => ({ id: item.id, outcome: 'done' as const })),
          ),
        ),
    );
    await userEvent.click(screen.getByTestId('avrev-select-all-library'));
    await userEvent.click(screen.getByTestId('avrev-bulk-keep'));
    await waitFor(() =>
      expect(screen.getByTestId('avrev-result')).toHaveTextContent(
        `${String(AVAILABILITY_REVIEW_APPLY_MAX + 1)} done`,
      ),
    );
    expect(acts.applyAvailabilityReview).toHaveBeenCalledTimes(2);
  });

  it('T-AVREV-012f: one-tap answers on a row still work and re-read the screen', async () => {
    const { acts, onChanged } = mount(review());
    await userEvent.click(screen.getAllByTestId('availability-keep')[0] as HTMLElement);
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(acts.keepAvailability).toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('avrev-promote-max'));
    await waitFor(() =>
      expect(screen.getByTestId('availability-notice')).toHaveTextContent('Added to your Library.'),
    );
    expect(acts.promoteWaiting).toHaveBeenCalledWith('i-t-3', 'max');
    acts.promoteWaiting.mockRejectedValueOnce(new Error('nope'));
    await userEvent.click(screen.getByTestId('avrev-promote-netflix'));
    await waitFor(() =>
      expect(screen.getByTestId('avrev-promote-error')).toHaveTextContent(
        WAITING_ADD_TO_LIBRARY_FAILED,
      ),
    );
  });
});

describe('T-AVREV-013 check more titles', () => {
  it('T-AVREV-013a: one tap says Working…, then shows the new counts', async () => {
    const { acts, onChanged } = mount(review());
    let resolve: (value: unknown) => void = () => undefined;
    acts.checkMoreAvailability.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await userEvent.click(screen.getByTestId('avrev-check-more'));
    expect(screen.getByTestId('avrev-check-more')).toHaveTextContent('Working…');
    expect(screen.getByTestId('avrev-check-more')).toBeDisabled();
    await act(async () => {
      resolve({ lookedUp: 20, failed: 2, checked: 160, notCheckedRecently: 19 });
      await Promise.resolve();
    });
    expect(screen.getByTestId('avrev-check-counts')).toHaveTextContent(
      '160 titles checked · 19 not checked recently',
    );
    expect(screen.getByTestId('avrev-live')).toHaveTextContent(
      "Checked 20 · 2 couldn't be checked just now.",
    );
    expect(onChanged).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByTestId('avrev-check-more'));
    await waitFor(() =>
      expect(screen.getByTestId('avrev-live')).toHaveTextContent(/^Checked 20\.$/),
    );
  });

  it('T-AVREV-013b: a failed tap says nothing changed; nothing to check disables it', async () => {
    const { acts } = mount(review());
    acts.checkMoreAvailability.mockRejectedValueOnce(new Error('down'));
    await userEvent.click(screen.getByTestId('avrev-check-more'));
    await waitFor(() =>
      expect(screen.getByTestId('avrev-check-error')).toHaveTextContent(AVREV_CHECK_FAILED),
    );
    cleanup();
    mount(review({ check: { checked: 10, notCheckedRecently: 0 } }));
    expect(screen.getByTestId('avrev-check-more')).toBeDisabled();
  });

  it('T-AVREV-013c: offline disables the check and every answer, and says why', () => {
    mount(review(), { offline: true });
    expect(screen.getByTestId('avrev-check-more')).toBeDisabled();
    expect(screen.getByTestId('avrev-offline')).toBeInTheDocument();
    expect(select('Dune')).toBeDisabled();
    expect(screen.getByTestId('avrev-bulk-keep')).toBeDisabled();
    expect(screen.getByTestId('avrev-promote-netflix')).toBeDisabled();
  });
});

function client(overrides: Partial<Record<keyof ApiClient, unknown>>): ApiClient {
  return overrides as unknown as ApiClient;
}

describe('T-AVREV-014 the container', () => {
  it('T-AVREV-014a: reads once, keeps the screen up while re-reading, and retries a failed read', async () => {
    let second: (value: AvailabilityReviewResponse) => void = () => undefined;
    const getAvailabilityReview = vi
      .fn()
      .mockResolvedValueOnce(review())
      .mockReturnValueOnce(new Promise((r) => (second = r)))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(review({ library: [], nowStreaming: [] }));
    const keepAvailability = vi.fn().mockResolvedValue({});
    render(
      <MemoryRouter>
        <AvailabilityReviewRoute client={client({ getAvailabilityReview, keepAvailability })} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByTestId('avrev-library-row')).toHaveLength(2));
    await userEvent.click(screen.getAllByTestId('availability-keep')[0] as HTMLElement);
    await waitFor(() => expect(getAvailabilityReview).toHaveBeenCalledTimes(2));
    expect(screen.getAllByTestId('avrev-library-row')).toHaveLength(2);
    await act(async () => {
      second(review({ library: [ARRIVAL] }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getAllByTestId('avrev-library-row')).toHaveLength(1));
    await userEvent.click(screen.getByTestId('availability-keep'));
    await waitFor(() => expect(screen.getByText(AVREV_LOAD_FAILED)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByTestId('avrev-empty')).toBeInTheDocument());
  });

  it('T-AVREV-014b: a refused read shows the refusal page, not a retry', async () => {
    const getAvailabilityReview = vi.fn().mockRejectedValue(new RefusedError('No.', {}));
    render(
      <MemoryRouter>
        <AvailabilityReviewRoute client={client({ getAvailabilityReview })} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.queryByText(AVREV_LOADING)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

const DUNE_LIST: TitleListItem = {
  titleId: '01J8ZC',
  workIdentity: 'tmdb:movie:438631',
  matchState: 'matched',
  name: 'Dune',
  mediaType: 'movie',
  releaseYear: 2021,
  genres: ['Science Fiction'],
  runtimeMinutes: 155,
  posterPath: null,
  badges: [{ service: 'netflix', listingId: '01J8ZD', dateAdded: '2026-04-02' }],
  sortDateAdded: '2026-04-02',
  dateAddedLabel: 'Added to nextup 2 Apr 2026',
};

describe('T-AVREV-015 the Library page count line', () => {
  it('T-AVREV-015a: hidden at zero, and absent when no count is given', () => {
    render(
      <MemoryRouter>
        <ListPage items={[DUNE_LIST]} serviceState={null} availabilityChangeCount={0} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('library-availability-count')).toBeNull();
    cleanup();
    render(
      <MemoryRouter>
        <ListPage items={[DUNE_LIST]} serviceState={null} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('library-availability-count')).toBeNull();
  });

  it('T-AVREV-015b: a factual link to the screen, singular and plural, never a nag', () => {
    render(
      <MemoryRouter>
        <ListPage items={[DUNE_LIST]} serviceState={null} availabilityChangeCount={1} />
      </MemoryRouter>,
    );
    const one = screen.getAllByTestId('library-availability-count');
    expect(one[0]).toHaveTextContent(/^1 availability change$/);
    expect(one[0]).toHaveAttribute('href', '/availability');
    cleanup();
    render(
      <MemoryRouter>
        <ListPage items={[DUNE_LIST]} serviceState={null} availabilityChangeCount={3} />
      </MemoryRouter>,
    );
    const many = screen.getAllByTestId('library-availability-count');
    for (const link of many) expect(link).toHaveTextContent(/^3 availability changes$/);
    expect(document.body.textContent).not.toMatch(/you should|remind|overdue/i);
  });

  it('T-AVREV-015c: the Library reads the count from the stored-data summary, after its titles', async () => {
    vi.spyOn(apiClient, 'getTitles').mockResolvedValue({
      items: [DUNE_LIST],
      nextCursor: null,
      limit: 50,
    });
    vi.spyOn(apiClient, 'getServiceState').mockResolvedValue({ services: [] });
    vi.spyOn(apiClient, 'getSuppressions').mockResolvedValue({ items: [] });
    vi.spyOn(apiClient, 'getRemoved').mockResolvedValue({ items: [], nextCursor: null, limit: 50 });
    const summary = vi
      .spyOn(apiClient, 'getAvailabilityReviewSummary')
      .mockResolvedValueOnce({ count: 4 })
      .mockRejectedValueOnce(new Error('down'));
    const view = (key: string) => (
      <MemoryRouter key={key}>
        <LibraryNavigation>
          <ListRoute client={apiClient} />
        </LibraryNavigation>
      </MemoryRouter>
    );
    const { rerender } = render(view('a'));
    await waitFor(() =>
      expect(screen.getAllByTestId('library-availability-count')[0]).toHaveTextContent(
        '4 availability changes',
      ),
    );
    expect(summary).toHaveBeenCalledOnce();
    rerender(view('b'));
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('library-availability-count')).toBeNull());
    cleanup();
    const withoutSummary = { ...apiClient, getAvailabilityReviewSummary: undefined };
    render(
      <MemoryRouter>
        <LibraryNavigation>
          <ListRoute client={withoutSummary as unknown as typeof apiClient} />
        </LibraryNavigation>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByTestId('title-name')[0]).toHaveTextContent('Dune'));
    expect(screen.queryByTestId('library-availability-count')).toBeNull();
  });
});
