/**
 * Shared TMDB search-result rows (#371, TASK-248).
 *
 * `AddTitleDialog` and `FixMatchDialog` query the same search endpoint and
 * used to render the same unstyled `<li>`: an intrinsic-size poster followed
 * by name, year and type as adjacent inline text ("The Matrix1999Movie") and a
 * Select button wherever the text happened to end. One component keeps the
 * two pickers from drifting apart again.
 *
 * ⚠ PRESENTATION ONLY. Search, debouncing, selection and confirmation remain
 * in each dialog; this renders rows and reports which one was selected.
 *
 * ⚠ The year/type separator is CSS-generated, as in the title row
 * (`T-UX-102`/`T-UX-103`), so no "middot" enters the accessible text.
 *
 * ⚠ The Select button keeps its short accessible name and is DESCRIBED by the
 * row's title and metadata. Renaming it per row would change the name every
 * existing test and assistive-technology user relies on, while a bare
 * repeated "Select" gives no context when moving between buttons.
 */
import { useId, type JSX } from 'react';
import { releaseYearText } from '@nextup/domain';

import { EditionLabels } from './EditionLabels';
import type { TmdbSearchResult } from './FixMatchDialog';
import { Button } from './ui/Button';

/** `specs/ui.md` §2.3 poster size; rendered as a bounded 2:3 thumbnail. */
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w154';

const MEDIA_TYPE_LABELS: Record<string, string> = { movie: 'Movie', tv: 'TV' };

export function mediaTypeLabel(mediaType: string): string {
  return MEDIA_TYPE_LABELS[mediaType] ?? mediaType;
}

export function TitleSearchThumb({
  posterPath,
  testId,
}: {
  posterPath: string | null;
  testId?: string | undefined;
}): JSX.Element {
  if (posterPath === null) {
    return <span className="title-search-thumb title-search-thumb--empty" aria-hidden="true" />;
  }
  return (
    <img
      className="title-search-thumb"
      src={`${TMDB_IMAGE_BASE}${posterPath}`}
      alt=""
      width={48}
      height={72}
      loading="lazy"
      data-testid={testId}
    />
  );
}

export interface TitleSearchResultTestIds {
  list: string;
  name: string;
  year?: string | undefined;
  type?: string | undefined;
  poster?: string | undefined;
  select: (result: TmdbSearchResult) => string;
}

export function TitleSearchResults({
  results,
  onSelect,
  testIds,
}: {
  results: readonly TmdbSearchResult[];
  onSelect: (result: TmdbSearchResult) => void;
  testIds: TitleSearchResultTestIds;
}): JSX.Element {
  const baseId = useId();
  return (
    <ul className="title-search-results" data-testid={testIds.list}>
      {results.map((result, index) => {
        const detailsId = `${baseId}-${index}`;
        const year = releaseYearText(result.releaseYear, result.edition !== undefined);
        return (
          <li key={`${result.mediaType}:${result.tmdbId}`} className="title-search-result">
            <TitleSearchThumb posterPath={result.posterPath} testId={testIds.poster} />
            <div className="title-search-result__body" id={detailsId}>
              <span className="title-search-result__name" data-testid={testIds.name}>
                {result.name}
              </span>
              {result.edition !== undefined && <EditionLabels labels={[result.edition]} />}
              <span className="title-search-result__meta">
                {year !== null && <span data-testid={testIds.year}>{year}</span>}
                <span data-testid={testIds.type}>{mediaTypeLabel(result.mediaType)}</span>
              </span>
            </div>
            <div className="title-search-result__action">
              <Button
                variant="secondary"
                aria-describedby={detailsId}
                data-testid={testIds.select(result)}
                onClick={() => onSelect(result)}
              >
                Select
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
