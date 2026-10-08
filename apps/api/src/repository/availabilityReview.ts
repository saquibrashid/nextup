/**
 * Reads for the "Availability changes" review screen (US-064, PRD `A55`).
 *
 * ⚠ **STORED DATA ONLY.** These are reads of the owner's own rows; nothing
 * here asks TMDB anything. The screen's GET renders from exactly this, and the
 * only lookups are the owner's explicit "Check more titles" taps.
 *
 * The `ownerData.ts` house rules apply unchanged: `ownerId` is the FIRST
 * POSITIONAL PARAMETER of every function, and every `where` names it
 * (`specs/security.md` §3 R3, `T-SEC-021`).
 */

import { type Db, type OwnerId } from './ownerData.js';
import { getPrisma } from './client.js';

function db(tx?: Db): Db {
  return tx ?? getPrisma();
}

/**
 * Every Library title (active, with its active badges) and the availability
 * columns the markers are computed from. Ordered by id only so the result is
 * deterministic; the screen orders rows itself.
 */
export async function listLibraryAvailability(ownerId: OwnerId, tx?: Db) {
  return db(tx).title.findMany({
    where: { ownerId, state: 'active' },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      workIdentity: true,
      tmdbId: true,
      tmdbMediaType: true,
      tmdbName: true,
      rawExtractedText: true,
      tmdbReleaseYear: true,
      tmdbPosterPath: true,
      availabilityCheckedAt: true,
      availableOn: true,
      rentOn: true,
      availabilityRegion: true,
      availabilityKeptSignature: true,
      listings: {
        where: { ownerId, state: 'active' },
        orderBy: { listingId: 'asc' },
        select: { listingId: true, service: true, dateAdded: true },
      },
    },
  });
}
