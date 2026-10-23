// `/watched` — Recently watched (US-074, `A66`).
//
// ⚠ A FACT LIST, NEVER A NUDGE. It shows what the owner finished, newest
// first, with their own rating next to the community one. Nothing here asks
// the owner to watch, rate or tidy anything.
//
// ⚠ A FAILED READ IS NEVER AN EMPTY LIST: an empty history would say nothing
// was ever finished, which is indistinguishable from the records being lost.

import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';

import {
  RETRY_LABEL,
  WATCHED_COMMUNITY_RATING,
  WATCHED_DATE_UNKNOWN,
  WATCHED_EDIT_ACTION,
  WATCHED_EMPTY_BODY,
  WATCHED_EMPTY_TITLE,
  WATCHED_LEFT_LIBRARY,
  WATCHED_PAGE_SUBTITLE,
  WATCHED_PAGE_TITLE,
  WATCHED_SEASON_LABEL,
  WATCHED_YOUR_RATING,
} from '../copy';
import type { WatchedHistoryItem } from '../lib/apiClient';
import { LoadMoreSentinel } from '../components/LoadMoreSentinel';
import { TMDB_IMAGE_BASE } from '../components/TitleRow';
import { WatchedEditDialog, type WatchedEditApi } from '../components/WatchedEditDialog';
import { ratingText, watchedDateText } from '../components/WatchedFields';
import { Button } from '../components/ui/Button';
import { useOnline } from '../lib/useOnline';

export interface WatchedPageProps {
  readonly items?: readonly WatchedHistoryItem[];
  readonly loading?: boolean;
  readonly loadFailed?: boolean;
  readonly hasMore?: boolean;
  readonly loadingMore?: boolean;
  readonly loadMoreFailed?: boolean;
  readonly onLoadMore?: () => void;
  readonly onRetry?: () => void;
  readonly api?: WatchedEditApi;
}

const keyOf = (item: WatchedHistoryItem): string => `${item.workIdentity}#${item.seasonNumber}`;

export function WatchedPage({
  items = [],
  loading = false,
  loadFailed = false,
  hasMore = false,
  loadingMore = false,
  loadMoreFailed = false,
  onLoadMore = () => undefined,
  onRetry,
  api,
}: WatchedPageProps): JSX.Element {
  const offline = !useOnline();
  // Local overlay so an edit shows at once without refetching the page.
  const [edits, setEdits] = useState<ReadonlyMap<string, Partial<WatchedHistoryItem> | 'gone'>>(
    new Map(),
  );
  const [editing, setEditing] = useState<WatchedHistoryItem | null>(null);

  const visible = items.flatMap((item) => {
    const edit = edits.get(keyOf(item));
    if (edit === 'gone') return [];
    return [edit === undefined ? item : { ...item, ...edit }];
  });

  const patch = (item: WatchedHistoryItem, change: Partial<WatchedHistoryItem> | 'gone'): void => {
    setEdits((previous) => new Map(previous).set(keyOf(item), change));
  };

  return (
    <>
      <h1>{WATCHED_PAGE_TITLE}</h1>
      <p data-testid="watched-subtitle">{WATCHED_PAGE_SUBTITLE}</p>

      {loadFailed ? (
        <div role="alert" data-testid="watched-load-error">
          <p>{'Couldn\u2019t load your watched history. Nothing has changed.'}</p>
          {onRetry !== undefined && (
            <Button variant="secondary" onClick={onRetry}>
              {RETRY_LABEL}
            </Button>
          )}
        </div>
      ) : loading ? (
        <div role="status" data-testid="watched-loading" aria-label="Loading watched history">
          <ul className="watched-list">
            {[0, 1, 2].map((index) => (
              <li key={index} className="watched-row watched-row--skeleton" aria-hidden="true" />
            ))}
          </ul>
        </div>
      ) : visible.length === 0 && !hasMore ? (
        <div data-testid="watched-empty">
          <p>{WATCHED_EMPTY_TITLE}</p>
          <p>{WATCHED_EMPTY_BODY}</p>
          <Link className="tap-target" to="/">
            Back to your Library
          </Link>
        </div>
      ) : (
        <ul className="watched-list" data-testid="watched-list">
          {visible.map((item) => (
            <li key={keyOf(item)} className="watched-row" data-testid="watched-row">
              {item.posterPath !== null ? (
                <img
                  className="watched-row__poster"
                  src={`${TMDB_IMAGE_BASE}${item.posterPath}`}
                  alt=""
                />
              ) : (
                <div className="watched-row__poster watched-row__poster--empty" />
              )}
              <div className="watched-row__body">
                <span className="watched-row__name" data-testid="watched-name">
                  {item.titleName}
                  {item.releaseYear !== null ? ` (${item.releaseYear})` : ''}
                </span>
                {item.seasonNumber > 0 && (
                  <span data-testid="watched-season">
                    {WATCHED_SEASON_LABEL.replace('{n}', String(item.seasonNumber))}
                  </span>
                )}
                <span data-testid="watched-date">
                  {item.watchedOn === null ? WATCHED_DATE_UNKNOWN : watchedDateText(item.watchedOn)}
                </span>
                <span data-testid="watched-ratings">
                  {`${WATCHED_YOUR_RATING}: ${ratingText(item.rating)}`}
                  {item.imdbRatingTenths !== null &&
                    ` · ${WATCHED_COMMUNITY_RATING} ${(item.imdbRatingTenths / 10).toFixed(1)}`}
                </span>
                {item.leftLibrary && (
                  <span className="watched-row__note" data-testid="watched-left-library">
                    {WATCHED_LEFT_LIBRARY}
                  </span>
                )}
                {api !== undefined && (
                  <Button
                    variant="secondary"
                    data-testid="watched-edit"
                    aria-label={`${WATCHED_EDIT_ACTION} ${item.titleName}`}
                    disabled={offline}
                    onClick={() => setEditing(item)}
                  >
                    {WATCHED_EDIT_ACTION}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loadFailed && !loading && (
        <LoadMoreSentinel
          hasMore={hasMore}
          loadingMore={loadingMore}
          loadMoreFailed={loadMoreFailed}
          onLoadMore={onLoadMore}
        />
      )}

      {editing !== null && api !== undefined && (
        <WatchedEditDialog
          item={editing}
          api={api}
          offline={offline}
          onClose={() => setEditing(null)}
          onChanged={(result) => {
            if (result.kind === 'saved') {
              patch(editing, { watchedOn: result.watchedOn, rating: result.rating });
            } else if (result.kind === 'unfinished') {
              patch(editing, 'gone');
            } else {
              patch(editing, { leftLibrary: false });
            }
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
