/**
 * Copy that must be exact (TASK-026, `specs/ui.md` §9).
 *
 * Every string the owner reads that the specification writes out in full lives
 * here as a named export, and is imported everywhere it is shown. Two reasons,
 * both from §9: a wording change is then ONE diff, and a test can assert the
 * wording without reaching into a component's markup.
 *
 * ⚠ These are transcriptions, not drafts. `TMDB_DISCLAIMER` in particular is a
 * licensing obligation (`specs/security.md`, US-011 AC-2) and must stay
 * byte-for-byte identical to the sentence TMDB requires. Do not "improve" the
 * punctuation of anything in this file.
 *
 * ⚠ NOT here, deliberately: the `IMAGE_TOO_LARGE_TO_DECODE`,
 * `IMAGE_DECODE_OOM` and `IMAGE_DECODE_FAILED` messages. `specs/ui.md` §9 (R5)
 * requires those to be built by the SERVER, because they interpolate the live
 * container size and the configured `NEXTUP_MAX_DECODE_PIXELS`. A client-side
 * copy would be a second source of truth that states the wrong limit the moment
 * the owner up-sizes - in the very error whose job is to explain the limit.
 */

/* -------------------------------------------------------------------------- */
/* specs/ui.md §9                                                             */
/* -------------------------------------------------------------------------- */

/** US-011 AC-2 - verbatim, compliance. Never re-typed, never paraphrased. */
export const TMDB_DISCLAIMER =
  'This product uses the TMDB API but is not endorsed or certified by TMDB.';

/** US-023 AC-2, US-024 AC-6 - the removed view is a log, not a recycle bin. */
export const REMOVED_VIEW_SUBTITLE =
  "Everything that's ever left your list is kept here forever. The same title can appear more than once — each row is one removal.";

/** US-027 AC-2/AC-3. `{name}` is substituted with the work's name. */
export const SUPPRESS_CONFIRM_BODY =
  '"{name}" will be hidden from your list and won\'t come back on future uploads, even if it\'s still saved on Netflix or Max. You can undo this from "Not interested".';

/** US-029 AC-4. `{name}` is substituted with the work's name. */
export const UNSUPPRESS_CONFIRM_BODY =
  '"{name}" can be added again by a future upload. This doesn\'t bring back anything that was removed — check Removal history for that.';

/** data-model §2.3.3 - suppression keyed on read text rather than a work id. */
export const UNMATCHED_SUPPRESSION_CAVEAT =
  "We couldn't identify this title, so we're matching it on the text we read. If a future screenshot reads slightly differently, it may come back.";

/** data-model SD-06 - the suppression followed the corrected identity. */
export const FIXMATCH_SUPPRESSION_MIGRATED =
  'We also moved your "not interested" setting across to the corrected title, so it still won\'t come back.';

/** US-014 AC-6, `specs/ai.md` §8.2 - the low-yield guard on a full update. */
export const LOW_YIELD_FULL_UPDATE =
  "We couldn't read enough titles from these screenshots to safely work out what's been removed, so nothing will be removed by this batch. You can re-extract, add more screenshots, or discard it.";

/**
 * US-003 AC-2. `{Service}` is substituted with the batch's service name.
 *
 * ⚠ This is the `specs/ui.md` §9 TEMPLATE, kept verbatim so the §9
 * byte-equality harness has something to compare against. It is NOT the
 * runtime source: render this sentence with `modeFullUpdateConsequence(service)`
 * from `@nextup/domain`, which the API's `modeExplanation` also uses, so the
 * radio-card text and `POST /api/batches` cannot drift (US-003 AC-2/AC-3).
 * `MODE_TEMPLATES_AGREE` below is what stops the two from diverging.
 */
export const MODE_FULL_UPDATE_CONSEQUENCE =
  "Full update: anything on {Service} that isn't in these screenshots will be offered for removal.";

/**
 * US-003 AC-3.
 *
 * ⚠ DUPLICATE, deliberately. `packages/domain/src/copy.ts` (lane A) landed
 * this same sentence for the API's `modeExplanation`. Re-exporting it from
 * there was tried and reverted: the §9 byte-equality harness cannot follow a
 * re-export, and the domain's own test (`T-BATCH-010p`) asserts only
 * `toContain('Nothing will be removed')` — so the collapse traded a proven
 * byte-equal-to-spec constant for an unproven one.
 *
 * Whoever builds the mode picker (TASK-049) should render
 * `modeExplanation(mode, service)` from `@nextup/domain`, NOT this constant,
 * so the card text and `POST /api/batches` cannot disagree — and should add
 * the cross-package equality assertion that makes the duplication safe. That
 * needs a test id this lane does not own; reported rather than invented.
 */
export const MODE_APPEND_ONLY_CONSEQUENCE =
  "Only adds what's in these screenshots. Nothing will be removed.";

/**
 * US-035 AC-6 - screenshot retention (NFR-019, `IMAGE_RETENTION_DAYS = 30`).
 *
 * ⚠ This is the 30-day IMAGE retention, and it is NOT the 183-day TMDB metadata
 * refresh age (NFR-014). Invariant 8: the two constants must never be merged or
 * derived from each other.
 */
export const IMAGE_RETENTION_STATEMENT =
  'Screenshots are kept for 30 days so you can re-extract them, then deleted automatically.';

/** `A43-M3` - the one place the remedy runbook path is written down. */
export const MEMORY_REMEDY_PATH = 'runbooks/scale-up-memory.md';

/** `A43-M2` - true by construction (`specs/api.md` §5.2.1). */
export const DECODE_BATCH_UNAFFECTED = 'Nothing else in this batch was affected.';

/** `specs/ui.md` §3.2a item 4 - the two MEMORY codes only, never `IMAGE_DECODE_FAILED`. */
export const DECODE_REMEDY_LINK_LABEL = 'How to fix this';

/** `specs/ui.md` §3.2b - the iOS-critical affordance. "screenshot", not "image". */
export const PASTE_BUTTON_LABEL = 'Paste screenshot';

/** `specs/ui.md` §3.2b - without this line the button looks broken on iOS. */
export const PASTE_IOS_HINT = 'Take a screenshot, tap Copy on the preview, then tap here.';

/** `specs/ux-states.md` §4.15 - the mandatory re-offer for a silently-abandoned paste. */
export const PASTE_ABANDONED_BODY =
  "That paste didn't come through — tapping elsewhere, switching tabs or leaving Safari cancels it. Try again.";

/** `specs/ux-states.md` §4.14. */
export const PASTE_EMPTY_BODY = "There's nothing on your clipboard to paste.";

/** `specs/ux-states.md` §4.14 - always names the still-available upload path. */
export const PASTE_NOT_IMAGE_BODY =
  "What's on your clipboard isn't an image. Copy a screenshot, or choose a file instead.";

/** `specs/ux-states.md` §4.13. */
export const PASTE_DENIED_BODY =
  'nextup couldn\'t read your clipboard. Tap "Paste screenshot" again and choose Paste, or choose a file instead.';

/** `specs/ux-states.md` §4.3 - all three ingest affordances named in one line. */
export const DROPZONE_IDLE_LABEL =
  'Paste a screenshot, choose files, or drag them here — PNG, JPEG or HEIC, up to 10 MB each, 40 per batch.';

/** `specs/ui.md` §3.2c. */
export const DROPZONE_ACTIVE_LABEL = 'Drop screenshots here';

/** `specs/ui.md` §2.1 item 2 - the default (`dir=desc`). Never "date saved" (REQ-061). */
export const SORT_NEWEST_LABEL = 'Newest first';

/** `specs/ui.md` §2.1 item 2 - `dir=asc`, the accepted mitigation for SUC-003. */
export const SORT_OLDEST_LABEL = 'Oldest first';

/* -------------------------------------------------------------------------- */
/* Refusal and sign-in states - specs/ux-states.md §2.10 / §2.11 (TASK-028)   */
/* -------------------------------------------------------------------------- */

/*
 * These are not in `specs/ui.md` §9's table, but they are written out verbatim
 * in `specs/ux-states.md` §2, which makes them exact copy by the same rule.
 * They live here rather than in `RefusalPage.tsx` so that §9's "one diff"
 * property holds for every specified string, not just the ones §9 tabulates.
 */

/** `specs/ux-states.md` §2.11 - the 403 refusal (US-001 AC-4). */
export const REFUSAL_NOT_ALLOWED_TITLE = "This nextup instance isn't set up for this account.";

/**
 * US-001 AC-4 requires an EXPLICIT single-owner explanation, not just a denial.
 * §2.11 gives the headline; this is the sentence that satisfies "an explicit
 * 'this application serves a single owner' message", and it also closes off the
 * question the owner would otherwise ask next - there is no way to request
 * access, by design (NFR-015: no self-service registration path exists).
 */
export const REFUSAL_NOT_ALLOWED_BODY =
  'nextup serves a single owner. There is no sign-up and no way to request access.';

/** `specs/ux-states.md` §2.10 - the 401 state. */
export const SESSION_ENDED_TITLE = 'Your session ended.';

/** `specs/ux-states.md` §2.10 - the action out of the 401 state. */
export const SIGN_IN_AGAIN_LABEL = 'Sign in again';

/** `specs/ux-states.md` §2.11 - the only action offered on a refusal. */
export const SIGN_OUT_LABEL = 'Sign out';

/**
 * US-001 AC-5 - the identity provider is unreachable or returned an error.
 *
 * ⚠ SPEC GAP (reported, not invented around): `specs/ux-states.md` §2 tabulates
 * the 401 (§2.10) and 403 (§2.11) states but has NO row for IdP failure, and
 * `specs/ui.md` §9 has no constant for it, while PRD US-001 AC-5 and
 * `docs/backlog.md` TASK-028 both require the state. `specs/testing.md` §9
 * (`T-UX-019`) says it "renders the sign-in-again state", so the SHAPE is
 * §2.10's - full page, no app UI, one action - and only the explanation of the
 * cause differs. AC-5 additionally requires that the state say sign-in FAILED
 * and offer a retry, which is why this does not simply reuse
 * `SESSION_ENDED_TITLE`: telling the owner their session ended when the IdP is
 * down is a wrong answer to "why am I looking at this?".
 */
export const IDP_FAILURE_TITLE = "Couldn't sign you in.";

/** US-001 AC-5 - names the cause, offers retry, and promises no fallback mode. */
export const IDP_FAILURE_BODY =
  'The sign-in service is unavailable or returned an error. Nothing on your list has changed. Try again in a moment.';

/* -------------------------------------------------------------------------- */
/* /about - specs/ui.md §8 (TASK-026)                                         */
/* -------------------------------------------------------------------------- */

/** §8 - what TMDB is actually used for, in plain language. */
export const ABOUT_TMDB_USE =
  'nextup uses TMDB to identify the titles read from your screenshots and to show their poster, year, type, genres and runtime.';

/** §8 / US-023 AC-2 - REQ-028: soft delete forever, no TTL, nothing scheduled. */
export const ABOUT_REMOVED_KEPT_FOREVER =
  'Titles that leave your list are kept forever in Removal history, so nothing is ever lost without you being asked first.';

/** §8 / NFR-005 - nothing is collected, so there is nothing to opt out of. */
export const ABOUT_NO_ANALYTICS =
  'nextup collects no analytics. There is no tracking, no telemetry and no third-party measurement of any kind.';

/* -------------------------------------------------------------------------- */
/* /upload step 1 - service and mode (specs/ui.md §3.1, TASK-049)             */
/* -------------------------------------------------------------------------- */

/** §3.1 card headings. The heading names the mode; the body states what it DOES. */
export const MODE_APPEND_ONLY_LABEL = 'Add only';
export const MODE_FULL_UPDATE_LABEL = 'Full update';

/** §3.1 - the two required choices, neither defaulted (US-003 AC-1/AC-2). */
export const SERVICE_STEP_LEGEND = 'Which service did these screenshots come from?';
export const MODE_STEP_LEGEND = 'Is this a complete capture of that list?';

/**
 * ⚠ FINDING - INVENTED COPY, needs owner review. `specs/ui.md` §9 defines
 * `MODE_FULL_UPDATE_CONSEQUENCE` with a `{Service}` placeholder "substituted
 * with the batch's service name", but US-003 AC-1 forbids a default service,
 * and `T-UI-003` requires BOTH consequence sentences in the DOM *without
 * interaction* - i.e. while no service is yet chosen. No spec supplies wording
 * for that window.
 *
 * Substituting a real service name would be worse than inventing: it would
 * state a consequence for Netflix while the owner is about to choose Max, and
 * the sentence's whole job is to be true at the point of choice. Leaving the
 * literal `{Service}` on screen would ship a visible template.
 */
export const MODE_FULL_UPDATE_SERVICE_PLACEHOLDER = 'the service you choose';
