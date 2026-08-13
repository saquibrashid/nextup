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
