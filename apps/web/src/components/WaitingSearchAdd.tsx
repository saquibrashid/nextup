// Search-to-add on `/waiting` (#378, owner decision 2).
//
// ⚠ **THIS NEVER TOUCHES THE COMBINED LIST.** `POST /api/waiting` records a
// `WatchIntent` with `discoverySource: 'search'` and no batch; the combined
// list is still entered only by a capture (US-042 AC-3). The button therefore
// says "Wait for it", never "Add". #457: the entry point IS an explicit Add (+)
// control (not a "Search" that reads as a list filter); it only opens the lookup.
// A63: the lookup opens in the shared modal Dialog, like Library's Add title.
//
// ⚠ A refusal is an ANSWER, not a failure. "Already waiting", "already in
// your library" and "not interested" each say which fact stopped it, so the
// owner is never left wondering whether pressing again would help.

import { useId, useRef, useState, type FormEvent, type JSX } from 'react';

import {
  WAITING_ADD_CLOSE_LABEL,
  WAITING_ADD_OPEN,
  WAITING_SEARCH_ACTION,
  WAITING_SEARCH_ADD,
  WAITING_SEARCH_ADDED,
  WAITING_SEARCH_ALREADY_LISTED,
  WAITING_SEARCH_ALREADY_WAITING,
  WAITING_SEARCH_FAILED,
  WAITING_SEARCH_LABEL,
  WAITING_SEARCH_LEGEND,
  WAITING_SEARCH_NO_RESULTS,
  WAITING_SEARCH_SEARCHING,
  WAITING_SEARCH_SUPPRESSED,
  WAITING_SEARCH_UNAVAILABLE,
} from '../copy';
import { ApiError, type TmdbSearchResult } from '../lib/apiClient';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Input } from './ui/Input';
import { CloseIcon, PlusIcon, SearchIcon } from './icons';
import { TitleSearchResults, type TitleSearchResultTestIds } from './TitleSearchResults';

const WAITING_RESULT_TEST_IDS: TitleSearchResultTestIds = {
  list: 'waiting-search-results',
  item: 'waiting-search-result',
  name: 'waiting-search-result-name',
  genres: 'waiting-search-result-genres',
  cast: 'waiting-search-result-cast',
  overview: 'waiting-search-result-overview',
  year: 'waiting-search-result-year',
  type: 'waiting-search-result-type',
  poster: 'waiting-search-result-poster',
  select: () => 'waiting-search-add',
};

export interface WaitingSearchAddProps {
  readonly onSearch: (query: string) => Promise<readonly TmdbSearchResult[]>;
  readonly onAdd: (result: TmdbSearchResult) => Promise<unknown>;
  readonly offline?: boolean;
}

/** Which sentence a refused add earns. Exported for `T-WAIT-019`. */
export function searchAddRefusal(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'WORK_SUPPRESSED') return WAITING_SEARCH_SUPPRESSED;
    if (error.code === 'DUPLICATE_WORK_IDENTITY') {
      return error.details['reason'] === 'already-listed'
        ? WAITING_SEARCH_ALREADY_LISTED
        : WAITING_SEARCH_ALREADY_WAITING;
    }
  }
  return WAITING_SEARCH_FAILED;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'results'; items: readonly TmdbSearchResult[] }
  | { kind: 'unavailable' };

export function WaitingSearchAdd({
  onSearch,
  onAdd,
  offline = false,
}: WaitingSearchAddProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [pending, setPending] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ tone: 'status' | 'alert'; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const headingId = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);

  function search(event: FormEvent): void {
    event.preventDefault();
    const q = query.trim();
    if (q === '') return;
    setOutcome(null);
    setPhase({ kind: 'searching' });
    onSearch(q).then(
      (items) => setPhase({ kind: 'results', items }),
      () => setPhase({ kind: 'unavailable' }),
    );
  }

  function add(result: TmdbSearchResult): void {
    const key = `${result.mediaType}:${String(result.tmdbId)}`;
    setPending(key);
    setOutcome(null);
    onAdd(result).then(
      () => {
        setPending(null);
        setPhase({ kind: 'idle' });
        setQuery('');
        setOpen(false);
        setOutcome({ tone: 'status', text: `${WAITING_SEARCH_ADDED} ${result.name}` });
      },
      (error: unknown) => {
        setPending(null);
        setOutcome({ tone: 'alert', text: searchAddRefusal(error) });
      },
    );
  }

  function close(): void {
    if (pending === null) setOpen(false);
  }

  return (
    <section
      className="waiting-search"
      data-testid="waiting-search"
      aria-label={WAITING_SEARCH_LEGEND}
    >
      <Button
        ref={trigger}
        variant="secondary"
        data-testid="waiting-add-open"
        aria-haspopup="dialog"
        disabled={offline}
        onClick={() => setOpen(true)}
      >
        <PlusIcon />
        <span>{WAITING_ADD_OPEN}</span>
      </Button>
      {open && (
        <Dialog onDismiss={close} returnFocus={trigger} aria-labelledby={headingId}>
          <div className="title-search-head" data-testid="waiting-add-panel">
            <div className="panel-head">
              <h2 id={headingId}>{WAITING_SEARCH_LEGEND}</h2>
              <Button
                variant="ghost"
                aria-label={WAITING_ADD_CLOSE_LABEL}
                data-testid="waiting-add-close"
                disabled={pending !== null}
                onClick={close}
              >
                <CloseIcon />
              </Button>
            </div>
            {/*
              #382 — Library's search field: a rounded field with the search icon as
              its submit. The label stays in the DOM (visually hidden) so the input
              keeps a real accessible name rather than relying on the placeholder.
            */}
            <form className="waiting-search__form" onSubmit={search} role="search">
              <label className="sr-only" htmlFor={inputId}>
                {WAITING_SEARCH_LABEL}
              </label>
              <span className="list-search__control waiting-search__control">
                <Button
                  type="submit"
                  variant="ghost"
                  aria-label={WAITING_SEARCH_ACTION}
                  data-testid="waiting-search-submit"
                  disabled={offline}
                >
                  <SearchIcon />
                </Button>
                <Input
                  id={inputId}
                  type="search"
                  value={query}
                  placeholder={WAITING_SEARCH_LABEL}
                  data-testid="waiting-search-input"
                  data-dialog-initial-focus=""
                  onChange={(event) => setQuery(event.target.value)}
                />
              </span>
            </form>
          </div>

          {phase.kind === 'searching' && <p role="status">{WAITING_SEARCH_SEARCHING}</p>}
          {phase.kind === 'unavailable' && <p role="alert">{WAITING_SEARCH_UNAVAILABLE}</p>}
          {phase.kind === 'results' && phase.items.length === 0 && (
            <p role="status">{WAITING_SEARCH_NO_RESULTS}</p>
          )}
          {phase.kind === 'results' && phase.items.length > 0 && (
            <TitleSearchResults
              results={phase.items}
              onSelect={add}
              actionLabel={WAITING_SEARCH_ADD}
              pendingLabel="Working…"
              pendingKey={pending}
              disabled={offline || pending !== null}
              testIds={WAITING_RESULT_TEST_IDS}
            />
          )}
          {outcome?.tone === 'alert' && (
            <p role="alert" data-testid="waiting-search-outcome">
              {outcome.text}
            </p>
          )}
        </Dialog>
      )}
      {outcome?.tone === 'status' && (
        <p role="status" data-testid="waiting-search-outcome">
          {outcome.text}
        </p>
      )}
    </section>
  );
}
