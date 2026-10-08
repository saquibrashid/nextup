// Owner-approved 2026-09-16: each button selects a complete order; pressing
// the selected button reverses it. Date added means date added to nextup.
//
// Owner-approved 2026-09-17 (`specs/ui.md` §2.1 item 2, §10.1): the six orders
// moved off the page and into a chooser opened from the toolbar, because
// always-expanded they consumed roughly half a 320 px viewport before a single
// title was visible.
//
// ⚠ THE REVERSE BUTTON IS LOAD-BEARING, NOT A CONVENIENCE. REQ-038's
// oldest-first escape hatch is `must` (`A47`) and §10.1's floor rule forbids
// "an additional step to reverse the current order". Moving the orders behind
// a disclosure would have broken both; the toolbar reverse button is the whole
// reason that move was allowed. Deleting it — or folding it into the chooser
// because it looks redundant with the selected row — re-breaks the
// requirement, and the list still sorts, so nothing looks wrong.
//
// #328: LibraryNavigation now persists the complete destination. This control
// reads only the URL, so a later preference cannot rewrite a history entry.

import { useCallback, useId, useState, type ComponentType, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import {
  AlphabetIcon,
  BookmarkIcon,
  CalendarIcon,
  ChevronIcon,
  ClockIcon,
  CloseIcon,
  FlagIcon,
  RatingIcon,
} from './icons';
import {
  SORT_CLOSE_LABEL,
  SORT_DIRECTION_LABELS,
  SORT_KEY_LEGEND,
  SORT_KEY_NAMES,
  SORT_ORDER_LABELS,
  SORT_PANEL_HELP,
  SORT_PANEL_TITLE,
  SORT_TRIGGER_LABEL,
  WAITING_SORT_DIRECTION_LABELS,
  WAITING_SORT_KEY_NAMES,
  WAITING_SORT_ORDER_LABELS,
  WAITING_SORT_PANEL_TITLE,
} from '../copy';

export type SortDir = 'desc' | 'asc';

// These are the API's own spellings, including `rating`, not `imdbRating`.
export const SORT_KEYS = [
  'dateAdded',
  'name',
  'releaseYear',
  'runtime',
  'rating',
  'watchPriority',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

const DEFAULT_SORT: SortKey = 'dateAdded';

// Mirrors defaultDirectionFor in apps/api/src/routes/titlesQuery.ts.
const DEFAULT_DIR_BY_KEY: Readonly<Record<SortKey, SortDir>> = {
  dateAdded: 'desc',
  name: 'asc',
  releaseYear: 'desc',
  runtime: 'desc',
  rating: 'desc',
  watchPriority: 'asc',
};

export function defaultDirFor(key: SortKey): SortDir {
  return DEFAULT_DIR_BY_KEY[key];
}

/** One mark per key, from the closed register (ADR-0013 Rev 2). */
const SORT_KEY_ICONS = {
  dateAdded: BookmarkIcon,
  name: AlphabetIcon,
  releaseYear: CalendarIcon,
  runtime: ClockIcon,
  rating: RatingIcon,
  watchPriority: FlagIcon,
} as const;

/** Both field and direction come from the authoritative URL. */
export function readSortKey(params: URLSearchParams): SortKey {
  return readSortKeyIn(LIBRARY_SORT, params);
}

/** Missing directions mean the field default, including during Back/Forward. */
export function readSortDir(params: URLSearchParams): SortDir {
  return readSortDirIn(LIBRARY_SORT, params);
}

type Labelled<K extends string, V> = Readonly<Record<K, V>>;
type DirLabels = Readonly<Record<SortDir, string>>;

/**
 * #415 (US-065, `A56`) — one control, two lists. Everything that differs
 * between the Library and Waiting to stream is data: the keys (the API's own
 * spellings), the default key, each key's default direction, the icons and
 * the words. The URL contract (`?sort=` omitted for the default key, `?dir=`
 * always written) and the toolbar reverse button are the same for both.
 */
export interface SortConfig<K extends string> {
  keys: readonly K[];
  defaultKey: K;
  defaultDirs: Labelled<K, SortDir>;
  icons: Labelled<K, ComponentType>;
  keyNames: Labelled<K, string>;
  directionLabels: Labelled<K, DirLabels>;
  orderLabels: Labelled<K, DirLabels>;
  panelTitle: string;
}

export const LIBRARY_SORT: SortConfig<SortKey> = {
  keys: SORT_KEYS,
  defaultKey: DEFAULT_SORT,
  defaultDirs: DEFAULT_DIR_BY_KEY,
  icons: SORT_KEY_ICONS,
  keyNames: SORT_KEY_NAMES,
  directionLabels: SORT_DIRECTION_LABELS,
  orderLabels: SORT_ORDER_LABELS,
  panelTitle: SORT_PANEL_TITLE,
};

// The API's own spellings; mirrors apps/api/src/services/waitingSort.ts.
export const WAITING_SORT_KEYS = ['expected', 'discovered', 'name', 'releaseYear'] as const;
export type WaitingSortKey = (typeof WAITING_SORT_KEYS)[number];

export const WAITING_SORT: SortConfig<WaitingSortKey> = {
  keys: WAITING_SORT_KEYS,
  defaultKey: 'expected',
  defaultDirs: { expected: 'asc', discovered: 'desc', name: 'asc', releaseYear: 'desc' },
  icons: {
    expected: ClockIcon,
    discovered: BookmarkIcon,
    name: AlphabetIcon,
    releaseYear: CalendarIcon,
  },
  keyNames: WAITING_SORT_KEY_NAMES,
  directionLabels: WAITING_SORT_DIRECTION_LABELS,
  orderLabels: WAITING_SORT_ORDER_LABELS,
  panelTitle: WAITING_SORT_PANEL_TITLE,
};

/** A key outside the config is the config's default, as the Library does. */
export function readSortKeyIn<K extends string>(config: SortConfig<K>, params: URLSearchParams): K {
  const fromUrl = params.get('sort');
  return (config.keys as readonly string[]).includes(fromUrl ?? '')
    ? (fromUrl as K)
    : config.defaultKey;
}

export function readSortDirIn<K extends string>(
  config: SortConfig<K>,
  params: URLSearchParams,
): SortDir {
  const fromUrl = params.get('dir');
  if (fromUrl === 'desc' || fromUrl === 'asc') return fromUrl;
  return config.defaultDirs[readSortKeyIn(config, params)];
}

/** With no `config`, the Library's control, exactly as before #415. */
export function SortControl({ config }: { config?: SortConfig<string> } = {}): JSX.Element {
  return <SortControlWith config={config ?? (LIBRARY_SORT as SortConfig<string>)} />;
}

function SortControlWith<K extends string>({ config }: { config: SortConfig<K> }): JSX.Element {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const dir = readSortDirIn(config, params);
  const sort = readSortKeyIn(config, params);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const chooseOrder = useCallback(
    (key: K) => {
      const nextDir = key === sort ? (dir === 'desc' ? 'asc' : 'desc') : config.defaultDirs[key];
      // One navigation sets both values. The route owns the fetch and resets
      // paging when this query changes; no client-side sorting occurs.
      setParams((prev) => {
        const updated = new URLSearchParams(prev);
        if (key === config.defaultKey) updated.delete('sort');
        else updated.set('sort', key);
        updated.set('dir', nextDir);
        return updated;
      });
    },
    [config, dir, sort, setParams],
  );

  const reverse = useCallback(() => {
    chooseOrder(sort);
  }, [chooseOrder, sort]);

  const label = config.orderLabels[sort][dir];
  const reversedLabel = config.orderLabels[sort][dir === 'desc' ? 'asc' : 'desc'];
  return (
    <div className="sort-control-group" data-testid="sort-control-group">
      <Button
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${SORT_TRIGGER_LABEL}: ${label}. Change the order.`}
        data-testid="sort-trigger"
        onClick={() => {
          setOpen(true);
        }}
      >
        <span className="sort-trigger-label">
          <span className="sort-trigger-prefix">{SORT_TRIGGER_LABEL}: </span>
          {label}
        </span>
        <span className="sort-trigger-disclosure">
          <ChevronIcon />
        </span>
      </Button>
      {/*
        ⚠ The reverse button is the §10.1 floor rule, not decoration — see the
        header. Its accessible name states the order it produces, so direction
        is never carried by the arrow's rotation alone (`T-A11Y-008`).
      */}
      <Button
        aria-label={`Reverse the order: ${reversedLabel}`}
        data-testid="sort-reverse"
        onClick={reverse}
      >
        <span className="sort-arrow" data-dir={dir === 'desc' ? 'asc' : 'desc'}>
          <ChevronIcon />
        </span>
      </Button>
      {open && (
        <Dialog variant="panel" aria-labelledby={headingId} onDismiss={close}>
          <div className="panel-head">
            <div>
              <h2 id={headingId}>{config.panelTitle}</h2>
              <p className="panel-help">{SORT_PANEL_HELP}</p>
            </div>
            <Button variant="ghost" aria-label={SORT_CLOSE_LABEL} onClick={close}>
              <CloseIcon />
            </Button>
          </div>
          <div
            className="sort-options"
            data-testid="sort-control"
            role="group"
            aria-label={SORT_KEY_LEGEND}
          >
            {config.keys.map((key) => {
              const selected = sort === key;
              const shownDir = selected ? dir : config.defaultDirs[key];
              const Icon: ComponentType = config.icons[key];
              const orderLabel = config.orderLabels[key][shownDir];
              const nextLabel = config.orderLabels[key][shownDir === 'desc' ? 'asc' : 'desc'];
              return (
                <span key={key} className="sort-option">
                  <Button
                    aria-pressed={selected}
                    aria-label={
                      selected ? `${orderLabel}. Selected. Change to ${nextLabel}.` : orderLabel
                    }
                    onClick={() => {
                      close();
                      chooseOrder(key);
                    }}
                  >
                    <span className="sort-option__icon">
                      <Icon />
                    </span>
                    <span className="sort-option__name">{config.keyNames[key]}</span>
                    <span className="sort-option__dir">
                      <span className="sort-arrow" data-dir={shownDir}>
                        <ChevronIcon />
                      </span>
                      {config.directionLabels[key][shownDir]}
                    </span>
                  </Button>
                </span>
              );
            })}
          </div>
        </Dialog>
      )}
    </div>
  );
}
