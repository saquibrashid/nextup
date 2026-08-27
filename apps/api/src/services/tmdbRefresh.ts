/**
 * TASK-043 — the lazy TMDB metadata refresh (REQ-076, NFR-014, US-010).
 *
 * ⚠ **THIS IS THE ONE SCHEDULER-SHAPED THING THAT IS LEGAL, AND ONLY BECAUSE
 * IT IS NOT A SCHEDULER.** Product invariant 5 forbids any background process
 * from changing user-visible LIST state; `specs/api.md` §6.4 grants exactly
 * one exemption — metadata-only refresh, on access — and it is an exemption on
 * three counts that must all stay true:
 *
 *   1. it is triggered by a READ of the rows it refreshes, never by a timer,
 *      a cron, a queue trigger or a sweep (`T-CI-005` asserts no timer exists);
 *   2. it refreshes ONLY the rows in the page being returned, so a title never
 *      displayed is never refreshed (REQ-076);
 *   3. it writes only descriptive columns (`updateTitleMetadata` enforces that
 *      end) — never membership, ordering, identity or badges.
 *
 * ⚠ **IT RUNS BEFORE THE RESPONSE, UNLIKE THE IMDb RATING REFRESH.** That
 * looks like an inconsistency and is not: the rating is decoration that can
 * arrive on the next render, whereas `metadataStale` has to be ON the item
 * being served, so the decision "did this refresh succeed" must be made before
 * the JSON is written. The cost of doing it inline is bounded by
 * {@link TMDB_REFRESH_BUDGET_MS}, and by the fact that a stale page is rare —
 * the horizon is 183 days.
 *
 * ⚠ **THE LIST NEVER FAILS BECAUSE OF TMDB.** Every failure mode — a 404, a
 * 503, an unset API key, an exhausted budget — resolves to "return the STORED
 * metadata with `metadataStale: true`". Nothing is deleted and nothing is
 * blanked: a work whose TMDB entry has gone must still render with the name
 * the owner recognises (`T-TMDB-015`).
 */

import { parseStoredTmdbMetadata, type MediaType } from '@nextup/domain';

import { TMDB_METADATA_MAX_AGE_DAYS } from '../config.js';
import { TmdbUnavailableError, type TmdbClient } from '../clients/tmdbClient.js';
import { updateTitleMetadata, type OwnerId } from '../repository/ownerData.js';

/**
 * `specs/api.md` §6.4. Items not refreshed inside it are served stale-flagged
 * and retried on the next view — never dropped, never awaited past this.
 */
export const TMDB_REFRESH_BUDGET_MS = 5_000;

/** §6.4, and the same cap the client's own rate gate enforces. */
export const TMDB_REFRESH_CONCURRENCY = 4;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The subset of a served row this refresh is allowed to see. */
export interface RefreshableTitle {
  id: string;
  tmdbId: number | null;
  tmdbMediaType: string | null;
  tmdbFetchedAt: Date | null;
}

export interface MetadataRefreshDeps {
  client?: Pick<TmdbClient, 'getWork'>;
  now?: () => Date;
  budgetMs?: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

/**
 * Is this row's metadata past the NFR-014 horizon?
 *
 * ⚠ `tmdbFetchedAt === null` COUNTS AS STALE, and that is load-bearing rather
 * than defensive. A matched title created by `closeBatch` is written from the
 * review's `alternatives`, which carry name/year/poster but no runtime, no
 * genres and no `fetchedAt` — so a freshly closed batch legitimately has rows
 * whose metadata is incomplete and undated. Treating `null` as "fresh" would
 * leave those rows permanently without a runtime or a genre; treating it as
 * stale makes the first display repair them. That is also why this is the only
 * correct reading of §6.4's `ageInDays(fetchedAt)` for a null input.
 *
 * ⚠ Never derived from the screenshot-retention constant. They are two
 * different numbers for two different purposes and `T-INV-008` fails any file
 * that names both (product invariant 8).
 */
export function isMetadataStale(fetchedAt: Date | null, now: Date): boolean {
  if (fetchedAt === null) return true;
  return (now.getTime() - fetchedAt.getTime()) / MS_PER_DAY > TMDB_METADATA_MAX_AGE_DAYS;
}

/** Rows on this page that are both matched and past the horizon. */
export function staleTitles(
  rows: readonly RefreshableTitle[],
  now: Date,
): readonly RefreshableTitle[] {
  return rows.filter(
    (row) =>
      // An unmatched title has no TMDB entry to refresh. §6.4's filter opens
      // with `t.tmdb !== null` for exactly this reason.
      row.tmdbId !== null &&
      (row.tmdbMediaType === 'movie' || row.tmdbMediaType === 'tv') &&
      isMetadataStale(row.tmdbFetchedAt, now),
  );
}

/** What a successful refresh wrote, so the caller can serve it immediately. */
export interface RefreshedMetadata {
  tmdbName: string;
  tmdbReleaseYear: number | null;
  tmdbRuntimeMinutes: number | null;
  tmdbGenres: string;
  tmdbPosterPath: string | null;
  /** ⚠ `null` means UNCHANGED, not cleared — see `updateTitleMetadata`. */
  imdbId: string | null;
  tmdbFetchedAt: Date;
}

/**
 * The outcome of one page's refresh.
 *
 * ⚠ BOTH HALVES ARE NEEDED AND THEY ARE NOT COMPLEMENTS. `stale` is what the
 * item is flagged with; `refreshed` is what the item should be RENDERED from.
 * Returning only `stale` would mean a row refreshed on this request is served
 * with the values it had before the refresh — "refreshes on display" would be
 * true of the database and false of the screen, and the owner would see the
 * new name only on the render after the one that fetched it.
 */
export interface MetadataRefreshResult {
  stale: Set<string>;
  refreshed: Map<string, RefreshedMetadata>;
}

/**
 * Refresh what is stale among `rows` and persist it.
 *
 * **Never rejects.** `stale` holds the ids that are STILL stale after the
 * attempt — the set the caller flags `metadataStale: true` on. An id absent
 * from it was either fresh already or successfully refreshed.
 */
export async function refreshStaleMetadata(
  ownerId: OwnerId,
  rows: readonly RefreshableTitle[],
  deps: MetadataRefreshDeps = {},
): Promise<MetadataRefreshResult> {
  const now = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? ((): void => undefined);
  const startedAt = now().getTime();
  const budgetMs = deps.budgetMs ?? TMDB_REFRESH_BUDGET_MS;

  const stale = staleTitles(rows, now());
  const result: MetadataRefreshResult = {
    stale: new Set(stale.map((row) => row.id)),
    refreshed: new Map(),
  };
  if (stale.length === 0) return result;

  // ⚠ Read the key at CALL time, not at module load — the same reason
  // `refreshRatings.ts` gives. An unconfigured key is a SUPPORTED state: the
  // list renders from stored metadata with the stale flag set, which is
  // exactly the `T-TMDB-016` outcome, so there is nothing to throw about.
  const apiKey = process.env['TMDB_API_KEY'] ?? '';
  if (deps.client === undefined && apiKey === '') {
    log('tmdb.refresh_skipped_no_key', { stale: stale.length });
    return result;
  }

  // Imported lazily so a caller with an injected client never constructs a
  // real one — and so this module stays importable with no key at all.
  const client =
    deps.client ?? new (await import('../clients/tmdbClient.js')).TmdbClient({ apiKey });

  const queue = [...stale];
  let outOfBudget = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      const row = queue.shift();
      if (row === undefined) return;

      // Checked before each item rather than raced against a timer: a timer
      // would be a timer, and §6.4's budget is a "stop starting new work"
      // rule, not a cancellation.
      if (now().getTime() - startedAt >= budgetMs) {
        outOfBudget = true;
        return;
      }

      try {
        const detail = await client.getWork(row.tmdbMediaType as MediaType, row.tmdbId as number);

        // ⚠ THROUGH THE ALLOW-LIST, NOT STRAIGHT INTO THE STORE (TASK-061,
        // US-007 AC-6). The client already projects TMDB's response down to
        // `TmdbWorkDetail`, so this can only fail if that projection grows a
        // field — which is precisely the change that must not reach the store
        // unnoticed. `imdbId` is validated separately below because it is a
        // cross-catalogue mapping, not TMDB descriptive metadata.
        const metadata = parseStoredTmdbMetadata({
          tmdbId: detail.tmdbId,
          mediaType: detail.mediaType,
          name: detail.name,
          releaseYear: detail.releaseYear,
          runtimeMinutes: detail.runtimeMinutes,
          genres: detail.genres,
          posterPath: detail.posterPath,
          fetchedAt: now().toISOString(),
        });

        const written: RefreshedMetadata = {
          tmdbName: metadata.name,
          tmdbReleaseYear: metadata.releaseYear,
          tmdbRuntimeMinutes: metadata.runtimeMinutes,
          tmdbGenres: JSON.stringify(metadata.genres),
          tmdbPosterPath: metadata.posterPath,
          imdbId: detail.imdbId,
          tmdbFetchedAt: new Date(metadata.fetchedAt),
        };

        await updateTitleMetadata(ownerId, row.id, written);

        result.refreshed.set(row.id, written);
        result.stale.delete(row.id);
      } catch (error) {
        // ⚠ EVERY failure lands here and every one has the same outcome:
        // the row keeps its STORED metadata and is flagged stale. A 404 in
        // particular must NOT delete or blank anything (`T-TMDB-015`) — TMDB
        // withdrawing an entry is not the owner removing a title.
        log('tmdb.metadata_refresh_failed', {
          titleId: row.id,
          unavailable: error instanceof TmdbUnavailableError,
          error: String(error),
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(TMDB_REFRESH_CONCURRENCY, stale.length) }, worker),
  );

  if (outOfBudget) log('tmdb.refresh_budget_exhausted', { remaining: result.stale.size });
  return result;
}
