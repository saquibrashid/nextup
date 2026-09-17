import { Input } from '../components/ui/Input';
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
// Step 3 (the three ingest affordances and the submit) is composed alongside
// these two by `containers/UploadRoute.tsx`, which owns the batch. This file
// owns the two choices, the wizard state that reveals them one at a time, and
// reports the answers upward.

import { useId, useState, type JSX } from 'react';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { UploadStep, type UploadStepState } from '../components/UploadStep';
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
  MODE_FULL_UPDATE_FLAG,
  MODE_FULL_UPDATE_LABEL,
  MODE_FULL_UPDATE_SERVICE_PLACEHOLDER,
  MODE_STEP_LEGEND,
  MODE_STEP_LOCKED_HINT,
  SERVICE_STEP_LEGEND,
} from '../copy.js';

/** The step-1 answer. `null` means "not yet chosen" - never a default. */
export interface BatchDraftSelection {
  readonly service: Service | null;
  readonly mode: BatchMode | null;
}

export interface UploadPageProps {
  readonly initialService?: Service | null;
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

export function UploadPage({
  onSelectionChange,
  initialService = null,
}: UploadPageProps = {}): JSX.Element {
  const [service, setService] = useState<Service | null>(initialService);
  const [mode, setMode] = useState<BatchMode | null>(null);
  /**
   * Which answered step the owner has reopened with `Change`, if any.
   *
   * ⚠ SEPARATE FROM THE ANSWERS THEMSELVES, deliberately. Reopening a step
   * must not clear what is already in it: the owner needs to see the current
   * answer to decide whether to change it, and a `Change` that blanked the
   * choice would make backing out of the reopen impossible.
   */
  const [reopened, setReopened] = useState<'service' | 'mode' | null>(null);
  const serviceGroup = useId();
  const modeGroup = useId();
  const modeHintId = useId();

  function choose(next: Partial<BatchDraftSelection>): void {
    /*
     * ⚠ CHANGING THE SERVICE RE-ASKS THE MODE, AND THAT IS A SAFETY RULE, NOT
     * TIDINESS. The full-update consequence NAMES the service: the owner
     * agrees to "anything on Netflix that isn't in these screenshots will be
     * offered for removal". Carrying that agreement over to Max silently
     * re-points a destructive choice at a list the owner never agreed to
     * touch — and because the collapsed summary would still read "Full
     * update", nothing on screen would show that it had happened.
     *
     * ⚠ Only a CHANGE clears it. Re-picking the service already chosen leaves
     * the mode alone, so backing out of a `Change` costs nothing.
     */
    const changedService = next.service !== undefined && next.service !== service;
    const nextService = next.service !== undefined ? next.service : service;
    const nextMode = next.mode !== undefined ? next.mode : changedService ? null : mode;
    setService(nextService);
    setMode(nextMode);
    setReopened(null);
    onSelectionChange?.({ service: nextService, mode: nextMode });
  }

  const serviceState: UploadStepState =
    service !== null && reopened !== 'service' ? 'done' : 'active';
  const modeState: UploadStepState =
    service === null ? 'locked' : mode !== null && reopened !== 'mode' ? 'done' : 'active';
  const modeLocked = modeState === 'locked';

  return (
    <>
      <h1>Upload screenshots</h1>

      <UploadStep
        index={1}
        legend={SERVICE_STEP_LEGEND}
        state={serviceState}
        answer={service === null ? null : SERVICE_LABELS[service]}
        onChange={() => {
          setReopened('service');
        }}
        testId="service-step-panel"
      >
        {/* Native radios: real group semantics and roving focus for free. */}
        <SegmentedControl legend={SERVICE_STEP_LEGEND} testId="service-step" hideLegend>
          {SERVICES.map((candidate) => (
            <label key={candidate} data-testid={`service-option-${candidate}`}>
              <Input
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
        </SegmentedControl>
      </UploadStep>

      <UploadStep
        index={2}
        legend={MODE_STEP_LEGEND}
        state={modeState}
        answer={mode === null || service === null ? null : modeConsequence(mode, service)}
        hint={modeLocked ? MODE_STEP_LOCKED_HINT : null}
        hintId={modeHintId}
        onChange={() => {
          setReopened('mode');
        }}
        testId="mode-step-panel"
      >
        <SegmentedControl legend={MODE_STEP_LEGEND} testId="mode-step" hideLegend>
          {BATCH_MODES.map((candidate) => (
            <label key={candidate} data-testid={`mode-card-${candidate}`}>
              <Input
                type="radio"
                name={modeGroup}
                value={candidate}
                checked={mode === candidate}
                disabled={modeLocked}
                aria-describedby={modeLocked ? modeHintId : undefined}
                onChange={() => {
                  choose({ mode: candidate });
                }}
              />
              <span data-testid={`mode-card-${candidate}-label`}>
                {MODE_LABELS[candidate]}
                {/*
                  ⚠ `aria-hidden` — visual emphasis only. The consequence
                  sentence below already says it in full and is part of the
                  radio's accessible name (`T-UI-003j`); repeating "removes"
                  there only makes that sentence harder to follow.
                */}
                {candidate === 'full-update' && (
                  <span className="mode-card__flag" aria-hidden="true">
                    {MODE_FULL_UPDATE_FLAG}
                  </span>
                )}
              </span>
              {/* Always rendered. Never a tooltip, never a disclosure. */}
              <p data-testid={`mode-card-${candidate}-consequence`}>
                {modeConsequence(candidate, service)}
              </p>
            </label>
          ))}
        </SegmentedControl>
      </UploadStep>
    </>
  );
}
