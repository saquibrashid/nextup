import { Input } from './ui/Input';
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
import { Button } from './ui/Button';
import { Field } from './ui/Field';

import {
  SORT_KEY_DATE_LABEL,
  SORT_KEY_LEGEND,
  SORT_KEY_RUNTIME_LABEL,
  SORT_LONGEST_LABEL,
  SORT_NEWEST_LABEL,
  SORT_OLDEST_LABEL,
  SORT_SHORTEST_LABEL,
} from '../copy';

export type SortDir = 'desc' | 'asc';

/**
 * REQ-037 — the sort keys, as they appear in the URL (`specs/api.md` §6.2).
 *
 * ⚠ THERE IS NO `imdbRating` KEY AND THERE MUST NEVER BE ONE (REQ-095, owner
 * decision `A51`, guarded by `T-UX-119`). The rating is display-only. It is
 * the most tempting key in this file precisely because the row renders it.
 */
export const SORT_KEYS = ['dateAdded', 'runtime'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

const SESSION_KEY = 'nextup.sort.dir';
const DEFAULT_DIR: SortDir = 'desc';
const DEFAULT_SORT: SortKey = 'dateAdded';

/**
 * REQ-037 — the direction labels, PER SORT KEY (`T-UX-120`).
 *
 * ⚠ "Newest first" ON A RUNTIME-SORTED LIST IS A FALSE STATEMENT, not merely
 * an imprecise one: it names a different column from the one the list is
 * ordered by, and the owner has no way to tell which is true. The label is the
 * only thing on screen that says what the order means.
 *
 * ⚠ `SORT_NEWEST_LABEL` / `SORT_OLDEST_LABEL` ARE NOT REWRITTEN HERE. Their
 * replacement wording is OQ-5, still open with the owner (`specs/ui.md` §9
 * copy governance); adding new strings for a new key is in scope, changing
 * the existing two is not.
 */
const DIR_LABELS: Readonly<Record<SortKey, Readonly<Record<SortDir, string>>>> = {
  dateAdded: { desc: SORT_NEWEST_LABEL, asc: SORT_OLDEST_LABEL },
  runtime: { desc: SORT_LONGEST_LABEL, asc: SORT_SHORTEST_LABEL },
};

const KEY_LABELS: Readonly<Record<SortKey, string>> = {
  dateAdded: SORT_KEY_DATE_LABEL,
  runtime: SORT_KEY_RUNTIME_LABEL,
};

/**
 * Reads the effective sort KEY from the URL, defaulting to `dateAdded`.
 *
 * ⚠ THE KEY IS NOT PERSISTED IN SESSION STORAGE, unlike the direction. A
 * remembered key would reorder the list on a fresh visit with no `sort` in the
 * URL, and the reconciliation effort below would then rewrite the address bar
 * on arrival. The direction is a preference about one list; the key is which
 * list it is.
 */
export function readSortKey(params: URLSearchParams): SortKey {
  const fromUrl = params.get('sort');
  return (SORT_KEYS as readonly string[]).includes(fromUrl ?? '')
    ? (fromUrl as SortKey)
    : DEFAULT_SORT;
}

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
  const sort = readSortKey(params);
  const label = DIR_LABELS[sort][dir];

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
    <div className="sort-control-group" data-testid="sort-control-group">
      {/*
        REQ-037 — the sort KEY. Radios rather than a `<select>`: `specs/ui.md`
        §2.1 item 2 holds the filter bar to native controls with visible state,
        and two options do not justify a collapsed widget.

        ⚠ CHANGING THE KEY DOES NOT CHANGE THE DIRECTION, and must not. `desc`
        under `dateAdded` means newest-first and under `runtime` means
        longest-first; both are the same honest default ("most of the thing
        first"), so carrying the direction across preserves the owner's choice
        rather than silently resetting it.

        ⚠ NO CURSOR IS CARRIED, because the cursor is not in the URL — it lives
        in `useCursorPages` state and is reset by the query change this
        triggers. That is load-bearing: a date cursor sent with `sort=runtime`
        is a keyset that does not mirror its own ORDER BY, and the API answers
        `INVALID_CURSOR` rather than a page of quietly wrong rows.
      */}
      <Field legend={SORT_KEY_LEGEND} testId="sort-key">
        {SORT_KEYS.map((key) => (
          <label key={key}>
            <Input
              type="radio"
              name="sort"
              value={key}
              checked={sort === key}
              onChange={() => {
                setParams((prev) => {
                  const updated = new URLSearchParams(prev);
                  // An absent `sort` already means `dateAdded` to the API, so
                  // the default is removed rather than written — the same rule
                  // the `dir` reconciliation above follows.
                  if (key === DEFAULT_SORT) updated.delete('sort');
                  else updated.set('sort', key);
                  return updated;
                });
              }}
            />
            {KEY_LABELS[key]}
          </label>
        ))}
      </Field>

      <Button
        variant="secondary"
        data-testid="sort-control"
        aria-pressed={dir === 'asc'}
        onClick={toggle}
      >
        {label}
      </Button>
    </div>
  );
}
