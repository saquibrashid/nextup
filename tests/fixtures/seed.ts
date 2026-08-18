/**
 * The deterministic seed fixture (TASK-032, `specs/testing.md` §2 "Load
 * fixture" and §3.6 "Identity").
 *
 * Three things live here, and they are separate on purpose:
 *
 *   1. **An injected clock.** Nothing in this file calls `new Date()` at write
 *      time. Every timestamp is derived from a clock the caller supplies, so
 *      two runs of the same seed produce byte-identical rows. A fixture that
 *      reads the wall clock produces data that differs between runs, and a
 *      test written against it either asserts nothing about dates or goes
 *      flaky at midnight — both of which `NFR-003` forbids.
 *   2. **A deterministic plan, separated from the write.** `planSeed()` is a
 *      pure function returning the rows; `seedOwner()` writes them through the
 *      owner-scoped repository. Determinism is therefore assertable WITHOUT a
 *      database, and the write path is the sanctioned one — `ownerId` first,
 *      every time (`specs/security.md` §3, control #1).
 *   3. **`asOwner(origin, subject)`** — an HTTP client carrying the Easy Auth
 *      principal header for one subject.
 *
 * ⚠ WHY THIS IS `fetch` AND NOT `supertest`.
 * `specs/testing.md` §3.6 says `asOwner(subject)` "returns a supertest agent".
 * `supertest` is not a dependency of this repository and adding one needs an
 * NFR-004 justification it does not have: `TASK-023` already established the
 * house pattern of driving a real listening server with Node's built-in
 * `fetch` (`apps/api/test/unit/authChain.spec.ts`), which is strictly higher
 * fidelity — a 401 that is really an HTML redirect is invisible to an
 * assertion made against a mocked `res`. The SHAPE of the helper is what §3.6
 * is specifying; the transport is not.
 *
 * ⚠ WHY THE SEED IS PARAMETERISED BY OWNER.
 * Every cross-owner isolation assertion needs two owners whose data is
 * structurally IDENTICAL and whose ids are DISJOINT. Identical, so that a 404
 * for owner B cannot be explained by "there was nothing there anyway";
 * disjoint, so that a leak is unambiguous. `OWNER_A` and `OWNER_B` in
 * `apps/api/test/integration/harness.ts` are the two fixed owners §3.6 names.
 */

import type { OwnerId, Db } from '../../apps/api/src/repository/ownerData.js';
import {
  createRemovalGroup,
  createServiceListing,
  createSuppression,
  createTitle,
  createUploadBatch,
  createUploadedImage,
  upsertServiceState,
} from '../../apps/api/src/repository/ownerData.js';

/* ------------------------------------------------------------------ *
 * The injected clock
 * ------------------------------------------------------------------ */

/**
 * The one fixed instant the whole fixture is written against.
 *
 * Chosen well clear of a month or year boundary so that "30 days later" and
 * "183 days later" arithmetic in a test never silently crosses one.
 */
export const FIXED_NOW = new Date('2026-03-01T12:00:00.000Z');

/** A clock a test controls, so no fixture value depends on the wall clock. */
export interface Clock {
  /** The current instant. Never `new Date()`. */
  now(): Date;
  /** Move the clock forward. Returns the new instant. */
  advance(milliseconds: number): Date;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function createClock(start: Date = FIXED_NOW): Clock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (milliseconds: number) => {
      current += milliseconds;
      return new Date(current);
    },
  };
}

/* ------------------------------------------------------------------ *
 * The plan — pure, deterministic, no database
 * ------------------------------------------------------------------ */

/**
 * The rows one owner's seed consists of.
 *
 * Shapes are `Record`s rather than Prisma input types on purpose: this object
 * is also compared for equality in the determinism assertion, and Prisma's
 * generated input types carry optional keys that would make two structurally
 * identical plans compare unequal.
 */
export interface SeedPlan {
  readonly ownerId: string;
  readonly appendBatch: Record<string, unknown>;
  readonly fullUpdateBatch: Record<string, unknown>;
  readonly removalGroup: Record<string, unknown>;
  readonly matchedTitle: Record<string, unknown>;
  readonly unmatchedTitle: Record<string, unknown>;
  readonly suppressedTitleIdentity: string;
  readonly activeListings: readonly Record<string, unknown>[];
  readonly removedListing: Record<string, unknown>;
  readonly suppression: Record<string, unknown>;
  readonly image: Record<string, unknown>;
}

/**
 * Ids are `<prefix>-<kind>-<n>`, never a ULID or a UUID.
 *
 * A random id would make the seed non-reproducible, and — worse for this
 * project — would make a cross-owner leak hard to SEE in a failure message.
 * `owner-b-title-1` appearing in owner A's response names the defect on sight.
 */
const idFor = (prefix: string, kind: string, n: number): string => `${prefix}-${kind}-${n}`;

/** An ISO date (no time) — `service_listing.date_added` is a `DATE` column. */
const dateOnly = (at: Date): Date => new Date(`${at.toISOString().slice(0, 10)}T00:00:00.000Z`);

/**
 * Build one owner's seed. Pure: same `(ownerId, prefix, clock start)` in, same
 * plan out, every time.
 *
 * `prefix` defaults to the owner id, which is what keeps two owners' ids
 * disjoint without the caller having to remember to make them so.
 */
export function planSeed(
  ownerId: string,
  clock: Clock = createClock(),
  prefix = ownerId,
): SeedPlan {
  const now = clock.now();
  const yesterday = new Date(now.getTime() - DAY_MS);
  const lastWeek = new Date(now.getTime() - 7 * DAY_MS);

  const appendBatchId = idFor(prefix, 'batch', 1);
  const fullUpdateBatchId = idFor(prefix, 'batch', 2);
  const groupId = idFor(prefix, 'group', 1);
  const matchedTitleId = idFor(prefix, 'title', 1);
  const unmatchedTitleId = idFor(prefix, 'title', 2);

  // A `matched` title needs a non-null tmdbId, a `tmdb:`-prefixed identity and
  // a NULL rawExtractedText; an `unmatched` title needs the exact opposite.
  // The `title_match_coherent` CHECK ties all four together — a half-matched
  // row is not a state this product has.
  const matchedWorkIdentity = `tmdb:movie:${prefix.length}01`;
  const unmatchedWorkIdentity = `unmatched:${prefix}:1`;
  const suppressedWorkIdentity = `tmdb:tv:${prefix.length}02`;

  return {
    ownerId,

    appendBatch: {
      id: appendBatchId,
      mode: 'append-only',
      service: 'netflix',
      status: 'applied',
      completedAt: lastWeek,
    },

    fullUpdateBatch: {
      id: fullUpdateBatchId,
      mode: 'full-update',
      service: 'max',
      status: 'applied',
      completedAt: yesterday,
    },

    removalGroup: { id: groupId, batchId: fullUpdateBatchId },

    matchedTitle: {
      id: matchedTitleId,
      workIdentity: matchedWorkIdentity,
      state: 'active',
      matchState: 'matched',
      tmdbId: 601,
      tmdbMediaType: 'movie',
      tmdbName: 'A Matched Work',
      tmdbReleaseYear: 2019,
      createdByBatchId: appendBatchId,
      sortDateAdded: dateOnly(lastWeek),
    },

    unmatchedTitle: {
      id: unmatchedTitleId,
      workIdentity: unmatchedWorkIdentity,
      state: 'active',
      matchState: 'unmatched',
      rawExtractedText: 'An Unmatched Work',
      normalisedText: 'an unmatched work',
      createdByBatchId: appendBatchId,
      sortDateAdded: dateOnly(lastWeek),
    },

    suppressedTitleIdentity: suppressedWorkIdentity,

    // One per service, so the combined-list badge logic has both to work with.
    activeListings: [
      {
        listingId: idFor(prefix, 'listing', 1),
        titleId: matchedTitleId,
        service: 'netflix',
        state: 'active',
        dateAdded: dateOnly(lastWeek),
        createdByBatchId: appendBatchId,
      },
      {
        listingId: idFor(prefix, 'listing', 2),
        titleId: matchedTitleId,
        service: 'max',
        state: 'active',
        dateAdded: dateOnly(yesterday),
        createdByBatchId: fullUpdateBatchId,
      },
    ],

    // Soft-deleted, never hard-deleted (REQ-028). The removed view is a
    // historical LOG, so a seeded removal is a first-class fixture row.
    removedListing: {
      listingId: idFor(prefix, 'listing', 3),
      titleId: unmatchedTitleId,
      service: 'max',
      state: 'removed',
      dateAdded: dateOnly(lastWeek),
      createdByBatchId: appendBatchId,
      removedAt: yesterday,
      removedByBatchId: fullUpdateBatchId,
      removedByGroupId: groupId,
    },

    // ⚠ Keyed on the canonical WORK IDENTITY, never on a row id (REQ-071).
    suppression: {
      id: idFor(prefix, 'supp', 1),
      workIdentity: suppressedWorkIdentity,
      displayName: 'A Suppressed Work',
      displayMediaType: 'tv',
      suppressedAt: yesterday,
    },

    image: {
      id: idFor(prefix, 'image', 1),
      batchId: appendBatchId,
      // Composed only from server-generated ids and NEVER emitted to a client.
      blobPath: `${prefix}/screenshots/${idFor(prefix, 'image', 1)}.png`,
      fileName: 'netflix-list-01.png',
      ingestSource: 'upload',
      uploadedFormat: 'png',
      format: 'png',
      byteSize: 4096,
      // Deliberately NOT equal to `byteSize`. A fixture where the two match
      // lets a caller read either one and look correct, which is the whole
      // failure mode this pair of columns exists to prevent.
      uploadedByteSize: 4352,
      width: 1170,
      height: 2532,
      uploadedAt: lastWeek,
      // `uploadedAt` + 30 days. The number is inlined rather than imported so
      // this file names neither retention constant — `T-INV-008` fails any
      // file that names both, and a fixture is not a place to blur them.
      retainUntil: new Date(lastWeek.getTime() + 30 * DAY_MS),
      candidateCount: 2,
    },
  };
}

/* ------------------------------------------------------------------ *
 * The write
 * ------------------------------------------------------------------ */

/**
 * The one bridge between the plan's structural rows and Prisma's input types.
 *
 * The plan is deliberately plain `Record`s so two plans can be compared for
 * equality; the repository takes generated Prisma types. `T` is inferred from
 * the parameter position at each call site, so this stays a single, named,
 * greppable cast rather than a scattering of `as never`.
 */
const asInput = <T>(row: Record<string, unknown>): T => row as T;

/** Everything a test needs to address the seeded rows by id. */
export interface SeededOwner {
  readonly ownerId: OwnerId;
  readonly plan: SeedPlan;
  readonly batchIds: readonly string[];
  readonly titleIds: readonly string[];
  readonly listingIds: readonly string[];
  readonly removalGroupIds: readonly string[];
  readonly suppressionIds: readonly string[];
  readonly imageIds: readonly string[];
  /** The work identity of the suppressed work — suppression is identity-keyed. */
  readonly suppressedWorkIdentity: string;
}

/**
 * Write one owner's seed through the owner-scoped repository.
 *
 * Insert order follows the foreign keys: batches, then the removal group, then
 * titles, then listings (which reference all three), then the suppression and
 * the image.
 */
export async function seedOwner(
  ownerId: OwnerId,
  options: { clock?: Clock; prefix?: string; db?: Db } = {},
): Promise<SeededOwner> {
  const clock = options.clock ?? createClock();
  const plan = planSeed(ownerId, clock, options.prefix ?? ownerId);
  const tx = options.db;

  await createUploadBatch(ownerId, asInput(plan.appendBatch), tx);
  await createUploadBatch(ownerId, asInput(plan.fullUpdateBatch), tx);
  await createRemovalGroup(ownerId, asInput(plan.removalGroup), tx);

  await createTitle(ownerId, asInput(plan.matchedTitle), tx);
  await createTitle(ownerId, asInput(plan.unmatchedTitle), tx);

  for (const listing of plan.activeListings) {
    await createServiceListing(ownerId, asInput(listing), tx);
  }
  await createServiceListing(ownerId, asInput(plan.removedListing), tx);

  await createSuppression(ownerId, asInput(plan.suppression), tx);
  await createUploadedImage(ownerId, asInput(plan.image), tx);

  // Per-service last-updated dates are a FACT the owner is shown (REQ-039).
  // They are never a nudge and there is no staleness threshold anywhere.
  await upsertServiceState(
    ownerId,
    'netflix',
    {
      lastCompletedBatchId: plan.appendBatch['id'] as string,
      lastCompletedBatchAt: plan.appendBatch['completedAt'] as Date,
    },
    tx,
  );
  await upsertServiceState(
    ownerId,
    'max',
    {
      lastCompletedBatchId: plan.fullUpdateBatch['id'] as string,
      lastCompletedBatchAt: plan.fullUpdateBatch['completedAt'] as Date,
    },
    tx,
  );

  return {
    ownerId,
    plan,
    batchIds: [plan.appendBatch['id'] as string, plan.fullUpdateBatch['id'] as string],
    titleIds: [plan.matchedTitle['id'] as string, plan.unmatchedTitle['id'] as string],
    listingIds: [
      ...plan.activeListings.map((l) => l['listingId'] as string),
      plan.removedListing['listingId'] as string,
    ],
    removalGroupIds: [plan.removalGroup['id'] as string],
    suppressionIds: [plan.suppression['id'] as string],
    imageIds: [plan.image['id'] as string],
    suppressedWorkIdentity: plan.suppressedTitleIdentity,
  };
}

/**
 * Every id the seed created, in one flat list.
 *
 * `T-SEC-002` walks this against the other owner's session: an id-bearing
 * route must answer **404**, never 403, for an id it does not own.
 */
export function allSeededIds(seeded: SeededOwner): readonly string[] {
  return [
    ...seeded.batchIds,
    ...seeded.titleIds,
    ...seeded.listingIds,
    ...seeded.removalGroupIds,
    ...seeded.suppressionIds,
    ...seeded.imageIds,
  ];
}

/* ------------------------------------------------------------------ *
 * Identity — `asOwner` (specs/testing.md §3.6)
 * ------------------------------------------------------------------ */

/** The Easy Auth header name, mirrored so fixtures do not import app internals. */
export const CLIENT_PRINCIPAL_HEADER = 'x-ms-client-principal';

const OID_CLAIM = 'http://schemas.microsoft.com/identity/claims/objectidentifier';

/** A base64 Easy Auth principal for `subject`, in the shape the adapter parses. */
export function principalHeaderValue(subject: string): string {
  return Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
        { typ: OID_CLAIM, val: subject },
        { typ: 'preferred_username', val: `${subject}@example.com` },
      ],
    }),
    'utf8',
  ).toString('base64');
}

/** A request client bound to one signed-in subject. */
export interface OwnerAgent {
  readonly subject: string;
  request(method: string, path: string, init?: RequestInit): Promise<Response>;
  get(path: string): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
  patch(path: string, body?: unknown): Promise<Response>;
  delete(path: string): Promise<Response>;
}

/**
 * A client that signs every request as `subject`.
 *
 * The header is attached to EVERY request rather than being opt-in, because
 * the mistake this helper exists to prevent is a cross-owner test that
 * accidentally runs unauthenticated: it would see 401 everywhere, conclude
 * "refused", and pass while asserting nothing about ownership at all.
 */
export function asOwner(origin: string, subject: string): OwnerAgent {
  const header = principalHeaderValue(subject);

  const request = (method: string, path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${origin}${path}`, {
      ...init,
      method,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        [CLIENT_PRINCIPAL_HEADER]: header,
      },
    });

  const withBody = (method: string, path: string, body?: unknown): Promise<Response> =>
    request(
      method,
      path,
      body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } },
    );

  return {
    subject,
    request,
    get: (path) => request('GET', path),
    post: (path, body) => withBody('POST', path, body),
    patch: (path, body) => withBody('PATCH', path, body),
    delete: (path) => request('DELETE', path),
  };
}
