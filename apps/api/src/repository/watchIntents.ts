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
          editionLabels: true,
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
 * shape reaches exactly five AVAILABILITY columns — the three of TASK-187
 * plus #378's `rentOn` and `streamingSince`, which describe the same one TMDB
 * answer — so this writer cannot change an intent's `state`, its
 * `workIdentity` or its `discoveredAt` even by mistake. That is what keeps
 * the access-triggered refresh admissible under REQ-041 at all. Never widen
 * it to anything that is not part of an availability answer; add a separate
 * writer instead.
 */
export async function updateWatchIntentAvailability(
  ownerId: OwnerId,
  id: string,
  data: {
    availableOn: string | null;
    rentOn: string | null;
    streamingSince: Date | null;
    availabilityCheckedAt: Date;
    availabilityRegion: string;
  },
  tx?: Db,
) {
  return db(tx).watchIntent.updateMany({ where: { ownerId, id }, data });
}

/**
 * Record one streaming-forecast answer (#380). **Metadata-only, by construction.**
 *
 * ⚠ The separate writer the availability writer's comment asks for: its
 * `data` shape reaches exactly the six FORECAST columns of migration 0018 —
 * facts an estimate is computed from, never the estimate — so it cannot
 * change an intent's `state`, `workIdentity` or `discoveredAt`, nor any
 * availability column. `ck_intent_forecast_coherent` and
 * `ck_intent_announced_coherent` refuse a half-written answer.
 */
export async function updateWatchIntentForecast(
  ownerId: OwnerId,
  id: string,
  data: {
    forecastCheckedAt: Date;
    studioCompanyIds: string | null;
    theatricalReleaseOn: Date | null;
    digitalReleaseOn: Date | null;
    announcedService: string | null;
    announcedOn: Date | null;
  },
  tx?: Db,
) {
  return db(tx).watchIntent.updateMany({ where: { ownerId, id }, data });
}

/**
 * Satisfy every waiting intent for these works (US-043 AC-3, `T-WAIT-008`).
 *
 * ⚠ **GRADUATION IS A CONSEQUENCE OF A LISTING BEING WRITTEN BY THE OWNER,
 * NEVER A SPECIAL CASE.** This is called from the service close, inside its
 * transaction, after the listings it describes have been written — the work
 * reached a service the normal way, and the intent is closing because of that
 * fact rather than because anything went looking for intents to close.
 * Since `A54` (US-063 AC-2) the owner's one-tap "Add to Library" from a
 * Now-streaming waiting row is the second caller, on exactly the same terms:
 * inside its own transaction, after it has written the listing. ~~Superseded:
 * "the ordinary capture path" as the only caller.~~
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

/**
 * The services the owner USES (#378, owner decision 3): any service with a
 * completed import or an active listing. A streaming offer on one of these is
 * an invitation to import; on any other it is shown, styled distinctly.
 *
 * ⚠ Read-only, and about the owner's own rows only — it asks no streaming
 * service anything.
 */
export async function listOwnerServices(ownerId: OwnerId, tx?: Db): Promise<string[]> {
  const [states, listings] = await Promise.all([
    db(tx).serviceState.findMany({
      where: { ownerId, lastCompletedBatchAt: { not: null } },
      select: { service: true },
    }),
    db(tx).serviceListing.findMany({
      where: { ownerId, state: 'active' },
      select: { service: true },
      distinct: ['service'],
    }),
  ]);
  return [...new Set([...states, ...listings].map((row) => row.service))];
}

/**
 * Record one LIBRARY availability answer (#410, `A54`). **Metadata-only, by
 * construction** — the twin of {@link updateWatchIntentAvailability}.
 *
 * ⚠ The `data` shape reaches exactly the four availability columns migration
 * 0019 added to `title`, so the on-access refresh cannot change a title's
 * `state`, its listings, its date or its identity even by mistake. That is
 * what keeps PRD §7.4 process 4 admissible after its widening to Library
 * titles. Never widen it; add a separate writer instead.
 */
export async function updateTitleAvailability(
  ownerId: OwnerId,
  id: string,
  data: {
    availableOn: string | null;
    rentOn: string | null;
    availabilityCheckedAt: Date;
    availabilityRegion: string;
  },
  tx?: Db,
) {
  return db(tx).title.updateMany({ where: { ownerId, id }, data });
}

/**
 * The owner's "Keep" (US-063 AC-6): remember WHICH change was dismissed, so
 * the marker stays hidden until the provider set yields a different one.
 * Touches one column and nothing else.
 */
export async function keepTitleAvailabilityChange(
  ownerId: OwnerId,
  id: string,
  signature: string,
  tx?: Db,
) {
  return db(tx).title.updateMany({
    where: { ownerId, id },
    data: { availabilityKeptSignature: signature },
  });
}

/**
 * One WAITING intent with its whole title, for the owner's "Add to Library"
 * (US-063 AC-2). `null` for a missing, foreign or no-longer-waiting intent.
 */
export async function findWaitingIntent(ownerId: OwnerId, id: string, tx?: Db) {
  return db(tx).watchIntent.findFirst({
    where: { ownerId, id, state: 'waiting' },
    include: { title: true },
  });
}
