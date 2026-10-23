/**
 * #325 / #465 (PRD `A66`, US-074 / REQ-140) — the owner's viewing record.
 *
 * ⚠ KEYED ON CANONICAL WORK IDENTITY (and a season number), never on a title
 * or listing row id: a re-capture, a removal, a reappearance or a deleted
 * title row cannot reset it. A record is NEVER deleted — "not finished" clears
 * `finished` and keeps the date and rating. It is a separate relation from
 * `watch_intent` (availability), `suppression` ("not interested") and the
 * removal log. Every function takes the owner first and names it in every
 * `where`.
 */

import { isUniqueViolation, type Db, type OwnerId } from './ownerData.js';
import { getPrisma } from './client.js';

function db(tx?: Db): Db {
  return tx ?? getPrisma();
}

/** Display facts copied onto the record so history reads with no title row. */
export interface WatchSnapshot {
  titleName: string | null;
  releaseYear: number | null;
  mediaType: string | null;
  posterPath: string | null;
}

export interface WatchRecordView {
  workIdentity: string;
  seasonNumber: number;
  finished: boolean;
  watchedOn: string | null;
  rating: number | null;
  titleName: string | null;
  releaseYear: number | null;
  mediaType: string | null;
  posterPath: string | null;
  updatedAt: Date;
}

type Row = Awaited<ReturnType<ReturnType<typeof db>['watchRecord']['findFirst']>> & object;

function toView(row: Row): WatchRecordView {
  return {
    workIdentity: row.workIdentity,
    seasonNumber: row.seasonNumber,
    finished: row.finished,
    watchedOn: row.watchedOn === null ? null : row.watchedOn.toISOString().slice(0, 10),
    rating: row.rating,
    titleName: row.titleName,
    releaseYear: row.releaseYear,
    mediaType: row.mediaType,
    posterPath: row.posterPath,
    updatedAt: row.updatedAt,
  };
}

function dateOnly(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00Z`);
}

export async function listWatchRecords(
  ownerId: OwnerId,
  workIdentity: string,
  tx?: Db,
): Promise<WatchRecordView[]> {
  const rows = await db(tx).watchRecord.findMany({
    where: { ownerId, workIdentity },
    orderBy: { seasonNumber: 'asc' },
  });
  return rows.map(toView);
}

export async function findWatchRecord(
  ownerId: OwnerId,
  workIdentity: string,
  seasonNumber: number,
  tx?: Db,
): Promise<WatchRecordView | null> {
  const row = await db(tx).watchRecord.findFirst({
    where: { ownerId, workIdentity, seasonNumber },
  });
  return row === null ? null : toView(row);
}

export interface WatchWrite {
  finished?: boolean;
  /** `undefined` leaves the stored date alone; `null` makes it "unknown". */
  watchedOn?: string | null;
  /** `undefined` leaves the stored rating alone; `null` clears it. */
  rating?: number | null;
}

/**
 * Create or update one record. UPDATE-then-INSERT (`upsert` is banned by
 * T-SEC-021): a racing first insert loses to the primary key and updates.
 * A rewatch simply overwrites the date; no per-viewing history is kept.
 */
export async function writeWatchRecord(
  ownerId: OwnerId,
  workIdentity: string,
  seasonNumber: number,
  write: WatchWrite,
  snapshot: WatchSnapshot,
  tx?: Db,
): Promise<WatchRecordView> {
  const data = {
    ...(write.finished === undefined ? {} : { finished: write.finished }),
    ...(write.watchedOn === undefined ? {} : { watchedOn: dateOnly(write.watchedOn) }),
    ...(write.rating === undefined ? {} : { rating: write.rating }),
    ...snapshot,
    updatedAt: new Date(),
  };
  const update = () =>
    db(tx).watchRecord.updateMany({ where: { ownerId, workIdentity, seasonNumber }, data });
  if ((await update()).count === 0) {
    try {
      await db(tx).watchRecord.create({
        data: {
          ownerId,
          workIdentity,
          seasonNumber,
          ...data,
          finished: write.finished ?? true,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      await update();
    }
  }
  const saved = await findWatchRecord(ownerId, workIdentity, seasonNumber, tx);
  if (saved === null) throw new Error('Watch record write returned no record.');
  return saved;
}

/** Newest-watched first; an unknown date sorts after every known one. */
export async function listFinishedRecords(
  ownerId: OwnerId,
  { limit, offset }: { limit: number; offset: number },
  tx?: Db,
): Promise<{ items: WatchRecordView[]; hasMore: boolean }> {
  const rows = await db(tx).watchRecord.findMany({
    where: { ownerId, finished: true },
    orderBy: [{ watchedOn: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
    skip: offset,
    take: limit + 1,
  });
  return { items: rows.slice(0, limit).map(toView), hasMore: rows.length > limit };
}

/**
 * The owner's "finished, take it off my Library" choice, on the row that
 * already survives removal and fix-match. UPDATE-then-INSERT, no `upsert`.
 */
export async function setLibraryHidden(
  ownerId: OwnerId,
  workIdentity: string,
  hidden: boolean,
  tx?: Db,
): Promise<void> {
  const update = () =>
    db(tx).watchPreference.updateMany({
      where: { ownerId, workIdentity },
      data: { libraryHidden: hidden },
    });
  if ((await update()).count > 0 || !hidden) return;
  try {
    await db(tx).watchPreference.create({
      data: { ownerId, workIdentity, libraryHidden: true },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await update();
  }
}

export async function isLibraryHidden(
  ownerId: OwnerId,
  workIdentity: string,
  tx?: Db,
): Promise<boolean> {
  const row = await db(tx).watchPreference.findFirst({
    where: { ownerId, workIdentity },
    select: { libraryHidden: true },
  });
  return row?.libraryHidden ?? false;
}

/**
 * Move the records with a corrected identity (fix-match). A destination that
 * already has a record for the same season wins; the source row stays under
 * the old identity rather than being dropped, so nothing is lost or
 * duplicated. The snapshot is refreshed to the corrected title.
 */
export async function carryWatchRecords(
  ownerId: OwnerId,
  from: string,
  to: string,
  snapshot: WatchSnapshot,
  tx: Db,
): Promise<void> {
  if (from === to) return;
  const [source, target] = await Promise.all([
    tx.watchRecord.findMany({ where: { ownerId, workIdentity: from } }),
    tx.watchRecord.findMany({
      where: { ownerId, workIdentity: to },
      select: { seasonNumber: true },
    }),
  ]);
  const taken = new Set(target.map((row) => row.seasonNumber));
  for (const row of source) {
    if (taken.has(row.seasonNumber)) continue;
    await tx.watchRecord.updateMany({
      where: { ownerId, workIdentity: from, seasonNumber: row.seasonNumber },
      data: { workIdentity: to, ...snapshot },
    });
  }
}

export async function listHiddenIdentities(
  ownerId: OwnerId,
  workIdentities: readonly string[],
  tx?: Db,
): Promise<Set<string>> {
  if (workIdentities.length === 0) return new Set();
  const rows = await db(tx).watchPreference.findMany({
    where: { ownerId, libraryHidden: true, workIdentity: { in: [...workIdentities] } },
    select: { workIdentity: true },
  });
  return new Set(rows.map((row) => row.workIdentity));
}

export interface HistoryTitle {
  titleId: string;
  imdbRatingTenths: number | null;
}

/** The newest title row per identity: where a history entry links, and its community score. */
export async function latestTitlesByIdentity(
  ownerId: OwnerId,
  workIdentities: readonly string[],
  tx?: Db,
): Promise<Map<string, HistoryTitle>> {
  const found = new Map<string, HistoryTitle>();
  if (workIdentities.length === 0) return found;
  const rows = await db(tx).title.findMany({
    where: { ownerId, workIdentity: { in: [...workIdentities] } },
    orderBy: { id: 'desc' },
    select: { id: true, workIdentity: true, imdbRatingTenths: true },
  });
  for (const row of rows) {
    if (!found.has(row.workIdentity)) {
      found.set(row.workIdentity, { titleId: row.id, imdbRatingTenths: row.imdbRatingTenths });
    }
  }
  return found;
}
