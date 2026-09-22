import { useEffect, useRef, useState, type JSX, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { formatRuntime, normaliseGenres } from '@nextup/domain';
import type { ApiClient, TitleDetailResponse } from '../lib/apiClient';
import { Button } from '../components/ui/Button';
import { ServiceMark } from '../components/ServiceMark';
import { TMDB_IMAGE_BASE_2X } from '../components/TitleRow';
import { WatchPreferencesDialog } from '../components/WatchPreferencesDialog';
import { FixMatchDialog } from '../components/FixMatchDialog';
import { SuppressDialog } from '../components/SuppressDialog';
import { RemoveTitleDialog } from '../components/RemoveTitleDialog';
import { OFFLINE_DISABLED_REASON, WATCH_PRIORITY_LABELS } from '../copy';

interface TitleDetailsPageProps {
  readonly item: TitleDetailResponse;
  readonly backTo: string;
  readonly offline: boolean;
  readonly onReload: () => void;
  readonly actions: Pick<
    ApiClient,
    | 'updateWatchPreferences'
    | 'searchTmdb'
    | 'fixMatch'
    | 'suppressTitle'
    | 'unsuppress'
    | 'removeTitle'
    | 'restoreListing'
  >;
}

export function TitleDetailsPage({
  item,
  backTo,
  offline,
  onReload,
  actions,
}: TitleDetailsPageProps): JSX.Element {
  const [dialog, setDialog] = useState<'watch' | 'fix' | 'suppress' | 'remove' | null>(null);
  const [changed, setChanged] = useState(false);
  const [allCast, setAllCast] = useState(false);
  const [artFailed, setArtFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  const presentation = item.presentation ?? { status: 'unavailable', data: null };
  const data = presentation.data;
  const active = item.listState !== 'removed' && item.listState !== 'suppressed';
  const unidentified = item.matchState === 'unmatched';
  const cast = data?.cast ?? [];
  const close = (): void => {
    setDialog(null);
    if (changed) onReload();
  };
  const open =
    (kind: NonNullable<typeof dialog>) =>
    (event: MouseEvent<HTMLButtonElement>): void => {
      event.currentTarget.focus({ preventScroll: true });
      setDialog(kind);
    };

  return (
    <article className="title-details">
      <Link className="tap-target" to={backTo}>
        Back to Your list
      </Link>
      <div className="title-details__hero">
        {item.posterPath !== null && !artFailed ? (
          <img
            className="title-details__poster"
            src={`${TMDB_IMAGE_BASE_2X}${item.posterPath}`}
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
            {unidentified ? 'Unidentified title' : item.mediaType === 'tv' ? 'TV series' : 'Movie'}
            {item.releaseYear !== null && ` · ${String(item.releaseYear)}`}
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {item.name}
          </h1>
          <p>{formatRuntime(item.runtimeMinutes, item.mediaType) ?? 'Runtime not available'}</p>
          {item.genres.length > 0 && <p>{normaliseGenres(item.genres).join(' · ')}</p>}
          <p className="title-details__rating">
            {item.imdbRating == null
              ? 'IMDb rating not available'
              : `IMDb ${item.imdbRating.toFixed(1)} / 10`}
          </p>
          {item.metadataStale === true && (
            <p>Basic metadata is cached and could not be refreshed.</p>
          )}
          <div className="title-details__services" aria-label="Saved services">
            {item.badges.map((badge) => (
              <span className="title-details__service" key={badge.listingId}>
                <ServiceMark service={badge.service} />
              </span>
            ))}
            {item.badges.length === 0 && <p>No active saved services.</p>}
          </div>
          {item.dateAddedLabel !== null && <p>{item.dateAddedLabel}</p>}
          {item.listState === 'suppressed' ? (
            <p>
              Marked Not interested. <Link to="/not-interested">Manage Not interested</Link>
            </p>
          ) : item.listState === 'removed' ? (
            <p>
              No longer on your list. <Link to="/removed">View removal history</Link>
            </p>
          ) : (
            <>
              <p>
                {item.watching === true ? 'Watching · ' : ''}
                {WATCH_PRIORITY_LABELS[item.priority ?? 'normal']}
              </p>
              <div className="title-details__actions" aria-label="Title actions">
                <Button variant="secondary" onClick={open('watch')} disabled={offline}>
                  Watching and priority
                </Button>
                <Button variant="secondary" onClick={open('fix')} disabled={offline}>
                  {unidentified ? 'Find a match' : 'Fix match'}
                </Button>
                <Button variant="secondary" onClick={open('suppress')} disabled={offline}>
                  Not interested
                </Button>
                <Button variant="secondary" onClick={open('remove')} disabled={offline}>
                  Remove from list
                </Button>
              </div>
            </>
          )}
          {offline && <p>{OFFLINE_DISABLED_REASON} Showing details loaded earlier.</p>}
        </div>
      </div>
      {unidentified ? (
        <section className="title-details__section">
          <h2>More about this title</h2>
          <p>
            Find a match to see its synopsis and credits. The title and saved services above are
            retained.
          </p>
        </section>
      ) : (
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
            <p className="title-details__synopsis">{data?.overview ?? 'No synopsis available.'}</p>
          </section>
          <section className="title-details__section">
            <h2>{item.mediaType === 'tv' ? 'Creators' : 'Directors'}</h2>
            <p>
              {(item.mediaType === 'tv' ? data?.creators : data?.directors)?.join(', ') ||
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
        </>
      )}
      {active && dialog === 'watch' && (
        <WatchPreferencesDialog
          item={item}
          offline={offline}
          save={actions.updateWatchPreferences}
          onClose={close}
          onSaved={() => {
            setDialog(null);
            onReload();
          }}
        />
      )}
      {active && dialog === 'fix' && (
        <FixMatchDialog
          titleId={item.titleId}
          name={item.name}
          badges={item.badges}
          searchTmdb={actions.searchTmdb}
          fixMatch={async (id, body) => {
            const result = await actions.fixMatch(id, body);
            setChanged(true);
            return result;
          }}
          onClose={close}
        />
      )}
      {active && dialog === 'suppress' && (
        <SuppressDialog
          titleId={item.titleId}
          name={item.name}
          suppress={actions.suppressTitle}
          unsuppress={actions.unsuppress}
          onRowState={(state) => {
            if (state !== 'pending') setChanged(true);
          }}
          onClose={close}
        />
      )}
      {active && dialog === 'remove' && (
        <RemoveTitleDialog
          titleId={item.titleId}
          name={item.name}
          removeTitle={actions.removeTitle}
          restoreListing={actions.restoreListing}
          onRowState={(state) => {
            if (state !== 'pending') setChanged(true);
          }}
          onClose={close}
        />
      )}
    </article>
  );
}
