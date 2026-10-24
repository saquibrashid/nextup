/**
 * Edit one finished-watching record from Recently watched (US-074, `A66`):
 * correct the date, change or clear the rating, mark it not finished, or
 * return a title the owner set aside to the Library.
 *
 * ⚠ **A RECORD IS NEVER DELETED.** "Not finished" clears the flag and keeps the
 * date and rating, so marking it finished again restores them. The row simply
 * leaves this view, which lists what is finished.
 */

import { useId, useState, type JSX } from 'react';

import {
  FINISHED_NOT_FINISHED,
  FINISHED_RETURN_ACTION,
  FINISHED_SAVE_CHANGES,
  FINISHED_SAVE_FAILED,
  OFFLINE_DISABLED_REASON,
  WATCHED_EDIT_TITLE,
  WATCHED_SEASON_LABEL,
} from '../copy';
import { ApiError, type ApiClient, type WatchedHistoryItem } from '../lib/apiClient';
import { StarRating, WatchedDateField, todayIso } from './WatchedFields';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

export type WatchedEditApi = Pick<
  ApiClient,
  'editWatched' | 'unfinishWatched' | 'setLibraryHidden'
>;

/** What changed, so the page can update its row without refetching. */
export type WatchedEditResult =
  | { readonly kind: 'saved'; readonly watchedOn: string | null; readonly rating: number | null }
  | { readonly kind: 'unfinished' }
  | { readonly kind: 'returned' };

export interface WatchedEditDialogProps {
  readonly item: WatchedHistoryItem;
  readonly api: WatchedEditApi;
  readonly offline?: boolean;
  readonly onClose: () => void;
  readonly onChanged: (result: WatchedEditResult) => void;
}

export function WatchedEditDialog({
  item,
  api,
  offline = false,
  onClose,
  onChanged,
}: WatchedEditDialogProps): JSX.Element {
  const headingId = useId();
  const groupName = useId();
  const [date, setDate] = useState(item.watchedOn ?? todayIso());
  const [unknown, setUnknown] = useState(item.watchedOn === null);
  const [rating, setRating] = useState<number | null>(item.rating);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy || offline;

  const run = (work: () => Promise<WatchedEditResult>): void => {
    setBusy(true);
    setError(null);
    work().then(
      (result) => {
        setBusy(false);
        onChanged(result);
      },
      (caught: unknown) => {
        setBusy(false);
        setError(
          caught instanceof ApiError && caught.code !== 'INTERNAL_ERROR'
            ? caught.message
            : FINISHED_SAVE_FAILED,
        );
      },
    );
  };

  return (
    <Dialog
      aria-labelledby={headingId}
      onDismiss={() => {
        if (!busy) onClose();
      }}
    >
      <div className="finished-dialog" data-testid="watched-edit-dialog">
        <h2 id={headingId}>{WATCHED_EDIT_TITLE}</h2>
        <p className="finished-dialog__name">
          {item.seasonNumber > 0
            ? `${item.titleName} · ${WATCHED_SEASON_LABEL.replace('{n}', String(item.seasonNumber))}`
            : item.titleName}
        </p>
        <WatchedDateField
          date={date}
          unknown={unknown}
          disabled={disabled}
          onChange={(next) => {
            setDate(next.date);
            setUnknown(next.unknown);
          }}
        />
        <StarRating value={rating} onChange={setRating} name={groupName} disabled={disabled} />
        {error !== null && (
          <p role="alert" data-testid="watched-edit-error">
            {error}
          </p>
        )}
        {offline && <p className="offline-reason">{OFFLINE_DISABLED_REASON}</p>}
        <div className="finished-dialog__actions">
          <Button
            variant="primary"
            data-testid="watched-edit-save"
            disabled={disabled}
            onClick={() => {
              const watchedOn = unknown || date === '' ? null : date;
              run(async () => {
                await api.editWatched(item.workIdentity, item.seasonNumber, { watchedOn, rating });
                return { kind: 'saved', watchedOn, rating };
              });
            }}
          >
            {FINISHED_SAVE_CHANGES}
          </Button>
          <Button
            variant="secondary"
            data-testid="watched-edit-unfinish"
            disabled={disabled}
            onClick={() => {
              run(async () => {
                await api.unfinishWatched(item.workIdentity, item.seasonNumber);
                return { kind: 'unfinished' };
              });
            }}
          >
            {FINISHED_NOT_FINISHED}
          </Button>
          {item.leftLibrary && item.titleId !== null && (
            <Button
              variant="secondary"
              data-testid="watched-edit-return"
              disabled={disabled}
              onClick={() => {
                const titleId = item.titleId;
                if (titleId === null) return;
                run(async () => {
                  await api.setLibraryHidden(titleId, false);
                  return { kind: 'returned' };
                });
              }}
            >
              {FINISHED_RETURN_ACTION}
            </Button>
          )}
          <Button
            variant="secondary"
            data-testid="watched-edit-close"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
