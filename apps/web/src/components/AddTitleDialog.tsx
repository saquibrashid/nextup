import { Dialog } from './ui/Dialog';
import { EditionLabels } from './EditionLabels';
import { releaseYearText } from '@nextup/domain';
import { Input } from './ui/Input';
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
 *
 * #371 (TASK-248): results use the shared `TitleSearchResults` rows, the
 * heading/close/search stay sticky above them, and search or write failures
 * offer an explicit Retry that repeats the same owner-chosen request.
 */
import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';
import { SERVICES, SERVICE_LABELS } from '@nextup/domain';

import {
  ADD_TITLE_CLOSE_LABEL,
  ADD_TITLE_DONE,
  ADD_TITLE_DONE_BADGE_ONLY,
  ADD_TITLE_DUPLICATE,
  ADD_TITLE_HEADING,
  ADD_TITLE_SEARCH_LABEL,
  ADD_TITLE_SERVICE_LABEL,
  ADD_TITLE_SERVICE_REQUIRED,
  RETRY_LABEL,
} from '../copy';

import { useOutcomeFocus } from '../lib/useOutcomeFocus';
import {
  TMDB_UNAVAILABLE_MESSAGE,
  type TmdbSearchResponse,
  type TmdbSearchResult,
} from './FixMatchDialog';
import { CloseIcon } from './icons';
import { withName } from './SuppressDialog';
import {
  TitleSearchResults,
  TitleSearchThumb,
  mediaTypeLabel,
  type TitleSearchResultTestIds,
} from './TitleSearchResults';
import { Button } from './ui/Button';
import { Field } from './ui/Field';

/** Matches `FixMatchDialog` — one debounce, one result layout, one behaviour. */
const DEBOUNCE_MS = 300;

const ADD_RESULT_TEST_IDS: TitleSearchResultTestIds = {
  list: 'add-title-results',
  name: 'add-result-name',
  select: (result) => `add-select-${result.tmdbId}`,
};

const SERVICE_OPTIONS = SERVICES.map((value) => ({ value, label: SERVICE_LABELS[value] }));

export interface AddTitleRequest {
  edition?: import('@nextup/domain').EditionLabel;
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
    addTitle({
      tmdbId: selected.tmdbId,
      mediaType: selected.mediaType,
      service,
      ...(selected.edition === undefined ? {} : { edition: selected.edition }),
    }).then(
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

  const backToResults = (): void => {
    setSelected(null);
    setPhase(results.length > 0 ? 'results' : 'idle');
  };

  return (
    <Dialog
      onDismiss={() => {
        if (phase !== 'submitting') onClose();
      }}
      aria-labelledby={headingId}
    >
      {/*
       * ⚠ STICKY, NOT A NESTED SCROLLER. The dialog is the only scroll
       * container (`T-MOD-002c`), so 200% zoom and short phones keep one
       * scrollable surface, while the heading, close control and search stay
       * reachable above a long result list.
       */}
      <div className="title-search-head">
        <div className="panel-head">
          <h2 id={headingId}>{ADD_TITLE_HEADING}</h2>
          {phase !== 'submitting' && (
            <Button variant="ghost" aria-label={ADD_TITLE_CLOSE_LABEL} onClick={onClose}>
              <CloseIcon />
            </Button>
          )}
        </div>
        {searching && (
          <Input
            type="search"
            aria-label={ADD_TITLE_SEARCH_LABEL}
            data-testid="add-title-search-input"
            data-dialog-initial-focus=""
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a film or series…"
          />
        )}
      </div>

      {phase === 'searching' && (
        <p className="title-search-feedback" aria-busy="true">
          Searching…
        </p>
      )}
      {phase === 'no-results' && (
        <p className="title-search-feedback" role="status">
          No results for &ldquo;{query}&rdquo;
        </p>
      )}
      {phase === 'search-unavailable' && (
        <div className="title-search-feedback">
          <p role="alert">{TMDB_UNAVAILABLE_MESSAGE}</p>
          <Button
            variant="secondary"
            data-testid="add-search-retry"
            onClick={() => doSearch(query)}
          >
            {RETRY_LABEL}
          </Button>
        </div>
      )}

      {phase === 'results' && (
        <TitleSearchResults
          results={results}
          onSelect={(item) => {
            setSelected(item);
            setPhase('confirming');
          }}
          testIds={ADD_RESULT_TEST_IDS}
        />
      )}

      {(phase === 'confirming' || phase === 'submitting') && selected !== null && (
        <>
          <div className="title-search-selected" data-testid="add-selected-summary">
            <TitleSearchThumb posterPath={selected.posterPath} />
            <div className="title-search-result__body">
              <p>
                Add <strong data-testid="add-selected-name">{selected.name}</strong>
                {selected.releaseYear !== null && (
                  <> ({releaseYearText(selected.releaseYear, selected.edition !== undefined)})</>
                )}{' '}
                to your library?
              </p>
              {selected.edition !== undefined && <EditionLabels labels={[selected.edition]} />}
              <span className="title-search-result__meta">
                <span>{mediaTypeLabel(selected.mediaType)}</span>
              </span>
            </div>
          </div>

          <Field legend={ADD_TITLE_SERVICE_LABEL} legendId={serviceLabelId}>
            {SERVICE_OPTIONS.map((option) => (
              <label key={option.value} className="tap-target">
                <Input
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
          </Field>
          {serviceError && (
            <p role="alert" data-testid="add-service-required">
              {ADD_TITLE_SERVICE_REQUIRED}
            </p>
          )}

          <div className="title-search-actions">
            <Button variant="secondary" disabled={phase === 'submitting'} onClick={backToResults}>
              Back
            </Button>
            <Button
              variant="primary"
              data-testid="confirm-add-title"
              disabled={phase === 'submitting'}
              onClick={submit}
            >
              {phase === 'submitting' ? 'Adding…' : 'Add to library'}
            </Button>
          </div>
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

      {/*
       * Retrying resubmits the SAME explicit selection and service. It is an
       * owner action after a stated failure, never an automatic retry, and
       * nothing reads as success until the server confirms the write.
       */}
      {(phase === 'tmdb-unavailable' || phase === 'failed') && selected !== null && (
        <div className="title-search-actions">
          <Button variant="secondary" onClick={() => setPhase('confirming')}>
            Back
          </Button>
          <Button variant="primary" data-testid="add-submit-retry" onClick={submit}>
            {RETRY_LABEL}
          </Button>
        </div>
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
        <div className="title-search-actions">
          <Button variant="secondary" onClick={onClose}>
            {phase === 'success' ? 'Close' : 'Cancel'}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
