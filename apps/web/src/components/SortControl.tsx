// Owner-approved 2026-09-16: each button selects a complete order; pressing
// the selected button reverses it. Date added means date added to nextup.

import { useCallback, useEffect, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { SORT_KEY_LEGEND, SORT_ORDER_LABELS } from '../copy';

export type SortDir = 'desc' | 'asc';

// These are the API's own spellings, including `rating`, not `imdbRating`.
export const SORT_KEYS = [
  'dateAdded',
  'name',
  'releaseYear',
  'runtime',
  'rating',
  'watchPriority',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

const SESSION_KEY = 'nextup.sort.dir';
const DEFAULT_SORT: SortKey = 'dateAdded';

// Mirrors defaultDirectionFor in apps/api/src/routes/titlesQuery.ts.
const DEFAULT_DIR_BY_KEY: Readonly<Record<SortKey, SortDir>> = {
  dateAdded: 'desc',
  name: 'asc',
  releaseYear: 'desc',
  runtime: 'desc',
  rating: 'desc',
  watchPriority: 'asc',
};

export function defaultDirFor(key: SortKey): SortDir {
  return DEFAULT_DIR_BY_KEY[key];
}

/** The field is URL-only; unlike direction, it is not a session preference. */
export function readSortKey(params: URLSearchParams): SortKey {
  const fromUrl = params.get('sort');
  return (SORT_KEYS as readonly string[]).includes(fromUrl ?? '')
    ? (fromUrl as SortKey)
    : DEFAULT_SORT;
}

/** Initial entry and history navigation use URL > session > field default. */
export function readSortDir(params: URLSearchParams): SortDir {
  const fromUrl = params.get('dir');
  if (fromUrl === 'desc' || fromUrl === 'asc') return fromUrl;
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored === 'desc' || stored === 'asc') return stored;
  } catch {
    // sessionStorage may be unavailable in some private-browsing configurations.
  }
  return defaultDirFor(readSortKey(params));
}

export function SortControl(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const dir = readSortDir(params);
  const sort = readSortKey(params);

  // ListRoute sends the URL to the API. Reconcile a remembered non-default
  // direction so the label matches the server order, without adding history.
  const urlDir = params.get('dir');
  useEffect(() => {
    if (urlDir === 'desc' || urlDir === 'asc') return;
    if (dir === defaultDirFor(sort)) return;
    setParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('dir', dir);
        return updated;
      },
      { replace: true },
    );
  }, [urlDir, dir, sort, setParams]);

  const chooseOrder = useCallback(
    (key: SortKey) => {
      const nextDir = key === sort ? (dir === 'desc' ? 'asc' : 'desc') : defaultDirFor(key);
      try {
        sessionStorage.setItem(SESSION_KEY, nextDir);
      } catch {
        // Best-effort persistence; the URL still records the user's choice.
      }
      // One navigation sets both values. ListRoute owns cursor state and
      // resets paging when this query changes; no client-side sorting occurs.
      setParams((prev) => {
        const updated = new URLSearchParams(prev);
        if (key === DEFAULT_SORT) updated.delete('sort');
        else updated.set('sort', key);
        updated.set('dir', nextDir);
        return updated;
      });
    },
    [dir, sort, setParams],
  );

  return (
    <div className="sort-control-group" data-testid="sort-control-group">
      <Field legend={SORT_KEY_LEGEND} testId="sort-control">
        <div className="sort-options">
          {SORT_KEYS.map((key) => {
            const selected = sort === key;
            const shownDir = selected ? dir : defaultDirFor(key);
            const label = SORT_ORDER_LABELS[key][shownDir];
            const nextLabel = SORT_ORDER_LABELS[key][shownDir === 'desc' ? 'asc' : 'desc'];
            return (
              <span key={key} className="sort-option">
                <Button
                  aria-pressed={selected}
                  aria-label={selected ? `${label}. Selected. Change to ${nextLabel}.` : label}
                  onClick={() => chooseOrder(key)}
                >
                  {label}
                </Button>
              </span>
            );
          })}
        </div>
      </Field>
    </div>
  );
}
