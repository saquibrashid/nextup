import { useEffect, useRef, useState, type JSX, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { releaseYearText, watchStatus, TITLE_CATEGORY_LABELS } from '@nextup/domain';
import { TitleCategoryDialog } from '../components/TitleCategoryDialog';
import { EditionLabels } from '../components/EditionLabels';
import {
  TitleDetailSections,
  TitleHeroFacts,
  TrailerLink,
} from '../components/TitleDetailSections';
import type { ApiClient, TitleDetailResponse } from '../lib/apiClient';
import { Button } from '../components/ui/Button';
import { ServiceMark } from '../components/ServiceMark';
import { TMDB_IMAGE_BASE_2X } from '../components/TitleRow';
import { WatchPreferencesDialog } from '../components/WatchPreferencesDialog';
import { FixMatchDialog } from '../components/FixMatchDialog';
import { SuppressDialog } from '../components/SuppressDialog';
import { RemoveTitleDialog } from '../components/RemoveTitleDialog';
import { OFFLINE_DISABLED_REASON, WATCH_STATUS_LABELS } from '../copy';

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
    | 'updateTitleCategory'
  >;
}

export function TitleDetailsPage({
  item,
  backTo,
  offline,
  onReload,
  actions,
}: TitleDetailsPageProps): JSX.Element {
  const [dialog, setDialog] = useState<'watch' | 'fix' | 'suppress' | 'remove' | 'category' | null>(
    null,
  );
  const [changed, setChanged] = useState(false);
  const [artFailed, setArtFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  const presentation = item.presentation ?? { status: 'unavailable', data: null };
  const data = presentation.data;
  const active = item.listState !== 'removed' && item.listState !== 'suppressed';
  const unidentified = item.matchState === 'unmatched';
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
        Back to Library
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
            {item.category
              ? TITLE_CATEGORY_LABELS[item.category]
              : unidentified
                ? 'Unidentified title'
                : item.mediaType === 'tv'
                  ? 'TV series'
                  : 'Movie'}
            {item.releaseYear !== null &&
              ` · ${releaseYearText(item.releaseYear, (item.editionLabels?.length ?? 0) > 0)}`}
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {item.name}
          </h1>
          <EditionLabels labels={item.editionLabels} />
          {(item.editionLabels?.length ?? 0) > 0 && (
            <p>
              Year, runtime, artwork and ratings describe the original catalogue film, not a
              separately catalogued edition.
            </p>
          )}
          <TitleHeroFacts
            runtimeMinutes={item.runtimeMinutes}
            mediaType={item.mediaType}
            genres={item.genres}
            imdbRating={item.imdbRating}
          />
          <TrailerLink data={data} name={item.name} />
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
              No longer in your library. <Link to="/removed">View removal history</Link>
            </p>
          ) : (
            <>
              <p>{WATCH_STATUS_LABELS[watchStatus(item)]}</p>
              <div className="title-details__actions" aria-label="Title actions">
                <Button variant="secondary" onClick={open('category')} disabled={offline}>
                  Title category
                </Button>
                <Button variant="secondary" onClick={open('watch')} disabled={offline}>
                  Watch status
                </Button>
                <Button variant="secondary" onClick={open('fix')} disabled={offline}>
                  {unidentified ? 'Find a match' : 'Fix match'}
                </Button>
                <Button variant="secondary" onClick={open('suppress')} disabled={offline}>
                  Not interested
                </Button>
                <Button variant="secondary" onClick={open('remove')} disabled={offline}>
                  Remove from library
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
        <TitleDetailSections
          presentation={presentation}
          mediaType={item.mediaType}
          offline={offline}
          onReload={onReload}
        />
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
      {active && dialog === 'category' && (
        <TitleCategoryDialog
          item={item}
          save={(titleId, body) => actions.updateTitleCategory(titleId, body)}
          offline={offline}
          onClose={close}
          onSaved={() => {
            setDialog(null);
            onReload();
          }}
        />
      )}
      {active && dialog === 'fix' && (
        <FixMatchDialog
          editionLabels={item.editionLabels}
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
