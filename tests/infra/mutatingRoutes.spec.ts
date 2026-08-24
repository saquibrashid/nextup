/**
 * Mutating-route registry vs the REQ-041 closed enumeration (TASK-121).
 *
 * `T-MUT-001` — US-036 AC-1/AC-3 — every mutating route maps to an entry in
 * the REQ-041 enumeration, asserted from a committed list; a new mutating
 * route fails until added, and an operation outside the enumeration cannot be
 * registered.
 *
 * `T-MUT-002` — US-036 AC-4 — no auto-confirm, auto-restore or auto-suppress
 * path exists: `restoreListing`, `createTitle` and `suppress` have only their
 * sanctioned call sites.
 *
 * The mutation for `T-MUT-001` is the one that matters: a mutating route that
 * exists on the router and NOT in the registry must fail the gate. A registry
 * that only ever sees routes it already knows about has asserted nothing.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { createApiRouter } from '../../apps/api/src/routes/index.js';
import {
  FORBIDDEN_CALLER_DIRS,
  GUARDED_OPERATIONS,
  MUTATING_METHODS,
  MUTATING_ROUTE_REGISTRY,
  PERMITTED_BACKGROUND_PROCESSES,
  REQ_041_OPERATIONS,
  checkGuardedCallSites,
  checkMutatingRoutes,
  checkRegistryAgainstReq041,
  normalisePath,
} from '../../tools/check-mutating-routes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'tools', 'check-mutating-routes.mjs');

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

interface RouteRef {
  method: string;
  path: string;
}

/**
 * Enumerate routes from a live Express router.
 *
 * Reading the router rather than a hand-kept list is the whole point: a route
 * added by any lane is covered the moment it is registered, with no edit here.
 */
export function enumerateRoutes(router: Router, prefix = '/api'): RouteRef[] {
  const out: RouteRef[] = [];
  const stack = (router as unknown as { stack?: unknown[] }).stack ?? [];

  for (const layer of stack as {
    route?: { path?: string; methods?: Record<string, boolean> };
    handle?: { stack?: unknown[] };
    regexp?: RegExp;
  }[]) {
    if (layer.route?.path !== undefined) {
      for (const [method, on] of Object.entries(layer.route.methods ?? {})) {
        if (!on || method === '_all') continue;
        out.push({ method: method.toUpperCase(), path: `${prefix}${layer.route.path}` });
      }
    } else if (layer.handle?.stack) {
      out.push(...enumerateRoutes(layer.handle as unknown as Router, prefix));
    }
  }
  return out;
}

/** A router carrying one route, for feeding the checker a violation. */
function routerWith(method: 'post' | 'patch' | 'delete' | 'get', routePath: string): Router {
  const r = Router();
  r[method](routePath, (_req, res) => {
    res.status(204).end();
  });
  return r;
}

describe('T-MUT-001 · US-036 AC-1/AC-3 · REQ-041 is a closed enumeration (PRD §7.4)', () => {
  it('T-MUT-001a · the shipped router registers no unregistered mutating route', () => {
    const findings = checkMutatingRoutes(enumerateRoutes(createApiRouter()));
    expect(findings).toEqual([]);
  });

  it('T-MUT-001b · a mutating route absent from the registry FAILS the gate', () => {
    // The mutation. Without it, the registry only ever sees routes it already
    // knows about and has asserted nothing at all.
    const findings = checkMutatingRoutes(
      enumerateRoutes(routerWith('post', '/titles/:titleId/auto-confirm')),
    );
    expect(findings.some((f: string) => f.includes('auto-confirm'))).toBe(true);
  });

  it('T-MUT-001c · every mutating verb is checked, not just POST', () => {
    // A convenience endpoint is as likely to be a PATCH or a DELETE.
    const missed = (['post', 'patch', 'delete'] as const).filter(
      (m) => checkMutatingRoutes(enumerateRoutes(routerWith(m, '/sneaky'))).length === 0,
    );
    expect(missed, 'these verbs would slip past the gate').toEqual([]);
    expect([...MUTATING_METHODS].sort()).toEqual(['DELETE', 'PATCH', 'POST', 'PUT']);
  });

  it('T-MUT-001d · a GET is NOT flagged — reads change nothing', () => {
    // If reads tripped the gate, the registry would fill with read routes and
    // the mutating list would stop meaning anything.
    const findings = checkMutatingRoutes(enumerateRoutes(routerWith('get', '/anything')));
    expect(findings).toEqual([]);
  });

  it('T-MUT-001e · the enumeration holds exactly the eight REQ-041 operations', () => {
    expect(REQ_041_OPERATIONS).toHaveLength(8);
    expect(REQ_041_OPERATIONS.map((o: { op: string }) => o.op).sort()).toEqual([
      'close-batch',
      'confirm-removal-group',
      'fix-match',
      'restore-listing',
      'suppress',
      'undo-batch',
      'undo-removal-group',
      'unsuppress',
    ]);
  });

  it('T-MUT-001f · exactly three non-owner background processes are permitted', () => {
    // Invariant 5: no scheduler may change user-visible list state. The only
    // permitted background work is metadata-only lazy refresh (TMDB fields,
    // and since ADR-0011 the IMDb rating) and the 30-day blob purge.
    //
    // ⚠ The count is the tripwire, not the rule. Each of the three is
    // permitted because it cannot add, remove, reorder or re-badge a row —
    // and the rating specifically is display-only (ADR-0011 OQ-A: no sort by
    // rating), which is what keeps it on this side of invariant 5.
    expect(PERMITTED_BACKGROUND_PROCESSES).toHaveLength(3);
    expect(PERMITTED_BACKGROUND_PROCESSES.map((p: { op: string }) => p.op).sort()).toEqual([
      'imdb-rating-refresh',
      'screenshot-purge',
      'tmdb-metadata-refresh',
    ]);

    // None of them is an owner operation, and none shadows one.
    const ops = new Set(REQ_041_OPERATIONS.map((o: { op: string }) => o.op));
    for (const p of PERMITTED_BACKGROUND_PROCESSES as Array<{ op: string }>) {
      expect(ops.has(p.op)).toBe(false);
    }
  });

  it('T-MUT-001g · every REQ-041 operation is reachable by exactly one route', () => {
    expect(checkRegistryAgainstReq041()).toEqual([]);
  });

  it('T-MUT-001h · an operation outside the enumeration cannot be registered', () => {
    // US-036 AC-3 quantifies over operations that DO NOT EXIST, so it is
    // asserted by construction: a route claiming an unlisted operation is a
    // finding, which is what makes the list closed rather than indicative.
    const widened = [
      ...MUTATING_ROUTE_REGISTRY,
      {
        method: 'POST',
        path: '/api/titles/:titleId/auto-suppress',
        changesListState: true,
        op: 'auto-suppress',
      },
    ];
    const findings = checkRegistryAgainstReq041(widened);
    expect(findings.some((f: string) => f.includes('auto-suppress'))).toBe(true);
    expect(findings.some((f: string) => f.includes('not one of the eight'))).toBe(true);
  });

  it('T-MUT-001i · a REQ-041 operation left unreachable is caught', () => {
    // The reverse drift: the enumeration and the surface parting company in
    // the other direction, which would leave an owner action unimplemented
    // while the gate reported success.
    const shrunk = MUTATING_ROUTE_REGISTRY.filter(
      (r: { op?: string }) => r.op !== 'restore-listing',
    );
    const findings = checkRegistryAgainstReq041(shrunk);
    expect(findings.some((f: string) => f.includes('restore-listing'))).toBe(true);
    expect(findings.some((f: string) => f.includes('reachable by no route'))).toBe(true);
  });

  it('T-MUT-001j · a list-changing route naming NO operation is caught', () => {
    const bad = [
      ...MUTATING_ROUTE_REGISTRY,
      { method: 'POST', path: '/api/whatever', changesListState: true },
    ];
    const findings = checkRegistryAgainstReq041(bad);
    expect(findings.some((f: string) => f.includes('names no REQ-041 operation'))).toBe(true);
  });

  it('T-MUT-001k · an unexplained non-list-state exemption is caught', () => {
    // Declaring a route "doesn't touch the list" with no reason is exactly how
    // the enumeration gets widened by accident.
    const bad = [
      ...MUTATING_ROUTE_REGISTRY,
      { method: 'POST', path: '/api/whatever', changesListState: false },
    ];
    const findings = checkRegistryAgainstReq041(bad);
    expect(findings.some((f: string) => f.includes('gives no reason'))).toBe(true);
  });

  it('T-MUT-001l · parameter naming differences are not reported as drift', () => {
    // `:titleId` vs `:id` is not a new route. If it were reported as one, the
    // registry would be edited to silence noise and would stop being trusted.
    expect(normalisePath('/api/titles/:titleId/suppress')).toBe(
      normalisePath('/api/titles/:id/suppress'),
    );
    const findings = checkMutatingRoutes([{ method: 'POST', path: '/api/titles/:id/suppress' }]);
    expect(findings).toEqual([]);
  });

  it('T-MUT-001m · the registry covers every mutating route in specs/api.md §4', () => {
    // Drift between the spec's route index and the registry would leave a real
    // route unregistered and the gate quiet about it.
    const registered = new Set(
      MUTATING_ROUTE_REGISTRY.map(
        (r: { method: string; path: string }) => `${r.method} ${normalisePath(r.path)}`,
      ),
    );
    const fromSpec = [
      'POST /api/titles/:id/fix-match',
      'POST /api/titles/:id/suppress',
      'POST /api/suppressions/:id/unsuppress',
      'POST /api/listings/:id/restore',
      'POST /api/batches',
      'POST /api/batches/:id/images',
      'DELETE /api/batches/:id/images/:imageId',
      'POST /api/batches/:id/submit',
      'POST /api/batches/:id/retry-extraction',
      'PATCH /api/batches/:id/candidates/:candidateId',
      'POST /api/batches/:id/candidates/confirm-all',
      'POST /api/batches/:id/manual-entry',
      'PATCH /api/batches/:id/removals',
      'POST /api/batches/:id/close',
      'POST /api/batches/:id/discard',
      'POST /api/batches/:id/re-extract',
      'POST /api/batches/:id/undo',
      'POST /api/removal-groups/:id/undo',
    ].map((s) => {
      const [method, p] = s.split(' ');
      return `${method as string} ${normalisePath(p as string)}`;
    });
    const missing = fromSpec.filter((r) => !registered.has(r));
    expect(missing, 'specs/api.md §4 mutating routes absent from the registry').toEqual([]);
  });

  it('T-MUT-001n · the script exits non-zero on a registry violation', () => {
    let exitCode = 0;
    try {
      execFileSync(
        process.execPath,
        [
          '-e',
          `const m = await import(${JSON.stringify(SCRIPT.split(path.sep).join('/'))});` +
            `const bad = [...m.MUTATING_ROUTE_REGISTRY, { method: 'POST', path: '/api/x', changesListState: true, op: 'nope' }];` +
            `if (m.checkRegistryAgainstReq041(bad).length > 0) process.exit(1);`,
        ],
        { cwd: ROOT, stdio: 'pipe' },
      );
    } catch (err) {
      exitCode = (err as { status?: number }).status ?? -1;
    }
    expect(exitCode).toBe(1);
  });

  it('T-MUT-001o · the script exits zero on the committed registry', () => {
    const out = execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, stdio: 'pipe' });
    expect(out.toString()).toContain('Mutating-route check passed');
  });
});

describe('T-MUT-002 · US-036 AC-4 · no auto-confirm, auto-restore or auto-suppress path', () => {
  it('T-MUT-002a · no guarded operation has an unsanctioned call site today', async () => {
    const findings = await checkGuardedCallSites();
    expect(findings).toEqual([]);
  });

  it('T-MUT-002b · a scheduler calling restoreListing is caught', async () => {
    // Invariant 7: restore is an explicit user action only, NEVER an automatic
    // consequence of reconciliation. This is the mutation that proves it.
    const root = mkdtempSync(path.join(tmpdir(), 'nextup-autorestore-'));
    created.push(root);
    const file = path.join(root, 'apps', 'api', 'src', 'jobs', 'reconcile.ts');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'export async function run() {\n  await restoreListing(ownerId, id);\n}\n');

    const findings = await checkGuardedCallSites(root);
    expect(findings.some((f: string) => f.includes('restoreListing'))).toBe(true);
    expect(findings.some((f: string) => f.includes('jobs/reconcile.ts'))).toBe(true);
  });

  it('T-MUT-002c · each of the three guarded operations is detected', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nextup-guarded-'));
    created.push(root);
    const file = path.join(root, 'apps', 'api', 'src', 'scheduler', 'nightly.ts');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      'await restoreListing(a, b);\nawait createTitle(a, b);\nawait suppress(a, b);\n',
    );

    const findings = await checkGuardedCallSites(root);
    const missed = GUARDED_OPERATIONS.filter(
      (g: { name: string }) => !findings.some((f: string) => f.includes(g.name)),
    ).map((g: { name: string }) => g.name);
    expect(missed, 'these operations can be auto-invoked unnoticed').toEqual([]);
  });

  it('T-MUT-002d · the extraction pipeline may not create a Title either', async () => {
    // Extraction proposes candidates; only closing a REVIEWED batch creates a
    // Title. An extraction-time createTitle would apply changes the owner has
    // not seen, which is invariant 2's failure mode.
    const root = mkdtempSync(path.join(tmpdir(), 'nextup-extract-'));
    created.push(root);
    const file = path.join(root, 'apps', 'api', 'src', 'extraction', 'apply.ts');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'await createTitle(ownerId, candidate);\n');

    const findings = await checkGuardedCallSites(root);
    expect(findings.some((f: string) => f.includes('createTitle'))).toBe(true);
  });

  it('T-MUT-002e · a sanctioned route handler call is NOT flagged', async () => {
    // The accept half. A check that flags every call site would be disabled
    // the first time the feature was implemented.
    const root = mkdtempSync(path.join(tmpdir(), 'nextup-sanctioned-'));
    created.push(root);
    const file = path.join(root, 'apps', 'api', 'src', 'routes', 'listings.ts');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'router.post("/listings/:id/restore", () => restoreListing(a, b));\n');

    const findings = await checkGuardedCallSites(root);
    expect(findings).toEqual([]);
  });

  it('T-MUT-002f · a mere import or type reference is not reported as a call', async () => {
    // `import { suppress }` in a barrel file is not an auto-suppress path, and
    // reporting it would train everyone to ignore the gate.
    const root = mkdtempSync(path.join(tmpdir(), 'nextup-import-'));
    created.push(root);
    const file = path.join(root, 'apps', 'api', 'src', 'jobs', 'types.ts');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'import { suppress } from "../repository/ownerData.js";\n');

    const findings = await checkGuardedCallSites(root);
    expect(findings).toEqual([]);
  });

  it('T-MUT-002g · every forbidden caller directory is actually matched', () => {
    const dirs = [
      'apps/api/src/jobs/x.ts',
      'apps/api/src/scheduler/x.ts',
      'apps/api/src/workers/x.ts',
      'apps/api/src/tasks/x.ts',
      'apps/api/src/cron/x.ts',
      'apps/api/src/extraction/x.ts',
      'apps/api/src/ai/x.ts',
    ];
    const unmatched = dirs.filter((d) => !FORBIDDEN_CALLER_DIRS.some((re: RegExp) => re.test(d)));
    expect(unmatched, 'these directories could host an automatic mutation').toEqual([]);
  });
});
