/**
 * T-UI-010 (new sub-tests l+) — SuppressedPage (TASK-107).
 *
 * The "Not interested" page shows suppressions with name, year, poster,
 * a "Stop ignoring" affordance, and an optional caveat for text-derived
 * identity matches. The confirmation body substitutes the title name.
 * On load failure the page shows an error with a retry button.
 *
 * ⚠ UN-SUPPRESSION IS EXPLICIT AND DELIBERATE (US-029 AC-4). The copy
 * makes clear that un-suppressing does NOT restore anything that was removed
 * — suppression and removal are separate concepts.
 *
 * ⚠ `identityStability: 'text-derived'` rows carry `UNMATCHED_SUPPRESSION_CAVEAT`
 * because the suppression is keyed on OCR'd text and could be bypassed if
 * the title reads differently in a future screenshot.
 */

import { render as rtlRender, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { SuppressedPage } from '../src/pages/SuppressedPage';
import type { SuppressionItem } from '../src/lib/apiClient';
import {
  OFFLINE_DISABLED_REASON,
  RETRY_LABEL,
  SUPPRESSED_EMPTY_BODY,
  SUPPRESSED_EMPTY_TITLE,
  SUPPRESSED_LOADING,
  UNMATCHED_SUPPRESSION_CAVEAT,
  UNSUPPRESS_CONFIRM_BODY,
} from '../src/copy';
import { withName } from '../src/components/SuppressDialog';

function render(ui: ReactElement): ReturnType<typeof rtlRender> {
  return rtlRender(ui, { wrapper: MemoryRouter });
}

function setNavigatorOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
  fireEvent(window, new Event(online ? 'online' : 'offline'));
}

afterEach(() => {
  setNavigatorOnline(true);
});

function makeItem(overrides?: Partial<SuppressionItem>): SuppressionItem {
  return {
    suppressionId: 'sup-001',
    workIdentity: 'wi-001',
    suppressedAt: '2024-01-01T00:00:00Z',
    identityStability: 'stable',
    displaySnapshot: {
      name: 'The Test Movie',
      releaseYear: 2023,
      mediaType: 'movie',
      posterPath: '/abc123.jpg',
    },
    unsuppressHref: '/api/suppressions/sup-001/unsuppress',
    ...overrides,
  };
}

describe('T-UI-010 — SuppressedPage', () => {
  // T-UI-010l: renders the page heading "Not interested"
  it('T-UI-010l: renders "Not interested" heading', () => {
    render(<SuppressedPage />);
    expect(screen.getByRole('heading', { name: /not interested/i })).toBeInTheDocument();
  });

  // T-UI-010m: renders the subtitle copy
  it('T-UI-010m: renders subtitle about future uploads', () => {
    render(<SuppressedPage />);
    expect(screen.getByTestId('suppressed-subtitle')).toBeInTheDocument();
    expect(screen.getByTestId('suppressed-subtitle').textContent).toContain('future uploads');
  });

  // T-UI-010n: renders a row with the title name
  it('T-UI-010n: renders suppressed title name', () => {
    render(<SuppressedPage items={[makeItem()]} />);
    expect(screen.getByTestId('suppressed-name')).toHaveTextContent('The Test Movie');
  });

  // T-UI-010o: renders the release year
  it('T-UI-010o: renders release year', () => {
    render(<SuppressedPage items={[makeItem()]} />);
    expect(screen.getByTestId('suppressed-year')).toHaveTextContent('2023');
  });

  // T-UI-010p: shows "Stop ignoring" button for each row
  it('T-UI-010p: renders "Stop ignoring" button', () => {
    render(<SuppressedPage items={[makeItem()]} />);
    expect(screen.getByTestId('stop-ignoring-button')).toBeInTheDocument();
  });

  // T-UI-010q: clicking "Stop ignoring" shows the confirmation body with the title name substituted
  it('T-UI-010q: Stop ignoring shows UNSUPPRESS_CONFIRM_BODY with title name', () => {
    render(<SuppressedPage items={[makeItem()]} />);
    fireEvent.click(screen.getByTestId('stop-ignoring-button'));
    const expectedBody = withName(UNSUPPRESS_CONFIRM_BODY, 'The Test Movie');
    expect(screen.getByTestId('unsuppress-confirm-body')).toHaveTextContent(expectedBody);
  });

  // T-UI-010r: cancelling confirmation restores the idle state
  it('T-UI-010r: Cancel from confirmation returns to idle state', () => {
    render(<SuppressedPage items={[makeItem()]} />);
    fireEvent.click(screen.getByTestId('stop-ignoring-button'));
    expect(screen.getByTestId('unsuppress-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('unsuppress-cancel-button'));
    expect(screen.queryByTestId('unsuppress-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('stop-ignoring-button')).toBeInTheDocument();
  });

  // T-UI-010s: successful unsuppress removes the row from view
  it('T-UI-010s: successful unsuppress removes the row', async () => {
    const onUnsuppress = vi.fn(() => Promise.resolve());
    render(<SuppressedPage items={[makeItem()]} onUnsuppress={onUnsuppress} />);
    fireEvent.click(screen.getByTestId('stop-ignoring-button'));
    fireEvent.click(screen.getByTestId('unsuppress-confirm-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('suppressed-row')).not.toBeInTheDocument();
    });
    expect(onUnsuppress).toHaveBeenCalledWith('sup-001');
  });

  // T-UI-010t: text-derived identity shows UNMATCHED_SUPPRESSION_CAVEAT
  it('T-UI-010t: text-derived suppression shows caveat', () => {
    render(<SuppressedPage items={[makeItem({ identityStability: 'text-derived' })]} />);
    expect(screen.getByTestId('suppressed-caveat')).toHaveTextContent(UNMATCHED_SUPPRESSION_CAVEAT);
  });

  // T-UI-010u: a STABLE identity does NOT show the caveat.
  //
  // ⚠ Corrected in place (TASK-104). This read `'matched'`, which is not one
  // of the two values the API sends, so it passed because anything other than
  // `'text-derived'` hides the caveat — it asserted the fallback, never the
  // contract. `'stable'` is the real negative case.
  it('T-UI-010u: a stable identity does NOT show caveat', () => {
    render(<SuppressedPage items={[makeItem({ identityStability: 'stable' })]} />);
    expect(screen.queryByTestId('suppressed-caveat')).not.toBeInTheDocument();
  });

  // T-UI-010v: loadFailed=true shows the error state with a retry button
  it('T-UI-010v: load failure shows error state with retry', () => {
    const onRetry = vi.fn();
    render(<SuppressedPage loadFailed onRetry={onRetry} />);
    expect(screen.getByTestId('suppressed-load-error')).toBeInTheDocument();
    fireEvent.click(screen.getByText(RETRY_LABEL));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // T-UI-010w: loading=true shows loading state, not the list
  it('T-UI-010w: loading=true shows loading state', () => {
    render(<SuppressedPage loading />);
    expect(screen.getByTestId('suppressed-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('suppressed-list')).not.toBeInTheDocument();
  });

  // T-UI-010x: failed unsuppress shows an error alert
  it('T-UI-010x: failed unsuppress shows error alert', async () => {
    const onUnsuppress = vi.fn(() => Promise.reject(new Error('server error')));
    render(<SuppressedPage items={[makeItem()]} onUnsuppress={onUnsuppress} />);
    fireEvent.click(screen.getByTestId('stop-ignoring-button'));
    fireEvent.click(screen.getByTestId('unsuppress-confirm-button'));
    await waitFor(() => {
      expect(screen.getByTestId('unsuppress-error')).toBeInTheDocument();
    });
    // The row remains after failure (nothing has changed)
    expect(screen.getByTestId('suppressed-row')).toBeInTheDocument();
  });

  // T-UI-010y: multiple items render multiple rows
  it('T-UI-010y: multiple items render multiple rows', () => {
    const items = [
      makeItem({ suppressionId: 'sup-001' }),
      makeItem({
        suppressionId: 'sup-002',
        displaySnapshot: {
          name: 'Another Movie',
          releaseYear: 2022,
          mediaType: 'movie',
          posterPath: null,
        },
      }),
    ];
    render(<SuppressedPage items={items} />);
    expect(screen.getAllByTestId('suppressed-row')).toHaveLength(2);
  });

  // T-UI-010z: empty list renders the empty state (no error, no loading)
  it('T-UI-010z: empty items list renders empty state', () => {
    render(<SuppressedPage items={[]} />);
    expect(screen.getByTestId('suppressed-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('suppressed-list')).not.toBeInTheDocument();
  });
});

describe('suppressed-view UX states — §8', () => {
  it('T-UX-080a: loading renders skeleton rows, not an empty list', () => {
    render(<SuppressedPage loading />);

    expect(screen.getByTestId('suppressed-loading')).toHaveAccessibleName(SUPPRESSED_LOADING);
    expect(screen.getAllByTestId('suppressed-row-skeleton')).toHaveLength(3);
    expect(screen.queryByTestId('suppressed-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suppressed-list')).not.toBeInTheDocument();
  });

  it('T-UX-081a: empty state explains that nothing is marked not interested', () => {
    render(<SuppressedPage items={[]} />);

    const empty = screen.getByTestId('suppressed-empty');
    expect(empty).toHaveTextContent(SUPPRESSED_EMPTY_TITLE);
    expect(empty).toHaveTextContent("You haven't marked anything as not interested.");
    expect(empty).toHaveTextContent(SUPPRESSED_EMPTY_BODY);
    expect(empty).toHaveTextContent('Use the ⋮ menu on any title.');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/');
  });

  it('T-UX-081b: Back is router navigation, not a document reload', async () => {
    rtlRender(
      <MemoryRouter initialEntries={['/not-interested']}>
        <Routes>
          <Route path="/not-interested" element={<SuppressedPage items={[]} />} />
          <Route path="/" element={<p data-testid="router-home">Combined list route</p>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Back' }));

    expect(await screen.findByTestId('router-home')).toHaveTextContent('Combined list route');
  });

  it('T-UX-082a: populated rows render from displaySnapshot', () => {
    render(
      <SuppressedPage
        items={[
          makeItem({
            displaySnapshot: {
              name: 'Snapshot Title',
              releaseYear: 1984,
              mediaType: 'movie',
              posterPath: '/snapshot.jpg',
            },
          }),
        ]}
      />,
    );

    const row = screen.getByTestId('suppressed-row');
    expect(within(row).getByTestId('suppressed-name')).toHaveTextContent('Snapshot Title');
    expect(within(row).getByTestId('suppressed-year')).toHaveTextContent('1984');
    expect(within(row).getByTestId('suppressed-poster')).toHaveAttribute(
      'src',
      expect.stringContaining('/snapshot.jpg'),
    );
  });

  it('T-UX-083a: submitting dims only the affected row while unsuppress is in flight', async () => {
    const onUnsuppress = vi.fn(
      () =>
        new Promise<unknown>(() => {
          /* keep the row in the submitting state */
        }),
    );

    render(<SuppressedPage items={[makeItem()]} onUnsuppress={onUnsuppress} />);
    fireEvent.click(screen.getByTestId('stop-ignoring-button'));
    fireEvent.click(screen.getByTestId('unsuppress-confirm-button'));

    await waitFor(() => {
      expect(screen.getByTestId('suppressed-row')).toHaveAttribute('aria-busy', 'true');
    });
    expect(screen.getByTestId('unsuppress-submitting')).toBeDisabled();
    expect(screen.queryByTestId('stop-ignoring-button')).not.toBeInTheDocument();
  });

  it('T-UX-084a: success restates the un-suppression caveat as a status', async () => {
    const onUnsuppress = vi.fn(() => Promise.resolve());

    render(<SuppressedPage items={[makeItem()]} onUnsuppress={onUnsuppress} />);
    fireEvent.click(screen.getByTestId('stop-ignoring-button'));
    fireEvent.click(screen.getByTestId('unsuppress-confirm-button'));

    const status = await screen.findByTestId('unsuppress-success-announcement');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent(withName(UNSUPPRESS_CONFIRM_BODY, 'The Test Movie'));
    expect(status).toHaveTextContent("This doesn't bring back anything that was removed");
    expect(screen.queryByTestId('suppressed-row')).not.toBeInTheDocument();
  });
});

describe('offline state — T-UX-003 / §8.7 deferred surface', () => {
  it('T-UX-003f: un-suppress is disabled offline with a visible reason, and rows remain readable', async () => {
    setNavigatorOnline(true);
    render(<SuppressedPage items={[makeItem()]} onUnsuppress={() => Promise.resolve()} />);

    expect(screen.getByTestId('suppressed-name')).toHaveTextContent('The Test Movie');
    expect(screen.getByTestId('stop-ignoring-button')).toBeEnabled();

    setNavigatorOnline(false);

    await waitFor(() => {
      expect(screen.getByTestId('stop-ignoring-button')).toBeDisabled();
    });
    expect(screen.getByText(OFFLINE_DISABLED_REASON)).toBeVisible();
    expect(screen.getByTestId('suppressed-name')).toHaveTextContent('The Test Movie');

    setNavigatorOnline(true);

    await waitFor(() => {
      expect(screen.getByTestId('stop-ignoring-button')).toBeEnabled();
    });
    expect(screen.queryByText(OFFLINE_DISABLED_REASON)).not.toBeInTheDocument();
  });

  it('T-UX-003g: an in-flight un-suppress keeps its submitting state if the network drops', async () => {
    const onUnsuppress = vi.fn(
      () =>
        new Promise<unknown>(() => {
          /* keep the row in the submitting state */
        }),
    );
    setNavigatorOnline(true);
    render(<SuppressedPage items={[makeItem()]} onUnsuppress={onUnsuppress} />);

    fireEvent.click(screen.getByTestId('stop-ignoring-button'));
    fireEvent.click(screen.getByTestId('unsuppress-confirm-button'));
    await waitFor(() => {
      expect(screen.getByTestId('unsuppress-submitting')).toBeDisabled();
    });

    setNavigatorOnline(false);

    expect(screen.getByTestId('unsuppress-submitting')).toHaveTextContent('Removing…');
    expect(screen.queryByText(OFFLINE_DISABLED_REASON)).not.toBeInTheDocument();
  });
});

/**
 * TASK-104 — the COMPONENT half of `T-SUP-006` (US-028 AC-6′, OQ-015 closed).
 *
 * An unmatched work is suppressible, and because its identity is derived from
 * the text an OCR pass read rather than from a TMDB id, the suppressed view
 * has to say so. The caveat is not decoration: a future screenshot that reads
 * the same title slightly differently produces a DIFFERENT identity, and the
 * suppression the owner set will simply not apply to it. Without the caveat
 * that reads as the feature being broken; with it, it reads as a known limit
 * with a remedy (`T-FIX-005`, fix-match migration).
 */
describe('T-SUP-006 · US-028 AC-6′ · the suppressed view carries the stability caveat', () => {
  it('T-SUP-006b: a text-derived row renders the caveat VERBATIM from `ui.md` §9', () => {
    render(<SuppressedPage items={[makeItem({ identityStability: 'text-derived' })]} />);
    // Compared to the exported constant AND to its literal text, because a
    // component that rendered some other string would still satisfy a
    // comparison against whatever constant it happened to import.
    expect(screen.getByTestId('suppressed-caveat')).toHaveTextContent(UNMATCHED_SUPPRESSION_CAVEAT);
    expect(UNMATCHED_SUPPRESSION_CAVEAT).toContain("we're matching it on the text we read");
  });

  it('T-SUP-006c: the caveat is keyed on the STABILITY, not on a missing poster or year', () => {
    // The rows most likely to be unmatched are also the rows most likely to
    // have no poster and no year, so a caveat that keyed on either would look
    // correct on every realistic fixture and be wrong in principle — and it
    // would then appear on matched rows whose metadata simply had not loaded.
    render(
      <SuppressedPage
        items={[
          makeItem({
            identityStability: 'stable',
            displaySnapshot: {
              name: 'Sparse But Matched',
              releaseYear: null,
              mediaType: null,
              posterPath: null,
            },
          }),
        ]}
      />,
    );
    expect(screen.queryByTestId('suppressed-caveat')).not.toBeInTheDocument();
  });

  it('T-SUP-006d: the caveat attaches per ROW, not to the page', () => {
    // Mixed lists are the normal case, and a page-level banner would tell the
    // owner their matched suppressions are unreliable when they are not.
    render(
      <SuppressedPage
        items={[
          makeItem({ suppressionId: 'sup-a', identityStability: 'stable' }),
          makeItem({ suppressionId: 'sup-b', identityStability: 'text-derived' }),
        ]}
      />,
    );
    expect(screen.getAllByTestId('suppressed-row')).toHaveLength(2);
    expect(screen.getAllByTestId('suppressed-caveat')).toHaveLength(1);
  });

  it('T-SUP-006e: an unmatched row is still fully actionable — un-suppression is offered', () => {
    // OQ-015 closed the question by making unmatched works suppressible. A
    // caveat that came with a disabled control would re-open it in practice:
    // the owner could suppress but never undo.
    render(<SuppressedPage items={[makeItem({ identityStability: 'text-derived' })]} />);
    const button = screen.getByText(/stop ignoring/i);
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });
});
