/**
 * TASK-067 — the manual-entry panel (`specs/api.md` §6.20, US-006 AC-5,
 * `specs/ui.md` §5). `T-UI-028`.
 *
 * ⚠ **THIS IS THE ONLY WAY A TITLE THE READER NEVER SAW REACHES THE LIST.**
 * An artwork-only tile carries no text at all, so `T-AI-041`'s untitled tile
 * has nothing to confirm and nothing to correct. Without this panel the
 * owner's only option is to accept that the title is missing from a list whose
 * whole promise (product invariant 2) is that nothing is lost without asking.
 *
 * ⚠ **THE SEARCH AND THE ADD ARE SEPARATE, AND ADDING IS ALWAYS AN EXPLICIT
 * PRESS.** A panel that added the top hit as you typed would be
 * accept-by-inaction (REQ-014) with a TMDB search standing in for the owner's
 * decision — and the top hit for a two-word query is routinely the wrong work.
 *
 * ⚠ **A FAILED ADD IS REPORTED, NOT SWALLOWED.** The two 409s (`WORK_SUPPRESSED`,
 * `ALREADY_IN_BATCH`) are the two cases where the server refuses on purpose;
 * rendering them as "couldn't add" would leave the owner pressing the same
 * button against a rule they cannot see.
 */

import { useState, type FormEvent, type JSX } from 'react';

import {
  MANUAL_ENTRY_ADD_FAILED,
  MANUAL_ENTRY_ADD_LABEL,
  MANUAL_ENTRY_ADDED,
  MANUAL_ENTRY_ALREADY_IN_BATCH,
  MANUAL_ENTRY_HINT,
  MANUAL_ENTRY_NO_RESULTS,
  MANUAL_ENTRY_SEARCH_BUTTON,
  MANUAL_ENTRY_SEARCH_FAILED,
  MANUAL_ENTRY_SEARCH_LABEL,
  MANUAL_ENTRY_SEARCHING,
  MANUAL_ENTRY_SUPPRESSED,
  MANUAL_ENTRY_TITLE,
} from '../copy';
import type { TmdbSearchResult } from '../lib/apiClient';

export interface ManualEntryPanelProps {
  /** Runs a §6.29 search. Rejects on any failure; the panel says so and stays usable. */
  readonly onSearch: (query: string) => Promise<TmdbSearchResult[]>;
  /**
   * Adds the chosen work to the batch (§6.20). Rejects with an error carrying
   * a `code` for the two deliberate refusals.
   */
  readonly onAdd: (result: TmdbSearchResult) => Promise<void>;
}

/** The server's refusal code, if this rejection carried one. */
function codeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

function addFailureMessage(error: unknown): string {
  const code = codeOf(error);
  if (code === 'WORK_SUPPRESSED') return MANUAL_ENTRY_SUPPRESSED;
  if (code === 'ALREADY_IN_BATCH') return MANUAL_ENTRY_ALREADY_IN_BATCH;
  return MANUAL_ENTRY_ADD_FAILED;
}

/** "Dune (2021)" — the year disambiguates remakes, which is most of the risk here. */
export function resultLabel(result: TmdbSearchResult): string {
  return result.releaseYear === null
    ? result.name
    : `${result.name} (${String(result.releaseYear)})`;
}

export function ManualEntryPanel({ onSearch, onAdd }: ManualEntryPanelProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null);

  const search = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed === '' || searching) return;

    setSearching(true);
    setSearchFailed(false);
    setNotice(null);
    setFailure(null);
    void onSearch(trimmed).then(
      (items) => {
        setResults(items);
        setSearching(false);
      },
      () => {
        // ⚠ The previous results are CLEARED. Leaving them on screen under a
        // failure message would let the owner add a work from a search that is
        // no longer the one they are looking at.
        setResults(null);
        setSearchFailed(true);
        setSearching(false);
      },
    );
  };

  const add = (result: TmdbSearchResult): void => {
    if (adding !== null) return;
    setAdding(result.tmdbId);
    setNotice(null);
    setFailure(null);
    void onAdd(result).then(
      () => {
        setNotice(MANUAL_ENTRY_ADDED.replace('{name}', result.name));
        setAdding(null);
      },
      (error: unknown) => {
        setFailure(addFailureMessage(error));
        setAdding(null);
      },
    );
  };

  return (
    <section className="manual-entry" aria-labelledby="manual-entry-heading">
      <h2 id="manual-entry-heading">{MANUAL_ENTRY_TITLE}</h2>
      <p className="manual-entry__hint">{MANUAL_ENTRY_HINT}</p>

      <form className="manual-entry__form" onSubmit={search}>
        <label htmlFor="manual-entry-query">{MANUAL_ENTRY_SEARCH_LABEL}</label>
        <input
          id="manual-entry-query"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <button type="submit" className="tap-target" disabled={searching}>
          {searching ? MANUAL_ENTRY_SEARCHING : MANUAL_ENTRY_SEARCH_BUTTON}
        </button>
      </form>

      {searchFailed && <p role="alert">{MANUAL_ENTRY_SEARCH_FAILED}</p>}
      {results !== null && results.length === 0 && <p>{MANUAL_ENTRY_NO_RESULTS}</p>}

      {results !== null && results.length > 0 && (
        <ul className="manual-entry__results">
          {results.map((result) => (
            <li
              key={`${result.mediaType}:${String(result.tmdbId)}`}
              className="manual-entry__result"
            >
              <span>{resultLabel(result)}</span>
              <button
                type="button"
                className="tap-target"
                disabled={adding !== null}
                onClick={() => {
                  add(result);
                }}
              >
                {MANUAL_ENTRY_ADD_LABEL.replace('{name}', result.name)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {notice !== null && <p role="status">{notice}</p>}
      {failure !== null && <p role="alert">{failure}</p>}
    </section>
  );
}
