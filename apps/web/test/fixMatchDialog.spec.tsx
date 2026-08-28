/**
 * TASK-111 — `components/FixMatchDialog.tsx`.
 *
 * `T-UI-020` — `FixMatchDialog` renders the TMDB search input and results and
 * lets the owner select a new match, wired to the fix-match action.
 *
 * `T-UX-033` — TMDB unavailable (502): the dialog reports it and nothing is
 * changed (`specs/ux-states.md` §3.4, US-030 AC-6).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  FixMatchDialog,
  TMDB_UNAVAILABLE_MESSAGE,
  type FixMatchDialogProps,
  type FixMatchRequest,
  type FixMatchResponse,
  type TmdbSearchResponse,
} from '../src/components/FixMatchDialog';
import { FIXMATCH_SUPPRESSION_MIGRATED } from '../src/copy';

const TITLE_ID = '01J8ZE0000000000000000000T';
const TITLE_NAME = 'Dune';

const SEARCH_RESULT = {
  tmdbId: 438631,
  mediaType: 'movie' as const,
  name: 'Dune: Part One',
  releaseYear: 2021,
  posterPath: '/d5NXS.jpg',
};

const BADGES = [
  { service: 'netflix', listingId: '01J8ZD000000000000000000L', dateAdded: '2 Apr 2026' },
];

function searchResponse(items = [SEARCH_RESULT]): TmdbSearchResponse {
  return { items };
}

function fixMatchResponse(over: Partial<FixMatchResponse> = {}): FixMatchResponse {
  return {
    titleId: TITLE_ID,
    workIdentity: 'tmdb:movie:438631',
    preserved: {
      listingIds: [BADGES[0]?.listingId ?? ''],
      dateAdded: { [BADGES[0]?.listingId ?? '']: '2026-04-02' },
      sortDateAdded: '2026-04-02',
    },
    suppressionMigrated: null,
    ...over,
  };
}

function mount(over: Partial<FixMatchDialogProps> = {}) {
  const searchTmdb = vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    over.searchTmdb ?? ((_q: string) => Promise.resolve(searchResponse())),
  );
  const fixMatch = vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    over.fixMatch ?? ((_id: string, _req: FixMatchRequest) => Promise.resolve(fixMatchResponse())),
  );
  const onClose = vi.fn(over.onClose ?? (() => undefined));
  render(
    <FixMatchDialog
      titleId={TITLE_ID}
      name={TITLE_NAME}
      badges={BADGES}
      searchTmdb={searchTmdb}
      fixMatch={fixMatch}
      onClose={onClose}
    />,
  );
  return { searchTmdb, fixMatch, onClose, user: userEvent.setup() };
}

// ── T-UI-020 ─────────────────────────────────────────────────────────────────

describe('T-UI-020 - FixMatchDialog renders search input, results, and selection', () => {
  it('T-UI-020a renders a TMDB search input on open', () => {
    mount();
    expect(screen.getByTestId('tmdb-search-input')).toBeTruthy();
  });

  it('T-UI-020b typing triggers a debounced search', async () => {
    const { searchTmdb, user } = mount();

    await user.type(screen.getByTestId('tmdb-search-input'), 'Dune');

    // Debounce is 300 ms — wait for the call.
    await waitFor(() => expect(searchTmdb).toHaveBeenCalled(), { timeout: 1000 });
    expect(searchTmdb).toHaveBeenCalledWith('Dune');
  });

  it('T-UI-020c results appear with name, year, and type', async () => {
    const { user } = mount();

    await user.type(screen.getByTestId('tmdb-search-input'), 'Dune');

    await screen.findByTestId('tmdb-results');
    expect(screen.getByTestId('result-name').textContent).toBe(SEARCH_RESULT.name);
    expect(screen.getByTestId('result-year').textContent).toBe(String(SEARCH_RESULT.releaseYear));
    expect(screen.getByTestId('result-type').textContent).toBe('Movie');
  });

  it('T-UI-020d a poster image is shown for results that have one', async () => {
    const { user } = mount();

    await user.type(screen.getByTestId('tmdb-search-input'), 'Dune');

    await screen.findByTestId('result-poster');
    const img = screen.getByTestId('result-poster') as HTMLImageElement;
    expect(img.src).toContain(SEARCH_RESULT.posterPath);
  });

  it('T-UI-020e selecting a result moves to the confirmation step', async () => {
    const { user } = mount();

    await user.type(screen.getByTestId('tmdb-search-input'), 'Dune');
    await screen.findByTestId('tmdb-results');
    await user.click(screen.getByTestId(`select-result-${SEARCH_RESULT.tmdbId}`));

    // The selected name appears in the confirmation.
    expect(screen.getByTestId('selected-name').textContent).toBe(SEARCH_RESULT.name);
  });

  it('T-UI-020f confirmation names the preserved badge and date', async () => {
    const { user } = mount();

    await user.type(screen.getByTestId('tmdb-search-input'), 'Dune');
    await screen.findByTestId('tmdb-results');
    await user.click(screen.getByTestId(`select-result-${SEARCH_RESULT.tmdbId}`));

    const notice = screen.getByTestId('preserved-notice');
    expect(notice.textContent).toContain('netflix');
    expect(notice.textContent).toContain('2 Apr 2026');
  });

  it('T-UI-020g confirm button submits the fix-match', async () => {
    const { fixMatch, user } = mount();

    await user.type(screen.getByTestId('tmdb-search-input'), 'Dune');
    await screen.findByTestId('tmdb-results');
    await user.click(screen.getByTestId(`select-result-${SEARCH_RESULT.tmdbId}`));
    await user.click(screen.getByTestId('confirm-fix-match'));

    await waitFor(() => expect(fixMatch).toHaveBeenCalledTimes(1));
    const [id, req] = fixMatch.mock.calls[0] as [string, FixMatchRequest];
    expect(id).toBe(TITLE_ID);
    expect(req.tmdbId).toBe(SEARCH_RESULT.tmdbId);
    expect(req.mediaType).toBe(SEARCH_RESULT.mediaType);
    expect(req.confirmDuplicate).toBe(false);
  });

  it('T-UI-020h success shows a role="status" message', async () => {
    const { user } = mount();

    await user.type(screen.getByTestId('tmdb-search-input'), 'Dune');
    await screen.findByTestId('tmdb-results');
    await user.click(screen.getByTestId(`select-result-${SEARCH_RESULT.tmdbId}`));
    await user.click(screen.getByTestId('confirm-fix-match'));

    await screen.findByRole('status');
    expect(screen.getByRole('status').textContent).toContain(TITLE_NAME);
  });

  it('T-UI-020i shows suppression-migration copy when the response reports it', async () => {
    const { user } = mount({
      fixMatch: () =>
        Promise.resolve(
          fixMatchResponse({
            suppressionMigrated: {
              from: 'unmatched:abc123',
              to: 'tmdb:movie:438631',
            },
          }),
        ),
    });

    await user.type(screen.getByTestId('tmdb-search-input'), 'Dune');
    await screen.findByTestId('tmdb-results');
    await user.click(screen.getByTestId(`select-result-${SEARCH_RESULT.tmdbId}`));
    await user.click(screen.getByTestId('confirm-fix-match'));

    await screen.findByTestId('suppression-migrated');
    // §3.7 — the migration is always stated, never silent.
    expect(screen.getByTestId('suppression-migrated').textContent).toBe(
      FIXMATCH_SUPPRESSION_MIGRATED,
    );
  });

  it('T-UI-020j no-results state names the query', async () => {
    const { user } = mount({ searchTmdb: () => Promise.resolve({ items: [] }) });

    await user.type(screen.getByTestId('tmdb-search-input'), 'xyz123');

    await screen.findByRole('status');
    expect(screen.getByRole('status').textContent).toContain('xyz123');
  });

  it('T-UI-020k cancel before selecting fires onClose', async () => {
    const { onClose, user } = mount();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ── T-UX-033 ─────────────────────────────────────────────────────────────────

describe('T-UX-033 - TMDB unavailable (502) dialog reports it; nothing is changed', () => {
  /** Reach the confirming step, then make the fix-match POST fail with 502. */
  async function reachUnavailableState() {
    class TmdbUnavailableError extends Error {
      code = 'TMDB_UNAVAILABLE';
      status = 502;
    }

    const { fixMatch, onClose, user } = mount({
      fixMatch: () => Promise.reject(new TmdbUnavailableError('TMDB unavailable')),
    });

    await user.type(screen.getByTestId('tmdb-search-input'), 'Dune');
    await screen.findByTestId('tmdb-results');
    await user.click(screen.getByTestId(`select-result-${SEARCH_RESULT.tmdbId}`));
    await user.click(screen.getByTestId('confirm-fix-match'));

    return { fixMatch, onClose, user };
  }

  it('T-UX-033a shows the TMDB unavailable message verbatim', async () => {
    await reachUnavailableState();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(TMDB_UNAVAILABLE_MESSAGE);
  });

  it('T-UX-033b the message says nothing changed — the title was not modified', async () => {
    await reachUnavailableState();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nothing has changed');
  });

  it('T-UX-033c a Retry button is present', async () => {
    await reachUnavailableState();

    await screen.findByRole('alert');
    expect(screen.getByTestId('retry-fix-match')).toBeTruthy();
  });

  it('T-UX-033d Retry re-submits the same fix-match request', async () => {
    class TmdbUnavailableError extends Error {
      code = 'TMDB_UNAVAILABLE';
      status = 502;
    }

    // First call fails; second succeeds.
    const fixMatch = vi
      .fn<[string, FixMatchRequest], Promise<FixMatchResponse>>()
      .mockRejectedValueOnce(new TmdbUnavailableError('fail'))
      .mockResolvedValueOnce(fixMatchResponse());

    mount({ fixMatch });
    const user = userEvent.setup();

    await user.type(screen.getByTestId('tmdb-search-input'), 'Dune');
    await screen.findByTestId('tmdb-results');
    await user.click(screen.getByTestId(`select-result-${SEARCH_RESULT.tmdbId}`));
    await user.click(screen.getByTestId('confirm-fix-match'));

    await screen.findByRole('alert');
    await user.click(screen.getByTestId('retry-fix-match'));

    await screen.findByRole('status');
    expect(fixMatch).toHaveBeenCalledTimes(2);
    // Both calls carry the same request.
    const [, req1] = fixMatch.mock.calls[0] as [string, FixMatchRequest];
    const [, req2] = fixMatch.mock.calls[1] as [string, FixMatchRequest];
    expect(req1.tmdbId).toBe(req2.tmdbId);
    expect(req1.mediaType).toBe(req2.mediaType);
  });

  it('T-UX-033e Cancel is still available from the unavailable state', async () => {
    const { onClose, user } = await reachUnavailableState();

    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
