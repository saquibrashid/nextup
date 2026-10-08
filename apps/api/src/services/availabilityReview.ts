/**
 * The "Availability changes" review screen (US-064, REQ-130, PRD `A55`,
 * ADR-0010 Rev 5, `specs/api.md` §6.45–§6.48).
 *
 * PURE. Everything here decides from rows already read; nothing asks TMDB and
 * nothing writes. The routes in `routes/availabilityReview.ts` do the I/O.
 *
 * ⚠ **SHOW THE FACT, NEVER NAG (invariant 8a).** The screen lists exactly the
 * changes the Library markers already state (`libraryAvailabilityFor`, un-kept
 * signature) and the waiting titles now streaming on an owner service. There
 * is no threshold and no derived "you should" state here.
 *
 * ⚠ **"CHECK MORE TITLES" IS OWNER-INITIATED, NOT A FOURTH LAZY TRIGGER.**
 * `selectForAvailabilityCheck` picks the next batch for ONE tap of an explicit
 * button. It never runs on a read, never on a timer, and is capped by
 * `AVAILABILITY_CHECK_BATCH` — which is deliberately a separate constant from
 * `AVAILABILITY_REFRESH_PER_REQUEST` (the on-access cap), so tuning one can
 * never silently widen the other (the `T-INV-008` rule, applied here).
 */

import { SERVICES, type Service } from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import { isAvailabilitySignature } from './libraryAvailability.js';
import { isAvailabilityStale, type IntentRow } from './watchAvailability.js';

/**
 * The most titles ONE tap of "Check more titles" may look up (US-064 AC-3).
 *
 * ⚠ A ceiling per owner tap, not a sweep. Each lookup is serial against a
 * 0.25 vCPU replica, so twenty keeps the request comfortably short; the owner
 * taps again for the next twenty. Never derive it from, or feed it into,
 * `AVAILABILITY_REFRESH_PER_REQUEST`.
 */
export const AVAILABILITY_CHECK_BATCH = 20;

/**
 * The most items one bulk answer may carry (`specs/api.md` §6.48). Each item
 * is its own transaction, so this bounds the request's duration, not its
 * atomicity.
 */
export const AVAILABILITY_REVIEW_APPLY_MAX = 50;

/** The four bulk answers (US-064 AC-4). Closed vocabulary. */
export const REVIEW_ACTIONS = [
  'keep',
  'remove-left-badges',
  'move-to-waiting',
  'add-to-library',
] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** One row a check may look up: a Library title or a waiting intent. */
export interface CheckCandidate {
  kind: 'title' | 'intent';
  row: IntentRow;
}

/** How many checkable rows have a recent answer, and how many do not. */
export function checkCounts(
  rows: readonly CheckCandidate[],
  now: Date,
): { checked: number; notCheckedRecently: number } {
  let notCheckedRecently = 0;
  let checked = 0;
  for (const { row } of rows) {
    // An unmatched work has nothing to ask about, so it is neither.
    if (row.tmdbId === null || row.tmdbMediaType === null) continue;
    if (isAvailabilityStale(row, now)) notCheckedRecently += 1;
    else checked += 1;
  }
  return { checked, notCheckedRecently };
}

/**
 * The next rows one "Check more titles" tap looks up: stale only, NEVER
 * CHECKED first, then the oldest answer first, at most `limit`.
 *
 * ⚠ Oldest-first is the point: repeated taps walk the whole set rather than
 * re-asking about the same handful.
 */
export function selectForAvailabilityCheck(
  rows: readonly CheckCandidate[],
  now: Date,
  limit: number = AVAILABILITY_CHECK_BATCH,
): CheckCandidate[] {
  const age = (candidate: CheckCandidate): number =>
    candidate.row.availabilityCheckedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  return rows
    .filter((candidate) => isAvailabilityStale(candidate.row, now))
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => age(a.candidate) - age(b.candidate) || a.index - b.index)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/**
 * The service a bulk "Add to Library" uses for a waiting row (US-064 AC-4):
 * the FIRST owner service it streams on, in `SERVICES` order. `null` when no
 * owner service streams it, which refuses that item.
 *
 * ⚠ Decided, not guessed: the per-row buttons still offer every service, and
 * the response names the one used, so a different choice is one more tap.
 */
export function firstOwnerService(
  flagged: readonly Service[] | null,
  yours: readonly Service[],
): Service | null {
  if (flagged === null) return null;
  return SERVICES.find((service) => flagged.includes(service) && yours.includes(service)) ?? null;
}

export interface ApplyItem {
  id: string;
  signature: string | null;
}

/** Parse and validate the §6.48 body. Throws `400 VALIDATION_FAILED`. */
export function parseApplyBody(body: unknown): { action: ReviewAction; items: ApplyItem[] } {
  const invalid = (message: string, field: string): AppError =>
    new AppError('VALIDATION_FAILED', 400, message, { field });
  const record =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const action = record['action'];
  if (typeof action !== 'string' || !(REVIEW_ACTIONS as readonly string[]).includes(action)) {
    throw invalid('"action" is not one of the permitted values.', 'action');
  }
  const raw = record['items'];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > AVAILABILITY_REVIEW_APPLY_MAX) {
    throw invalid(
      `"items" must list between 1 and ${String(AVAILABILITY_REVIEW_APPLY_MAX)} rows.`,
      'items',
    );
  }
  const needsSignature = action !== 'add-to-library';
  const seen = new Set<string>();
  const items = raw.map((entry: unknown): ApplyItem => {
    const item =
      typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : {};
    const id = item['id'];
    if (typeof id !== 'string' || id === '' || id.length > 200 || seen.has(id)) {
      throw invalid('Each item needs a distinct "id".', 'items');
    }
    seen.add(id);
    const signature = item['signature'];
    if (!needsSignature) return { id, signature: null };
    if (!isAvailabilitySignature(signature)) {
      throw invalid('Each item needs the "signature" of the change it answers.', 'items');
    }
    return { id, signature };
  });
  return { action: action as ReviewAction, items };
}
