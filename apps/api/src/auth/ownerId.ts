/**
 * TASK-020 — principal → `ownerId` (`specs/security.md` §2.4).
 *
 *     ownerId = 'o_' + sha256(issuer + '|' + subject).slice(0, 16)
 *
 * Derived, deterministic, stable — and deliberately NOT the raw Entra object
 * id. The raw id is a real-world identifier that appears in directory exports
 * and audit logs; this value ends up in a partition key, in error payloads and
 * in support conversations, and there is no reason for those to carry it.
 *
 * Three properties are load-bearing, and `T-SEC-020` asserts all three:
 *
 *  1. **Deterministic.** The same principal must map to the same owner on every
 *     request forever. This is not a cache key — it is the column every row is
 *     filed under. If it ever changed, the owner would silently see an empty
 *     list rather than an error, because their data would still be there under
 *     the old value. That is the worst possible failure mode: indistinguishable
 *     from data loss, and invisible to every test that uses one identity.
 *  2. **Issuer-qualified.** Hashing the subject alone would let two different
 *     issuers that happen to mint the same subject string collide into one
 *     owner. Unlikely, unrecoverable, and free to prevent.
 *  3. **Non-reversible.** A hash, not an encoding.
 *
 * ⚠ The separator matters. Without it, `issuer + subject` is ambiguous:
 * `('https://a/', 'bc')` and `('https://a/b', 'c')` concatenate identically and
 * would become the SAME owner. `|` cannot appear in a URL issuer or an Entra
 * object id, so it cannot be smuggled in to force that collision.
 */

import { createHash } from 'node:crypto';

import type { Principal } from './principal.js';
import { type OwnerId, asOwnerId } from '../repository/ownerData.js';

/** Hex characters kept from the digest. 64 bits — see the collision note. */
const OWNER_ID_HASH_LENGTH = 16;

const OWNER_ID_PREFIX = 'o_';

/**
 * The separator between issuer and subject. Chosen because it is not legal in
 * either input, so no principal can construct a different principal's key.
 */
const KEY_SEPARATOR = '|';

/**
 * Derives the owner id for an AUTHENTICATED principal.
 *
 * ⚠ Only ever call this with a principal produced by `readPrincipal` (or, in
 * local development, the dev shim). Never with values taken from a request
 * body, query string or path parameter — that would let a caller choose whose
 * data they are about to read (`T-SEC-006`, `T-SEC-029`).
 */
export function deriveOwnerId(principal: Principal): OwnerId {
  const key = `${principal.issuer}${KEY_SEPARATOR}${principal.subject}`;
  const digest = createHash('sha256').update(key, 'utf8').digest('hex');
  return asOwnerId(`${OWNER_ID_PREFIX}${digest.slice(0, OWNER_ID_HASH_LENGTH)}`);
}
