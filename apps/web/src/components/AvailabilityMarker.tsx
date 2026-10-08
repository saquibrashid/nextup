/**
 * #397/#410 — the availability marker (US-063, PRD `A54`, `specs/ui.md` §5.12).
 *
 * Two renderings of ONE sentence: a compact chip on the Library row (desktop
 * and phone share `TitleRow`), and a panel on the title details page that
 * carries the owner's one-tap answers (PRD §7.4 items 13, 15, 16 and 17).
 *
 * ⚠ **SHOW THE FACT, NEVER NAG (invariant 8a).** The sentence is what TMDB
 * said and when — "Left Starz — now rent-only on Apple TV", "Not seen on
 * Starz as of 4 Jan 2026", "Now also on Netflix". There is no threshold, no
 * reminder and no count. A Keep makes the marker go away until the provider
 * set changes again; nothing else does.
 *
 * ⚠ **NOTHING HERE MOVES ANYTHING BY ITSELF (invariant 5).** Every action is
 * a button press; the refresh that produced the facts only ever wrote them.
 */

import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { SERVICE_LABELS, type Service } from '@nextup/domain';

import {
  AVAILABILITY_ACTION_FAILED,
  AVAILABILITY_ADD_BADGE,
  AVAILABILITY_AS_OF,
  AVAILABILITY_BADGE_ADDED,
  AVAILABILITY_BADGE_REMOVED,
  AVAILABILITY_KEEP,
  AVAILABILITY_KEPT,
  AVAILABILITY_LEFT_PREFIX,
  AVAILABILITY_MOVE_TO_WAITING,
  AVAILABILITY_MOVED_TO_WAITING,
  AVAILABILITY_NOT_SEEN_ON,
  AVAILABILITY_NOW_ALSO_ON,
  AVAILABILITY_PANEL_LABEL,
  AVAILABILITY_REMOVE_BADGE,
  AVAILABILITY_RENT_ONLY_ON,
  AVAILABILITY_WORKING,
  JUSTWATCH_ATTRIBUTION,
} from '../copy';
import type { ApiClient } from '../lib/apiClient';
import { formatDateShort } from '../pages/RemovedPage';
import { Button } from './ui/Button';
import type { TitleAvailability, TitleBadge } from './TitleRow';

const names = (services: readonly Service[]): string =>
  services.map((service) => SERVICE_LABELS[service]).join(' and ');

/**
 * The marker sentence, or `null` when there is nothing to say: no change, a
 * change the owner chose to Keep, or no answer at all (ADR-0010 Trap 4 — not
 * known is never a change).
 *
 * Exported so the rule can be asserted directly rather than through a DOM
 * query that would pass just as happily against the wrong sentence.
 */
export function availabilityMarkerText(
  availability: TitleAvailability | null | undefined,
): string | null {
  if (availability == null || availability.signature === null || availability.kept) return null;
  const parts: string[] = [];
  const { left, joined, rentOn, accessState, checkedAt } = availability;
  if (left.length > 0) {
    if (accessState === 'rent-only' && rentOn !== null && rentOn.length > 0) {
      parts.push(
        `${AVAILABILITY_LEFT_PREFIX} ${names(left)} — ${AVAILABILITY_RENT_ONLY_ON} ${rentOn
          .slice(0, 3)
          .join(', ')}`,
      );
    } else if (accessState === 'not-seen' && checkedAt !== null) {
      parts.push(
        `${AVAILABILITY_NOT_SEEN_ON} ${names(left)} ${AVAILABILITY_AS_OF} ${formatDateShort(
          checkedAt.slice(0, 10),
        )}`,
      );
    } else {
      parts.push(`${AVAILABILITY_LEFT_PREFIX} ${names(left)}`);
    }
  }
  if (joined.length > 0) parts.push(`${AVAILABILITY_NOW_ALSO_ON} ${names(joined)}`);
  return parts.join(' · ');
}

/** US-063 AC-2 — the compact marker on a Library row. Not interactive. */
export function AvailabilityChip({
  availability,
}: {
  readonly availability: TitleAvailability | null | undefined;
}): JSX.Element | null {
  const text = availabilityMarkerText(availability);
  if (text === null) return null;
  return (
    <span className="title-row__chip title-row__chip--availability" data-testid="availability-chip">
      {text}
    </span>
  );
}

type MoveActions = Pick<
  ApiClient,
  'removeBadge' | 'moveToWaiting' | 'keepAvailability' | 'addBadge'
>;

export interface AvailabilityPanelProps {
  readonly titleId: string;
  readonly name: string;
  readonly badges: readonly TitleBadge[];
  readonly availability: TitleAvailability | null | undefined;
  readonly offline: boolean;
  readonly actions: MoveActions;
  /** Called after a move succeeded, with the sentence to confirm it. */
  readonly onMoved: (notice: string) => void;
  /**
   * US-064 — the review screen states the JustWatch credit once for the whole
   * screen rather than once per row (REQ-087 is met either way).
   */
  readonly showAttribution?: boolean;
}

/**
 * US-063 AC-3..AC-7 — the marker with its one-tap answers, on the details
 * page. Each button is a `Button` (44 px floor, NFR-006), so the phone layout
 * gets touch-sized targets without a rule of its own.
 */
export function AvailabilityPanel({
  titleId,
  name,
  badges,
  availability,
  offline,
  actions,
  onMoved,
  showAttribution = true,
}: AvailabilityPanelProps): JSX.Element | null {
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const text = availabilityMarkerText(availability);
  if (text === null || availability == null) return null;

  const run = (work: () => Promise<unknown>, notice: string) => (): void => {
    setPhase('submitting');
    work().then(
      () => {
        setPhase('idle');
        onMoved(notice);
      },
      () => setPhase('error'),
    );
  };
  const disabled = offline || phase === 'submitting';
  const removable = availability.left.flatMap((service) => {
    const badge = badges.find((candidate) => candidate.service === service);
    return badge === undefined ? [] : [badge];
  });
  const signature = availability.signature ?? '';

  return (
    <section
      className="availability-panel"
      aria-label={`${AVAILABILITY_PANEL_LABEL}: ${name}`}
      data-testid="availability-panel"
      aria-busy={phase === 'submitting' ? true : undefined}
    >
      <p className="availability-panel__fact" data-testid="availability-fact">
        {text}
      </p>
      <div className="availability-panel__actions">
        {removable.map((badge) => (
          <Button
            key={badge.listingId}
            variant="secondary"
            data-testid={`availability-remove-${badge.service}`}
            aria-label={`${AVAILABILITY_REMOVE_BADGE}: ${SERVICE_LABELS[badge.service]} — ${name}`}
            disabled={disabled}
            onClick={run(() => actions.removeBadge(badge.listingId), AVAILABILITY_BADGE_REMOVED)}
          >
            {`${AVAILABILITY_REMOVE_BADGE}: ${SERVICE_LABELS[badge.service]}`}
          </Button>
        ))}
        {availability.joined.map((service) => (
          <Button
            key={service}
            variant="secondary"
            data-testid={`availability-add-${service}`}
            aria-label={`${AVAILABILITY_ADD_BADGE}: ${SERVICE_LABELS[service]} — ${name}`}
            disabled={disabled}
            onClick={run(() => actions.addBadge(titleId, service), AVAILABILITY_BADGE_ADDED)}
          >
            {`${AVAILABILITY_ADD_BADGE}: ${SERVICE_LABELS[service]}`}
          </Button>
        ))}
        {availability.canMoveToWaiting && (
          <Button
            variant="secondary"
            data-testid="availability-move-to-waiting"
            disabled={disabled}
            onClick={run(() => actions.moveToWaiting(titleId), AVAILABILITY_MOVED_TO_WAITING)}
          >
            {AVAILABILITY_MOVE_TO_WAITING}
          </Button>
        )}
        <Button
          variant="ghost"
          data-testid="availability-keep"
          disabled={disabled}
          onClick={run(() => actions.keepAvailability(titleId, signature), AVAILABILITY_KEPT)}
        >
          {phase === 'submitting' ? AVAILABILITY_WORKING : AVAILABILITY_KEEP}
        </Button>
      </div>
      {phase === 'error' && (
        <p role="alert" data-testid="availability-error">
          {AVAILABILITY_ACTION_FAILED}
        </p>
      )}
      {showAttribution && (
        <p className="justwatch-attribution" data-testid="availability-attribution">
          {JUSTWATCH_ATTRIBUTION}
        </p>
      )}
    </section>
  );
}

/** The removal-history link a notice points at, so the reversal is one tap away. */
export function AvailabilityNotice({ notice }: { readonly notice: string }): JSX.Element {
  const restorable =
    notice === AVAILABILITY_BADGE_REMOVED || notice === AVAILABILITY_MOVED_TO_WAITING;
  return (
    <p role="status" data-testid="availability-notice">
      {notice} {restorable && <Link to="/removed">View removal history</Link>}
      {notice === AVAILABILITY_MOVED_TO_WAITING && (
        <>
          {' '}
          <Link to="/waiting">Open Waiting</Link>
        </>
      )}
    </p>
  );
}
