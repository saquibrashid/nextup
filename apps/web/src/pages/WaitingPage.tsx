// `/waiting` — works the owner is waiting to stream (TASK-188/189, ADR-0010).
//
// ⚠ **THIS SCREEN NEVER ADDS ANYTHING TO THE COMBINED LIST** (US-042 AC-3,
// product invariant 5). A work TMDB reports as `flatrate` on Netflix or Max is
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
  WAITING_REFRESH_FAILED,
  WAITING_SUPPRESS_FAILED,
} from '../copy';
import type { WaitingItem } from '../lib/apiClient';
import { TMDB_IMAGE_BASE } from '../components/TitleRow';
import { useOnline } from '../lib/useOnline';

export interface WaitingPageProps {
  readonly items?: readonly WaitingItem[];
  readonly loading?: boolean;
  readonly loadFailed?: boolean;
  /** US-042 AC-7 — at least one lookup failed on this render. */
  readonly refreshFailed?: boolean;
  readonly onRetry?: () => void;
  readonly onSuppress?: (titleId: string) => Promise<unknown>;
}

/** Title-case a provider key for display: `netflix` → `Netflix`. */
function serviceLabel(service: string): string {
  return service === 'max' ? 'Max' : service.charAt(0).toUpperCase() + service.slice(1);
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

  function suppress(): void {
    setPhase('submitting');
    onSuppress(item.titleId).then(
      () => onDone(item.intentId),
      () => setPhase('error'),
    );
  }

  return (
    <li className="waiting-row" data-testid="waiting-row" aria-busy={phase === 'submitting'}>
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
        <span data-testid="waiting-name">{item.name}</span>
        {item.releaseYear !== null && <span data-testid="waiting-year">{item.releaseYear}</span>}

        {/* US-043 AC-1 — the discovery date and the storefront it was seen on. */}
        <p data-testid="waiting-discovery">
          {`Seen on ${item.discoverySource} on ${item.discoveredAt}`}
        </p>

        {flagged.length > 0 ? (
          <p className="waiting-row__flag" data-testid="waiting-flag">
            {`${WAITING_NOW_ON_PREFIX} ${flagged.map(serviceLabel).join(' and ')} — `}
            <Link to="/upload" data-testid="waiting-flag-link">
              {WAITING_NOW_ON_INVITATION}
            </Link>
          </p>
        ) : (
          <p data-testid="waiting-availability">{availabilityLine(item)}</p>
        )}

        {phase === 'idle' && (
          <button
            type="button"
            className="tap-target"
            data-testid="waiting-not-interested"
            disabled={offline}
            onClick={suppress}
          >
            {WAITING_NOT_INTERESTED}
          </button>
        )}
        {offline && phase === 'idle' && (
          <span className="offline-reason">{OFFLINE_DISABLED_REASON}</span>
        )}
        {phase === 'submitting' && (
          <button type="button" className="tap-target" data-testid="waiting-suppressing" disabled>
            {'Working…'}
          </button>
        )}
        {phase === 'error' && (
          <>
            <p role="alert" data-testid="waiting-suppress-error">
              {WAITING_SUPPRESS_FAILED}
            </p>
            <button
              type="button"
              className="tap-target"
              data-testid="waiting-not-interested"
              onClick={suppress}
            >
              {RETRY_LABEL}
            </button>
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
}: WaitingPageProps = {}): JSX.Element {
  const offline = !useOnline();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const visible = items.filter((item) => !dismissed.has(item.intentId));

  return (
    <>
      <h1>Waiting to stream</h1>

      {refreshFailed && (
        <p role="status" data-testid="waiting-refresh-failed">
          {WAITING_REFRESH_FAILED}
        </p>
      )}

      {loadFailed ? (
        <div role="alert" data-testid="waiting-load-error">
          <p>{'Couldn\u2019t load your waiting list. Nothing has changed.'}</p>
          {onRetry !== undefined && (
            <button type="button" className="tap-target" onClick={onRetry}>
              {RETRY_LABEL}
            </button>
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
          <Link className="tap-target" to="/upload">
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
