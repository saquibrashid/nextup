/**
 * TASK-018 — the Easy Auth principal adapter (`specs/security.md` §2.1).
 *
 * Container Apps built-in authentication ("Easy Auth") terminates the entire
 * sign-in flow at the platform edge and hands the application a single header
 * describing who signed in. That is the whole of authentication here: there is
 * no OIDC client, no JWT library, no session store, no cookie signing and no
 * password path anywhere in this codebase (ADR-0002, `T-SEC-011`).
 *
 * So this file's only job is to READ that header. It validates nothing
 * cryptographically, because it cannot and must not: the platform has already
 * done that, and the header cannot reach the app from outside — Container Apps
 * strips any client-supplied copy before the request is proxied.
 *
 * ⚠ That last sentence is exactly why this parser must fail closed. Its output
 * is treated as an authenticated identity by everything downstream, so any
 * ambiguity — absent header, truncated base64, JSON that parses but carries no
 * usable claims — must produce `null` and therefore a 401. It must never
 * produce a partial principal, a placeholder subject, or a default identity.
 * A "best effort" parse here would hand a misconfiguration a working session
 * as somebody.
 */

import type { IncomingHttpHeaders } from 'node:http';

/**
 * The header Easy Auth injects. Lower-case because Node normalises incoming
 * header names, and looking it up in any other case silently finds nothing.
 */
export const CLIENT_PRINCIPAL_HEADER = 'x-ms-client-principal';

/**
 * The stable Entra object id. This is the identity key — it survives a rename
 * and a change of sign-in address, neither of which is true of the display
 * claims below.
 */
const OID_CLAIM = 'http://schemas.microsoft.com/identity/claims/objectidentifier';

/** Issuer. Part of the identity key, so a principal without one is unusable. */
const ISSUER_CLAIM = 'iss';

/** Fallback subject claim, for an IdP that does not emit the Entra `oid`. */
const SUB_CLAIM = 'sub';

/**
 * Display-only claims, in preference order. ⚠ NEVER an authorisation input:
 * a sign-in address is reassignable, so authorising on one authorises whoever
 * holds it next. The allow-list matches subject ids and only subject ids
 * (`T-SEC-015`).
 */
const DISPLAY_CLAIMS = ['preferred_username', 'upn', 'name'] as const;

export interface Principal {
  /** e.g. `https://sts.windows.net/<tenant>/`. */
  issuer: string;
  /** The stable Entra object id (`oid`), falling back to `sub`. */
  subject: string;
  /** DISPLAY ONLY. Never an authorisation input. `null` when absent. */
  email: string | null;
}

/** The reader `createApp` depends on, so the dev shim can substitute one. */
export type PrincipalReader = (headers: IncomingHttpHeaders) => Principal | null;

interface RawClaim {
  typ?: unknown;
  val?: unknown;
}

/**
 * `Buffer.from(s, 'base64')` is famously lenient: it ignores characters
 * outside the alphabet instead of throwing, so arbitrary text "decodes"
 * happily. Re-encoding and comparing is the only way to tell real base64 from
 * text that merely survived the attempt — and text that decodes to mojibake
 * containing a `{` would otherwise reach `JSON.parse`.
 */
function decodeBase64Json(value: string): unknown {
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length === 0) return null;
  const canonical = buffer.toString('base64').replace(/=+$/, '');
  if (canonical !== value.replace(/\s/g, '').replace(/=+$/, '')) return null;
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
}

function claimValue(claims: readonly RawClaim[], type: string): string | null {
  for (const claim of claims) {
    if (claim.typ === type && typeof claim.val === 'string' && claim.val.length > 0) {
      return claim.val;
    }
  }
  return null;
}

/**
 * Parses the `X-MS-CLIENT-PRINCIPAL` header.
 *
 * @returns the principal, or `null` when the header is absent, malformed, or
 * carries no usable identity. `null` means 401 `UNAUTHENTICATED` — never a
 * degraded or anonymous session.
 */
export function readPrincipal(headers: IncomingHttpHeaders): Principal | null {
  const raw = headers[CLIENT_PRINCIPAL_HEADER];
  // A repeated header arrives as an array. Two candidate identities in one
  // request is not a situation to pick a winner from.
  const encoded = typeof raw === 'string' ? raw : null;
  if (encoded === null || encoded.trim().length === 0) return null;

  const decoded = decodeBase64Json(encoded.trim());
  if (decoded === null || typeof decoded !== 'object') return null;

  const claimsRaw = (decoded as { claims?: unknown }).claims;
  if (!Array.isArray(claimsRaw)) return null;
  const claims = claimsRaw.filter(
    (claim): claim is RawClaim => typeof claim === 'object' && claim !== null,
  );

  const subject = claimValue(claims, OID_CLAIM) ?? claimValue(claims, SUB_CLAIM);
  const issuer = claimValue(claims, ISSUER_CLAIM);

  // Both halves of the identity key are required. `ownerId` is derived from
  // issuer AND subject (§2.4), so a principal missing either cannot be mapped
  // to a stable owner — and an owner id that is not stable silently orphans
  // every row that owner has ever written.
  if (subject === null || issuer === null) return null;

  let display: string | null = null;
  for (const type of DISPLAY_CLAIMS) {
    display = claimValue(claims, type);
    if (display !== null) break;
  }

  return { issuer, subject, email: display };
}
