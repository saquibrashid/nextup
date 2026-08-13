// `/upload` step 1 - service and mode (specs/ui.md §3.1, TASK-049).
//
// Two required choices, NEITHER defaulted (US-003 AC-1/AC-2, REQ-002/REQ-003).
// A default here would be accepted by inaction, and the default that would
// matter - full update - proposes removals. So both controls start empty and
// step 2 stays shut until each is answered.
//
// ── Why the mode control is two cards and not a bare radio ──────────────────
//
// "Full update" and "Add only" are meaningless as labels; their CONSEQUENCES
// are the whole decision. §3.1 requires the consequence sentence to be "always
// visible, never behind a tooltip or an info icon", and `T-UI-003` asserts both
// sentences are in the DOM without interaction. So each card renders its own
// consequence permanently - not on hover, not on selection, not in a `<details>`.
//
// ── Why the sentences come from @nextup/domain ──────────────────────────────
//
// `modeExplanation(mode, service)` is the same function that builds the
// `modeExplanation` field of `POST /api/batches` (specs/api.md §6.11). Rendering
// the card from it is what makes US-003 AC-2/AC-3 hold by construction: the
// words the owner agreed to and the words the API records cannot drift, because
// there is only one of them. A re-typed literal here would look identical and
// diverge silently on the next wording change.
//
// Step 2 (the three ingest affordances) and step 3 (submit) are NOT here - they
// are separate tasks. This step owns the two choices and reports them upward.

import { useId, useState, type JSX } from 'react';
import {
  BATCH_MODES,
  SERVICES,
  SERVICE_LABELS,
  modeExplanation,
  type BatchMode,
  type Service,
} from '@nextup/domain';

import {
  MODE_APPEND_ONLY_LABEL,
  MODE_FULL_UPDATE_LABEL,
  MODE_FULL_UPDATE_SERVICE_PLACEHOLDER,
  MODE_STEP_LEGEND,
  SERVICE_STEP_LEGEND,
} from '../copy.js';

/** The step-1 answer. `null` means "not yet chosen" - never a default. */
export interface BatchDraftSelection {
  readonly service: Service | null;
  readonly mode: BatchMode | null;
}

export interface UploadPageProps {
  /** Notified on every change so step 2 can enable itself. */
  readonly onSelectionChange?: (selection: BatchDraftSelection) => void;
}

const MODE_LABELS: Readonly<Record<BatchMode, string>> = {
  'append-only': MODE_APPEND_ONLY_LABEL,
  'full-update': MODE_FULL_UPDATE_LABEL,
};

/**
 * The consequence sentence for a card.
 *
 * Before a service is chosen there is no service name to interpolate, and
 * US-003 AC-1 forbids inventing one by defaulting. `modeExplanation` needs a
 * concrete `Service`, so the placeholder substitution happens on the rendered
 * sentence rather than by calling it with a service the owner has not picked -
 * see the ⚠ FINDING on `MODE_FULL_UPDATE_SERVICE_PLACEHOLDER`.
 *
 * Append-only names no service at all, so the replace is a no-op for it by
 * construction rather than by a branch that could rot.
 */
export function modeConsequence(mode: BatchMode, service: Service | null): string {
  if (service !== null) return modeExplanation(mode, service);
  return modeExplanation(mode, SERVICES[0]).replace(
    SERVICE_LABELS[SERVICES[0]],
    MODE_FULL_UPDATE_SERVICE_PLACEHOLDER,
  );
}

export function UploadPage({ onSelectionChange }: UploadPageProps = {}): JSX.Element {
  const [service, setService] = useState<Service | null>(null);
  const [mode, setMode] = useState<BatchMode | null>(null);
  const serviceGroup = useId();
  const modeGroup = useId();

  function choose(next: Partial<BatchDraftSelection>): void {
    const selection: BatchDraftSelection = { service, mode, ...next };
    if (next.service !== undefined) setService(next.service);
    if (next.mode !== undefined) setMode(next.mode);
    onSelectionChange?.(selection);
  }

  return (
    <>
      <h1>Upload screenshots</h1>

      {/* Native radios: real group semantics and roving focus for free. */}
      <fieldset data-testid="service-step">
        <legend>{SERVICE_STEP_LEGEND}</legend>
        {SERVICES.map((candidate) => (
          <label key={candidate} data-testid={`service-option-${candidate}`}>
            <input
              type="radio"
              name={serviceGroup}
              value={candidate}
              checked={service === candidate}
              onChange={() => {
                choose({ service: candidate });
              }}
            />
            <span>{SERVICE_LABELS[candidate]}</span>
          </label>
        ))}
      </fieldset>

      <fieldset data-testid="mode-step">
        <legend>{MODE_STEP_LEGEND}</legend>
        {BATCH_MODES.map((candidate) => (
          <label key={candidate} data-testid={`mode-card-${candidate}`}>
            <input
              type="radio"
              name={modeGroup}
              value={candidate}
              checked={mode === candidate}
              onChange={() => {
                choose({ mode: candidate });
              }}
            />
            <span data-testid={`mode-card-${candidate}-label`}>{MODE_LABELS[candidate]}</span>
            {/* Always rendered. Never a tooltip, never a disclosure. */}
            <p data-testid={`mode-card-${candidate}-consequence`}>
              {modeConsequence(candidate, service)}
            </p>
          </label>
        ))}
      </fieldset>
    </>
  );
}
