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

/**
 * US-011 AC-2 - verbatim, compliance. Never re-typed, never paraphrased.
 *
 * ⚠ RE-EXPORTED, NOT DEFINED HERE. `packages/domain/src/attribution.ts` is the
 * one source: the API serves that constant as `attribution.tmdbDisclaimer`
 * (`GET /api/me`, `specs/api.md` §6.1) and `T-ATTR-001` asserts the constant,
 * the API value and the rendered DOM text are all byte-equal. A second literal
 * here would satisfy that chain today and diverge the first time either side is
 * reworded - which is exactly the failure the chain exists to prevent, and it
 * is invisible from inside the product.
 *
 * ⚠ Unlike `MODE_APPEND_ONLY_CONSEQUENCE` below, which is deliberately NOT
 * collapsed. The difference is what guards each one: this sentence is pinned to
 * TMDB's required wording by `T-ATTR-001` at three layers, whereas the domain's
 * mode copy is guarded only by a `toContain`, so re-exporting that one would
 * trade a constant proven byte-equal to `specs/ui.md` §9 for one that is not.
 */
export { TMDB_DISCLAIMER } from '@nextup/domain';

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

/**
 * `specs/ui.md` §3.2 - the client-side rejection message for a file that is
 * not one of the three accepted formats. `T-UI-004` asserts it enumerates PNG,
 * JPEG **and** HEIC, so a refused owner knows what is allowed.
 *
 * Quoted from §3.2's prose rather than §9's table (§9 has no row for it), so
 * this is the spec's own wording, not invented copy.
 */
/**
 * `specs/ui.md` §3.2 - a folder dragged onto the drop target.
 *
 * The spec requires the folder be refused "by name" (`T-PASTE-004`) — the
 * `{name}` placeholder is substituted at the call site with the entry name
 * that `webkitGetAsEntry().name` provides, or the `File.name` fallback when
 * the DataTransferItem API is unavailable.
 *
 * ⚠ FINDING - exact wording is not in `specs/ui.md` §9's table. The constant
 * is required for `T-PASTE-004` but the spec only says "refused by name" in
 * prose at §3.2. Using the nearest-matching pattern from `UNSUPPORTED_FORMAT_REJECTION`.
 */
export const FOLDER_REJECTION =
  'That\u2019s a folder, not a screenshot \u2014 nextup can\u2019t open it. Try selecting the files inside instead.';

export const UNSUPPORTED_FORMAT_REJECTION =
  "That file isn't a screenshot nextup can read — attach a PNG, JPEG or HEIC image.";

/**
 * `specs/ui.md` §3.2 - the file input's `accept`.
 *
 * ⚠ ALL THREE FORMATS, AND THE EXTENSIONS AS WELL AS THE MIME TYPES (product
 * invariant 11). iOS screenshots are PNG, iOS camera photos default to HEIC and
 * "Most Compatible" gives JPEG; without HEIC here the iOS picker greys out the
 * owner's own photos and it looks like a broken phone, not a missing format.
 * The extension aliases matter because iOS frequently reports HEIC with an
 * empty or `application/octet-stream` type.
 *
 * A convenience filter only - the server's magic-byte sniff is authoritative.
 */
export const IMAGE_ACCEPT_ATTRIBUTE = 'image/png,image/jpeg,image/heic,image/heif,.heic,.heif';

/** `specs/ui.md` §3.2 - the file-selection affordance, never a fallback. */
export const CHOOSE_FILES_LABEL = 'Choose files';

/**
 * `specs/ui.md` §3.2 - a selected HEIC/HEIF tile.
 *
 * Only Safari renders HEIC in an `<img>`, so every other browser would show a
 * broken image. The placeholder states the format and promises the preview
 * rather than failing silently.
 */
export const HEIC_PREVIEW_PLACEHOLDER = 'HEIC — preview after upload';

/**
 * `specs/ui.md` §2.1 - the freshness strip when the dates cannot be computed
 * (`T-FRESH-014`).
 *
 * ⚠ FINDING - INVENTED COPY, PENDING OWNER REVIEW. `T-FRESH-014` requires the
 * strip to "degrade visibly", but no spec supplies the wording: `specs/ui.md`
 * §9 has no constant for it and `specs/ux-states.md` §2 has no row for it.
 *
 * Worded as an admission about nextup, not a statement about the owner's list:
 * "unavailable right now" cannot be misread as "you have never updated this"
 * (the US-022 AC-3 misreading `T-FRESH-012` exists to prevent) and carries no
 * instruction to go and capture anything, which `A46` forbids.
 */
export const FRESHNESS_UNAVAILABLE = 'Last updated dates are unavailable right now.';

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

/**
 * The combined list's filter bar and its empty/error states
 * (`specs/ux-states.md` §2.3/§2.4/§2.5/§2.9, `specs/ui.md` §2.1 item 2).
 *
 * ⚠ THESE THREE "NOTHING TO SHOW" MESSAGES ARE NOT INTERCHANGEABLE (US-019
 * AC-5, `ux-states.md` §2.4). `LIST_EMPTY_NEVER_UPLOADED_TITLE` is a
 * first-run fact, `ZERO_MATCH_TITLE` is a filter hiding rows that still
 * exist, and `LIST_EMPTY_ALL_GONE_TITLE` is a list whose every title was
 * removed or suppressed - each with a different way out. Showing the first
 * when the truth is either of the others reads as data loss.
 *
 * ⚠ `ui.md` §9 has NO ROWS for any of these. They are transcribed from the
 * `ux-states.md` §2 prose, which writes each of them out in full; the §9
 * table is missing them. Reported as a spec defect rather than drafted.
 */
export const CLEAR_FILTERS_LABEL = 'Clear filters';
export const ZERO_MATCH_TITLE = 'No titles match these filters.';
export const LIST_EMPTY_NEVER_UPLOADED_TITLE = 'Nothing here yet.';
export const LIST_EMPTY_NEVER_UPLOADED_BODY =
  'Upload screenshots of your saved lists on Netflix or Max and nextup will build one combined list.';
export const UPLOAD_SCREENSHOTS_LABEL = 'Upload screenshots';
export const LIST_EMPTY_ALL_GONE_TITLE = 'Nothing on your list right now.';

/**
 * ⚠ "Nothing has changed" is the load-bearing half of this sentence
 * (`ux-states.md` §2.9). A failed read must not leave the owner wondering
 * whether their list was lost - the whole product promise is that nothing
 * disappears without being asked. `Retry` is offered because the fetch is
 * safe to repeat; nothing was written.
 */
export const LIST_LOAD_FAILED_BODY = "Couldn't load your list. Nothing has changed.";
export const RETRY_LABEL = 'Retry';

/**
 * The initial read, before an answer has arrived (`ux-states.md` §2.1).
 *
 * ⚠ THIS EXISTS TO PREVENT A FALSE EMPTY STATE. Without a loading state the
 * container renders zero rows for the duration of the request, and
 * `listEmptyKind` reads zero rows with no filters as **"Nothing here yet"** —
 * the never-uploaded message — on every single page load, for an owner whose
 * list is full. That is precisely the data-loss reading US-019 AC-5 forbids,
 * and it would flash on the way to the correct list rather than fail outright.
 *
 * ⚠ The skeletons and the 1200 ms `SlowResponseNotice` that §2.1 also
 * specifies are NOT built here; they are their own task (`T-UX-001`,
 * `T-UX-010`). This is the honest minimum that keeps the empty state truthful.
 */
export const LIST_LOADING_BODY = 'Loading your list…';

/* -------------------------------------------------------------------------- */
/* Epic M — IMDb ratings (REQ-088…REQ-092, ADR-0011)                           */
/* -------------------------------------------------------------------------- */

/**
 * ⚠ TRANSCRIBED FROM `specs/ui.md` §9, like every other constant in this file.
 * These were drafted here first, while Epic M was specified at the ADR and REQ
 * level only; §9 and §7a now carry them, so the spec is the source of truth
 * and a change belongs there first.
 *
 * The one constraint that is not a wording choice is `IMDB_RATING_ABSENT`:
 * REQ-091 makes "no rating" a rendered state and forbids `0`, `0.0` and an
 * empty star row, so this string may be reworded but may not become blank.
 */
export const IMDB_RATING_SOURCE = 'IMDb';
export const IMDB_RATING_ABSENT = 'No IMDb rating';

/** The §6.31 lookup surface (REQ-092, US-045). */
export const IMDB_LOOKUP_TITLE = 'Check a rating';
export const IMDB_LOOKUP_BODY =
  'Look up any film or series to see its IMDb rating. Nothing is added to your list.';
export const IMDB_LOOKUP_INPUT_LABEL = 'Film or series name';
export const IMDB_LOOKUP_SUBMIT_LABEL = 'Look it up';
export const IMDB_LOOKUP_NOT_FOUND = "Couldn't find that title.";
export const IMDB_LOOKUP_FAILED = "Couldn't run that lookup. Nothing has changed.";
export const IMDB_LOOKUP_IN_LIST = 'Already on your list.';

/*
 * ── The review pass (`specs/ui.md` §5.3/§5.3a, TASK-069) ──────────────────
 *
 * ⚠ THE SIX CHIP LABELS ARE QUOTED FROM `specs/ui.md` §5.3/§5.3a, NOT
 * PARAPHRASED. Two of them - `CANDIDATE_INFERRED_CHIP` and
 * `CANDIDATE_UNREADABLE_CHIP` - are the review-side half of the RSK-028
 * (fabrication) mitigation, and a softer rewording is a real reduction in the
 * safeguard rather than a copy edit.
 */

export const CANDIDATE_LOW_CONFIDENCE_CHIP = 'Low confidence';
export const CANDIDATE_UNCERTAIN_CHIP = 'Uncertain match';
export const CANDIDATE_AMBIGUOUS_CHIP = 'Could be more than one work';
export const CANDIDATE_INFERRED_CHIP = 'Read from the artwork \u2014 check this';
export const CANDIDATE_UNREADABLE_CHIP = "Couldn't read this one";
export const CANDIDATE_OCR_ONLY_CHIP = 'The text reader saw this, the tile reader did not';

/**
 * ⚠ A NAMED STATE, NOT A BLANK LINE. An unreadable tile has no proposed title
 * by definition (§5.3a), and rendering nothing there is indistinguishable from
 * a card that failed to load - so the owner is told which it is.
 */
export const CANDIDATE_UNREADABLE_NO_TITLE = 'No title read from this tile';

/**
 * `T-UX-061`. ⚠ **NOT A BLANK PANEL.** Zero additions in a batch the owner
 * just uploaded is the moment they most need to be told that nextup read the
 * screenshots and found nothing new - an empty area reads as a failed render,
 * and the owner's next move is to upload the same screenshots again.
 */
export const REVIEW_NO_ADDITIONS_TITLE = 'Nothing new in these screenshots';
export const REVIEW_NO_ADDITIONS_BODY =
  'Everything nextup could read is already on your list. Nothing has been added.';

/** §5.1 - the sticky action bar's running counts. */
export const REVIEW_APPLY_LABEL = 'Apply changes';
export const REVIEW_DISCARD_LABEL = 'Discard batch';

export const REVIEW_TITLE = 'Review this batch';

/**
 * SD-11a, quoted from the `specs/ui.md` §5.2 wireframe (`[Confirm all 9]`).
 * `{n}` is the number of STILL-PENDING candidates in the section, not the
 * section's total — see `CandidateSection` for why that distinction matters.
 */
export const REVIEW_CONFIRM_ALL = 'Confirm all {n}';
export const REVIEW_LOADING = 'Reading this batch…';
export const REVIEW_LOAD_FAILED = "Couldn't load this review. Nothing has changed.";
export const REVIEW_RETRY_LABEL = 'Try again';

/**
 * ⚠ A SECTION THAT APPLIES BUT IS EMPTY SAYS SO. `count: 0` means "we looked
 * and there was nothing"; `omitted` means "this question does not apply to
 * this mode" and renders no section at all. An empty `<details>` body would
 * make the two indistinguishable to the owner.
 */
export const REVIEW_SECTION_EMPTY = 'Nothing in this group.';

/* ------------------------------------ §6.10/§6.11 removal confirmation -- */

/**
 * ⚠ QUOTED FROM `ux-states.md` §6.10, not paraphrased. This is the last thing
 * the owner reads before listings leave their list, and the promise it makes —
 * that nothing is destroyed — is REQ-028's soft-delete guarantee stated to the
 * person relying on it.
 */
export const REMOVAL_CONFIRM_REASSURANCE =
  'They\u2019ll be kept in Removal history and you can restore them any time.';

/**
 * ⚠ §6.11, and it is a CONFIRMABLE state, not an error. Unticking every
 * removal is a supported outcome (US-015 AC-5): the owner made a decision,
 * the close proceeds, and a zero-member group is recorded.
 */
export const REMOVAL_CONFIRM_NONE = 'No removals selected. Nothing will be removed.';

export const REMOVAL_CONFIRM_LABEL = 'Confirm';
export const REMOVAL_CANCEL_LABEL = 'Cancel';

/* ------------------------------------------- §7 removal history (log) --- */

/**
 * ux-states.md §7.2 - nothing has EVER been removed.
 *
 * WARNING: This is not interchangeable with REMOVED_NO_MATCHES (§7.3). "You
 * have no removal history" and "your search matched none of your removal
 * history" are different facts, and collapsing them tells an owner who
 * mistyped a search that the log they are relying on is empty - which is the
 * one thing REQ-028 promises can never happen.
 */
export const REMOVED_EMPTY_TITLE = 'Nothing has been removed yet.';
export const REMOVED_EMPTY_BODY = 'When a title leaves your list, it\u2019s kept here forever.';

/** ux-states.md §7.3. `{q}` is substituted with the owner's search text. */
export const REMOVED_NO_MATCHES = 'No removals match \u201c{q}\u201d.';
export const REMOVED_CLEAR_SEARCH_LABEL = 'Clear search';

/**
 * US-024 AC-8. A load failure must render an ERROR, never an empty view: an
 * empty removal log reads as "nothing was ever removed", which would be a lie
 * told by a network error.
 */
export const REMOVED_LOAD_ERROR = 'Couldn\u2019t load your removal history. Nothing has changed.';
export const REMOVED_LOADING = 'Loading your removal history\u2026';

/* ------------------------- §5 `/batches/:batchId` extraction status ------ */

/**
 * ⚠ QUOTED VERBATIM from `ux-states.md` §5.1/§5.2. `{done}` and `{total}` are
 * substituted; the strings are not reassembled from fragments, because the
 * two states differ in tense and in punctuation ("Queued — 0 of 7 screenshots
 * read." vs "Reading 4 of 7…") and a shared template would flatten both.
 *
 * ⚠ This screen is visible for MINUTES, not milliseconds (`ADR-0001` — LLM
 * vision latency). It is a primary surface with real content, not a spinner;
 * `T-UX-007` exists because treating it as a spinner is the likely mistake.
 */
export const STATUS_QUEUED = 'Queued \u2014 {done} of {total} screenshots read.';
export const STATUS_RUNNING = 'Reading {done} of {total}\u2026';

/**
 * §5.3 — some images yielded nothing. US-006 AC-3 requires the image to be
 * **named and thumbnailed**, not merely counted: "1 of 7 found no text" is
 * unactionable, whereas naming the file tells the owner which screenshot to
 * retake.
 */
export const STATUS_ZERO_YIELD = 'No text was found in {count} of {total} screenshots';

/**
 * §5.5 — `EXTRACTOR_ERROR`. ⚠ The reassurance is half the message: the owner's
 * fear at an extraction failure is that their list was damaged, and both
 * clauses ("Nothing has changed", "your screenshots are safe") answer it.
 */
export const STATUS_ERROR_EXTRACTOR =
  'Couldn\u2019t read your screenshots. Nothing has changed and your screenshots are safe.';

/** §5.6 — `EXTRACTOR_UNAVAILABLE`. Transient: retry is the ONLY action. */
export const STATUS_ERROR_UNAVAILABLE =
  'The text-reading service is busy. Nothing has changed. Try again in a few minutes.';

/**
 * §5.7 — `IMAGES_PURGED`. ⚠ Retry is NOT offered, and that omission is the
 * point: the images are gone under NFR-019's 30-day lifecycle purge, so a
 * "Try again" here would fail forever. The only move is new screenshots.
 */
export const STATUS_ERROR_PURGED =
  'These screenshots were deleted 30 days after upload, so they can\u2019t be read again.';
export const STATUS_PURGED_ACTION_LABEL = 'Upload new screenshots';

/** §5.8 — offline. Polling PAUSES; no error is invented from a lost network. */
export const STATUS_OFFLINE = 'You\u2019re offline. This will keep updating when you reconnect.';

export const STATUS_DISCARD_LABEL = 'Discard';
export const STATUS_DISCARD_BATCH_LABEL = 'Discard batch';
export const STATUS_RETRY_LABEL = 'Try again';
export const STATUS_CONTINUE_LABEL = 'Continue to review';

/** Not in §5 — a heading is required and §5 specifies none. Invented here. */
export const STATUS_TITLE = 'Reading your screenshots';

/**
 * `specs/ai.md` §8.2, verbatim — the review pass NAMES every image that
 * yielded nothing. `{file}` is the file name.
 *
 * ⚠ "Never a silent skip." An image the extractor read and found nothing in
 * is not an absence of news: in full-update mode its titles are missing from
 * the read, and the owner needs to know which screenshot to retake before
 * they confirm anything.
 */
export const REVIEW_NO_TEXT_IN = 'No text was found in {file}.';
