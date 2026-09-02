/**
 * "Fix match" dialog (US-030, TASK-111).
 *
 * `specs/ui.md` §2.3: a TMDB search box (GET /api/tmdb/search, debounced
 * 300 ms), results as poster + name + year + type. Selecting one shows a
 * confirmation naming what is preserved; submitting posts to
 * `POST /api/titles/:titleId/fix-match`.
 *
 * `specs/ux-states.md` states covered:
 *  §3.3 Searching — debounced results; "Searching…" then "No results for '{q}'"
 *  §3.4 TMDB unavailable (502) — "Couldn't reach TMDB. Try again in a moment.
 *       Nothing has changed." + Retry (`T-UX-033`)
 *  §3.5 409 DUPLICATE_WORK_IDENTITY — inline confirm
 *  §3.6 409 TARGET_WORK_SUPPRESSED — inline un-suppress prompt
 *  §3.7 Success with suppression migration — `FIXMATCH_SUPPRESSION_MIGRATED`
 *
 * ⚠ The dialog accepts `searchTmdb` and `fixMatch` as props (dependency
 * injection, same pattern as `SuppressDialog`). That keeps it free of direct
 * network calls — `T-DATA-001` forbids calling the browser's native fetch
 * function outside `apiClient.ts`.
 *
 * ⚠ `TMDB_UNAVAILABLE_MESSAGE` ("Couldn't reach TMDB. Try again in a moment.
 * Nothing has changed.") is defined here beside its only consumer because
 * `specs/ui.md` §9 has no row for it, so it cannot be transcribed from §9 and
 * would be "invented copy" if placed in `copy.ts`.
 */
import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';

import { FIXMATCH_SUPPRESSION_MIGRATED } from '../copy';
import { useDialogFocus } from '../lib/useDialogFocus';

/** 300 ms debounce matches the §2.3 spec. */
const DEBOUNCE_MS = 300;

/** The text the owner reads when the fix-match POST returns 502 (`T-UX-033`). */
export const TMDB_UNAVAILABLE_MESSAGE =
  "Couldn't reach TMDB. Try again in a moment. Nothing has changed.";

export interface TmdbSearchResult {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
}

export interface TmdbSearchResponse {
  items: TmdbSearchResult[];
}

export interface FixMatchRequest {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  confirmDuplicate: boolean;
}

export interface FixMatchResponse {
  titleId: string;
  workIdentity: string;
  preserved: {
    listingIds: string[];
    dateAdded: Record<string, string>;
    sortDateAdded: string | null;
  };
  suppressionMigrated: { from: string; to: string } | null;
}

export interface FixMatchDialogProps {
  titleId: string;
  name: string;
  /** Active service badges — shown in the confirmation step. */
  badges: ReadonlyArray<{ service: string; listingId: string; dateAdded: string }>;
  /** GET /api/tmdb/search */
  searchTmdb: (q: string) => Promise<TmdbSearchResponse>;
  /** POST /api/titles/:titleId/fix-match */
  fixMatch: (titleId: string, req: FixMatchRequest) => Promise<FixMatchResponse>;
  onClose: () => void;
}

const MEDIA_TYPE_LABELS: Record<string, string> = {
  movie: 'Movie',
  tv: 'TV',
};

/** `specs/ui.md` §2.3 poster size. */
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w154';

type Phase =
  | 'idle'
  | 'searching'
  | 'results'
  | 'no-results'
  | 'search-unavailable'
  | 'confirming'
  | 'submitting'
  | 'tmdb-unavailable'
  | 'duplicate-409'
  | 'suppressed-409'
  | 'success';

export function FixMatchDialog({
  titleId,
  name,
  badges,
  searchTmdb,
  fixMatch,
  onClose,
}: FixMatchDialogProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [selected, setSelected] = useState<TmdbSearchResult | null>(null);
  // 409 DUPLICATE_WORK_IDENTITY details
  const [duplicateInfo, setDuplicateInfo] = useState<{ existingTitleId: string } | null>(null);
  // 409 TARGET_WORK_SUPPRESSED details
  const [suppressedInfo, setSuppressedInfo] = useState<{
    workIdentity: string;
    unsuppressHref: string;
  } | null>(null);
  const [successResult, setSuccessResult] = useState<FixMatchResponse | null>(null);
  const headingId = useId();
  const dialogRef = useDialogFocus(onClose);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the latest query so stale responses are discarded.
  const latestQuery = useRef('');

  const doSearch = useCallback(
    (q: string) => {
      latestQuery.current = q;
      if (!q.trim()) {
        setPhase('idle');
        setResults([]);
        return;
      }
      setPhase('searching');
      searchTmdb(q).then(
        (resp) => {
          // Discard if a newer search was started.
          if (latestQuery.current !== q) return;
          setResults(resp.items);
          setPhase(resp.items.length === 0 ? 'no-results' : 'results');
        },
        () => {
          if (latestQuery.current !== q) return;
          setPhase('search-unavailable');
        },
      );
    },
    [searchTmdb],
  );

  // Debounced search on query change.
  useEffect(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  const selectResult = useCallback((result: TmdbSearchResult) => {
    setSelected(result);
    setPhase('confirming');
  }, []);

  const submit = useCallback(
    (confirmDuplicate = false) => {
      if (selected === null) return;
      setPhase('submitting');
      fixMatch(titleId, {
        tmdbId: selected.tmdbId,
        mediaType: selected.mediaType,
        confirmDuplicate,
      }).then(
        (resp) => {
          setSuccessResult(resp);
          setPhase('success');
        },
        (err: unknown) => {
          // Inspect the error by duck-typing to avoid importing ApiError.
          const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : '';
          const details =
            err instanceof Error && 'details' in err
              ? (err as { details: Record<string, unknown> }).details
              : {};

          if (code === 'TMDB_UNAVAILABLE') {
            setPhase('tmdb-unavailable');
          } else if (code === 'DUPLICATE_WORK_IDENTITY') {
            setDuplicateInfo({
              existingTitleId:
                typeof details['existingTitleId'] === 'string' ? details['existingTitleId'] : '',
            });
            setPhase('duplicate-409');
          } else if (code === 'TARGET_WORK_SUPPRESSED') {
            setSuppressedInfo({
              workIdentity:
                typeof details['workIdentity'] === 'string' ? details['workIdentity'] : '',
              unsuppressHref:
                typeof details['unsuppressHref'] === 'string' ? details['unsuppressHref'] : '',
            });
            setPhase('suppressed-409');
          } else {
            // General error: stay on confirming with an inline message.
            setPhase('confirming');
          }
        },
      );
    },
    [fixMatch, selected, titleId],
  );

  const retryTmdb = useCallback(() => {
    submit(false);
  }, [submit]);

  const keepBoth = useCallback(() => {
    submit(true);
  }, [submit]);

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <h2 id={headingId}>Fix match</h2>

      {/* ── Search phase ─────────────────────────────────────────────────── */}
      {(phase === 'idle' ||
        phase === 'searching' ||
        phase === 'results' ||
        phase === 'no-results' ||
        phase === 'search-unavailable') && (
        <>
          <input
            type="search"
            aria-label="Search TMDB"
            data-testid="tmdb-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search for "${name}"…`}
          />

          {phase === 'searching' && <p aria-busy="true">Searching…</p>}

          {phase === 'no-results' && <p role="status">No results for &ldquo;{query}&rdquo;</p>}

          {phase === 'search-unavailable' && <p role="alert">{TMDB_UNAVAILABLE_MESSAGE}</p>}

          {phase === 'results' && (
            <ul data-testid="tmdb-results">
              {results.map((result) => (
                <li key={`${result.mediaType}:${result.tmdbId}`}>
                  {result.posterPath !== null && (
                    <img
                      src={`${TMDB_IMAGE_BASE}${result.posterPath}`}
                      alt=""
                      data-testid="result-poster"
                    />
                  )}
                  <span data-testid="result-name">{result.name}</span>
                  {result.releaseYear !== null && (
                    <span data-testid="result-year">{result.releaseYear}</span>
                  )}
                  <span data-testid="result-type">
                    {MEDIA_TYPE_LABELS[result.mediaType] ?? result.mediaType}
                  </span>
                  <button
                    type="button"
                    onClick={() => selectResult(result)}
                    data-testid={`select-result-${result.tmdbId}`}
                  >
                    Select
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ── Confirmation step ─────────────────────────────────────────────── */}
      {(phase === 'confirming' || phase === 'submitting') && selected !== null && (
        <>
          <p>
            Match &ldquo;{name}&rdquo; to{' '}
            <strong data-testid="selected-name">{selected.name}</strong>
            {selected.releaseYear !== null && <> ({selected.releaseYear})</>}?
          </p>
          {/* §2.3: "Your Netflix badge and the date you added it … stay the same." */}
          {badges.length > 0 && (
            <p data-testid="preserved-notice">
              Your{' '}
              {badges.map((b, i) => (
                <span key={b.listingId}>
                  {i > 0 && ' and '}
                  {b.service}
                </span>
              ))}{' '}
              badge{badges.length > 1 ? 's' : ''} and the date
              {badges.length === 1 && badges[0] !== undefined
                ? ` you added it (${badges[0].dateAdded})`
                : 's you added them'}{' '}
              stay the same.
            </p>
          )}
          <button
            type="button"
            onClick={() => submit()}
            disabled={phase === 'submitting'}
            data-testid="confirm-fix-match"
          >
            {phase === 'submitting' ? 'Applying…' : 'Fix match'}
          </button>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setPhase(results.length > 0 ? 'results' : 'idle');
            }}
            disabled={phase === 'submitting'}
          >
            Back
          </button>
        </>
      )}

      {/* ── TMDB unavailable (§3.4, T-UX-033) ───────────────────────────── */}
      {phase === 'tmdb-unavailable' && (
        <>
          <p role="alert" data-testid="tmdb-unavailable-message">
            {TMDB_UNAVAILABLE_MESSAGE}
          </p>
          <button type="button" onClick={retryTmdb} data-testid="retry-fix-match">
            Retry
          </button>
        </>
      )}

      {/* ── 409 DUPLICATE_WORK_IDENTITY (§3.5) ───────────────────────────── */}
      {phase === 'duplicate-409' && selected !== null && duplicateInfo !== null && (
        <>
          <p role="alert" data-testid="duplicate-message">
            You already have &ldquo;{selected.name}&rdquo; on your list. Do you want two rows for
            it?
          </p>
          <button type="button" onClick={keepBoth} data-testid="keep-both">
            Yes, keep both
          </button>
          <a href={`/titles/${duplicateInfo.existingTitleId}`} data-testid="open-existing">
            Open the existing one
          </a>
        </>
      )}

      {/* ── 409 TARGET_WORK_SUPPRESSED (§3.6) ────────────────────────────── */}
      {phase === 'suppressed-409' && selected !== null && suppressedInfo !== null && (
        <>
          <p role="alert" data-testid="suppressed-message">
            You marked &ldquo;{selected.name}&rdquo; as not interested. Stop ignoring it first?
          </p>
          <a href={suppressedInfo.unsuppressHref} data-testid="unsuppress-link">
            Stop ignoring and continue
          </a>
        </>
      )}

      {/* ── Success (§3.7) ───────────────────────────────────────────────── */}
      {phase === 'success' && successResult !== null && (
        <>
          <p role="status" data-testid="success-message">
            Done. &ldquo;{name}&rdquo; is now matched.
          </p>
          {successResult.suppressionMigrated !== null && (
            <p data-testid="suppression-migrated">{FIXMATCH_SUPPRESSION_MIGRATED}</p>
          )}
        </>
      )}

      {/* ── Cancel / Close ───────────────────────────────────────────────── */}
      {phase !== 'submitting' && (
        <button type="button" onClick={onClose}>
          {phase === 'success' ? 'Close' : 'Cancel'}
        </button>
      )}
    </div>
  );
}
