// The "Paste screenshot" BUTTON - primitive 2 of two (`specs/ui.md` §3.2b,
// `specs/ux-states.md` §4.0a/§4.16, TASK-160, `A45`).
//
// ⚠ A BUTTON, NOT A GESTURE, and it is the ONLY paste path on iOS. A
// `document`-level `paste` listener never fires there without a hardware
// keyboard, and long-pressing non-editable content offers no Paste option. So
// `PasteCapture` (TASK-159) and this component are not two implementations of
// one feature - they are two features that happen to share a verb.
//
// ⚠ `navigator.clipboard.read()` IS CALLED SYNCHRONOUSLY INSIDE THE CLICK
// HANDLER. No `setTimeout`, no `await`, and no state update before it. The
// call must land inside the browser's transient-activation window; anything
// that yields first - including `setState`, whose effects flush before the
// next line runs - drops out of that window and the promise rejects
// immediately, on a device, with no way to reproduce it here. That is why
// `T-PASTE-002` asserts the ORDER and not merely the call.
//
// ⚠ ADD, NOT SWAP. This renders ALONGSIDE "Choose files", never instead of it
// (product invariant 16). It is also the one affordance that can be entirely
// absent - see `isPasteSupported` - which is exactly why it must never be the
// only one.
//
// ⚠ DO NOT BUILD A "DON'T ASK AGAIN" CONTROL. iOS presents its callout per
// invocation and never remembers the answer, so there is no state to store and
// a control offering to store it would simply lie.

import { type JSX } from 'react';

import { PASTE_BUTTON_LABEL, PASTE_IOS_HINT } from '../copy';
import { useHeldImages } from '../lib/useHeldImages';
import { isPasteSupported } from './ImageDropzone';

/** Why a `clipboard.read()` did not produce an image. Mapped to copy by TASK-161. */
export type PasteFailure = 'denied' | 'empty' | 'not-image' | 'abandoned';

export interface PasteButtonProps {
  /**
   * Whether an open batch exists to attach to - i.e. service and mode have
   * been chosen (`ux-states.md` §4.0a).
   *
   * When `false` the image is HELD, never discarded and never sent: a batch
   * must exist server-side first (`api.md` §5.3.1), and this component must
   * not create or submit one.
   */
  readonly batchReady: boolean;
  readonly onImagesPasted: (files: readonly File[]) => void;
  /** TASK-161 maps this to the four §4.13–§4.15 messages. */
  readonly onPasteFailed?: (failure: PasteFailure) => void;
  /** Forces the touch hint on in tests; otherwise inferred from the viewport. */
  readonly touch?: boolean;
}

const IMAGE_PNG = 'image/png';

/**
 * ⚠ FINDING - invented copy, pending owner review.
 *
 * `specs/ux-states.md` §4.0a writes this state out in full, but `specs/ui.md`
 * §9 - the copy register - has no row for it, so it cannot be transcribed and
 * lives beside its only consumer rather than pretending to be a §9 constant.
 */
export const PASTE_HELD_BODY =
  "Got your screenshot — choose a service and a mode and it'll be attached.";

/**
 * Classify a settled `clipboard.read()` so the button can always be re-offered.
 *
 * ⚠ EVERY settlement maps to exactly one outcome. The promise always settles,
 * so there is no timeout case; a timeout here would be dead code masking a
 * bug, and the bug it masked would present as a permanent spinner.
 */
export function classifyRejection(error: unknown): PasteFailure {
  // A stray tap, a tab switch or backgrounding Safari rejects with a bare
  // DOMException the owner never recognises as a refusal - distinct from an
  // actual denial, and far more common.
  if (error instanceof Error && error.name === 'NotAllowedError') return 'denied';
  return 'abandoned';
}

export function PasteButton({
  batchReady,
  onImagesPasted,
  onPasteFailed,
  touch,
}: PasteButtonProps): JSX.Element | null {
  const { deliver, heldCount } = useHeldImages(batchReady, onImagesPasted);

  // Read at render, not in an effect: the button must be absent from the very
  // first paint, never rendered and then withdrawn.
  if (!isPasteSupported()) return null;

  function onClick(): void {
    // ⚠ FIRST STATEMENT. Nothing may precede this call - see the header note.
    void navigator.clipboard
      .read()
      .then(async (items) => {
        if (items.length === 0) {
          onPasteFailed?.('empty');
          return;
        }
        const item = items.find((candidate) => candidate.types.includes(IMAGE_PNG));
        if (item === undefined) {
          onPasteFailed?.('not-image');
          return;
        }
        const blob = await item.getType(IMAGE_PNG);
        // The name is a placeholder: the server ignores it and synthesises the
        // real one (`api.md` §6.12, TASK-158), because a client-supplied name
        // must never reach a blob path.
        deliver([new File([blob], 'image.png', { type: IMAGE_PNG })]);
      })
      .catch((error: unknown) => {
        onPasteFailed?.(classifyRejection(error));
      });
  }

  return (
    <div className="dropzone__paste" data-testid="paste-slot">
      <button type="button" className="tap-target" data-testid="paste-button" onClick={onClick}>
        {PASTE_BUTTON_LABEL}
      </button>
      {/*
        iOS screenshots go to Photos, not the clipboard. Without this sentence
        the button looks broken to someone who never tapped "Copy" on the
        preview thumbnail.
      */}
      {touch === true && <p data-testid="paste-hint">{PASTE_IOS_HINT}</p>}
      {heldCount > 0 && (
        <p role="status" data-testid="paste-held">
          {PASTE_HELD_BODY}
        </p>
      )}
    </div>
  );
}
