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

// ── T-UX-032 ─────────────────────────────────────────────────────────────────

/**
 * §3.3 — fix match, searching — `T-UX-032`.
 *
 * ⚠ OVERLAP, ESTABLISHED BEFORE WRITING: `T-UI-020` (a backlog-cited id, not
 * renamed) already asserts results with name/year/type/poster (`c`/`d`) and
 * that no-results names the query (`j`). `specs/ux-states.md` §3.3 stayed
 * pinned uncovered because no test bore ITS id. These cases give it that id and
 * — more importantly — close the two clauses `T-UI-020` did NOT genuinely
 * prove: the 300 ms DEBOUNCE (`T-UI-020b` asserts a call with the final query,
 * which an undebounced per-keystroke search also satisfies) and the transient
 * *"Searching…"* state, plus the quote-back (§3.3's *"No results for '{q}'"*).
 */
describe('T-UX-032 - §3.3 fix-match searching: debounce, Searching…, results, no-results quote-back', () => {
  it('T-UX-032a debounces: rapid typing fires ONE search for the final query, not one per key', async () => {
    const { searchTmdb, user } = mount();

    // userEvent types the four keys well within the 300 ms debounce window.
    await user.type(screen.getByTestId('tmdb-search-input'), 'Dune');

    await waitFor(() => expect(searchTmdb).toHaveBeenCalled(), { timeout: 1000 });
    // Give any further (undebounced, per-keystroke) calls time to land.
    await new Promise((resolve) => setTimeout(resolve, 350));

    // ⚠ Killing assertion for "remove the debounce": an undebounced search
    // fires per keystroke (D, Du, Dun, Dune) = 4 calls; a debounced one fires
    // exactly once, for the final query.
    expect(searchTmdb).toHaveBeenCalledTimes(1);
    expect(searchTmdb).toHaveBeenCalledWith('Dune');
  });

  it('T-UX-032b shows "Searching…" while the request is in flight', async () => {
    let settle: (r: TmdbSearchResponse) => void = () => undefined;
    const { user } = mount({
      searchTmdb: () =>
        new Promise<TmdbSearchResponse>((resolve) => {
          settle = resolve;
        }),
    });

    await user.type(screen.getByTestId('tmdb-search-input'), 'Dune');

    // The debounced search has fired but not resolved: §3.3's "Searching…".
    expect(await screen.findByText('Searching…')).toBeTruthy();

    settle(searchResponse());
    await screen.findByTestId('tmdb-results');
  });

  it('T-UX-032c results carry poster, name, year and type', async () => {
    const { user } = mount();

    await user.type(screen.getByTestId('tmdb-search-input'), 'Dune');

    await screen.findByTestId('tmdb-results');
    expect(screen.getByTestId('result-name').textContent).toBe(SEARCH_RESULT.name);
    expect(screen.getByTestId('result-year').textContent).toBe(String(SEARCH_RESULT.releaseYear));
    expect(screen.getByTestId('result-type').textContent).toBe('Movie');
    expect((screen.getByTestId('result-poster') as HTMLImageElement).src).toContain(
      SEARCH_RESULT.posterPath,
    );
  });

  it('T-UX-032d no-results QUOTES THE QUERY BACK, not a generic "No results"', async () => {
    const { user } = mount({ searchTmdb: () => Promise.resolve({ items: [] }) });

    await user.type(screen.getByTestId('tmdb-search-input'), 'zzq123');

    const status = await screen.findByRole('status');
    // ⚠ Killing assertion for "generic 'No results'": the owner must be able to
    // see they typoed, so the query is quoted back verbatim.
    expect(status.textContent).toContain('No results for');
    expect(status.textContent).toContain('zzq123');
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

/**
 * `ux-states.md` §3.7 - success WITH a suppression migration, and success
 * without one.
 *
 * ⚠ WHY THE EXISTING SUCCESS CASE IS NOT ENOUGH. `T-UI-020i` drives the one
 * response where `suppressionMigrated` is populated and asserts the notice
 * appears. Nothing asserts the other direction, so rendering the notice
 * UNCONDITIONALLY passes the whole suite - and tells the owner their `not
 * interested` mark was moved on every single fix-match, including the ones
 * where they never made one. §3.7 requires the migration to be stated when it
 * happened; stating it when it did not is the same defect facing the other way.
 *
 * Product invariant 1 is what makes this load-bearing: suppression is keyed on
 * canonical work identity, so a fix-match genuinely can move it. The owner has
 * no other way to learn that it did.
 */
describe('T-UX-036 - the suppression migration is stated when it happened, and only then', () => {
  async function reachSuccess(over: Partial<FixMatchDialogProps> = {}) {
    const handles = mount(over);
    const { user } = handles;

    await user.type(screen.getByTestId('tmdb-search-input'), 'Dune');
    await screen.findByTestId('tmdb-results');
    await user.click(screen.getByTestId(`select-result-${SEARCH_RESULT.tmdbId}`));
    await user.click(screen.getByTestId('confirm-fix-match'));
    await screen.findByTestId('success-message');

    return handles;
  }

  it('T-UX-036a states the migration, alongside the success message and not instead of it', async () => {
    await reachSuccess({
      fixMatch: () =>
        Promise.resolve(
          fixMatchResponse({
            suppressionMigrated: { from: 'unmatched:abc123', to: 'tmdb:movie:438631' },
          }),
        ),
    });

    // Both, together. A notice that replaced the confirmation would leave the
    // owner unsure the match itself had landed.
    expect(screen.getByTestId('success-message')).toBeInTheDocument();
    expect(screen.getByTestId('suppression-migrated').textContent).toBe(
      FIXMATCH_SUPPRESSION_MIGRATED,
    );
  });

  it('T-UX-036b says nothing about suppression when no mark was migrated', async () => {
    await reachSuccess();

    // The default response carries `suppressionMigrated: null` - nothing was
    // moved, so claiming otherwise would be a false statement about the
    // owner's own decisions.
    expect(screen.getByTestId('success-message')).toBeInTheDocument();
    expect(screen.queryByTestId('suppression-migrated')).toBeNull();
  });
});
