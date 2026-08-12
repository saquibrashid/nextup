import { afterEach, describe, expect, it } from 'vitest';

import { fillRandomBytes, utf8 } from '../src/runtime.js';

/**
 * `packages/domain` runs in the **browser and the API**, so it may only reach
 * for host APIs that exist in both. `runtime.ts` is the single place that does,
 * and these tests pin both halves of its contract: the happy path, and the
 * refusal to continue when a host API is missing.
 *
 * The refusal matters more than it looks. `fillRandomBytes` feeds ULIDs, which
 * are primary keys — a fallback to `Math.random()` would still produce ids that
 * *look* correct, and the collision it invites would only ever surface as a
 * duplicate-key failure in production, long after the change that caused it.
 */

interface MutableHost {
  crypto?: unknown;
  TextEncoder?: unknown;
}

const host = globalThis as unknown as MutableHost;

/** Remove a global for one test, restoring whatever was there afterwards. */
function withoutGlobal(name: 'crypto' | 'TextEncoder', run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value: undefined, configurable: true, writable: true });
  try {
    run();
  } finally {
    if (descriptor === undefined) {
      delete host[name];
    } else {
      Object.defineProperty(globalThis, name, descriptor);
    }
  }
}

afterEach(() => {
  expect(host.crypto).toBeDefined();
  expect(host.TextEncoder).toBeDefined();
});

describe('T-DM-004l: fillRandomBytes', () => {
  it('T-DM-004l: fills the array in place and returns it', () => {
    const bytes = new Uint8Array(16);
    const returned = fillRandomBytes(bytes);

    expect(returned).toBe(bytes);
    // All-zero is a legitimate random draw, but at 2^-128 it is a far better
    // signal that nothing wrote to the buffer than it is a real sample.
    expect(bytes.some((b) => b !== 0)).toBe(true);
  });

  it('T-DM-004m: throws rather than falling back when Web Crypto is absent', () => {
    withoutGlobal('crypto', () => {
      expect(() => fillRandomBytes(new Uint8Array(4))).toThrow(/Web Crypto is unavailable/);
    });
  });
});

describe('T-DM-004n: utf8', () => {
  it('T-DM-004n: encodes ASCII to one byte per character', () => {
    expect(Array.from(utf8('abc'))).toEqual([97, 98, 99]);
  });

  it('T-DM-004o: encodes non-ASCII as UTF-8, not code units', () => {
    // A title like "Sen to Chihiro" or an accented one must hash identically
    // wherever it is encoded, so the encoding has to be UTF-8 and not UTF-16.
    expect(Array.from(utf8('é'))).toEqual([0xc3, 0xa9]);
    expect(Array.from(utf8('日'))).toEqual([0xe6, 0x97, 0xa5]);
  });

  it('T-DM-004p: throws when TextEncoder is absent', () => {
    withoutGlobal('TextEncoder', () => {
      expect(() => utf8('abc')).toThrow(/TextEncoder is unavailable/);
    });
  });
});
