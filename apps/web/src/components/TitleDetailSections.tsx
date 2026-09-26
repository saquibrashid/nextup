// #391 — the parts of a details page shared by the Library (`/titles/:id`)
// and Waiting to stream (`/waiting/:id`). One implementation, so the two
// pages can never disagree about what a title's details are.
//
// ⚠ THE TRAILER IS A LINK OUT, NEVER AN EMBED. An embedded player would load
// third-party script and cookies into nextup (no telemetry, CSP unchanged);
// a link opens YouTube in a new tab and loads nothing here.

import { useState, type JSX } from 'react';
import {
  formatRuntime,
  normaliseGenres,
  trailerUrl,
  type TitlePresentationResult,
} from '@nextup/domain';
import { formatDateShort } from '../pages/RemovedPage';
import { Button } from './ui/Button';

type Presentation = TitlePresentationResult['data'];

/** Runtime, genres and IMDb rating — the hero's fact lines. */
export function TitleHeroFacts({
  runtimeMinutes,
  mediaType,
  genres,
  imdbRating,
}: {
  readonly runtimeMinutes: number | null;
  readonly mediaType: 'movie' | 'tv' | null;
  readonly genres: readonly string[];
  readonly imdbRating: number | null | undefined;
}): JSX.Element {
  return (
    <>
      <p>
        {(mediaType === null ? null : formatRuntime(runtimeMinutes, mediaType)) ??
          'Runtime not available'}
      </p>
      {genres.length > 0 && <p>{normaliseGenres([...genres]).join(' · ')}</p>}
      <p className="title-details__rating">
        {imdbRating == null ? 'IMDb rating not available' : `IMDb ${imdbRating.toFixed(1)} / 10`}
      </p>
    </>
  );
}

/** The most current trailer, or nothing at all when TMDB has none. */
export function TrailerLink({
  data,
  name,
}: {
  readonly data: Presentation;
  readonly name: string;
}): JSX.Element | null {
  const trailer = data?.trailer;
  if (trailer == null) return null;
  const label = trailer.kind === 'Teaser' ? 'Watch teaser' : 'Watch trailer';
  return (
    <a
      className="title-details__trailer"
      href={trailerUrl(trailer)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} for ${name} (opens YouTube in a new tab)`}
      data-testid="title-trailer"
    >
      <span className="title-details__play" aria-hidden="true" />
      {label}
    </a>
  );
}

/** The labelled facts beyond synopsis and credits, each only when known. */
function detailFacts(
  data: NonNullable<Presentation>,
): readonly { readonly term: string; readonly value: string }[] {
  const tv = data.mediaType === 'tv';
  const facts: { term: string; value: string }[] = [];
  if (data.releaseDate != null) {
    facts.push({
      term: tv ? 'First aired' : 'Released',
      value: formatDateShort(data.releaseDate),
    });
  }
  if (data.status != null) facts.push({ term: 'Status', value: data.status });
  if (data.certification != null) facts.push({ term: 'Rated', value: data.certification });
  if (data.seasons != null) facts.push({ term: 'Seasons', value: String(data.seasons) });
  if (data.episodes != null) facts.push({ term: 'Episodes', value: String(data.episodes) });
  if ((data.writers ?? []).length > 0) {
    facts.push({ term: 'Writers', value: (data.writers ?? []).join(', ') });
  }
  return facts;
}

/** Notice, synopsis, credits, cast and details — below the hero. */
export function TitleDetailSections({
  presentation,
  mediaType,
  offline,
  onReload,
}: {
  readonly presentation: TitlePresentationResult;
  readonly mediaType: string | null;
  readonly offline: boolean;
  readonly onReload: () => void;
}): JSX.Element {
  const [allCast, setAllCast] = useState(false);
  const data = presentation.data;
  const cast = data?.cast ?? [];
  const facts = data === null ? [] : detailFacts(data);
  return (
    <>
      {(presentation.status === 'stale' || presentation.status === 'unavailable') && (
        <div className="title-details__notice" role="status">
          <p>
            {presentation.status === 'stale'
              ? 'Showing cached synopsis and credits. They could not be refreshed.'
              : 'Synopsis and credits are temporarily unavailable. Your saved title is unchanged.'}
          </p>
          <Button variant="secondary" onClick={onReload} disabled={offline}>
            Retry details
          </Button>
        </div>
      )}
      <section className="title-details__section">
        <h2>Synopsis</h2>
        {data?.tagline != null && (
          <p className="title-details__tagline" data-testid="title-tagline">
            {data.tagline}
          </p>
        )}
        <p className="title-details__synopsis">{data?.overview ?? 'No synopsis available.'}</p>
      </section>
      <section className="title-details__section">
        <h2>{mediaType === 'tv' ? 'Creators' : 'Directors'}</h2>
        <p>
          {(mediaType === 'tv' ? data?.creators : data?.directors)?.join(', ') ||
            'No credits available.'}
        </p>
      </section>
      <section className="title-details__section">
        <h2>Cast</h2>
        {cast.length === 0 ? (
          <p>No cast information available.</p>
        ) : (
          <ul className="title-details__cast" id="title-cast">
            {(allCast ? cast : cast.slice(0, 8)).map((person, index) => (
              <li key={`${person.name}:${String(index)}`}>
                <strong>{person.name}</strong>
                <span>{person.character ?? 'Character not listed'}</span>
              </li>
            ))}
          </ul>
        )}
        {cast.length > 8 && (
          <Button
            variant="secondary"
            aria-expanded={allCast}
            aria-controls="title-cast"
            onClick={() => setAllCast((shown) => !shown)}
          >
            {allCast ? 'Show less cast' : `Show all ${String(cast.length)} cast members`}
          </Button>
        )}
      </section>
      {/* #391 — hidden, not empty, when TMDB published none of these. */}
      {facts.length > 0 && (
        <section className="title-details__section" data-testid="title-facts">
          <h2>Details</h2>
          <dl className="title-details__facts">
            {facts.map((fact) => (
              <div key={fact.term}>
                <dt>{fact.term}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}
