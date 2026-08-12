/**
 * TASK-019 — the allow-list (`specs/security.md` §2.2), step 2 of the chain.
 *
 * Easy Auth establishes WHO the caller is. It does not establish that they are
 * allowed in: a federated Entra IdP will happily authenticate anyone in the
 * tenant, and this application has exactly one legitimate user. Authentication
 * without this middleware is an open door with a name badge on it.
 *
 * ⚠ FAIL CLOSED, always. An unset or empty `NEXTUP_ALLOWED_SUBJECTS` denies
 * everyone (`T-SEC-014`). The tempting alternative — "no list configured, so
 * allow everybody" — is how a deployment that lost its configuration silently
 * becomes public while every health check still reports green. The cost of
 * being wrong in this direction is a locked-out owner who reads one clear
 * warning in the logs; the cost of being wrong in the other is total exposure
 * of the owner's data.
 *
 * ⚠ Values are SUBJECT IDS, never sign-in addresses. An address is
 * reassignable and case-folded, so matching on one grants access to whoever
 * holds it next. `T-SEC-015` greps this file and `ownerScope.ts` for that word
 * and fails on a match — which is why it does not appear here.
 */

import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/AppError.js';

export const ALLOWED_SUBJECTS_VAR = 'NEXTUP_ALLOWED_SUBJECTS';
export const BOOTSTRAP_VAR = 'NEXTUP_BOOTSTRAP_ALLOW_FIRST';

export const EMPTY_ALLOW_LIST_WARNING = `${ALLOWED_SUBJECTS_VAR} is empty — every request will be refused.`;

/**
 * Parses the comma-separated list.
 *
 * Read per call rather than captured at module load so that tests, and a
 * restarted container picking up changed configuration, observe the current
 * value. The set is tiny (one entry in practice), so there is nothing to cache.
 */
export function parseAllowedSubjects(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

/**
 * Bootstrap mode logs the subject id of the first refused caller, so the owner
 * can discover their own id without a directory lookup.
 *
 * ⚠ It GRANTS NOTHING. The request is still refused (`T-SEC-016`). A bootstrap
 * mode that admitted the first caller would be a race with the whole internet,
 * and would be indistinguishable from the fail-open behaviour this file exists
 * to prevent.
 */
function isBootstrapMode(): boolean {
  return process.env[BOOTSTRAP_VAR] === 'true';
}

let warnedAboutEmptyList = false;

/** Test seam: the once-only warning would otherwise leak across test cases. */
export function resetAllowListWarning(): void {
  warnedAboutEmptyList = false;
}

export function requireAllowList(req: Request, _res: Response, next: NextFunction): void {
  const allowed = parseAllowedSubjects(process.env[ALLOWED_SUBJECTS_VAR]);

  if (allowed.size === 0 && !warnedAboutEmptyList) {
    warnedAboutEmptyList = true;
    console.warn(EMPTY_ALLOW_LIST_WARNING);
  }

  const subject = req.principal?.subject;

  // No principal here means the chain was mounted out of order: this middleware
  // must never be the first thing a request meets. Refusing is the only safe
  // reading, and `T-SEC-005` asserts the order independently.
  if (subject === undefined || !allowed.has(subject)) {
    if (isBootstrapMode() && subject !== undefined) {
      console.warn(
        `${BOOTSTRAP_VAR} is set. Refused subject id: ${subject}. ` +
          `Add it to ${ALLOWED_SUBJECTS_VAR} to grant access, then unset ${BOOTSTRAP_VAR}.`,
      );
    }
    next(new AppError('NOT_ALLOWED', 403, 'This account is not permitted to use nextup.'));
    return;
  }

  next();
}
