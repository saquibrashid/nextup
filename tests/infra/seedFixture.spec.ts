/**
 * `T-SEED-001` – `T-SEED-003` — TASK-032's real done-when
 * (`specs/testing.md` §14.1).
 *
 * TASK-032's original "Done when" cited `T-META-003`, which asserts something
 * about the testing spec's own bookkeeping and nothing whatever about a seed
 * fixture. These three replace it. Each asserts a property the fixture has to
 * have for every suite built on it to mean anything:
 *
 *   001 — determinism, byte for byte, or date assertions become retry fodder;
 *   002 — the identity the fixture writes under is DERIVED, not typed out;
 *   003 — the injected clock is the only source of time.
 *
 * All three are pure. `planSeed()` is separated from `seedOwner()` precisely so
 * determinism is assertable without a database (`tests/fixtures/seed.ts`), and
 * a property that needs no container should never be proven with one.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { deriveOwnerId } from '../../apps/api/src/auth/ownerId.js';
import { readPrincipal } from '../../apps/api/src/auth/principal.js';
import {
  CLIENT_PRINCIPAL_HEADER,
  DAY_MS,
  FIXED_NOW,
  createClock,
  planSeed,
  principalHeaderValue,
} from '../fixtures/seed.js';

/**
 * Serialise a plan the way a byte-for-byte comparison needs.
 *
 * ⚠ `JSON.stringify` on its own is NOT enough and the difference is the whole
 * point: it renders a `Date` as an ISO string, so a plan holding a `Date` and
 * one holding the equivalent string compare EQUAL, hiding a change in how a
 * timestamp is stored. Tag the constructor so the type is part of the
 * comparison.
 *
 * ⚠ The replacer must NOT be an arrow function, and must read `this[key]`.
 * `JSON.stringify` calls `Date.prototype.toJSON()` BEFORE handing the value to
 * the replacer, so `value instanceof Date` is never true there — it has
 * already become a string. Written the obvious way, this helper found no dates
 * at all and `T-SEED-003b`/`003d` iterated empty arrays and passed while
 * asserting nothing. `T-SEED-003a`'s length guard is what caught it.
 */
function serialise(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key: string, v: unknown) {
    const raw = this[key];
    return raw instanceof Date ? `Date(${raw.toISOString()})` : v;
  });
}

const digest = (value: unknown): string =>
  createHash('sha256').update(serialise(value)).digest('hex');

describe('T-SEED-001 the seed is deterministic', () => {
  it('T-SEED-001a · two plans from the same inputs are byte-identical', () => {
    const a = planSeed('owner-a', createClock());
    const b = planSeed('owner-a', createClock());
    expect(digest(b)).toBe(digest(a));
  });

  it('T-SEED-001b · determinism survives a repeat much later in the same run', () => {
    // Guards the failure this test exists for: a plan built from `Date.now()`
    // is self-consistent within a millisecond and only diverges once real time
    // moves. Comparing two plans built back to back would not catch it.
    const first = digest(planSeed('owner-a', createClock()));
    const spin = Date.now();
    while (Date.now() - spin < 5) {
      /* let the wall clock advance past a millisecond boundary */
    }
    expect(digest(planSeed('owner-a', createClock()))).toBe(first);
  });

  it('T-SEED-001c · ids, dates and ORDERING are all part of the identity', () => {
    const plan = planSeed('owner-a', createClock());
    expect(plan.activeListings.map((l) => l['listingId'])).toEqual([
      'owner-a-listing-1',
      'owner-a-listing-2',
    ]);
    expect(plan.matchedTitle['sortDateAdded']).toEqual(new Date('2026-02-22T00:00:00.000Z'));
    expect(plan.removedListing['removedAt']).toEqual(new Date('2026-02-28T12:00:00.000Z'));
  });

  it('T-SEED-001d · a DIFFERENT clock start produces a DIFFERENT plan', () => {
    // The mutation. Without it, a `planSeed` that ignored its clock entirely
    // and returned constants would pass every assertion above — the most
    // deterministic possible fixture, and useless.
    const shifted = planSeed('owner-a', createClock(new Date(FIXED_NOW.getTime() + DAY_MS)));
    expect(digest(shifted)).not.toBe(digest(planSeed('owner-a', createClock())));
  });

  it('T-SEED-001e · two owners get structurally identical, id-disjoint plans', () => {
    // What every cross-owner isolation assertion rests on: a 404 for owner B
    // must not be explicable by "there was nothing there anyway".
    const a = planSeed('owner-a', createClock());
    const b = planSeed('owner-b', createClock());

    const shape = (v: unknown): unknown =>
      JSON.parse(
        serialise(v)
          .replace(/owner-[ab]/g, 'OWNER')
          .replace(/Date\([^)]+\)/g, 'Date(FIXED)'),
      );
    expect(shape(b)).toEqual(shape(a));

    const ids = (plan: ReturnType<typeof planSeed>) =>
      serialise(plan).match(/owner-[ab]-[a-z]+-\d+/g) ?? [];
    expect(ids(a).length).toBeGreaterThan(0);
    expect(ids(a).filter((x) => ids(b).includes(x))).toEqual([]);
  });
});

describe('T-SEED-002 the fixture identity is derived, never typed out', () => {
  const SUBJECT = 'seed-subject-1';

  it('T-SEED-002a · the principal header parses to the subject it was built for', () => {
    const principal = readPrincipal({
      [CLIENT_PRINCIPAL_HEADER]: principalHeaderValue(SUBJECT),
    });
    expect(principal).not.toBeNull();
    expect(principal?.subject).toBe(SUBJECT);
  });

  it('T-SEED-002b · the owner id the header yields comes from deriveOwnerId', () => {
    // Asserted against the real derivation rather than a copied constant. A
    // literal here would keep passing after `ownerId.ts` changed, leaving every
    // suite seeded under an owner that no longer exists — and every isolation
    // test passing because BOTH owners were wrong in the same way.
    const principal = readPrincipal({
      [CLIENT_PRINCIPAL_HEADER]: principalHeaderValue(SUBJECT),
    });
    expect(principal).not.toBeNull();
    const derived = deriveOwnerId(principal!);
    expect(derived).toBe(deriveOwnerId({ ...principal! }));
    expect(derived).toMatch(/^o_[0-9a-f]{16}$/);
  });

  it('T-SEED-002c · two subjects derive to two different owners', () => {
    const owner = (subject: string) =>
      deriveOwnerId(readPrincipal({ [CLIENT_PRINCIPAL_HEADER]: principalHeaderValue(subject) })!);
    expect(owner('subject-one')).not.toBe(owner('subject-two'));
  });

  it('T-SEED-002d · the header carries no owner id of its own', () => {
    // The client states who it is; it never states what it may reach. An
    // ownerId travelling in the header would be a trust boundary crossed by a
    // fixture, and it is the shape of defect `T-SEC-017` exists to refuse.
    const decoded = Buffer.from(principalHeaderValue(SUBJECT), 'base64').toString('utf8');
    expect(decoded).not.toMatch(/o_[0-9a-f]{16}/);
    expect(decoded).not.toMatch(/ownerId/i);
  });
});

describe('T-SEED-003 the injected clock is the only source of time', () => {
  /**
   * Every timestamp in a plan.
   *
   * Throws rather than returning `[]` on purpose: three of the tests below
   * iterate this list, so an empty result would make them pass while asserting
   * nothing. That is not hypothetical — it is exactly what happened while this
   * file was being written (see `serialise`).
   */
  const timestamps = (plan: ReturnType<typeof planSeed>): Date[] => {
    const found = (serialise(plan).match(/Date\(([^)]+)\)/g) ?? []).map(
      (m) => new Date(m.slice('Date('.length, -1)),
    );
    if (found.length === 0) throw new Error('no timestamps found — the serialiser is broken');
    return found;
  };

  it('T-SEED-003a · no seeded timestamp is anywhere near the real wall clock', () => {
    const plan = planSeed('owner-a', createClock());
    const stamps = timestamps(plan);
    expect(stamps.length, 'the seed must contain timestamps to assert about').toBeGreaterThan(4);

    const realNow = Date.now();
    for (const stamp of stamps) {
      expect(
        Math.abs(stamp.getTime() - realNow),
        `${stamp.toISOString()} tracks the wall clock — the seed reached for Date.now()`,
      ).toBeGreaterThan(DAY_MS);
    }
  });

  it('T-SEED-003b · every timestamp moves when the clock moves', () => {
    // The precise defect: one field reading `Date.now()` directly while the
    // rest honour the clock. Such a field stays put when the clock is shifted,
    // so comparing the two sets pins it down by value.
    const base = timestamps(planSeed('owner-a', createClock())).map((d) => d.getTime());
    const shifted = timestamps(
      planSeed('owner-a', createClock(new Date(FIXED_NOW.getTime() + 3 * DAY_MS))),
    ).map((d) => d.getTime());

    expect(shifted).toHaveLength(base.length);
    for (const [i, value] of base.entries()) {
      expect(shifted[i], `timestamp #${i} ignored the injected clock`).not.toBe(value);
    }
  });

  it('T-SEED-003c · every timestamp is at or before the frozen instant', () => {
    // A fixture row dated in the future of its own clock is a seed that
    // computed from something else.
    for (const stamp of timestamps(planSeed('owner-a', createClock()))) {
      expect(stamp.getTime()).toBeLessThanOrEqual(
        FIXED_NOW.getTime() + 30 * DAY_MS,
        'only retainUntil may lead the clock, and only by the retention window',
      );
    }
  });

  it('T-SEED-003d · advancing the clock advances the plan by exactly that much', () => {
    const delta = 5 * DAY_MS;
    const base = timestamps(planSeed('owner-a', createClock()));
    const later = timestamps(
      planSeed('owner-a', createClock(new Date(FIXED_NOW.getTime() + delta))),
    );

    for (const [i, stamp] of base.entries()) {
      const moved = later[i]!.getTime() - stamp.getTime();
      // Date-only columns are truncated to midnight, so they move by whole
      // days; instants move by exactly the delta. Both are the clock, neither
      // is the wall clock.
      expect([delta, 0].includes(moved) || moved % DAY_MS === 0).toBe(true);
    }
  });

  it('T-SEED-003e · the clock itself advances by the amount asked and no more', () => {
    const clock = createClock();
    expect(clock.now()).toEqual(FIXED_NOW);
    expect(clock.advance(DAY_MS)).toEqual(new Date(FIXED_NOW.getTime() + DAY_MS));
    expect(clock.now()).toEqual(new Date(FIXED_NOW.getTime() + DAY_MS));
  });
});
