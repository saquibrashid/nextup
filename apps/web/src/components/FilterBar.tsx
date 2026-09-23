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

import { useCallback, useId, useState, type JSX, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { CloseIcon } from './icons';
import { Field } from './ui/Field';
import { FilterDisclosure } from './FilterDisclosure';
import {
  RUNTIME_BUCKETS,
  WATCH_PRIORITIES,
  SERVICES,
  SERVICE_LABELS,
  normalizeRuntimeBuckets,
  type RuntimeBucket,
  type Service,
  type WatchPriority,
} from '@nextup/domain';

import {
  AT_LEAST_PREFIX,
  CLEAR_FILTERS_LABEL,
  FILTERS_CLOSE_LABEL,
  FILTERS_DONE_LABEL,
  FILTERS_PANEL_TITLE,
  FILTERS_TRIGGER_LABEL,
  RUNTIME_BUCKET_LABELS,
  ZERO_MATCH_TITLE,
  WATCH_PRIORITY_LABELS,
  runtimeUnknownHiddenLabel,
} from '../copy';
import { ServiceMark } from './ServiceMark';

/** `api.md` §6.2 — `type` is `movie|tv`. */
export const MEDIA_TYPES = ['movie', 'tv'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
const MEDIA_TYPE_LABELS: Record<MediaType, string> = { movie: 'Movies', tv: 'TV series' };

export interface ListFilters {
  readonly watching?: boolean | undefined;
  readonly priorities?: readonly WatchPriority[] | undefined;
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
  const watching = params.get('watching');
  const priorities = [...new Set(params.getAll('priority'))].filter(
    (value): value is WatchPriority => (WATCH_PRIORITIES as readonly string[]).includes(value),
  );
  return {
    ...(watching === 'true' || watching === 'false' ? { watching: watching === 'true' } : {}),
    ...(priorities.length > 0 ? { priorities } : {}),
    services: params.getAll('service').filter(isService),
    types: params.getAll('type').filter(isMediaType),
    genres: params.getAll('genre').filter((genre) => genre !== ''),
    runtimes: normalizeRuntimeBuckets(params.getAll('runtime')),
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
  next.delete('watching');
  next.delete('priority');
  if (filters.watching !== undefined) next.set('watching', String(filters.watching));
  for (const priority of filters.priorities ?? []) next.append('priority', priority);
  for (const service of filters.services) next.append('service', service);
  for (const type of filters.types) next.append('type', type);
  for (const genre of filters.genres) next.append('genre', genre);
  for (const runtime of filters.runtimes) next.append('runtime', runtime);
  return next;
}

export function isFiltered(filters: ListFilters): boolean {
  return (
    filters.watching !== undefined ||
    (filters.priorities?.length ?? 0) > 0 ||
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
    ...(filters.watching === undefined ? [] : [filters.watching ? 'Watching' : 'Not watching']),
    ...(filters.priorities ?? []).map((priority) => WATCH_PRIORITY_LABELS[priority]),
    ...filters.services.map((service) => SERVICE_LABELS[service]),
    ...filters.types.map((type) => MEDIA_TYPE_LABELS[type]),
    ...filters.genres,
    // Named, not tokenised: a chip reading `60-90` states the cause of an
    // empty list in a vocabulary the owner never chose it in.
    ...filters.runtimes.map((bucket) => RUNTIME_BUCKET_LABELS[bucket]),
  ];
}

function toggle<T>(values: readonly T[], value: T): readonly T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function selectionSummary(labels: readonly string[], emptyLabel: string): string {
  const selected = [...new Set(labels)];
  return selected.length > 1 ? `${String(selected.length)} selected` : (selected[0] ?? emptyLabel);
}

export interface FilterBarProps {
  readonly inline?: boolean;
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
  inline = false,
  genres = [],
  shown,
  total,
  totalIsLowerBound = false,
  runtimeUnknownHidden = null,
  countPending = false,
}: FilterBarProps): JSX.Element {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  const filters = parseFilters(params);
  const genreOptions = [...new Set([...genres, ...filters.genres])];
  const [serviceQuery, setServiceQuery] = useState('');
  const services = SERVICES.filter((service) =>
    SERVICE_LABELS[service].toLowerCase().includes(serviceQuery.trim().toLowerCase()),
  );
  const query = params.get('q') ?? '';
  const chips = [
    ...(filters.watching === undefined
      ? []
      : [
          {
            dimension: 'watching',
            value: String(filters.watching),
            label: filters.watching ? 'Watching' : 'Not watching',
          },
        ]),
    ...(filters.priorities ?? []).map((value) => ({
      dimension: 'priority',
      value,
      label: WATCH_PRIORITY_LABELS[value],
    })),
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

  /*
   * ⚠ THE SEARCH CHIP IS DELIBERATELY NOT COUNTED. `q` has its own control on
   * the toolbar and its own chip; counting it here would put a "1" on the
   * Filters button for a list that has no filter applied, and send the owner
   * into the panel looking for something that is not in it.
   */
  const activeCount = new Set(
    chips.filter((chip) => chip.dimension !== 'q').map((chip) => `${chip.dimension}:${chip.value}`),
  ).size;

  function removeChip(dimension: string, value: string): void {
    const next = new URLSearchParams(params);
    if (dimension === 'q') next.delete('q');
    else if (dimension === 'runtime') {
      // A legacy range may supply two chips; rewrite it so removing one sticks.
      next.delete('runtime');
      for (const bucket of filters.runtimes) {
        if (bucket !== value) next.append('runtime', bucket);
      }
    } else next.delete(dimension, value);
    setParams(next);
  }

  function update(next: ListFilters): void {
    // `replace: false` — each filter change is a history entry, so Back undoes
    // exactly one choice. This is what makes the URL sync worth having.
    setParams(applyFilters(params, next));
  }

  return (
    /*
      Owner-reported 2026-09-17: on a phone the trigger, the result count, the
      sort chooser and the reverse button each took a line of their own.
      ⚠ THREE SIBLINGS, NOT ONE WRAPPER, AND THAT IS THE WHOLE POINT. The
      toolbar is a grid owned by `.list-controls`, and a grid can only place
      ITS OWN children — while the count lived inside `.filter-bar` no CSS
      could put it on the same line as the sort control, and no amount of
      flex-shrink helped because the two were separate flex items that wrap as
      whole boxes. Splitting the count and the chips out makes them grid items
      in their own right: the count shares the toolbar line, the chips take a
      full-width line below it.
      ⚠ The `role="group"` and the `filter-bar` test id stay on the TRIGGER,
      which is the control the group names. The chips and the count are not
      controls of the filter — they are the report of what it did — and they
      deliberately stay OUTSIDE the panel (see below).
    */
    <>
      <div
        className="filter-bar"
        data-inline={inline || undefined}
        hidden={inline}
        data-testid={inline ? undefined : 'filter-bar'}
        role="group"
        aria-label={inline ? 'Quick filters' : 'Filter the list'}
      >
        {/*
        Owner-approved 2026-09-17 (`specs/ui.md` §2.1 item 2) — the six fields
        moved into a panel. ⚠ THE COUNT ON THE TRIGGER IS NOT DECORATION: with
        the panel shut it is the only thing that says the list is filtered at
        all, and "why is this title missing" is answered by that number. The
        chips and the live result count deliberately stay OUTSIDE the panel for
        the same reason — a count you can only see inside the control that
        changes it is not a count.
      */}
        {!inline && (
          <Button
            aria-haspopup="dialog"
            aria-expanded={open}
            data-testid="filters-trigger"
            onClick={() => {
              setOpen(true);
            }}
          >
            <span>{FILTERS_TRIGGER_LABEL}</span>
            {activeCount > 0 && (
              <span className="filter-bar__count" aria-label={`${String(activeCount)} active`}>
                {activeCount}
              </span>
            )}
          </Button>
        )}
        {(open || inline) && (
          <FilterPanel inline={inline} headingId={headingId} close={close}>
            {!inline && (
              <div className="panel-head">
                <h2 id={headingId}>{FILTERS_PANEL_TITLE}</h2>
                <Button variant="ghost" aria-label={FILTERS_CLOSE_LABEL} onClick={close}>
                  <CloseIcon />
                </Button>
              </div>
            )}
            <Field legend="Filter by">
              <div className="filter-controls">
                <FilterDisclosure
                  label="Services"
                  value={selectionSummary(
                    filters.services.map((service) => SERVICE_LABELS[service]),
                    'All services',
                  )}
                >
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

                <FilterDisclosure
                  label="Type"
                  value={selectionSummary(
                    filters.types.map((type) => MEDIA_TYPE_LABELS[type]),
                    'All types',
                  )}
                >
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
                  <FilterDisclosure
                    label="Genre"
                    value={selectionSummary(filters.genres, 'All genres')}
                  >
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
                <FilterDisclosure
                  label="Runtime"
                  value={selectionSummary(
                    filters.runtimes.map((bucket) => RUNTIME_BUCKET_LABELS[bucket]),
                    'Any runtime',
                  )}
                >
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
                <FilterDisclosure
                  label="Watching"
                  value={
                    filters.watching === undefined
                      ? 'All titles'
                      : filters.watching
                        ? 'Watching'
                        : 'Not watching'
                  }
                >
                  <Field legend="Watching">
                    {[
                      { value: undefined, label: 'All titles' },
                      { value: true, label: 'Watching' },
                      { value: false, label: 'Not watching' },
                    ].map((option) => (
                      <label key={option.label}>
                        <Input
                          type="radio"
                          name="watching"
                          checked={filters.watching === option.value}
                          onChange={() => update({ ...filters, watching: option.value })}
                        />
                        {option.label}
                      </label>
                    ))}
                  </Field>
                </FilterDisclosure>
                <FilterDisclosure
                  label="Priority"
                  value={selectionSummary(
                    (filters.priorities ?? []).map((value) => WATCH_PRIORITY_LABELS[value]),
                    'All priorities',
                  )}
                >
                  <Field legend="Priority">
                    {WATCH_PRIORITIES.map((value) => (
                      <label key={value}>
                        <Input
                          type="checkbox"
                          name="priority"
                          value={value}
                          checked={filters.priorities?.includes(value) ?? false}
                          onChange={() =>
                            update({
                              ...filters,
                              priorities: toggle(filters.priorities ?? [], value),
                            })
                          }
                        />
                        {WATCH_PRIORITY_LABELS[value]}
                      </label>
                    ))}
                  </Field>
                </FilterDisclosure>
              </div>
            </Field>
            {!inline && (
              <div className="panel-foot">
                <Button variant="primary" onClick={close}>
                  {FILTERS_DONE_LABEL}
                </Button>
              </div>
            )}
          </FilterPanel>
        )}
      </div>

      {!inline && (
        <div
          className="service-filters"
          role="group"
          aria-label="Filter by streaming service"
          onFocus={(event) =>
            event.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
          }
        >
          <Button
            variant="secondary"
            aria-pressed={filters.services.length === 0}
            onClick={() => update({ ...filters, services: [] })}
          >
            All services
          </Button>
          {SERVICES.map((service) => (
            <Button
              key={service}
              variant="secondary"
              aria-pressed={filters.services.includes(service)}
              onClick={() => update({ ...filters, services: toggle(filters.services, service) })}
            >
              <ServiceMark service={service} />
            </Button>
          ))}
        </div>
      )}

      {!inline && (chips.length > 0 || isFiltered(filters) || query !== '') && (
        <div className="filter-bar__chips">
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
        </div>
      )}

      {!inline && !countPending && (
        <div className="filter-bar__status">
          {/*
        `role="status"` so the count is announced when filtering changes it -
        a sighted owner sees the list shrink, a screen-reader user otherwise
        gets no signal at all.
      */}
          <p data-testid="filter-count" role="status">
            {`Showing ${String(shown)} of ${totalIsLowerBound ? AT_LEAST_PREFIX : ''}${String(total)}`}
          </p>

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
      )}
    </>
  );
}

function FilterPanel({
  inline,
  headingId,
  close,
  children,
}: {
  readonly inline: boolean;
  readonly headingId: string;
  readonly close: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  return inline ? (
    <>{children}</>
  ) : (
    <Dialog variant="panel" aria-labelledby={headingId} onDismiss={close}>
      {children}
    </Dialog>
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
