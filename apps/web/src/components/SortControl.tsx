// `components/SortControl.tsx` — the sort field selector and direction segment
// (`specs/ui-refresh.md` §5, §5b; REQ-114, REQ-115, REQ-121; TASK-217).
//
// ⚠ THIS IS NO LONGER A TOGGLE, AND THAT IS THE REQUIREMENT (REQ-114).
// It used to be one button labelled "Newest first" *while the list was already
// newest-first*, and pressing it made the list oldest-first. Both readings —
// "this is the state" and "this is what you'll get" — are defensible, which is
// precisely the defect. The owner's answer (OQ-5, `A53`) was to show BOTH
// options with the current one marked. `T-UX-128` fails if it becomes a single
// toggling control again.
//
// ⚠ A TWO-OPTION SEGMENT CANNOT EXPRESS FIVE FIELDS, so the control is TWO
// adjacent controls: a "Sort by" field selector and a direction segment whose
// labels suit the selected field (§5b).
//
// ⚠⚠ DO NOT COLLAPSE THE DIRECTION INTO THE FIELD LIST. Ten combined options
// ("Date added, oldest first" …) would delete product invariant 6 while every
// behavioural test still passed, because `click()` still reaches oldest-first.
// REQ-038's oldest-first reverse is `must` (promoted at `A47`): it is the sole
// escape hatch for the knowingly-accepted newest-first-vs-SUC-003 trade-off,
// and OQ-029's revisit path depends on it shipping in v1. `T-UX-131` counts the
// interactions.
//
// ⚠ TWO SOURCES, ONE WINNER for the DIRECTION (in priority order): URL param
// `dir` > session storage > the selected field's default. The URL wins because
// it enables deep links and back/forward. Session storage remembers the
// preference across navigations that do not carry a `dir` param.
//
// ⚠ THE FIELD AND THE DIRECTION RENDER AS ONE GROUP AND ARE NOT ONE STATE
// CONTAINER (REQ-113). The filters beside them are URL-only; the sort is
// URL → session → default. A refactor that "tidies" the group into one shared
// hook produces a green suite and a broken back button.
//
// ⚠ DATE-ADDED MEANS DATE ADDED TO NEXTUP (REQ-061). Never the streaming
// service's own saved date — that fact is what `specs/api.md` §6.2 calls
// `dateAddedLabel` and is labelled "to nextup" everywhere it is shown.

import { useCallback, useEffect, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Field } from './ui/Field';
import { Input } from './ui/Input';

import {
  SORT_AZ_LABEL,
  SORT_DIR_LEGEND,
  SORT_HIGHEST_LABEL,
  SORT_KEY_DATE_LABEL,
  SORT_KEY_LEGEND,
  SORT_KEY_NAME_LABEL,
  SORT_KEY_RATING_LABEL,
  SORT_KEY_RUNTIME_LABEL,
  SORT_KEY_YEAR_LABEL,
  SORT_LONGEST_LABEL,
  SORT_LOWEST_LABEL,
  SORT_NEWEST_LABEL,
  SORT_OLDEST_LABEL,
  SORT_SHORTEST_LABEL,
  SORT_ZA_LABEL,
} from '../copy';

export type SortDir = 'desc' | 'asc';

/**
 * REQ-115 / REQ-121 — the sort keys, as they appear in the URL.
 *
 * ⚠ THESE ARE THE API'S OWN SPELLINGS, taken from `TITLE_SORTS` in
 * `apps/api/src/routes/titlesQuery.ts`. The rating key is **`rating`**, not
 * `imdbRating`: the API rejects an unknown `sort`, so a plausible-looking
 * mis-spelling here is a 400 on a control the owner can see and press.
 *
 * ⚠ REQ-095 SAID THE RATING COULD NEVER BE A SORT KEY. **That was reversed by
 * the owner at `A53`** and written up as ADR-0011 Revision 1 — not as a strike
 * in `ui-refresh.md`, because the reopening found `specs/api.md` had since
 * made REQ-095 load-bearing for REQ-041 compliance, so the reversal also
 * required the rating refresh to become synchronous (TASK-216). `T-UX-119` was
 * REWRITTEN rather than deleted and now asserts the option is present.
 */
export const SORT_KEYS = ['dateAdded', 'name', 'releaseYear', 'runtime', 'rating'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

const SESSION_KEY = 'nextup.sort.dir';
const DEFAULT_SORT: SortKey = 'dateAdded';

/**
 * REQ-121 — the default direction, PER FIELD.
 *
 * ⚠⚠ THIS MIRRORS `defaultDirectionFor` IN `apps/api/src/routes/titlesQuery.ts`
 * AND MUST NOT BE SIMPLIFIED BACK TO ONE GLOBAL `desc`. `desc` is right for
 * every field whose interesting end is the high one, and applied to `name` it
 * means `?sort=name` opens at **Z**, which no one has ever meant by "sort by
 * name" — so the API defaults `name` to `asc`.
 *
 * A single `desc` here produces the exact failure this file's reconciliation
 * effect exists to prevent, in a new place: with `?sort=name` and no `dir`,
 * the control would read `Z–A` while the API, seeing no `dir`, returns A–Z.
 * The label lies, the list is fine, and nothing errors. `T-UX-129c` is the
 * guard.
 */
const DEFAULT_DIR_BY_KEY: Readonly<Record<SortKey, SortDir>> = {
  dateAdded: 'desc',
  name: 'asc',
  releaseYear: 'desc',
  runtime: 'desc',
  rating: 'desc',
};

export function defaultDirFor(key: SortKey): SortDir {
  return DEFAULT_DIR_BY_KEY[key];
}

/**
 * REQ-121 §5b — the direction labels, PER SORT KEY (`T-UX-129`).
 *
 * ⚠ "Newest first" ON A RUNTIME-SORTED LIST IS A FALSE STATEMENT, not merely
 * an imprecise one: it names a different column from the one the list is
 * ordered by, and the owner has no way to tell which is true. The label is the
 * only thing on screen that says what the order means.
 *
 * ⚠ `SORT_NEWEST_LABEL` / `SORT_OLDEST_LABEL` ARE REUSED VERBATIM, for BOTH
 * date-shaped fields. They are governed copy (`specs/ui.md` §9) and §8 is
 * explicit that rewriting owner-facing wording is a product decision. Adding
 * strings for fields that had no ordering before is in scope; retyping these
 * two is not.
 */
const DIR_LABELS: Readonly<Record<SortKey, Readonly<Record<SortDir, string>>>> = {
  dateAdded: { desc: SORT_NEWEST_LABEL, asc: SORT_OLDEST_LABEL },
  name: { desc: SORT_ZA_LABEL, asc: SORT_AZ_LABEL },
  releaseYear: { desc: SORT_NEWEST_LABEL, asc: SORT_OLDEST_LABEL },
  runtime: { desc: SORT_LONGEST_LABEL, asc: SORT_SHORTEST_LABEL },
  rating: { desc: SORT_HIGHEST_LABEL, asc: SORT_LOWEST_LABEL },
};

const KEY_LABELS: Readonly<Record<SortKey, string>> = {
  dateAdded: SORT_KEY_DATE_LABEL,
  name: SORT_KEY_NAME_LABEL,
  releaseYear: SORT_KEY_YEAR_LABEL,
  runtime: SORT_KEY_RUNTIME_LABEL,
  rating: SORT_KEY_RATING_LABEL,
};

/**
 * ⚠ THE SEGMENT RENDERS `desc` THEN `asc`, ALWAYS, whatever is selected.
 *
 * Ordering the options by which is current would move the owner's target
 * between renders — the control they just pressed would jump under the
 * pointer. "Both options rendered with the current one marked" (OQ-5) means
 * marked in place, not reordered.
 */
const DIR_ORDER: readonly SortDir[] = ['desc', 'asc'];

/**
 * Reads the effective sort KEY from the URL, defaulting to `dateAdded`.
 *
 * ⚠ THE KEY IS NOT PERSISTED IN SESSION STORAGE, unlike the direction. A
 * remembered key would reorder the list on a fresh visit with no `sort` in the
 * URL, and the reconciliation effect below would then rewrite the address bar
 * on arrival. The direction is a preference about one list; the key is which
 * list it is.
 */
export function readSortKey(params: URLSearchParams): SortKey {
  const fromUrl = params.get('sort');
  return (SORT_KEYS as readonly string[]).includes(fromUrl ?? '')
    ? (fromUrl as SortKey)
    : DEFAULT_SORT;
}

/**
 * Reads the effective sort direction from URL then session storage then the
 * SELECTED FIELD'S default.
 *
 * Exported for tests (`T-UI-024g/h`).
 */
export function readSortDir(params: URLSearchParams): SortDir {
  const fromUrl = params.get('dir');
  if (fromUrl === 'desc' || fromUrl === 'asc') return fromUrl;
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored === 'desc' || stored === 'asc') return stored;
  } catch {
    // sessionStorage may be unavailable in some private-browsing configurations.
  }
  return defaultDirFor(readSortKey(params));
}

export function SortControl(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const dir = readSortDir(params);
  const sort = readSortKey(params);

  /**
   * ⚠ THE REMEMBERED DIRECTION MUST BE RECONCILED INTO THE URL, OR THE LABEL
   * LIES ABOUT THE LIST.
   *
   * `ListRoute` sends `params.toString()` verbatim to `GET /api/titles`, so
   * the URL — not this component's state — is what the server sorts by. With
   * `asc` remembered in session storage and no `dir` in the URL, `readSortDir`
   * returns `asc` and the segment marks "Oldest first" while the API, seeing
   * no `dir`, returns its default. The owner is then shown a newest-first list
   * under an oldest-first mark, with no error anywhere.
   *
   * That is precisely the US-020 AC-6 path the persistence exists for
   * ("survives navigating away and back"), which is why the feature that
   * appears to work is the one that is wrong.
   *
   * `replace: true`, deliberately: this is a correction of the address the
   * owner already arrived at, not a navigation they performed. Pushing would
   * make Back require two presses to leave the list.
   *
   * ⚠ THE FIELD'S OWN DEFAULT IS THE THING NOT WRITTEN, not a fixed `desc`.
   * An absent `dir` means `defaultDirectionFor(sort)` to the API, so writing
   * it would add a redundant parameter for no effect — but under `sort=name`
   * that default is `asc`, and a check against a hard-coded `desc` would write
   * `dir=asc` into every name-sorted URL while ALSO failing to write a genuine
   * `dir=desc`. Both halves are wrong, and only the second is visible.
   */
  const urlDir = params.get('dir');
  useEffect(() => {
    if (urlDir === 'desc' || urlDir === 'asc') return;
    if (dir === defaultDirFor(sort)) return;
    setParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('dir', dir);
        return updated;
      },
      { replace: true },
    );
  }, [urlDir, dir, sort, setParams]);

  const chooseDir = useCallback(
    (next: SortDir) => {
      try {
        sessionStorage.setItem(SESSION_KEY, next);
      } catch {
        // Best-effort persistence — not critical to function.
      }
      setParams((prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('dir', next);
        return updated;
      });
    },
    [setParams],
  );

  return (
    <div className="sort-control-group" data-testid="sort-control-group">
      {/*
        REQ-121 — the sort FIELD. Radios rather than a `<select>`: `specs/ui.md`
        §2.1 item 2 holds the filter bar to native controls with visible state,
        and a collapsed widget would hide four of the five orderings behind a
        press, which is the same "buried in a menu" failure §5 warns about for
        the direction.

        ⚠ CHANGING THE FIELD DOES NOT CHANGE THE DIRECTION, and must not
        (§5b, `T-UX-130`). `desc` means "newest" for a date and "highest" for a
        rating; the underlying `dir` value is preserved so the list does not
        reorder in a way the owner did not ask for. What changes is the LABEL,
        because the same `dir` means something different per field.

        ⚠ NO CURSOR IS CARRIED, because the cursor is not in the URL — it lives
        in `useCursorPages` state and is reset by the query change this
        triggers. That is load-bearing: a date cursor sent with `sort=runtime`
        is a keyset that does not mirror its own ORDER BY, and the API answers
        `INVALID_CURSOR` rather than a page of quietly wrong rows.
      */}
      <Field legend={SORT_KEY_LEGEND} testId="sort-key">
        {SORT_KEYS.map((key) => (
          <label key={key} className="tap-target">
            <Input
              type="radio"
              name="sort"
              value={key}
              checked={sort === key}
              onChange={() => {
                setParams((prev) => {
                  const updated = new URLSearchParams(prev);
                  // An absent `sort` already means `dateAdded` to the API, so
                  // the default is removed rather than written — the same rule
                  // the `dir` reconciliation above follows.
                  if (key === DEFAULT_SORT) updated.delete('sort');
                  else updated.set('sort', key);
                  return updated;
                });
              }}
            />
            {KEY_LABELS[key]}
          </label>
        ))}
      </Field>

      {/*
        REQ-114 / REQ-121 — the DIRECTION segment. Both options on screen, the
        current one marked, per the owner's OQ-5 answer.

        ⚠ RADIOS, NOT TWO BUTTONS. The choice is mutually exclusive and
        native radios give a screen reader "2 of 2" and arrow-key movement for
        free. Two `aria-pressed` buttons would announce two independent toggles,
        one of which is always on — which describes a state nobody chose.
      */}
      <Field legend={SORT_DIR_LEGEND} testId="sort-control">
        {DIR_ORDER.map((option) => (
          <label key={option} className="tap-target" data-testid={`sort-dir-${option}`}>
            <Input
              type="radio"
              name="dir"
              value={option}
              checked={dir === option}
              onChange={() => chooseDir(option)}
            />
            {DIR_LABELS[sort][option]}
          </label>
        ))}
      </Field>
    </div>
  );
}
