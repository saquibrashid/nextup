import { Input } from '../components/ui/Input';
// `/upload` step 1 - service and mode (specs/ui.md §3.1, TASK-049).
//
// Two required choices. The SOURCE defaults to Auto-detect (#396, US-066 AC-1,
// PRD `A57`), and Auto-detect is add-only BY SOURCE (`forcedModeFor`), so the
// default answers the mode too — and the answer it gives can remove nothing.
// The MODE is never defaulted for a named service (US-003 AC-1/AC-2,
// REQ-002/REQ-003): the default that would matter - full update - proposes
// removals, so for a named service the mode starts empty and must be answered.
//
// ~~Superseded at `A57`: "Two required choices, NEITHER defaulted. … both
// controls start empty and step 2 stays shut until each is answered."~~
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
import { Button } from '../components/ui/Button';
import { UploadStep, type UploadStepState } from '../components/UploadStep';
import { ServiceMark } from '../components/ServiceMark';
import {
  AUTO_DETECT_LABEL,
  AUTO_DETECT_SOURCE,
  BATCH_MODES,
  DISCOVERY_SOURCES,
  SERVICES,
  SERVICE_LABELS,
  autoDetectModeExplanation,
  batchSourceLabel,
  discoveryModeExplanation,
  forcedModeFor,
  isAutoDetectSource,
  isDiscoverySource,
  modeExplanation,
  modeRefusalFor,
  splitBatchSource,
  type BatchMode,
  type CaptureSource,
} from '@nextup/domain';
import { CaptureProgress } from '../components/CaptureProgress';
import { PlusIcon, RefreshIcon } from '../components/icons';

import {
  AUTO_DETECT_OPTION_HINT,
  AUTO_DETECT_FULL_UPDATE_HINT,
  IMPORT_MODE_HEADING,
  IMPORT_SERVICE_HEADING,
  MODE_APPEND_ONLY_LABEL,
  MODE_FULL_UPDATE_FLAG,
  MODE_FULL_UPDATE_LABEL,
  MODE_FULL_UPDATE_SERVICE_PLACEHOLDER,
  MODE_STEP_LEGEND,
  MODE_STEP_LOCKED_HINT,
  SERVICE_STEP_LEGEND,
  STOREFRONT_GROUP_LEGEND,
  STOREFRONT_GROUP_TOGGLE,
  STOREFRONT_GROUP_HINT,
  UPLOAD_INTRO,
} from '../copy.js';

/**
 * The step-1 answer. `null` means "not yet chosen" - never a default.
 *
 * ⚠ `service` is a BATCH SOURCE, so it may be a rental storefront (#378).
 * `POST /api/batches` already takes either in its `service` field and splits
 * them server-side (`splitBatchSource`); this type follows the wire rather
 * than inventing a second field the server would have to reconcile.
 */
export interface BatchDraftSelection {
  /** #396 — may be `'auto'`: no service named, each title is looked up. */
  readonly service: CaptureSource | null;
  readonly mode: BatchMode | null;
}

export interface UploadPageProps {
  readonly initialService?: CaptureSource | null;
  /**
   * #396 — `initialService` is the DEFAULT (Auto-detect), not a source the
   * owner or a link named. The default is selected but its step stays open,
   * so the named services are on screen beside it rather than behind a
   * `Change`; the first explicit choice answers the step as usual.
   */
  readonly initialDefaulted?: boolean;
  /** Notified on every change so step 2 can enable itself. */
  readonly onSelectionChange?: (selection: BatchDraftSelection) => void;
  /**
   * TASK-260 — the phone import's first screen. The container draws the
   * heading and the stepper, so this renders only the two questions, both
   * open, under the mockup's numbered headings.
   */
  readonly phone?: boolean;
}

const MODE_ICONS: Readonly<Record<BatchMode, () => JSX.Element>> = {
  'append-only': () => <PlusIcon />,
  'full-update': () => <RefreshIcon />,
};

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
export function modeConsequence(mode: BatchMode, service: CaptureSource | null): string {
  if (service !== null && isAutoDetectSource(service)) {
    return mode === 'append-only'
      ? autoDetectModeExplanation()
      : (modeRefusalFor(service, mode) ?? '');
  }
  if (service !== null && isDiscoverySource(service)) {
    return mode === 'append-only'
      ? discoveryModeExplanation(service)
      : (modeRefusalFor(service, mode) ?? '');
  }
  if (service !== null) return modeExplanation(mode, service);
  return modeExplanation(mode, SERVICES[0]).replace(
    SERVICE_LABELS[SERVICES[0]],
    MODE_FULL_UPDATE_SERVICE_PLACEHOLDER,
  );
}

export function UploadPage({
  onSelectionChange,
  initialService = null,
  initialDefaulted = false,
  phone = false,
}: UploadPageProps = {}): JSX.Element {
  const [service, setService] = useState<CaptureSource | null>(initialService);
  const [defaulted, setDefaulted] = useState(initialDefaulted);
  /*
   * ⚠ A storefront has exactly one permitted mode (ADR-0010 D-2), so it is
   * answered for the owner rather than asked. The server refuses anything
   * else regardless (`T-WAIT-001c`); this only stops the page asking a
   * question with one legal answer.
   */
  const [mode, setMode] = useState<BatchMode | null>(
    initialService !== null ? forcedModeFor(initialService) : null,
  );
  const [storefrontsOpen, setStorefrontsOpen] = useState(
    initialService !== null && isDiscoverySource(initialService),
  );
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
  const storefrontGroup = useId();
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
    const forced = nextService !== null ? forcedModeFor(nextService) : null;
    const nextMode =
      forced !== null ? forced : next.mode !== undefined ? next.mode : changedService ? null : mode;
    setService(nextService);
    setMode(nextMode);
    setDefaulted(false);
    setReopened(null);
    onSelectionChange?.({ service: nextService, mode: nextMode });
  }

  const serviceState: UploadStepState =
    service !== null && !defaulted && reopened !== 'service' ? 'done' : 'active';
  const modeState: UploadStepState =
    service === null ? 'locked' : mode !== null && reopened !== 'mode' ? 'done' : 'active';
  const modeLocked = modeState === 'locked';
  /** A storefront or auto-detect source has one legal mode (`forcedModeFor`). */
  const forcedMode = service !== null ? forcedModeFor(service) : null;
  const autoDetect = service !== null && isAutoDetectSource(service);

  return (
    <>
      {!phone && (
        <>
          <h1>Import screenshots</h1>
          <p className="upload-flow__intro">{UPLOAD_INTRO}</p>
          <CaptureProgress stage="prepare" />
        </>
      )}

      <UploadStep
        index={1}
        legend={phone ? IMPORT_SERVICE_HEADING : SERVICE_STEP_LEGEND}
        flat={phone}
        state={serviceState}
        answer={service === null ? null : batchSourceLabel(splitBatchSource(service))}
        onChange={() => {
          setReopened('service');
        }}
        onDone={reopened === 'service' ? () => setReopened(null) : undefined}
        testId="service-step-panel"
      >
        {/* Native radios: real group semantics and roving focus for free. */}
        <SegmentedControl legend={SERVICE_STEP_LEGEND} testId="service-step" hideLegend>
          {/*
            #396 (US-066 AC-1) — FIRST and the default: "I don't know / it's
            several", answered by a lookup at review. Same option style as the
            services beside it, so the picker keeps its look on the phone.
          */}
          <label
            data-service={AUTO_DETECT_SOURCE}
            data-testid={`service-option-${AUTO_DETECT_SOURCE}`}
          >
            <Input
              type="radio"
              name={serviceGroup}
              value={AUTO_DETECT_SOURCE}
              checked={service === AUTO_DETECT_SOURCE}
              onChange={() => {
                choose({ service: AUTO_DETECT_SOURCE });
              }}
            />
            <span className="service-option__auto">
              <span className="service-option__auto-name">{AUTO_DETECT_LABEL}</span>
              <span className="service-option__auto-hint" data-testid="auto-detect-hint">
                {AUTO_DETECT_OPTION_HINT}
              </span>
            </span>
          </label>
          {SERVICES.map((candidate) => (
            <label
              key={candidate}
              data-service={candidate}
              data-testid={`service-option-${candidate}`}
            >
              <Input
                type="radio"
                name={serviceGroup}
                value={candidate}
                checked={service === candidate}
                onChange={() => {
                  choose({ service: candidate });
                }}
              />
              {/*
                ⚠ The name stays VISIBLE here. This is the screen where
                picking the wrong service attributes a whole capture to the
                wrong list, so the mark assists recognition and never replaces
                the word. All eight use the shared, attributed mark register.
              */}
              <ServiceMark service={candidate} />
            </label>
          ))}
        </SegmentedControl>
        {/*
          ⚠ Rental storefronts are a SEPARATE group behind a toggle, never
          mixed into the services (ADR-0010 D-1). A storefront is a place the
          owner browses, not a list they saved, and each label says
          "(rent/buy)" so it cannot be read as a subscription (#378).
        */}
        {storefrontsOpen ? (
          <SegmentedControl legend={STOREFRONT_GROUP_LEGEND} testId="storefront-step">
            {DISCOVERY_SOURCES.map((candidate) => (
              <label key={candidate} data-testid={`storefront-option-${candidate}`}>
                <Input
                  type="radio"
                  name={storefrontGroup}
                  value={candidate}
                  checked={service === candidate}
                  onChange={() => {
                    choose({ service: candidate });
                  }}
                />
                <span>{batchSourceLabel(splitBatchSource(candidate))}</span>
              </label>
            ))}
          </SegmentedControl>
        ) : (
          <div className="upload-flow__storefronts">
            <p>{STOREFRONT_GROUP_HINT}</p>
            <Button
              variant="ghost"
              data-testid="storefront-toggle"
              onClick={() => {
                setStorefrontsOpen(true);
              }}
            >
              {STOREFRONT_GROUP_TOGGLE}
            </Button>
          </div>
        )}
      </UploadStep>

      <UploadStep
        index={2}
        legend={phone ? IMPORT_MODE_HEADING : MODE_STEP_LEGEND}
        flat={phone}
        state={modeState}
        answer={mode === null || service === null ? null : modeConsequence(mode, service)}
        hint={modeLocked ? MODE_STEP_LOCKED_HINT : null}
        hintId={modeHintId}
        onChange={() => {
          setReopened('mode');
        }}
        onDone={reopened === 'mode' ? () => setReopened(null) : undefined}
        testId="mode-step-panel"
      >
        <SegmentedControl legend={MODE_STEP_LEGEND} testId="mode-step" hideLegend>
          {BATCH_MODES.map((candidate) => (
            <label key={candidate} data-testid={`mode-card-${candidate}`}>
              {/* Drawn only on the phone screen; the words carry the choice. */}
              <span className="mode-card__icon" aria-hidden="true">
                {MODE_ICONS[candidate]()}
              </span>
              <Input
                type="radio"
                name={modeGroup}
                value={candidate}
                checked={mode === candidate}
                disabled={modeLocked || (forcedMode !== null && candidate !== forcedMode)}
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
              {/*
                #396 — why the full update is unavailable, and the way out:
                name the service. Always visible, like the consequence.
              */}
              {autoDetect && candidate === 'full-update' && (
                <p className="mode-card__hint" data-testid="auto-detect-full-update-hint">
                  {AUTO_DETECT_FULL_UPDATE_HINT}
                </p>
              )}
            </label>
          ))}
        </SegmentedControl>
      </UploadStep>
    </>
  );
}
