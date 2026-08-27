/**
 * TASK-085 — the `PATCH /api/batches/:batchId/removals` body grammar
 * (`specs/api.md` §6.21, US-015, REQ-021).
 *
 * `{ "untick": ["01J8ZD..."], "tick": ["01J8ZE..."] }`
 *
 * ⚠ **This grammar REFUSES rather than resolves.** Every ambiguity here
 * resolves into a change to what gets removed from the owner's list, and a 200
 * reporting success for a guess is worse than a 400 they can see. Same
 * reasoning as `candidatePatch.ts` (TASK-066), and the same shape.
 */

/** The parsed instruction: two disjoint, deduplicated id sets. */
export interface RemovalPatch {
  tick: string[];
  untick: string[];
}

export type RemovalPatchResult =
  { ok: true; patch: RemovalPatch } | { ok: false; reason: RemovalPatchRejection };

export type RemovalPatchRejection =
  | 'not-an-object'
  | 'no-instruction'
  | 'not-an-array'
  | 'not-a-string'
  | 'empty-id'
  | 'both-tick-and-untick';

function readIds(
  value: unknown,
): { ok: true; ids: string[] } | { ok: false; reason: RemovalPatchRejection } {
  if (value === undefined) return { ok: true, ids: [] };
  if (!Array.isArray(value)) return { ok: false, reason: 'not-an-array' };
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return { ok: false, reason: 'not-a-string' };
    if (entry === '') return { ok: false, reason: 'empty-id' };
    // Duplicates within ONE array are the same instruction twice, not an
    // ambiguity — deduplicate rather than refuse. The counts the endpoint
    // returns are counts of listings, so a duplicate must not inflate them.
    if (!ids.includes(entry)) ids.push(entry);
  }
  return { ok: true, ids };
}

export function parseRemovalPatch(body: unknown): RemovalPatchResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, reason: 'not-an-object' };
  }
  const raw = body as Record<string, unknown>;

  const tick = readIds(raw['tick']);
  if (!tick.ok) return tick;
  const untick = readIds(raw['untick']);
  if (!untick.ok) return untick;

  // ⚠ An empty instruction is REFUSED, not treated as a no-op. There is no
  // affordance that sends one, so it means a client bug — and answering 200
  // reports that the owner's tick was saved when nothing was written.
  if (tick.ids.length === 0 && untick.ids.length === 0) {
    return { ok: false, reason: 'no-instruction' };
  }

  // ⚠ The same id in both arrays is REFUSED rather than resolved by order.
  // Either resolution silently picks a side, and one of those sides removes a
  // title the owner may have been trying to rescue.
  const ticked = new Set(tick.ids);
  if (untick.ids.some((id) => ticked.has(id))) {
    return { ok: false, reason: 'both-tick-and-untick' };
  }

  return { ok: true, patch: { tick: tick.ids, untick: untick.ids } };
}

/** Human-readable rejection, for the `VALIDATION_FAILED` envelope message. */
export const REMOVAL_PATCH_MESSAGES: Record<RemovalPatchRejection, string> = {
  'not-an-object': 'Expected an object with `tick` and/or `untick` arrays.',
  'no-instruction': 'Nothing to change: send at least one id in `tick` or `untick`.',
  'not-an-array': '`tick` and `untick` must be arrays of listing ids.',
  'not-a-string': 'Every listing id must be a string.',
  'empty-id': 'A listing id cannot be empty.',
  'both-tick-and-untick': 'The same listing cannot be both ticked and unticked.',
};
