/**
 * What closing a DISCOVERY batch decides, expressed as a pure function.
 *
 * ⚠ THIS IS NOT THE ADDITION PATH WITH A DIFFERENT TABLE. A `ServiceListing`
 * asserts *"this work is saved on this service"*; a `WatchIntent` asserts the
 * exact opposite — *"this work is on none of them, and I am waiting"*
 * (ADR-0010 Trap 3, `specs/data-model.md` §17.2). The two are never
 * interchangeable, and nothing here may create, imply or plan a listing.
 *
 * The planning lives here rather than inside `closeBatch` because US-040 AC-5
 * is a statement about a DECISION — "a work already in the combined list
 * produces no intent, and the review pass says so" — and a decision that only
 * exists as a branch inside a transaction can only be tested through a
 * database. `T-WAIT-004` tests it directly.
 */

import type { ReviewClassification } from './review.js';

/** The subset of an applicable candidate the intent plan needs. */
export interface IntentCandidate {
  candidateId: string;
  workIdentity: string;
}

/**
 * What the owner's store already knows about a work, as far as this plan is
 * concerned.
 *
 * ⚠ THE TWO SETS ARE SEPARATE AND MUST STAY SEPARATE. Collapsing them into one
 * "already known" set produces the same intent count and is therefore
 * invisible to a count-based test — but it makes the two outcomes
 * indistinguishable to the owner, and they mean opposite things. *"You already
 * have this"* is a complete answer; *"you are already waiting for this"* is a
 * no-op the owner never needs to see.
 */
export interface KnownWorks {
  /**
   * Work identities with at least one ACTIVE `ServiceListing` — that is,
   * exactly the works in the combined list.
   *
   * ⚠ Active, not merely present. A work sitting in the removed log is NOT in
   * the combined list, and discovering it on a rental storefront is a
   * legitimate reason to start waiting for it again.
   */
  listed: ReadonlySet<string>;
  /** Work identities that already have an open (`waiting`) intent. */
  waiting: ReadonlySet<string>;
}

export interface IntentPlan {
  /** Candidates that will become new `WatchIntent` rows. */
  intents: IntentCandidate[];
  /** Candidates skipped because the work is already in the combined list. */
  alreadyListed: IntentCandidate[];
  /** Candidates skipped because an open intent for the work already exists. */
  alreadyWaiting: IntentCandidate[];
}

/**
 * Decide which applicable candidates become watch intents.
 *
 * Three reasons a candidate produces none, and each is reported rather than
 * dropped:
 *
 *  1. the work is already in the combined list (US-040 AC-5);
 *  2. an open intent for it already exists — the ordinary second capture of a
 *     storefront page, which re-presents most of what it presented last time;
 *  3. an earlier candidate in THIS batch already claimed the work.
 *
 * ⚠ (2) AND (3) ARE BOTH REQUIRED BY THE DATABASE, NOT MERELY TIDY.
 * `ux_intent_owner_title_waiting` is unique on `(ownerId, titleId)` filtered
 * to `state = 'waiting'`, so a duplicate is a failed INSERT that rolls the
 * whole close back — the owner's second capture of the same page would simply
 * refuse to close.
 */
export function planWatchIntents(
  applicable: readonly IntentCandidate[],
  known: KnownWorks,
): IntentPlan {
  const plan: IntentPlan = { intents: [], alreadyListed: [], alreadyWaiting: [] };
  const claimed = new Set<string>();

  for (const candidate of applicable) {
    if (known.listed.has(candidate.workIdentity)) {
      plan.alreadyListed.push(candidate);
      continue;
    }
    if (known.waiting.has(candidate.workIdentity) || claimed.has(candidate.workIdentity)) {
      plan.alreadyWaiting.push(candidate);
      continue;
    }
    claimed.add(candidate.workIdentity);
    plan.intents.push(candidate);
  }

  return plan;
}

/**
 * How a discovery candidate is classified in the review pass.
 *
 * ⚠ NOT `classifyWorkIdentity`. That one asks *"is this work already on THIS
 * service"*, and a discovery batch has no service to ask about (ADR-0010 D-1)
 * — its question is *"is this work in the combined list at all"*. Reusing the
 * service-scoped classifier would need a service to pass it, and the only
 * service available to pass would be a fictional one.
 */
export function classifyDiscoveryWorkIdentity(
  workIdentity: string | null,
  listed: ReadonlySet<string>,
): ReviewClassification | null {
  if (workIdentity === null || workIdentity === '') return null;
  return listed.has(workIdentity) ? 'already-in-your-list' : 'new';
}
