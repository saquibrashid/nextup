import { createContext, useLayoutEffect, useState, type JSX, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigationType } from 'react-router-dom';
import { applyFilters, parseFilters } from './FilterBar';
import { defaultDirFor, readSortDir, readSortKey } from './SortControl';
import type { ListView } from './ListViewControl';

const STORAGE_KEY = 'nextup.library.v1';
const LAYOUT_KEY = 'nextup.library.layout.v1';
export const LibraryLayoutContext = createContext<{
  view: ListView;
  onViewChange: (view: ListView) => void;
} | null>(null);
const STORAGE_ERROR =
  'Your browsing choices work here, but this browser could not remember them across restarts.';
const STALE_CHOICES = 'Some saved browsing choices are no longer supported and were reset.';

export function libraryQuery(params: URLSearchParams): string {
  const next = applyFilters(new URLSearchParams(), parseFilters(params));
  const sort = readSortKey(params);
  const dir = params.get('dir');
  next.set('sort', sort);
  next.set('dir', dir === 'asc' || dir === 'desc' ? dir : defaultDirFor(sort));
  const q = params.get('q')?.trim();
  if (q && q.length <= 500) next.set('q', q);
  return next.toString();
}

const DEFAULT_QUERY = libraryQuery(new URLSearchParams());

function readSaved(): { query: string | null; view: ListView; message: string | null } {
  let raw: string | null;
  let rawView: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    rawView = localStorage.getItem(LAYOUT_KEY);
  } catch {
    return { query: null, view: 'grid', message: STORAGE_ERROR };
  }
  const query = raw === null ? null : libraryQuery(new URLSearchParams(raw));
  const view = rawView === 'compact' ? 'compact' : 'grid';
  const unsupported = query !== raw || (rawView !== null && rawView !== view);
  return { query, view, message: unsupported ? STALE_CHOICES : null };
}

/** Remember destinations, not a second live filter model. Resolve before the list can fetch. */
export function LibraryNavigation({ children }: { readonly children: ReactNode }): JSX.Element {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [saved, setSaved] = useState(readSaved);
  const hasSavedChoices = saved.query !== null && saved.query !== DEFAULT_QUERY;
  const [entry, setEntry] = useState(() => ({
    location,
    restore: location.pathname === '/' && location.search === '' && hasSavedChoices,
  }));

  // Latch the entry decision until the redirect commits; a render/effect race
  // must never mount ListRoute with the empty query between the two locations.
  if (entry.location !== location) {
    setEntry({
      location,
      restore:
        location.pathname === '/' &&
        location.search === '' &&
        entry.location.pathname !== '/' &&
        navigationType !== 'POP' &&
        hasSavedChoices,
    });
  }

  useLayoutEffect(() => {
    if (location.pathname !== '/' || entry.restore) return;
    const params = new URLSearchParams(location.search);
    params.set('dir', readSortDir(params));
    const query = libraryQuery(params);
    let failed = false;
    try {
      localStorage.setItem(STORAGE_KEY, query);
      localStorage.setItem(LAYOUT_KEY, saved.view);
    } catch {
      failed = true;
    }
    setSaved((previous) => ({
      ...previous,
      query,
      message: failed ? STORAGE_ERROR : previous.message,
    }));
  }, [location.pathname, location.search, entry.restore, saved.view]);

  if (entry.restore && saved.query !== null) {
    return (
      <Navigate
        to={{ pathname: '/', search: `?${saved.query}`, hash: location.hash }}
        state={location.state}
        replace
      />
    );
  }

  return (
    <LibraryLayoutContext
      value={{
        view: saved.view,
        onViewChange: (view) => setSaved((previous) => ({ ...previous, view })),
      }}
    >
      {location.pathname === '/' && saved.message !== null && <p role="status">{saved.message}</p>}
      {children}
    </LibraryLayoutContext>
  );
}
