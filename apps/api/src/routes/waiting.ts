/**
 * TASK-187 — `GET /api/waiting`, the waiting list and the ONLY thing that
 * triggers an availability refresh (REQ-086, US-042 AC-1/AC-2, ADR-0010).
 *
 * ⚠ **THE TRIGGER IS THIS REQUEST, AND NOTHING ELSE.** There is no timer, no
 * queue, no cron, no worker and no startup sweep anywhere in this codebase
 * that reaches `refreshAvailability`. That is what makes the refresh
 * admissible under REQ-041 and product invariant 5 at all, and `T-CI-005` and
 * `T-AVAIL-002b` are the structural assertions that keep it true. If the
 * waiting view is never opened, no TMDB request is ever made.
 *
 * ⚠ **THE REFRESH IS METADATA-ONLY.** It writes three columns on
 * `watch_intent` through `updateWatchIntentAvailability` and nothing else: no
 * `Title`, no `ServiceListing`, no `Suppression`, and it satisfies no intent.
 * Graduation happens by the ordinary capture path (TASK-189), never here.
 *
 * ⚠ **A REFRESH FAILURE IS NEVER AN ERROR PAGE.** The waiting list is the
 * owner's data and it renders from the store; TMDB is an enrichment. A
 * lookup that fails leaves the row stale with its last-known answer, and the
 * response still comes back 200.
 */

import { type Router } from 'express';

import { TmdbClient } from '../clients/tmdbClient.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import { listWaitingIntents, updateWatchIntentAvailability } from '../repository/watchIntents.js';
import {
  flaggedProvidersFor,
  refreshAvailability,
  selectForAvailabilityRefresh,
  type IntentRow,
} from '../services/watchAvailability.js';
import { toIsoDate } from './titles.js';

/** One row of the waiting view. Shaped field by field, never spread. */
export interface WaitingItem {
  intentId: string;
  workIdentity: string;
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
  discoveredAt: string;
  discoverySource: string;
  /**
   * ⚠ `null` means NOT KNOWN, and the client must render it as *"not seen on
   * your services as of &lt;date&gt;"* — never *"not streaming anywhere"*
   * (ADR-0010 Trap 4). `[]` is the different, weaker fact that TMDB answered
   * and no subscription provider carries it.
   */
  availableOn: string[] | null;
  /** Which of the owner's own services carry it, or `null` for not known. */
  flaggedOn: string[] | null;
  /** When the answer above was computed, or `null` for never asked. */
  availabilityCheckedAt: string | null;
  availabilityRegion: string;
}

/**
 * ⚠ Parsed defensively. `available_on` is `NVARCHAR(MAX)` holding JSON, and a
 * value that is not an array of strings is treated as NOT KNOWN rather than
 * thrown — one malformed row must not take the whole waiting view down.
 */
function parseAvailableOn(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return null;
  }
}

export function registerWaitingRoutes(
  router: Router,
  getTmdb: () => Pick<TmdbClient, 'getWatchProviders'> = () =>
    new TmdbClient({ apiKey: process.env['TMDB_API_KEY'] ?? '' }),
): void {
  router.get('/waiting', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const now = new Date();

    const stored = await listWaitingIntents(ownerId);

    const rows: IntentRow[] = stored.map((intent) => ({
      id: intent.id,
      workIdentity: intent.workIdentity,
      tmdbId: intent.title.tmdbId,
      tmdbMediaType: intent.title.tmdbMediaType,
      availabilityRegion: intent.availabilityRegion,
      availabilityCheckedAt: intent.availabilityCheckedAt,
      availableOn: parseAvailableOn(intent.availableOn),
    }));

    // ⚠ THE PAGE, never a table scan. `selectForAvailabilityRefresh` is given
    // exactly the rows about to be rendered; handing it anything wider turns
    // the lazy refresh into the backfill sweep REQ-041 forbids.
    const stale = selectForAvailabilityRefresh(rows, now);
    const writes = stale.length === 0 ? [] : await refreshAvailability(stale, getTmdb(), now);

    const fresh = new Map(writes.map((write) => [write.id, write]));
    for (const write of writes) {
      await updateWatchIntentAvailability(ownerId, write.id, {
        availableOn: write.availableOn === null ? null : JSON.stringify(write.availableOn),
        availabilityCheckedAt: write.availabilityCheckedAt,
        availabilityRegion: write.availabilityRegion,
      });
    }

    const items: WaitingItem[] = stored.map((intent, index) => {
      const row = rows[index] as IntentRow;
      const write = fresh.get(intent.id);
      const availableOn = write === undefined ? row.availableOn : write.availableOn;
      const checkedAt =
        write === undefined ? intent.availabilityCheckedAt : write.availabilityCheckedAt;

      return {
        intentId: intent.id,
        workIdentity: intent.workIdentity,
        name: intent.title.tmdbName ?? intent.title.rawExtractedText ?? '',
        releaseYear: intent.title.tmdbReleaseYear,
        posterPath: intent.title.tmdbPosterPath,
        discoveredAt: toIsoDate(intent.discoveredAt),
        discoverySource: intent.discoverySource,
        availableOn,
        flaggedOn: flaggedProvidersFor(availableOn),
        availabilityCheckedAt: checkedAt === null ? null : checkedAt.toISOString(),
        availabilityRegion: intent.availabilityRegion,
      };
    });

    res.status(200).json({ items, count: items.length });
  });
}
