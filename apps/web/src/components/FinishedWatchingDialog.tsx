/**
 * "Finished watching" (US-074, `A66`, #325 / #465): record that a movie, or
 * chosen seasons of a show, were watched — with an optional date and an
 * optional 1–5 rating — and then *ask* whether to take it off the Library.
 *
 * ⚠ FINISHING NEVER REMOVES ANYTHING. The record is a separate relation keyed
 * on work identity. The "Also remove from your Library?" question appears only
 * after a movie, or after a show's last aired season, is finished; only the
 * explicit **Remove from Library** answer sets it aside, and that answer has an
 * Undo. Closing the dialog, or choosing **Keep in Library**, changes nothing.
 *
 * ⚠ SEASONS COME FROM TMDB AND MAY BE ABSENT. When they are, the dialog says
 * so and offers nothing it cannot validate, rather than guessing a season list.
 */

import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';

import {
  FINISHED_ASK_REMOVE,
  FINISHED_ASK_REMOVE_HINT,
  FINISHED_KEEP_ACTION,
  FINISHED_LOADING,
  FINISHED_LOAD_FAILED,
  FINISHED_MARK_ALL,
  FINISHED_MARK_MOVIE,
  FINISHED_MARK_SELECTED,
  FINISHED_NOT_FINISHED,
  FINISHED_NOT_IN_LIBRARY,
  FINISHED_NO_SEASONS_AIRED,
  FINISHED_REMOVED,
  FINISHED_REMOVE_ACTION,
  FINISHED_RETURNED,
  FINISHED_SAVED,
  FINISHED_SAVE_CHANGES,
  FINISHED_SAVE_FAILED,
  FINISHED_SEASONS_UNAVAILABLE,
  FINISHED_UNFINISHED,
  OFFLINE_DISABLED_REASON,
  REMOVE_TITLE_UNDO_LABEL,
  ROW_MENU_FINISHED_LABEL,
  WATCHED_SEASON_LABEL,
  WATCHED_SEASON_PREMIERES,
} from '../copy';
import { ApiError, type ApiClient, type WatchedState } from '../lib/apiClient';
import { withName } from './SuppressDialog';
import {
  StarRating,
  WatchedDateField,
  ratingText,
  todayIso,
  watchedDateText,
} from './WatchedFields';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field } from './ui/Field';
import { Input } from './ui/Input';

export type FinishedApi = Pick<
  ApiClient,
  'getWatched' | 'markFinished' | 'unfinishWatched' | 'setLibraryHidden'
>;

export interface FinishedWatchingDialogProps {
  readonly titleId: string;
  readonly name: string;
  readonly api: FinishedApi;
  readonly offline?: boolean;
  readonly onClose: () => void;
  /** Reported after the owner confirmed setting the title aside (`true`) or returning it. */
  readonly onLibraryChange?: (hidden: boolean) => void;
}

type Step = 'form' | 'ask' | 'removed' | 'returned';

const seasonName = (n: number): string => WATCHED_SEASON_LABEL.replace('{n}', String(n));

export function FinishedWatchingDialog({
  titleId,
  name,
  api,
  offline = false,
  onClose,
  onLibraryChange,
}: FinishedWatchingDialogProps): JSX.Element {
  const headingId = useId();
  const root = useRef<HTMLDivElement>(null);
  const groupName = useId();
  const [state, setState] = useState<WatchedState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [date, setDate] = useState(todayIso());
  const [unknown, setUnknown] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('form');

  useEffect(() => {
    const controller = new AbortController();
    api.getWatched(titleId, controller.signal).then(
      (loaded) => {
        setState(loaded);
        if (!loaded.perSeason && loaded.whole !== null) {
          setDate(loaded.whole.watchedOn ?? todayIso());
          setUnknown(loaded.whole.finished && loaded.whole.watchedOn === null);
          setRating(loaded.whole.rating);
        }
      },
      () => {
        if (!controller.signal.aborted) setLoadFailed(true);
      },
    );
    return () => {
      controller.abort();
    };
  }, [api, titleId]);

  const failure = (caught: unknown): void => {
    setError(
      caught instanceof ApiError && caught.code !== 'INTERNAL_ERROR'
        ? caught.message
        : FINISHED_SAVE_FAILED,
    );
  };

  const finish = useCallback(
    (seasons: readonly number[]) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      api
        .markFinished(titleId, {
          seasons: [...seasons],
          watchedOn: unknown || date === '' ? null : date,
          ...(rating === null ? {} : { rating }),
        })
        .then(
          async () => {
            let next: WatchedState | null = null;
            try {
              next = await api.getWatched(titleId);
            } catch {
              // The record is saved; only the follow-up read failed.
            }
            setBusy(false);
            setSelected(new Set());
            if (next !== null) setState(next);
            if (next !== null && next.inLibrary && (!next.perSeason || next.allAiredFinished)) {
              setStep('ask');
            } else {
              setMessage(FINISHED_SAVED);
            }
          },
          (caught: unknown) => {
            setBusy(false);
            failure(caught);
          },
        );
    },
    [api, date, rating, titleId, unknown],
  );

  const unfinish = (season: number): void => {
    if (state === null) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    api.unfinishWatched(state.workIdentity, season).then(
      async () => {
        try {
          setState(await api.getWatched(titleId));
        } catch {
          // The change is saved; the next open reads it again.
        }
        setBusy(false);
        setMessage(FINISHED_UNFINISHED);
      },
      (caught: unknown) => {
        setBusy(false);
        failure(caught);
      },
    );
  };

  const setAside = (hidden: boolean): void => {
    setBusy(true);
    setError(null);
    api.setLibraryHidden(titleId, hidden).then(
      () => {
        setBusy(false);
        setStep(hidden ? 'removed' : 'returned');
        onLibraryChange?.(hidden);
      },
      (caught: unknown) => {
        setBusy(false);
        if (caught instanceof ApiError && caught.code === 'TITLE_NOT_ACTIVE') {
          setStep('form');
          setMessage(FINISHED_NOT_IN_LIBRARY);
          return;
        }
        failure(caught);
      },
    );
  };

  // The step swap unmounts the button that had focus; move it to the step's
  // primary control rather than letting it fall to the page behind the dialog.
  useEffect(() => {
    if (step === 'form') return;
    root.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
  }, [step]);

  const airedSeasons = state?.seasons.filter((season) => season.aired) ?? [];
  const openSeasons = airedSeasons.filter((season) => !season.finished);
  const inputsDisabled = busy || offline;

  const fields = (
    <>
      <WatchedDateField
        date={date}
        unknown={unknown}
        disabled={inputsDisabled}
        onChange={(next) => {
          setDate(next.date);
          setUnknown(next.unknown);
        }}
      />
      <StarRating value={rating} onChange={setRating} name={groupName} disabled={inputsDisabled} />
    </>
  );

  return (
    <Dialog
      aria-labelledby={headingId}
      onDismiss={() => {
        if (!busy) onClose();
      }}
    >
      <div className="finished-dialog" data-testid="finished-dialog" ref={root}>
        <h2 id={headingId}>{ROW_MENU_FINISHED_LABEL}</h2>
        <p className="finished-dialog__name">{name}</p>

        {loadFailed ? (
          <p role="alert" data-testid="finished-load-failed">
            {FINISHED_LOAD_FAILED}
          </p>
        ) : state === null ? (
          <p role="status" aria-busy="true" data-testid="finished-loading">
            {FINISHED_LOADING}
          </p>
        ) : step === 'ask' ? (
          <div data-testid="finished-ask">
            <p>{withName(FINISHED_ASK_REMOVE, name)}</p>
            <p className="finished-dialog__hint">{FINISHED_ASK_REMOVE_HINT}</p>
            <div className="finished-dialog__actions">
              <Button
                variant="secondary"
                data-testid="finished-keep"
                data-dialog-initial-focus
                disabled={busy}
                onClick={onClose}
              >
                {FINISHED_KEEP_ACTION}
              </Button>
              <Button
                variant="secondary"
                data-testid="finished-remove"
                disabled={inputsDisabled}
                onClick={() => {
                  setAside(true);
                }}
              >
                {FINISHED_REMOVE_ACTION}
              </Button>
            </div>
          </div>
        ) : step === 'removed' ? (
          <div data-testid="finished-removed">
            <p role="status">{withName(FINISHED_REMOVED, name)}</p>
            <Button
              variant="secondary"
              data-testid="finished-undo"
              data-dialog-initial-focus
              disabled={inputsDisabled}
              onClick={() => {
                setAside(false);
              }}
            >
              {REMOVE_TITLE_UNDO_LABEL}
            </Button>
          </div>
        ) : step === 'returned' ? (
          <p role="status" data-testid="finished-returned">
            {withName(FINISHED_RETURNED, name)}
          </p>
        ) : !state.perSeason ? (
          <>
            <p data-testid="finished-status">
              {state.whole?.finished === true
                ? `Finished · ${watchedDateText(state.whole.watchedOn)} · ${ratingText(state.whole.rating)}`
                : ''}
            </p>
            {fields}
            <div className="finished-dialog__actions">
              <Button
                variant="primary"
                data-testid="finished-mark"
                disabled={inputsDisabled}
                onClick={() => {
                  finish([0]);
                }}
              >
                {state.whole?.finished === true ? FINISHED_SAVE_CHANGES : FINISHED_MARK_MOVIE}
              </Button>
              {state.whole?.finished === true && (
                <Button
                  variant="secondary"
                  data-testid="finished-unfinish"
                  disabled={inputsDisabled}
                  onClick={() => {
                    unfinish(0);
                  }}
                >
                  {FINISHED_NOT_FINISHED}
                </Button>
              )}
            </div>
          </>
        ) : state.seasonsUnavailable ? (
          <p role="status" data-testid="finished-seasons-unavailable">
            {FINISHED_SEASONS_UNAVAILABLE}
          </p>
        ) : airedSeasons.length === 0 ? (
          <p data-testid="finished-no-seasons">{FINISHED_NO_SEASONS_AIRED}</p>
        ) : (
          <>
            <Field legend="Seasons" testId="finished-seasons">
              <ul className="finished-seasons">
                {state.seasons.map((season) => (
                  <li key={season.seasonNumber} className="finished-seasons__row">
                    <label>
                      <Input
                        type="checkbox"
                        data-testid={`finished-season-${String(season.seasonNumber)}`}
                        checked={selected.has(season.seasonNumber)}
                        disabled={!season.aired || inputsDisabled}
                        onChange={(event) => {
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (event.target.checked) next.add(season.seasonNumber);
                            else next.delete(season.seasonNumber);
                            return next;
                          });
                        }}
                      />
                      <span className="finished-seasons__text">
                        <span>{seasonName(season.seasonNumber)}</span>
                        <span className="finished-seasons__status">
                          {season.finished
                            ? `${watchedDateText(season.watchedOn)} · ${ratingText(season.rating)}`
                            : season.aired
                              ? FINISHED_NOT_FINISHED
                              : WATCHED_SEASON_PREMIERES.replace(
                                  '{date}',
                                  season.airDate === null
                                    ? 'date to be announced'
                                    : watchedDateText(season.airDate),
                                )}
                        </span>
                      </span>
                    </label>
                    {season.finished && (
                      <Button
                        variant="ghost"
                        data-testid={`finished-unfinish-${String(season.seasonNumber)}`}
                        disabled={inputsDisabled}
                        aria-label={`${FINISHED_NOT_FINISHED}: ${seasonName(season.seasonNumber)}`}
                        onClick={() => {
                          unfinish(season.seasonNumber);
                        }}
                      >
                        {FINISHED_NOT_FINISHED}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Field>
            {fields}
            <div className="finished-dialog__actions">
              <Button
                variant="primary"
                data-testid="finished-mark-selected"
                disabled={inputsDisabled || selected.size === 0}
                onClick={() => {
                  finish([...selected].sort((a, b) => a - b));
                }}
              >
                {FINISHED_MARK_SELECTED}
              </Button>
              {openSeasons.length > 0 && (
                <Button
                  variant="secondary"
                  data-testid="finished-mark-all"
                  disabled={inputsDisabled}
                  onClick={() => {
                    finish(openSeasons.map((season) => season.seasonNumber));
                  }}
                >
                  {FINISHED_MARK_ALL}
                </Button>
              )}
            </div>
          </>
        )}

        {message !== null && (
          <p role="status" data-testid="finished-message">
            {message}
          </p>
        )}
        {error !== null && (
          <p role="alert" data-testid="finished-error">
            {error}
          </p>
        )}
        {offline && <p className="offline-reason">{OFFLINE_DISABLED_REASON}</p>}

        {step !== 'ask' && (
          <div className="finished-dialog__actions">
            <Button
              variant="secondary"
              data-testid="finished-close"
              data-dialog-initial-focus={step === 'returned' ? true : undefined}
              disabled={busy}
              onClick={onClose}
            >
              {step === 'form' ? 'Close' : 'Done'}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
