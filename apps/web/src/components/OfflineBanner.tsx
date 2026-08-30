/**
 * `OfflineBanner` (TASK-125) — the persistent, global offline state
 * (`specs/ux-states.md` §11, `T-UX-023`).
 *
 * ⚠ **MOUNTED ONCE IN `AppShell`, NOT PER PAGE.** §11 requires an offline
 * state on the list, upload, batch status, review, removed, not-interested and
 * batches surfaces — seven screens. Seven per-page banners is seven chances
 * for one to be forgotten, and that is exactly what happened before this
 * component existed: batch status had a careful §5.8 implementation and the
 * other six had nothing at all. Rendering it in the shell makes "every
 * surface" structurally true rather than a checklist someone has to re-verify.
 *
 * ⚠ **IT DOES NOT REPLACE THE PAGE.** The banner sits above the routed screen
 * and the screen keeps whatever it had loaded, per §2.12 — cached rows stay,
 * marked as cached. A full-screen offline takeover would discard the list the
 * owner was reading and, on the review screen, would discard dispositions they
 * had already made. §6.17 is explicit that dispositions keep working offline.
 *
 * ⚠ **`role="status"` WITH `aria-live="polite"`, NOT `role="alert"`.** Losing
 * a connection is not an error the owner caused and cannot be acted on
 * immediately; an assertive live region interrupts a screen-reader user
 * mid-sentence to say so. It is announced, then it stays put.
 */

import type { JSX } from 'react';

import { OFFLINE_BANNER } from '../copy';

export interface OfflineBannerProps {
  readonly offline: boolean;
}

export function OfflineBanner({ offline }: OfflineBannerProps): JSX.Element | null {
  if (!offline) return null;

  return (
    <p className="offline-banner" role="status" aria-live="polite" data-testid="offline-banner">
      {OFFLINE_BANNER}
    </p>
  );
}
