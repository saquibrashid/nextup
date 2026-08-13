/**
 * `POST /api/titles/:titleId/suppress` — "not interested" (`specs/api.md` §6.6,
 * US-027, TASK-101).
 *
 * ⚠ **The route takes a TITLE ID; the suppression is keyed on the title's WORK
 * IDENTITY.** Those are two different things and the gap between them is the
 * entire point (REQ-071, product invariant 1). The client has a row in front
 * of the owner, so a row id is what it can send; but a suppressed work that
 * reappears in a later capture becomes a BRAND-NEW row with a BRAND-NEW id
 * (product invariant 7). Store the row id and suppression appears to work,
 * then silently stops on the next upload — re-showing something the owner
 * explicitly rejected, with nothing to indicate anything went wrong. So the
 * title id is used ONCE, to resolve an identity, and is never persisted.
 *
 * This is also why suppressing a two-badge title hides the whole row
 * (US-027 AC-5, `T-SUP-014`): the identity is per work, and both services'
 * listings hang off the same work. There is no per-service suppression to get
 * wrong, because there is no per-service key.
 *
 * Nothing is deleted (`T-SUP-012`, REQ-028). The listings stay exactly as they
 * were; the combined list's anti-join in `listTitlePage` is what stops
 * rendering them. Un-suppression therefore restores visibility without having
 * to restore anything, which is why `/unsuppress` can honestly report
 * `restoredAnything: false`.
 */

import { suppressionIdFor } from '@nextup/domain';
import { type Router } from 'express';

import { AppError } from '../errors/AppError.js';
import {
  createSuppression,
  findActiveSuppression,
  findTitle,
  isUniqueViolation,
  reactivateSuppression,
} from '../repository/ownerData.js';
import { requireOwnerId } from '../middleware/requestContext.js';

/** The subset of a title this route reads. Declared so the shaping is testable. */
export interface SuppressibleTitle {
  workIdentity: string;
  rawExtractedText: string | null;
  tmdbName: string | null;
  tmdbReleaseYear: number | null;
  tmdbMediaType: string | null;
  tmdbPosterPath: string | null;
}

export interface DisplaySnapshot {
  displayName: string;
  displayReleaseYear: number | null;
  displayMediaType: string | null;
  displayPosterPath: string | null;
}

/**
 * Freezes what the work looked like when the owner rejected it.
 *
 * The suppressed view has to render **without a title row** (US-029 AC-1,
 * `specs/data-model.md` §3.5) — the title may since have been removed, and a
 * suppression on an `unmatched:*` identity may never have had TMDB metadata at
 * all. Reading through to the title at display time would show the owner an
 * empty row for a decision they definitely made, so the name is copied here.
 *
 * The `?? ''` is a last resort, not a default: `name` is `NOT NULL` in the
 * store, and a suppression the owner cannot recognise is barely better than
 * none. It exists because refusing the suppression outright would be worse —
 * the owner's decision is the thing worth keeping.
 */
export function toDisplaySnapshot(title: SuppressibleTitle): DisplaySnapshot {
  return {
    displayName: title.tmdbName ?? title.rawExtractedText ?? '',
    displayReleaseYear: title.tmdbReleaseYear,
    displayMediaType: title.tmdbMediaType,
    displayPosterPath: title.tmdbPosterPath,
  };
}

export function registerSuppressionRoutes(router: Router): void {
  router.post('/titles/:titleId/suppress', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const titleId = req.params.titleId ?? '';

    const title = await findTitle(ownerId, titleId);
    // 404, not 403, for a title belonging to someone else — `findTitle` is
    // owner-scoped, so a foreign id is indistinguishable from a missing one
    // and must stay that way (`T-SEC-002d`). Answering 403 would confirm the
    // row exists.
    if (title === null) {
      throw new AppError('NOT_FOUND', 404, 'No such title.');
    }

    const { workIdentity } = title;
    const suppressionId = suppressionIdFor(workIdentity);

    // Idempotency is decided by the STORE, in three ordered steps, so that a
    // repeat press cannot rewrite the date the owner made the decision
    // (`T-SUP-013`).
    //
    // 1. Already active → nothing is written at all.
    if ((await findActiveSuppression(ownerId, workIdentity)) !== null) {
      res.status(200).json({ suppressionId, workIdentity, alreadySuppressed: true });
      return;
    }

    const now = new Date();

    // 2. Previously lifted → re-arm the SAME document. `active: false` is in
    //    the `where`, so this is a no-op if step 1 raced ahead of it.
    const { count } = await reactivateSuppression(ownerId, workIdentity, now);
    if (count > 0) {
      res.status(200).json({ suppressionId, workIdentity, alreadySuppressed: false });
      return;
    }

    // 3. Never suppressed → create. The unique-violation catch is the third
    //    arm of the same idempotency: two presses in flight together both
    //    reach here, and the loser must report success rather than a 500. The
    //    owner pressed a button twice; that is not an error condition.
    try {
      await createSuppression(ownerId, {
        id: suppressionId,
        workIdentity,
        active: true,
        suppressedAt: now,
        ...toDisplaySnapshot(title),
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      res.status(200).json({ suppressionId, workIdentity, alreadySuppressed: true });
      return;
    }

    res.status(200).json({ suppressionId, workIdentity, alreadySuppressed: false });
  });
}
