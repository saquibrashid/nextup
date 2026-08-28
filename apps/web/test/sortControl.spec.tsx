/**
 * T-UI-024 — SortControl (TASK-166).
 *
 * The control toggles between `dir=desc` (default, "Newest first") and
 * `dir=asc` ("Oldest first"), reflects the choice in the URL query string, and
 * persists it in session storage so the preference survives navigations that
 * do not carry a `dir` param.
 *
 * ⚠ LABEL IS THE CURRENT DIRECTION (A47). The button reads "Newest first" when
 * the sort is descending — clicking it changes to "Oldest first". This is
 * different from a toggle where the label names the NEXT state.
 *
 * ⚠ DATE-ADDED LABEL IS DATE-ADDED-TO-NEXTUP (REQ-061). The date this title
 * entered nextup, never the streaming service's own saved date.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SortControl, readSortDir } from '../src/components/SortControl';
import { SORT_NEWEST_LABEL, SORT_OLDEST_LABEL } from '../src/copy';

/**
 * Helper: renders SortControl inside a MemoryRouter with the given initial URL.
 */
function renderSortControl(initialUrl = '/'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route path="*" element={<SortControl />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Reads the live query string out of the router.
 *
 * ⚠ THE QUERY STRING IS THE THING UNDER TEST, not an implementation detail:
 * `ListRoute` forwards `params.toString()` straight to `GET /api/titles`, so
 * whatever is NOT in the URL is not what the owner is looking at.
 */
function SearchProbe(): JSX.Element {
  const [params] = useSearchParams();
  return <span data-testid="search-probe">{params.toString()}</span>;
}

const probeSearch = (): string => screen.getByTestId('search-probe').textContent ?? '';

function renderWithProbe(initialUrl = '/'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SortControl />
              <SearchProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('T-UI-024 — SortControl', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  // T-UI-024a: renders on the page with the correct test id
  it('T-UI-024a: renders the sort control button', () => {
    renderSortControl();
    expect(screen.getByTestId('sort-control')).toBeInTheDocument();
  });

  // T-UI-024b: default label is SORT_NEWEST_LABEL (dir=desc)
  it('T-UI-024b: defaults to newest-first label', () => {
    renderSortControl();
    expect(screen.getByTestId('sort-control')).toHaveTextContent(SORT_NEWEST_LABEL);
  });

  // T-UI-024c: clicking toggles to SORT_OLDEST_LABEL
  it('T-UI-024c: click toggles to oldest-first label', () => {
    renderSortControl();
    fireEvent.click(screen.getByTestId('sort-control'));
    expect(screen.getByTestId('sort-control')).toHaveTextContent(SORT_OLDEST_LABEL);
  });

  // T-UI-024d: clicking again toggles back to SORT_NEWEST_LABEL
  it('T-UI-024d: second click toggles back to newest-first label', () => {
    renderSortControl();
    fireEvent.click(screen.getByTestId('sort-control'));
    fireEvent.click(screen.getByTestId('sort-control'));
    expect(screen.getByTestId('sort-control')).toHaveTextContent(SORT_NEWEST_LABEL);
  });

  // T-UI-024e: aria-pressed=false when dir=desc (newest-first is not the "pressed" state)
  it('T-UI-024e: aria-pressed is false when newest-first (default)', () => {
    renderSortControl();
    expect(screen.getByTestId('sort-control')).toHaveAttribute('aria-pressed', 'false');
  });

  // T-UI-024f: aria-pressed=true when dir=asc (oldest-first)
  it('T-UI-024f: aria-pressed is true when oldest-first', () => {
    renderSortControl();
    fireEvent.click(screen.getByTestId('sort-control'));
    expect(screen.getByTestId('sort-control')).toHaveAttribute('aria-pressed', 'true');
  });

  // T-UI-024g: reads dir=asc from the URL query string
  it('T-UI-024g: readSortDir reads asc from URL params', () => {
    const params = new URLSearchParams('?dir=asc');
    expect(readSortDir(params)).toBe('asc');
  });

  // T-UI-024h: reads dir=desc from the URL query string
  it('T-UI-024h: readSortDir reads desc from URL params', () => {
    const params = new URLSearchParams('?dir=desc');
    expect(readSortDir(params)).toBe('desc');
  });

  // T-UI-024i: falls back to default desc when no param
  it('T-UI-024i: readSortDir defaults to desc when no param', () => {
    const params = new URLSearchParams('');
    expect(readSortDir(params)).toBe('desc');
  });

  // T-UI-024j: session storage persists across reload (dir=asc stored)
  it('T-UI-024j: readSortDir reads asc from session storage when no URL param', () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    const params = new URLSearchParams('');
    expect(readSortDir(params)).toBe('asc');
  });

  // T-UI-024k: URL param overrides session storage
  it('T-UI-024k: URL param overrides session storage', () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    const params = new URLSearchParams('?dir=desc');
    expect(readSortDir(params)).toBe('desc');
  });

  // T-UI-024l: has both tap-target and sort-control classes
  it('T-UI-024l: button has tap-target and sort-control classes', () => {
    renderSortControl();
    const btn = screen.getByTestId('sort-control');
    expect(btn).toHaveClass('tap-target');
    expect(btn).toHaveClass('sort-control');
  });

  // T-UI-024m: keyboard operable — Enter key toggles direction
  it('T-UI-024m: keyboard Enter toggles the sort direction', () => {
    renderSortControl();
    const btn = screen.getByTestId('sort-control');
    fireEvent.keyDown(btn, { key: 'Enter', code: 'Enter' });
    fireEvent.click(btn);
    expect(btn).toHaveTextContent(SORT_OLDEST_LABEL);
  });

  // T-UI-024n: ?dir=asc in URL renders SORT_OLDEST_LABEL immediately
  it('T-UI-024n: ?dir=asc in URL renders oldest-first label', () => {
    renderSortControl('/?dir=asc');
    expect(screen.getByTestId('sort-control')).toHaveTextContent(SORT_OLDEST_LABEL);
  });

  /**
   * ⚠ THE REMEMBERED DIRECTION MUST REACH THE QUERY STRING, NOT JUST THE
   * LABEL. `ListRoute` sends `params.toString()` verbatim to
   * `GET /api/titles`, so the URL is what the server sorts by. A control that
   * merely *renders* "Oldest first" from session storage, without putting
   * `dir=asc` in the URL, shows the owner a newest-first list under an
   * oldest-first label — silently, with no error anywhere.
   *
   * `T-UI-024j` above asserts only that `readSortDir` returns `asc`, which is
   * true of the broken version too. These three cases are the ones with teeth.
   */
  // T-UI-024o: a remembered `asc` is reconciled INTO the query string
  it('T-UI-024o: a session-persisted asc is written into the URL', async () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    renderWithProbe('/');
    expect(screen.getByTestId('sort-control')).toHaveTextContent(SORT_OLDEST_LABEL);
    // The label is only honest if the API is asked for the same thing.
    await waitFor(() => {
      expect(new URLSearchParams(probeSearch()).get('dir')).toBe('asc');
    });
  });

  // T-UI-024p: reconciliation PRESERVES the other query parameters
  it('T-UI-024p: reconciliation keeps the existing filters', async () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    renderWithProbe('/?service=netflix&type=movie');
    await waitFor(() => {
      const q = new URLSearchParams(probeSearch());
      expect(q.get('dir')).toBe('asc');
      // ⚠ Dropping the filters here would silently widen the list the owner
      // is looking at, which reads as rows appearing from nowhere.
      expect(q.get('service')).toBe('netflix');
      expect(q.get('type')).toBe('movie');
    });
  });

  // T-UI-024q: the DEFAULT direction is not written, so URLs stay clean
  it('T-UI-024q: a remembered desc adds no redundant dir param', async () => {
    sessionStorage.setItem('nextup.sort.dir', 'desc');
    renderWithProbe('/?service=netflix');
    // An absent `dir` already means `desc` to the API (`api.md` §6.2). Writing
    // it would change the fetch key on every load for no behavioural gain.
    await waitFor(() => {
      expect(new URLSearchParams(probeSearch()).get('service')).toBe('netflix');
    });
    expect(new URLSearchParams(probeSearch()).has('dir')).toBe(false);
    expect(screen.getByTestId('sort-control')).toHaveTextContent(SORT_NEWEST_LABEL);
  });
});
