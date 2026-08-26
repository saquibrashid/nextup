// `/rating` - look up any title's IMDb rating (REQ-092, US-045, ADR-0011).
//
// ⚠ THIS SCREEN WRITES NOTHING, AND SAYS SO. That is the entire point of
// US-045: the owner wants to check something they heard about WITHOUT it
// landing on their list. The API route is read-only (`T-IMDB-006h` asserts
// that against its source), and this page must never grow an "Add to list"
// button - there is no capture path except a screenshot batch (REQ-001), and
// a button here would create a second one.
//
// ⚠ THE LOOKUP IS INJECTED SO THE TEST CAN DRIVE EVERY STATE. The default is
// the shared client (REQ-097, `T-DATA-001`); it was a bare `fetch` here until
// TASK-175, which is exactly the duplication REQ-097 exists to prevent — that
// copy predated the client and knew nothing of the 401 redirect rule, so an
// expired session on this screen showed a lookup failure instead of sending
// the owner to sign in.

import { useState, type FormEvent, type JSX } from 'react';

import { apiClient } from '../lib/apiClient';

import {
  IMDB_LOOKUP_BODY,
  IMDB_LOOKUP_FAILED,
  IMDB_LOOKUP_INPUT_LABEL,
  IMDB_LOOKUP_IN_LIST,
  IMDB_LOOKUP_NOT_FOUND,
  IMDB_LOOKUP_SUBMIT_LABEL,
  IMDB_LOOKUP_TITLE,
  IMDB_RATING_ABSENT,
  IMDB_RATING_SOURCE,
} from '../copy';

export interface RatingLookupResult {
  readonly name: string;
  readonly releaseYear: number | null;
  readonly mediaType: string;
  readonly imdbRating: number | null;
  readonly inList: boolean;
}

/** Resolves to `null` for "TMDB knows nothing of that", and rejects for a failure. */
export type RatingLookupFn = (query: string) => Promise<RatingLookupResult | null>;

async function defaultLookup(query: string): Promise<RatingLookupResult | null> {
  // 404-is-a-result now lives in the client, so every future caller of the
  // lookup inherits it rather than re-deciding it.
  return apiClient.lookupImdb(query);
}

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'found'; readonly result: RatingLookupResult }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed' };

export interface RatingLookupPageProps {
  readonly lookup?: RatingLookupFn;
}

export function RatingLookupPage({
  lookup = defaultLookup,
}: RatingLookupPageProps = {}): JSX.Element {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = query.trim();
    // An empty query is not an error to report; there is simply nothing to ask.
    if (trimmed === '') return;

    setState({ kind: 'loading' });
    try {
      const result = await lookup(trimmed);
      setState(result === null ? { kind: 'not-found' } : { kind: 'found', result });
    } catch {
      // The upstream text never reaches the owner: it can carry the request
      // URL, and that URL carries an API key.
      setState({ kind: 'failed' });
    }
  }

  return (
    <section data-testid="rating-lookup">
      <h1>{IMDB_LOOKUP_TITLE}</h1>
      {/*
        Stated up front, not after the result. The promise that nothing is
        written is the reason the owner would use this screen at all.
      */}
      <p data-testid="rating-lookup-body">{IMDB_LOOKUP_BODY}</p>

      <form
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <label htmlFor="rating-lookup-input">{IMDB_LOOKUP_INPUT_LABEL}</label>
        <input
          id="rating-lookup-input"
          data-testid="rating-lookup-input"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="submit"
          className="tap-target"
          data-testid="rating-lookup-submit"
          disabled={state.kind === 'loading'}
        >
          {IMDB_LOOKUP_SUBMIT_LABEL}
        </button>
      </form>

      {state.kind === 'not-found' && (
        // US-045 AC-3 - reported plainly, and NOT as a found work with no
        // rating. Those are different answers, and conflating them tells the
        // owner a film exists when it does not.
        <p data-testid="rating-lookup-not-found">{IMDB_LOOKUP_NOT_FOUND}</p>
      )}

      {state.kind === 'failed' && <p data-testid="rating-lookup-failed">{IMDB_LOOKUP_FAILED}</p>}

      {state.kind === 'found' && (
        <div data-testid="rating-lookup-result">
          <h2 data-testid="rating-lookup-name">
            {state.result.name}
            {state.result.releaseYear !== null && ` (${state.result.releaseYear})`}
          </h2>

          {/* REQ-091, identical rule to the list row: never 0, never blank. */}
          {state.result.imdbRating == null ? (
            <p data-testid="rating-lookup-absent">{IMDB_RATING_ABSENT}</p>
          ) : (
            <p data-testid="rating-lookup-rating">
              {IMDB_RATING_SOURCE} {state.result.imdbRating.toFixed(1)}
            </p>
          )}

          {/* US-045 AC-4 - so the owner is not shown a title they already have
              as though it were something new. */}
          {state.result.inList && <p data-testid="rating-lookup-in-list">{IMDB_LOOKUP_IN_LIST}</p>}
        </div>
      )}
    </section>
  );
}
