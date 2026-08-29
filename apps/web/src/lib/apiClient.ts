/**
 * TASK-175 — the single typed API client (`specs/ui.md` §12, ADR-0012).
 *
 * ⚠ THIS MODULE DID NOT EXIST, AND NOTHING FAILED. Every screen rendered
 * hardcoded placeholder state against a complete, working API, and all twelve
 * CI jobs stayed green throughout, because every web test injects props into a
 * component: that measures component correctness and says nothing whatever
 * about whether anything ever fetches. `T-DATA-002` is the assertion whose
 * absence made this invisible.
 *
 * Everything goes through `request`. The 401, 403, envelope-decoding and
 * no-retry rules are implemented exactly once here; implemented per screen
 * they would be subtly different on at least one of them (REQ-097).
 */

import type { BatchProvenance, ErrorCode, ReviewResponse } from '@nextup/domain';

import type { TitleListItem as WireTitleListItem } from '../components/TitleRow';
import type { ServiceFreshness as WireServiceFreshness } from '../components/FreshnessStrip';
import type { ServerRejection as WireServerRejection } from '../components/RejectionList';
import type { FixMatchRequest, FixMatchResponse } from '../components/FixMatchDialog';

/** The wire shape of a failure (`apps/api/src/middleware/errorEnvelope.ts`). */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode | string;
    message: string;
    details: Record<string, unknown>;
  };
}

/**
 * A failure the owner may be shown.
 *
 * ⚠ `message` is the SERVER's string, carried verbatim (REQ-104,
 * `T-DATA-010`). The client never re-words it and never keys a table of its
 * own on `code`: a second source of truth goes stale exactly where it hurts
 * most — it keeps quoting yesterday's decode limit in the very message whose
 * job is to state the limit after the owner up-sizes memory (§3.2a).
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: string, status: number, message: string, details: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * A 403 from the allow-list. Distinct from `ApiError` because the two are
 * different facts: *"nextup will not show you this"* versus *"nextup could not
 * reach the server"*. Merged, the owner is offered a retry that can never
 * succeed (`specs/ui.md` §12.2).
 */
export class RefusedError extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = 'RefusedError';
    this.details = details;
  }
}

/** Where an expired Easy Auth session is sent (`specs/ui.md` §12.3). */
export function signInUrl(currentPath: string): string {
  return `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(currentPath)}`;
}

/**
 * Seam for `T-DATA-004`: the redirect is a real navigation in the browser and
 * a recorded call in a test. Without it the assertion would have to stub
 * `window.location`, which jsdom does not allow cleanly.
 */
export interface ApiClientDeps {
  fetchImpl?: typeof fetch;
  onUnauthorized?: (url: string) => void;
  currentPath?: () => string;
}

function defaultRedirect(url: string): void {
  window.location.assign(url);
}

function defaultPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

async function readEnvelope(response: Response): Promise<ErrorEnvelope['error']> {
  try {
    const body = (await response.json()) as Partial<ErrorEnvelope>;
    const error = body.error;
    if (error && typeof error.message === 'string') {
      return {
        code: typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR',
        message: error.message,
        details: (error.details ?? {}) as Record<string, unknown>,
      };
    }
  } catch {
    // A non-JSON body on an error status is itself the failure; fall through.
  }
  // ⚠ Deliberately generic and deliberately NOT a per-code lookup. This is the
  // one case where the server supplied no text, so there is nothing verbatim
  // to render and §12.8 is not engaged.
  return {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Nothing was changed.',
    details: {},
  };
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** `| undefined` is required under `exactOptionalPropertyTypes`. */
  signal?: AbortSignal | undefined;
  formData?: FormData;
}

/**
 * The one place a request is made.
 *
 * ⚠ **`credentials: 'same-origin'` is not optional and is not decoration.**
 * Easy Auth is cookie-based and the SPA and API share one origin (ADR-0003).
 * Omit it and every call returns 401 — which, by the rule immediately below,
 * becomes a **redirect loop** rather than a visible error, so the app appears
 * to hang at sign-in rather than to fail. `T-DATA-003` asserts it across the
 * whole exported surface rather than on one sample call, because a single
 * hand-written method that forgets it produces exactly that symptom on exactly
 * one screen.
 *
 * ⚠ **There is no retry here, and none may be added** (REQ-100). Production is
 * one replica at 0.25 vCPU; an automatic retry turns a struggling container
 * into a harder-hit one, and turns one owner-visible failure into three.
 * Retry is the owner pressing the button (§12.4).
 */
async function request<T>(path: string, options: RequestOptions, deps: ApiClientDeps): Promise<T> {
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
  };

  if (options.signal) {
    init.signal = options.signal;
  }

  if (options.formData) {
    // No `Content-Type`: the browser must set the multipart boundary itself.
    init.body = options.formData;
  } else if (options.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }

  const response = await doFetch(path, init);

  if (response.status === 401) {
    // ⚠ NEVER an error screen. Easy Auth sessions expire on a timer, so a
    // correctly signed-in owner would be told their list could not be loaded
    // and offered a retry that fails identically forever, with nothing
    // pointing at the actual remedy. The path is preserved so a deep link
    // survives expiry (US-001 AC-2).
    const redirect = deps.onUnauthorized ?? defaultRedirect;
    redirect(signInUrl((deps.currentPath ?? defaultPath)()));
    // The caller must not render anything: this promise never resolves to a
    // value, and navigation is already under way.
    throw new ApiError('UNAUTHENTICATED', 401, 'Your session expired.', {});
  }

  if (!response.ok) {
    const envelope = await readEnvelope(response);
    if (response.status === 403) {
      throw new RefusedError(envelope.message, envelope.details);
    }
    throw new ApiError(envelope.code, response.status, envelope.message, envelope.details);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Wire types.
//
// ⚠ `TitleListItem` and `TitleBadge` are IMPORTED, not redeclared. The
// components already carry the canonical, precisely-typed versions
// (`matchState: 'matched' | 'unmatched'`, `readonly` throughout), and a second
// structurally-similar copy here would drift the first time the server adds a
// field — with both copies compiling perfectly. The import is type-only, so
// there is no runtime coupling from `lib/` to `components/`.
//
// The remaining types are declared here because the API projects those rows to
// `Record<string, unknown>` at the boundary and the SPA has no other statement
// of their shape.
// ---------------------------------------------------------------------------

export type { TitleBadge, TitleListItem } from '../components/TitleRow';
export type { ServiceFreshness } from '../components/FreshnessStrip';

export interface TitleListResponse {
  items: WireTitleListItem[];
  nextCursor: string | null;
  limit: number;
}

export interface ServiceStateResponse {
  services: WireServiceFreshness[];
}

/**
 * ⚠ The full §6.7 item, including `displaySnapshot`. That snapshot is FROZEN
 * at suppression time and the API deliberately never joins back to `Title`
 * (product invariant 1: suppression is keyed on work identity, and the row it
 * came from may no longer exist).
 */
export interface SuppressionItem {
  suppressionId: string;
  workIdentity: string;
  suppressedAt: string;
  /**
   * ⚠ The CLOSED pair the API actually sends (`specs/api.md` §6.7), not a
   * free string. It was `string` until TASK-104, and the cost was silent: the
   * component tests fixtured `'matched'` — a value no server can produce — so
   * "a matched identity shows no caveat" passed because ANY value other than
   * `'text-derived'` hides it. The assertion proved nothing about the
   * contract, and the real negative case (`'stable'`) was never exercised.
   */
  identityStability: 'stable' | 'text-derived';
  displaySnapshot: {
    name: string;
    releaseYear: number | null;
    mediaType: string | null;
    posterPath: string | null;
  };
  unsuppressHref: string;
}

export interface SuppressionsResponse {
  items: SuppressionItem[];
}

/**
 * One row of `GET /api/removed` (`specs/api.md` §6.9) — one **removal**, never
 * one work.
 *
 * ⚠ `removalOrdinal` / `removalTotalForWork` are why this cannot collapse to a
 * per-work shape. Product invariant 7: a reappearing title becomes a brand-new
 * row, so one work legitimately owns several removals over time and the log
 * must show all of them (`T-REM-006`, US-024 AC-6).
 *
 * ⚠ `name` is already resolved server-side (`tmdb_name ?? raw_extracted_text`),
 * so an UNMATCHED removal still has something to display. The client must not
 * re-derive it — there is no raw text in this DTO to fall back to.
 */
export interface RemovedItem {
  listingId: string;
  titleId: string;
  workIdentity: string;
  matchState: string;
  name: string;
  mediaType: string | null;
  releaseYear: number | null;
  posterPath: string | null;
  service: 'netflix' | 'max';
  /** `YYYY-MM-DD` — the ORIGINAL date added, preserved through removal. */
  dateAdded: string;
  /** A timestamp, not a date: two removals on one day stay distinguishable. */
  removedAt: string;
  removedByBatchId: string | null;
  removedByGroupId: string | null;
  removalOrdinal: number;
  removalTotalForWork: number;
  restorable: boolean;
  suppressed: boolean;
}

export interface RemovedResponse {
  items: RemovedItem[];
  nextCursor: string | null;
}

/**
 * `POST /api/listings/:listingId/restore` (`specs/api.md` §6.10, US-025).
 *
 * 200 means the listing is back to `active`.
 */
export interface RestoreResponse {
  listingId: string;
  titleId: string;
  state: string;
  dateAdded: string;
  titleState: string;
  sortDateAdded: string | null;
}

export interface MeResponse {
  ownerId: string;
  displayName: string | null;
  signOutUrl: string;
  attribution: unknown;
}

/**
 * One screenshot inside a batch (`specs/api.md` §6.15 `images[]`).
 *
 * ⚠ `href` is an **API path**, never a blob URL (NFR-020) — the container is
 * private and a direct storage URL would either 403 or, worse, leak a SAS.
 */
export interface BatchImage {
  imageId: string;
  fileName: string;
  ingestSource: string;
  available: boolean;
  retainUntil: string | null;
  candidateCount: number | null;
  href: string;
}

/**
 * `GET /api/batches/:batchId` (`specs/api.md` §6.15).
 *
 * ⚠ **`degradedExtraction` and `crossCheck` are NOT in the §6.15 shape as
 * written, and that is a spec gap, not an oversight here.** `ux-states.md`
 * §5.9/§5.10 require this page to render the degraded banner, and `T-UX-008`
 * asserts it, but the documented response carries nothing the client could
 * decide that from — the review response (§6.17) has both fields, this one
 * does not. They are declared optional so the page is correct the moment the
 * server sends them and merely silent until then; §6.15 needs the two fields
 * added. See TASK-059's ledger row.
 */
export interface BatchStatus {
  batchId: string;
  service: 'netflix' | 'max';
  mode: string;
  status: string;
  derivedFromBatchId: string | null;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  images: BatchImage[];
  extractionError: string | null;
  lowYield: boolean;
  /** Present only while `status` is `submitted` or `extracting` (US-006 AC-1). */
  progress?: { imagesDone: number; imagesTotal: number };
  degradedExtraction?: boolean;
  crossCheck?: 'ok' | 'llm-unavailable' | 'ocr-unavailable';
  /** What this batch did to the list (`ux-states.md` §9.4). */
  provenance: BatchProvenance;
  /**
   * ⚠ **SENT BY THE SERVER, NOT DERIVED HERE** (`ux-states.md` §9.5). The rule
   * is "all three arrays empty", and a second copy of it in the SPA is a
   * second place it can be got wrong — a batch that only *modified* something
   * would then be told it changed nothing.
   */
  changedNothing: boolean;
  /**
   * Names for every title the provenance arrays reference.
   *
   * ⚠ A LOOKUP ARRAY, not a field on each entry: §9.4 requires every entry to
   * link to its title, a ULID is not a name, and a title both created and
   * modified by one batch must not be carried twice.
   */
  titles: BatchTitleRef[];
}

/** One title named by a batch's provenance (`specs/api.md` §6.15 `titles[]`). */
export interface BatchTitleRef {
  titleId: string;
  name: string;
  year: number | null;
  /** The title's CURRENT state, so one since removed reads as such (US-033 AC-6). */
  state: string;
}

/**
 * One card in `/batches` (`specs/api.md` §6.15a).
 *
 * ⚠ `counts.created` counts **creations, not `batch_change` rows**. A new
 * title writes both a `title_created` and a `listing_added` row and §3.7 folds
 * them into one entry, so a card that summed both kinds would claim twice what
 * the detail page then lists — and both numbers would look plausible.
 */
export interface BatchHistoryItem {
  batchId: string;
  service: 'netflix' | 'max';
  mode: string;
  status: string;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  undoneAt: string | null;
  counts: { created: number; modified: number; removed: number };
}

export interface BatchHistoryResponse {
  batches: BatchHistoryItem[];
}

/**
 * `POST /api/batches/:batchId/images` (`specs/api.md` §6.12).
 *
 * ⚠ **`rejected[]` ARRIVES BY TWO DIFFERENT ROUTES AND BOTH MUST BE READ.**
 * Partial acceptance is a **201** carrying `rejected[]` in the body; a request
 * where *nothing* was accepted takes the first rejection's own **status** and
 * carries the same array in the error envelope's `details.rejected`. A client
 * that reads only the success body shows an empty rejection list on the one
 * case where every file failed — the case the owner most needs explained.
 */
export interface AddImagesResult {
  accepted: { imageId: string; fileName: string }[];
  /**
   * ⚠ The component's own type, imported rather than restated. A structurally
   * similar copy here would drift the first time a field is added, with both
   * copies compiling perfectly — the exact failure `TitleListItem` above is
   * imported to avoid.
   */
  rejected: WireServerRejection[];
  batchTotals: { imageCount: number; uploadedByteSize: number; storedByteSize: number };
}

export interface CreatedBatch {
  batchId: string;
  service: string;
  mode: string;
  status: string;
  createdAt: string;
}

/**
 * `POST /api/batches/:batchId/candidates/confirm-all` (`specs/api.md` §6.20).
 *
 * ⚠ `skipped` is not decoration. A press that reports `confirmed: 0` on a
 * section the owner has already worked through reads as a failure; the pair
 * is what distinguishes "nothing to do" from "nothing happened".
 */
export interface ConfirmAllResult {
  section: string;
  confirmed: number;
  skipped: number;
}

/**
 * One §6.29 search hit. The panel renders these and sends back only the id.
 *
 * ⚠ `mediaType` IS NARROWED TO THE CONTRACT, not typed `string`. §6.29 emits
 * only `movie` or `tv` — `tmdbClient.ts` drops any row whose `media_type` is
 * neither (TMDB's search also returns `person`) — so `string` here was wider
 * than anything the server can send, and the extra width had a cost: it made
 * this type structurally incompatible with `FixMatchDialog`'s, which is one
 * reason the dialog could not simply be handed the client's search method.
 */
export interface TmdbSearchResult {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
}

export interface TmdbSearchResults {
  items: TmdbSearchResult[];
}

/** §6.20 — what the server wrote for a manual entry. */
export interface ManualEntryResult {
  candidateId: string;
  resolvedWorkIdentity: string;
  disposition: string;
}

/**
 * §6.18 — the candidate as it stands after a patch.
 *
 * ⚠ `resolvedWorkIdentity` COMES BACK because a correction re-resolves it
 * immediately (US-007 AC-3): the review pass must show the corrected match
 * before close, and the only alternative is for the client to guess the
 * identity grammar, which would be a second implementation of `workIdentity`.
 */
export interface PatchedCandidate {
  candidateId: string;
  rawText: string;
  inferredTitle: string | null;
  verdict: string;
  resolvedWorkIdentity: string | null;
  correctedToTmdbId: number | null;
  disposition: string;
}

/** The §6.18 body forms, exactly as the spec enumerates them. */
export type CandidatePatchBody =
  | { disposition: 'confirmed' | 'discarded' | 'pending' }
  | { disposition: 'corrected'; tmdbId: number; mediaType: string; confirmDuplicate?: boolean }
  | { reclassifyAsTitle: true };

export interface ImdbLookupResponse {
  name: string;
  releaseYear: number | null;
  mediaType: string;
  imdbRating: number | null;
  inList: boolean;
}

/**
 * Builds the client.
 *
 * ⚠ Every method here goes through `request`, and `T-DATA-003` enumerates
 * this object rather than testing a sample, so a method added later that calls
 * `fetch` on its own fails the gate instead of shipping a silent 401 loop.
 */
export function createApiClient(deps: ApiClientDeps = {}) {
  return {
    getMe: (signal?: AbortSignal) => request<MeResponse>('/api/me', { signal }, deps),

    getTitles: (query: string, signal?: AbortSignal) =>
      request<TitleListResponse>(`/api/titles${query ? `?${query}` : ''}`, { signal }, deps),

    getTitle: (titleId: string, signal?: AbortSignal) =>
      request<WireTitleListItem>(`/api/titles/${encodeURIComponent(titleId)}`, { signal }, deps),

    getServiceState: (signal?: AbortSignal) =>
      request<ServiceStateResponse>('/api/service-state', { signal }, deps),

    getSuppressions: (signal?: AbortSignal) =>
      request<SuppressionsResponse>('/api/suppressions', { signal }, deps),

    suppressTitle: (titleId: string, reason?: string) =>
      request<{ suppressionId: string; workIdentity: string; alreadySuppressed: boolean }>(
        `/api/titles/${encodeURIComponent(titleId)}/suppress`,
        { method: 'POST', body: reason === undefined ? {} : { reason } },
        deps,
      ),

    unsuppress: (suppressionId: string) =>
      request<{ suppressionId: string; active: boolean; restoredAnything: boolean }>(
        `/api/suppressions/${encodeURIComponent(suppressionId)}/unsuppress`,
        { method: 'POST', body: {} },
        deps,
      ),

    createBatch: (service: string, mode: string) =>
      request<CreatedBatch>('/api/batches', { method: 'POST', body: { service, mode } }, deps),

    /** §6.15a — the batch history `/batches` renders. */
    listBatches: (signal?: AbortSignal) =>
      request<BatchHistoryResponse>('/api/batches', { signal }, deps),

    /**
     * §6.15 — the batch the status page polls.
     *
     * ⚠ **THIS ENDPOINT WAS MISSING FROM THE API FOR THE WHOLE OF TASK-059'S
     * LIFE, AND EVERY POLL ANSWERED 404.** §6.15 was written,
     * `BatchStatusPage` rendered it and `T-UX-007`/`T-UX-008` asserted the
     * render, but no route served it and no backlog row owned it — so US-006
     * AC-1 could not complete and the status screen sat in its load-failure
     * state forever. TASK-076 built the route; `T-API-010` now compares this
     * file's own paths against the live router on every CI run, so the next
     * one fails the build instead of shipping.
     */
    getBatch: (batchId: string, signal?: AbortSignal) =>
      request<BatchStatus>(`/api/batches/${encodeURIComponent(batchId)}`, { signal }, deps),

    /** §6.17 — the review pass. */
    getReview: (batchId: string, signal?: AbortSignal) =>
      request<ReviewResponse>(
        `/api/batches/${encodeURIComponent(batchId)}/review`,
        { signal },
        deps,
      ),

    /**
     * §6.19 — bulk confirm. The section is sent verbatim; the client does not
     * enumerate candidate ids, because a per-row loop would be N requests
     * against a single 0.25 vCPU replica and would half-apply on the first
     * failure.
     */
    confirmAllCandidates: (batchId: string, section: string) =>
      request<ConfirmAllResult>(
        `/api/batches/${encodeURIComponent(batchId)}/candidates/confirm-all`,
        { method: 'POST', body: { section } },
        deps,
      ),

    /**
     * §6.18 — one candidate's disposition, or a correction.
     *
     * ⚠ ONE CANDIDATE PER CALL, and that is not an oversight: §6.19 exists for
     * the bulk case. The §6.8 unmatched actions each concern exactly the card
     * the owner is looking at, and a batched variant would have to decide what
     * to do when the third of five is refused — which is precisely the
     * half-applied state REQ-014 forbids.
     */
    patchCandidate: (batchId: string, candidateId: string, body: CandidatePatchBody) =>
      request<PatchedCandidate>(
        `/api/batches/${encodeURIComponent(batchId)}/candidates/${encodeURIComponent(candidateId)}`,
        { method: 'PATCH', body },
        deps,
      ),

    /**
     * §6.29 — TMDB search. The ONLY search the manual-entry panel has: there
     * is no local catalogue and US-007 AC-6 forbids building one.
     */
    searchTmdb: (query: string, signal?: AbortSignal) =>
      request<TmdbSearchResults>(
        `/api/tmdb/search?q=${encodeURIComponent(query)}`,
        { signal },
        deps,
      ),

    /**
     * §6.5 — the owner re-points a row at the correct work (US-030).
     *
     * ⚠ THIS METHOD IS THE LINK THAT WAS MISSING, AND ITS ABSENCE WAS
     * INVISIBLE TO EVERY GATE. The route (TASK-109) and `FixMatchDialog`
     * (TASK-111) were both built and both tested, but nothing joined them, so
     * US-030 AC-1 — "the owner chooses fix match ... from the row" — had no
     * reachable implementation at all. `T-API-010` compares the client's paths
     * against the live router in one direction only (client → server), by
     * design, so a route the client never calls is asserted by nobody.
     *
     * ⚠ `confirmDuplicate` IS ALWAYS SENT EXPLICITLY, never omitted. §6.5
     * refuses with `DUPLICATE_WORK_IDENTITY` unless it is exactly `true`, and
     * the dialog's "Yes, keep both" step is the only thing allowed to set it —
     * defaulting it here would turn the warning US-030 AC-4 requires into a
     * silent second row.
     */
    fixMatch: (titleId: string, body: FixMatchRequest) =>
      request<FixMatchResponse>(
        `/api/titles/${encodeURIComponent(titleId)}/fix-match`,
        { method: 'POST', body: { ...body } },
        deps,
      ),

    /**
     * §6.20 — manual entry (US-006 AC-5): a work the reader never saw, added
     * to this batch by hand.
     *
     * ⚠ Sends the TMDB **id**, never the name. The name shown in the panel
     * came from TMDB and goes back to TMDB's own record at the server; sending
     * it would make the client's rendering of a work part of that work's
     * identity, which SD-05 forbids.
     */
    addManualEntry: (batchId: string, tmdbId: number, mediaType: string) =>
      request<ManualEntryResult>(
        `/api/batches/${encodeURIComponent(batchId)}/manual-entry`,
        { method: 'POST', body: { tmdbId, mediaType } },
        deps,
      ),

    /**
     * §6.21 — applies the batch.
     *
     * ⚠ `confirmRemovals` is carried through unchanged and is `true` only when
     * the owner has been through the removal dialog. The server reads it
     * strictly, so a client that always sent `true` would turn REQ-020's group
     * confirmation into a formality.
     */
    closeBatch: (batchId: string, confirmRemovals: boolean) =>
      request<unknown>(
        `/api/batches/${encodeURIComponent(batchId)}/close`,
        { method: 'POST', body: { confirmRemovals } },
        deps,
      ),

    addBatchImages: (batchId: string, formData: FormData) =>
      request<AddImagesResult>(
        `/api/batches/${encodeURIComponent(batchId)}/images`,
        { method: 'POST', formData },
        deps,
      ),

    removeBatchImage: (batchId: string, imageId: string) =>
      request<unknown>(
        `/api/batches/${encodeURIComponent(batchId)}/images/${encodeURIComponent(imageId)}`,
        { method: 'DELETE' },
        deps,
      ),

    submitBatch: (batchId: string) =>
      request<unknown>(
        `/api/batches/${encodeURIComponent(batchId)}/submit`,
        { method: 'POST', body: {} },
        deps,
      ),

    discardBatch: (batchId: string) =>
      request<unknown>(
        `/api/batches/${encodeURIComponent(batchId)}/discard`,
        { method: 'POST', body: {} },
        deps,
      ),

    /**
     * §6.25 — reverses a creates-only batch. 409 `BATCH_NOT_CREATES_ONLY` for
     * anything else, which is why `undoOffer` in `BatchAppliedNotice` never
     * points here for a batch that removed something.
     */
    undoBatch: (batchId: string) =>
      request<unknown>(
        `/api/batches/${encodeURIComponent(batchId)}/undo`,
        { method: 'POST', body: {} },
        deps,
      ),

    /** §6.26 — puts a confirmed removal group's listings back. */
    undoRemovalGroup: (groupId: string) =>
      request<unknown>(
        `/api/removal-groups/${encodeURIComponent(groupId)}/undo`,
        { method: 'POST', body: {} },
        deps,
      ),

    /**
     * §6.9 — the removed view, the historical LOG of removals.
     *
     * ⚠ `query` is the already-encoded search string, matching `getTitles`.
     * ⚠ **A FAILED READ HERE MUST NEVER DEGRADE TO AN EMPTY LIST.** An empty
     * removed view reads as *"nothing has ever been removed"*, which is the
     * one sentence this screen must never say falsely — the removed view is
     * how the owner sees that nothing was lost (product invariant 7, REQ-028).
     */
    getRemoved: (query: string, signal?: AbortSignal) =>
      request<RemovedResponse>(`/api/removed${query ? `?${query}` : ''}`, { signal }, deps),

    /** §6.10 — restore one removed listing back to active. */
    restoreListing: (listingId: string, opts: { confirmDuplicate?: boolean } = {}) =>
      request<RestoreResponse>(
        `/api/listings/${encodeURIComponent(listingId)}/restore`,
        { method: 'POST', body: { confirmDuplicate: opts.confirmDuplicate ?? false } },
        deps,
      ),

    /**
     * ⚠ **404 is a RESULT, not a failure**, and that distinction lives here so
     * it has exactly one implementation. It means "TMDB knows of no such
     * title"; reported as an error it would tell the owner nextup broke when
     * in fact nextup answered. `null` is the answer.
     */
    lookupImdb: async (q: string, signal?: AbortSignal) => {
      try {
        return await request<ImdbLookupResponse>(
          `/api/imdb/lookup?q=${encodeURIComponent(q)}`,
          { signal },
          deps,
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** The instance the app uses. Tests build their own with injected deps. */
export const apiClient: ApiClient = createApiClient();
