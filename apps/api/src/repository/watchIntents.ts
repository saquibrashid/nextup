/**
 * Watch-intent reads and writes for the WAITING VIEW (TASK-187, REQ-086).
 *
 * ⚠ **THIS FILE EXISTS TO KEEP TWO DATE FAMILIES APART, AND THAT IS ITS WHOLE
 * REASON FOR BEING.** `T-WAIT-011` asserts that no file computing list order
 * ever references a discovery date: `WatchIntent.discoveredAt` must never feed
 * the REQ-038 title-level sort, which is defined over `ServiceListing.dateAdded`
 * (`specs/data-model.md` §17.1). `ownerData.ts` orders the combined list by the
 * stored title-level sort key, so putting `orderBy: { discoveredAt }` in it
 * would put both vocabularies in one file — and the defect that guard catches
 * is a silently WRONG ORDER, not a crash: a waiting title dated the day the
 * owner browsed a storefront, sitting among works they actually saved, with
 * every test still green.
 *
 * ⚠ **Do not "tidy" these two functions back into `ownerData.ts`, and do not
 * name the title-level sort key anywhere in this file** — not even in prose.
 * `T-WAIT-011` selects the files it scans by a RAW-text match on that key, so
 * mentioning it here re-creates exactly the collision the split removed. The
 * correct response to that gate firing is separation, never an exemption.
 *
 * The `ownerData.ts` house rules apply here unchanged: `ownerId` is the FIRST
 * POSITIONAL PARAMETER of every function, and every `where` names it, because
 * on Azure SQL a query that forgets it returns another owner's rows at full
 * speed with nothing in the log (`specs/security.md` §3 R3, `T-SEC-021`).
 */

import { type Db, type OwnerId } from './ownerData.js';
import { getPrisma } from './client.js';

function db(tx?: Db): Db {
  return tx ?? getPrisma();
}

/**
 * The waiting list, oldest discovery first, with the title fields the
 * availability refresh needs.
 *
 * ⚠ `state: 'waiting'` is in the WHERE, not filtered afterwards. A satisfied
 * intent is retained for ever (REQ-028, TASK-189) and reading it here would
 * both re-check availability for a work that already graduated and put it back
 * in front of the owner.
 */
export async function listWaitingIntents(
  ownerId: OwnerId,
  options: { take?: number } = {},
  tx?: Db,
) {
  const { take = 200 } = options;
  return db(tx).watchIntent.findMany({
    where: { ownerId, state: 'waiting' },
    orderBy: { discoveredAt: 'asc' },
    take,
    include: {
      title: {
        select: {
          id: true,
          tmdbId: true,
          tmdbMediaType: true,
          tmdbName: true,
          tmdbReleaseYear: true,
          tmdbPosterPath: true,
          rawExtractedText: true,
        },
      },
    },
  });
}

/**
 * Record one availability answer. **Metadata-only, by construction.**
 *
 * ⚠ THE NARROWNESS IS THE POINT (US-042 AC-4, product invariant 5). The `data`
 * shape reaches exactly three columns, so this writer cannot change an
 * intent's `state`, its `workIdentity` or its `discoveredAt` even by mistake —
 * which is what keeps the access-triggered refresh admissible under REQ-041 at
 * all. Do not widen it; add a separate writer instead.
 */
export async function updateWatchIntentAvailability(
  ownerId: OwnerId,
  id: string,
  data: {
    availableOn: string | null;
    availabilityCheckedAt: Date;
    availabilityRegion: string;
  },
  tx?: Db,
) {
  return db(tx).watchIntent.updateMany({ where: { ownerId, id }, data });
}

/**
 * Satisfy every waiting intent for these works (US-043 AC-3, `T-WAIT-008`).
 *
 * ⚠ **GRADUATION IS A CONSEQUENCE OF THE ORDINARY CAPTURE PATH, NEVER A
 * SPECIAL CASE.** This is called from the service close, inside its
 * transaction, after the listings it describes have been written — the work
 * reached a service the normal way, and the intent is closing because of that
 * fact rather than because anything went looking for intents to close.
 *
 * ⚠ **THE ROW IS RETAINED, NOT DELETED** (REQ-028, US-043 AC-5). There is no
 * TTL and no scheduled deletion; a satisfied intent is history the owner can
 * still be shown. `ck_intent_satisfied_coherent` refuses a satisfied intent
 * with no date, so both columns move together or neither does.
 *
 * ⚠ Guarded on `state: 'waiting'`, so re-closing cannot re-date an intent that
 * was already satisfied.
 */
export async function satisfyWaitingIntents(
  ownerId: OwnerId,
  workIdentities: readonly string[],
  satisfiedAt: Date,
  tx?: Db,
) {
  if (workIdentities.length === 0) return { count: 0 };
  return db(tx).watchIntent.updateMany({
    where: { ownerId, state: 'waiting', workIdentity: { in: [...workIdentities] } },
    data: { state: 'satisfied', satisfiedAt },
  });
}
