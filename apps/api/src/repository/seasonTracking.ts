/**
 * #454 (PRD `A64`, US-072 / REQ-138) — tracking a removed TV show for a new
 * season. Every function takes the owner first and names it in every `where`.
 *
 * ⚠ The season columns on `watch_preference` are METADATA: they are written
 * only by {@link recordSeasonFacts}, which touches no membership, ordering or
 * badge. Turning tracking on or off is an owner choice, written only by
 * {@link setSeasonTracking}. Nothing here hard-deletes anything.
 */

import { isUniqueViolation, type Db, type OwnerId } from './ownerData.js';
import { getPrisma } from './client.js';

function db(tx?: Db): Db {
  return tx ?? getPrisma();
}

/**
 * The owner's opt-in, kept on the choice row that survives removal.
 * UPDATE-then-INSERT (`upsert` is banned by T-SEC-021): a racing first insert
 * loses to the primary key and simply updates.
 */
export async function setSeasonTracking(
  ownerId: OwnerId,
  workIdentity: string,
  track: boolean,
  tx?: Db,
): Promise<void> {
  const update = () =>
    db(tx).watchPreference.updateMany({
      where: { ownerId, workIdentity },
      data: { trackNewSeason: track },
    });
  if ((await update()).count > 0) return;
  try {
    await db(tx).watchPreference.create({
      data: { ownerId, workIdentity, trackNewSeason: track },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await update();
  }
}

/**
 * Store the last TMDB answer: the next announced season, or `null` for none.
 * ⚠ Updates only the three `season*` columns on an existing row.
 */
export async function recordSeasonFacts(
  ownerId: OwnerId,
  workIdentity: string,
  facts: { checkedAt: Date; season: { seasonNumber: number; airsOn: string } | null },
  tx?: Db,
): Promise<void> {
  await db(tx).watchPreference.updateMany({
    where: { ownerId, workIdentity },
    data: {
      seasonCheckedAt: facts.checkedAt,
      seasonNumber: facts.season?.seasonNumber ?? null,
      seasonAirOn: facts.season === null ? null : new Date(`${facts.season.airsOn}T00:00:00Z`),
    },
  });
}

/** Work identities the owner is tracking, for the Removed view's marker. */
export async function listTrackedWorkIdentities(
  ownerId: OwnerId,
  workIdentities: readonly string[],
  tx?: Db,
): Promise<Set<string>> {
  if (workIdentities.length === 0) return new Set();
  const rows = await db(tx).watchPreference.findMany({
    where: { ownerId, trackNewSeason: true, workIdentity: { in: [...workIdentities] } },
    select: { workIdentity: true },
  });
  return new Set(rows.map((row) => row.workIdentity));
}

export interface TrackedSeasonWork {
  workIdentity: string;
  titleId: string;
  name: string;
  tmdbId: number | null;
  seasonCheckedAt: Date | null;
  seasonNumber: number | null;
  seasonAirOn: Date | null;
}

/**
 * Tracked TV works that are neither in the Library nor already waiting: the
 * only ones a re-check or an offer is for. Newest title row per work.
 */
export async function listTrackedSeasonWorks(
  ownerId: OwnerId,
  options: { take?: number } = {},
  tx?: Db,
): Promise<TrackedSeasonWork[]> {
  const { take = 50 } = options;
  const prefs = await db(tx).watchPreference.findMany({
    where: { ownerId, trackNewSeason: true },
    take,
  });
  if (prefs.length === 0) return [];
  const identities = prefs.map((pref) => pref.workIdentity);
  const [listed, waiting, titles] = await Promise.all([
    db(tx).serviceListing.findMany({
      where: { ownerId, state: 'active', title: { workIdentity: { in: identities } } },
      select: { title: { select: { workIdentity: true } } },
    }),
    db(tx).watchIntent.findMany({
      where: { ownerId, state: 'waiting', workIdentity: { in: identities } },
      select: { workIdentity: true },
    }),
    db(tx).title.findMany({
      where: { ownerId, workIdentity: { in: identities }, tmdbMediaType: 'tv' },
      orderBy: { id: 'desc' },
      select: { id: true, workIdentity: true, tmdbName: true, tmdbId: true },
    }),
  ]);
  const skip = new Set([
    ...listed.map((row) => row.title.workIdentity),
    ...waiting.map((row) => row.workIdentity),
  ]);
  const newest = new Map<string, (typeof titles)[number]>();
  for (const title of titles)
    if (!newest.has(title.workIdentity)) newest.set(title.workIdentity, title);

  const works: TrackedSeasonWork[] = [];
  for (const pref of prefs) {
    const title = newest.get(pref.workIdentity);
    if (title === undefined || skip.has(pref.workIdentity)) continue;
    works.push({
      workIdentity: pref.workIdentity,
      titleId: title.id,
      name: title.tmdbName ?? '',
      tmdbId: title.tmdbId,
      seasonCheckedAt: pref.seasonCheckedAt,
      seasonNumber: pref.seasonNumber,
      seasonAirOn: pref.seasonAirOn,
    });
  }
  return works;
}
