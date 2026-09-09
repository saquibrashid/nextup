/**
 * `T-WAIT-004` — US-040 AC-5. A work already present in the combined list
 * produces **no** `WatchIntent`, and the review pass says so rather than
 * silently discarding it.
 *
 * Unit level because the claim is about a DECISION, not about storage:
 * `planWatchIntents` is the only place the decision is made, and testing it
 * here means the assertion survives any change to how a close persists.
 */

import { describe, expect, it } from 'vitest';

import { classifyDiscoveryWorkIdentity, planWatchIntents } from '@nextup/domain';

const listed = (...ids: string[]) => new Set(ids);

describe('T-WAIT-004 · US-040 AC-5 · a work already in the combined list produces no intent', () => {
  it('T-WAIT-004a · a listed work produces no intent and is reported, not dropped', () => {
    const plan = planWatchIntents(
      [
        { candidateId: 'c1', workIdentity: 'tmdb:movie:1' },
        { candidateId: 'c2', workIdentity: 'tmdb:movie:2' },
      ],
      { listed: listed('tmdb:movie:1'), waiting: new Set() },
    );

    expect(plan.intents.map((i) => i.candidateId)).toEqual(['c2']);
    // The point of the AC: it is REPORTED. A build that merely filtered it out
    // would pass the line above and fail this one.
    expect(plan.alreadyListed.map((i) => i.candidateId)).toEqual(['c1']);
  });

  it('T-WAIT-004b · nothing is lost — every candidate appears in exactly one bucket', () => {
    const applicable = [
      { candidateId: 'c1', workIdentity: 'tmdb:movie:1' },
      { candidateId: 'c2', workIdentity: 'tmdb:movie:2' },
      { candidateId: 'c3', workIdentity: 'tmdb:movie:3' },
      { candidateId: 'c4', workIdentity: 'tmdb:movie:2' },
    ];
    const plan = planWatchIntents(applicable, {
      listed: listed('tmdb:movie:1'),
      waiting: listed('tmdb:movie:3'),
    });

    const seen = [...plan.intents, ...plan.alreadyListed, ...plan.alreadyWaiting].map(
      (i) => i.candidateId,
    );
    expect(seen.sort()).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('T-WAIT-004c · an open intent for the work is not duplicated', () => {
    const plan = planWatchIntents([{ candidateId: 'c1', workIdentity: 'tmdb:movie:9' }], {
      listed: new Set(),
      waiting: listed('tmdb:movie:9'),
    });

    expect(plan.intents).toEqual([]);
    expect(plan.alreadyWaiting.map((i) => i.candidateId)).toEqual(['c1']);
    // ⚠ Distinct from `alreadyListed`. The owner does NOT already have this
    // work; they are already waiting for it, which is a different sentence.
    expect(plan.alreadyListed).toEqual([]);
  });

  it('T-WAIT-004d · two candidates for one work in the same batch yield ONE intent', () => {
    // `ux_intent_owner_title_waiting` is unique per work while waiting, so the
    // second INSERT would roll the whole close back.
    const plan = planWatchIntents(
      [
        { candidateId: 'c1', workIdentity: 'tmdb:movie:7' },
        { candidateId: 'c2', workIdentity: 'tmdb:movie:7' },
      ],
      { listed: new Set(), waiting: new Set() },
    );

    expect(plan.intents.map((i) => i.candidateId)).toEqual(['c1']);
    expect(plan.alreadyWaiting.map((i) => i.candidateId)).toEqual(['c2']);
  });

  it('T-WAIT-004e · the review pass classifies a listed work as already-in-your-list', () => {
    expect(classifyDiscoveryWorkIdentity('tmdb:movie:1', listed('tmdb:movie:1'))).toBe(
      'already-in-your-list',
    );
    expect(classifyDiscoveryWorkIdentity('tmdb:movie:2', listed('tmdb:movie:1'))).toBe('new');
    // An unresolved candidate has no identity to classify, and inventing one
    // would make it look like a known work.
    expect(classifyDiscoveryWorkIdentity(null, listed('tmdb:movie:1'))).toBeNull();
  });
});
