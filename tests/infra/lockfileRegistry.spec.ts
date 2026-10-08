/**
 * Lockfile registry-host gate (issue #417 — `T-CI-011`).
 *
 * `main` once carried **442 `resolved` URLs** naming the internal Microsoft
 * proxy feed, which silently disabled Dependabot for every affected package
 * while all twelve CI jobs stayed green. Repaired in #416; this is the gate
 * that stops it recurring.
 *
 * ⚠ **These tests assert THE CHECK WORKS, not merely that the repository is
 * currently clean.** A clean repository passes a check that does nothing, and
 * this is a defect class CI is structurally blind to — the proxy feed is
 * anonymously readable, so a contaminated lockfile installs perfectly and
 * every job passes. Each test therefore feeds the checker a deliberate
 * violation in a temporary directory and requires it to be caught.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  ALLOWED_REGISTRY_HOSTS,
  checkLockfile,
  checkLockfileRegistry,
  offendingEntries,
} from '../../tools/check-lockfile-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'tools', 'check-lockfile-registry.mjs');

/**
 * The contaminated host shape, assembled rather than written as a literal.
 *
 * ⚠ Not an aesthetic choice. `tools/check-no-credentials.mjs` and this gate
 * both walk the repository, and a spec file is a file: writing the proxy host
 * as one literal string here is indistinguishable, to a future grep-based
 * gate, from the defect itself.
 */
const PROXY_HOST = ['ms-feed-25', 'pkgs', 'visualstudio', 'com'].join('.');
const PROXY_URL = `https://${PROXY_HOST}/1es-public/_packaging/npm-public/npm/registry/left-pad/-/left-pad-1.3.0.tgz`;
const PUBLIC_URL = 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz';

/** Temp workspaces created inside the repo, so the checker actually walks them. */
const created: string[] = [];

/**
 * ⚠ Sweep stale scratch dirs first. `afterEach` cannot run when a run is
 * INTERRUPTED (Ctrl-C, a killed watcher, a crashed worker), and a leftover
 * `.tmp-lockreg-*` holding a contaminated lockfile makes the NEXT run fail the
 * "repository as committed is clean" case for a reason unrelated to the change
 * under test. Same hazard, and same remedy, as `tests/infra/supplyChain.spec.ts`.
 */
beforeAll(() => {
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('.tmp-lockreg-')) {
      rmSync(path.join(ROOT, entry.name), { recursive: true, force: true });
    }
  }
});

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * ⚠ The scratch dirs are named `.tmp-*` and live in the repo ROOT, and the
 * violation tests pass the scratch dir to the checker as its root rather than
 * relying on the repository walk to find it.
 *
 * Both halves are load-bearing. The `.tmp-` prefix is what the other infra
 * gates (`check-no-credentials`, `check-deps`, and this one) skip, so a
 * deliberately planted violation cannot fail somebody else's spec running in
 * a parallel worker — and, symmetrically, it is why the default walk cannot
 * reach these dirs, hence the explicit root.
 */
function scratchDir(): string {
  const dir = mkdtempSync(path.join(ROOT, '.tmp-lockreg-'));
  created.push(dir);
  return dir;
}

function writeLock(dir: string, lock: unknown, name = 'package-lock.json'): void {
  writeFileSync(path.join(dir, name), JSON.stringify(lock, null, 2));
}

describe('T-CI-011 · no lockfile may resolve through a private registry (issue #417)', () => {
  it('T-CI-011a · the repository as committed is clean', async () => {
    const findings = await checkLockfileRegistry();
    expect(findings).toEqual([]);
  });

  it('T-CI-011b · a proxy-feed resolved URL is caught', async () => {
    // The exact defect: one `resolved` repointed at the internal feed. On the
    // real lockfile this happened 442 times and nothing in CI noticed.
    const dir = scratchDir();
    writeLock(dir, {
      lockfileVersion: 3,
      packages: { 'node_modules/left-pad': { version: '1.3.0', resolved: PROXY_URL } },
    });

    const findings = await checkLockfileRegistry(dir);
    expect(findings.some((f) => f.includes(PROXY_HOST))).toBe(true);
  });

  it('T-CI-011c · a public resolved URL is NOT flagged', async () => {
    // The discriminating half. Without it, `b` passes against a checker that
    // rejects every lockfile it is shown.
    const dir = scratchDir();
    writeLock(dir, {
      lockfileVersion: 3,
      packages: { 'node_modules/left-pad': { version: '1.3.0', resolved: PUBLIC_URL } },
    });

    const findings = await checkLockfileRegistry(dir);
    expect(findings).toEqual([]);
  });

  it('T-CI-011d · workspace links and file: specifiers are NOT registry references', () => {
    // npm writes a workspace-RELATIVE PATH for each linked workspace
    // (`"resolved": "apps/api"`). This repo has four. Treating those as
    // violations would fail the clean tree, so the parse failure is the
    // allowed case, not the caught one.
    const findings = checkLockfile(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'nextup' },
          'apps/api': { name: '@nextup/api' },
          'node_modules/@nextup/api': { resolved: 'apps/api', link: true },
          'node_modules/local-thing': { resolved: 'file:../local-thing' },
          'node_modules/left-pad': { version: '1.3.0', resolved: PUBLIC_URL },
        },
      }),
      'package-lock.json',
    );
    expect(findings).toEqual([]);
  });

  it('T-CI-011e · ANY non-public host is caught, not just the one we have seen', () => {
    // ⚠ The gate is an ALLOW-LIST, and this is the test that pins it as one.
    // Rewritten as a denylist of `ms-feed-*` it would still pass `b` and `c`
    // while waving through the next proxy to leak in — which is precisely how
    // this defect arrived undetected the first time.
    const hosts = [
      'packagefeedproxy.microsoft.io',
      'npm.pkg.github.com',
      'artifactory.example.corp',
    ];
    for (const host of hosts) {
      const findings = checkLockfile(
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            'node_modules/left-pad': { resolved: `https://${host}/left-pad/-/left-pad-1.3.0.tgz` },
          },
        }),
        'package-lock.json',
      );
      expect(
        findings.some((f) => f.includes(host)),
        `${host} was not caught`,
      ).toBe(true);
    }
  });

  it('T-CI-011f · a lockfileVersion 1/2 nested dependencies tree is walked too', () => {
    // v1 and v2 carry a nested `dependencies` tree alongside (or instead of)
    // `packages`. Reading only `packages` would miss a contaminated v1
    // lockfile entirely, and the gate would pass vacuously on it.
    const findings = checkLockfile(
      JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          outer: {
            version: '1.0.0',
            resolved: PUBLIC_URL,
            dependencies: { inner: { version: '1.3.0', resolved: PROXY_URL } },
          },
        },
      }),
      'package-lock.json',
    );
    expect(findings.some((f) => f.includes('outer > inner'))).toBe(true);
  });

  it('T-CI-011g · npm-shrinkwrap.json is checked, not only package-lock.json', async () => {
    // A shrinkwrap takes precedence over a lockfile at install time, so a gate
    // that reads only `package-lock.json` can be bypassed by committing one.
    const dir = scratchDir();
    writeLock(
      dir,
      {
        lockfileVersion: 3,
        packages: { 'node_modules/left-pad': { resolved: PROXY_URL } },
      },
      'npm-shrinkwrap.json',
    );

    const findings = await checkLockfileRegistry(dir);
    expect(findings.some((f) => f.includes('npm-shrinkwrap.json'))).toBe(true);
  });

  it('T-CI-011h · the failure message names the remedy and the consequence', () => {
    // A gate whose message only says "wrong host" gets fixed by an `npm
    // install`, which is the action that CAUSES this defect. The message must
    // point at the §6a host rewrite and say what was actually broken.
    const findings = checkLockfile(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/left-pad': { resolved: PROXY_URL } },
      }),
      'package-lock.json',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/DISABLES DEPENDABOT/);
    expect(findings[0]).toMatch(/§6a/);
    expect(findings[0]).toMatch(/no npm install/);
  });

  it('T-CI-011i · many offending entries collapse to one line per host', () => {
    // The real contamination was 442 entries across four hosts. A finding per
    // entry is 442 lines of scrollback, which is a failure nobody reads.
    const packages: Record<string, { resolved: string }> = {};
    for (let i = 0; i < 50; i++) {
      packages[`node_modules/pkg-${i}`] = { resolved: PROXY_URL };
    }
    const findings = checkLockfile(JSON.stringify({ lockfileVersion: 3, packages }), 'x.json');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/50 "resolved" URL\(s\)/);
  });

  it('T-CI-011j · the allow-list is exactly the public registry', () => {
    // Pins the allow-list itself. Widening it is a decision about where this
    // project's supply chain comes from and must not pass unnoticed: every
    // committed `integrity` hash was computed against this host.
    expect(ALLOWED_REGISTRY_HOSTS).toEqual(['registry.npmjs.org']);
  });

  it('T-CI-011k · the script exits non-zero on a violation', async () => {
    // The vitest-level checks call the exported function; CI calls the script.
    // A checker that finds violations but exits 0 blocks nothing.
    const dir = scratchDir();
    writeLock(dir, {
      lockfileVersion: 3,
      packages: { 'node_modules/left-pad': { resolved: PROXY_URL } },
    });

    expect(() => execFileSync(process.execPath, [SCRIPT, dir], { stdio: 'pipe' })).toThrow();
  });

  it('T-CI-011l · the script exits zero on the clean tree', () => {
    expect(() => execFileSync(process.execPath, [SCRIPT], { stdio: 'pipe' })).not.toThrow();
  });

  it('T-CI-011m · offendingEntries reports WHERE, so a 442-entry diff is navigable', () => {
    const found = offendingEntries({
      lockfileVersion: 3,
      packages: { 'node_modules/@scope/thing': { resolved: PROXY_URL } },
    });
    expect(found).toEqual([{ host: PROXY_HOST, where: 'node_modules/@scope/thing' }]);
  });
});

describe('T-CI-011 · no .npmrc is committed (issue #417 open question 2)', () => {
  it('T-CI-011n · a committed .npmrc is caught', async () => {
    // The second route to the same contamination: a repo-level `registry=`
    // line. An `.npmrc` can also carry an `_authToken`, and this repository is
    // public.
    const dir = scratchDir();
    writeFileSync(path.join(dir, '.npmrc'), 'registry=https://example.invalid/npm/\n');

    const findings = await checkLockfileRegistry(dir);
    expect(findings.some((f) => f.includes('.npmrc'))).toBe(true);
  });

  it('T-CI-011o · the .npmrc message points at the USER-level file', async () => {
    // Without this, the obvious "fix" is to keep the file and delete the
    // registry line — which leaves the hazard in place for the next person who
    // needs a proxy.
    const dir = scratchDir();
    writeFileSync(path.join(dir, '.npmrc'), '# empty\n');

    const findings = await checkLockfileRegistry(dir);
    const npmrc = findings.find((f) => f.includes('.npmrc'));
    expect(npmrc).toBeDefined();
    expect(npmrc).toMatch(/~\/\.npmrc/);
  });

  it('T-CI-011p · an .npmrc is caught regardless of its contents', async () => {
    // The rule is ABSENCE, not "absence of a registry line". A file that is
    // harmless today is a file someone adds a registry line to tomorrow, and
    // the diff that does it is one line nobody reviews.
    const dir = scratchDir();
    writeFileSync(path.join(dir, '.npmrc'), 'save-exact=true\n');

    const findings = await checkLockfileRegistry(dir);
    expect(findings.some((f) => f.includes('.npmrc'))).toBe(true);
  });
});
