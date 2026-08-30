/**
 * TASK-176 — the four-state resource (`specs/ui.md` §12.2, ADR-0012 D-2).
 *
 * ⚠ FOUR STATES, AND ONLY FOUR. `isLoading` + `error` + `data` admits eight
 * combinations, of which half cannot be rendered sensibly, and it pushes the
 * decision about each one into every screen — differently each time. A closed
 * union makes the exhaustive `switch` the natural way to write the screen.
 *
 * ⚠ `refused` AND `failed` ARE DIFFERENT FACTS and must not be merged:
 * *"nextup will not show you this"* versus *"nextup could not reach the
 * server"*. Merged, the owner is offered a retry that can never succeed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { RefusedError } from './apiClient';

/**
 * The `details` key the API decorates a 403 `NOT_ALLOWED` with
 * (`apps/api/src/middleware/errorEnvelope.ts`).
 *
 * ⚠ Narrowed to `string`, not cast. `details` is `Record<string, unknown>` off
 * the wire; a cast would let a number or an object reach the DOM as `[object
 * Object]` on the one screen the owner reaches when nothing else works.
 */
const SIGNED_IN_AS_DETAIL = 'signedInAs';

function signedInAsFrom(error: RefusedError): string | null {
  const value = error.details?.[SIGNED_IN_AS_DETAIL];
  return typeof value === 'string' && value !== '' ? value : null;
}

export type Resource<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly value: T }
  /**
   * ⚠ `refused` CARRIES A PAYLOAD, unlike `failed`. `ux-states.md` §2.11
   * requires the refusal to name the signed-in account, and this is the only
   * place that fact survives: the refusal is thrown, so the screen never sees
   * the response body unless the union carries it. `null` when the API did not
   * supply one — an absent name renders no line at all, never a blank one.
   */
  | { readonly kind: 'refused'; readonly signedInAs: string | null }
  | { readonly kind: 'failed' };

export interface UseResource<T> {
  readonly resource: Resource<T>;
  /**
   * Re-runs the load. ⚠ This is the ONLY retry that exists (REQ-100): it is
   * called from the owner's click on the retry affordance, never from a timer
   * and never from a failure handler.
   */
  readonly reload: () => void;
}

/**
 * Loads a resource, once per change of `key`.
 *
 * A READ in an effect is correct and is not what REQ-102 forbids — that rule
 * is about mutations (§12.6). React 19's StrictMode double-invoke still runs
 * this twice in development, which for a read is merely a duplicate `GET`;
 * the abort on cleanup means the first one's result is discarded rather than
 * racing the second into state.
 *
 * @param load  receives an `AbortSignal`; must pass it to the client.
 * @param key   a primitive that changes when the request should change. The
 *              query string is the usual value, which is what makes the URL
 *              the request (§12.5) rather than a copy of it.
 */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string,
): UseResource<T> {
  const [resource, setResource] = useState<Resource<T>>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // ⚠ `load` is typically an inline arrow, so it is a NEW FUNCTION ON EVERY
  // RENDER. Depending on it directly would re-fire the effect forever — an
  // infinite request loop against a single 0.25 vCPU replica. `key` is the
  // declared identity of the request instead, and the ref keeps the closure
  // current without making it a dependency.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const stableLoad = loadRef.current;
    const controller = new AbortController();
    let live = true;

    setResource({ kind: 'loading' });

    stableLoad(controller.signal).then(
      (value) => {
        if (live) setResource({ kind: 'ok', value });
      },
      (error: unknown) => {
        // ⚠ An abort is NOT a failure. Under StrictMode the first mount's
        // request is always aborted, so treating it as one would render every
        // screen as broken in development — and only in development.
        if (controller.signal.aborted) return;
        if (!live) return;
        setResource(
          error instanceof RefusedError
            ? { kind: 'refused', signedInAs: signedInAsFrom(error) }
            : { kind: 'failed' },
        );
      },
    );

    return () => {
      live = false;
      controller.abort();
    };
  }, [key, attempt]);

  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { resource, reload };
}
