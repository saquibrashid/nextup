/**
 * #396 (US-066, PRD `A57`, ADR-0010 Rev 6) — where one auto-detect title goes.
 *
 * An auto-detect capture names no service, so each title's service was LOOKED
 * UP at review (TMDB watch providers, the same lookup Waiting to stream and the
 * Library use). This control shows that answer, labelled as looked up and
 * never as captured, and lets the owner confirm or change it before anything
 * lands:
 *
 * - every matching service of the owner's is pre-ticked, one badge each, and
 *   any can be unticked (AC-4);
 * - a title on none of the owner's services is proposed for Waiting to stream
 *   (AC-5);
 * - a lookup that failed says "Couldn't look up", offers a retry, and leaves
 *   the owner to pick (AC-3).
 *
 * ⚠ THE CHOICE IS ALWAYS VALID BY CONSTRUCTION. Unticking the last ticked
 * service is not offered: "no services" is not a destination, and a control
 * that let the owner reach that state would either be silently ignored or
 * refuse the close. The way to "none of these" is Waiting to stream.
 */

import { useState, type JSX } from 'react';

import {
  LOOKED_UP_LABEL,
  LOOKUP_FAILED_LABEL,
  SERVICES,
  SERVICE_LABELS,
  type AutoDestination as Destination,
  type ReviewCandidate,
  type Service,
} from '@nextup/domain';

import { Button } from './ui/Button';
import { Fieldset } from './ui/Fieldset';
import { Input } from './ui/Input';
import {
  AUTO_DESTINATION_LEGEND,
  AUTO_DESTINATION_NONE,
  AUTO_DESTINATION_PICK,
  AUTO_DESTINATION_SAVE_FAILED,
  AUTO_DESTINATION_WAITING,
  AUTO_LOOKUP_RETRY,
  AUTO_LOOKUP_RETRY_FAILED,
} from '../copy';

export interface AutoDestinationProps {
  readonly candidate: ReviewCandidate;
  readonly disabled?: boolean;
  /** Persists the owner's choice (§6.50). Rejects when it was not saved. */
  readonly onChange?:
    ((candidateId: string, destination: Destination) => Promise<void>) | undefined;
  /** The owner's "Look up again" (§6.50). Offered only for a failed lookup. */
  readonly onRetry?: ((candidateId: string) => Promise<void>) | undefined;
}

/** The sentence under the "Looked up" label: what the lookup actually said. */
export function lookupSummary(candidate: ReviewCandidate): {
  readonly label: string;
  readonly text: string;
  readonly failed: boolean;
} {
  const lookup = candidate.serviceLookup ?? null;
  if (lookup !== null && lookup.status === 'found' && lookup.services.length > 0) {
    return {
      label: LOOKED_UP_LABEL,
      text: `Streaming on ${lookup.services.map((service) => SERVICE_LABELS[service]).join(', ')}`,
      failed: false,
    };
  }
  if (lookup !== null && (lookup.status === 'none' || lookup.status === 'found')) {
    return { label: LOOKED_UP_LABEL, text: AUTO_DESTINATION_NONE, failed: false };
  }
  return { label: LOOKUP_FAILED_LABEL, text: AUTO_DESTINATION_PICK, failed: true };
}

export function AutoDestination({
  candidate,
  disabled = false,
  onChange,
  onRetry,
}: AutoDestinationProps): JSX.Element {
  const [draft, setDraft] = useState<Destination | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = draft ?? candidate.effectiveDestination ?? null;
  const ticked: readonly Service[] = current?.kind === 'services' ? current.services : [];
  const lookedUp = new Set(candidate.serviceLookup?.services ?? []);
  const summary = lookupSummary(candidate);
  const retryable = candidate.serviceLookup?.status === 'failed' && onRetry !== undefined;
  const locked = disabled || busy || onChange === undefined;

  const save = (next: Destination): void => {
    if (onChange === undefined || busy) return;
    const previous = draft;
    setDraft(next);
    setError(null);
    setBusy(true);
    void onChange(candidate.candidateId, next).then(
      () => setBusy(false),
      () => {
        setDraft(previous);
        setBusy(false);
        setError(AUTO_DESTINATION_SAVE_FAILED);
      },
    );
  };

  const toggle = (service: Service, on: boolean): void => {
    const services = SERVICES.filter((item) => (item === service ? on : ticked.includes(item)));
    if (services.length === 0) return;
    save({ kind: 'services', services });
  };

  return (
    <div className="auto-destination" data-testid="auto-destination">
      <p
        className="auto-destination__lookup"
        data-testid="auto-lookup"
        data-lookup-status={candidate.serviceLookup?.status ?? 'none-yet'}
      >
        <span className="auto-destination__label" data-testid="auto-lookup-label">
          {summary.label}
        </span>{' '}
        <span data-testid="auto-lookup-text">{summary.text}</span>
      </p>
      {retryable && (
        <Button
          variant="ghost"
          data-testid="auto-lookup-retry"
          disabled={disabled || busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void onRetry(candidate.candidateId).then(
              () => setBusy(false),
              () => {
                setBusy(false);
                setError(AUTO_LOOKUP_RETRY_FAILED);
              },
            );
          }}
        >
          {AUTO_LOOKUP_RETRY}
        </Button>
      )}
      <div className="auto-destination__choices">
        <Fieldset legend={AUTO_DESTINATION_LEGEND} disabled={locked}>
          <ul className="auto-destination__services">
            {SERVICES.map((service) => {
              const on = ticked.includes(service);
              return (
                <li key={service}>
                  <label data-testid={`auto-service-${service}`}>
                    <Input
                      type="checkbox"
                      checked={on}
                      // Unticking the LAST service is not a destination; see above.
                      disabled={on && ticked.length === 1}
                      onChange={(event) => {
                        toggle(service, event.currentTarget.checked);
                      }}
                    />
                    {SERVICE_LABELS[service]}
                    {lookedUp.has(service) && (
                      <span className="auto-destination__tag" data-testid="auto-service-looked-up">
                        {LOOKED_UP_LABEL}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
          <label className="auto-destination__waiting" data-testid="auto-waiting">
            <Input
              type="checkbox"
              checked={current?.kind === 'waiting'}
              disabled={current?.kind === 'waiting'}
              onChange={() => {
                save({ kind: 'waiting' });
              }}
            />
            {AUTO_DESTINATION_WAITING}
          </label>
        </Fieldset>
      </div>
      {error !== null && (
        <p role="alert" className="auto-destination__error" data-testid="auto-destination-error">
          {error}
        </p>
      )}
    </div>
  );
}
