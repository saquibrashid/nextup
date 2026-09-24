// `/waiting` — works the owner is waiting to stream (TASK-188/189, ADR-0010).
//
// ⚠ **THIS SCREEN NEVER ADDS ANYTHING TO THE COMBINED LIST** (US-042 AC-3,
// product invariant 5). A work TMDB reports as `flatrate` on a supported service is
// FLAGGED, with an invitation to go and add it — the owner adds it to their
// real saved list on the service, captures a screenshot, and it enters the
// combined list by the ordinary path. Anything else would put a row in the
// list that no capture ever saw.
//
// ⚠ **"NOT STREAMING ANYWHERE" IS A SENTENCE THIS DATA CANNOT SUPPORT**
// (ADR-0010 Trap 4). `availableOn === null` means the question has not been
// answered; `[]` means it was answered and no subscription provider carries
// it. Both render as a bounded claim about the owner's OWN services, with the
// as-of date attached. Do not "simplify" the two into one stronger sentence.
//
// ⚠ **THE JUSTWATCH ATTRIBUTION IS A CONDITION OF USE** (REQ-087, US-042
// AC-9), and is stricter than the general TMDB attribution in `AppShell`. It
// belongs on every surface that renders availability, so it is rendered here
// unconditionally rather than beside the rows that happen to have data.

import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { SERVICES, SERVICE_LABELS, intentSourceLabel, releaseYearText } from '@nextup/domain';
import { EditionLabels } from '../components/EditionLabels';
import { WaitingSearchAdd } from '../components/WaitingSearchAdd';

import {
  JUSTWATCH_ATTRIBUTION,
  OFFLINE_DISABLED_REASON,
  RETRY_LABEL,
  WAITING_EMPTY_ACTION,
  WAITING_EMPTY_BODY,
  WAITING_EMPTY_TITLE,
  WAITING_LOADING,
  WAITING_NOT_CHECKED,
  WAITING_NOT_INTERESTED,
  WAITING_NOT_ON_YOUR_SERVICES,
  WAITING_NOW_ON_INVITATION,
  WAITING_NOW_ON_PREFIX,
  WAITING_NOW_STREAMING_BADGE,
  WAITING_OTHER_SERVICES_PREFIX,
  WAITING_OTHER_SERVICES_SUFFIX,
  WAITING_REFRESH_FAILED,
  WAITING_RENT_ONLY_PREFIX,
  WAITING_RENT_ONLY_SUFFIX,
  WAITING_STREAMING_SINCE,
  WAITING_SUPPRESS_FAILED,
} from '../copy';
import type { TmdbSearchResult, WaitingItem } from '../lib/apiClient';
import { TMDB_IMAGE_BASE } from '../components/TitleRow';
import { useOnline } from '../lib/useOnline';
import { Button } from '../components/ui/Button';

export interface WaitingPageProps {
  readonly items?: readonly WaitingItem[];
  readonly loading?: boolean;
  readonly loadFailed?: boolean;
  /** US-042 AC-7 — at least one lookup failed on this render. */
  readonly refreshFailed?: boolean;
  readonly onRetry?: () => void;
  readonly onSuppress?: (titleId: string) => Promise<unknown>;
  /** #378 — search-to-add. The box renders only when both are supplied. */
  readonly onSearch?: (query: string) => Promise<readonly TmdbSearchResult[]>;
  readonly onSearchAdd?: (result: TmdbSearchResult) => Promise<unknown>;
}

function serviceLabel(service: string): string {
  const known = SERVICES.find((candidate) => candidate === service);
  return known === undefined ? service : SERVICE_LABELS[known];
}

/**
 * The availability sentence for one row (US-042 AC-3/AC-6).
 *
 * Exported so `T-AVAIL-006` can assert the rule directly rather than through a
 * rendered tree — the claim being tested is about which sentence is chosen,
 * and a DOM query would pass just as happily against the forbidden one.
 */
export function availabilityLine(item: WaitingItem): string {
  if (item.availabilityCheckedAt === null) return WAITING_NOT_CHECKED;
  const asOf = item.availabilityCheckedAt.slice(0, 10);
  return `${WAITING_NOT_ON_YOUR_SERVICES} ${asOf}.`;
}

/**
 * #378 — the rent-only sentence, or `null` when the row is not rent-only.
 *
 * ⚠ Says BOTH halves: where it can be rented or bought, and that it is not
 * streaming on the owner's services. A rental offer alone must never read
 * as the answer the waiting view exists to give.
 */
export function rentOnlyLine(item: WaitingItem): string | null {
  if (item.accessState !== 'rent-only') return null;
  const rentOn = item.rentOn ?? [];
  if (rentOn.length === 0 || item.availabilityCheckedAt === null) return null;
  const asOf = item.availabilityCheckedAt.slice(0, 10);
  return `${WAITING_RENT_ONLY_PREFIX} ${rentOn.join(', ')}. ${WAITING_RENT_ONLY_SUFFIX} ${asOf}.`;
}

/**
 * #378, owner decision 3 — streaming somewhere the owner does not subscribe,
 * or `null`. Services nextup knows and providers it does not are one list
 * here: to the owner both are simply "not mine".
 */
export function otherServicesLine(item: WaitingItem): string | null {
  const names = [
    ...(item.otherServicesOn ?? []).map(serviceLabel),
    ...(item.otherProvidersOn ?? []),
  ];
  if (names.length === 0) return null;
  return `${WAITING_OTHER_SERVICES_PREFIX} ${names.join(', ')} ${WAITING_OTHER_SERVICES_SUFFIX}`;
}

/**
 * Rows that have reached one of the owner's services lead the list (#378):
 * noticing that moment is what the view is for. Stable within each group, so
 * the server's order is otherwise kept.
 */
export function orderWaiting(items: readonly WaitingItem[]): WaitingItem[] {
  const streaming = items.filter((item) => (item.flaggedOn ?? []).length > 0);
  const rest = items.filter((item) => (item.flaggedOn ?? []).length === 0);
  return [...streaming, ...rest];
}

/** A literal map, so the class vocabulary stays scannable (`T-CSS-001c`). */
const ROW_CLASS = {
  streaming: 'waiting-row waiting-row--streaming',
  waiting: 'waiting-row',
} as const;

function WaitingRow({
  item,
  onSuppress,
  onDone,
  offline,
}: {
  item: WaitingItem;
  onSuppress: (titleId: string) => Promise<unknown>;
  onDone: (intentId: string) => void;
  offline: boolean;
}): JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const flagged = item.flaggedOn ?? [];
  const rentOnly = rentOnlyLine(item);
  const others = otherServicesLine(item);
  const rowKind = flagged.length > 0 ? 'streaming' : 'waiting';

  function suppress(): void {
    setPhase('submitting');
    onSuppress(item.titleId).then(
      () => onDone(item.intentId),
      () => setPhase('error'),
    );
  }

  return (
    <li className={ROW_CLASS[rowKind]} data-testid="waiting-row" aria-busy={phase === 'submitting'}>
      {item.posterPath !== null ? (
        <img
          className="waiting-row__poster"
          src={`${TMDB_IMAGE_BASE}${item.posterPath}`}
          alt=""
          data-testid="waiting-poster"
        />
      ) : (
        <div
          className="waiting-row__poster waiting-row__poster--empty"
          data-testid="waiting-poster-placeholder"
        />
      )}

      <div className="waiting-row__body">
        {flagged.length > 0 && (
          <span className="waiting-row__badge" data-testid="waiting-streaming-badge">
            {WAITING_NOW_STREAMING_BADGE}
          </span>
        )}
        <span data-testid="waiting-name">{item.name}</span>
        <EditionLabels labels={item.editionLabels} />
        {item.releaseYear !== null && (
          <span data-testid="waiting-year">
            {releaseYearText(item.releaseYear, (item.editionLabels?.length ?? 0) > 0)}
          </span>
        )}

        {/*
          US-043 AC-1 — the discovery date and where it came from. The label
          carries "(rent/buy)" for a storefront (#378), and a search add says
          so rather than naming a storefront it never came from.
        */}
        <p data-testid="waiting-discovery">
          {item.discoverySource === 'search'
            ? `${intentSourceLabel(item.discoverySource)} on ${item.discoveredAt}`
            : `Seen on ${intentSourceLabel(item.discoverySource)} on ${item.discoveredAt}`}
        </p>

        {flagged.length > 0 ? (
          <p className="waiting-row__flag" data-testid="waiting-flag">
            {`${WAITING_NOW_ON_PREFIX} ${flagged.map(serviceLabel).join(' and ')} — `}
            {/* Straight to the import for that service, never an auto-add. */}
            <Link
              to={`/upload?service=${encodeURIComponent(flagged[0] ?? '')}`}
              data-testid="waiting-flag-link"
            >
              {WAITING_NOW_ON_INVITATION}
            </Link>
            {item.streamingSince != null && (
              <span data-testid="waiting-streaming-since">
                {` (${WAITING_STREAMING_SINCE} ${item.streamingSince.slice(0, 10)})`}
              </span>
            )}
          </p>
        ) : rentOnly !== null ? (
          <p className="waiting-row__rent" data-testid="waiting-rent-only">
            {rentOnly}
          </p>
        ) : (
          <p data-testid="waiting-availability">{availabilityLine(item)}</p>
        )}

        {others !== null && (
          <p className="waiting-row__other" data-testid="waiting-other-services">
            {others}
          </p>
        )}

        {phase === 'idle' && (
          <Button
            variant="secondary"
            data-testid="waiting-not-interested"
            disabled={offline}
            onClick={suppress}
          >
            {WAITING_NOT_INTERESTED}
          </Button>
        )}
        {offline && phase === 'idle' && (
          <span className="offline-reason">{OFFLINE_DISABLED_REASON}</span>
        )}
        {phase === 'submitting' && (
          <Button variant="secondary" data-testid="waiting-suppressing" disabled>
            {'Working…'}
          </Button>
        )}
        {phase === 'error' && (
          <>
            <p role="alert" data-testid="waiting-suppress-error">
              {WAITING_SUPPRESS_FAILED}
            </p>
            <Button variant="secondary" data-testid="waiting-not-interested" onClick={suppress}>
              {RETRY_LABEL}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

export function WaitingPage({
  items = [],
  loading = false,
  loadFailed = false,
  refreshFailed = false,
  onRetry,
  onSuppress = () => Promise.resolve(),
  onSearch,
  onSearchAdd,
}: WaitingPageProps = {}): JSX.Element {
  const offline = !useOnline();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const visible = orderWaiting(items.filter((item) => !dismissed.has(item.intentId)));

  return (
    <>
      <h1>Waiting to stream</h1>

      {onSearch !== undefined && onSearchAdd !== undefined && (
        <WaitingSearchAdd onSearch={onSearch} onAdd={onSearchAdd} offline={offline} />
      )}

      {refreshFailed && (
        <p role="status" data-testid="waiting-refresh-failed">
          {WAITING_REFRESH_FAILED}
        </p>
      )}

      {loadFailed ? (
        <div role="alert" data-testid="waiting-load-error">
          <p>{'Couldn\u2019t load your waiting list. Nothing has changed.'}</p>
          {onRetry !== undefined && (
            <Button variant="secondary" onClick={onRetry}>
              {RETRY_LABEL}
            </Button>
          )}
        </div>
      ) : loading ? (
        <div role="status" data-testid="waiting-loading" aria-label={WAITING_LOADING}>
          <ul className="waiting-list waiting-list--loading">
            {[0, 1, 2].map((index) => (
              <li
                key={index}
                className="waiting-row waiting-row--skeleton"
                data-testid="waiting-row-skeleton"
                aria-hidden="true"
              />
            ))}
          </ul>
        </div>
      ) : visible.length === 0 ? (
        <div data-testid="waiting-empty">
          <p>{WAITING_EMPTY_TITLE}</p>
          <p>{WAITING_EMPTY_BODY}</p>
          <Link className="tap-target" to="/upload?source=fandango-at-home">
            {WAITING_EMPTY_ACTION}
          </Link>
        </div>
      ) : (
        <ul className="waiting-list" data-testid="waiting-list">
          {visible.map((item) => (
            <WaitingRow
              key={item.intentId}
              item={item}
              offline={offline}
              onSuppress={onSuppress}
              onDone={(intentId) => setDismissed((previous) => new Set([...previous, intentId]))}
            />
          ))}
        </ul>
      )}

      {/* Unconditional: the attribution is a condition of use, not a caption
          for whichever rows happen to have provider data today. */}
      <p className="justwatch-attribution" data-testid="justwatch-attribution">
        {JUSTWATCH_ATTRIBUTION}
      </p>
    </>
  );
}
