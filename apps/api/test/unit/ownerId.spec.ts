/**
 * T-SEC-020 — principal → ownerId (`specs/security.md` §2.4).
 *
 * The determinism case is the one that matters. `ownerId` is the column every
 * row is filed under, so if the derivation ever changed for the same principal
 * the owner would see an EMPTY LIST rather than an error — their data would
 * still exist, filed under a value nothing queries any more. That failure is
 * indistinguishable from data loss and invisible to any test using a single
 * identity, which is why collision and stability are asserted at scale.
 */

import { describe, expect, it } from 'vitest';

import { deriveOwnerId } from '../../src/auth/ownerId.js';
import type { Principal } from '../../src/auth/principal.js';

const principal = (subject: string, issuer = 'https://sts.windows.net/tenant/'): Principal => ({
  issuer,
  subject,
  email: null,
});

describe('T-SEC-020 deriveOwnerId', () => {
  it('T-SEC-020a: is deterministic for the same principal', () => {
    const first = deriveOwnerId(principal('oid-123'));
    const second = deriveOwnerId(principal('oid-123'));
    expect(first).toBe(second);
  });

  it('T-SEC-020b: is stable across a differing display claim', () => {
    // A rename must not re-home the owner's data.
    const a = deriveOwnerId({ ...principal('oid-123'), email: 'before@example.com' });
    const b = deriveOwnerId({ ...principal('oid-123'), email: 'after@example.com' });
    expect(a).toBe(b);
  });

  it('T-SEC-020c: uses the documented shape', () => {
    expect(deriveOwnerId(principal('oid-123'))).toMatch(/^o_[0-9a-f]{16}$/);
  });

  it('T-SEC-020d: is not the raw subject, encoded or otherwise', () => {
    const id = deriveOwnerId(principal('oid-123'));
    expect(id).not.toContain('oid-123');
    expect(id).not.toContain(Buffer.from('oid-123', 'utf8').toString('base64'));
  });

  it('T-SEC-020e: distinguishes two issuers with the same subject', () => {
    const a = deriveOwnerId(principal('same-subject', 'https://issuer-a/'));
    const b = deriveOwnerId(principal('same-subject', 'https://issuer-b/'));
    expect(a).not.toBe(b);
  });

  it('T-SEC-020f: cannot be collided by moving the boundary between issuer and subject', () => {
    // Without a separator, ('https://a/', 'bc') and ('https://a/b', 'c')
    // concatenate identically and would become the SAME owner.
    const a = deriveOwnerId({ issuer: 'https://a/', subject: 'bc', email: null });
    const b = deriveOwnerId({ issuer: 'https://a/b', subject: 'c', email: null });
    expect(a).not.toBe(b);
  });

  it('T-SEC-020g: two principals never collide across 10,000 subjects', () => {
    const seen = new Map<string, string>();
    for (let i = 0; i < 10_000; i += 1) {
      const subject = `oid-${i}`;
      const id = deriveOwnerId(principal(subject));
      const previous = seen.get(id);
      expect(previous, `${subject} collided with ${previous ?? ''} on ${id}`).toBeUndefined();
      seen.set(id, subject);
    }
    expect(seen.size).toBe(10_000);
  });

  it('T-SEC-020h: is stable across repeated derivation of the whole fixture', () => {
    const once = Array.from({ length: 1_000 }, (_, i) => deriveOwnerId(principal(`oid-${i}`)));
    const twice = Array.from({ length: 1_000 }, (_, i) => deriveOwnerId(principal(`oid-${i}`)));
    expect(once).toEqual(twice);
  });
});
