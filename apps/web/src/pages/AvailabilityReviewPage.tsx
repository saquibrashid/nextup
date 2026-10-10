/**
 * US-064 — the "Availability changes" screen (PRD `A55`, `specs/ui.md` §7c).
 *
 * Two sections, from STORED data only: Library titles with an un-kept change
 * (the same marker and signature as the details page), and waiting titles now
 * streaming on an owner service. Each row carries its one-tap answers; a
 * checkbox per row lets one answer apply to several (§6.48).
 *
 * ⚠ **SHOW THE FACT, NEVER NAG (invariant 8a).** The screen lists what the
 * markers already say. It never pushes an answer and never colours a count.
 *
 * ⚠ **DESTRUCTIVE BULK ANSWERS ARE CONFIRMED** through the shared `Dialog`
 * (Cancel takes initial focus; Escape and the backdrop cancel). Removals are
 * soft and the result links to removal history, where each is restorable.
 *
 * ⚠ **A REFUSED ROW STAYS VISIBLE WITH ITS REASON.** The bulk route answers
 * per row; the result lists every refusal by name, so a row the reload no
 * longer shows still says what happened to it.
 */

import { useId, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { SERVICE_LABELS, type Service } from '@nextup/domain';

import { AvailabilityNotice, AvailabilityPanel } from '../components/AvailabilityMarker';
import { TMDB_IMAGE_BASE } from '../components/TitleRow';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Dialog } from '../components/ui/Dialog';
import {
  AVREV_ADDED_TO_LIBRARY,
  AVREV_APPLY_FAILED,
  AVREV_BULK_ADD,
  AVREV_BULK_ADD_RULE,
  AVREV_BULK_KEEP,
  AVREV_BULK_MOVE,
  AVREV_BULK_REMOVE,
  AVREV_CANCEL,
  AVREV_CHECK_FAILED,
  AVREV_CHECK_MORE,
  AVREV_RECHECK_ALL,
  AVREV_RECHECK_CONTINUE,
  AVREV_RECHECK_DONE,
  AVREV_RECHECK_HINT,
  AVREV_RECHECK_PROGRESS_OF,
  AVREV_RECHECK_PROGRESS_SUFFIX,
  AVREV_CHECK_SOME_FAILED,
  AVREV_CHECK_WORKING,
  AVREV_CHECKED_NOW,
  AVREV_CHECKED_ON,
  AVREV_CLEAR_SELECTION,
  AVREV_CONFIRM_MOVE_BODY,
  AVREV_CONFIRM_REMOVE_BODY,
  AVREV_DONE,
  AVREV_EMPTY,
  AVREV_HEADING,
  AVREV_INTRO,
  AVREV_LIBRARY_HEADING,
  AVREV_LOAD_FAILED,
  AVREV_LOADING,
  AVREV_NOT_CHANGED,
  AVREV_NOT_CHECKED_RECENTLY,
  AVREV_NOW_STREAMING_ON,
  AVREV_RETRY,
  AVREV_SECTION_EMPTY,
  AVREV_SELECT_ALL_LIBRARY,
  AVREV_SELECT_ALL_WAITING,
  AVREV_SELECT_PREFIX,
  AVREV_SELECTED,
  AVREV_TITLES_CHECKED,
  AVREV_VIEW_REMOVED,
  AVREV_WAITING_HEADING,
  JUSTWATCH_ATTRIBUTION,
  OFFLINE_DISABLED_REASON,
  WAITING_ADD_TO_LIBRARY,
  WAITING_ADD_TO_LIBRARY_FAILED,
} from '../copy';
import type {
  ApiClient,
  AvailabilityCheckResponse,
  AvailabilityRecheckProgress,
  AvailabilityReviewAction,
  AvailabilityReviewLibraryItem,
  AvailabilityReviewResponse,
  AvailabilityReviewWaitingItem,
} from '../lib/apiClient';
import { formatDateShort } from './RemovedPage';

/** The server's per-request ceiling (§6.48); larger selections go in chunks. */
export const AVAILABILITY_REVIEW_APPLY_MAX = 50;

export type AvailabilityReviewActions = Pick<
  ApiClient,
  | 'removeBadge'
  | 'moveToWaiting'
  | 'keepAvailability'
  | 'addBadge'
  | 'promoteWaiting'
  | 'checkMoreAvailability'
  | 'applyAvailabilityReview'
>;

export interface AvailabilityReviewPageProps {
  readonly data: AvailabilityReviewResponse | null;
  readonly loading: boolean;
  readonly loadFailed: boolean;
  readonly onRetry: () => void;
  readonly offline: boolean;
  readonly actions: AvailabilityReviewActions;
  /** Re-reads the screen after anything changed. */
  readonly onChanged: () => void;
}

/** One selectable row, keyed by what the bulk route is sent. */
export interface ReviewRowRef {
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly signature?: string;
}

const libraryKey = (item: AvailabilityReviewLibraryItem): string => `title:${item.titleId}`;
const waitingKey = (item: AvailabilityReviewWaitingItem): string => `intent:${item.intentId}`;

/**
 * The rows a bulk answer applies to, from the selection (US-064 AC-4).
 * Exported so the eligibility rules are asserted directly.
 */
export function eligibleRows(
  action: AvailabilityReviewAction,
  data: AvailabilityReviewResponse,
  selected: ReadonlySet<string>,
): ReviewRowRef[] {
  if (action === 'add-to-library') {
    return data.nowStreaming
      .filter((item) => selected.has(waitingKey(item)) && item.service !== null)
      .map((item) => ({ key: waitingKey(item), id: item.intentId, name: item.name }));
  }
  return data.library
    .filter((item) => selected.has(libraryKey(item)))
    .filter(
      (item) =>
        action === 'keep' ||
        (action === 'remove-left-badges' && item.availability.left.length > 0) ||
        (action === 'move-to-waiting' && item.availability.canMoveToWaiting),
    )
    .map((item) => ({
      key: libraryKey(item),
      id: item.titleId,
      name: item.name,
      signature: item.availability.signature ?? '',
    }));
}

const BULK_LABEL: Record<AvailabilityReviewAction, string> = {
  keep: AVREV_BULK_KEEP,
  'remove-left-badges': AVREV_BULK_REMOVE,
  'move-to-waiting': AVREV_BULK_MOVE,
  'add-to-library': AVREV_BULK_ADD,
};
const BULK_ORDER: readonly AvailabilityReviewAction[] = [
  'keep',
  'remove-left-badges',
  'move-to-waiting',
  'add-to-library',
];
const CONFIRM_BODY: Partial<Record<AvailabilityReviewAction, string>> = {
  'remove-left-badges': AVREV_CONFIRM_REMOVE_BODY,
  'move-to-waiting': AVREV_CONFIRM_MOVE_BODY,
};

interface BulkOutcome {
  readonly action: AvailabilityReviewAction;
  readonly done: number;
  readonly refused: readonly { key: string; name: string; message: string }[];
}

function Poster({ path }: { readonly path: string | null }): JSX.Element {
  return path === null ? (
    <span className="avrev-row__poster avrev-row__poster--empty" aria-hidden="true" />
  ) : (
    <img className="avrev-row__poster" src={`${TMDB_IMAGE_BASE}${path}`} alt="" loading="lazy" />
  );
}

function RowHead({
  name,
  releaseYear,
  posterPath,
  href,
  checked,
  disabled,
  onToggle,
}: {
  readonly name: string;
  readonly releaseYear: number | null;
  readonly posterPath: string | null;
  readonly href: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <div className="avrev-row__head">
      <label className="avrev-row__select tap-target">
        <Input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`${AVREV_SELECT_PREFIX} ${name}`}
          data-testid="avrev-select"
        />
      </label>
      <Poster path={posterPath} />
      <Link className="avrev-row__name" to={href}>
        {name}
        {releaseYear !== null && (
          <span className="avrev-row__year">{` (${String(releaseYear)})`}</span>
        )}
      </Link>
    </div>
  );
}

function WaitingActions({
  item,
  offline,
  promote,
  onDone,
}: {
  readonly item: AvailabilityReviewWaitingItem;
  readonly offline: boolean;
  readonly promote: AvailabilityReviewActions['promoteWaiting'];
  readonly onDone: () => void;
}): JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const run = (service: Service) => (): void => {
    setPhase('submitting');
    promote(item.intentId, service).then(
      () => {
        setPhase('idle');
        onDone();
      },
      () => setPhase('error'),
    );
  };
  return (
    <>
      <div className="availability-panel__actions">
        {item.flaggedOn.map((service) => (
          <Button
            key={service}
            variant="secondary"
            data-testid={`avrev-promote-${service}`}
            aria-label={`${WAITING_ADD_TO_LIBRARY} on ${SERVICE_LABELS[service]}: ${item.name}`}
            disabled={offline || phase === 'submitting'}
            onClick={run(service)}
          >
            {`${WAITING_ADD_TO_LIBRARY} (${SERVICE_LABELS[service]})`}
          </Button>
        ))}
      </div>
      {phase === 'error' && (
        <p role="alert" data-testid="avrev-promote-error">
          {WAITING_ADD_TO_LIBRARY_FAILED}
        </p>
      )}
    </>
  );
}

export function AvailabilityReviewPage({
  data,
  loading,
  loadFailed,
  onRetry,
  offline,
  actions,
  onChanged,
}: AvailabilityReviewPageProps): JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AvailabilityReviewAction | null>(null);
  const [bulkPhase, setBulkPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);
  const [checkPhase, setCheckPhase] = useState<'idle' | 'working' | 'error'>('idle');
  const [lastCheck, setLastCheck] = useState<AvailabilityCheckResponse | null>(null);
  // US-068 AC-3 — the open "Re-check everything" walk; held here so each tap continues it.
  const [walk, setWalk] = useState<AvailabilityRecheckProgress | null>(null);
  const confirmHeadingId = useId();
  const libraryHeadingId = useId();
  const waitingHeadingId = useId();

  const toggle = (key: string) => (): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleAll = (keys: readonly string[]) => (): void => {
    setSelected((current) => {
      const next = new Set(current);
      const all = keys.every((key) => next.has(key));
      for (const key of keys) {
        if (all) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  };

  const moved = (message: string): void => {
    setNotice(message);
    setOutcome(null);
    onChanged();
  };

  const apply = async (
    action: AvailabilityReviewAction,
    rows: readonly ReviewRowRef[],
  ): Promise<void> => {
    setConfirming(null);
    setBulkPhase('submitting');
    setNotice(null);
    try {
      let done = 0;
      const refused: { key: string; name: string; message: string }[] = [];
      for (let start = 0; start < rows.length; start += AVAILABILITY_REVIEW_APPLY_MAX) {
        const chunk = rows.slice(start, start + AVAILABILITY_REVIEW_APPLY_MAX);
        const response = await actions.applyAvailabilityReview(
          action,
          chunk.map((row) =>
            row.signature === undefined ? { id: row.id } : { id: row.id, signature: row.signature },
          ),
        );
        done += response.done;
        const byId = new Map(response.results.map((result) => [result.id, result]));
        for (const row of chunk) {
          const result = byId.get(row.id);
          if (result?.outcome === 'refused') {
            refused.push({
              key: row.key,
              name: row.name,
              message: result.message ?? AVREV_APPLY_FAILED,
            });
          }
        }
      }
      setOutcome({ action, done, refused });
      setSelected(new Set(refused.map((row) => row.key)));
      setBulkPhase('idle');
      onChanged();
    } catch {
      setBulkPhase('error');
    }
  };

  const checkMore = (): void => {
    setCheckPhase('working');
    actions.checkMoreAvailability().then(
      (result) => {
        setWalk(null);
        setLastCheck(result);
        setCheckPhase('idle');
        onChanged();
      },
      () => setCheckPhase('error'),
    );
  };

  const recheckAll = (): void => {
    setCheckPhase('working');
    const next =
      walk !== null && !walk.done ? { since: walk.since, cursor: walk.cursor } : ('all' as const);
    actions.checkMoreAvailability(next).then(
      (result) => {
        setWalk(result.recheck ?? null);
        setLastCheck(result);
        setCheckPhase('idle');
        onChanged();
      },
      () => setCheckPhase('error'),
    );
  };

  if (data === null) {
    return (
      <div className="avrev">
        <h1>{AVREV_HEADING}</h1>
        {loading && <p aria-busy="true">{AVREV_LOADING}</p>}
        {loadFailed && (
          <div role="alert">
            <p>{AVREV_LOAD_FAILED}</p>
            <Button variant="secondary" onClick={onRetry}>
              {AVREV_RETRY}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const check = lastCheck ?? data.check;
  const busy = offline || bulkPhase === 'submitting';
  const refusedByKey = new Map(outcome?.refused.map((row) => [row.key, row.message]));
  const libraryKeys = data.library.map(libraryKey);
  const waitingKeys = data.nowStreaming.map(waitingKey);
  const selectedCount = [...libraryKeys, ...waitingKeys].filter((key) => selected.has(key)).length;
  const empty = data.library.length === 0 && data.nowStreaming.length === 0;
  const restorable =
    outcome !== null &&
    outcome.done > 0 &&
    (outcome.action === 'remove-left-badges' || outcome.action === 'move-to-waiting');

  return (
    <div className="avrev">
      <h1>{AVREV_HEADING}</h1>
      <p className="avrev__intro">{AVREV_INTRO}</p>

      <div className="avrev__check">
        <p data-testid="avrev-check-counts">
          {`${String(check.checked)} ${AVREV_TITLES_CHECKED} · ${String(
            check.notCheckedRecently,
          )} ${AVREV_NOT_CHECKED_RECENTLY}`}
        </p>
        <Button
          variant="secondary"
          data-testid="avrev-check-more"
          disabled={offline || checkPhase === 'working' || check.notCheckedRecently === 0}
          aria-busy={checkPhase === 'working' ? true : undefined}
          onClick={checkMore}
        >
          {checkPhase === 'working' ? AVREV_CHECK_WORKING : AVREV_CHECK_MORE}
        </Button>
        <Button
          variant="secondary"
          data-testid="avrev-recheck-all"
          disabled={offline || checkPhase === 'working' || (walk !== null && walk.done)}
          aria-busy={checkPhase === 'working' ? true : undefined}
          onClick={recheckAll}
        >
          {walk !== null && !walk.done ? AVREV_RECHECK_CONTINUE : AVREV_RECHECK_ALL}
        </Button>
        <p className="avrev__hint">{AVREV_RECHECK_HINT}</p>
        {walk !== null && (
          <p data-testid="avrev-recheck-progress">
            {walk.done
              ? AVREV_RECHECK_DONE
              : `${String(walk.processed)} ${AVREV_RECHECK_PROGRESS_OF} ${String(walk.total)} ${AVREV_RECHECK_PROGRESS_SUFFIX}`}
          </p>
        )}
      </div>
      {offline && (
        <p className="offline-reason" data-testid="avrev-offline">
          {OFFLINE_DISABLED_REASON}
        </p>
      )}

      <div className="avrev__live" role="status" aria-live="polite" data-testid="avrev-live">
        {lastCheck !== null &&
          checkPhase === 'idle' &&
          `${AVREV_CHECKED_NOW} ${String(lastCheck.lookedUp)}${
            lastCheck.failed > 0 ? ` · ${String(lastCheck.failed)} ${AVREV_CHECK_SOME_FAILED}` : ''
          }.`}
        {outcome !== null && (
          <span data-testid="avrev-result">
            {`${String(outcome.done)} ${AVREV_DONE}, ${String(outcome.refused.length)} ${AVREV_NOT_CHANGED}.`}
            {restorable && (
              <>
                {' '}
                <Link to="/removed">{AVREV_VIEW_REMOVED}</Link>
              </>
            )}
          </span>
        )}
      </div>
      {checkPhase === 'error' && (
        <p role="alert" data-testid="avrev-check-error">
          {AVREV_CHECK_FAILED}
        </p>
      )}
      {bulkPhase === 'error' && (
        <p role="alert" data-testid="avrev-apply-error">
          {AVREV_APPLY_FAILED}
        </p>
      )}
      {outcome !== null && outcome.refused.length > 0 && (
        <ul className="avrev__refused" data-testid="avrev-refused">
          {outcome.refused.map((row) => (
            <li key={row.key}>{`${row.name} — ${row.message}`}</li>
          ))}
        </ul>
      )}
      {notice !== null && <AvailabilityNotice notice={notice} />}

      {empty ? (
        <p data-testid="avrev-empty">{AVREV_EMPTY}</p>
      ) : (
        <>
          <div
            className="avrev__bar"
            role="group"
            aria-label={AVREV_SELECTED}
            data-testid="avrev-bar"
          >
            <span data-testid="avrev-selected-count">{`${String(selectedCount)} ${AVREV_SELECTED}`}</span>
            {BULK_ORDER.map((action) => {
              const count = eligibleRows(action, data, selected).length;
              return (
                <Button
                  key={action}
                  variant="secondary"
                  data-testid={`avrev-bulk-${action}`}
                  disabled={busy || count === 0}
                  onClick={() => {
                    if (CONFIRM_BODY[action] === undefined)
                      void apply(action, eligibleRows(action, data, selected));
                    else setConfirming(action);
                  }}
                >
                  {`${BULK_LABEL[action]} (${String(count)})`}
                </Button>
              );
            })}
            <Button
              variant="ghost"
              data-testid="avrev-clear"
              disabled={selectedCount === 0}
              onClick={() => setSelected(new Set())}
            >
              {AVREV_CLEAR_SELECTION}
            </Button>
            <p className="avrev__rule">{AVREV_BULK_ADD_RULE}</p>
          </div>

          <section aria-labelledby={libraryHeadingId} data-testid="avrev-library">
            <h2 id={libraryHeadingId}>{AVREV_LIBRARY_HEADING}</h2>
            {data.library.length === 0 ? (
              <p>{AVREV_SECTION_EMPTY}</p>
            ) : (
              <>
                <label className="avrev__select-all tap-target">
                  <Input
                    type="checkbox"
                    checked={libraryKeys.every((key) => selected.has(key))}
                    disabled={busy}
                    onChange={toggleAll(libraryKeys)}
                    data-testid="avrev-select-all-library"
                  />
                  {AVREV_SELECT_ALL_LIBRARY}
                </label>
                <ul className="avrev__list">
                  {data.library.map((item) => {
                    const key = libraryKey(item);
                    const reason = refusedByKey.get(key);
                    return (
                      <li key={key} className="avrev-row" data-testid="avrev-library-row">
                        <RowHead
                          name={item.name}
                          releaseYear={item.releaseYear}
                          posterPath={item.posterPath}
                          href={`/titles/${encodeURIComponent(item.titleId)}`}
                          checked={selected.has(key)}
                          disabled={busy}
                          onToggle={toggle(key)}
                        />
                        <AvailabilityPanel
                          titleId={item.titleId}
                          name={item.name}
                          badges={item.badges}
                          availability={item.availability}
                          offline={busy}
                          actions={actions}
                          onMoved={moved}
                          showAttribution={false}
                        />
                        {item.availability.checkedAt !== null && (
                          <p className="avrev-row__asof" data-testid="avrev-asof">
                            {`${AVREV_CHECKED_ON} ${formatDateShort(
                              item.availability.checkedAt.slice(0, 10),
                            )} (${item.availability.region})`}
                          </p>
                        )}
                        {reason !== undefined && (
                          <p className="avrev-row__reason" data-testid="avrev-row-reason">
                            {reason}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          <section aria-labelledby={waitingHeadingId} data-testid="avrev-waiting">
            <h2 id={waitingHeadingId}>{AVREV_WAITING_HEADING}</h2>
            {data.nowStreaming.length === 0 ? (
              <p>{AVREV_SECTION_EMPTY}</p>
            ) : (
              <>
                <label className="avrev__select-all tap-target">
                  <Input
                    type="checkbox"
                    checked={waitingKeys.every((key) => selected.has(key))}
                    disabled={busy}
                    onChange={toggleAll(waitingKeys)}
                    data-testid="avrev-select-all-waiting"
                  />
                  {AVREV_SELECT_ALL_WAITING}
                </label>
                <ul className="avrev__list">
                  {data.nowStreaming.map((item) => {
                    const key = waitingKey(item);
                    const reason = refusedByKey.get(key);
                    return (
                      <li key={key} className="avrev-row" data-testid="avrev-waiting-row">
                        <RowHead
                          name={item.name}
                          releaseYear={item.releaseYear}
                          posterPath={item.posterPath}
                          href={`/waiting/${encodeURIComponent(item.titleId)}`}
                          checked={selected.has(key)}
                          disabled={busy}
                          onToggle={toggle(key)}
                        />
                        <p className="availability-panel__fact" data-testid="avrev-waiting-fact">
                          {`${AVREV_NOW_STREAMING_ON} ${item.flaggedOn
                            .map((service) => SERVICE_LABELS[service])
                            .join(' and ')}`}
                          {item.availabilityCheckedAt !== null &&
                            ` · ${AVREV_CHECKED_ON} ${formatDateShort(
                              item.availabilityCheckedAt.slice(0, 10),
                            )} (${item.availabilityRegion})`}
                        </p>
                        <WaitingActions
                          item={item}
                          offline={busy}
                          promote={actions.promoteWaiting}
                          onDone={() => moved(AVREV_ADDED_TO_LIBRARY)}
                        />
                        {reason !== undefined && (
                          <p className="avrev-row__reason" data-testid="avrev-row-reason">
                            {reason}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        </>
      )}

      <p className="justwatch-attribution" data-testid="avrev-attribution">
        {JUSTWATCH_ATTRIBUTION}
      </p>

      {confirming !== null && (
        <Dialog onDismiss={() => setConfirming(null)} aria-labelledby={confirmHeadingId}>
          <h2 id={confirmHeadingId}>{BULK_LABEL[confirming]}</h2>
          <p data-testid="avrev-confirm-body">{CONFIRM_BODY[confirming]}</p>
          <ul className="avrev__confirm-list">
            {eligibleRows(confirming, data, selected).map((row) => (
              <li key={row.key}>{row.name}</li>
            ))}
          </ul>
          <Button
            variant="danger"
            data-testid="avrev-confirm"
            onClick={() => void apply(confirming, eligibleRows(confirming, data, selected))}
          >
            {BULK_LABEL[confirming]}
          </Button>
          <Button variant="secondary" data-dialog-initial-focus onClick={() => setConfirming(null)}>
            {AVREV_CANCEL}
          </Button>
        </Dialog>
      )}
    </div>
  );
}
