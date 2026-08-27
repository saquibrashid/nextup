// `components/SortControl.tsx` — the date-added sort direction toggle
// (`specs/ui.md` §2.1 item 2, US-020 AC-6, TASK-166).
//
// ⚠ TWO SOURCES, ONE WINNER (in priority order): URL param `dir` > session
// storage > default `desc`. The URL wins because it enables deep links and
// back/forward: ?dir=asc in the address bar reflects exactly what is on screen.
// Session storage remembers the preference across navigations that do not carry
// a `dir` param.
//
// ⚠ LABEL IS THE CURRENT DIRECTION. The button reads "Newest first" when the
// sort is descending; clicking it changes both the label and the URL. The
// control shows its current state (A47), not what the next click will produce.
//
// ⚠ DATE-ADDED MEANS DATE ADDED TO NEXTUP (REQ-061). Never the streaming
// service's own saved date — that fact is what `specs/api.md` §6.2 calls
// `dateAddedLabel` and is labelled "to nextup" everywhere it is shown.

import { useCallback, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';

import { SORT_NEWEST_LABEL, SORT_OLDEST_LABEL } from '../copy';

export type SortDir = 'desc' | 'asc';

const SESSION_KEY = 'nextup.sort.dir';
const DEFAULT_DIR: SortDir = 'desc';

/**
 * Reads the effective sort direction from URL then session storage then the
 * default.
 *
 * Exported for tests (`T-UI-024g/h`).
 */
export function readSortDir(params: URLSearchParams): SortDir {
  const fromUrl = params.get('dir');
  if (fromUrl === 'desc' || fromUrl === 'asc') return fromUrl;
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored === 'desc' || stored === 'asc') return stored;
  } catch {
    // sessionStorage may be unavailable in some private-browsing configurations.
  }
  return DEFAULT_DIR;
}

export function SortControl(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const dir = readSortDir(params);
  const label = dir === 'desc' ? SORT_NEWEST_LABEL : SORT_OLDEST_LABEL;

  const toggle = useCallback(() => {
    const next: SortDir = dir === 'desc' ? 'asc' : 'desc';
    try {
      sessionStorage.setItem(SESSION_KEY, next);
    } catch {
      // Best-effort persistence — not critical to function.
    }
    setParams((prev) => {
      const updated = new URLSearchParams(prev);
      updated.set('dir', next);
      return updated;
    });
  }, [dir, setParams]);

  return (
    <button
      type="button"
      className="tap-target sort-control"
      data-testid="sort-control"
      aria-pressed={dir === 'asc'}
      onClick={toggle}
    >
      {label}
    </button>
  );
}
