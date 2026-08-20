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
  deactivateSuppression,
  findActiveSuppression,
  findSuppression,
  findTitle,
  isUniqueViolation,
  listActiveSuppressions,
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

/**
 * How much the identity this suppression is keyed on can be trusted
 * (`specs/api.md` §6.7, `specs/data-model.md` §2.3.1).
 *
 * A `tmdb:*` identity is a stable external key: the same work reads the same
 * way whatever the screenshot looked like. An `unmatched:*` identity is a hash
 * of the TEXT WE READ, so a future capture that OCRs one character differently
 * produces a different identity — and the suppression legitimately stops
 * applying. That is not a bug to be hidden; `ui.md` §7 renders a caveat line
 * for exactly this row, and it can only do so if the API says which kind it is.
 *
 * Derived, never stored: it is a function of `workIdentity`, and a persisted
 * copy could disagree with it after a fix-match migration (SD-06).
 */
export function identityStabilityOf(workIdentity: string): 'stable' | 'text-derived' {
  return workIdentity.startsWith('unmatched:') ? 'text-derived' : 'stable';
}

/** One row of the suppressed view, shaped so it renders WITHOUT a title row. */
export interface SuppressionItem {
  suppressionId: string;
  workIdentity: string;
  suppressedAt: string;
  identityStability: 'stable' | 'text-derived';
  displaySnapshot: {
    name: string;
    releaseYear: number | null;
    mediaType: string | null;
    posterPath: string | null;
  };
  unsuppressHref: string;
}

interface StoredSuppression {
  id: string;
  workIdentity: string;
  suppressedAt: Date;
  displayName: string;
  displayReleaseYear: number | null;
  displayMediaType: string | null;
  displayPosterPath: string | null;
}

/**
 * ⚠ Shaped field by field, NEVER spread from the row.
 *
 * `T-SEC-003` guards against a future `...row` leaking a column that was never
 * meant for a client; here the same discipline keeps `migratedFrom` — the
 * PREVIOUS work identity of a fix-matched title — out of a response that has no
 * use for it.
 */
export function toSuppressionItem(row: StoredSuppression): SuppressionItem {
  return {
    suppressionId: row.id,
    workIdentity: row.workIdentity,
    suppressedAt: row.suppressedAt.toISOString(),
    identityStability: identityStabilityOf(row.workIdentity),
    displaySnapshot: {
      name: row.displayName,
      releaseYear: row.displayReleaseYear,
      mediaType: row.displayMediaType,
      posterPath: row.displayPosterPath,
    },
    unsuppressHref: `/api/suppressions/${encodeURIComponent(row.id)}/unsuppress`,
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

  /**
   * `GET /api/suppressions` — the "Not interested" view (§6.7, US-029 AC-1).
   *
   * Reads the frozen `displaySnapshot` and never joins back to `Title`. The
   * suppressed work may have no title row at all — it may have been removed
   * since, or it may be an `unmatched:*` identity that never had TMDB metadata
   * — and a join would render the owner an empty row for a decision they
   * definitely made.
   */
  router.get('/suppressions', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const rows = await listActiveSuppressions(ownerId);
    res.status(200).json({ items: rows.map(toSuppressionItem) });
  });

  /**
   * `POST /api/suppressions/:suppressionId/unsuppress` — "interested again"
   * (§6.8, US-029 AC-2/AC-4).
   *
   * ⚠ `restoredAnything` IS ALWAYS `false`, AND THAT IS THE FEATURE.
   * Un-suppressing lifts a filter; it does not restore anything (product
   * invariant 7 — restore is an explicit user action, never an automatic
   * consequence). The field is not a status flag that happens to be false
   * today and might be true later: it exists so the client can state the
   * limitation plainly (`ui.md` §7) instead of leaving the owner to discover
   * that the removed row they were expecting never came back. Computing it —
   * counting rows and reporting the count — would make it true one day and
   * silently turn an honest sentence into a false one.
   *
   * ⚠ Nothing is deleted (REQ-028, `T-SUP-021`). The row is flipped to
   * `active: false` and keeps `suppressedAt`, so the history of the decision
   * survives; the filtered unique index `suppression_one_active` then frees
   * the identity for a future suppression without losing this one.
   */
  router.post('/suppressions/:suppressionId/unsuppress', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const suppressionId = req.params.suppressionId ?? '';

    // Owner-scoped, and NOT filtered on `active` — see `findSuppression`.
    const suppression = await findSuppression(ownerId, suppressionId);
    if (suppression === null) {
      throw new AppError('NOT_FOUND', 404, 'No such suppression.');
    }

    // Idempotent by construction: `deactivateSuppression` matches only active
    // rows, so a second press writes nothing and leaves the original
    // `unsuppressedAt` — the moment the owner actually changed their mind —
    // exactly as it was. Both presses answer 200.
    await deactivateSuppression(ownerId, suppression.workIdentity, new Date());

    res.status(200).json({
      suppressionId: suppression.id,
      active: false,
      restoredAnything: false,
    });
  });
}
