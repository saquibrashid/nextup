// Holding an image that arrived before there is anywhere to put it
// (`specs/ux-states.md` §4.0a, `A45`).
//
// ⚠ NEVER DISCARD. A batch must exist server-side before an image can be
// attached (`api.md` §5.3.1), and EVERY ingest affordance can fire before the
// owner has chosen a service and a mode - the paste button and the file
// chooser are both on screen from the first paint, Ctrl/Cmd+V is available the
// whole time, and a drop can land at any moment. Dropping the image would be
// silent: the owner acted, something visibly happened, and nothing arrived.
// Holding it costs one array.
//
// ⚠ IT MUST NOT CREATE OR SUBMIT A BATCH. Holding is the entire behaviour;
// the images are handed over once the batch exists and not before.
//
// ⚠ SHARED BY ALL THREE AFFORDANCES ON PURPOSE, AND THAT IS NOT DECORATIVE.
// The hold was originally wired to the paste primitives ONLY, and the result
// was a live defect the owner hit: choosing a file before picking a service
// left the dropzone reading "1 screenshots · 1.3 MB" while the submit button
// said "Attach at least one screenshot first.", with no error anywhere,
// because `UploadRoute.attach` returns silently when the selection is unset.
// A hold implemented on some paths only is worse than none, because the paths
// that have it make the paths that do not look deliberate.
//
// ⚠ THE PAYLOAD IS GENERIC BECAUSE THE INGEST SOURCE MUST SURVIVE THE HOLD.
// `ADR-0009` distinguishes paste from upload from drop; a hold that flattened
// everything to a bare `File[]` would silently re-attribute a held drop as a
// paste, which is a lie in exactly the record that exists to tell them apart.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface HeldImages<TPayload> {
  /** Send now if there is a batch, otherwise hold. */
  readonly deliver: (payload: TPayload) => void;
  /** How many images are waiting; drives the §4.0a message. */
  readonly heldCount: number;
}

export function useHeldImages<TPayload>(
  batchReady: boolean,
  onImagesReady: (payload: TPayload) => void,
  filesIn: (payload: TPayload) => readonly File[],
): HeldImages<TPayload> {
  // A ref as well as state: `deliver` may be called twice before React
  // re-renders (two fast pastes), and a state-only queue would lose the first.
  const heldRef = useRef<readonly TPayload[]>([]);
  const [heldCount, setHeldCount] = useState(0);

  // Held in a ref so the replay effect does not re-run - and re-deliver - every
  // time a caller passes a freshly built extractor.
  const filesInRef = useRef(filesIn);
  filesInRef.current = filesIn;

  const countOf = (payloads: readonly TPayload[]): number =>
    payloads.reduce((sum, payload) => sum + filesInRef.current(payload).length, 0);

  const deliver = useCallback(
    (payload: TPayload): void => {
      if (filesInRef.current(payload).length === 0) return;
      if (batchReady) {
        onImagesReady(payload);
        return;
      }
      heldRef.current = [...heldRef.current, payload];
      setHeldCount(countOf(heldRef.current));
    },
    [batchReady, onImagesReady],
  );

  useEffect(() => {
    if (!batchReady || heldRef.current.length === 0) return;
    const pending = heldRef.current;
    // Cleared BEFORE the hand-off so a re-entrant render cannot deliver twice.
    heldRef.current = [];
    setHeldCount(0);
    // Replayed one payload at a time, in arrival order, so each keeps its own
    // ingest source rather than being merged into whichever arrived first.
    for (const payload of pending) onImagesReady(payload);
  }, [batchReady, onImagesReady]);

  return { deliver, heldCount };
}
