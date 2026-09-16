import { Input } from './ui/Input';
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

import { useState, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { FilterDisclosure } from './FilterDisclosure';
import {
  RUNTIME_BUCKETS,
  SERVICES,
  SERVICE_LABELS,
  isRuntimeBucket,
  type RuntimeBucket,
  type Service,
} from '@nextup/domain';

import {
  AT_LEAST_PREFIX,
  CLEAR_FILTERS_LABEL,
  RUNTIME_BUCKET_LABELS,
  ZERO_MATCH_TITLE,
  runtimeUnknownHiddenLabel,
} from '../copy';

/** `api.md` §6.2 — `type` is `movie|tv`. */
export const MEDIA_TYPES = ['movie', 'tv'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
const MEDIA_TYPE_LABELS: Record<MediaType, string> = { movie: 'Movies', tv: 'TV series' };

export interface ListFilters {
  /** OR within the dimension (`api.md` §6.2, US-019 AC-4). */
  readonly services: readonly Service[];
  readonly types: readonly MediaType[];
  readonly genres: readonly string[];
  /** REQ-035 — bucket tokens, OR'd within the dimension like the rest. */
  readonly runtimes: readonly RuntimeBucket[];
}

export const NO_FILTERS: ListFilters = { services: [], types: [], genres: [], runtimes: [] };

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
    runtimes: params.getAll('runtime').filter(isRuntimeBucket),
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
  next.delete('runtime');
  for (const service of filters.services) next.append('service', service);
  for (const type of filters.types) next.append('type', type);
  for (const genre of filters.genres) next.append('genre', genre);
  for (const runtime of filters.runtimes) next.append('runtime', runtime);
  return next;
}

export function isFiltered(filters: ListFilters): boolean {
  return (
    filters.services.length +
      filters.types.length +
      filters.genres.length +
      filters.runtimes.length >
    0
  );
}

/** The chips §2.4 shows alongside the zero-match message, in URL order. */
export function activeFilterChips(filters: ListFilters): readonly string[] {
  return [
    ...filters.services.map((service) => SERVICE_LABELS[service]),
    ...filters.types.map((type) => MEDIA_TYPE_LABELS[type]),
    ...filters.genres,
    // Named, not tokenised: a chip reading `60-120` states the cause of an
    // empty list in a vocabulary the owner never chose it in.
    ...filters.runtimes.map((bucket) => RUNTIME_BUCKET_LABELS[bucket]),
  ];
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
  /**
   * REQ-035 (`T-UX-124`) — how many titles the runtime filter is hiding
   * because they have no runtime at all. `null` when no runtime filter is
   * active, and `0` when one is and nothing was hidden.
   *
   * ⚠ THIS NUMBER COMES FROM THE SERVER AND CANNOT BE COMPUTED HERE. The
   * client has, by definition, not been sent the rows that were excluded, so
   * any count taken over `items` is a count of what survived the filter — it
   * would render `0` on every list, look right in every fixture, and never be
   * true.
   *
   * ⚠ `null` AND `0` ARE DIFFERENT STATES and must not be collapsed to a
   * falsy check that happens to hide both. They agree today (neither renders)
   * but they mean "not asked" and "asked, none hidden"; merging them loses the
   * ability to tell a filter that hid nothing from a filter that was never
   * applied.
   */
  readonly runtimeUnknownHidden?: number | null;
  readonly countPending?: boolean;
}

export function FilterBar({
  genres = [],
  shown,
  total,
  totalIsLowerBound = false,
  runtimeUnknownHidden = null,
  countPending = false,
}: FilterBarProps): JSX.Element {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const genreOptions = [...new Set([...genres, ...filters.genres])];
  const [serviceQuery, setServiceQuery] = useState('');
  const services = SERVICES.filter((service) =>
    SERVICE_LABELS[service].toLowerCase().includes(serviceQuery.trim().toLowerCase()),
  );
  const query = params.get('q') ?? '';
  const chips = [
    ...filters.services.map((value) => ({
      dimension: 'service',
      value,
      label: SERVICE_LABELS[value],
    })),
    ...filters.types.map((value) => ({
      dimension: 'type',
      value,
      label: MEDIA_TYPE_LABELS[value],
    })),
    ...filters.genres.map((value) => ({ dimension: 'genre', value, label: value })),
    ...filters.runtimes.map((value) => ({
      dimension: 'runtime',
      value,
      label: RUNTIME_BUCKET_LABELS[value],
    })),
    ...(query ? [{ dimension: 'q', value: query, label: `Search: ${query}` }] : []),
  ];

  function removeChip(dimension: string, value: string): void {
    const next = new URLSearchParams(params);
    if (dimension === 'q') next.delete('q');
    else next.delete(dimension, value);
    setParams(next);
  }

  function update(next: ListFilters): void {
    // `replace: false` — each filter change is a history entry, so Back undoes
    // exactly one choice. This is what makes the URL sync worth having.
    setParams(applyFilters(params, next));
  }

  return (
    <div className="filter-bar" data-testid="filter-bar" role="group" aria-label="Filter the list">
      <div className="filter-controls">
        <FilterDisclosure label="Services">
          <Field label="Search services">
            {(control) => (
              <Input
                {...control}
                type="search"
                value={serviceQuery}
                onChange={(event) => {
                  setServiceQuery(event.target.value);
                }}
              />
            )}
          </Field>
          <Field legend="Services" testId="filter-service">
            {services.map((service) => (
              <label key={service}>
                <Input
                  type="checkbox"
                  name="service"
                  value={service}
                  checked={filters.services.includes(service)}
                  onChange={() => {
                    update({ ...filters, services: toggle(filters.services, service) });
                  }}
                />
                {SERVICE_LABELS[service]}
              </label>
            ))}
          </Field>
          {services.length === 0 && <p role="status">No services match your search.</p>}
        </FilterDisclosure>

        <FilterDisclosure label="Type">
          <Field legend="Type" testId="filter-type">
            {MEDIA_TYPES.map((type) => (
              <label key={type}>
                <Input
                  type="checkbox"
                  name="type"
                  value={type}
                  checked={filters.types.includes(type)}
                  onChange={() => {
                    update({ ...filters, types: toggle(filters.types, type) });
                  }}
                />
                {MEDIA_TYPE_LABELS[type]}
              </label>
            ))}
          </Field>
        </FilterDisclosure>

        {genreOptions.length > 0 && (
          <FilterDisclosure label="Genre">
            <Field legend="Genre" testId="filter-genre">
              {genreOptions.map((genre) => (
                <label key={genre}>
                  <Input
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
            </Field>
          </FilterDisclosure>
        )}

        {/*
        REQ-035 — the runtime buckets. ALWAYS PRESENT, unlike the genre
        fieldset above, which is conditional on the list actually containing
        genres. The bucket set is fixed by `RUNTIME_BUCKET_BOUNDS` rather than
        derived from the data, so hiding it when no title happens to have a
        runtime would remove the only control that explains why the list is
        the length it is.
      */}
        <FilterDisclosure label="Runtime">
          <Field legend="Runtime" testId="filter-runtime">
            {RUNTIME_BUCKETS.map((bucket) => (
              <label key={bucket}>
                <Input
                  type="checkbox"
                  name="runtime"
                  value={bucket}
                  checked={filters.runtimes.includes(bucket)}
                  onChange={() => {
                    update({ ...filters, runtimes: toggle(filters.runtimes, bucket) });
                  }}
                />
                {RUNTIME_BUCKET_LABELS[bucket]}
              </label>
            ))}
          </Field>
        </FilterDisclosure>
      </div>

      {chips.length > 0 && (
        <ul className="active-filters" aria-label="Active filters">
          {chips
            .filter(
              (chip, index) =>
                chips.findIndex(
                  (other) => other.dimension === chip.dimension && other.value === chip.value,
                ) === index,
            )
            .map((chip) => (
              <li className="active-filter" key={`${chip.dimension}:${chip.value}`}>
                <Button
                  aria-label={`Remove ${chip.dimension === 'q' ? 'search' : chip.dimension} filter: ${chip.label}`}
                  onClick={() => {
                    removeChip(chip.dimension, chip.value);
                  }}
                >
                  {chip.label} <span aria-hidden="true">×</span>
                </Button>
              </li>
            ))}
        </ul>
      )}

      {/*
        Present only when something is filtered: a permanently-visible "Clear
        filters" on an unfiltered list implies filters are active when they are
        not.
      */}
      {(isFiltered(filters) || query !== '') && (
        <Button
          variant="secondary"
          data-testid="clear-filters"
          onClick={() => {
            const next = applyFilters(params, NO_FILTERS);
            next.delete('q');
            setParams(next);
          }}
        >
          {CLEAR_FILTERS_LABEL}
        </Button>
      )}

      {/*
        `role="status"` so the count is announced when filtering changes it -
        a sighted owner sees the list shrink, a screen-reader user otherwise
        gets no signal at all.
      */}
      {!countPending && (
        <p data-testid="filter-count" role="status">
          {`Showing ${String(shown)} of ${totalIsLowerBound ? AT_LEAST_PREFIX : ''}${String(total)}`}
        </p>
      )}

      {/*
        REQ-035 (`T-UX-124`) — PRODUCT INVARIANT 2 IN A NEW PLACE: nothing
        leaves the owner's list without telling them. A runtime filter drops
        every title TMDB never supplied a runtime for; without this line the
        list simply gets shorter and nothing accounts for the difference.

        ⚠ `> 0`, NOT TRUTHINESS — and the distinction is deliberate. `0` means
        the filter is active and hid nothing, which is worth NOT saying (a
        standing "0 titles are hidden" is noise); `null` means no runtime
        filter is active at all. Both render nothing here, but they are
        different facts and the condition names which one it is testing.

        `role="status"` for the same reason the count above has it: a sighted
        owner sees the list shrink, a screen-reader user gets no other signal.
      */}
      {!countPending && runtimeUnknownHidden !== null && runtimeUnknownHidden > 0 && (
        <p data-testid="runtime-unknown-hidden" role="status">
          {runtimeUnknownHiddenLabel(runtimeUnknownHidden)}
        </p>
      )}
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
        {chips.map((chip, index) => (
          <li key={`${String(index)}:${chip}`} data-testid="zero-match-chip">
            {chip}
          </li>
        ))}
      </ul>
      <Button variant="secondary" data-testid="zero-match-clear" onClick={onClear}>
        {CLEAR_FILTERS_LABEL}
      </Button>
    </div>
  );
}
