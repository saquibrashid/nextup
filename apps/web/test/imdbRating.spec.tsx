/**
 * `T-IMDB-008a`…`i` — the rating surfaces (REQ-091, REQ-092, US-045).
 *
 * ⚠ The bulk of this file guards ONE requirement: that "no rating" is a
 * rendered state and is never `0`. A component that renders `{rating}` for a
 * null rating shows nothing and looks tidy; a component that renders
 * `{rating ?? 0}` shows `0` and looks authoritative. Both are wrong and
 * neither throws.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TitleRow, type TitleListItem } from '../src/components/TitleRow';
import { RatingLookupPage, type RatingLookupResult } from '../src/pages/RatingLookupPage';
import { IMDB_RATING_ABSENT } from '../src/copy';

function item(overrides: Partial<TitleListItem> = {}): TitleListItem {
  return {
    titleId: 'ttl_1',
    workIdentity: 'tmdb:movie:603',
    matchState: 'matched',
    name: 'The Matrix',
    mediaType: 'movie',
    releaseYear: 1999,
    genres: ['Action'],
    runtimeMinutes: 136,
    posterPath: null,
    badges: [],
    sortDateAdded: '2026-01-01',
    dateAddedLabel: 'Added to nextup today',
    ...overrides,
  };
}

function result(overrides: Partial<RatingLookupResult> = {}): RatingLookupResult {
  return {
    name: 'The Matrix',
    releaseYear: 1999,
    mediaType: 'movie',
    imdbRating: 8.7,
    inList: false,
    ...overrides,
  };
}

describe('T-IMDB-008 — rating display (REQ-091)', () => {
  it('T-IMDB-008a renders a rating to one decimal place', () => {
    render(
      <ul>
        <TitleRow item={item({ imdbRating: 8.7 })} />
      </ul>,
    );

    expect(screen.getByTestId('imdb-rating-value')).toHaveTextContent('8.7');
    expect(screen.getByTestId('imdb-rating')).toHaveTextContent('IMDb');
  });

  it('T-IMDB-008b renders a whole-number rating as 8.0, not 8', () => {
    // A bare "8" beside "8.7" on the next row reads as a different, coarser
    // scale. One decimal place is what IMDb itself publishes.
    render(
      <ul>
        <TitleRow item={item({ imdbRating: 8 })} />
      </ul>,
    );

    expect(screen.getByTestId('imdb-rating-value')).toHaveTextContent('8.0');
  });

  it('T-IMDB-008c renders the WORDS for a null rating, never 0', () => {
    render(
      <ul>
        <TitleRow item={item({ imdbRating: null })} />
      </ul>,
    );

    expect(screen.getByTestId('imdb-rating-absent')).toHaveTextContent(IMDB_RATING_ABSENT);
    expect(screen.queryByTestId('imdb-rating-value')).toBeNull();
    // The three forbidden renderings of REQ-091, asserted on the row's whole
    // text rather than on one element: a `0` reaching the DOM by any route at
    // all is the defect.
    const row = screen.getByTestId('title-row-ttl_1');
    expect(row.textContent).not.toMatch(/\b0(\.0)?\b/);
  });

  it('T-IMDB-008d treats an absent field exactly like an explicit null', () => {
    // The API omits nothing today, but a row built before Epic M - or a cached
    // response - has no `imdbRating` key at all, and `undefined.toFixed` is a
    // crash, not a missing rating.
    render(
      <ul>
        <TitleRow item={item()} />
      </ul>,
    );

    expect(screen.getByTestId('imdb-rating-absent')).toBeInTheDocument();
  });

  it('T-IMDB-008e states up front that the lookup writes nothing', () => {
    render(<RatingLookupPage lookup={async () => null} />);

    expect(screen.getByTestId('rating-lookup-body').textContent).toMatch(/nothing is added/i);
  });

  it('T-IMDB-008f shows a found title with its rating', async () => {
    const user = userEvent.setup();
    render(<RatingLookupPage lookup={async () => result()} />);

    await user.type(screen.getByTestId('rating-lookup-input'), 'matrix');
    await user.click(screen.getByTestId('rating-lookup-submit'));

    expect(await screen.findByTestId('rating-lookup-rating')).toHaveTextContent('IMDb 8.7');
    expect(screen.getByTestId('rating-lookup-name')).toHaveTextContent('The Matrix (1999)');
  });

  it('T-IMDB-008g reports not-found plainly, not as an unrated result', async () => {
    // US-045 AC-3. The failure this guards is a page that renders the result
    // block with an empty name and "No IMDb rating", which reads as though a
    // film were found.
    const user = userEvent.setup();
    render(<RatingLookupPage lookup={async () => null} />);

    await user.type(screen.getByTestId('rating-lookup-input'), 'zzzz');
    await user.click(screen.getByTestId('rating-lookup-submit'));

    expect(await screen.findByTestId('rating-lookup-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('rating-lookup-result')).toBeNull();
  });

  it('T-IMDB-008h says when the work is already on the list', async () => {
    const user = userEvent.setup();
    render(<RatingLookupPage lookup={async () => result({ inList: true })} />);

    await user.type(screen.getByTestId('rating-lookup-input'), 'matrix');
    await user.click(screen.getByTestId('rating-lookup-submit'));

    expect(await screen.findByTestId('rating-lookup-in-list')).toBeInTheDocument();
  });

  it('T-IMDB-008i never leaks the upstream failure text', async () => {
    // A fetch failure message can carry the request URL, and that URL carries
    // an API key.
    const user = userEvent.setup();
    render(
      <RatingLookupPage
        lookup={async () => {
          throw new Error('fetch failed https://api.themoviedb.org/?api_key=SECRETKEY');
        }}
      />,
    );

    await user.type(screen.getByTestId('rating-lookup-input'), 'matrix');
    await user.click(screen.getByTestId('rating-lookup-submit'));

    const failed = await screen.findByTestId('rating-lookup-failed');
    expect(failed).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('SECRETKEY');
  });

  it('T-IMDB-008j does not call the lookup for an empty query', async () => {
    const user = userEvent.setup();
    const lookup = vi.fn(async () => result());
    render(<RatingLookupPage lookup={lookup} />);

    await user.click(screen.getByTestId('rating-lookup-submit'));

    expect(lookup).not.toHaveBeenCalled();
    expect(screen.queryByTestId('rating-lookup-not-found')).toBeNull();
  });
});
