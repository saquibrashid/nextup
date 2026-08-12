// ULID generation and deterministic ids — `specs/data-model.md` §1.
//
// Hand-rolled rather than taking the `ulid` package, for one reason: the
// deterministic variant this project actually depends on (`deterministicId`)
// is not something that package offers, so we would end up owning half of this
// anyway — and owning half of an id scheme is worse than owning all of it.
// Crockford base32 is a lookup table, not a cryptographic primitive; the
// hashing that IS a primitive is delegated to `@noble/hashes`.

import { sha256 } from '@noble/hashes/sha2.js';

import { fillRandomBytes, utf8 } from './runtime.js';

/**
 * Crockford's base32 alphabet: the digits and the uppercase letters, minus
 * `I`, `L`, `O` and `U` — excluded because they misread as `1`, `1`, `0`, and
 * as an obscenity. Order matters; this is the encoding, not a set.
 */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = 32;

/** ULID = 10 characters of timestamp + 16 characters of randomness. */
const TIME_LEN = 10;
const RANDOM_LEN = 16;
export const ULID_LEN = TIME_LEN + RANDOM_LEN;

/** The largest instant a 10-character base32 timestamp can express. */
export const ULID_MAX_TIME = 281_474_976_710_655; // 2^48 - 1, i.e. 10889-08-02

/** A canonical ULID: 26 Crockford base32 characters, uppercase. */
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function encodeTime(now: number): string {
  if (!Number.isInteger(now) || now < 0 || now > ULID_MAX_TIME) {
    throw new RangeError(`ULID timestamp out of range: ${now}`);
  }
  let out = '';
  let remaining = now;
  for (let i = 0; i < TIME_LEN; i += 1) {
    const mod = remaining % ENCODING_LEN;
    out = ENCODING[mod]! + out;
    remaining = (remaining - mod) / ENCODING_LEN;
  }
  return out;
}

/**
 * `bytes` is consumed most-significant-first, five bits at a time, which is
 * why 10 bytes (80 bits) yield exactly 16 characters with nothing left over.
 */
function encodeBase32(bytes: Uint8Array, chars: number): string {
  let out = '';
  let bitBuffer = 0;
  let bitCount = 0;
  let index = 0;

  while (out.length < chars) {
    if (bitCount < 5) {
      bitBuffer = (bitBuffer << 8) | (bytes[index % bytes.length] ?? 0);
      bitCount += 8;
      index += 1;
    }
    bitCount -= 5;
    out += ENCODING[(bitBuffer >>> bitCount) & 31]!;
  }
  return out;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  // Web Crypto, present in Node >= 19 and every supported browser. Deliberately
  // NOT `node:crypto`: this module is imported by the SPA as well as the API,
  // and a Node built-in here breaks the browser bundle.
  fillRandomBytes(bytes);
  return bytes;
}

/**
 * A fresh, lexicographically sortable ULID.
 *
 * Two ULIDs generated within the same millisecond are ordered arbitrarily
 * relative to each other. Nothing in nextup sorts by id to establish causality
 * — ordering is by explicit timestamp fields — so monotonicity is a test
 * convenience (see {@link monotonicUlidFactory}), not a production guarantee.
 */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeBase32(randomBytes(10), RANDOM_LEN);
}

/**
 * A ULID derived entirely from `seed` — same seed, same id, forever, on any
 * machine.
 *
 * This is what makes batch application **retry-idempotent** (REQ-005/REQ-006):
 * a document a batch creates is keyed on `deterministicId(batchId + ':' +
 * candidateId)`, so a retry after a crash mid-apply **overwrites** the row it
 * created first time round instead of inserting a second one. Random ids would
 * duplicate every title the crashed attempt had already written — silently,
 * and only under the conditions that are hardest to reproduce.
 *
 * The timestamp segment is derived from the hash too, not from the clock:
 * a clock-derived prefix would make the id depend on *when* the retry ran,
 * which is precisely the thing that must not matter.
 */
export function deterministicId(seed: string): string {
  if (seed.length === 0) {
    throw new RangeError('deterministicId requires a non-empty seed');
  }
  const digest = sha256(utf8(seed));
  return encodeBase32(digest, ULID_LEN);
}

/**
 * A generator of strictly increasing ULIDs, for tests that need a stable,
 * readable ordering (fixtures, seeded stores, snapshot assertions).
 *
 * Within one millisecond it increments the random segment rather than
 * re-rolling it, so `a < b` holds for every pair in generation order.
 */
export function monotonicUlidFactory(seed = 0): (now?: number) => string {
  let lastTime = -1;
  let lastRandom = '';
  let counter = seed;

  return (now: number = Date.now()): string => {
    if (now === lastTime) {
      lastRandom = incrementBase32(lastRandom);
    } else {
      lastTime = now;
      counter += 1;
      // A fixed, seed-derived random segment keeps the whole sequence
      // reproducible — a test that fails must fail the same way twice.
      lastRandom = encodeBase32(sha256(utf8(`ulid-seed:${counter}`)), RANDOM_LEN);
    }
    return encodeTime(now) + lastRandom;
  };
}

function incrementBase32(value: string): string {
  const chars = [...value];
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const next = ENCODING.indexOf(chars[i]!) + 1;
    if (next < ENCODING_LEN) {
      chars[i] = ENCODING[next]!;
      return chars.join('');
    }
    chars[i] = ENCODING[0]!;
  }
  throw new RangeError('monotonic ULID random segment overflowed');
}
