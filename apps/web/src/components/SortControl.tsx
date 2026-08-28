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

import { useCallback, useEffect, type JSX } from 'react';
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

  /**
   * ⚠ THE REMEMBERED DIRECTION MUST BE RECONCILED INTO THE URL, OR THE LABEL
   * LIES ABOUT THE LIST.
   *
   * `ListRoute` sends `params.toString()` verbatim to `GET /api/titles`, so
   * the URL — not this component's state — is what the server sorts by. With
   * `asc` remembered in session storage and no `dir` in the URL, `readSortDir`
   * returns `asc` and the button reads "Oldest first" while the API, seeing no
   * `dir`, returns its `desc` default. The owner is then shown a
   * newest-first list under an oldest-first label, with no error anywhere.
   *
   * That is precisely the US-020 AC-6 path the persistence exists for
   * ("survives navigating away and back"), which is why the feature that
   * appears to work is the one that is wrong.
   *
   * `replace: true`, deliberately: this is a correction of the address the
   * owner already arrived at, not a navigation they performed. Pushing would
   * make Back require two presses to leave the list.
   *
   * The `desc` case is intentionally NOT written. An absent `dir` already
   * means `desc` to the API (`specs/api.md` §6.2), so writing it would add a
   * redundant parameter to every URL and change the fetch key for no effect.
   */
  const urlDir = params.get('dir');
  useEffect(() => {
    if (urlDir === 'desc' || urlDir === 'asc') return;
    if (dir === DEFAULT_DIR) return;
    setParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('dir', dir);
        return updated;
      },
      { replace: true },
    );
  }, [urlDir, dir, setParams]);

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
