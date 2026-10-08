/**
 * Lockfile registry-host gate (issue #417 — `T-CI-011`).
 *
 * ── The defect this exists for ──────────────────────────────────────────────
 *
 * `package-lock.json` on `main` once accumulated **442 `resolved` URLs**
 * pointing at `ms-feed-N.pkgs.visualstudio.com` — the internal Microsoft proxy
 * feed — instead of `registry.npmjs.org`. A local `npm install` on a
 * Microsoft-managed machine resolves through `packagefeedproxy.microsoft.io`
 * and rewrites `resolved` for every package it touches; committing that
 * lockfile publishes internal feed URLs to a PUBLIC repository **and silently
 * disables Dependabot** for every affected package:
 *
 *     Dependabot can't authenticate to a private package registry.
 *     Because of this, Dependabot cannot update this pull request.
 *
 * #403, #404 and #405 sat open for ~9 days and could not be rebased *or*
 * recreated. Repaired in #416; the root cause is recorded in issue #417 and
 * `docs/runbooks/update-dependencies.md` §6a.
 *
 * ⚠ **CI GOING GREEN PROVES NOTHING ABOUT THIS, WHICH IS WHY A GATE IS
 * NEEDED.** The `1es-public` feed is anonymously readable, so GitHub-hosted
 * runners install from those URLs perfectly happily and all twelve jobs pass.
 * The only symptoms are off-PR: `Dependabot Updates` runs ending in `failure`,
 * and Dependabot PRs that quietly refuse to rebase. Nothing a reviewer sees on
 * the pull request says anything is wrong.
 *
 * ── Why THIS gate is justified where the `sha1-` one is not ─────────────────
 *
 * §6 of the runbook argues persuasively against gating on `sha1-` integrity
 * hashes: ~525 entries would fail today and **no remedy is available from a
 * Microsoft-managed machine**, so it would be a broken gate rather than a
 * safety net. The `resolved` URL is the opposite case on every axis — the
 * violation is introduced one commit at a time, and the remedy is the §6a host
 * rewrite: mechanical, offline, and always available.
 *
 * ⚠ **This gate keys on the URL, and must never be re-pointed at `sha1-`.**
 * After #416 the two populations no longer correlate: `main` carries ~412
 * `sha1-` hashes and ZERO proxy URLs. A check written against `sha1-` would
 * fail the clean tree.
 *
 * ── Two checks, one cause ───────────────────────────────────────────────────
 *
 *   1. **`resolved` host allow-list.** Every absolute `resolved` URL in every
 *      lockfile must point at a public registry host. This is an ALLOW-list,
 *      not a denylist of `ms-feed-*`: the next proxy to leak in will have a
 *      different hostname, and a denylist would wave it through.
 *
 *   2. **No committed `.npmrc`.** The same contamination arrives through a
 *      `registry=` line, and a committed `.npmrc` can also carry an
 *      `_authToken`. There is none today and there must not be one: this
 *      machine's proxy configuration lives in the USER-level `~/.npmrc`,
 *      which is exactly where a machine-specific registry belongs.
 *
 * Usage: `node tools/check-lockfile-registry.mjs` → exit 0 clean, 1 findings.
 */

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Hosts a `resolved` URL may name.
 *
 * ⚠ Deliberately an ALLOW-list of ONE. Adding a host here is a decision about
 * where this project's supply chain comes from, and it publishes that host to
 * a public repository. `registry.npmjs.org` is what Dependabot writes, what
 * GitHub runners reach, and the only host the committed `integrity` hashes
 * were computed against.
 */
export const ALLOWED_REGISTRY_HOSTS = ['registry.npmjs.org'];

/**
 * Known-bad hosts, used ONLY to make the failure message name the defect
 * instead of describing it abstractly. The gate itself is the allow-list
 * above — an unrecognised proxy still fails, it just gets a generic message.
 */
const KNOWN_PROXY_HOSTS = [/\.pkgs\.visualstudio\.com$/i, /^packagefeedproxy\.microsoft\.io$/i];

const LOCKFILE_NAMES = new Set(['package-lock.json', 'npm-shrinkwrap.json']);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-dev',
  'build',
  'coverage',
  'playwright-report',
  'test-results',
]);

/**
 * The files that necessarily CONTAIN the forbidden strings: this checker and
 * its own test. A checker cannot name what it forbids without matching itself.
 */
export const SELF_REFERENTIAL = new Set([
  'tools/check-lockfile-registry.mjs',
  'tests/infra/lockfileRegistry.spec.ts',
]);

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // Transient scratch directories created by mutation tests in OTHER spec
      // files, which run in parallel in the same project. Walking them makes
      // this checker fail on a violation someone else deliberately planted.
      if (entry.name.startsWith('.tmp-')) continue;
      await walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const relTo = (root, p) => path.relative(root, p).split(path.sep).join('/');

/**
 * `resolved` is not always a URL. npm writes a WORKSPACE-RELATIVE PATH for
 * each linked workspace (`"resolved": "apps/api"`), and `file:`/`link:`
 * specifiers for local packages. Those are not registry references and must
 * not be reported — treating them as violations would fail every clean
 * monorepo lockfile in this repo, which has four workspaces.
 */
function registryHostOf(resolved) {
  if (typeof resolved !== 'string' || resolved.length === 0) return null;
  let url;
  try {
    url = new URL(resolved);
  } catch {
    return null; // workspace-relative path — not a registry reference
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.host;
}

function describeHost(host) {
  if (KNOWN_PROXY_HOSTS.some((re) => re.test(host))) {
    return `internal Microsoft proxy feed "${host}"`;
  }
  return `non-public registry host "${host}"`;
}

/**
 * Walks both lockfile shapes. `lockfileVersion` 3 uses `packages`; 1 and 2
 * carry a nested `dependencies` tree as well. Reading only `packages` would
 * miss a contaminated v1 lockfile entirely.
 *
 * @returns {{ host: string, where: string }[]}
 */
export function offendingEntries(lock) {
  const found = [];

  for (const [name, entry] of Object.entries(lock?.packages ?? {})) {
    const host = registryHostOf(entry?.resolved);
    if (host !== null && !ALLOWED_REGISTRY_HOSTS.includes(host)) {
      found.push({ host, where: name === '' ? '<root>' : name });
    }
  }

  const walkDeps = (deps, trail) => {
    for (const [name, entry] of Object.entries(deps ?? {})) {
      const host = registryHostOf(entry?.resolved);
      if (host !== null && !ALLOWED_REGISTRY_HOSTS.includes(host)) {
        found.push({ host, where: [...trail, name].join(' > ') });
      }
      walkDeps(entry?.dependencies, [...trail, name]);
    }
  };
  walkDeps(lock?.dependencies, []);

  return found;
}

/** @returns {string[]} findings */
export function checkLockfile(text, rel) {
  let lock;
  try {
    lock = JSON.parse(text);
  } catch {
    return [`${rel}: is not valid JSON`];
  }

  const offenders = offendingEntries(lock);
  if (offenders.length === 0) return [];

  // Group by host so a 442-entry contamination is four lines, not 442.
  const byHost = new Map();
  for (const { host, where } of offenders) {
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(where);
  }

  const findings = [];
  for (const [host, wheres] of [...byHost].sort((a, b) => b[1].length - a[1].length)) {
    const sample = wheres.slice(0, 3).join(', ');
    const more = wheres.length > 3 ? `, +${wheres.length - 3} more` : '';
    findings.push(
      `${rel}: ${wheres.length} "resolved" URL(s) point at ${describeHost(host)} ` +
        `instead of registry.npmjs.org (e.g. ${sample}${more}). ` +
        `This DISABLES DEPENDABOT for every affected package and publishes an internal ` +
        `host from a public repository. CI cannot otherwise see it: the feed is ` +
        `anonymously readable, so installs succeed and every job stays green. ` +
        `Remedy: the host rewrite in docs/runbooks/update-dependencies.md §6a ` +
        `(no npm install, no version change, no integrity change).`,
    );
  }
  return findings;
}

/** @returns {string[]} findings */
export function checkNpmrc(rel) {
  return [
    `${rel}: a committed .npmrc must not exist. A repo-level registry= line is how the ` +
      `proxy-feed contamination gets into package-lock.json in the first place, and an ` +
      `.npmrc can also carry an _authToken in a public repository. Machine-specific ` +
      `registry configuration belongs in the USER-level ~/.npmrc ` +
      `(docs/runbooks/update-dependencies.md §6a, issue #417).`,
  ];
}

/**
 * @param {string} [root] repository root; overridable so the mutation tests can
 *   point the walker at a scratch tree.
 * @returns {Promise<string[]>} findings
 */
export async function checkLockfileRegistry(root = ROOT) {
  const files = await walk(root);
  const findings = [];

  for (const file of files) {
    const rel = relTo(root, file);
    if (SELF_REFERENTIAL.has(rel)) continue;

    const base = path.basename(file);

    if (LOCKFILE_NAMES.has(base)) {
      findings.push(...checkLockfile(readFileSync(file, 'utf8'), rel));
      continue;
    }

    if (base === '.npmrc') {
      findings.push(...checkNpmrc(rel));
    }
  }

  return findings;
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  // The optional root argument exists so the mutation tests can run the real
  // CLI against a scratch tree. The repository walk deliberately SKIPS
  // `.tmp-*` directories — other infra specs plant deliberate violations
  // there — so a scratch dir cannot be reached from the default root.
  const findings = await checkLockfileRegistry(process.argv[2] ?? ROOT);
  if (findings.length > 0) {
    console.error('Lockfile registry-host check FAILED:\n');
    for (const f of findings) console.error(`  ✗ ${f}`);
    console.error(
      `\n${findings.length} finding(s). See docs/runbooks/update-dependencies.md §6a and issue #417.`,
    );
    process.exit(1);
  }
  console.log('Lockfile registry check passed: every "resolved" URL is public,');
  console.log('and no .npmrc is committed.');
}
