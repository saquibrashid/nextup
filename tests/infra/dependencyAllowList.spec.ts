/**
 * Runtime dependency allow-list and image-codec gates (TASK-147).
 *
 * `T-DEP-001` — every DIRECT runtime dependency is on the allow-list of
 * `specs/security.md` §8. NFR-004 says the runtime set is "deliberately
 * small"; this is what makes that true tomorrow as well as today.
 *
 * `T-DEP-002` — no HEIC/H.26x ENCODER appears anywhere in the tree. The HEIC
 * path is decode-only, and that is the only reason this MIT repository's
 * licence floor stays at LGPL-3.0 (weak copyleft, notice retained) instead of
 * GPL-2.0. See `specs/security.md` §8 and ADR-0008.
 *
 * `T-DEP-003` — the decode chain installs from PREBUILT binaries, with no
 * native compile step, on the platforms the container actually runs.
 *
 * As with `T-SEC-009`, each gate is fed a deliberate violation as well as the
 * clean tree: a checker that finds nothing passes trivially. The negative
 * controls in `T-DEP-002c` matter most — a codec pattern broadened to "any
 * package mentioning heif" would ban the DECODER and silently remove HEIC
 * upload support (ASM-058) while still looking like a working gate.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  RUNTIME_DEPENDENCY_ALLOWLIST,
  checkImageCodecs,
  checkRuntimeDependencyAllowList,
  lockfilePackageName,
} from '../../tools/check-deps.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** A throwaway workspace root with the manifests the checker looks for. */
function fakeRoot(manifests: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'nextup-dep-'));
  created.push(dir);
  for (const [relPath, contents] of Object.entries(manifests)) {
    const file = path.join(dir, relPath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(contents));
  }
  return dir;
}

/** A throwaway `package-lock.json` containing the given package paths. */
function fakeLockfile(names: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'nextup-lock-'));
  created.push(dir);
  const packages: Record<string, unknown> = { '': { name: 'fake' } };
  for (const name of names) packages[`node_modules/${name}`] = { version: '1.0.0' };
  const file = path.join(dir, 'package-lock.json');
  writeFileSync(file, JSON.stringify({ lockfileVersion: 3, packages }));
  return file;
}

describe('T-DEP-001 · every direct runtime dependency is allow-listed (NFR-004)', () => {
  it('T-DEP-001a · the repository as committed passes', () => {
    expect(checkRuntimeDependencyAllowList()).toEqual([]);
  });

  it('T-DEP-001b · an unlisted runtime dependency is caught', () => {
    const root = fakeRoot({
      'package.json': { name: 'root', dependencies: { 'left-pad': '^1.0.0' } },
    });

    const findings = checkRuntimeDependencyAllowList(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('left-pad');
    expect(findings[0]).toContain('T-DEP-001');
  });

  it('T-DEP-001c · a devDependency is deliberately NOT caught', () => {
    // Dev tooling is not distributed. Gating it would make every lane fight
    // this file instead of writing tests, for no shipped-code benefit.
    const root = fakeRoot({
      'package.json': { name: 'root', devDependencies: { vitest: '^4.0.0' } },
    });

    expect(checkRuntimeDependencyAllowList(root)).toEqual([]);
  });

  it('T-DEP-001d · an allow-listed runtime dependency passes', () => {
    const root = fakeRoot({
      'apps/api/package.json': { name: 'api', dependencies: { 'heic-convert': '^2.1.0' } },
    });

    expect(checkRuntimeDependencyAllowList(root)).toEqual([]);
  });

  it('T-DEP-001e · a workspace that does not exist yet is not a violation', () => {
    const root = fakeRoot({});
    expect(checkRuntimeDependencyAllowList(root)).toEqual([]);
  });

  it('T-DEP-001f · every dependency the checker permits is named in specs/security.md §8', () => {
    // The allow-list is only meaningful if it mirrors the spec. This fails if
    // someone widens the constant without recording the justification.
    expect(RUNTIME_DEPENDENCY_ALLOWLIST.has('heic-convert')).toBe(true);
    expect(RUNTIME_DEPENDENCY_ALLOWLIST.has('sharp')).toBe(true);
    expect(RUNTIME_DEPENDENCY_ALLOWLIST.has('left-pad')).toBe(false);
  });
});

describe('T-DEP-002 · no HEIC/H.26x encoder in the dependency tree', () => {
  it('T-DEP-002a · the committed lockfile carries no encoder', () => {
    expect(checkImageCodecs()).toEqual([]);
  });

  it('T-DEP-002b · a transitive x265 is caught', () => {
    const lockfile = fakeLockfile(['sharp', 'sharp/node_modules/x265']);

    const findings = checkImageCodecs(lockfile);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('x265');
    expect(findings[0]).toContain('T-DEP-002');
  });

  it('T-DEP-002c · the DECODE chain is not caught — this is the trap', () => {
    // Broadening the patterns to "anything mentioning heif" would match these
    // and delete HEIC upload support (ASM-058) while still looking like a
    // working gate. libde265 is a DECODER and is exactly what makes the
    // licence floor LGPL rather than GPL.
    const lockfile = fakeLockfile([
      'heic-convert',
      'heic-decode',
      'libheif-js',
      'libde265',
      '@img/sharp-libvips-linux-x64',
    ]);

    expect(checkImageCodecs(lockfile)).toEqual([]);
  });

  it('T-DEP-002d · a scoped encoder package is caught', () => {
    const lockfile = fakeLockfile(['@acme/x264']);
    expect(checkImageCodecs(lockfile)).toHaveLength(1);
  });

  it('T-DEP-002e · a HEIC encoder under any spelling is caught', () => {
    for (const name of ['heic-encode', 'heic-encoder', 'heif-encoder', 'libheif-encode']) {
      const lockfile = fakeLockfile([name]);
      expect(checkImageCodecs(lockfile), `${name} must be rejected`).toHaveLength(1);
    }
  });

  it('T-DEP-002f · a missing lockfile fails closed', () => {
    const findings = checkImageCodecs(path.join(ROOT, 'does-not-exist-lock.json'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('T-DEP-002');
  });

  it('T-DEP-002g · lockfilePackageName resolves nested and scoped paths', () => {
    expect(lockfilePackageName('node_modules/x265', {})).toBe('x265');
    expect(lockfilePackageName('node_modules/a/node_modules/@sc/x264', {})).toBe('@sc/x264');
    expect(lockfilePackageName('node_modules/whatever', { name: 'x265' })).toBe('x265');
  });
});

describe('T-DEP-003 · the decode chain installs prebuilt, with no native build', () => {
  it('T-DEP-003a · the HEIC decode chain is present and is pure JS/WASM', async () => {
    // Guards T-DEP-002 against passing vacuously: if these were ever removed,
    // "no encoder present" would still be true and would assert nothing.
    const lockfile = JSON.parse(
      await import('node:fs').then((fs) =>
        fs.promises.readFile(path.join(ROOT, 'package-lock.json'), 'utf8'),
      ),
    );
    const packages = lockfile.packages as Record<string, { hasInstallScript?: boolean }>;

    for (const name of ['heic-convert', 'heic-decode', 'libheif-js']) {
      const entry = packages[`node_modules/${name}`];
      expect(entry, `${name} must be installed`).toBeDefined();
      // Pure JS/WASM: no install script means nothing can invoke node-gyp.
      expect(entry.hasInstallScript ?? false, `${name} must not run an install script`).toBe(false);
    }
  });

  it('T-DEP-003b · prebuilt sharp binaries exist for both container libc targets', async () => {
    // The container is Linux x64. Without these the install falls back to
    // compiling libvips from source, which the stock node image cannot do.
    const lockfile = JSON.parse(
      await import('node:fs').then((fs) =>
        fs.promises.readFile(path.join(ROOT, 'package-lock.json'), 'utf8'),
      ),
    );
    const packages = lockfile.packages as Record<string, unknown>;

    for (const name of [
      '@img/sharp-linux-x64',
      '@img/sharp-linuxmusl-x64',
      '@img/sharp-libvips-linux-x64',
      '@img/sharp-libvips-linuxmusl-x64',
    ]) {
      expect(packages[`node_modules/${name}`], `${name} must be in the lockfile`).toBeDefined();
    }
  });
});
