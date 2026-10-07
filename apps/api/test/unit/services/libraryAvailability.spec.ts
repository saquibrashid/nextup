/**
 * US-063 (#397/#410, PRD `A54`) — the pure availability-change rules: what a
 * Library title's marker says, the Keep signature that silences exactly one
 * change, and the "not known is not a change" guard (ADR-0010 Trap 4).
 */

import { SERVICES } from '@nextup/domain';
import { describe, expect, it } from 'vitest';

import {
  availabilitySignature,
  isAvailabilitySignature,
  libraryAvailabilityFor,
  parseProviderList,
  yourServicesFrom,
} from '../../../src/services/libraryAvailability.js';

const CHECKED = new Date('2026-09-20T10:00:00.000Z');

const base = {
  listedServices: ['starz'],
  availableOn: ['Starz'],
  rentOn: [] as string[],
  checkedAt: CHECKED,
  region: 'US',
  yourServices: ['netflix', 'starz'] as const,
  keptSignature: null,
};

describe('US-063 — library availability change detection', () => {
  it('T-MOVE-001a: a title still streaming where it is badged has no change', () => {
    const result = libraryAvailabilityFor({ ...base, yourServices: [...base.yourServices] });
    expect(result.left).toEqual([]);
    expect(result.joined).toEqual([]);
    expect(result.signature).toBeNull();
    expect(result.canMoveToWaiting).toBe(false);
    expect(result.accessState).toBe('streaming');
  });

  it('T-MOVE-001b: leaving the badged service for rent-only is a left change that may move to Waiting', () => {
    const result = libraryAvailabilityFor({
      ...base,
      yourServices: [...base.yourServices],
      availableOn: [],
      rentOn: ['Apple TV', 'Amazon Video'],
    });
    expect(result.left).toEqual(['starz']);
    expect(result.joined).toEqual([]);
    expect(result.accessState).toBe('rent-only');
    expect(result.signature).toBe('left=starz;joined=');
    expect(result.canMoveToWaiting).toBe(true);
    expect(result.rentOn).toEqual(['Apple TV', 'Amazon Video']);
    expect(result.checkedAt).toBe(CHECKED.toISOString());
  });

  it('T-MOVE-001c: rent-only is never streaming — a rent offer does not keep a badge current', () => {
    const result = libraryAvailabilityFor({
      ...base,
      yourServices: [...base.yourServices],
      availableOn: [],
      rentOn: ['Starz'],
    });
    expect(result.left).toEqual(['starz']);
  });

  it('T-MOVE-001d: a new owner service streaming it is a joined change, and Waiting is not offered', () => {
    const result = libraryAvailabilityFor({
      ...base,
      yourServices: [...base.yourServices],
      availableOn: ['Starz', 'Netflix'],
    });
    expect(result.joined).toEqual(['netflix']);
    expect(result.left).toEqual([]);
    expect(result.signature).toBe('left=;joined=netflix');
    expect(result.canMoveToWaiting).toBe(false);
  });

  it('T-MOVE-001e: a service the owner does not hold never counts as joined', () => {
    const result = libraryAvailabilityFor({
      ...base,
      yourServices: ['starz'],
      availableOn: ['Starz', 'Netflix'],
    });
    expect(result.joined).toEqual([]);
    expect(result.signature).toBeNull();
  });

  it('T-MOVE-001f: never checked or no provider data is NOT KNOWN, never a change', () => {
    const never = libraryAvailabilityFor({
      ...base,
      yourServices: [...base.yourServices],
      availableOn: null,
      rentOn: null,
      checkedAt: null,
    });
    expect(never.signature).toBeNull();
    expect(never.canMoveToWaiting).toBe(false);
    expect(never.checkedAt).toBeNull();
    expect(never.rentOn).toBeNull();

    const unknown = libraryAvailabilityFor({
      ...base,
      yourServices: [...base.yourServices],
      availableOn: null,
      rentOn: null,
    });
    expect(unknown.left).toEqual([]);
    expect(unknown.signature).toBeNull();
  });

  it('T-MOVE-001g: a Keep silences exactly the kept change and no other', () => {
    const left = {
      ...base,
      yourServices: [...base.yourServices],
      availableOn: [] as string[],
      rentOn: ['Apple TV'],
    };
    expect(libraryAvailabilityFor({ ...left, keptSignature: 'left=starz;joined=' }).kept).toBe(
      true,
    );
    const changedAgain = libraryAvailabilityFor({
      ...left,
      availableOn: ['Netflix'],
      keptSignature: 'left=starz;joined=',
    });
    expect(changedAgain.signature).toBe('left=starz;joined=netflix');
    expect(changedAgain.kept).toBe(false);
    expect(libraryAvailabilityFor({ ...base, yourServices: ['starz'] }).kept).toBe(false);
  });
});

describe('US-063 — signature and parsing helpers', () => {
  it('T-MOVE-002a: the signature is stable in SERVICES order and null when nothing changed', () => {
    expect(availabilitySignature([], [])).toBeNull();
    const reversed = [...SERVICES].reverse();
    expect(availabilitySignature(reversed, [])).toBe(`left=${SERVICES.join(',')};joined=`);
  });

  it('T-MOVE-002b: only well-formed signatures over the closed service set are accepted', () => {
    expect(isAvailabilitySignature('left=starz;joined=')).toBe(true);
    expect(isAvailabilitySignature('left=;joined=netflix')).toBe(true);
    for (const bad of [
      'left=;joined=',
      'left=hulu;joined=',
      'nonsense',
      7,
      null,
      `left=${'starz,'.repeat(100)}starz;joined=`,
    ]) {
      expect(isAvailabilitySignature(bad)).toBe(false);
    }
  });

  it('T-MOVE-002c: a provider list that is not an array of strings is not known', () => {
    expect(parseProviderList(null)).toBeNull();
    expect(parseProviderList(undefined)).toBeNull();
    expect(parseProviderList('{bad')).toBeNull();
    expect(parseProviderList('{"a":1}')).toBeNull();
    expect(parseProviderList('["Starz",3]')).toEqual(['Starz']);
  });

  it('T-MOVE-002d: an owner with no imports yet holds every supported service', () => {
    expect(yourServicesFrom([])).toEqual([...SERVICES]);
    expect(yourServicesFrom(['starz', 'unknown'])).toEqual(['starz']);
  });
});
