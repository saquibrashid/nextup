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

import { IMDB_RATING_ABSENT, IMDB_RATING_SOURCE } from '../copy';

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
}

const MEDIA_TYPE_LABELS: Readonly<Record<TitleListItem['mediaType'], string>> = {
  movie: 'Movie',
  tv: 'TV',
};

export function TitleRow({ item, onOpenMenu, onFixMatch }: TitleRowProps): JSX.Element {
  const unmatched = item.matchState === 'unmatched';

  return (
    // ⚠ `id` IS A LINK TARGET, not decoration (TASK-076). v1 has no
    // title-detail route, so `ux-states.md` §9.4's "each entry linking to the
    // title" resolves to `/#title-<titleId>` — this anchor. Removing it turns
    // every provenance link into a no-op that still looks like a link.
    <li
      className="title-row"
      id={`title-${item.titleId}`}
      data-testid={`title-row-${item.titleId}`}
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
