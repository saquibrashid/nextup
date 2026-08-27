/**
 * TASK-085 — the `PATCH /api/batches/:batchId/removals` body grammar
 * (`specs/api.md` §6.21, US-015, REQ-021).
 *
 * The endpoint's own behaviour is proved at integration level (`T-UI-007`,
 * `T-REM-014`); what lives here is the part that is pure and therefore cheap
 * to pin exhaustively — which bodies are REFUSED, and why each refusal is a
 * refusal rather than a guess. Every rejection below is a case where resolving
 * the ambiguity would change what gets removed from the owner's list.
 *
 * Each refusal has an ACCEPTING TWIN in the same block. A grammar spec that
 * only lists refusals passes just as well when `parseRemovalPatch` rejects
 * everything.
 */

import { describe, expect, it } from 'vitest';

import { parseRemovalPatch, REMOVAL_PATCH_MESSAGES } from '../src/removalPatch.js';

describe('parseRemovalPatch', () => {
  it('T-REM-014b accepts a tick-only instruction', () => {
    const result = parseRemovalPatch({ tick: ['listing-1'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch).toEqual({ tick: ['listing-1'], untick: [] });
  });

  it('T-REM-014c accepts an untick-only instruction — the rescue path', () => {
    const result = parseRemovalPatch({ untick: ['listing-1', 'listing-2'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch).toEqual({ tick: [], untick: ['listing-1', 'listing-2'] });
  });

  it('T-REM-014d accepts both instructions in one press', () => {
    const result = parseRemovalPatch({ tick: ['a'], untick: ['b'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch).toEqual({ tick: ['a'], untick: ['b'] });
  });

  it('T-REM-014e refuses a body that is not an object', () => {
    for (const body of [null, 'tick', 42, ['listing-1']]) {
      const result = parseRemovalPatch(body);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('not-an-object');
    }
  });

  it('T-REM-014f refuses an empty instruction rather than answering 200 for nothing', () => {
    for (const body of [{}, { tick: [] }, { untick: [] }, { tick: [], untick: [] }]) {
      const result = parseRemovalPatch(body);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('no-instruction');
    }
  });

  it('T-REM-014g refuses a non-array instruction', () => {
    expect(parseRemovalPatch({ tick: 'listing-1' })).toMatchObject({
      ok: false,
      reason: 'not-an-array',
    });
    expect(parseRemovalPatch({ untick: { id: 'listing-1' } })).toMatchObject({
      ok: false,
      reason: 'not-an-array',
    });
  });

  it('T-REM-014h refuses a non-string id', () => {
    expect(parseRemovalPatch({ tick: ['a', 7] })).toMatchObject({
      ok: false,
      reason: 'not-a-string',
    });
    expect(parseRemovalPatch({ untick: [null] })).toMatchObject({
      ok: false,
      reason: 'not-a-string',
    });
  });

  it('T-REM-014i refuses an empty id', () => {
    expect(parseRemovalPatch({ untick: ['a', ''] })).toMatchObject({
      ok: false,
      reason: 'empty-id',
    });
  });

  /**
   * ⚠ The discriminating pair. Duplication WITHIN one array is the same
   * instruction twice and is deduplicated; the same id in BOTH arrays is a
   * contradiction and is refused. Resolving the contradiction by array order
   * would silently pick a side, and one of those sides removes a title the
   * owner may have been trying to rescue.
   */
  it('T-REM-014j deduplicates a repeated id within one instruction', () => {
    const result = parseRemovalPatch({ untick: ['a', 'a', 'b', 'a'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.untick).toEqual(['a', 'b']);
  });

  it('T-REM-014k refuses the same id in both tick and untick', () => {
    expect(parseRemovalPatch({ tick: ['a', 'b'], untick: ['c', 'a'] })).toMatchObject({
      ok: false,
      reason: 'both-tick-and-untick',
    });
  });

  it('T-REM-014l carries a message for every rejection reason', () => {
    const reasons = [
      'not-an-object',
      'no-instruction',
      'not-an-array',
      'not-a-string',
      'empty-id',
      'both-tick-and-untick',
    ] as const;
    for (const reason of reasons) {
      expect(REMOVAL_PATCH_MESSAGES[reason].length).toBeGreaterThan(0);
    }
    expect(Object.keys(REMOVAL_PATCH_MESSAGES)).toHaveLength(reasons.length);
  });
});
