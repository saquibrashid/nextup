// The combined-list row (`specs/ui.md` §2.2, TASK-038).
//
// ⚠ THE ROW IS THE WORK, NOT THE LISTING (product invariant 1, REQ-026).
// "Dune" saved on both Netflix and Max is ONE row carrying TWO badges - never
// two rows. That collapse happens server-side (`T-LIST-010`/`011`), so this
// component's job is to render `badges[]` as given and never to group, dedupe
// or re-key anything itself. A row keyed on a listing would look identical on a
// single-service list and split silently the first time a work appeared twice.
//
// ⚠ `dateAddedLabel` IS RENDERED VERBATIM AND MUST NEVER BE CONSTRUCTED HERE
// (REQ-061, `specs/api.md` §6.2). The server owns the one implementation of the
// honest-labelling rule, so the string always contains "to nextup" and never
// reads as a bare "Added" that the owner could mistake for Netflix's own save
// date. A client-side fallback - even a well-meaning one for the null case -
// would be a second implementation of a rule whose whole point is having one.
// `T-LIST-018` asserts the marker on every rendered label.

import type { JSX, ReactNode } from 'react';
import { formatRuntime, type Service, type WatchPriority } from '@nextup/domain';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { ServiceMark } from './ServiceMark';
import { ChevronIcon, MoreIcon } from './icons';
import { GenreChips } from './GenreChips';

import {
  IMDB_RATING_ABSENT,
  IMDB_RATING_SOURCE,
  METADATA_STALE_CHIP,
  ROW_PENDING_LABEL,
  RUNTIME_UNKNOWN_LABEL,
  WATCH_PRIORITY_LABELS,
} from '../copy';

/**
 * `specs/ui.md` §2.2 - the poster size the row requests.
 *
 * ⚠ THIS IS A RENDERED-RESOLUTION SETTING, NOT A URL DETAIL, AND `w154` WAS
 * VISIBLY WRONG. TMDB serves fixed-width renditions; the path segment IS the
 * pixel width. `w154` means the browser is handed a 154 px-wide image whatever
 * it intends to paint it at.
 *
 * In `data-view='grid'` the tile track is `repeat(auto-fill, minmax(28rem,
 * 1fr))` and the poster takes `grid-column: 1` of a `0.8fr 1fr` split at
 * `width: 100%` — so it paints at roughly 200 CSS px and upward, on a desktop
 * often more. That is already a ~1.4× upscale of a 154 px source in CSS pixels
 * alone, and every mainstream display the owner uses is 2× or 3× device pixel
 * ratio, which takes it past 4×. The owner reported it plainly: the artwork is
 * soft. Upscaling is not a rendering nicety here — the poster is how a title is
 * recognised at a glance (REQ-111), so a blurred poster degrades the one job
 * the image has.
 *
 * ⚠ THE FLOOR IS NOT THE PROBLEM AND MUST NOT BE "FIXED" BY SHRINKING THE BOX.
 * REQ-111 sets a 72 × 108 minimum and the compact view sits exactly on it
 * (`4.5rem`/`6.75rem`). `w154` is ample there. The defect is confined to the
 * views that render LARGER than the source, so the answer is a bigger source,
 * not a smaller box.
 *
 * `srcSet` rather than a single larger URL: the compact and list views still
 * paint at 72 px, where `w500` would be ~10× the bytes for no visible gain on
 * a 1× display. Handing the browser both lets it spend the bytes only where
 * the pixels are actually used. `w342` stays the `src` so a browser that
 * ignores `srcSet` still gets a better image than it does today.
 *
 * ~~Superseded: a single `w154` base for every view.~~
 */
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

/**
 * The high-density rendition offered alongside {@link TMDB_IMAGE_BASE}.
 *
 * ⚠ KEEP THE DESCRIPTOR AND THE WIDTH IN AGREEMENT. `w500` is offered as `2x`
 * against a `w342` `1x`; the true ratio is 1.46, and a browser told `2x` will
 * happily use it on a 2× display where the CSS box is up to 250 px. That is
 * the intended trade — 500 px of real data beats 342 px stretched — but if
 * either width is ever changed, the descriptor has to be re-derived rather
 * than carried over.
 */
export const TMDB_IMAGE_BASE_2X = 'https://image.tmdb.org/t/p/w500';

/** One active listing (`specs/api.md` §6.2 `badges[]`). */
export interface TitleBadge {
  readonly service: Service;
  readonly listingId: string;
  readonly dateAdded: string;
}

/** An item of `GET /api/titles` (`specs/api.md` §6.2). */
export interface TitleListItem {
  /** Optional for cached responses from before watch preferences shipped. */
  readonly watching?: boolean;
  readonly priority?: WatchPriority;
  readonly titleId: string;
  readonly workIdentity: string;
  readonly matchState: 'matched' | 'unmatched';
  readonly name: string;
  readonly mediaType: 'movie' | 'tv';
  readonly releaseYear: number | null;
  readonly genres: readonly string[];
  readonly runtimeMinutes: number | null;
  readonly posterPath: string | null;
  readonly badges: readonly TitleBadge[];
  readonly sortDateAdded: string | null;
  /** `null` when the title has no non-removed listing to date it by. */
  readonly dateAddedLabel: string | null;
  /**
   * 1.0-10.0, or `null` (REQ-091). ⚠ `null` covers BOTH "not fetched yet" and
   * "IMDb has no rating for this work" - deliberately indistinguishable here,
   * because the owner can do nothing about either and a "checking..." state
   * would flicker on every first render of every page.
   */
  readonly imdbRating?: number | null;
  /**
   * `specs/api.md` §6.4 — TMDB was unreachable, or this item missed the 5 s
   * refresh budget, while the server built THIS response (NFR-014, REQ-076).
   *
   * ⚠ **`true` NEVER MEANS THE DATA IS MISSING OR WRONG.** Every metadata
   * field above is populated exactly as normal — from nextup's stored copy —
   * and the list deliberately succeeds rather than failing on TMDB
   * (`specs/api.md` §6.4: *"The list never fails because of TMDB"*). So the
   * row renders in full and gains a chip; it must never render degraded,
   * blanked, or as an error.
   *
   * ⚠ **THIS IS NOT THE A46 STALENESS NUDGE** (product invariant 8). The
   * per-service "you haven't updated in N days" concept was dropped whole;
   * this flag is the surviving, still-required TMDB sense of "stale".
   *
   * Optional because the API is the only writer: a hand-built fixture or an
   * older cached payload without the field means "not flagged", which is the
   * same thing as `false` and the correct default for an unknown.
   */
  readonly metadataStale?: boolean | undefined;
}

export interface TitleRowProps {
  readonly titleLink?: ReactNode;
  readonly onWatchPreferences?: ((item: TitleListItem) => void) | undefined;
  readonly item: TitleListItem;
  /**
   * Opens the §2.3 row menu (Not interested / Fix match). The MENU ITSELF is
   * TASK-102's (`T-UX-030`); this component owns only the affordance, so the
   * `⋮` reports the intent rather than firing one of the two actions directly.
   * A button that suppressed on a single tap would skip the confirm step the
   * spec requires and make an irreversible-looking change out of a mis-tap.
   */
  readonly onOpenMenu?: ((item: TitleListItem) => void) | undefined;
  readonly onFixMatch?: ((item: TitleListItem) => void) | undefined;
  /**
   * REQ-105 — the open row menu, rendered inside this row's actions box.
   *
   * ⚠ **A slot, not a set of menu props.** The row must not learn what the
   * menu contains; `ListPage` owns that, including `canRemove`'s deliberate
   * `false` default. Passing `undefined` (every row except the open one) is
   * the normal case.
   */
  readonly menu?: ReactNode | undefined;
  /**
   * `specs/ux-states.md` §2.13 **Submitting (row action)** (`T-UX-021`) — a
   * write against THIS row is in flight.
   *
   * ⚠ **THE FLAG IS PER ROW, AND THAT IS THE WHOLE REQUIREMENT.** §2.13 says
   * *"the rest of the list stays interactive"*, so the forbidden shape is a
   * list-wide `busy` that disables every row while one of them is saving. On
   * the owner's real list that reads as the app having frozen, and the natural
   * response — reload — is the one action that can lose the in-flight write.
   *
   * ⚠ **`pending` DIMS AND DISABLES; IT NEVER HIDES.** `ListPage` already
   * refuses to hide on `pending` (a failed request would leave a row hidden
   * that is still on the list); this prop must not reintroduce that by the
   * back door.
   */
  readonly pending?: boolean | undefined;
  /**
   * REQ-112 (§4.3) — the genres in the ACTIVE filter, passed straight through
   * to `GenreChips`, which keeps them visible rather than collapsing them
   * behind `+n`. Optional: a row rendered outside the filtered list (a fixture,
   * a dialog preview) has no filter to respect.
   */
  readonly activeGenres?: readonly string[] | undefined;
}

const MEDIA_TYPE_LABELS: Readonly<Record<TitleListItem['mediaType'], string>> = {
  movie: 'Movie',
  tv: 'TV',
};

export function TitleRow({
  item,
  titleLink,
  onWatchPreferences,
  onOpenMenu,
  onFixMatch,
  pending,
  menu,
  activeGenres,
}: TitleRowProps): JSX.Element {
  const unmatched = item.matchState === 'unmatched';
  const busy = pending === true;

  return (
    // Preserve existing provenance anchors alongside the dedicated details link.
    <li
      className="title-row"
      id={`title-${item.titleId}`}
      data-testid={`title-row-${item.titleId}`}
      data-match-state={item.matchState}
      // ⚠ `aria-busy` IS THE WHOLE §2.13 ROW STATE, VISUAL HALF INCLUDED. The
      // dim is applied by `.title-row[aria-busy='true']` in `index.css` rather
      // than by a `--pending` modifier class, for two reasons: `T-CSS-001c`
      // forbids a computed `className` outright (a conditional one would make
      // its static class scan silently incomplete), and — the better reason —
      // deriving the dim FROM the accessible state makes it impossible to ship
      // a row that looks busy but announces nothing, or announces busy and
      // looks idle. There is one flag, so the two cannot disagree.
      aria-busy={busy ? true : undefined}
    >
      {item.posterPath === null ? (
        // A neutral tile, never a broken <img>. §2.2: a missing poster is an
        // ordinary state (TMDB has no art for plenty of works), not an error.
        <div
          className="title-row__poster title-row__poster--empty"
          data-testid="poster-placeholder"
        />
      ) : (
        <img
          className="title-row__poster"
          data-testid="poster"
          src={`${TMDB_IMAGE_BASE}${item.posterPath}`}
          srcSet={`${TMDB_IMAGE_BASE}${item.posterPath} 1x, ${TMDB_IMAGE_BASE_2X}${item.posterPath} 2x`}
          // Decorative: the name sits next to it as real text, so announcing
          // the poster too would make a screen reader say the title twice.
          alt=""
        />
      )}

      <div className="title-row__body">
        <div className="title-row__identity">
          <div className="title-row__heading">
            <h2 className="title-row__name" data-testid="title-name">
              {titleLink ?? item.name}
            </h2>
            <span className="title-row__status">
              {item.watching === true && <span className="title-row__watching">Watching</span>}

              {unmatched && (
                <span className="title-row__chip" data-testid="unidentified-chip">
                  Unidentified
                </span>
              )}

              {/*
          `specs/ux-states.md` §2.8 (`T-UX-017`). Rendered PER ROW, from the
          per-item flag, because the refresh is per item: one title can miss
          the 5 s budget on a page where every other title refreshed fine, and
          a page-level banner would either accuse rows that are current or say
          nothing about the one that is not.

          ⚠ IT IS A SIBLING OF THE `Unidentified` CHIP, NOT AN ALTERNATIVE TO
          IT. The two states are independent — an unmatched title still has
          stored metadata that TMDB could fail to confirm — so an
          `unmatched ? … : …` here would silently drop the stale signal on
          exactly the rows whose data is least trustworthy.

          ⚠ NOT A LIVE REGION AND NOT AN ALERT. §2.8's own "user can" column
          is *"Everything, normally"*: nothing is broken, nothing is blocked
          and there is no action to take, so interrupting a screen reader for
          it would be noise. It is ordinary text, present in the accessibility
          tree in reading order, which is what "subtle" means here.
        */}
              {item.metadataStale === true && (
                <span
                  className="title-row__chip title-row__chip--stale"
                  data-testid="metadata-stale-chip"
                >
                  {METADATA_STALE_CHIP}
                </span>
              )}
            </span>
          </div>

          <p className="title-row__meta" data-testid="title-meta">
            {/*
            REQ-106 — year and type precede runtime and wrapping genres.
            It previously rendered type-then-year, which is why the owner's
            screenshot read `TV2004Animation`. The separators themselves are
            CSS-generated (`.title-row__facts > span + span::before`) so they
            stay out of the row's accessible name.
          */}
            <span className="title-row__facts">
              {item.releaseYear !== null && (
                <span data-testid="release-year">{item.releaseYear}</span>
              )}
              <span data-testid="media-type">{MEDIA_TYPE_LABELS[item.mediaType]}</span>
              {/*
            US-019 AC-6: an empty genre list renders NOTHING - not "Unknown",
            not "-". A placeholder would read as a fact about the work rather
            than an absence of data, and the owner cannot tell the difference.
            The `null` return lives in `GenreChips` so the rule holds for the
            compact presentation too, including the `+0` it newly makes
            possible (REQ-112, `T-UX-102b`).
          */}
              {/*
            REQ-119 - runtime precedes genres; unknown runtime is named rather than omitted.

            ⚠ THIS DELIBERATELY DIFFERS FROM THE GENRE BRANCH DIRECTLY ABOVE,
            and the difference is the requirement. An empty genre list renders
            nothing because genres do not decide whether the row can appear.
            RUNTIME DOES: it is filterable (REQ-035), and a `null` runtime
            satisfies no bucket, so a title with no runtime vanishes the moment
            any bucket is selected. An owner who cannot see that a title has no
            runtime cannot understand why it disappeared. This follows the
            missing-rating precedent (REQ-091), not the genre one.

            The `/ep` suffix on TV comes from `formatRuntime`; see its comment
            for why a bare `45m` beside a nine-season series is a false
            statement rather than a terse one.
          */}
              <span className="title-row__runtime" data-testid="runtime">
                {formatRuntime(item.runtimeMinutes, item.mediaType) ?? RUNTIME_UNKNOWN_LABEL}
              </span>
            </span>
            <GenreChips genres={item.genres} activeGenres={activeGenres} />
          </p>
        </div>

        <div
          className="title-row__watch"
          data-watching={item.watching === true || undefined}
          data-priority={item.priority ?? 'normal'}
        >
          {onWatchPreferences ? (
            <Button
              disabled={busy}
              aria-haspopup="dialog"
              aria-label={`Watch preferences for ${item.name}: ${item.watching ? 'Watching, ' : ''}${WATCH_PRIORITY_LABELS[item.priority ?? 'normal']}`}
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                onWatchPreferences(item);
              }}
            >
              <span className="title-row__priority">
                {WATCH_PRIORITY_LABELS[item.priority ?? 'normal']}
              </span>
              <ChevronIcon />
            </Button>
          ) : (
            <span>{WATCH_PRIORITY_LABELS[item.priority ?? 'normal']}</span>
          )}
        </div>

        {/*
          REQ-091 - "no rating" is a FIRST-CLASS RENDERED STATE, and the two
          branches below are the whole requirement:

          - a rating renders as `IMDb 8.7`, always to one decimal place. The
            server stores tenths as an integer precisely so 8.8 does not arrive
            as 8.800000000000001, and `toFixed(1)` keeps `8` from rendering as
            a bare "8" that reads like a different, coarser scale.
          - no rating renders the WORDS. Never `0`, never `0.0`, never an empty
            star row (REQ-091) - each of those is a claim about the film rather
            than an absence of data, and `0` in particular reads as the worst
            rating possible.

          ⚠ It is NOT omitted the way an empty genre list is. A missing rating
          and a rating of nothing look identical when the element simply is not
          there, and the owner would be left wondering whether nextup failed.
        */}
        {item.imdbRating == null ? (
          <p
            className="title-row__rating title-row__rating--absent"
            data-testid="imdb-rating-absent"
          >
            {IMDB_RATING_ABSENT}
          </p>
        ) : (
          <p className="title-row__rating" data-testid="imdb-rating">
            <span className="title-row__rating-source">{IMDB_RATING_SOURCE}</span>{' '}
            <span data-testid="imdb-rating-value">{item.imdbRating.toFixed(1)}</span>
          </p>
        )}

        <div className="title-row__footer">
          {/*
          Verbatim from the API. Rendered only when the API supplied one: with
          no listings there is no date, and inventing "Added today" here would
          state something false about when the work entered nextup.
        */}
          {item.dateAddedLabel !== null && (
            <p className="title-row__date" data-testid="date-added-label">
              {item.dateAddedLabel}
            </p>
          )}

          <ul className="title-row__badges" data-testid="badges">
            {item.badges.map((badge) => (
              // The mark carries recognition on screen; the service name is
              // still in the DOM, visually hidden, so the badge keeps its
              // accessible name and stays findable by in-page text search
              // (§2.2a, ADR-0014). Colour is never the sole carrier of meaning.
              <li key={badge.listingId} data-testid={`badge-${badge.service}`}>
                <Badge>
                  <ServiceMark service={badge.service} nameHidden />
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="title-row__actions">
        {/*
          ⚠ THE SPINNER IS RENDERED, NOT IMPLIED BY THE DIM. §2.13 asks for
          both, and the dim alone is a colour-only state that says nothing
          about *why* the row looks different — "greyed out" and "saving" are
          indistinguishable at a glance, and the first invites a reload.
          It carries text, not just a class: an unlabelled spinning glyph is
          silent to a screen reader, and `aria-busy` on the row announces a
          state without ever naming the action.
        */}
        {busy && (
          <span role="status" className="title-row__spinner" data-testid="row-pending">
            {ROW_PENDING_LABEL}
          </span>
        )}
        {/*
          ⚠ THE AFFORDANCE IS CONDITIONAL ON A HANDLER, AND THAT IS THE POINT.
          Rendering the `⋮` unconditionally is what let the row menu ship
          inert for the whole of Epics I and J: `ListPage` passed no callbacks,
          every click optional-chained to `undefined`, and a present, focusable,
          correctly-labelled button satisfied every a11y and tap-target sweep
          while doing nothing. A button that cannot act must not be drawn.
        */}
        {unmatched
          ? onFixMatch !== undefined && (
              <Button
                variant="ghost"
                // ⚠ DISABLED ON THIS ROW ONLY. A second write against a row
                // whose first is still in flight is the double-submit §2.13
                // exists to prevent; disabling the whole LIST instead is the
                // failure mode it names in the same sentence.
                disabled={busy}
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  onFixMatch(item);
                }}
              >
                Find a match
              </Button>
            )
          : onOpenMenu !== undefined && (
              <span className="title-row__menu">
                {/*
                  ⚠ THE CLASS IS ON THIS WRAPPER, NOT ON THE BUTTON. It carries
                  `flex: 0 0 auto` — layout, which belongs to the parent —
                  while the button's appearance now comes from the §7d
                  primitive. Folding a flex rule into a variant is how a fifth
                  variant appears that differs from the first only in where it
                  sits. The 44 px floor rides on the primitive via
                  `.tap-target`, shared with the nav so it is defined once.
                */}
                <Button
                  variant="ghost"
                  aria-haspopup="menu"
                  aria-label={`Actions for ${item.name}`}
                  data-testid="row-menu"
                  disabled={busy}
                  onClick={(event) => {
                    event.currentTarget.focus({ preventScroll: true });
                    onOpenMenu(item);
                  }}
                >
                  {/*
                    ⚠ THE ICON IS DECORATIVE ON PURPOSE — no `label` prop. The
                    button above already carries `aria-label`, and §7c's rule is
                    that an icon is never the SOLE label but must never double
                    as a second one: naming the glyph here makes a reader
                    announce "Actions for Dune, More". `MoreIcon` was authored
                    for this call site as well as REQ-117's overflow (see its
                    header) and is the only `more` in the closed v1 set, so the
                    row and the nav cannot drift apart.

                    ⚠ IT REPLACES A LITERAL `⋮` CHARACTER, which was never a
                    styling detail. A text glyph is announced by screen readers
                    as whatever the voice makes of U+22EE, renders in whatever
                    the system font has at that codepoint, and cannot inherit
                    `stroke-width` — so it was the one control in the product
                    that visibly predated REQ-124.
                  */}
                  <MoreIcon />
                </Button>
              </span>
            )}
        {/*
          REQ-105 — THE OPEN MENU RENDERS HERE, INSIDE THE ROW.

          ⚠ **This slot is the entire fix, and it is structural.** The menu used
          to be mounted by `ListPage` as a SIBLING of `<TitleList>`, after the
          load-more sentinel, so it appeared at the bottom of the page however
          far up the list the owner had tapped. `index.css` had already declared
          the containing block for it — on an element the menu was never a
          descendant of — which is why no CSS change could ever have fixed this
          and why both CSS-shaped attempts are wrong: `position: absolute`
          resolves against the page, and `position: fixed` just relocates the
          same detachment to the viewport and then breaks on scroll.

          It is a `ReactNode` slot rather than the menu's own props because
          `TitleRow` must not learn what the menu items are: the row renders a
          title, and every decision about which actions exist (including
          `canRemove`'s deliberate `false` default) stays with `ListPage`.
        */}
        {menu}
      </div>
    </li>
  );
}
