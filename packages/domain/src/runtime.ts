/**
 * The two host APIs `packages/domain` is allowed to reach for, typed locally.
 *
 * This package is imported by the **SPA as well as the API**, so it may only
 * use APIs that exist in *both* runtimes. `TextEncoder` and Web Crypto qualify
 * (WHATWG standards, present in every supported browser and in Node >= 19);
 * `node:crypto` and `Buffer` do not, and would break the browser bundle.
 *
 * Neither is declared by the package's `lib` (`ES2022` only, deliberately —
 * adding `DOM` would let `document` and `window` typecheck in code that also
 * runs server-side). Until now they resolved only because `@types/node` was
 * ambiently included in the compilation: browser-bound code was being
 * typechecked against **Node's** global typings, which is exactly backwards.
 * TypeScript 7 stopped supplying them and surfaced it.
 *
 * The fix is deliberately NOT an ambient `declare global`: this package emits
 * `.d.ts` to `dist`, so an ambient re-declaration of `crypto` would travel to
 * every consumer and collide with the DOM or `@types/node` declaration already
 * in scope there. Narrow, local, non-emitting types keep the problem inside
 * this file.
 */

interface UniversalCrypto {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

interface UniversalTextEncoder {
  encode(input: string): Uint8Array;
}

interface TextEncoderConstructor {
  new (): UniversalTextEncoder;
}

interface UniversalGlobals {
  crypto?: UniversalCrypto;
  TextEncoder?: TextEncoderConstructor;
}

const host = globalThis as unknown as UniversalGlobals;

/**
 * Cryptographically secure random bytes, filled in place.
 *
 * Throws rather than falling back to `Math.random()`. These bytes become ULIDs,
 * which are used as primary keys: a silent downgrade to a non-cryptographic
 * source would still produce ids that *look* fine, and the resulting collision
 * risk would only ever show up as a duplicate-key failure in production.
 */
export function fillRandomBytes(bytes: Uint8Array): Uint8Array {
  const webCrypto = host.crypto;
  if (webCrypto === undefined) {
    throw new Error('Web Crypto is unavailable in this runtime; cannot generate secure ids');
  }
  return webCrypto.getRandomValues(bytes);
}

/** UTF-8 encode a string, for hashing. */
export function utf8(input: string): Uint8Array {
  const Encoder = host.TextEncoder;
  if (Encoder === undefined) {
    throw new Error('TextEncoder is unavailable in this runtime');
  }
  return new Encoder().encode(input);
}
