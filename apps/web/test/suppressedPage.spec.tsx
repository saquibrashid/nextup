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

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SuppressedPage } from '../src/pages/SuppressedPage';
import type { SuppressionItem } from '../src/lib/apiClient';
import { RETRY_LABEL, UNMATCHED_SUPPRESSION_CAVEAT, UNSUPPRESS_CONFIRM_BODY } from '../src/copy';
import { withName } from '../src/components/SuppressDialog';

function makeItem(overrides?: Partial<SuppressionItem>): SuppressionItem {
  return {
    suppressionId: 'sup-001',
    workIdentity: 'wi-001',
    suppressedAt: '2024-01-01T00:00:00Z',
    identityStability: 'matched',
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

  // T-UI-010u: matched identity does NOT show the caveat
  it('T-UI-010u: matched identity does NOT show caveat', () => {
    render(<SuppressedPage items={[makeItem({ identityStability: 'matched' })]} />);
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

  // T-UI-010z: empty list renders empty ul (no error, no loading)
  it('T-UI-010z: empty items list renders empty list', () => {
    render(<SuppressedPage items={[]} />);
    const list = screen.getByTestId('suppressed-list');
    expect(list.children).toHaveLength(0);
  });
});
