// `/waiting/:titleId` — one waiting title in full (#391).
//
// The Library details page's layout and its shared sections
// (`TitleDetailSections`), with the waiting row's own answer — the streaming
// invitation or the forecast, and the availability and discovery lines — in
// place of the Library's saved services and owner actions.
//
// ⚠ NOTHING HERE ADDS TO THE LIBRARY (US-042 AC-3, product invariant 5). The
// only write is Not interested, which is the ordinary `suppressTitle` keyed on
// work identity, exactly as on the waiting list.
//
// ⚠ THE JUSTWATCH AND WATCHMODE ATTRIBUTIONS ARE CONDITIONS OF USE on every
// surface that renders availability or a forecast, so they are unconditional
// here too.

import { useEffect, useRef, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { WATCHMODE_ATTRIBUTION, WATCHMODE_ATTRIBUTION_URL, releaseYearText } from '@nextup/domain';

import { EditionLabels } from '../components/EditionLabels';
import {
  TitleDetailSections,
  TitleHeroFacts,
  TrailerLink,
} from '../components/TitleDetailSections';
import { TMDB_IMAGE_BASE_2X } from '../components/TitleRow';
import { SuppressedIcon } from '../components/icons';
import { Button } from '../components/ui/Button';
import {
  JUSTWATCH_ATTRIBUTION,
  OFFLINE_DISABLED_REASON,
  RETRY_LABEL,
  WAITING_NOT_INTERESTED,
  WAITING_RENT_ONLY_TAG,
  WAITING_SUPPRESS_FAILED,
  WATCHMODE_ATTRIBUTION_LINK,
} from '../copy';
import type { TitleDetailResponse, WaitingItem } from '../lib/apiClient';
import { WaitingFacts, WaitingOutlook, rentOnlyStores } from './WaitingPage';

export interface WaitingDetailsPageProps {
  readonly item: WaitingItem;
  readonly title: TitleDetailResponse;
  readonly offline: boolean;
  readonly onReload: () => void;
  readonly onSuppress: (titleId: string) => Promise<unknown>;
  readonly onSuppressed: () => void;
}

export function WaitingDetailsPage({
  item,
  title,
  offline,
  onReload,
  onSuppress,
  onSuppressed,
}: WaitingDetailsPageProps): JSX.Element {
  const [artFailed, setArtFailed] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  const presentation = title.presentation ?? { status: 'unavailable', data: null };
  const posterPath = title.posterPath ?? item.posterPath;
  const releaseYear = title.releaseYear ?? item.releaseYear;
  const editionLabels = item.editionLabels ?? title.editionLabels;

  function suppress(): void {
    setPhase('submitting');
    onSuppress(item.titleId).then(onSuppressed, () => setPhase('error'));
  }

  return (
    <article className="title-details" data-testid="waiting-details">
      <Link className="tap-target" to="/waiting">
        Back to Waiting to stream
      </Link>
      <div className="title-details__hero">
        {posterPath !== null && !artFailed ? (
          <img
            className="title-details__poster"
            src={`${TMDB_IMAGE_BASE_2X}${posterPath}`}
            alt=""
            onError={() => setArtFailed(true)}
          />
        ) : (
          <div className="title-details__poster title-details__poster--empty">
            No artwork available
          </div>
        )}
        <div className="title-details__identity">
          <p className="title-details__eyebrow">
            {title.mediaType === 'tv' ? 'TV series' : 'Movie'}
            {releaseYear !== null &&
              ` · ${releaseYearText(releaseYear, (editionLabels?.length ?? 0) > 0)}`}
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {item.name}
          </h1>
          <EditionLabels labels={editionLabels} />
          <TitleHeroFacts
            runtimeMinutes={title.runtimeMinutes}
            mediaType={title.mediaType}
            genres={title.genres}
            imdbRating={title.imdbRating}
          />
          <TrailerLink data={presentation.data} name={item.name} />

          <section className="waiting-details__access" aria-label="Where to watch">
            {rentOnlyStores(item) !== null && (
              <span className="waiting-row__pill" data-testid="waiting-rent-tag">
                {WAITING_RENT_ONLY_TAG}
              </span>
            )}
            <WaitingOutlook item={item} />
            <WaitingFacts item={item} full />
          </section>

          <div className="title-details__actions" aria-label="Title actions">
            <Button
              variant="secondary"
              data-testid="waiting-not-interested"
              aria-label={`${WAITING_NOT_INTERESTED}: ${item.name}`}
              disabled={offline || phase === 'submitting'}
              onClick={suppress}
            >
              <SuppressedIcon />
              {phase === 'error' ? RETRY_LABEL : WAITING_NOT_INTERESTED}
            </Button>
          </div>
          {phase === 'error' && (
            <p role="alert" data-testid="waiting-suppress-error">
              {WAITING_SUPPRESS_FAILED}
            </p>
          )}
          {offline && <p>{OFFLINE_DISABLED_REASON} Showing details loaded earlier.</p>}
        </div>
      </div>

      <TitleDetailSections
        presentation={presentation}
        mediaType={title.mediaType}
        offline={offline}
        onReload={onReload}
      />

      <p className="justwatch-attribution" data-testid="justwatch-attribution">
        {JUSTWATCH_ATTRIBUTION}
      </p>
      <p className="watchmode-attribution" data-testid="watchmode-attribution">
        {WATCHMODE_ATTRIBUTION}{' '}
        <a href={WATCHMODE_ATTRIBUTION_URL} target="_blank" rel="noopener noreferrer">
          {WATCHMODE_ATTRIBUTION_LINK}
        </a>
      </p>
    </article>
  );
}
