import { useLayoutEffect, useState, type JSX, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigationType } from 'react-router-dom';
import { applyFilters, parseFilters } from './FilterBar';
import { defaultDirFor, readSortDir, readSortKey } from './SortControl';

const STORAGE_KEY = 'nextup.library.v1';
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

function readSaved(): { query: string | null; message: string | null } {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { query: null, message: STORAGE_ERROR };
  }
  if (raw === null) return { query: null, message: null };
  const query = libraryQuery(new URLSearchParams(raw));
  return { query, message: query === raw ? null : STALE_CHOICES };
}

/** Remember destinations, not a second live filter model. Resolve before the list can fetch. */
export function LibraryNavigation({ children }: { readonly children: ReactNode }): JSX.Element {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [saved, setSaved] = useState(readSaved);
  const [entry, setEntry] = useState(() => ({
    location,
    restore: location.pathname === '/' && location.search === '' && saved.query !== null,
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
        saved.query !== null,
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
    } catch {
      failed = true;
    }
    setSaved((previous) => ({
      query,
      message: failed ? STORAGE_ERROR : previous.message,
    }));
  }, [location.pathname, location.search, entry.restore]);

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
    <>
      {location.pathname === '/' && saved.message !== null && <p role="status">{saved.message}</p>}
      {children}
    </>
  );
}
