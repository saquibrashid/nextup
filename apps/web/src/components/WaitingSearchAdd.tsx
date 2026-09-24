// Search-to-add on `/waiting` (#378, owner decision 2).
//
// ⚠ **THIS NEVER TOUCHES THE COMBINED LIST.** `POST /api/waiting` records a
// `WatchIntent` with `discoverySource: 'search'` and no batch; the combined
// list is still entered only by a capture (US-042 AC-3). The button therefore
// says "Wait for it", never "Add".
//
// ⚠ A refusal is an ANSWER, not a failure. "Already waiting", "already in
// your library" and "not interested" each say which fact stopped it, so the
// owner is never left wondering whether pressing again would help.

import { useId, useState, type FormEvent, type JSX } from 'react';

import {
  WAITING_SEARCH_ACTION,
  WAITING_SEARCH_ADD,
  WAITING_SEARCH_ADDED,
  WAITING_SEARCH_ALREADY_LISTED,
  WAITING_SEARCH_ALREADY_WAITING,
  WAITING_SEARCH_FAILED,
  WAITING_SEARCH_HINT,
  WAITING_SEARCH_LABEL,
  WAITING_SEARCH_LEGEND,
  WAITING_SEARCH_NO_RESULTS,
  WAITING_SEARCH_SEARCHING,
  WAITING_SEARCH_SUPPRESSED,
  WAITING_SEARCH_UNAVAILABLE,
} from '../copy';
import { ApiError, type TmdbSearchResult } from '../lib/apiClient';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

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
  const inputId = useId();
  const hintId = useId();

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
        setOutcome({ tone: 'status', text: `${WAITING_SEARCH_ADDED} ${result.name}` });
      },
      (error: unknown) => {
        setPending(null);
        setOutcome({ tone: 'alert', text: searchAddRefusal(error) });
      },
    );
  }

  return (
    <section
      className="waiting-search"
      data-testid="waiting-search"
      aria-label={WAITING_SEARCH_LEGEND}
    >
      <h2>{WAITING_SEARCH_LEGEND}</h2>
      <p id={hintId}>{WAITING_SEARCH_HINT}</p>
      <form className="waiting-search__form" onSubmit={search} role="search">
        <label htmlFor={inputId}>{WAITING_SEARCH_LABEL}</label>
        <Input
          id={inputId}
          type="search"
          value={query}
          aria-describedby={hintId}
          data-testid="waiting-search-input"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" data-testid="waiting-search-submit" disabled={offline}>
          {WAITING_SEARCH_ACTION}
        </Button>
      </form>

      {phase.kind === 'searching' && <p role="status">{WAITING_SEARCH_SEARCHING}</p>}
      {phase.kind === 'unavailable' && <p role="alert">{WAITING_SEARCH_UNAVAILABLE}</p>}
      {phase.kind === 'results' && phase.items.length === 0 && (
        <p role="status">{WAITING_SEARCH_NO_RESULTS}</p>
      )}
      {phase.kind === 'results' && phase.items.length > 0 && (
        <ul className="waiting-search__results" data-testid="waiting-search-results">
          {phase.items.map((item) => {
            const key = `${item.mediaType}:${String(item.tmdbId)}`;
            return (
              <li key={key} className="waiting-search__result" data-testid="waiting-search-result">
                <span>
                  {item.name}
                  {item.releaseYear !== null && ` (${String(item.releaseYear)})`}
                </span>
                <Button
                  data-testid="waiting-search-add"
                  disabled={offline || pending !== null}
                  onClick={() => add(item)}
                >
                  {pending === key ? 'Working…' : WAITING_SEARCH_ADD}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {outcome !== null && (
        <p role={outcome.tone} data-testid="waiting-search-outcome">
          {outcome.text}
        </p>
      )}
    </section>
  );
}
