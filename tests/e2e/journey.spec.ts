import { expect, test, type Page, type Route } from '@playwright/test';
import {
  REVIEW_LABELS,
  SERVICE_LABELS,
  dateAddedLabel,
  modeExplanation,
  removalsLabel,
  serviceFreshnessLabel,
  type BatchMode,
  type ReviewCandidate,
  type ReviewRemovalItem,
  type ReviewResponse,
  type Service,
} from '@nextup/domain';

import { REMOVAL_CONFIRM_LABEL, REVIEW_APPLY_LABEL, SUBMIT_LABEL } from '../../apps/web/src/copy';
// ⚠ TYPE-ONLY, and that is load-bearing (Part 2). These are the SPA's own
// statement of the response contracts; annotating the stub's builders with them
// turns a server-side shape change into a typecheck failure in THIS file rather
// than a silent pass against a fiction. `import type` is fully erased by
// Playwright's esbuild loader, so there is no runtime coupling and no second
// server — exactly the boundary Part 2 point 3 draws. See `tsconfig.json` beside
// this file for how the alarm is actually run.
import type {
  AddImagesResult,
  BatchStatus,
  CloseBatchResult,
  ConfirmAllResult,
  CreatedBatch,
  MeResponse,
  RemovedItem,
  RemovedResponse,
  ServiceFreshness,
  ServiceStateResponse,
  SuppressionItem,
  SuppressionsResponse,
  TitleListItem,
  TitleListResponse,
} from '../../apps/web/src/lib/apiClient';

/**
 * `T-E2E-001` — the single most valuable test in the suite (`specs/testing.md`
 * §5, L545). It is not a smoke test; it is the product's specification
 * executed end to end against the real SPA, with the API replaced by a
 * STATEFUL in-memory backend that reconciles exactly as the server contract
 * (`specs/api.md` §6, `packages/domain` reconcile/review/removals) requires.
 *
 * The journey drives steps 1–7 of §5:
 *   1–4  Upload, extract, match, review and apply a first Netflix full update.
 *   5    A second full update that REMOVES a title and ADDS another —
 *        transactional, scoped to one service, removals shown ticked, the
 *        removed title logged with its ORIGINAL date preserved.
 *   6    Suppress ("not interested") a remaining title — it leaves the list
 *        and appears under /not-interested, keyed on WORK IDENTITY.
 *   7    A third, APPEND-ONLY batch in which the removed title REAPPEARS as a
 *        brand-new active row dated today (the removed-log row is untouched),
 *        while the suppressed title is silently kept off — proving suppression
 *        survives a reappearance because it is keyed on identity, not row id.
 *
 * ⚠ The stub is the backend, not a canned reply. Every review/close/list read
 * is computed from mutable state, so an assertion that would pass under a
 * row-id-keyed suppression, or a non-transactional close, genuinely fails.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE PROVES, AND WHAT IT ONLY *EXERCISES* — READ BEFORE TRUSTING IT
 * ───────────────────────────────────────────────────────────────────────────
 *
 * ⚠ A stateful stub is a SECOND IMPLEMENTATION of the server. Every behaviour
 * that only the stub enforces is a place where this e2e can stay GREEN while
 * the real API is BROKEN. That is not a reason to undo the stub — a canned
 * reply cannot express "reappearance vs suppression" at all, because that
 * distinction only exists across batches — it is a reason to BOUND it, in
 * writing, here.
 *
 * PROVEN HERE (these exercise the REAL SPA — the built `apps/web/dist` served
 * by `vite preview` — so a regression in the front end fails this test):
 *   • routing and navigation across /upload, /batches/:id/review, /, /removed,
 *     /not-interested;
 *   • the review sections — additions expanded, already-on-list collapsed with
 *     a visible count, removals shown ticked, the append-only omissions;
 *   • the removal-confirm DIALOG gate (Apply opens it; nothing is removed until
 *     it is confirmed as a group);
 *   • the rendered dates — a removed row shows its ORIGINAL dateAdded, a
 *     reappearance shows TODAY — as PAINTED by the SPA, not as sent;
 *   • the client-side hide of a just-suppressed row, and the freshness label.
 *
 * NOT PROVEN HERE — ENFORCED BY THE STUB, so a real-API regression is invisible
 * to this file. Each is owned by an integration test that drives the real
 * server (`specs/testing.md` §6, the non-negotiable core):
 *   • REQ-071 — suppression keyed on WORK IDENTITY, surviving removal and
 *     reappearance. Here the stub's `reconcile`/`titlesResponse` drop a
 *     suppressed work; the identity KEYING itself is `T-SUP-003` (US-028 AC-3,
 *     §6 row 4). The step-7 arrival-vs-dune CONTRAST is the most this file can
 *     honestly show — a row-id-keyed server would still pass a naive
 *     "dune is hidden" check.
 *   • REQ-057 — a full-update review shows ALL extracted titles (reconcile by
 *     ABSENCE, "already on your list" populated), so a failed extraction is
 *     never misread as a removal. The stub computes it; the server contract is
 *     `T-REV-006` (US-013 AC-6, §6 row 2).
 *   • The removed view is never DE-DUPLICATED and each removal keeps its own
 *     original date — the stub emits one row per removed listing; the server
 *     contract is `T-REM-006` (US-024 AC-6, §6 row 3).
 *   • Removals ticked-by-default and confirmed as ONE group — the stub ticks
 *     and gates; the server contract is `T-UI-007`/`T-UI-008` (§6 row 9).
 *   • The close is TRANSACTIONAL, soft-delete-forever, no TTL — the stub mutates
 *     atomically in memory; the real guarantees are `T-INV-012`/`T-INV-013`
 *     (§6 rows 7–8).
 *
 * ⚠ THE CONCRETE FAILURE MODE, so the next person does not have to imagine it:
 * delete the server-side suppression filter in `apps/api` and EVERY e2e here
 * stays green, because the stub still filters — while the owner's "not
 * interested" decision has silently stopped working in production. Product
 * invariant 1 exists because that class of defect has already been
 * designed-around once in this project. This file is the LAST place that
 * catches it, not the first.
 *
 * ⚠ DRIFT ALARM (Part 2): the response builders below are annotated with the
 * SPA's own contract types (`@nextup/domain`, `apps/web/src/lib/apiClient`), so
 * a server-side shape change fails `tsc --noEmit -p tests/e2e/tsconfig.json`
 * instead of passing against a fiction. That alarm runs in CI: `npm run
 * typecheck` is `tsc --build && npm run typecheck:e2e`, and `T-INFRA-016`
 * asserts the chaining so it cannot be quietly unwired.
 *
 * ⚠ The alarm is the ONLY thing that makes the type annotations below load
 * bearing. Playwright's esbuild loader merely STRIPS types — it never checks
 * them — so a Playwright run is green against a stub whose builders contradict
 * their own declared types. If you find yourself removing a type annotation
 * here "because the test still passes", that is why it still passes.
 */

// ── The works catalogue ─────────────────────────────────────────────────────

interface WorkDef {
  readonly id: string;
  readonly tmdbId: number;
  readonly name: string;
  readonly year: number;
  readonly mediaType: 'movie' | 'tv';
}

const WORKS: Record<string, WorkDef> = {
  dune: { id: 'dune', tmdbId: 438631, name: 'Dune', year: 2021, mediaType: 'movie' },
  arrival: { id: 'arrival', tmdbId: 329865, name: 'Arrival', year: 2016, mediaType: 'movie' },
  arcane: { id: 'arcane', tmdbId: 94605, name: 'Arcane', year: 2021, mediaType: 'tv' },
  sinners: { id: 'sinners', tmdbId: 1233413, name: 'Sinners', year: 2025, mediaType: 'movie' },
};

function work(id: string): WorkDef {
  const w = WORKS[id];
  if (w === undefined) throw new Error(`Unknown work fixture: ${id}`);
  return w;
}

/** `workIdentity` is what suppression is keyed on (REQ-071), never the row id. */
function workIdentity(id: string): string {
  const w = work(id);
  return `tmdb:${w.mediaType}:${String(w.tmdbId)}`;
}

function titleId(id: string): string {
  return `ttl_${id}`;
}

// ── The calendar ────────────────────────────────────────────────────────────
//
// Distinct per-batch "date added" values so the removed-log's promise — that a
// removed listing keeps its ORIGINAL date (`RemovedItem.dateAdded`), while a
// reappearance is a brand-new row dated TODAY — is directly observable on
// screen. The freshness strip is a separate fact ("you last uploaded today")
// and is computed independently below.

const DATE_B1 = '2026-08-27';
const DATE_B2 = '2026-08-28';
const TODAY = '2026-08-29';
const LABEL_B1 = dateAddedLabel(DATE_B1);
const LABEL_B2 = dateAddedLabel(DATE_B2);
const LABEL_TODAY = dateAddedLabel(TODAY);

function iso(date: string): string {
  return `${date}T16:00:00.000Z`;
}

/** Mirrors `BatchAppliedNotice.UNDO_REMOVALS_LABEL` — kept literal so the test imports only plain copy, never a React component module. */
const UNDO_REMOVALS_LABEL = 'Undo the removals';

// ── The script: three batches, in creation order ────────────────────────────

interface BatchPlan {
  readonly service: Service;
  readonly mode: BatchMode;
  readonly date: string;
  readonly candidates: readonly string[];
}

const BATCH_PLANS: readonly BatchPlan[] = [
  // Batch 1 — the first Netflix full update (steps 1–4).
  {
    service: 'netflix',
    mode: 'full-update',
    date: DATE_B1,
    candidates: ['dune', 'arrival', 'arcane'],
  },
  // Batch 2 — a full update that drops Arrival and adds Sinners (step 5).
  {
    service: 'netflix',
    mode: 'full-update',
    date: DATE_B2,
    candidates: ['dune', 'arcane', 'sinners'],
  },
  // Batch 3 — an append-only batch in which Arrival reappears and the
  // suppressed Dune is silently kept off (step 7).
  { service: 'netflix', mode: 'append-only', date: TODAY, candidates: ['arrival', 'dune'] },
] as const;

// ── The mutable backend ─────────────────────────────────────────────────────

interface Listing {
  listingId: string;
  workId: string;
  service: Service;
  dateAdded: string;
  state: 'active' | 'removed';
  removedAt: string | null;
  removedByBatchId: string | null;
  removedByGroupId: string | null;
}

interface BatchRuntime {
  batchId: string;
  plan: BatchPlan;
  statusReads: number;
  submitted: boolean;
  confirmedAdditions: boolean;
  closed: boolean;
}

interface Suppression {
  suppressionId: string;
  workId: string;
  suppressedAt: string;
}

interface Backend {
  listings: Listing[];
  suppressions: Map<string, Suppression>;
  batches: Map<string, BatchRuntime>;
  createdBatchCount: number;
  listingSeq: number;
  groupSeq: number;
  lastCompletedAt: Partial<Record<Service, string>>;
  lastCompletedBatchId: Partial<Record<Service, string>>;
  createdBodies: unknown[];
  confirmAllBodies: unknown[];
  closeBodies: unknown[];
}

function makeBackend(): Backend {
  return {
    listings: [],
    suppressions: new Map(),
    batches: new Map(),
    createdBatchCount: 0,
    listingSeq: 0,
    groupSeq: 0,
    lastCompletedAt: {},
    lastCompletedBatchId: {},
    createdBodies: [],
    confirmAllBodies: [],
    closeBodies: [],
  };
}

function activeListings(be: Backend, service: Service): Listing[] {
  return be.listings.filter((l) => l.state === 'active' && l.service === service);
}

function isSuppressed(be: Backend, workId: string): boolean {
  return be.suppressions.has(workId);
}

function batchRuntime(be: Backend, batchId: string): BatchRuntime | undefined {
  return be.batches.get(batchId);
}

// ── Response builders ───────────────────────────────────────────────────────

function candidate(
  batch: BatchRuntime,
  workId: string,
  classification: ReviewCandidate['classification'],
  disposition: ReviewCandidate['disposition'],
): ReviewCandidate {
  const w = work(workId);
  return {
    candidateId: `cnd_${batch.batchId}_${workId}`,
    rawText: w.name,
    inferredTitle: w.name,
    basis: 'both',
    ocrSupport: 'exact',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 0.98,
    // §5.3a — `null` because this stub only ever builds `title-candidate`
    // rows, which get no tile crop. A non-null value here would be the stub
    // asserting a presentation the server would not have sent.
    tileCrop: null,
    resolvedWorkIdentity: workIdentity(workId),
    match: {
      tmdbId: w.tmdbId,
      mediaType: w.mediaType,
      name: w.name,
      releaseYear: w.year,
      posterPath: null,
      score: 0.99,
      uncertain: false,
      ambiguous: false,
    },
    alternatives: [],
    sourceImageIds: ['img_1'],
    disposition,
    collapsedIntoCandidateId: null,
    classification,
  };
}

function removalItem(listing: Listing): ReviewRemovalItem {
  const w = work(listing.workId);
  return {
    listingId: listing.listingId,
    titleId: titleId(listing.workId),
    name: w.name,
    releaseYear: w.year,
    posterPath: null,
    service: listing.service,
    dateAdded: listing.dateAdded,
    ticked: true,
  };
}

interface Reconciled {
  additionIds: string[];
  alreadyIds: string[];
  removalListings: Listing[];
  appendOnly: boolean;
}

function reconcile(be: Backend, batch: BatchRuntime): Reconciled {
  const { plan } = batch;
  const appendOnly = plan.mode === 'append-only';
  const active = activeListings(be, plan.service);
  const activeIds = new Set(active.map((l) => l.workId));
  const candSet = new Set(plan.candidates);
  // ⚠ A suppressed candidate is dropped ENTIRELY — never an addition, never a
  // removal (REQ-071). This is the front-half of the suppression invariant.
  const visible = plan.candidates.filter((c) => !isSuppressed(be, c));
  const additionIds = visible.filter((c) => !activeIds.has(c));
  const alreadyIds = visible.filter((c) => activeIds.has(c));
  const removalListings = appendOnly
    ? []
    : active.filter((l) => !candSet.has(l.workId) && !isSuppressed(be, l.workId));
  return { additionIds, alreadyIds, removalListings, appendOnly };
}

function reviewResponse(be: Backend, batch: BatchRuntime): ReviewResponse {
  const { plan } = batch;
  const { additionIds, alreadyIds, removalListings, appendOnly } = reconcile(be, batch);
  const showRemovals = !appendOnly && removalListings.length > 0;

  return {
    batchId: batch.batchId,
    service: plan.service,
    mode: plan.mode,
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'ok',
    banner: null,
    sections: {
      additions: {
        label: REVIEW_LABELS.additions,
        count: additionIds.length,
        items: additionIds.map((id) =>
          candidate(batch, id, 'new', batch.confirmedAdditions ? 'confirmed' : 'pending'),
        ),
      },
      alreadyOnYourList: {
        label: REVIEW_LABELS.alreadyOnYourList,
        count: appendOnly ? 0 : alreadyIds.length,
        items: appendOnly
          ? []
          : alreadyIds.map((id) =>
              candidate(batch, id, 'already-present-for-this-service', 'confirmed'),
            ),
        collapsedByDefault: true,
        omitted: appendOnly,
      },
      probablyNotTitles: {
        label: REVIEW_LABELS.probablyNotTitles,
        count: 0,
        items: [],
        collapsedByDefault: true,
        omitted: false,
      },
      unmatched: { label: REVIEW_LABELS.unmatched, count: 0, items: [] },
      unreadableTiles: { label: REVIEW_LABELS.unreadableTiles, count: 0, items: [] },
      // ⚠ The removals section is ABSENT (omitted) for an append-only batch and
      // for a full update with nothing to remove — REQ-022 / `T-REM-011`. This
      // deliberately diverges from `buildReviewResponse`, which keeps a
      // count-0 full-update removals section present (omitted:false). See the
      // FINDING recorded on TASK-094 in `docs/backlog.md`.
      removals: {
        label: removalsLabel(plan.service),
        count: showRemovals ? removalListings.length : 0,
        items: showRemovals ? removalListings.map(removalItem) : [],
        omitted: !showRemovals,
        withheld: false,
        withheldReason: null,
      },
    },
    imagesWithNoText: [],
  };
}

function titlesResponse(be: Backend): TitleListResponse {
  const active = be.listings.filter((l) => l.state === 'active' && !isSuppressed(be, l.workId));
  const byWork = new Map<string, Listing[]>();
  for (const l of active) {
    const list = byWork.get(l.workId) ?? [];
    list.push(l);
    byWork.set(l.workId, list);
  }
  const items = [...byWork.entries()]
    .map(([workId, listings]): TitleListItem => {
      const w = work(workId);
      const sortDateAdded = listings.map((l) => l.dateAdded).reduce((a, b) => (a < b ? a : b));
      return {
        titleId: titleId(workId),
        workIdentity: workIdentity(workId),
        matchState: 'matched',
        name: w.name,
        mediaType: w.mediaType,
        releaseYear: w.year,
        genres: [] as string[],
        runtimeMinutes: null,
        posterPath: null,
        badges: listings.map((l) => ({
          service: l.service,
          listingId: l.listingId,
          dateAdded: l.dateAdded,
        })),
        sortDateAdded,
        dateAddedLabel: dateAddedLabel(sortDateAdded),
        imdbRating: null,
      };
    })
    // Newest-first, the product default (REQ-038). `sortDateAdded` is
    // `string | null` on the real contract (a title with no non-removed
    // listing has no date); the stub always dates its rows, so a nullish guard
    // keeps the comparator total without inventing an ordering.
    .sort((a, b) => ((a.sortDateAdded ?? '') < (b.sortDateAdded ?? '') ? 1 : -1));
  return { items, nextCursor: null, limit: 50 };
}

function removedResponse(be: Backend): RemovedResponse {
  const removed = be.listings.filter((l) => l.state === 'removed');
  const byWork = new Map<string, Listing[]>();
  for (const l of removed) {
    const list = byWork.get(l.workId) ?? [];
    list.push(l);
    byWork.set(l.workId, list);
  }
  const items = removed.map((l): RemovedItem => {
    const peers = (byWork.get(l.workId) ?? [])
      .slice()
      .sort((a, b) => (a.removedAt ?? '').localeCompare(b.removedAt ?? ''));
    const ordinal = peers.findIndex((p) => p.listingId === l.listingId) + 1;
    const w = work(l.workId);
    return {
      listingId: l.listingId,
      titleId: titleId(l.workId),
      workIdentity: workIdentity(l.workId),
      matchState: 'matched',
      name: w.name,
      mediaType: w.mediaType,
      releaseYear: w.year,
      posterPath: null,
      service: l.service,
      dateAdded: l.dateAdded,
      removedAt: l.removedAt ?? iso(TODAY),
      removedByBatchId: l.removedByBatchId,
      removedByGroupId: l.removedByGroupId,
      removalOrdinal: ordinal,
      removalTotalForWork: peers.length,
      restorable: true,
      suppressed: isSuppressed(be, l.workId),
    };
  });
  return { items, nextCursor: null };
}

function suppressionsResponse(be: Backend): SuppressionsResponse {
  const items = [...be.suppressions.values()].map((s): SuppressionItem => {
    const w = work(s.workId);
    return {
      suppressionId: s.suppressionId,
      workIdentity: workIdentity(s.workId),
      suppressedAt: s.suppressedAt,
      identityStability: 'stable' as const,
      displaySnapshot: {
        name: w.name,
        releaseYear: w.year,
        mediaType: w.mediaType,
        posterPath: null,
      },
      unsuppressHref: `/api/suppressions/${s.suppressionId}/unsuppress`,
    };
  });
  return { items };
}

function serviceStateResponse(be: Backend): ServiceStateResponse {
  const services = (['netflix', 'max'] as Service[]).map((svc): ServiceFreshness => {
    const completedAt = be.lastCompletedAt[svc] ?? null;
    const ageDays = completedAt !== null ? 0 : null;
    return {
      service: svc,
      lastCompletedBatchAt: completedAt,
      lastCompletedBatchId: be.lastCompletedBatchId[svc] ?? null,
      ageDays,
      label: serviceFreshnessLabel(svc, ageDays),
    };
  });
  return { services };
}

function batchStatusResponse(batch: BatchRuntime): BatchStatus {
  const inReview = batch.submitted && batch.statusReads >= 2;
  const status: BatchStatus = {
    batchId: batch.batchId,
    service: batch.plan.service,
    mode: batch.plan.mode,
    status: inReview ? 'in-review' : 'extracting',
    derivedFromBatchId: null,
    createdAt: iso(TODAY),
    submittedAt: iso(TODAY),
    completedAt: null,
    images: [1, 2, 3].map((n) => ({
      imageId: `img_${String(n)}`,
      fileName: `${batch.plan.service}-golden-${String(n)}.png`,
      ingestSource: 'upload',
      available: true,
      retainUntil: '2026-09-28T16:00:00.000Z',
      candidateCount: inReview ? 1 : null,
      href: `/api/images/img_${String(n)}`,
    })),
    extractionError: null,
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'ok',
    provenance: { created: [], modified: [], removed: [] },
    changedNothing: true,
    titles: [],
  };
  // ⚠ `progress` is OMITTED, not set to `undefined`, while in review — the
  // §6.15 field is present only while extracting, and `exactOptionalPropertyTypes`
  // (via the drift-alarm tsconfig) makes the difference a typecheck error, which
  // is the contract the real API honours.
  if (!inReview) status.progress = { imagesDone: 1, imagesTotal: 3 };
  return status;
}

interface CloseOutcome {
  status: number;
  body: unknown;
}

function closeBatch(be: Backend, batch: BatchRuntime, confirmRemovals: boolean): CloseOutcome {
  const { plan } = batch;
  const { additionIds, removalListings } = reconcile(be, batch);
  const showRemovals = removalListings.length > 0;

  // ⚠ A close that would create additions the owner has not confirmed is
  // refused whole (`specs/api.md` §6.14): nothing is applied.
  if (!batch.confirmedAdditions && additionIds.length > 0) {
    return {
      status: 409,
      body: {
        error: {
          code: 'PENDING_ADDITIONS',
          message: 'Some additions still need a decision.',
          details: {
            pendingCandidateIds: additionIds.map((id) => `cnd_${batch.batchId}_${id}`),
          },
        },
      },
    };
  }

  // ⚠ Removals must be confirmed as ONE group before they apply (§6.15).
  if (showRemovals && confirmRemovals !== true) {
    return {
      status: 409,
      body: {
        error: {
          code: 'REMOVALS_NOT_CONFIRMED',
          message: 'Confirm the removals before applying.',
          details: {},
        },
      },
    };
  }

  // ⚠ Transactional and scoped to exactly ONE service: this batch's service.
  let removalGroupId: string | null = null;
  if (removalListings.length > 0) {
    be.groupSeq += 1;
    removalGroupId = `grp_e2e_${String(be.groupSeq)}`;
    for (const l of removalListings) {
      // Soft delete forever — the row stays, it is only marked removed.
      l.state = 'removed';
      l.removedAt = iso(TODAY);
      l.removedByBatchId = batch.batchId;
      l.removedByGroupId = removalGroupId;
    }
  }
  for (const id of additionIds) {
    be.listingSeq += 1;
    be.listings.push({
      listingId: `lst_e2e_${String(be.listingSeq)}`,
      workId: id,
      service: plan.service,
      dateAdded: plan.date,
      state: 'active',
      removedAt: null,
      removedByBatchId: null,
      removedByGroupId: null,
    });
  }
  batch.closed = true;
  be.lastCompletedAt[plan.service] = iso(TODAY);
  be.lastCompletedBatchId[plan.service] = batch.batchId;

  const body: CloseBatchResult = {
    batchId: batch.batchId,
    status: 'closed',
    summary: {
      listingsCreated: additionIds.length,
      listingsRemoved: removalListings.length,
      removalGroupId,
    },
    serviceState: { service: plan.service },
    undoable: removalListings.length === 0,
  };
  return { status: 200, body };
}

// ── The router ──────────────────────────────────────────────────────────────

function ok(body: unknown) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const BATCH_PATH = /^\/api\/batches\/([^/]+)(\/[^?]*)?$/;

async function stubBackend(page: Page, be: Backend): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/me') {
      const me: MeResponse = {
        ownerId: 'owner-e2e',
        displayName: 'Owner',
        signOutUrl: '/.auth/logout',
        attribution: null,
      };
      await route.fulfill(ok(me));
      return;
    }

    if (method === 'GET' && path === '/api/titles') {
      await route.fulfill(ok(titlesResponse(be)));
      return;
    }

    if (method === 'GET' && path === '/api/suppressions') {
      await route.fulfill(ok(suppressionsResponse(be)));
      return;
    }

    if (method === 'GET' && path === '/api/service-state') {
      await route.fulfill(ok(serviceStateResponse(be)));
      return;
    }

    if (method === 'GET' && path === '/api/removed') {
      await route.fulfill(ok(removedResponse(be)));
      return;
    }

    if (method === 'POST' && path === '/api/batches') {
      be.createdBatchCount += 1;
      const plan = BATCH_PLANS[be.createdBatchCount - 1];
      if (plan === undefined) throw new Error(`No batch plan #${String(be.createdBatchCount)}`);
      const batchId = `bat_e2e_${String(be.createdBatchCount)}`;
      be.batches.set(batchId, {
        batchId,
        plan,
        statusReads: 0,
        submitted: false,
        confirmedAdditions: false,
        closed: false,
      });
      be.createdBodies.push(request.postDataJSON());
      const created: CreatedBatch = {
        batchId,
        service: plan.service,
        mode: plan.mode,
        status: 'open',
        createdAt: iso(TODAY),
      };
      await fulfillJson(route, 201, created);
      return;
    }

    // POST /api/titles/:titleId/suppress
    const suppressMatch = /^\/api\/titles\/([^/]+)\/suppress$/.exec(path);
    if (method === 'POST' && suppressMatch) {
      const rawTitleId = decodeURIComponent(suppressMatch[1] ?? '');
      const workId = rawTitleId.replace(/^ttl_/, '');
      const identity = workIdentity(workId);
      const already = be.suppressions.has(workId);
      if (!already) {
        be.suppressions.set(workId, {
          suppressionId: `supp:${identity}`,
          workId,
          suppressedAt: iso(TODAY),
        });
      }
      await fulfillJson(route, 200, {
        suppressionId: `supp:${identity}`,
        workIdentity: identity,
        alreadySuppressed: already,
      });
      return;
    }

    // POST /api/suppressions/:id/unsuppress
    const unsuppressMatch = /^\/api\/suppressions\/([^/]+)\/unsuppress$/.exec(path);
    if (method === 'POST' && unsuppressMatch) {
      const suppressionId = decodeURIComponent(unsuppressMatch[1] ?? '');
      for (const [workId, s] of be.suppressions) {
        if (s.suppressionId === suppressionId) be.suppressions.delete(workId);
      }
      await fulfillJson(route, 200, {
        suppressionId,
        active: false,
        restoredAnything: false,
      });
      return;
    }

    const batchMatch = BATCH_PATH.exec(path);
    if (batchMatch) {
      const batchId = decodeURIComponent(batchMatch[1] ?? '');
      const suffix = batchMatch[2] ?? '';
      const batch = batchRuntime(be, batchId);
      if (batch === undefined) {
        await fulfillJson(route, 404, {
          error: { code: 'NOT_FOUND', message: `${batchId} unknown`, details: {} },
        });
        return;
      }

      if (method === 'POST' && suffix === '/images') {
        const result: AddImagesResult = {
          accepted: [1, 2, 3].map((n) => ({
            imageId: `img_${String(n)}`,
            fileName: `${batch.plan.service}-golden-${String(n)}.png`,
          })),
          rejected: [],
          batchTotals: { imageCount: 3, uploadedByteSize: 300, storedByteSize: 300 },
        };
        await fulfillJson(route, 201, result);
        return;
      }

      if (method === 'POST' && suffix === '/submit') {
        batch.submitted = true;
        await route.fulfill({ status: 204, body: '' });
        return;
      }

      if (method === 'GET' && suffix === '') {
        batch.statusReads += 1;
        await route.fulfill(ok(batchStatusResponse(batch)));
        return;
      }

      if (method === 'GET' && suffix === '/review') {
        await route.fulfill(ok(reviewResponse(be, batch)));
        return;
      }

      if (method === 'POST' && suffix === '/candidates/confirm-all') {
        be.confirmAllBodies.push(request.postDataJSON());
        batch.confirmedAdditions = true;
        const { additionIds } = reconcile(be, batch);
        const result: ConfirmAllResult = {
          section: 'additions',
          confirmed: additionIds.length,
          skipped: 0,
        };
        await route.fulfill(ok(result));
        return;
      }

      if (method === 'POST' && suffix === '/close') {
        const body = request.postDataJSON() as { confirmRemovals?: boolean } | null;
        be.closeBodies.push(body);
        const outcome = closeBatch(be, batch, body?.confirmRemovals === true);
        await fulfillJson(route, outcome.status, outcome.body);
        return;
      }
    }

    await fulfillJson(route, 500, {
      error: { code: 'UNSTUBBED', message: `${method} ${path}`, details: {} },
    });
  });
}

// ── Drivers ─────────────────────────────────────────────────────────────────

async function attachGoldenScreenshots(page: Page, service: Service): Promise<void> {
  await page.getByTestId('file-input').setInputFiles(
    [1, 2, 3].map((n) => ({
      name: `${service}-golden-${String(n)}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, n]),
    })),
  );
}

/** Upload three screenshots and submit, landing on the batch's review screen. */
async function uploadAndSubmit(
  page: Page,
  opts: { service: Service; modeLabel: RegExp; expectedBatchId: string },
): Promise<void> {
  await page.goto('/upload');
  await expect(page.getByRole('heading', { name: 'Upload screenshots' })).toBeVisible();
  await page.getByRole('radio', { name: /Netflix/ }).check();
  await page.getByRole('radio', { name: opts.modeLabel }).check();
  await attachGoldenScreenshots(page, opts.service);
  await expect(page.getByTestId('accepted-file')).toHaveCount(3);
  await page.getByRole('button', { name: SUBMIT_LABEL }).click();
  await expect(page).toHaveURL(`/batches/${opts.expectedBatchId}/review`);
}

test('T-E2E-001: a first full update, a reconcile with removals, a suppression, and a reappearance', async ({
  page,
}) => {
  const be = makeBackend();
  await stubBackend(page, be);

  // ── Steps 1–4: the first Netflix full update ──────────────────────────────

  await page.goto('/upload');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upload screenshots' })).toBeVisible();

  await page.getByRole('radio', { name: /Netflix/ }).check();
  await expect(page.getByText(modeExplanation('full-update', 'netflix'))).toBeVisible();
  await expect(page.getByText(modeExplanation('append-only', 'netflix'))).toBeVisible();
  await page.getByRole('radio', { name: /Full update/ }).check();
  await attachGoldenScreenshots(page, 'netflix');
  await expect(page.getByTestId('accepted-file')).toHaveCount(3);
  await expect(page.getByTestId('dropzone-totals')).toContainText('3 screenshots');
  await expect.poll(() => be.createdBodies[0]).toEqual({ service: 'netflix', mode: 'full-update' });

  await page.getByRole('button', { name: SUBMIT_LABEL }).click();
  await expect(page).toHaveURL('/batches/bat_e2e_1/review');

  // The list is still empty until the batch is applied.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your list' })).toBeVisible();
  await expect(page.getByTestId('title-list').locator('[data-testid^="title-row-"]')).toHaveCount(
    0,
  );

  await page.goto('/batches/bat_e2e_1/review');
  await expect(page.getByRole('heading', { name: 'Review this batch' })).toBeVisible();

  const additions1 = page.getByTestId('review-additions');
  await expect(additions1.locator('summary')).toHaveText('New to your list (3)');
  await expect(additions1.locator('details')).toHaveJSProperty('open', true);
  for (const id of ['dune', 'arrival', 'arcane']) {
    await expect(additions1.getByText(work(id).name).first()).toBeVisible();
  }

  const already1 = page.getByTestId('review-already-on-list');
  await expect(already1.locator('summary')).toHaveText('Already on your list (0)');
  await expect(already1.locator('details')).toHaveJSProperty('open', false);
  // ⚠ Nothing on the list yet ⇒ nothing to remove ⇒ the removals section is ABSENT.
  await expect(page.getByTestId('review-removals')).toHaveCount(0);
  await expect(page.getByText(removalsLabel('netflix'))).toHaveCount(0);

  await page.getByRole('button', { name: 'Confirm all 3' }).click();
  await expect(page.getByRole('button', { name: 'Confirm all 3' })).toHaveCount(0);
  await expect.poll(() => be.confirmAllBodies[0]).toEqual({ section: 'additions' });

  await page.getByRole('button', { name: REVIEW_APPLY_LABEL }).click();
  await expect(page).toHaveURL('/');
  await expect.poll(() => be.closeBodies[0]).toEqual({ confirmRemovals: false });

  const rows1 = page.getByTestId('title-list').locator('[data-testid^="title-row-"]');
  await expect(rows1).toHaveCount(3);
  for (const id of ['dune', 'arrival', 'arcane']) {
    const row = page.getByTestId(`title-row-ttl_${id}`);
    await expect(row.getByTestId('title-name')).toHaveText(work(id).name);
    await expect(row.getByTestId('badge-netflix')).toHaveText(SERVICE_LABELS.netflix);
    await expect(row.getByTestId('date-added-label')).toHaveText(LABEL_B1);
  }
  await expect(page.getByTestId('freshness-label-netflix')).toHaveText('Netflix updated today');

  // ── Step 5: a second full update that removes Arrival and adds Sinners ─────

  await uploadAndSubmit(page, {
    service: 'netflix',
    modeLabel: /Full update/,
    expectedBatchId: 'bat_e2e_2',
  });
  await expect(page.getByRole('heading', { name: 'Review this batch' })).toBeVisible();

  // One addition (Sinners), and Dune + Arcane already present (collapsed).
  const additions2 = page.getByTestId('review-additions');
  await expect(additions2.locator('summary')).toHaveText('New to your list (1)');
  await expect(additions2.getByText('Sinners').first()).toBeVisible();

  const already2 = page.getByTestId('review-already-on-list');
  await expect(already2.locator('summary')).toHaveText('Already on your list (2)');

  // ⚠ Arrival — extracted from NO screenshot this batch — is proposed for
  // removal, ticked on arrival (REQ-055). This is the reconcile-with-removals
  // heart of step 5.
  const removals2 = page.getByTestId('review-removals');
  await expect(removals2, 'Arrival should be offered for removal').toBeVisible();
  await expect(removals2.locator('summary')).toHaveText(`${removalsLabel('netflix')} (1)`);
  const removalCards = removals2.getByTestId('removal-card');
  await expect(removalCards).toHaveCount(1);
  await expect(removalCards.first()).toContainText('Arrival');
  await expect(removalCards.first().locator('input[type="checkbox"]')).toBeChecked();

  await page.getByRole('button', { name: 'Confirm all 1' }).click();
  await expect(page.getByRole('button', { name: 'Confirm all 1' })).toHaveCount(0);

  // Apply opens the removal-confirmation dialog; nothing is removed until it
  // is confirmed as a group.
  await page.getByTestId('apply-changes-button').click();
  const confirmDialog = page.getByTestId('removal-confirm');
  await expect(confirmDialog).toBeVisible();
  await expect(page.getByTestId('removal-confirm-list')).toContainText('Arrival');
  await confirmDialog.getByRole('button', { name: REMOVAL_CONFIRM_LABEL }).click();

  await expect(page).toHaveURL('/');
  await expect.poll(() => be.closeBodies[1]).toEqual({ confirmRemovals: true });

  // The applied notice offers "Undo the removals" (a removal-group undo).
  await expect(page.getByTestId('applied-notice')).toBeVisible();
  await expect(
    page.getByRole('button', { name: UNDO_REMOVALS_LABEL }),
    'a removal close must offer a removal-group undo',
  ).toBeVisible();

  // The list now holds Dune, Arcane, Sinners — Arrival is gone.
  const rows2 = page.getByTestId('title-list').locator('[data-testid^="title-row-"]');
  await expect(rows2).toHaveCount(3);
  await expect(page.getByTestId('title-row-ttl_arrival')).toHaveCount(0);
  await expect(page.getByTestId('title-row-ttl_dune')).toBeVisible();
  await expect(page.getByTestId('title-row-ttl_arcane')).toBeVisible();
  const sinnersRow = page.getByTestId('title-row-ttl_sinners');
  await expect(sinnersRow.getByTestId('title-name')).toHaveText('Sinners');
  await expect(sinnersRow.getByTestId('date-added-label')).toHaveText(LABEL_B2);

  // The removed view LOGS Arrival, with its ORIGINAL date preserved.
  await page.goto('/removed');
  await expect(page.getByRole('heading', { name: 'Removal history' })).toBeVisible();
  const removedRows = page.getByTestId('removed-list').locator('[data-testid="removed-row"]');
  await expect(removedRows).toHaveCount(1);
  const removedArrival = removedRows.first();
  await expect(removedArrival.getByTestId('removed-name')).toHaveText('Arrival');
  await expect(removedArrival.getByTestId('removed-service')).toHaveText(SERVICE_LABELS.netflix);
  await expect(
    removedArrival.getByTestId('removed-date-added'),
    'the removed row keeps its ORIGINAL date, not the removal date',
  ).toHaveText(LABEL_B1);

  // ── Step 6: suppress Dune ("not interested") ──────────────────────────────

  await page.goto('/');
  await expect(page.getByTestId('title-row-ttl_dune')).toBeVisible();
  await page.getByTestId('title-row-ttl_dune').getByTestId('row-menu').click();
  await page.getByTestId('row-menu-suppress').click();

  const suppressDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Not interested' }) });
  await expect(suppressDialog).toBeVisible();
  await suppressDialog.getByRole('button', { name: 'Not interested' }).click();
  await expect(suppressDialog.getByText(/is now on your Not interested list/)).toBeVisible();
  await suppressDialog.getByRole('button', { name: 'Close' }).click();

  // Dune leaves the list immediately, and stays gone after a reload (the
  // server filters it too).
  await expect(page.getByTestId('title-row-ttl_dune')).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByTestId('title-row-ttl_dune')).toHaveCount(0);
  await expect(page.getByTestId('title-row-ttl_arcane')).toBeVisible();
  await expect(page.getByTestId('title-row-ttl_sinners')).toBeVisible();

  // It appears under "Not interested".
  await page.goto('/not-interested');
  await expect(page.getByRole('heading', { name: 'Not interested' })).toBeVisible();
  const suppressedRows = page
    .getByTestId('suppressed-list')
    .locator('[data-testid="suppressed-row"]');
  await expect(suppressedRows).toHaveCount(1);
  await expect(suppressedRows.first().getByTestId('suppressed-name')).toHaveText('Dune');

  // ── Step 7: an append-only batch — Arrival reappears, Dune stays suppressed ─

  await uploadAndSubmit(page, {
    service: 'netflix',
    modeLabel: /Add only/,
    expectedBatchId: 'bat_e2e_3',
  });
  await expect(page.getByRole('heading', { name: 'Review this batch' })).toBeVisible();

  // Arrival is a brand-new addition again (it was removed, not suppressed).
  const additions3 = page.getByTestId('review-additions');
  await expect(additions3.locator('summary')).toHaveText('New to your list (1)');
  await expect(additions3.getByText('Arrival').first()).toBeVisible();

  // ⚠ THE SUPPRESSION INVARIANT (REQ-071). Dune is in this batch's screenshots
  // too, but because suppression is keyed on WORK IDENTITY it is dropped
  // ENTIRELY from the review — it is neither an addition nor "already on your
  // list". A row-id-keyed suppression would have let this reappear.
  await expect(page.getByText('Dune'), 'a suppressed work must not reappear').toHaveCount(0);
  // Append-only ⇒ no already-on-list section and no removals.
  await expect(page.getByTestId('review-already-on-list')).toHaveCount(0);
  await expect(page.getByTestId('review-removals')).toHaveCount(0);

  await page.getByRole('button', { name: 'Confirm all 1' }).click();
  await page.getByTestId('apply-changes-button').click();
  await expect(page).toHaveURL('/');
  await expect.poll(() => be.closeBodies[2]).toEqual({ confirmRemovals: false });

  // Arrival is back on the list as a brand-new row dated TODAY.
  const arrivalRow = page.getByTestId('title-row-ttl_arrival');
  await expect(arrivalRow).toBeVisible();
  await expect(
    arrivalRow.getByTestId('date-added-label'),
    'the reappearance is a brand-new row dated today',
  ).toHaveText(LABEL_TODAY);
  // Dune is still suppressed — the append-only batch did not bring it back.
  await expect(page.getByTestId('title-row-ttl_dune')).toHaveCount(0);

  // The removed LOG still holds the ORIGINAL Arrival removal, untouched: the
  // reappearance did NOT restore it (restore is an explicit action only).
  await page.goto('/removed');
  const removedRows2 = page.getByTestId('removed-list').locator('[data-testid="removed-row"]');
  await expect(removedRows2).toHaveCount(1);
  const removedArrival2 = removedRows2.first();
  await expect(removedArrival2.getByTestId('removed-name')).toHaveText('Arrival');
  await expect(
    removedArrival2.getByTestId('removed-date-added'),
    'the logged removal keeps its original date after the reappearance',
  ).toHaveText(LABEL_B1);
  // ⚠ FINDING (Part 3), reported not worked around — a spec-vs-implementation
  // conflict on the ordinal chip for a SINGLE removal:
  //   • `specs/testing.md` §5 step 7 (authoritative AC→test mapping, NFR-003)
  //     explicitly requires /removed to show "Removal 1 of 1" here;
  //   • `specs/ui.md` (§ "/removed") lists the ordinal chip as a per-row
  //     element and its example is "Removal 2 of 3" — silent on the singleton,
  //     if anything implying every row carries one;
  //   • `specs/ux-states.md` §7.5 says only "with ordinal chips" — silent on
  //     the singleton;
  //   • `RemovedPage.removalOrdinalLabel` returns null when
  //     `removalTotalForWork <= 1` (citing "§7.5", which does not state it), so
  //     NO ordinal renders for a work removed exactly once.
  // The design specs do not specify the singleton suppression, so it is not
  // "specified behaviour" this test can simply ratify; making the ordinal
  // render for a singleton is a `RemovedPage` change this lane must not make,
  // and forcing a second removal purely to light up the chip would bend the
  // owner's actual path (the parent chose the finding over that coverage). The
  // assertion therefore pins the SHIPPED behaviour (no chip for a singleton) so
  // a regression is still caught, and the conflict is recorded on TASK-108 for
  // the owner to reconcile.
  await expect(removedArrival2.getByTestId('removed-ordinal')).toHaveCount(0);
});
