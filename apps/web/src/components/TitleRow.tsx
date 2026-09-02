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

import type { JSX } from 'react';
import { SERVICE_LABELS, type Service } from '@nextup/domain';

import {
  IMDB_RATING_ABSENT,
  IMDB_RATING_SOURCE,
  METADATA_STALE_CHIP,
  ROW_PENDING_LABEL,
} from '../copy';

/** `specs/ui.md` §2.2 - the poster size the row requests. */
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w154';

/** One active listing (`specs/api.md` §6.2 `badges[]`). */
export interface TitleBadge {
  readonly service: Service;
  readonly listingId: string;
  readonly dateAdded: string;
}

/** An item of `GET /api/titles` (`specs/api.md` §6.2). */
export interface TitleListItem {
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
}

const MEDIA_TYPE_LABELS: Readonly<Record<TitleListItem['mediaType'], string>> = {
  movie: 'Movie',
  tv: 'TV',
};

export function TitleRow({ item, onOpenMenu, onFixMatch, pending }: TitleRowProps): JSX.Element {
  const unmatched = item.matchState === 'unmatched';
  const busy = pending === true;

  return (
    // ⚠ `id` IS A LINK TARGET, not decoration (TASK-076). v1 has no
    // title-detail route, so `ux-states.md` §9.4's "each entry linking to the
    // title" resolves to `/#title-<titleId>` — this anchor. Removing it turns
    // every provenance link into a no-op that still looks like a link.
    <li
      className="title-row"
      id={`title-${item.titleId}`}
      data-testid={`title-row-${item.titleId}`}
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
          // Decorative: the name sits next to it as real text, so announcing
          // the poster too would make a screen reader say the title twice.
          alt=""
        />
      )}

      <div className="title-row__body">
        <h2 className="title-row__name" data-testid="title-name">
          {item.name}
        </h2>

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

        <p className="title-row__meta" data-testid="title-meta">
          <span data-testid="media-type">{MEDIA_TYPE_LABELS[item.mediaType]}</span>
          {item.releaseYear !== null && <span data-testid="release-year">{item.releaseYear}</span>}
          {/*
            US-019 AC-6: an empty genre list renders NOTHING - not "Unknown",
            not "-". A placeholder would read as a fact about the work rather
            than an absence of data, and the owner cannot tell the difference.
          */}
          {item.genres.length > 0 && <span data-testid="genres">{item.genres.join(', ')}</span>}
        </p>

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
            // Text-labelled, never colour-only (§2.2, ui.md §10.2): colour is
            // never the sole carrier of meaning.
            <li key={badge.listingId} data-testid={`badge-${badge.service}`}>
              {SERVICE_LABELS[badge.service]}
            </li>
          ))}
        </ul>
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
              <button
                type="button"
                className="title-row__action tap-target"
                // ⚠ DISABLED ON THIS ROW ONLY. A second write against a row
                // whose first is still in flight is the double-submit §2.13
                // exists to prevent; disabling the whole LIST instead is the
                // failure mode it names in the same sentence.
                disabled={busy}
                onClick={() => {
                  onFixMatch(item);
                }}
              >
                Find a match
              </button>
            )
          : onOpenMenu !== undefined && (
              <button
                type="button"
                // `tap-target` carries the §2.2 44x44 px minimum, shared with the
                // nav so the floor is defined in one place.
                className="title-row__menu tap-target"
                aria-haspopup="menu"
                aria-label={`Actions for ${item.name}`}
                data-testid="row-menu"
                disabled={busy}
                onClick={() => {
                  onOpenMenu(item);
                }}
              >
                ⋮
              </button>
            )}
      </div>
    </li>
  );
}
