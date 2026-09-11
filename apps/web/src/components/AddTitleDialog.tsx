/**
 * "Add title" dialog (US-047, TASK-207).
 *
 * The owner puts a work on the list by hand — no screenshot, no batch. It
 * exists because extraction misses things: a title cut off at the edge of a
 * screenshot, a tile that is artwork only, or a service the owner knows they
 * saved something on and simply wants recorded.
 *
 * ⚠ THE SEARCH IS THE SAME ONE `FixMatchDialog` USES (`GET /api/tmdb/search`,
 * debounced 300 ms), and the identity always comes from TMDB. There is no
 * free-text title field anywhere in this dialog: a hand-typed name has no
 * work identity, so it could not be deduplicated (REQ-005), could not be
 * suppressed (REQ-071 keys on identity), and would render permanently without
 * a poster, a year or a runtime.
 *
 * ⚠ THE SERVICE HAS NO DEFAULT (US-047 AC-4). The badge is a factual claim
 * about where the owner saved the title; guessing it wrong makes the next
 * full-update reconciliation of that service propose the title for removal.
 * The same reasoning as `POST /api/batches` refusing to default its mode.
 *
 * ⚠ Search and submit are INJECTED, like every other dialog here —
 * `T-DATA-001` forbids calling the browser's fetch outside `apiClient.ts`.
 */
import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';

import {
  ADD_TITLE_DONE,
  ADD_TITLE_DONE_BADGE_ONLY,
  ADD_TITLE_DUPLICATE,
  ADD_TITLE_HEADING,
  ADD_TITLE_SEARCH_LABEL,
  ADD_TITLE_SERVICE_LABEL,
  ADD_TITLE_SERVICE_REQUIRED,
} from '../copy';
import { useDialogFocus } from '../lib/useDialogFocus';
import { useOutcomeFocus } from '../lib/useOutcomeFocus';
import {
  TMDB_UNAVAILABLE_MESSAGE,
  type TmdbSearchResponse,
  type TmdbSearchResult,
} from './FixMatchDialog';
import { withName } from './SuppressDialog';

/** Matches `FixMatchDialog` — one debounce, one poster size, one behaviour. */
const DEBOUNCE_MS = 300;
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w154';

const MEDIA_TYPE_LABELS: Record<string, string> = { movie: 'Movie', tv: 'TV' };

/** The services a title can be added to (REQ-053 — v1 scope lock). */
const SERVICE_OPTIONS = [
  { value: 'netflix', label: 'Netflix' },
  { value: 'max', label: 'Max' },
] as const;

export interface AddTitleRequest {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  service: string;
}

export interface AddTitleResult {
  titleId: string;
  name: string;
  titleWasCreated: boolean;
}

export interface AddTitleDialogProps {
  searchTmdb: (q: string) => Promise<TmdbSearchResponse>;
  addTitle: (body: AddTitleRequest) => Promise<AddTitleResult>;
  onClose: () => void;
  /** Lets the list refresh once something was actually written. */
  onAdded?: () => void;
}

type Phase =
  | 'idle'
  | 'searching'
  | 'results'
  | 'no-results'
  | 'search-unavailable'
  | 'confirming'
  | 'submitting'
  | 'tmdb-unavailable'
  | 'duplicate'
  | 'suppressed'
  | 'failed'
  | 'success';

export function AddTitleDialog({
  searchTmdb,
  addTitle,
  onClose,
  onAdded,
}: AddTitleDialogProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [selected, setSelected] = useState<TmdbSearchResult | null>(null);
  const [service, setService] = useState('');
  const [serviceError, setServiceError] = useState(false);
  const [unsuppressHref, setUnsuppressHref] = useState('');
  const [result, setResult] = useState<AddTitleResult | null>(null);
  const headingId = useId();
  const serviceLabelId = useId();
  const dialogRef = useDialogFocus(onClose);
  const outcomeRef = useOutcomeFocus<HTMLParagraphElement>(phase === 'success');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  const submit = useCallback(() => {
    if (selected === null) return;
    // ⚠ Checked HERE rather than by disabling the button. A disabled confirm
    // with no explanation is the state an owner stares at without knowing what
    // is missing; this names the missing thing instead (§2.12's rule that a
    // dead control must always say why).
    if (service === '') {
      setServiceError(true);
      return;
    }
    setServiceError(false);
    setPhase('submitting');
    addTitle({ tmdbId: selected.tmdbId, mediaType: selected.mediaType, service }).then(
      (resp) => {
        setResult(resp);
        setPhase('success');
        onAdded?.();
      },
      (error: unknown) => {
        const code =
          error instanceof Error && 'code' in error ? (error as { code: string }).code : '';
        const details =
          error instanceof Error && 'details' in error
            ? (error as { details: Record<string, unknown> }).details
            : {};
        if (code === 'DUPLICATE_WORK_IDENTITY') {
          setPhase('duplicate');
        } else if (code === 'WORK_SUPPRESSED') {
          setUnsuppressHref(
            typeof details['unsuppressHref'] === 'string' ? details['unsuppressHref'] : '',
          );
          setPhase('suppressed');
        } else if (code === 'TMDB_UNAVAILABLE') {
          setPhase('tmdb-unavailable');
        } else {
          setPhase('failed');
        }
      },
    );
  }, [addTitle, onAdded, selected, service]);

  const searching =
    phase === 'idle' ||
    phase === 'searching' ||
    phase === 'results' ||
    phase === 'no-results' ||
    phase === 'search-unavailable';

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <h2 id={headingId}>{ADD_TITLE_HEADING}</h2>

      {searching && (
        <>
          <input
            type="search"
            aria-label={ADD_TITLE_SEARCH_LABEL}
            data-testid="add-title-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a film or series…"
          />

          {phase === 'searching' && <p aria-busy="true">Searching…</p>}
          {phase === 'no-results' && <p role="status">No results for &ldquo;{query}&rdquo;</p>}
          {phase === 'search-unavailable' && <p role="alert">{TMDB_UNAVAILABLE_MESSAGE}</p>}

          {phase === 'results' && (
            <ul data-testid="add-title-results">
              {results.map((item) => (
                <li key={`${item.mediaType}:${item.tmdbId}`}>
                  {item.posterPath !== null && (
                    <img src={`${TMDB_IMAGE_BASE}${item.posterPath}`} alt="" />
                  )}
                  <span data-testid="add-result-name">{item.name}</span>
                  {item.releaseYear !== null && <span>{item.releaseYear}</span>}
                  <span>{MEDIA_TYPE_LABELS[item.mediaType] ?? item.mediaType}</span>
                  <button
                    type="button"
                    className="tap-target"
                    data-testid={`add-select-${item.tmdbId}`}
                    onClick={() => {
                      setSelected(item);
                      setPhase('confirming');
                    }}
                  >
                    Select
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {(phase === 'confirming' || phase === 'submitting') && selected !== null && (
        <>
          <p>
            Add <strong data-testid="add-selected-name">{selected.name}</strong>
            {selected.releaseYear !== null && <> ({selected.releaseYear})</>} to your list?
          </p>

          <fieldset>
            <legend id={serviceLabelId}>{ADD_TITLE_SERVICE_LABEL}</legend>
            {SERVICE_OPTIONS.map((option) => (
              <label key={option.value} className="tap-target">
                <input
                  type="radio"
                  name="add-title-service"
                  value={option.value}
                  checked={service === option.value}
                  data-testid={`add-service-${option.value}`}
                  onChange={() => {
                    setService(option.value);
                    setServiceError(false);
                  }}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          {serviceError && (
            <p role="alert" data-testid="add-service-required">
              {ADD_TITLE_SERVICE_REQUIRED}
            </p>
          )}

          <button
            type="button"
            className="tap-target"
            data-testid="confirm-add-title"
            disabled={phase === 'submitting'}
            onClick={submit}
          >
            {phase === 'submitting' ? 'Adding…' : 'Add to list'}
          </button>
          <button
            type="button"
            className="tap-target"
            disabled={phase === 'submitting'}
            onClick={() => {
              setSelected(null);
              setPhase(results.length > 0 ? 'results' : 'idle');
            }}
          >
            Back
          </button>
        </>
      )}

      {phase === 'duplicate' && (
        <p role="alert" data-testid="add-duplicate">
          {ADD_TITLE_DUPLICATE}
        </p>
      )}

      {phase === 'suppressed' && (
        <>
          <p role="alert" data-testid="add-suppressed">
            You marked that title as not interested. Stop ignoring it first?
          </p>
          {unsuppressHref !== '' && (
            <a href={unsuppressHref} data-testid="add-unsuppress-link">
              Stop ignoring and continue
            </a>
          )}
        </>
      )}

      {phase === 'tmdb-unavailable' && (
        <p role="alert" data-testid="add-tmdb-unavailable">
          {TMDB_UNAVAILABLE_MESSAGE}
        </p>
      )}

      {phase === 'failed' && (
        <p role="alert" data-testid="add-failed">
          Couldn&rsquo;t add that. Nothing has changed.
        </p>
      )}

      {phase === 'success' && result !== null && (
        <p role="status" data-testid="add-title-done" ref={outcomeRef} tabIndex={-1}>
          {result.titleWasCreated
            ? withName(ADD_TITLE_DONE, result.name)
            : withName(ADD_TITLE_DONE_BADGE_ONLY, result.name).replace(
                '{service}',
                SERVICE_OPTIONS.find((o) => o.value === service)?.label ?? service,
              )}
        </p>
      )}

      {phase !== 'submitting' && (
        <button type="button" className="tap-target" onClick={onClose}>
          {phase === 'success' ? 'Close' : 'Cancel'}
        </button>
      )}
    </div>
  );
}
