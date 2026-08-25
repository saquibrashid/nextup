/**
 * Mutating-route registry vs the REQ-041 closed enumeration
 * (TASK-121 — `T-MUT-001`, `T-MUT-002`).
 *
 * **REQ-041 is a CLOSED list.** PRD §7.4 enumerates exactly eight owner-
 * initiated operations that may change user-visible list state, and exactly
 * three non-owner processes that may exist at all — none of which changes
 * list state. *"Anything not on these lists is forbidden by default. REQ-041
 * has already been widened five times during requirements work; widening it
 * again is an explicit amendment, not an implementation decision."*
 *
 * That sentence is unenforceable by review. A convenience endpoint reads as a
 * feature in a diff and as a breach of G-4 only if someone remembers REQ-041.
 * So the enumeration is committed here as data, and every mutating route the
 * Express router actually registers is checked against it. **A new mutating
 * route fails this gate until it is added — deliberately.** Adding a line here
 * is the "explicit amendment" the PRD demands, and it is visible in review.
 *
 * ⚠ **Two kinds of mutating route, and conflating them destroys the gate.**
 * Not every POST changes list state: attaching an image to an open batch,
 * re-running extraction and discarding a draft all mutate *something*, and
 * none of them touches the list. Those are declared with
 * `changesListState: false` and a reason. If they were simply omitted, a route
 * that DOES change list state could be smuggled in under the same shape; if
 * they were counted as list mutations, the eight-operation count would be
 * meaningless. Both columns are asserted.
 *
 * Usage: `node tools/check-mutating-routes.mjs` → exit 0 clean, exit 1 findings.
 */

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * PRD §7.4 — the eight owner-initiated operations that may change
 * user-visible list state. **This list is closed.**
 */
export const REQ_041_OPERATIONS = [
  {
    id: 1,
    op: 'close-batch',
    story: 'US-005, US-012',
    what: 'Closing a batch, applying confirmed additions and corrections',
  },
  {
    id: 2,
    op: 'confirm-removal-group',
    story: 'US-015, US-016',
    what: 'Confirming a removal group within a closed full-update batch',
  },
  { id: 3, op: 'undo-removal-group', story: 'US-017', what: 'Undoing a confirmed removal group' },
  {
    id: 4,
    op: 'restore-listing',
    story: 'US-025',
    what: 'Restoring a removed listing from the removed view',
  },
  { id: 5, op: 'fix-match', story: 'US-030', what: 'Fix-match on a Title' },
  { id: 6, op: 'undo-batch', story: 'US-032', what: 'Undoing a creates-only batch' },
  { id: 7, op: 'suppress', story: 'US-027', what: 'Suppressing a work' },
  { id: 8, op: 'unsuppress', story: 'US-029', what: 'Un-suppressing a work' },
];

/**
 * PRD §7.4 — the only THREE non-owner-initiated processes permitted to exist,
 * none of which changes user-visible list state. Invariant 5 of the
 * contributor instructions restates this as a hard rule.
 *
 * ⚠ THE TEST IS NOT THE COUNT — IT IS `changes user-visible LIST state`.
 * Invariant 5 forbids a scheduler touching membership, ordering or service
 * badges. All three entries below are metadata- or bytes-only, access- or
 * time-triggered, and none of them can add, remove, reorder or re-badge a row.
 * A fourth entry is admissible only on the same terms, and is an amendment to
 * PRD §7.4 rather than an implementation decision.
 *
 * ~~Superseded (Epic M): "the only two non-owner-initiated processes."~~
 * ADR-0011 added the IMDb rating refresh, which is the same shape as the TMDB
 * one it sits beside.
 */
export const PERMITTED_BACKGROUND_PROCESSES = [
  {
    op: 'tmdb-metadata-refresh',
    why: 'lazy TMDB metadata refresh on access — TMDB-sourced descriptive fields only (REQ-076, NFR-014)',
  },
  {
    op: 'screenshot-purge',
    why: 'screenshot image purge at 30 days — image bytes only (NFR-019, US-035)',
  },
  {
    op: 'imdb-rating-refresh',
    why: 'lazy IMDb rating refresh on access — a display-only numeric field, never sorted or filtered on (REQ-093, ADR-0011 OQ-A)',
  },
];

/**
 * The registry: every mutating route in `specs/api.md` §4, each mapped either
 * to a REQ-041 operation or explicitly marked as not touching list state.
 *
 * ⚠ A route added to the router but not to this table is a finding. That is
 * the point of the gate, not a maintenance burden to design away.
 */
export const MUTATING_ROUTE_REGISTRY = [
  // — Operations that DO change user-visible list state (REQ-041 §7.4) —
  {
    method: 'POST',
    path: '/api/batches/:batchId/close',
    changesListState: true,
    op: 'close-batch',
  },
  {
    method: 'PATCH',
    path: '/api/batches/:batchId/removals',
    changesListState: true,
    op: 'confirm-removal-group',
  },
  {
    method: 'POST',
    path: '/api/removal-groups/:groupId/undo',
    changesListState: true,
    op: 'undo-removal-group',
  },
  {
    method: 'POST',
    path: '/api/listings/:listingId/restore',
    changesListState: true,
    op: 'restore-listing',
  },
  {
    method: 'POST',
    path: '/api/titles/:titleId/fix-match',
    changesListState: true,
    op: 'fix-match',
  },
  { method: 'POST', path: '/api/batches/:batchId/undo', changesListState: true, op: 'undo-batch' },
  { method: 'POST', path: '/api/titles/:titleId/suppress', changesListState: true, op: 'suppress' },
  {
    method: 'POST',
    path: '/api/suppressions/:suppressionId/unsuppress',
    changesListState: true,
    op: 'unsuppress',
  },

  // — Mutating, but NOT list state. Draft/batch scaffolding only. —
  {
    method: 'POST',
    path: '/api/batches',
    changesListState: false,
    why: 'opens a DRAFT batch; nothing is applied until close (US-005 AC-3)',
  },
  {
    method: 'POST',
    path: '/api/batches/:batchId/images',
    changesListState: false,
    why: 'attaches an image to an open batch — one ingest pipeline, no list effect (US-004)',
  },
  {
    method: 'DELETE',
    path: '/api/batches/:batchId/images/:imageId',
    changesListState: false,
    why: 'detaches an image from an OPEN batch before submission (US-004)',
  },
  {
    method: 'POST',
    path: '/api/batches/:batchId/submit',
    changesListState: false,
    why: 'starts extraction; produces candidates for review, changes no listing (US-005)',
  },
  {
    method: 'POST',
    path: '/api/batches/:batchId/retry-extraction',
    changesListState: false,
    why: 'retries extraction on the same images (US-006)',
  },
  {
    method: 'PATCH',
    path: '/api/batches/:batchId/candidates/:candidateId',
    changesListState: false,
    why: 'edits a REVIEW candidate; the list is untouched until close (US-007, US-012)',
  },
  {
    method: 'POST',
    path: '/api/batches/:batchId/candidates/confirm-all',
    changesListState: false,
    why: 'marks review candidates confirmed; still applied only at close (US-012)',
  },
  {
    method: 'POST',
    path: '/api/batches/:batchId/manual-entry',
    changesListState: false,
    why: 'adds a manually-typed candidate to the open batch (US-009)',
  },
  {
    method: 'POST',
    path: '/api/batches/:batchId/discard',
    changesListState: false,
    why: 'discards an unclosed batch; by definition nothing was applied (US-005)',
  },
  {
    method: 'POST',
    path: '/api/batches/:batchId/re-extract',
    changesListState: false,
    why: 're-runs extraction over an existing batch (US-034)',
  },
];

/** HTTP verbs that can change state. */
export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * `T-MUT-002` — the three list-mutating primitives, and the ONLY modules
 * permitted to call them.
 *
 * The threat is an auto-confirm, auto-restore or auto-suppress path: a
 * reconciliation routine that "helpfully" restores a listing, or a scheduler
 * that suppresses on the owner's behalf. Invariant 7 states it directly —
 * restore is an explicit user action only, never an automatic consequence of
 * reconciliation.
 *
 * A sanctioned call site is a route handler or the service that route handler
 * calls. Anything in `jobs/`, `scheduler/`, `workers/` or the extraction
 * pipeline is not.
 */
export const GUARDED_OPERATIONS = [
  {
    name: 'restoreListing',
    req: 'REQ-041 §7.4 item 4, US-025',
    sanctioned: [
      /^apps\/api\/src\/routes\//,
      /^apps\/api\/src\/services\//,
      /^apps\/api\/src\/repository\//,
    ],
    why: 'restore is an explicit owner action from the removed view; a reappearance creates a NEW row instead (invariant 7, L1/A33)',
  },
  {
    name: 'createTitle',
    req: 'REQ-041 §7.4 item 1, US-005/US-012',
    sanctioned: [
      /^apps\/api\/src\/routes\//,
      /^apps\/api\/src\/services\//,
      /^apps\/api\/src\/repository\//,
    ],
    why: 'a Title is created only by closing a reviewed batch — never by extraction, never by a background pass',
  },
  {
    name: 'suppress',
    req: 'REQ-041 §7.4 item 7, US-027',
    sanctioned: [
      /^apps\/api\/src\/routes\//,
      /^apps\/api\/src\/services\//,
      /^apps\/api\/src\/repository\//,
    ],
    why: 'suppression is keyed on canonical work identity and set only by the owner (REQ-071)',
  },
];

/** Directories that must never call a guarded operation. */
export const FORBIDDEN_CALLER_DIRS = [
  /^apps\/api\/src\/jobs\//,
  /^apps\/api\/src\/scheduler\//,
  /^apps\/api\/src\/workers\//,
  /^apps\/api\/src\/tasks\//,
  /^apps\/api\/src\/cron\//,
  /^apps\/api\/src\/extraction\//,
  /^apps\/api\/src\/ai\//,
];

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'playwright-report',
  'test-results',
]);

export const SELF_REFERENTIAL = new Set([
  'tools/check-mutating-routes.mjs',
  'tests/infra/mutatingRoutes.spec.ts',
]);

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // Transient scratch directories created by mutation tests in OTHER spec
      // files, which run in parallel in the same project. Walking them makes
      // this checker fail on a violation someone else deliberately planted.
      if (entry.name.startsWith('.tmp-')) continue;
      await walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const relTo = (root, p) => path.relative(root, p).split(path.sep).join('/');

/** Normalise a route path so `:id` naming differences are not false drift. */
export function normalisePath(p) {
  return p.replace(/:[A-Za-z0-9_]+/g, ':param').replace(/\/+$/, '') || '/';
}

const keyOf = (method, p) => `${method.toUpperCase()} ${normalisePath(p)}`;

/**
 * `T-MUT-001` — every mutating route REGISTERED by the application maps to an
 * entry in the registry, and every list-state-changing entry maps to a REQ-041
 * operation.
 *
 * @param {{method: string, path: string}[]} registeredRoutes routes enumerated
 *   from the live Express router — see `enumerateRoutes` in the spec.
 * @returns {string[]} findings
 */
export function checkMutatingRoutes(registeredRoutes) {
  const findings = [];
  const known = new Map(MUTATING_ROUTE_REGISTRY.map((r) => [keyOf(r.method, r.path), r]));

  for (const route of registeredRoutes) {
    if (!MUTATING_METHODS.has(route.method.toUpperCase())) continue;
    const key = keyOf(route.method, route.path);
    if (!known.has(key)) {
      findings.push(
        `${key} is registered but is not in the mutating-route registry. REQ-041 is a CLOSED enumeration (PRD §7.4): add the route here and state whether it changes user-visible list state, or do not register it. Widening REQ-041 is an explicit amendment, not an implementation decision (T-MUT-001).`,
      );
    }
  }

  return findings;
}

/**
 * `T-MUT-001` — the registry itself is internally consistent: every REQ-041
 * operation is reachable by exactly one route, and no route claims an
 * operation that REQ-041 does not contain.
 *
 * @param {typeof MUTATING_ROUTE_REGISTRY} [registry]
 * @returns {string[]} findings
 */
export function checkRegistryAgainstReq041(registry = MUTATING_ROUTE_REGISTRY) {
  const findings = [];
  const permitted = new Set(REQ_041_OPERATIONS.map((o) => o.op));

  const claimed = registry.filter((r) => r.changesListState);

  for (const route of claimed) {
    if (!route.op) {
      findings.push(
        `${keyOf(route.method, route.path)} changes list state but names no REQ-041 operation (T-MUT-001)`,
      );
      continue;
    }
    if (!permitted.has(route.op)) {
      findings.push(
        `${keyOf(route.method, route.path)} claims operation "${route.op}", which is not one of the eight in REQ-041 §7.4 (T-MUT-001)`,
      );
    }
  }

  for (const op of permitted) {
    const routes = claimed.filter((r) => r.op === op);
    if (routes.length === 0) {
      findings.push(
        `REQ-041 operation "${op}" is reachable by no route. The enumeration and the surface have drifted (T-MUT-001).`,
      );
    } else if (routes.length > 1) {
      findings.push(
        `REQ-041 operation "${op}" is reachable by ${routes.length} routes: ${routes.map((r) => keyOf(r.method, r.path)).join(', ')}. One operation, one route (T-MUT-001).`,
      );
    }
  }

  for (const route of registry) {
    if (!route.changesListState && !route.why) {
      findings.push(
        `${keyOf(route.method, route.path)} is declared not to change list state but gives no reason. An unexplained exemption is how the enumeration is widened by accident (T-MUT-001).`,
      );
    }
  }

  if (REQ_041_OPERATIONS.length !== 8) {
    findings.push(
      `REQ-041 §7.4 enumerates 8 owner-initiated operations; this list has ${REQ_041_OPERATIONS.length}. The list is CLOSED (T-MUT-001).`,
    );
  }

  if (PERMITTED_BACKGROUND_PROCESSES.length !== 3) {
    findings.push(
      `PRD §7.4 permits exactly three non-owner processes; this list has ${PERMITTED_BACKGROUND_PROCESSES.length}. No scheduler may change user-visible list state (T-MUT-001, T-CI-005).`,
    );
  }

  return findings;
}

/**
 * `T-MUT-002` — `restoreListing`, `createTitle` and `suppress` have only their
 * sanctioned call sites: no auto-confirm, auto-restore or auto-suppress path.
 *
 * @param {string} [root]
 * @returns {Promise<string[]>} findings
 */
export async function checkGuardedCallSites(root = ROOT) {
  const findings = [];
  const files = await walk(path.join(root, 'apps', 'api', 'src'));

  for (const file of files) {
    const rel = relTo(root, file);
    if (SELF_REFERENTIAL.has(rel)) continue;
    if (!['.ts', '.tsx', '.js', '.mjs'].includes(path.extname(file))) continue;

    const text = readFileSync(file, 'utf8');

    for (const guarded of GUARDED_OPERATIONS) {
      // A call, not a mention: `restoreListing(` — an import or a type
      // reference is not a call site and must not be reported as one.
      const call = new RegExp(`\\b${guarded.name}\\s*\\(`);
      if (!call.test(text)) continue;

      const inForbiddenDir = FORBIDDEN_CALLER_DIRS.some((re) => re.test(rel));
      const isSanctioned = guarded.sanctioned.some((re) => re.test(rel));

      if (inForbiddenDir || !isSanctioned) {
        findings.push(
          `${rel}: calls ${guarded.name}(), which is not a sanctioned call site. ${guarded.why} (${guarded.req}, T-MUT-002).`,
        );
      }
    }
  }

  return findings;
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  // The live-router half needs the compiled app and is asserted from the
  // Vitest spec, which can import TypeScript. The CLI covers the two halves
  // that are pure data and pure filesystem.
  const findings = [...checkRegistryAgainstReq041(), ...(await checkGuardedCallSites())];
  if (findings.length > 0) {
    console.error('Mutating-route registry check FAILED:\n');
    for (const f of findings) console.error(`  ✗ ${f}`);
    console.error(`\n${findings.length} finding(s). See docs/PRD.md §7.4 (REQ-041).`);
    process.exit(1);
  }
  console.log('Mutating-route check passed: the registry matches the REQ-041 closed');
  console.log('enumeration, and no guarded operation has an unsanctioned call site.');
}
