/**
 * TASK-112 — creates-only batch undo (SD-03, `specs/data-model.md` §8.3,
 * REQ-067, US-032).
 *
 * ⚠ WHY THE PREDICATE IS PURE AND LIVES HERE. `undoable` is reported by
 * `POST /api/batches/:batchId/close` (`specs/api.md` §6.22), by the batch
 * history view, and by the undo route itself as its own admission gate. Three
 * call sites answering the same question is three chances to answer it
 * differently — and the failure mode is not a wrong badge, it is an undo that
 * offers itself for a batch it cannot correctly reverse. Keeping it a pure
 * function over provenance means all three read the same answer, and
 * `T-UNDO-001` can assert it as data rather than through a request.
 *
 * ⚠ THE DEFINITION IS `modified` AND `removed` BOTH EMPTY — not "created is
 * non-empty". A batch that created nothing is creates-only and undoes as a
 * NO-OP (US-032 AC-5). Writing the predicate as `created.length > 0` would
 * refuse that batch, which reads as a bug to the owner: the button vanishes
 * for the one batch that is trivially safe to reverse.
 */

import type { BatchProvenance } from './types.js';

/**
 * SD-03's admission test: a batch is undoable as a whole only when it did
 * nothing but create.
 *
 * A `modified` entry means the batch overwrote a value that undo would have to
 * restore, and a `removed` entry means it soft-removed a listing that undo
 * would have to bring back — v1 reverses neither (`specs/data-model.md` §8.3),
 * so the honest answer is the enumerated refusal of §8.4 rather than a partial
 * undo that leaves the list in a state the owner never chose.
 */
export function isCreatesOnly(provenance: BatchProvenance): boolean {
  return provenance.modified.length === 0 && provenance.removed.length === 0;
}

/**
 * TASK-113 — an owner edit made to a created title AFTER the batch closed.
 *
 * ⚠ **NOT DECIDABLE FROM PROVENANCE, WHICH IS THE WHOLE POINT.** Suppress and
 * un-suppress write **no** `batch_change` row at all (US-031 AC-5, proven by
 * `T-PROV-013`), and fix-match is an out-of-batch edit — so a batch whose
 * created titles the owner has since suppressed or re-matched still looks
 * perfectly creates-only to `isCreatesOnly`. The evidence is in the CURRENT
 * rows, not the ledger, which is why this takes the rows as arguments.
 */
export type LaterOwnerEditKind = 'suppressed' | 'fix-matched';

export interface LaterOwnerEdit {
  titleId: string;
  edit: LaterOwnerEditKind;
}

export interface LaterOwnerEditInput {
  /** The batch's own `provenance.created`. */
  readonly created: readonly { readonly titleId: string }[];
  /** Each created title's work identity AS IT STANDS NOW. */
  readonly currentIdentityByTitleId: ReadonlyMap<string, string>;
  /**
   * The identity the BATCH resolved for the title it created, read from the
   * extraction candidate that produced it.
   */
  readonly identityAtCreationByTitleId: ReadonlyMap<string, string>;
  /** Work identities carrying an ACTIVE suppression right now. */
  readonly suppressedWorks: ReadonlySet<string>;
}

/**
 * The titles a creates-only batch created that the owner has since suppressed
 * or fix-matched (US-032 AC-4).
 *
 * Empty means the undo may proceed. Non-empty means it must be REFUSED and
 * enumerated (US-033) — never partially applied: undoing a title the owner has
 * since re-matched would destroy a decision the batch has no record of and no
 * way to restore, and SD-03 discards rather than soft-deletes, so there is
 * nothing to recover from afterwards.
 *
 * ⚠ **AN ACTIVE SUPPRESSION ON A CREATED TITLE NECESSARILY POSTDATES THE
 * BATCH**, which is what makes it usable as evidence without a timestamp. A
 * suppressed work is filtered out BEFORE any Title is created (REQ-071, US-009
 * AC-4 / US-036 AC-2), so the batch cannot have created a title for an already
 * suppressed identity — the suppression can only have arrived afterwards.
 *
 * ⚠ **FIX-MATCH IS DETECTED AS AN IDENTITY THAT MOVED, NOT AS A `matchState`.**
 * Close writes `matchState: 'matched'` for every matched creation and fix-match
 * writes the same value, so `matchState` cannot tell the two apart; the
 * candidate's `resolvedWorkIdentity` is the only record of what the batch
 * itself decided. An in-review correction overwrites that column inside the
 * close, so it holds the identity as at close — not the pipeline's first guess.
 *
 * ⚠ **A TITLE WITH NO CURRENT IDENTITY IS NOT AN EDIT.** It is gone or
 * unreadable, which the enumeration reports through `currentState`; treating an
 * unreadable row as an owner edit would refuse an undo on the strength of a
 * failed read.
 *
 * ⚠ **FIX-MATCH IS REPORTED IN PREFERENCE TO SUPPRESSION** when both apply. A
 * suppression against a moved identity is the migrated one fix-match carried
 * over (SD-06, TASK-110), so reporting it as an independent suppression would
 * describe one owner action as two.
 */
export function detectLaterOwnerEdits(input: LaterOwnerEditInput): LaterOwnerEdit[] {
  const edits: LaterOwnerEdit[] = [];
  const seen = new Set<string>();

  for (const entry of input.created) {
    if (seen.has(entry.titleId)) continue;
    seen.add(entry.titleId);

    const current = input.currentIdentityByTitleId.get(entry.titleId);
    if (current === undefined) continue;

    const atCreation = input.identityAtCreationByTitleId.get(entry.titleId);
    if (atCreation !== undefined && atCreation !== current) {
      edits.push({ titleId: entry.titleId, edit: 'fix-matched' });
      continue;
    }

    if (input.suppressedWorks.has(current)) {
      edits.push({ titleId: entry.titleId, edit: 'suppressed' });
    }
  }

  return edits;
}

/**
 * Why a batch is not creates-only, as §8.4's `details.reason`.
 *
 * `null` means it IS creates-only **by provenance**. `'later-owner-edits'` is
 * not decidable here — it needs the current rows, which `detectLaterOwnerEdits`
 * takes as arguments — so the undo service decides that one and overrides this
 * reason when it fires.
 * ~~Superseded: "`'later-owner-edits'` … is not produced here; TASK-113 owns
 * that branch."~~
 */
export function createsOnlyRefusalReason(
  provenance: BatchProvenance | null,
): 'modified-or-removed' | 'provenance-unavailable' | null {
  if (provenance === null) return 'provenance-unavailable';
  return isCreatesOnly(provenance) ? null : 'modified-or-removed';
}

/** What an undo must physically reverse. */
export interface CreatesOnlyUndoPlan {
  /**
   * Titles the batch brought into existence. Undo DISCARDS these outright —
   * `title` row and its listings — because a creation that is reversed never
   * legitimately happened (§8.3). Soft-removing them instead would leave the
   * removed view full of works the owner never saw, poisoning the very view
   * REQ-062 exists to make useful.
   */
  readonly titleIdsToDiscard: readonly string[];
  /**
   * Listings the batch added to titles that ALREADY EXISTED. Only the listing
   * is discarded; the title stays, and its `state`/`sortDateAdded` are
   * recomputed from what remains.
   */
  readonly listingIdsToDiscard: readonly string[];
  /**
   * Titles that keep at least one listing and therefore need re-deriving.
   *
   * ⚠ Deliberately excludes every id in `titleIdsToDiscard`: a discarded title
   * has no rows left to derive from, and re-deriving it would either read zero
   * listings and write a nonsense state or fail on a row that is already gone.
   */
  readonly titleIdsToRederive: readonly string[];
}

/**
 * Split a creates-only batch's provenance into the two reversal shapes of the
 * §8.3 table.
 *
 * ⚠ `titleWasCreated` is the discriminator, and it is authoritative rather
 * than inferable. Both flavours of creation fold into `provenance.created`
 * (see `provenance.ts`), so the only thing distinguishing "this batch invented
 * the work" from "this batch gave an existing work another service" is that
 * flag as recorded AT CLOSE TIME. Re-deriving it now — say, by asking whether
 * the title has any other listing — would give the wrong answer for a title
 * that has since gained one by another route.
 *
 * ⚠ A created title's own listing is NOT added to `listingIdsToDiscard`. The
 * title row is being discarded and the schema cascades to its listings; naming
 * the listing as well would issue a delete for a row the cascade already took.
 */
export function planCreatesOnlyUndo(provenance: BatchProvenance): CreatesOnlyUndoPlan {
  const titleIdsToDiscard = new Set<string>();
  const addedListings: { titleId: string; listingId: string }[] = [];

  for (const entry of provenance.created) {
    if (entry.titleWasCreated) {
      titleIdsToDiscard.add(entry.titleId);
      continue;
    }
    if (entry.listingId !== null) {
      addedListings.push({ titleId: entry.titleId, listingId: entry.listingId });
    }
  }

  // A title can appear in both shapes if the batch created it AND added a
  // further listing to it. The discard wins: the whole title is going, the
  // cascade takes that listing, and re-deriving a row that no longer exists
  // would read zero listings and write a nonsense state.
  const survivors = addedListings.filter((entry) => !titleIdsToDiscard.has(entry.titleId));

  return {
    titleIdsToDiscard: [...titleIdsToDiscard],
    listingIdsToDiscard: survivors.map((entry) => entry.listingId),
    titleIdsToRederive: [...new Set(survivors.map((entry) => entry.titleId))],
  };
}
