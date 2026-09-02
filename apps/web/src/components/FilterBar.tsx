// The combined list's filter bar (`specs/ui.md` §2.1 item 2, `specs/api.md`
// §6.2, `specs/ux-states.md` §2.4, TASK-039).
//
// ⚠ THE QUERY STRING IS THE SINGLE SOURCE OF TRUTH FOR FILTERS. There is
// deliberately no `useState` mirror of the selection. `T-UI-016` requires sync
// "in both directions", and the only way to get that reliably is to have one
// direction: render FROM the URL, write TO the URL. A component holding its own
// copy passes a naive round-trip test and then drifts on the back button, on a
// deep link, and on any external `navigate()` — three cases nobody notices
// until the list quietly shows the wrong rows.
//
// ⚠ THE SORT CONTROL IS NOT HERE. `ui.md` §2.1 co-locates it in this row, but
// it is TASK-166 with its own test, and `ui.md` is explicit that sort state is
// held in client-side view state and NOT re-derived from the URL alone — the
// opposite rule to filters. Stubbing it here would report it as shipped and
// bake in the wrong persistence model.

import type { JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SERVICES, type Service } from '@nextup/domain';

import { AT_LEAST_PREFIX, CLEAR_FILTERS_LABEL, ZERO_MATCH_TITLE } from '../copy';

/** `api.md` §6.2 — `type` is `movie|tv`. */
export const MEDIA_TYPES = ['movie', 'tv'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export interface ListFilters {
  /** OR within the dimension (`api.md` §6.2, US-019 AC-4). */
  readonly services: readonly Service[];
  readonly types: readonly MediaType[];
  readonly genres: readonly string[];
}

export const NO_FILTERS: ListFilters = { services: [], types: [], genres: [] };

function isService(value: string): value is Service {
  return (SERVICES as readonly string[]).includes(value);
}

function isMediaType(value: string): value is MediaType {
  return (MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * URL → filters.
 *
 * ⚠ Unknown values are DROPPED, not passed through. A hand-edited
 * `?type=documentary` would otherwise reach the API and come back
 * `400 VALIDATION_FAILED`, turning a typo in a shared link into an error
 * screen. Dropping it shows an unfiltered-on-that-dimension list, which is the
 * honest reading of "no valid type was asked for".
 *
 * ⚠ Genres are NEVER defaulted (`api.md` §6.2, US-019 AC-6) — absent means
 * "every genre", never "the genres this title happens to have".
 */
export function parseFilters(params: URLSearchParams): ListFilters {
  return {
    services: params.getAll('service').filter(isService),
    types: params.getAll('type').filter(isMediaType),
    genres: params.getAll('genre').filter((genre) => genre !== ''),
  };
}

/**
 * Filters → URL, preserving every parameter this bar does not own.
 *
 * ⚠ `sort`/`dir`/`cursor` MUST survive a filter change. Rebuilding the query
 * string from the filters alone silently resets the owner's chosen sort
 * direction the first time they tick a checkbox — and REQ-038's oldest-first
 * control is the one escape hatch from the newest-first default, so dropping
 * it is a real loss, not cosmetic.
 */
export function applyFilters(params: URLSearchParams, filters: ListFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('service');
  next.delete('type');
  next.delete('genre');
  for (const service of filters.services) next.append('service', service);
  for (const type of filters.types) next.append('type', type);
  for (const genre of filters.genres) next.append('genre', genre);
  return next;
}

export function isFiltered(filters: ListFilters): boolean {
  return filters.services.length + filters.types.length + filters.genres.length > 0;
}

/** The chips §2.4 shows alongside the zero-match message, in URL order. */
export function activeFilterChips(filters: ListFilters): readonly string[] {
  return [...filters.services, ...filters.types, ...filters.genres];
}

function toggle<T>(values: readonly T[], value: T): readonly T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export interface FilterBarProps {
  /** Every genre present in the unfiltered list. Never invented here. */
  readonly genres?: readonly string[];
  /** Rows currently shown, for the live count (US-019 AC-5). */
  readonly shown: number;
  /** Rows before filtering. */
  readonly total: number;
  /**
   * `true` when `total` is a LOWER BOUND rather than the count — i.e. the API
   * returned a `nextCursor` and there are more rows than have been fetched.
   *
   * ⚠ THIS EXISTS BECAUSE THE COUNT WAS A LIE. §2.6 says the count reads
   * *"Showing 50 of at least 50"* and that **no total is fabricated** (there
   * is no count query — NFR-018). The bar rendered "Showing 50 of 50" against
   * a live `nextCursor`, telling an owner with 300 titles that they have 50.
   * That is the data-loss misreading US-019 AC-5 exists to prevent, arrived at
   * by arithmetic rather than by an empty state.
   *
   * ⚠ Defaults to `false` — the honest value when the caller knows nothing —
   * so a caller that has genuinely counted its rows is unaffected.
   */
  readonly totalIsLowerBound?: boolean;
}

export function FilterBar({
  genres = [],
  shown,
  total,
  totalIsLowerBound = false,
}: FilterBarProps): JSX.Element {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);

  function update(next: ListFilters): void {
    // `replace: false` — each filter change is a history entry, so Back undoes
    // exactly one choice. This is what makes the URL sync worth having.
    setParams(applyFilters(params, next));
  }

  return (
    <div className="filter-bar" data-testid="filter-bar" role="group" aria-label="Filter the list">
      <fieldset data-testid="filter-service">
        <legend>Service</legend>
        {SERVICES.map((service) => (
          <label key={service}>
            <input
              type="checkbox"
              name="service"
              value={service}
              checked={filters.services.includes(service)}
              onChange={() => {
                update({ ...filters, services: toggle(filters.services, service) });
              }}
            />
            {service}
          </label>
        ))}
      </fieldset>

      <fieldset data-testid="filter-type">
        <legend>Type</legend>
        {MEDIA_TYPES.map((type) => (
          <label key={type}>
            <input
              type="checkbox"
              name="type"
              value={type}
              checked={filters.types.includes(type)}
              onChange={() => {
                update({ ...filters, types: toggle(filters.types, type) });
              }}
            />
            {type}
          </label>
        ))}
      </fieldset>

      {genres.length > 0 && (
        <fieldset data-testid="filter-genre">
          <legend>Genre</legend>
          {genres.map((genre) => (
            <label key={genre}>
              <input
                type="checkbox"
                name="genre"
                value={genre}
                checked={filters.genres.includes(genre)}
                onChange={() => {
                  update({ ...filters, genres: toggle(filters.genres, genre) });
                }}
              />
              {genre}
            </label>
          ))}
        </fieldset>
      )}

      {/*
        Present only when something is filtered: a permanently-visible "Clear
        filters" on an unfiltered list implies filters are active when they are
        not.
      */}
      {isFiltered(filters) && (
        <button
          type="button"
          className="tap-target"
          data-testid="clear-filters"
          onClick={() => {
            update(NO_FILTERS);
          }}
        >
          {CLEAR_FILTERS_LABEL}
        </button>
      )}

      {/*
        `role="status"` so the count is announced when filtering changes it -
        a sighted owner sees the list shrink, a screen-reader user otherwise
        gets no signal at all.
      */}
      <p data-testid="filter-count" role="status">
        {`Showing ${String(shown)} of ${totalIsLowerBound ? AT_LEAST_PREFIX : ''}${String(total)}`}
      </p>
    </div>
  );
}

export interface ZeroMatchProps {
  readonly filters: ListFilters;
  readonly onClear?: () => void;
}

/**
 * `ux-states.md` §2.4 — the zero-match state, and it is NOT the empty state.
 *
 * ⚠ IT MUST NEVER READ AS DATA LOSS (US-019 AC-5). The owner's titles are all
 * still there; a filter is hiding them. Showing §2.3's "Nothing here yet" here
 * would tell someone their library had been wiped by ticking a checkbox, so
 * this carries its own wording, the active filter chips (which name the cause)
 * and the way out.
 */
export function ZeroMatch({ filters, onClear }: ZeroMatchProps): JSX.Element {
  const chips = activeFilterChips(filters);

  return (
    <div data-testid="zero-match">
      <p data-testid="zero-match-title">{ZERO_MATCH_TITLE}</p>
      <ul data-testid="zero-match-chips">
        {chips.map((chip) => (
          <li key={chip} data-testid="zero-match-chip">
            {chip}
          </li>
        ))}
      </ul>
      <button type="button" className="tap-target" data-testid="zero-match-clear" onClick={onClear}>
        {CLEAR_FILTERS_LABEL}
      </button>
    </div>
  );
}
