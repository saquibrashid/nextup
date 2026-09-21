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

import { useCallback, useId, useState, type JSX } from 'react';
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
  const fromUrl = params.get('sort');
  return (SORT_KEYS as readonly string[]).includes(fromUrl ?? '')
    ? (fromUrl as SortKey)
    : DEFAULT_SORT;
}

/** Missing directions mean the field default, including during Back/Forward. */
export function readSortDir(params: URLSearchParams): SortDir {
  const fromUrl = params.get('dir');
  if (fromUrl === 'desc' || fromUrl === 'asc') return fromUrl;
  return defaultDirFor(readSortKey(params));
}

export function SortControl(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const dir = readSortDir(params);
  const sort = readSortKey(params);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const chooseOrder = useCallback(
    (key: SortKey) => {
      const nextDir = key === sort ? (dir === 'desc' ? 'asc' : 'desc') : defaultDirFor(key);
      // One navigation sets both values. ListRoute owns cursor state and
      // resets paging when this query changes; no client-side sorting occurs.
      setParams((prev) => {
        const updated = new URLSearchParams(prev);
        if (key === DEFAULT_SORT) updated.delete('sort');
        else updated.set('sort', key);
        updated.set('dir', nextDir);
        return updated;
      });
    },
    [dir, sort, setParams],
  );

  const reverse = useCallback(() => {
    chooseOrder(sort);
  }, [chooseOrder, sort]);

  const label = SORT_ORDER_LABELS[sort][dir];
  const reversedLabel = SORT_ORDER_LABELS[sort][dir === 'desc' ? 'asc' : 'desc'];

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
        <span className="sort-arrow" data-dir={dir}>
          <ChevronIcon />
        </span>
        <span className="sort-trigger-label">{label}</span>
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
              <h2 id={headingId}>{SORT_PANEL_TITLE}</h2>
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
            {SORT_KEYS.map((key) => {
              const selected = sort === key;
              const shownDir = selected ? dir : defaultDirFor(key);
              const Icon = SORT_KEY_ICONS[key];
              const orderLabel = SORT_ORDER_LABELS[key][shownDir];
              const nextLabel = SORT_ORDER_LABELS[key][shownDir === 'desc' ? 'asc' : 'desc'];
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
                    <span className="sort-option__name">{SORT_KEY_NAMES[key]}</span>
                    <span className="sort-option__dir">
                      <span className="sort-arrow" data-dir={shownDir}>
                        <ChevronIcon />
                      </span>
                      {SORT_DIRECTION_LABELS[key][shownDir]}
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
