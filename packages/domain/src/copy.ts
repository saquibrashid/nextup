// Owner-facing copy that MORE THAN ONE surface must render identically.
//
// `specs/ui.md` §copy is the source of these strings. They live in the domain
// package, not in the API or the SPA, because several of them are rendered in
// both places and a re-typed sentence is a silent divergence: the API's
// `modeExplanation` and the mode picker's radio-card label are required to be
// the same words (US-003 AC-2/AC-3), and nothing would fail if they drifted.
//
// ⚠ Only add a string here once a SECOND surface needs it. Copy used by one
// component belongs next to that component; hoisting all of `ui.md` §copy into
// the domain would make every wording tweak a cross-package change.

import { type BatchMode, type Service } from './enums.js';
import type { IsoDate } from './types.js';

/**
 * Display names for the services. The stored value is lower-case (`'netflix'`),
 * the rendered value is not, and the difference has to be resolved somewhere
 * that both the API and the SPA can reach.
 */
export const SERVICE_LABELS: Readonly<Record<Service, string>> = {
  netflix: 'Netflix',
  max: 'Max',
};

/**
 * `MODE_FULL_UPDATE_CONSEQUENCE` — `specs/ui.md` §copy, US-003 AC-2.
 *
 * The service name is interpolated, so this is a function rather than a
 * constant. The sentence states the CONSEQUENCE of the mode, not its name:
 * "full update" means nothing to the owner, "anything not in these screenshots
 * will be offered for removal" does.
 */
export function modeFullUpdateConsequence(service: Service): string {
  return `Full update: anything on ${SERVICE_LABELS[service]} that isn't in these screenshots will be offered for removal.`;
}

/** `MODE_APPEND_ONLY_CONSEQUENCE` — `specs/ui.md` §copy, US-003 AC-3. */
export const MODE_APPEND_ONLY_CONSEQUENCE =
  "Only adds what's in these screenshots. Nothing will be removed.";

/**
 * The `modeExplanation` field of `POST /api/batches` (`specs/api.md` §6.11)
 * and the mode picker's card text (`specs/ui.md` §3) — one wording, one place.
 *
 * Exhaustive over `BatchMode` by construction: adding a mode to the enum
 * without extending this fails to compile rather than silently returning the
 * append-only sentence for a mode that removes titles.
 */
export function modeExplanation(mode: BatchMode, service: Service): string {
  switch (mode) {
    case 'full-update':
      return modeFullUpdateConsequence(service);
    case 'append-only':
      return MODE_APPEND_ONLY_CONSEQUENCE;
  }
}

/**
 * Month abbreviations for `dateAddedLabel`.
 *
 * Fixed three-letter English rather than `toLocaleDateString`, because the
 * latter varies with the host's ICU data and locale — the same row would
 * render differently in CI, in the container and on the owner's laptop, and a
 * substring assertion on the result would be flaky for reasons nobody would
 * connect to the date.
 */
const MONTH_ABBREVIATIONS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** The substring REQ-061 requires in every date-added label. */
export const DATE_ADDED_LABEL_MARKER = 'to nextup';

/**
 * The honest date-added label (REQ-061, `specs/api.md` §6.2, US-018 AC-5).
 *
 * ⚠ The words "to nextup" are the REQUIREMENT, not decoration. The date this
 * product knows is the date a title entered *this list* from a screenshot —
 * it is NOT the date the owner saved it on Netflix or Max, and that date is
 * unknowable because there is no API and no scraping. A bare "Added 2 Apr
 * 2026" would read as the streaming service's date and quietly assert
 * something false about the owner's own history.
 *
 * Computed SERVER-SIDE so the rule has exactly one implementation: the SPA
 * renders `dateAddedLabel` verbatim and MUST NOT construct it (`specs/ui.md`
 * §row). `T-LIST-018` asserts every rendered label contains "to nextup".
 */
export function dateAddedLabel(dateAdded: IsoDate): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateAdded);
  if (match === null) {
    // Refuse rather than render a partial sentence. A malformed date reaching
    // here means a write path stored something the `date` column cannot hold,
    // and "Added to nextup Invalid Date" is worse than a loud failure.
    throw new RangeError(
      `dateAddedLabel expects YYYY-MM-DD, received ${JSON.stringify(dateAdded)}`,
    );
  }

  const [, year, month, day] = match as unknown as [string, string, string, string];
  const monthName = MONTH_ABBREVIATIONS[Number(month) - 1];
  if (monthName === undefined) {
    throw new RangeError(`dateAddedLabel received an impossible month: ${dateAdded}`);
  }

  // The day is un-padded ("2 Apr", not "02 Apr") to match `specs/api.md` §6.2.
  return `Added ${DATE_ADDED_LABEL_MARKER} ${Number(day)} ${monthName} ${year}`;
}
