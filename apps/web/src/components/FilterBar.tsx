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

import {
  useCallback,
  useEffect,
  useId,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { CloseIcon, FilterIcon } from './icons';
import { Field } from './ui/Field';
import { FilterDisclosure } from './FilterDisclosure';
import {
  RUNTIME_RANGE_LAST_STOP,
  WATCH_PRIORITIES,
  WATCH_STATUSES,
  SERVICES,
  TITLE_CATEGORIES,
  TITLE_CATEGORY_LABELS,
  isTitleCategory,
  type TitleCategory,
  SERVICE_LABELS,
  moveRuntimeRangeHandle,
  normalizeRuntimeBuckets,
  runtimeBucketsForRange,
  runtimeRangeFromBuckets,
  type RuntimeBucket,
  type Service,
  type WatchPriority,
  type WatchStatus,
} from '@nextup/domain';

import {
  AT_LEAST_PREFIX,
  CLEAR_FILTERS_LABEL,
  FILTERS_CLOSE_LABEL,
  FILTERS_DONE_LABEL,
  FILTERS_PANEL_TITLE,
  FILTERS_RESET_LABEL,
  FILTERS_SHEET_TITLE,
  FILTERS_TRIGGER_LABEL,
  SERVICE_FILTER_ALL_SHORT,
  SHOW_TITLES_PENDING,
  showTitlesLabel,
  RUNTIME_BUCKET_LABELS,
  RUNTIME_RANGE_MAX_CLAMPED,
  RUNTIME_RANGE_MAX_LABEL,
  RUNTIME_RANGE_MAX_NAME,
  RUNTIME_RANGE_MIN_CLAMPED,
  RUNTIME_RANGE_MIN_LABEL,
  RUNTIME_RANGE_MIN_NAME,
  RUNTIME_RANGE_STOP_LABELS,
  RUNTIME_RANGE_STOP_SPOKEN,
  ZERO_MATCH_TITLE,
  WATCH_PRIORITY_LABELS,
  WATCH_STATUS_LABELS,
  runtimeRangeGapNotice,
  runtimeRangeSummary,
  runtimeUnknownHiddenLabel,
} from '../copy';
import { ServiceMark } from './ServiceMark';
import { RangeSlider } from './ui/RangeSlider';
import type { LibraryCommand } from '../lib/libraryCommand';

/** TASK-255 — how many genres the phone sheet shows before its More chip. */
export const PHONE_GENRE_LIMIT = 8;

/** `api.md` §6.2 — `type` is `movie|tv`. */
export const MEDIA_TYPES = ['movie', 'tv'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
const MEDIA_TYPE_LABELS: Record<MediaType, string> = { movie: 'Movies', tv: 'TV series' };

export interface ListFilters {
  readonly categories?: readonly TitleCategory[];
  readonly watching?: boolean | undefined;
  readonly priorities?: readonly WatchPriority[] | undefined;
  /**
   * The unified status filter, OR'd within the dimension (`api.md` §6.2
   * `status`). The legacy `watching`/`priority` pair above is still read so an
   * old link keeps working, but the panel only ever writes this.
   */
  readonly statuses?: readonly WatchStatus[] | undefined;
  /** OR within the dimension (`api.md` §6.2, US-019 AC-4). */
  readonly services: readonly Service[];
  readonly types: readonly MediaType[];
  readonly genres: readonly string[];
  /** REQ-035 — bucket tokens, OR'd within the dimension like the rest. */
  readonly runtimes: readonly RuntimeBucket[];
}

export const NO_FILTERS: ListFilters = { services: [], types: [], genres: [], runtimes: [] };

function isWatchStatus(value: string): value is WatchStatus {
  return (WATCH_STATUSES as readonly string[]).includes(value);
}

function statusChips(filters: ListFilters) {
  const statuses = (filters.statuses ?? []).map((value) => ({
    dimension: 'status',
    value,
    label: WATCH_STATUS_LABELS[value],
  }));
  return [...statuses, ...legacyStatusChips(filters)];
}

/** The pre-`status` links: one status as `watching`/`priority`, or a custom AND. */
function legacyStatusChips(filters: ListFilters) {
  const priorities = filters.priorities ?? [];
  if (filters.watching === true && priorities.length === 0) {
    return [{ dimension: 'status', value: 'watching', label: WATCH_STATUS_LABELS.watching }];
  }
  if (filters.watching === false && priorities.length === 1) {
    return priorities.map((value) => ({
      dimension: 'status',
      value,
      label: WATCH_STATUS_LABELS[value],
    }));
  }
  return [
    ...(filters.watching === undefined
      ? []
      : [
          {
            dimension: 'watching',
            value: String(filters.watching),
            label: filters.watching ? 'Watching' : 'Not watching',
          },
        ]),
    ...priorities.map((value) => ({
      dimension: 'priority',
      value,
      label: WATCH_PRIORITY_LABELS[value],
    })),
  ];
}

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
  const statuses = [...new Set(params.getAll('status'))].filter(isWatchStatus);
  return {
    ...(watching === 'true' || watching === 'false' ? { watching: watching === 'true' } : {}),
    ...(priorities.length > 0 ? { priorities } : {}),
    ...(statuses.length > 0 ? { statuses } : {}),
    services: params.getAll('service').filter(isService),
    types: params.getAll('type').filter(isMediaType),
    ...(params.has('category')
      ? { categories: params.getAll('category').filter(isTitleCategory) }
      : {}),
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
  next.delete('category');
  next.delete('genre');
  next.delete('runtime');
  next.delete('watching');
  next.delete('priority');
  next.delete('status');
  if (filters.watching !== undefined) next.set('watching', String(filters.watching));
  for (const priority of filters.priorities ?? []) next.append('priority', priority);
  for (const status of filters.statuses ?? []) next.append('status', status);
  for (const service of filters.services) next.append('service', service);
  for (const type of filters.types) next.append('type', type);
  for (const category of filters.categories ?? []) next.append('category', category);
  for (const genre of filters.genres) next.append('genre', genre);
  for (const runtime of filters.runtimes) next.append('runtime', runtime);
  return next;
}

export function isFiltered(filters: ListFilters): boolean {
  return (
    filters.watching !== undefined ||
    (filters.priorities?.length ?? 0) > 0 ||
    (filters.statuses?.length ?? 0) > 0 ||
    (filters.categories?.length ?? 0) > 0 ||
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
    ...statusChips(filters).map((chip) => chip.label),
    ...filters.services.map((service) => SERVICE_LABELS[service]),
    ...filters.types.map((type) => MEDIA_TYPE_LABELS[type]),
    ...(filters.categories ?? []).map((category) => TITLE_CATEGORY_LABELS[category]),
    ...filters.genres,
    // Named, not tokenised: a chip reading `60-90` states the cause of an
    // empty list in a vocabulary the owner never chose it in.
    ...filters.runtimes.map((bucket) => RUNTIME_BUCKET_LABELS[bucket]),
  ];
}

function toggle<T>(values: readonly T[], value: T): readonly T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

/** One label, or a count once several are chosen. `''` when nothing is. */
function selectionSummary(labels: readonly string[]): string {
  const selected = [...new Set(labels)];
  return selected.length > 1 ? `${String(selected.length)} selected` : (selected[0] ?? '');
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
  /**
   * TASK-255 — the phone library splits the bar in two (owner mobile mockup).
   * 	rigger is the icon-only Filters button in the heading and the chip
   * sheet it opens; summary is the service chips, active filters and count
   * under the heading. Omitted, the bar renders whole, as it always has.
   */
  readonly part?: 'trigger' | 'summary' | undefined;
  /** The tab bar's Filters request; the 	rigger part opens its sheet on it. */
  readonly openRequest?: LibraryCommand | null | undefined;
  readonly onOpenRequestHandled?: ((seq: number) => void) | undefined;
  /** Where focus returns when a request (not the trigger) opened the sheet. */
  readonly requestReturnFocus?: RefObject<HTMLButtonElement | null> | undefined;
}

export function FilterBar({
  inline = false,
  genres = [],
  shown,
  total,
  totalIsLowerBound = false,
  runtimeUnknownHidden = null,
  countPending = false,
  part,
  openRequest = null,
  onOpenRequestHandled,
  requestReturnFocus,
}: FilterBarProps): JSX.Element {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [openedByRequest, setOpenedByRequest] = useState(false);
  const [allGenres, setAllGenres] = useState(false);
  const showTrigger = !inline && part !== 'summary';
  const showSummary = !inline && part !== 'trigger';
  const phoneSheet = part === 'trigger';
  const requestSeq = openRequest?.kind === 'filters' && showTrigger ? openRequest.seq : null;
  useEffect(() => {
    if (requestSeq === null) return;
    setOpenedByRequest(true);
    setOpen(true);
    onOpenRequestHandled?.(requestSeq);
  }, [requestSeq, onOpenRequestHandled]);
  const headingId = useId();
  const close = useCallback(() => {
    setOpen(false);
    setOpenedByRequest(false);
  }, []);
  const filters = parseFilters(params);
  const runtimeRange = runtimeRangeFromBuckets(filters.runtimes);
  const genreOptions = [...new Set([...genres, ...filters.genres])];
  const [serviceQuery, setServiceQuery] = useState('');
  const services = SERVICES.filter((service) =>
    SERVICE_LABELS[service].toLowerCase().includes(serviceQuery.trim().toLowerCase()),
  );
  const query = params.get('q') ?? '';
  const watchChips = statusChips(filters);
  // Legacy one-status links are read as that status, so ticking a second box
  // adds to it rather than silently replacing it.
  const legacyChips = legacyStatusChips(filters);
  const legacyCustom = legacyChips.some((chip) => chip.dimension !== 'status');
  const checkedStatuses: readonly WatchStatus[] = [
    ...(filters.statuses ?? []),
    ...(legacyCustom ? [] : legacyChips.map((chip) => chip.value).filter(isWatchStatus)),
  ];
  const chips = [
    ...watchChips,
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
    ...(filters.categories ?? []).map((value) => ({
      dimension: 'category',
      value,
      label: TITLE_CATEGORY_LABELS[value],
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
    if (dimension === 'status') {
      next.delete('status', value);
      // A legacy one-status link is its only status chip, so it goes whole.
      if (!legacyCustom) {
        next.delete('watching');
        next.delete('priority');
      }
    } else if (dimension === 'q') next.delete('q');
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

  const countText = `Showing ${String(shown)} of ${totalIsLowerBound ? AT_LEAST_PREFIX : ''}${String(total)}`;

  const runtimeSlider = (
    <RangeSlider
      legend="Runtime"
      testId="filter-runtime"
      last={RUNTIME_RANGE_LAST_STOP}
      value={runtimeRange}
      minLabel={RUNTIME_RANGE_MIN_LABEL}
      maxLabel={RUNTIME_RANGE_MAX_LABEL}
      minName={RUNTIME_RANGE_MIN_NAME}
      maxName={RUNTIME_RANGE_MAX_NAME}
      formatValue={(stop) => RUNTIME_RANGE_STOP_LABELS[stop] ?? ''}
      speakValue={(stop) => RUNTIME_RANGE_STOP_SPOKEN[stop] ?? ''}
      move={moveRuntimeRangeHandle}
      onChange={(range) => {
        update({ ...filters, runtimes: runtimeBucketsForRange(range) });
      }}
      clampMessages={{
        min: RUNTIME_RANGE_MIN_CLAMPED,
        max: RUNTIME_RANGE_MAX_CLAMPED,
      }}
      description={
        runtimeRange.contiguous
          ? undefined
          : runtimeRangeGapNotice(filters.runtimes.map((bucket) => RUNTIME_BUCKET_LABELS[bucket]))
      }
    />
  );

  /** Multi-select: a toggled status replaces any legacy watching/priority pair. */
  function toggleStatus(status: WatchStatus): void {
    update({
      ...filters,
      watching: undefined,
      priorities: [],
      statuses: toggle([...new Set(checkedStatuses)], status),
    });
  }

  /**
   * TASK-255 — the phone filters sheet, drawn to the owner's mobile mockup:
   * a close X, the title and Reset across the top; every dimension as a row
   * of chips; one full-width "Show N titles" at the foot.
   *
   * ⚠ THE CHIPS ARE NATIVE CHECKBOXES, visually replaced. A chip
   * built from pressed buttons would look identical and drop the group
   * semantics, the keyboard model and the checked state assistive technology
   * reads — the same controls the desktop panel offers, restyled, not a
   * second model of the selection. Every change still writes the URL at once.
   *
   * ⚠ RATING AND RELEASE YEAR ARE NOT HERE. The mockup draws them; the owner
   * excluded both from this phase, and a chip row that filters nothing would
   * be a lie the list could not explain.
   */
  function renderPhoneSheet(): JSX.Element {
    const categories = filters.categories ?? [];
    const genreChoices = allGenres ? genreOptions : genreOptions.slice(0, PHONE_GENRE_LIMIT);
    const hiddenGenres = genreOptions.length - genreChoices.length;
    return (
      <div className="filter-sheet" data-testid="filter-sheet">
        <div className="filter-sheet__head">
          <Button variant="ghost" aria-label={FILTERS_CLOSE_LABEL} onClick={close}>
            <CloseIcon />
          </Button>
          <h2 id={headingId}>{FILTERS_SHEET_TITLE}</h2>
          <Button
            variant="ghost"
            data-testid="filter-sheet-reset"
            disabled={!isFiltered(filters)}
            onClick={() => {
              setParams(applyFilters(params, NO_FILTERS));
            }}
          >
            {FILTERS_RESET_LABEL}
          </Button>
        </div>
        <div className="filter-sheet__body">
          <Field legend="Services" testId="filter-service">
            <div className="filter-sheet__chips">
              {SERVICES.map((service) => (
                <label key={service} className="filter-chip">
                  <Input
                    type="checkbox"
                    name="service"
                    value={service}
                    checked={filters.services.includes(service)}
                    onChange={() => {
                      update({ ...filters, services: toggle(filters.services, service) });
                    }}
                  />
                  <ServiceMark service={service} />
                </label>
              ))}
            </div>
          </Field>
          <Field legend="Type" testId="filter-type">
            <div className="filter-sheet__chips">
              <label className="filter-chip">
                <Input
                  type="checkbox"
                  name="category-all"
                  checked={categories.length === 0 && filters.types.length === 0}
                  onChange={() => {
                    update({ ...filters, types: [], categories: [] });
                  }}
                />
                All<span className="sr-only"> types</span>
              </label>
              {TITLE_CATEGORIES.map((type) => (
                <label key={type} className="filter-chip">
                  <Input
                    type="checkbox"
                    name="category"
                    value={type}
                    checked={categories.includes(type)}
                    onChange={() => {
                      update({ ...filters, types: [], categories: toggle(categories, type) });
                    }}
                  />
                  {TITLE_CATEGORY_LABELS[type]}
                </label>
              ))}
            </div>
          </Field>
          {genreOptions.length > 0 && (
            <Field legend="Genre" testId="filter-genre">
              <div className="filter-sheet__chips">
                <label className="filter-chip">
                  <Input
                    type="checkbox"
                    name="genre-all"
                    checked={filters.genres.length === 0}
                    onChange={() => {
                      update({ ...filters, genres: [] });
                    }}
                  />
                  All<span className="sr-only"> genres</span>
                </label>
                {genreChoices.map((genre) => (
                  <label key={genre} className="filter-chip">
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
                {hiddenGenres > 0 && (
                  <span className="filter-sheet__more">
                    <Button
                      variant="secondary"
                      aria-label={`Show ${String(hiddenGenres)} more ${hiddenGenres === 1 ? 'genre' : 'genres'}`}
                      onClick={() => {
                        setAllGenres(true);
                      }}
                    >
                      + More
                    </Button>
                  </span>
                )}
              </div>
            </Field>
          )}
          <Field legend="Status" testId="filter-status">
            {legacyCustom && (
              <p>
                This saved link uses a combined watching/priority filter. Choose a status to replace
                it.
              </p>
            )}
            <div className="filter-sheet__chips">
              <label className="filter-chip">
                <Input
                  type="checkbox"
                  name="status-all"
                  checked={watchChips.length === 0}
                  onChange={() => {
                    update({ ...filters, watching: undefined, priorities: [], statuses: [] });
                  }}
                />
                All<span className="sr-only"> statuses</span>
              </label>
              {WATCH_STATUSES.map((value) => (
                <label key={value} className="filter-chip">
                  <Input
                    type="checkbox"
                    name="status"
                    value={value}
                    checked={checkedStatuses.includes(value)}
                    onChange={() => {
                      toggleStatus(value);
                    }}
                  />
                  {WATCH_STATUS_LABELS[value]}
                </label>
              ))}
            </div>
          </Field>
          <div className="filter-sheet__runtime">{runtimeSlider}</div>
        </div>
        <div className="filter-sheet__foot">
          <Button variant="primary" data-testid="filter-sheet-show" onClick={close}>
            {countPending ? SHOW_TITLES_PENDING : showTitlesLabel(shown, totalIsLowerBound)}
          </Button>
        </div>
      </div>
    );
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
      {(inline || showTrigger) && (
        <div
          className="filter-bar"
          data-inline={inline || undefined}
          hidden={inline}
          data-testid={inline ? undefined : 'filter-bar'}
          role="group"
          aria-label={inline ? 'Quick filters' : 'Filter the library'}
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
          {showTrigger && (
            <Button
              aria-haspopup="dialog"
              aria-expanded={open}
              data-testid="filters-trigger"
              data-active={activeCount > 0 || undefined}
              onClick={() => {
                setOpen(true);
              }}
            >
              <FilterIcon />
              {phoneSheet ? (
                <span className="sr-only">{FILTERS_TRIGGER_LABEL}</span>
              ) : (
                <span>{FILTERS_TRIGGER_LABEL}</span>
              )}
              {activeCount > 0 && (
                <span className="filter-bar__count" aria-label={`${String(activeCount)} active`}>
                  {activeCount}
                </span>
              )}
            </Button>
          )}
          {open && phoneSheet && (
            <FilterPanel
              inline={false}
              headingId={headingId}
              close={close}
              returnFocus={openedByRequest ? requestReturnFocus : undefined}
            >
              {renderPhoneSheet()}
            </FilterPanel>
          )}
          {(open || inline) && !phoneSheet && (
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
                    compact={inline}
                    active={filters.services.length > 0}
                    value={selectionSummary(
                      filters.services.map((service) => SERVICE_LABELS[service]),
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
                    compact={inline}
                    active={filters.types.length + (filters.categories?.length ?? 0) > 0}
                    value={selectionSummary([
                      ...filters.types.map((type) => MEDIA_TYPE_LABELS[type]),
                      ...(filters.categories ?? []).map(
                        (category) => TITLE_CATEGORY_LABELS[category],
                      ),
                    ])}
                  >
                    <Field legend="Type" testId="filter-type">
                      {TITLE_CATEGORIES.map((type) => (
                        <label key={type}>
                          <Input
                            type="checkbox"
                            name="category"
                            value={type}
                            checked={(filters.categories ?? []).includes(type)}
                            onChange={() => {
                              update({
                                ...filters,
                                types: [],
                                categories: toggle(filters.categories ?? [], type),
                              });
                            }}
                          />
                          {TITLE_CATEGORY_LABELS[type]}
                        </label>
                      ))}
                    </Field>
                    {filters.types.length > 0 && (
                      <p>
                        Saved type filters use the catalogue Movie/TV type. Choosing a category
                        replaces those filters with the displayed category.
                      </p>
                    )}
                  </FilterDisclosure>

                  {genreOptions.length > 0 && (
                    <FilterDisclosure
                      label="Genre"
                      compact={inline}
                      active={filters.genres.length > 0}
                      value={selectionSummary(filters.genres)}
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
        REQ-035 — the runtime filter. ALWAYS PRESENT, unlike the genre
        fieldset above, which is conditional on the list actually containing
        genres. The stops are fixed by `RUNTIME_BUCKET_BOUNDS` rather than
        derived from the data, so hiding it when no title happens to have a
        runtime would remove the only control that explains why the list is
        the length it is.
        #366 (TASK-246): a two-handle slider whose stops are the bucket edges,
        so it still writes the same canonical `runtime=` bucket tokens. A saved
        selection with a gap is shown as its covering range but is NOT
        rewritten until the owner moves a handle.
      */}
                  <FilterDisclosure
                    label="Runtime"
                    compact={inline}
                    active={filters.runtimes.length > 0}
                    value={
                      runtimeRange.contiguous
                        ? runtimeRangeSummary(
                            runtimeRange.min,
                            runtimeRange.max,
                            RUNTIME_RANGE_LAST_STOP,
                          )
                        : selectionSummary(
                            filters.runtimes.map((bucket) => RUNTIME_BUCKET_LABELS[bucket]),
                          )
                    }
                  >
                    {runtimeSlider}
                  </FilterDisclosure>
                  <FilterDisclosure
                    label="Status"
                    compact={inline}
                    active={watchChips.length > 0}
                    value={
                      legacyCustom && (filters.statuses?.length ?? 0) === 0
                        ? 'Custom saved filter'
                        : selectionSummary(
                            checkedStatuses.map((value) => WATCH_STATUS_LABELS[value]),
                          )
                    }
                  >
                    {legacyCustom && (
                      <p>
                        This saved link uses a combined watching/priority filter. Choose a status to
                        replace it.
                      </p>
                    )}
                    <Field legend="Status" testId="filter-status">
                      {WATCH_STATUSES.map((value) => (
                        <label key={value}>
                          <Input
                            type="checkbox"
                            name="status"
                            value={value}
                            checked={checkedStatuses.includes(value)}
                            onChange={() => {
                              toggleStatus(value);
                            }}
                          />
                          {WATCH_STATUS_LABELS[value]}
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
      )}

      {showSummary && (
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
            aria-label={part === 'summary' ? 'All services' : undefined}
            onClick={() => update({ ...filters, services: [] })}
          >
            {part === 'summary' ? SERVICE_FILTER_ALL_SHORT : 'All services'}
          </Button>
          {SERVICES.map((service) => (
            <Button
              key={service}
              variant="secondary"
              aria-pressed={filters.services.includes(service)}
              onClick={() => update({ ...filters, services: toggle(filters.services, service) })}
            >
              <ServiceMark service={service} nameHidden={part === 'summary'} />
            </Button>
          ))}
        </div>
      )}

      {showSummary && (chips.length > 0 || isFiltered(filters) || query !== '') && (
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

      {showSummary && !countPending && (
        <div className="filter-bar__status">
          {/*
        `role="status"` so the count is announced when filtering changes it -
        a sighted owner sees the list shrink, a screen-reader user otherwise
        gets no signal at all.
      */}
          {/*
            TASK-255 — on the phone the heading's subtitle SHOWS this count
            (owner mobile mockup) and is hidden from assistive technology, so
            this live region stays the one place it is announced from.
          */}
          {part === 'summary' ? (
            <p data-testid="filter-count" role="status" className="sr-only">
              {countText}
            </p>
          ) : (
            <p data-testid="filter-count" role="status">
              {countText}
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
      )}
    </>
  );
}

function FilterPanel({
  inline,
  headingId,
  close,
  returnFocus,
  children,
}: {
  readonly inline: boolean;
  readonly headingId: string;
  readonly close: () => void;
  readonly returnFocus?: RefObject<HTMLButtonElement | null> | undefined;
  readonly children: ReactNode;
}): JSX.Element {
  return inline ? (
    <>{children}</>
  ) : (
    <Dialog
      variant="panel"
      aria-labelledby={headingId}
      onDismiss={close}
      {...(returnFocus ? { returnFocus } : {})}
    >
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
