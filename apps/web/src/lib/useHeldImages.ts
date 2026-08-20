// Holding a paste that arrived before there is anywhere to put it
// (`specs/ux-states.md` §4.0a, `A45`).
//
// ⚠ NEVER DISCARD. A batch must exist server-side before an image can be
// attached (`api.md` §5.3.1), and both paste primitives can fire before the
// owner has chosen a service and a mode - the button is on screen from the
// first paint, and Ctrl/Cmd+V is available the whole time. Dropping the image
// would be silent: the owner pasted, something visibly happened, and nothing
// arrived. Holding it costs one array.
//
// ⚠ IT MUST NOT CREATE OR SUBMIT A BATCH. Holding is the entire behaviour;
// the images are handed over once the batch exists and not before.
//
// Shared by BOTH primitives on purpose. A hold implemented only behind the
// button would leave the desktop listener silently lossy - the same defect,
// on the platform where paste is used most.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface HeldImages {
  /** Send now if there is a batch, otherwise hold. */
  readonly deliver: (files: readonly File[]) => void;
  /** How many images are waiting; drives the §4.0a message. */
  readonly heldCount: number;
}

export function useHeldImages(
  batchReady: boolean,
  onImagesReady: (files: readonly File[]) => void,
): HeldImages {
  // A ref as well as state: `deliver` may be called twice before React
  // re-renders (two fast pastes), and a state-only queue would lose the first.
  const heldRef = useRef<readonly File[]>([]);
  const [heldCount, setHeldCount] = useState(0);

  const deliver = useCallback(
    (files: readonly File[]): void => {
      if (files.length === 0) return;
      if (batchReady) {
        onImagesReady(files);
        return;
      }
      heldRef.current = [...heldRef.current, ...files];
      setHeldCount(heldRef.current.length);
    },
    [batchReady, onImagesReady],
  );

  useEffect(() => {
    if (!batchReady || heldRef.current.length === 0) return;
    const pending = heldRef.current;
    // Cleared BEFORE the hand-off so a re-entrant render cannot deliver twice.
    heldRef.current = [];
    setHeldCount(0);
    onImagesReady(pending);
  }, [batchReady, onImagesReady]);

  return { deliver, heldCount };
}
