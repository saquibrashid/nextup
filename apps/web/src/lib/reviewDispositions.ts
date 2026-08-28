// SD-11e (`specs/ui.md` §5.4) — dispositions are optimistic and locally
// persisted under `nextup.review.<batchId>`, so an accidental refresh
// mid-review does not lose an hour of work.
//
// ⚠ THE SERVER IS THE SOURCE OF TRUTH ON RELOAD, and that is not a nicety —
// it is what stops this cache becoming a second, divergent record of the
// owner's decisions. `effectiveDisposition` therefore lets the local value
// speak ONLY while the server still says `pending`. Once the server has a
// decision, that decision wins even when it disagrees, because the server's
// is the one the close will act on.
//
// ⚠ AND IT IS `sessionStorage`, NOT `localStorage`. A review is a single
// sitting; a decision cached in `localStorage` outlives the batch, the tab and
// the sign-in, and would be replayed over a LATER batch that happened to reuse
// a candidate id. `sessionStorage` is scoped to the tab, which is the same
// scope as the review pass itself.
//
// ⚠ EVERY ACCESS IS GUARDED. Safari in private mode throws from
// `sessionStorage.setItem`, and a review screen that throws on the owner's
// first confirmation is a worse failure than one that forgets. Losing the
// cache degrades to "the server is the only record", which is the state this
// product is correct in anyway.

import type { ReviewDisposition } from '@nextup/domain';

/** The subset a client may propose. `unresolved` is decided at close. */
export type LocalDisposition = 'confirmed' | 'discarded';

const LOCAL_VALUES = new Set<string>(['confirmed', 'discarded']);

/** `specs/ui.md` §5.4 SD-11e names this key shape verbatim. */
export function reviewStorageKey(batchId: string): string {
  return `nextup.review.${batchId}`;
}

export type LocalDispositionMap = Readonly<Record<string, LocalDisposition>>;

/**
 * Reads the cache for one batch. A malformed or foreign payload reads as an
 * empty cache rather than throwing: this is a convenience layer, and a corrupt
 * entry must not be able to block the review screen from rendering at all.
 */
export function readLocalDispositions(
  batchId: string,
  storage: Storage | undefined,
): LocalDispositionMap {
  if (storage === undefined) return {};

  let raw: string | null;
  try {
    raw = storage.getItem(reviewStorageKey(batchId));
  } catch {
    return {};
  }
  if (raw === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

  const out: Record<string, LocalDisposition> = {};
  for (const [candidateId, value] of Object.entries(parsed as Record<string, unknown>)) {
    // ⚠ Values are filtered, not trusted. A cached `pending` would otherwise
    // read back as an owner decision to leave something pending, which is not
    // a decision at all, and any other string would flow into the request body.
    if (typeof value === 'string' && LOCAL_VALUES.has(value)) {
      out[candidateId] = value as LocalDisposition;
    }
  }
  return out;
}

/** Merges one candidate's decision into the cache and writes it back. */
export function writeLocalDispositions(
  batchId: string,
  next: LocalDispositionMap,
  storage: Storage | undefined,
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(reviewStorageKey(batchId), JSON.stringify(next));
  } catch {
    // Quota or private mode. See the header note.
  }
}

/**
 * Drops the cache for one batch. Called once the batch is closed or discarded:
 * a cache that outlives its batch is a set of decisions with nothing left to
 * apply them to.
 */
export function clearLocalDispositions(batchId: string, storage: Storage | undefined): void {
  if (storage === undefined) return;
  try {
    storage.removeItem(reviewStorageKey(batchId));
  } catch {
    // See the header note.
  }
}

/**
 * ⚠ THE MERGE RULE, and the whole of "the server is the source of truth on
 * reload". The local value applies only over `pending`.
 */
export function effectiveDisposition(
  server: ReviewDisposition,
  local: LocalDisposition | undefined,
): ReviewDisposition {
  if (server !== 'pending') return server;
  return local ?? 'pending';
}
