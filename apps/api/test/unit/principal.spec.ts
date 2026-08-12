/**
 * T-SEC-013 — the Easy Auth principal adapter (`specs/security.md` §2.1).
 *
 * The table below is the point of this suite. Every row is a way the header
 * can be wrong, and each one must produce `null` — meaning 401 — rather than a
 * partial principal. A parser that returned `{ subject: undefined }` for a
 * malformed header would satisfy a naive "it doesn't throw" test and then hand
 * every downstream consumer an authenticated identity with no subject.
 */

import { describe, expect, it } from 'vitest';

import { CLIENT_PRINCIPAL_HEADER, readPrincipal } from '../../src/auth/principal.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

const header = (value: string | string[] | undefined) => ({ [CLIENT_PRINCIPAL_HEADER]: value });

const fullClaims = {
  auth_typ: 'aad',
  claims: [
    { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
    { typ: OID, val: 'oid-123' },
    { typ: 'sub', val: 'sub-should-lose-to-oid' },
    { typ: 'preferred_username', val: 'owner@example.com' },
  ],
};

describe('T-SEC-013 readPrincipal', () => {
  it('T-SEC-013a: reads a full set of claims', () => {
    expect(readPrincipal(header(encode(fullClaims)))).toEqual({
      issuer: 'https://sts.windows.net/tenant/',
      subject: 'oid-123',
      email: 'owner@example.com',
    });
  });

  it('T-SEC-013b: prefers the Entra object id over sub', () => {
    // `sub` can be pairwise and issuer-scoped; `oid` is the stable directory
    // identity. Picking the wrong one silently re-homes every row the owner has.
    const result = readPrincipal(header(encode(fullClaims)));
    expect(result?.subject).toBe('oid-123');
  });

  it('T-SEC-013c: falls back to sub when there is no object id claim', () => {
    const claims = {
      claims: [
        { typ: 'iss', val: 'https://issuer/' },
        { typ: 'sub', val: 'sub-456' },
      ],
    };
    expect(readPrincipal(header(encode(claims)))?.subject).toBe('sub-456');
  });

  it('T-SEC-013d: returns null when the header is absent', () => {
    expect(readPrincipal({})).toBeNull();
  });

  it('T-SEC-013e: returns null for an empty header', () => {
    expect(readPrincipal(header(''))).toBeNull();
    expect(readPrincipal(header('   '))).toBeNull();
  });

  it('T-SEC-013f: returns null for invalid base64', () => {
    // Buffer.from is lenient and would otherwise "decode" this to noise.
    expect(readPrincipal(header('not base64 !!!'))).toBeNull();
  });

  it('T-SEC-013g: returns null for valid base64 that is not JSON', () => {
    expect(readPrincipal(header(Buffer.from('hello', 'utf8').toString('base64')))).toBeNull();
  });

  it('T-SEC-013h: returns null for JSON without a claims array', () => {
    expect(readPrincipal(header(encode({ auth_typ: 'aad' })))).toBeNull();
    expect(readPrincipal(header(encode({ claims: 'not-an-array' })))).toBeNull();
  });

  it('T-SEC-013i: returns null for claims without a subject', () => {
    const claims = { claims: [{ typ: 'iss', val: 'https://issuer/' }] };
    expect(readPrincipal(header(encode(claims)))).toBeNull();
  });

  it('T-SEC-013j: returns null for a subject with no issuer', () => {
    // ownerId is derived from issuer AND subject, so a principal missing the
    // issuer cannot be mapped to a stable owner.
    const claims = { claims: [{ typ: OID, val: 'oid-123' }] };
    expect(readPrincipal(header(encode(claims)))).toBeNull();
  });

  it('T-SEC-013k: accepts claims with an object id and issuer only', () => {
    const claims = {
      claims: [
        { typ: 'iss', val: 'https://issuer/' },
        { typ: OID, val: 'oid-123' },
      ],
    };
    expect(readPrincipal(header(encode(claims)))).toEqual({
      issuer: 'https://issuer/',
      subject: 'oid-123',
      email: null,
    });
  });

  it('T-SEC-013l: returns null when the header is repeated', () => {
    // Express surfaces a repeated header as an array. Two candidate identities
    // in one request is not a situation to pick a winner from.
    expect(readPrincipal(header([encode(fullClaims), encode(fullClaims)]))).toBeNull();
  });

  it('T-SEC-013m: ignores claims whose value is empty or not a string', () => {
    const claims = {
      claims: [
        { typ: 'iss', val: 'https://issuer/' },
        { typ: OID, val: '' },
        { typ: 'sub', val: 'sub-789' },
      ],
    };
    expect(readPrincipal(header(encode(claims)))?.subject).toBe('sub-789');
  });

  it('T-SEC-013n: survives a malformed entry inside the claims array', () => {
    const claims = {
      claims: [
        null,
        'nonsense',
        42,
        { typ: 'iss', val: 'https://issuer/' },
        { typ: OID, val: 'oid-1' },
      ],
    };
    expect(readPrincipal(header(encode(claims)))?.subject).toBe('oid-1');
  });

  it('T-SEC-013o: never invents a subject from a display claim', () => {
    // A sign-in address is reassignable. If it could become the subject, the
    // allow-list would be matching on something the tenant can hand to someone
    // else next month.
    const claims = {
      claims: [
        { typ: 'iss', val: 'https://issuer/' },
        { typ: 'preferred_username', val: 'owner@example.com' },
      ],
    };
    expect(readPrincipal(header(encode(claims)))).toBeNull();
  });
});
