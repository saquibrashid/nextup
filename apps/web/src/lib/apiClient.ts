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

import type { ErrorCode } from '@nextup/domain';

import type { TitleListItem as WireTitleListItem } from '../components/TitleRow';
import type { ServiceFreshness as WireServiceFreshness } from '../components/FreshnessStrip';

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

export interface MeResponse {
  ownerId: string;
  displayName: string | null;
  signOutUrl: string;
  attribution: unknown;
}

export interface CreatedBatch {
  batchId: string;
  service: string;
  mode: string;
  status: string;
  createdAt: string;
}

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

    addBatchImages: (batchId: string, formData: FormData) =>
      request<unknown>(
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
