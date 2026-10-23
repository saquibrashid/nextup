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
 * ⚠ THE DESTINATION IS PRE-SELECTED FROM REAL DATA, NEVER SILENTLY DEFAULTED
 * (US-047 AC-4 as amended by #455, PRD `A60`, US-068). After a title is
 * chosen, `GET /api/tmdb/service-lookup` — the Auto-detect review's own lookup —
 * says which of the owner's services stream it; every match is pre-ticked, a
 * title on none of them is pre-set to Waiting to stream, and a lookup that is
 * unknown or failed pre-selects NOTHING and says so. The owner sees the
 * proposal, can change it, and nothing is written until they press confirm.
 * A badge is a factual claim about where the title is saved, and a wrong one
 * makes the next full-update of that service propose the title for removal —
 * which is why an unconfirmed or empty choice is refused, never guessed.
 * ~~THE SERVICE HAS NO DEFAULT (US-047 AC-4): the owner must pick one.~~
 *
 * ⚠ Search, lookup and submit are INJECTED, like every other dialog here —
 * `T-DATA-001` forbids calling the browser's fetch outside `apiClient.ts`.
 *
 * #371 (TASK-248): results use the shared `TitleSearchResults` rows, the
 * heading/close/search stay sticky above them, and search or write failures
 * offer an explicit Retry that repeats the same owner-chosen request.
 */
import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';
import { SERVICES, SERVICE_LABELS, type Service } from '@nextup/domain';

import {
  ADD_TITLE_CLOSE_LABEL,
  ADD_TITLE_CONFIRM_LIBRARY,
  ADD_TITLE_CONFIRM_WAITING,
  ADD_TITLE_DONE,
  ADD_TITLE_DONE_BADGE_ONLY,
  ADD_TITLE_DONE_WAITING,
  ADD_TITLE_DUPLICATE,
  ADD_TITLE_HEADING,
  ADD_TITLE_LOOKED_UP_FOUND,
  ADD_TITLE_LOOKED_UP_NONE,
  ADD_TITLE_LOOKING_UP,
  ADD_TITLE_LOOKUP_FAILED,
  ADD_TITLE_LOOKUP_UNKNOWN,
  ADD_TITLE_SEARCH_LABEL,
  ADD_TITLE_SERVICE_LABEL,
  ADD_TITLE_SERVICE_REQUIRED,
  ADD_TITLE_WAITING_OPTION,
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
  /** The owner's confirmed choice (#455): services to badge, or Waiting. */
  destination?: { kind: 'services'; services: Service[] } | { kind: 'waiting' };
  service?: string;
}

export interface AddTitleResult {
  titleId: string;
  name: string;
  titleWasCreated: boolean;
  destination?: 'services' | 'waiting';
  /** The services actually written; one already held is left out. */
  services?: string[];
}

export interface AddTitleServiceLookup {
  status: 'found' | 'none' | 'unknown' | 'failed';
  services: Service[];
}

export interface AddTitleDialogProps {
  searchTmdb: (q: string) => Promise<TmdbSearchResponse>;
  addTitle: (body: AddTitleRequest) => Promise<AddTitleResult>;
  /**
   * #455 — the availability lookup that pre-selects services. Optional: absent
   * (or rejecting) the owner simply chooses by hand, so it never blocks an add.
   */
  lookupServices?: (tmdbId: number, mediaType: 'movie' | 'tv') => Promise<AddTitleServiceLookup>;
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
  | 'looking-up'
  | 'confirming'
  | 'submitting'
  | 'tmdb-unavailable'
  | 'duplicate'
  | 'suppressed'
  | 'failed'
  | 'success';

/** What the owner currently has chosen — proposed by the lookup, then theirs. */
interface Choice {
  services: Service[];
  waiting: boolean;
}

const NO_CHOICE: Choice = { services: [], waiting: false };

function lookupNote(lookup: AddTitleServiceLookup | null): string {
  if (lookup === null || lookup.status === 'failed') return ADD_TITLE_LOOKUP_FAILED;
  if (lookup.status === 'found' && lookup.services.length > 0) {
    return ADD_TITLE_LOOKED_UP_FOUND.replace(
      '{services}',
      lookup.services.map((service) => SERVICE_LABELS[service]).join(', '),
    );
  }
  if (lookup.status === 'none') return ADD_TITLE_LOOKED_UP_NONE;
  return ADD_TITLE_LOOKUP_UNKNOWN;
}

/** `found` pre-ticks every match, `none` proposes Waiting; anything else proposes nothing. */
function proposedChoice(lookup: AddTitleServiceLookup | null): Choice {
  if (lookup === null) return NO_CHOICE;
  if (lookup.status === 'found' && lookup.services.length > 0) {
    return { services: SERVICES.filter((s) => lookup.services.includes(s)), waiting: false };
  }
  return lookup.status === 'none' ? { services: [], waiting: true } : NO_CHOICE;
}

export function AddTitleDialog({
  searchTmdb,
  addTitle,
  lookupServices,
  onClose,
  onAdded,
}: AddTitleDialogProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [selected, setSelected] = useState<TmdbSearchResult | null>(null);
  const [choice, setChoice] = useState<Choice>(NO_CHOICE);
  const [note, setNote] = useState('');
  const [serviceError, setServiceError] = useState(false);
  const [unsuppressHref, setUnsuppressHref] = useState('');
  const [result, setResult] = useState<AddTitleResult | null>(null);
  const headingId = useId();
  const serviceLabelId = useId();
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const lookupToken = useRef(0);

  const outcomeRef = useOutcomeFocus<HTMLParagraphElement>(phase === 'success');

  // Focus lands on the summary once the lookup has answered, so a keyboard or
  // screen-reader owner is where the proposal is, not on a vanished result row.
  useEffect(() => {
    if (phase === 'confirming') summaryRef.current?.focus();
  }, [phase]);

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

  const select = useCallback(
    (item: TmdbSearchResult) => {
      setSelected(item);
      setServiceError(false);
      setChoice(NO_CHOICE);
      if (lookupServices === undefined) {
        setNote(lookupNote(null));
        setPhase('confirming');
        return;
      }
      const token = ++lookupToken.current;
      setPhase('looking-up');
      lookupServices(item.tmdbId, item.mediaType).then(
        (lookup) => {
          if (lookupToken.current !== token) return;
          setChoice(proposedChoice(lookup));
          setNote(lookupNote(lookup));
          setPhase('confirming');
        },
        () => {
          // ⚠ A failed lookup never blocks the add: the owner chooses by hand.
          if (lookupToken.current !== token) return;
          setNote(lookupNote(null));
          setPhase('confirming');
        },
      );
    },
    [lookupServices],
  );

  const submit = useCallback(() => {
    if (selected === null) return;
    // ⚠ Checked HERE rather than by disabling the button. A disabled confirm
    // with no explanation is the state an owner stares at without knowing what
    // is missing; this names the missing thing instead (§2.12's rule that a
    // dead control must always say why). An empty choice is never guessed.
    if (!choice.waiting && choice.services.length === 0) {
      setServiceError(true);
      return;
    }
    setServiceError(false);
    setPhase('submitting');
    addTitle({
      tmdbId: selected.tmdbId,
      mediaType: selected.mediaType,
      destination: choice.waiting
        ? { kind: 'waiting' }
        : { kind: 'services', services: choice.services },
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
  }, [addTitle, onAdded, selected, choice]);

  const searching =
    phase === 'idle' ||
    phase === 'searching' ||
    phase === 'results' ||
    phase === 'no-results' ||
    phase === 'search-unavailable';

  const backToResults = (): void => {
    lookupToken.current += 1;
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
        <TitleSearchResults results={results} onSelect={select} testIds={ADD_RESULT_TEST_IDS} />
      )}

      {(phase === 'looking-up' || phase === 'confirming' || phase === 'submitting') &&
        selected !== null && (
          <>
            <div
              className="title-search-selected"
              data-testid="add-selected-summary"
              ref={summaryRef}
              tabIndex={-1}
            >
              <TitleSearchThumb posterPath={selected.posterPath} />
              <div className="title-search-result__body">
                <p>
                  Add <strong data-testid="add-selected-name">{selected.name}</strong>
                  {selected.releaseYear !== null && (
                    <> ({releaseYearText(selected.releaseYear, selected.edition !== undefined)})</>
                  )}
                  ?
                </p>
                {selected.edition !== undefined && <EditionLabels labels={[selected.edition]} />}
                <span className="title-search-result__meta">
                  <span>{mediaTypeLabel(selected.mediaType)}</span>
                </span>
              </div>
            </div>

            {phase === 'looking-up' ? (
              <p role="status" aria-busy="true" data-testid="add-lookup-busy">
                {ADD_TITLE_LOOKING_UP}
              </p>
            ) : (
              <>
                <p role="status" data-testid="add-lookup-note">
                  {note}
                </p>
                <Field legend={ADD_TITLE_SERVICE_LABEL} legendId={serviceLabelId}>
                  {SERVICE_OPTIONS.map((option) => (
                    <label key={option.value} className="tap-target">
                      <Input
                        type="checkbox"
                        value={option.value}
                        checked={choice.services.includes(option.value)}
                        disabled={phase === 'submitting'}
                        data-testid={`add-service-${option.value}`}
                        onChange={(event) => {
                          const on = event.currentTarget.checked;
                          setServiceError(false);
                          setChoice((current) => ({
                            waiting: false,
                            services: SERVICES.filter((s) =>
                              s === option.value ? on : current.services.includes(s),
                            ),
                          }));
                        }}
                      />
                      {option.label}
                    </label>
                  ))}
                  <label className="tap-target">
                    <Input
                      type="checkbox"
                      checked={choice.waiting}
                      disabled={phase === 'submitting'}
                      data-testid="add-waiting"
                      onChange={(event) => {
                        setServiceError(false);
                        setChoice({ services: [], waiting: event.currentTarget.checked });
                      }}
                    />
                    {ADD_TITLE_WAITING_OPTION}
                  </label>
                </Field>
                {serviceError && (
                  <p role="alert" data-testid="add-service-required">
                    {ADD_TITLE_SERVICE_REQUIRED}
                  </p>
                )}
              </>
            )}

            <div className="title-search-actions">
              <Button variant="secondary" disabled={phase === 'submitting'} onClick={backToResults}>
                Back
              </Button>
              <Button
                variant="primary"
                data-testid="confirm-add-title"
                disabled={phase === 'submitting' || phase === 'looking-up'}
                onClick={submit}
              >
                {phase === 'submitting'
                  ? 'Adding…'
                  : choice.waiting
                    ? ADD_TITLE_CONFIRM_WAITING
                    : ADD_TITLE_CONFIRM_LIBRARY}
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
          {result.destination === 'waiting'
            ? withName(ADD_TITLE_DONE_WAITING, result.name)
            : result.titleWasCreated
              ? withName(ADD_TITLE_DONE, result.name)
              : withName(ADD_TITLE_DONE_BADGE_ONLY, result.name).replace(
                  '{service}',
                  (result.services ?? choice.services)
                    .map((s) => SERVICE_OPTIONS.find((o) => o.value === s)?.label ?? s)
                    .join(', '),
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
