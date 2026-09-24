/**
 * TASK-066 — `PATCH /api/batches/:batchId/candidates/:candidateId` and
 * `POST /api/batches/:batchId/candidates/confirm-all` (`specs/api.md` §6.18,
 * §6.19). `T-REV-011`, `T-REV-014`.
 *
 * Everything that decides what the owner MEANT lives in
 * `packages/domain/src/candidatePatch.ts`. This file gates, resolves and
 * writes.
 *
 * ⚠ **A correction re-resolves `workIdentity` IMMEDIATELY** (US-007 AC-3), so
 * the review pass shows the corrected match before close. Deferring it to
 * close would leave the owner staring at the wrong name after fixing it, with
 * no way to tell whether the fix registered.
 *
 * ⚠ **The 409 gate is `status !== 'in-review'`, on every route here.** A batch
 * that has already been applied is immutable; a batch still extracting has
 * candidates being written underneath. Both would otherwise accept a write
 * that either does nothing or corrupts an applied result.
 */

import { verifyEditionSelection } from '../services/titleEditions.js';
import {
  canBulkConfirm,
  normaliseTitleText,
  parseCandidatePatch,
  parseConfirmAllSection,
  parseManualEntry,
  sectionForCandidate,
  ulid,
  workIdentityForTmdb,
  type CandidatePatch,
  type ManualEntry,
  type ReviewCandidate,
  requireServiceOf,
} from '@nextup/domain';
import { type Router } from 'express';

import { TmdbClient, TmdbUnavailableError, TmdbWorkNotFoundError } from '../clients/tmdbClient.js';
import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import {
  confirmPendingCandidates,
  createExtractionCandidate,
  findExtractionCandidate,
  findUploadBatch,
  listActiveSuppressions,
  listCandidatesForBatch,
  updateCandidateDisposition,
} from '../repository/ownerData.js';
import { loadReviewCandidates } from './batchReview.js';
import { tmdbUnavailableAppError } from './tmdb.js';

/** Loads the batch and refuses anything that is not open for review. */
async function requireReviewableBatch(
  ownerId: ReturnType<typeof requireOwnerId>,
  batchId: string,
): Promise<{ id: string; service: string | null; discoverySource: string | null; status: string }> {
  const batch = await findUploadBatch(ownerId, batchId);
  if (batch === null) {
    throw new AppError('NOT_FOUND', 404, 'No such batch.');
  }
  if (batch.status !== 'in-review') {
    throw new AppError('BATCH_NOT_IN_REVIEW', 409, 'That batch is not ready to review yet.', {
      status: batch.status,
    });
  }
  return batch;
}

/** Turns a domain parse failure into the API's validation envelope. */
function unwrap<T>(result: ReturnType<typeof parseCandidatePatch> | { ok: true; value: T }): T {
  if (!result.ok) {
    throw new AppError('VALIDATION_FAILED', 400, result.message, result.details);
  }
  return result.value as T;
}

/**
 * What the owner sees back after a write. Shaped field by field, never spread
 * from the row (`T-SEC-003`).
 */
function toPatchedCandidate(row: {
  id: string;
  rawText: string;
  inferredTitle: string | null;
  cleanupVerdict: string;
  resolvedWorkIdentity: string | null;
  correctedToTmdbId: number | null;
  reviewDisposition: string;
}) {
  return {
    candidateId: row.id,
    rawText: row.rawText,
    inferredTitle: row.inferredTitle,
    verdict: row.cleanupVerdict,
    resolvedWorkIdentity: row.resolvedWorkIdentity,
    correctedToTmdbId: row.correctedToTmdbId,
    disposition: row.reviewDisposition,
  };
}

/**
 * Applies a correction: `disposition: 'corrected'` + a TMDB target.
 *
 * Two things happen here and the ORDER matters:
 *
 *   1. the target identity is composed — deterministically, with no network
 *      call, because `tmdb:<mediaType>:<id>` is fully determined by the body
 *      and a TMDB outage must not stop the owner fixing a wrong match;
 *   2. the SUPPRESSION gate — correcting ONTO a work the owner has said they
 *      are not interested in would re-admit it through the back door
 *      (REQ-071), so it is refused with `TARGET_WORK_SUPPRESSED`.
 *
 * ⚠ **THERE IS NO DUPLICATE GATE HERE, AND REINTRODUCING ONE IS A DATA-LOSS
 * DEFECT.** An earlier version refused this correction with 409
 * `DUPLICATE_WORK_IDENTITY` whenever the target work already held an active
 * listing on this service, unless the caller sent `confirmDuplicate: true`.
 * It was measured live and every part of it was wrong:
 *
 *   - **The PRD mandates the opposite.** US-012 AC-5 reads: *"The owner
 *     corrects a match to a work that already has an active listing for this
 *     service → **the correction is applied**, the item is re-classified as
 *     already present, moves out of Additions, and closing the batch does not
 *     create a duplicate Title."* The refusal was not a stricter reading of
 *     AC-5; it was its inverse. `specs/api.md` §6.18 lists only 200, 400 and
 *     `BATCH_NOT_IN_REVIEW` for this endpoint — the code was answering with an
 *     error the endpoint's own contract does not contain.
 *   - **The premise is false.** Close cannot create a duplicate Title here:
 *     `services/batchClose.ts` resolves every confirmed candidate through
 *     `findTitleByWorkIdentity` and re-uses the existing row, attaching a
 *     listing only where the service lacks one. The gate was defending
 *     against an outcome that the write path already makes unreachable.
 *   - **It fired on the NORMAL case.** A full update is a re-capture of the
 *     whole list, so *almost every title in it is already on the list by
 *     definition*. The condition the gate treats as an anomaly is the
 *     expected state of the mode.
 *   - **It was unreachable to escape.** `ReviewRoute.matchUnmatched` never
 *     sends `confirmDuplicate`, and `UnmatchedActions` has no branch for the
 *     code, so the 409 surfaced as the generic *"Couldn't save that. Nothing
 *     has changed."* The owner was not told it was a duplicate and was given
 *     no way to insist. The correction was not merely awkward — it was
 *     impossible.
 *
 * ⚠ **And the refusal then proposed DELETING the title it had just refused to
 * let the owner identify** — product invariant 2, REQ-006. Reconciliation
 * unions the `resolvedWorkIdentity` of every surviving candidate
 * (`reconcile.ts`) and proposes removing each active listing outside that
 * union. A refused correction leaves the candidate pointing at the work the
 * extraction *mis*-read, so the real work never joins the union, so its
 * listing is offered for removal. A misread title being read as a removal is
 * the single failure mode this product is built to prevent, and the gate
 * manufactured it.
 *
 * Applying the correction closes all of it at once: the candidate's identity
 * becomes the real work, `classification: null` makes the next review read
 * re-derive it as already-present (AC-5's second clause), and that same
 * identity enters the reconciliation union, withdrawing the removal.
 */
async function applyCorrection(
  ownerId: ReturnType<typeof requireOwnerId>,
  candidateId: string,
  patch: Extract<CandidatePatch, { kind: 'corrected' }>,
): Promise<void> {
  const workIdentity = workIdentityForTmdb(patch.mediaType, patch.tmdbId);

  const suppressions = await listActiveSuppressions(ownerId);
  if (suppressions.some((s) => s.workIdentity === workIdentity)) {
    throw new AppError(
      'TARGET_WORK_SUPPRESSED',
      409,
      "You marked that title as not interested. Un-suppress it first if you'd like it back.",
      { workIdentity },
    );
  }

  await updateCandidateDisposition(ownerId, candidateId, {
    reviewDisposition: 'corrected',
    resolvedWorkIdentity: workIdentity,
    correctedToTmdbId: patch.tmdbId,
    // REQ-109 — what the owner corrected TO, so the review card can show it.
    //
    // ⚠ These are DISPLAY ONLY and never identity (SD-05): `workIdentity`
    // above is derived solely from `tmdbId` + `mediaType`. They are written
    // here rather than fetched because this function is network-free on
    // purpose (see the header) — and `null` when the client sent none, which
    // leaves the review read on its previous fallback rather than failing a
    // correction the owner is entitled to make.
    //
    // ⚠ `matchCandidates` is still NOT rewritten. See the comment in
    // `services/batchClose.ts`: the extraction's guesses and the owner's
    // decision are two different facts.
    correctedDisplayName: patch.display?.name ?? null,
    correctedDisplayYear: patch.display?.releaseYear ?? null,
    correctedDisplayPoster: patch.display?.posterPath ?? null,
    correctedDisplayEdition:
      patch.display?.edition === undefined ? null : JSON.stringify(patch.display.edition),
    // ⚠ A corrected candidate is a TITLE by definition — the owner just named
    // it. Leaving a `chrome-suspected` or `unreadable-tile` verdict in place
    // would leave the item collapsed behind an expander after the owner fixed
    // it, and `sectionForCandidate` decides on the verdict FIRST.
    cleanupVerdict: 'title-candidate',
    // The classification is recomputed from the new identity on the next
    // review read; a stale one here would say "already on your list" about the
    // work the owner corrected AWAY from.
    classification: null,
  });
}

/**
 * Rescues a `chrome-suspected` item and re-runs matching for it (§6.18).
 *
 * ⚠ **A TMDB outage must not lose the rescue.** The verdict flip is what the
 * owner asked for and it is recorded whether or not the search succeeds; the
 * match is a best effort on top. Failing the whole request on a 503 would
 * leave the item collapsed behind the chrome expander with no indication the
 * owner ever pressed anything.
 */
async function applyReclassify(
  ownerId: ReturnType<typeof requireOwnerId>,
  candidateId: string,
  row: { rawText: string; inferredTitle: string | null },
  getClient: () => TmdbClient,
): Promise<void> {
  await updateCandidateDisposition(ownerId, candidateId, {
    cleanupVerdict: 'title-candidate',
    // Back to `pending`: the rescue says "this IS a title", not "add it".
    // There is no accept-by-inaction (REQ-014), and a rescue that also
    // confirmed would add a row the owner never agreed to.
    reviewDisposition: 'pending',
  });

  const query = (row.inferredTitle ?? row.rawText).trim();
  if (query === '') return;

  try {
    const results = await getClient().searchMulti(query, { limit: 5, evidenceText: row.rawText });
    await updateCandidateDisposition(ownerId, candidateId, {
      matchCandidates: JSON.stringify(
        results.map((item, position) => ({
          tmdbId: item.tmdbId,
          mediaType: item.mediaType,
          name: item.name,
          releaseYear: item.releaseYear,
          posterPath: item.posterPath,
          ...(item.edition === undefined ? {} : { edition: item.edition }),
          // Rank-derived, and deliberately NOT the matcher's score: this is a
          // raw TMDB ordering, and presenting it as a confidence the matcher
          // produced would let a later reader treat it as auto-matchable.
          score: Math.max(0, 0.9 - position * 0.1),
        })),
      ),
    });
  } catch (error) {
    if (error instanceof TmdbUnavailableError) return;
    throw error;
  }
}

export function registerBatchCandidateRoutes(
  router: Router,
  getTmdbClient: () => TmdbClient,
): void {
  router.patch('/batches/:batchId/candidates/:candidateId', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const batchId = req.params.batchId ?? '';
    const candidateId = req.params.candidateId ?? '';

    // Existence and ownership BEFORE the body, matching every other write
    // here (see `batchImages.ts`). `T-SEC-002g` walks every id-bearing route
    // on the real router with another owner's ids and requires a flat 404;
    // parsing first answers 400 for a foreign id, which is a different answer
    // from the one a missing id gets and so is a disclosure.
    const batch = await requireReviewableBatch(ownerId, batchId);

    const row = await findExtractionCandidate(ownerId, candidateId);
    // Owner-scoped read, so a foreign candidate is indistinguishable from a
    // missing one and must stay that way (`T-SEC-002d`).
    if (row === null || row.batchId !== batch.id) {
      throw new AppError('NOT_FOUND', 404, 'No such candidate.');
    }

    const patch = unwrap<CandidatePatch>(parseCandidatePatch(req.body));

    // ⚠ ROUTE-LEVEL TMDB NET. A `TmdbUnavailableError` that reaches this
    // handler becomes 502 `TMDB_UNAVAILABLE`, IDENTICALLY to `/tmdb/search`
    // and via the SAME shared mapper — never the generic 500 the envelope
    // gives an unrecognised throw. Today `applyReclassify` swallows the only
    // such error on this route by design (an outage during a rescue leaves the
    // item unmatched and the batch reviewable — `T-AI-017a`), so this net is
    // not reached on the reclassify path. It exists because that swallow is
    // one `return` away from being removed by a well-meaning refactor, which
    // would otherwise turn a routine third-party outage into an opaque 500 on
    // a route the owner uses mid-review. The `instanceof` check is what keeps
    // it precise: a database failure here is NOT a TMDB outage and must stay a
    // 500, so the mapper returns `null` for it and the error re-throws.
    try {
      if (patch.kind === 'disposition') {
        await updateCandidateDisposition(ownerId, candidateId, {
          reviewDisposition: patch.disposition,
        });
      } else if (patch.kind === 'corrected') {
        // ⚠ `requireServiceOf(batch)` used to be evaluated here to feed the
        // deleted duplicate gate, and it THROWS for a discovery batch
        // (ADR-0010 D-1 — a discovery capture has no service). Correcting a
        // mis-read title is exactly as necessary in a discovery review as in
        // a service one, so the gate's removal also removes a call that would
        // have refused the whole correction on the one batch kind that has no
        // service to be a duplicate within. The correction itself never needed
        // one: `workIdentity` comes from `tmdbId` + `mediaType` alone.
        await applyCorrection(ownerId, candidateId, patch);
      } else {
        await applyReclassify(ownerId, candidateId, row, getTmdbClient);
      }
    } catch (error) {
      const mapped = tmdbUnavailableAppError(error);
      if (mapped) throw mapped;
      throw error;
    }

    const updated = await findExtractionCandidate(ownerId, candidateId);
    if (updated === null) {
      throw new AppError('NOT_FOUND', 404, 'No such candidate.');
    }
    res.status(200).json(toPatchedCandidate(updated));
  });

  /**
   * §6.19 — the OQ-011 bulk affordance. An EXPLICIT action, so REQ-014's
   * no-accept-by-inaction rule is intact: nothing here happens by default.
   */
  router.post('/batches/:batchId/candidates/confirm-all', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const batchId = req.params.batchId ?? '';

    // Ownership before the body, for the reason given on the PATCH above.
    const batch = await requireReviewableBatch(ownerId, batchId);

    const section = unwrap<'additions' | 'unmatched' | 'alreadyOnYourList'>(
      parseConfirmAllSection(req.body),
    );

    const { candidates } = await loadReviewCandidates(ownerId, batch.id, requireServiceOf(batch));

    // ⚠ Sections are decided by the SAME code the review response uses. A
    // second, simpler rule here — "everything with classification 'new'", say
    // — would drift from what the owner is looking at, and the drift is
    // invisible: the count comes back plausible and the wrong rows move.
    const inSection = candidates.filter(
      (candidate: ReviewCandidate) =>
        candidate.collapsedIntoCandidateId === null && sectionForCandidate(candidate) === section,
    );
    const confirmable = inSection.filter(canBulkConfirm);

    const { count } = await confirmPendingCandidates(
      ownerId,
      confirmable.map((candidate) => candidate.candidateId),
    );

    res.status(200).json({
      section,
      confirmed: count,
      // Everything in the section this press did NOT change — already
      // confirmed, already corrected, or explicitly discarded. Reported so
      // "confirmed: 0" on a section the owner has already worked through is
      // distinguishable from "confirmed: 0" on an empty one.
      skipped: inSection.length - count,
    });
  });

  /**
   * §6.20 — the manual-entry escape hatch (US-006 AC-5): a work the extraction
   * missed entirely, added as part of THIS batch so it goes through the same
   * review and the same close.
   *
   * ⚠ **The suppression gate is on WORK IDENTITY, not on any row** (REQ-071,
   * invariant 1). A suppressed work re-entering by hand is the same back door
   * `applyCorrection` closes, one screen further along.
   *
   * ⚠ **TMDB is consulted and its failure modes are NOT collapsed.** An
   * unknown id is refused (404) rather than written: an entry whose identity
   * names a work TMDB does not have has no name, no poster and no metadata at
   * close, and would sit on the list as a permanent blank. An outage is a 502
   * and the entry is simply not made — unlike a *correction*, where the owner
   * has already lost something and refusing would strand them, nothing is lost
   * by asking them to add the title again in a minute.
   */
  router.post('/batches/:batchId/manual-entry', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const batchId = req.params.batchId ?? '';

    // Ownership before the body, for the reason given on the PATCH above.
    const batch = await requireReviewableBatch(ownerId, batchId);

    const entry = unwrap<ManualEntry>(parseManualEntry(req.body));
    const workIdentity = workIdentityForTmdb(entry.mediaType, entry.tmdbId);

    const suppressions = await listActiveSuppressions(ownerId);
    if (suppressions.some((s) => s.workIdentity === workIdentity)) {
      throw new AppError(
        'WORK_SUPPRESSED',
        409,
        "You marked that title as not interested. Un-suppress it first if you'd like it back.",
        { workIdentity },
      );
    }

    // ⚠ `discarded` candidates are deliberately EXCLUDED from this gate. The
    // owner discarding a mis-read row and then adding the right work by hand
    // is the ordinary path through the artwork-only tile; treating the
    // discarded row as "already in this batch" would refuse the only
    // affordance that fixes it, with a message saying the title is already
    // there when the review pass shows it struck out.
    const existing = await listCandidatesForBatch(ownerId, batch.id);
    const clash = existing.find(
      (row) => row.resolvedWorkIdentity === workIdentity && row.reviewDisposition !== 'discarded',
    );
    if (clash !== undefined) {
      throw new AppError('ALREADY_IN_BATCH', 409, 'That title is already in this import.', {
        workIdentity,
        candidateId: clash.id,
      });
    }

    let detail;
    try {
      detail = await getTmdbClient().getWork(entry.mediaType, entry.tmdbId);
    } catch (error) {
      if (error instanceof TmdbWorkNotFoundError) {
        throw new AppError('TMDB_WORK_NOT_FOUND', 404, 'TMDB has no such work.', {
          tmdbId: entry.tmdbId,
          mediaType: entry.mediaType,
        });
      }
      // An outage is a 502 and the entry is simply not made. The mapping is the
      // shared one in `tmdb.ts`, so this route and `/tmdb/search` cannot drift.
      const mapped = tmdbUnavailableAppError(error);
      if (mapped) throw mapped;
      throw error;
    }

    const candidateId = ulid();
    const edition = await verifyEditionSelection(
      getTmdbClient(),
      entry.mediaType,
      entry.tmdbId,
      entry.edition,
    );
    await createExtractionCandidate(ownerId, {
      id: candidateId,
      batchId: batch.id,
      // ⚠ `rawText` is "what the row came from", and for a manual entry that
      // is the owner's own choice, not anything a reader saw. The TMDB name is
      // recorded verbatim so the review card has something to show; nothing
      // here enters identity (SD-05), which is `tmdb:<type>:<id>` alone.
      rawText: detail.name,
      inferredTitle: detail.name,
      // ⚠ No screenshot was read, and the stored vocabulary has no value that
      // says so — `provider` is CHECK-constrained to `llm`/`ocr-only` and
      // `box_source` to `ocr`/`llm` (`prisma/migrations`), neither of which is
      // true here. `basis: 'unknown'` and `ocrSupport: 'not-checked'` are the
      // honest members of their sets; `provider: 'llm'` is chosen because it
      // is the value with no observable claim attached (`CandidateCard` shows
      // an "OCR only" chip for the other one, which would be a visible lie),
      // and `boundingBoxes: null` + `ocrConfidence: null` leave no evidence a
      // reader never produced. Recorded as a data-model finding on TASK-067.
      basis: 'unknown',
      ocrSupport: 'not-checked',
      provider: 'llm',
      boxSource: 'llm',
      normalisedText: normaliseTitleText(detail.name),
      ...(detail.releaseYear === null ? {} : { extractedYear: detail.releaseYear }),
      cleanupVerdict: 'title-candidate',
      resolvedWorkIdentity: workIdentity,
      correctedToTmdbId: entry.tmdbId,
      // The owner picked this work by hand out of a TMDB search; there is
      // nothing left for them to decide about it, so §6.20 fixes the
      // disposition at `confirmed`. This is NOT accept-by-inaction (REQ-014):
      // the act of adding IS the explicit action.
      reviewDisposition: 'confirmed',
      // Recomputed from the identity on the next review read — a value written
      // here would go stale the moment another entry in the batch resolves to
      // the same work.
      classification: null,
      matchCandidates: JSON.stringify([
        {
          tmdbId: detail.tmdbId,
          mediaType: detail.mediaType,
          name: detail.name,
          releaseYear: detail.releaseYear,
          posterPath: detail.posterPath,
          // 1 — and this is the ONE place a certainty of 1 is truthful: the
          // owner named the work. Nothing was matched.
          score: 1,
          ...(edition === undefined ? {} : { edition }),
        },
      ]),
    });

    res.status(201).json({
      candidateId,
      resolvedWorkIdentity: workIdentity,
      disposition: 'confirmed',
    });
  });
}
