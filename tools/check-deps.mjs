/**
 * Dependency and third-party-script allow-list check (TASK-004, `T-SEC-009`).
 *
 * NFR-005 is absolute: **no telemetry, no analytics, no APM, anywhere.** This
 * is a CI gate, not a review convention — a reviewer skims a lockfile diff,
 * this does not.
 *
 * It asserts three things:
 *
 *   1. No telemetry/analytics/APM package appears in ANY `package.json` in the
 *      repository (dependencies, devDependencies, peer, optional).
 *   2. No third-party `<script src="...">` appears in any `index.html`.
 *      Same-origin and relative sources are fine; a remote origin is not.
 *   3. No third-party analytics endpoint is hard-coded in source.
 *
 * ⚠ Scope note (R5). `T-SEC-009` greps for **packages and script tags**, never
 * for log lines. The `image.decode.begin` / `image.decode.end` sentinel events
 * in `specs/api.md` §9.1 are stdout debug logs — no SDK, no third party, no
 * product instrumentation, no user content — and `T-IMG-021` REQUIRES them.
 * Both checks pass together; do not "resolve" a false collision by deleting
 * the sentinel.
 *
 * Usage: `node tools/check-deps.mjs`  → exit 0 clean, exit 1 with findings.
 */

import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Forbidden package patterns. `specs/security.md` §8 names the first seven
 * explicitly; each is matched as a whole package name or a scoped/suffixed
 * variant, because `posthog-js`, `@sentry/node` and `applicationinsights-web`
 * are the same violation as their bare names.
 */
const FORBIDDEN_PACKAGES = [
  /^applicationinsights(-.*)?$/,
  /^@microsoft\/applicationinsights(-.*)?$/,
  /^@?[\w-]*\/?posthog(-.*)?$/,
  /^@?[\w-]*\/?mixpanel(-.*)?$/,
  /^@?segment\//,
  /^analytics-node$/,
  /^@?[\w-]*\/?sentry(-.*)?$/,
  /^@sentry\//,
  /^@?[\w-]*\/?datadog(-.*)?$/,
  /^dd-trace$/,
  /^@datadog\//,
  /^newrelic$/,
  /^@newrelic\//,
  /^@opentelemetry\//,
  /^@amplitude\//,
  /^amplitude-js$/,
  /^@vercel\/analytics$/,
  /^@google-analytics\//,
  /^react-ga(4)?$/,
  /^hotjar$/,
  /^logrocket$/,
  /^@bugsnag\//,
];

/** Analytics endpoints that would indicate a hand-rolled beacon. */
const FORBIDDEN_HOSTS = [
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'posthog.com',
  'sentry.io',
  'datadoghq.com',
  'newrelic.com',
  'amplitude.com',
  'hotjar.com',
  'logrocket.io',
  'bugsnag.com',
  'applicationinsights.azure.com',
  'dc.services.visualstudio.com',
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

/**
 * Recursively collect files, skipping build output and vendored code.
 *
 * ⚠ **A PATH THAT VANISHES MID-WALK IS SKIPPED, NOT THROWN ON.** This checker
 * is the one walker that MUST see `tests/infra/supplyChain.spec.ts`'s scratch
 * directories — they are how that suite proves the gate catches a real
 * violation — so it cannot skip `.tmp-*` the way `tools/check-status.mjs` does.
 * It therefore has to tolerate the other half of the same race: Vitest runs
 * spec files in parallel, and a sibling's scratch directory can be removed
 * between this `readdir` and the recursive call into it. Left unhandled, that
 * surfaced as `T-SEC-009d` reporting a planted `mixpanel` devDependency as NOT
 * caught — a security gate reading green because the walk died early.
 */
async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // removed between the parent listing and this call
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/**
 * The two files that necessarily CONTAIN the forbidden strings: this checker
 * and its own test. Exempting them is unavoidable — a checker cannot name what
 * it forbids without matching itself.
 *
 * ⚠ Keep this list at exactly these two paths. Exempting "test files" as a
 * class would hand any future beacon a place to hide, and a suppression that
 * grows by one convenient entry at a time is how an allow-list dies.
 */
const SELF_REFERENTIAL = new Set(['tools/check-deps.mjs', 'tests/infra/supplyChain.spec.ts']);

/** @returns {string[]} findings */
function checkPackageJson(file) {
  const findings = [];
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [`${rel(file)}: is not valid JSON`];
  }

  const fields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

  for (const field of fields) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (FORBIDDEN_PACKAGES.some((re) => re.test(name))) {
        findings.push(
          `${rel(file)}: ${field} contains forbidden telemetry/analytics package "${name}" (NFR-005, T-SEC-009)`,
        );
      }
    }
  }
  return findings;
}

/** @returns {string[]} findings */
function checkHtml(file) {
  const findings = [];
  const html = readFileSync(file, 'utf8');

  // Any <script src> whose value has a scheme or protocol-relative prefix is
  // third-party by definition; relative and root-relative sources are ours.
  const scriptSrc = /<script[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const m of html.matchAll(scriptSrc)) {
    const src = m[1];
    if (/^(https?:)?\/\//i.test(src)) {
      findings.push(
        `${rel(file)}: third-party script tag "${src}" (NFR-005, T-SEC-009). The SPA loads no remote scripts.`,
      );
    }
  }
  return findings;
}

/** @returns {string[]} findings */
function checkSourceForHosts(file) {
  const findings = [];
  const text = readFileSync(file, 'utf8');
  for (const host of FORBIDDEN_HOSTS) {
    if (text.includes(host)) {
      findings.push(`${rel(file)}: references analytics host "${host}" (NFR-005, T-SEC-009)`);
    }
  }
  return findings;
}

export async function checkDependencies() {
  const files = await walk(ROOT);
  const findings = [];

  for (const file of files) {
    const base = path.basename(file);
    const ext = path.extname(file);

    if (SELF_REFERENTIAL.has(rel(file))) continue;

    if (base === 'package.json') {
      findings.push(...checkPackageJson(file));
      continue;
    }
    if (ext === '.html') {
      findings.push(...checkHtml(file));
      continue;
    }

    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      findings.push(...checkSourceForHosts(file));
    }
  }

  return findings;
}

/**
 * `T-DEP-001` — the DIRECT runtime dependency allow-list (TASK-147, NFR-004).
 *
 * `specs/security.md` §8 "New dependency policy" names the runtime set and
 * calls it "deliberately small". Left as prose that is a review convention,
 * and a reviewer skimming a package.json diff does not notice one new import
 * among twelve. This turns the named set into a gate: a runtime dependency
 * that nobody wrote down fails the build.
 *
 * ⚠ Deliberately scoped to **direct** `dependencies` in the workspace
 * manifests. It is NOT a transitive allow-list — pinning the whole tree would
 * be unmaintainable and would fail on every patch bump. Transitive risk is
 * covered by the licence gate (`T-LICENSE-001`) and by `checkImageCodecs()`
 * below, which are the two things that actually bite.
 *
 * `devDependencies` are excluded: they are not distributed, NFR-004 is about
 * what ships, and gating the test tooling would make every lane fight this
 * file instead of writing tests.
 *
 * The list includes packages the spec approves but that are NOT installed yet
 * (`zod`, `multer`, the Azure SDKs …). That is intentional — the list encodes
 * the SPEC's approved set, not today's snapshot, so a lane implementing a
 * later task does not get a spurious CI failure for using an already-approved
 * package. Adding anything else is a spec change first.
 */
export const RUNTIME_DEPENDENCY_ALLOWLIST = new Set([
  // Workspace-internal, not third party.
  '@nextup/domain',
  // specs/security.md §8, verbatim.
  'express',
  'zod',
  '@prisma/client',
  // TASK-141. The Entra/managed-identity path for Azure SQL. Prisma's built-in
  // `sqlserver` connector (Rust `tiberius`) cannot authenticate with a managed
  // identity at all, so this is not a convenience — without it the container
  // must hold a database password, which specs/security.md §7 exists to avoid.
  // Published by Prisma at our exact pinned version; adds no new advisory.
  '@prisma/adapter-mssql',
  '@azure/storage-blob',
  '@azure/identity',
  '@azure-rest/ai-vision-image-analysis',
  // specs/ai.md §2.1a mandates the `openai` package with an `AzureOpenAI`
  // client for the PRIMARY reader. It was absent from specs/security.md §8's
  // prose list — an omission, not a prohibition: the same section fixes the
  // model, the API version and the module that may import it. The §8 row is
  // corrected in place alongside this entry, because that row is what this
  // list is a gate on.
  'openai',
  'ulid',
  'jaro-winkler',
  'compression',
  'multer',
  // A42 — the HEIC ingest path. See the licence row in specs/security.md §8.
  'heic-convert',
  'sharp',
  // The SPA itself (ADR-0004). §8's prose list enumerated the API's
  // dependencies and silently omitted the front end's; these three have
  // shipped since TASK-005 and are the SPA, not an addition to it.
  'react',
  'react-dom',
  'react-router-dom',
  // SD-11c (`specs/ui.md` §5.4) names this package by name for the review
  // list, which must stay responsive at 500 candidates on 0.25 vCPU
  // (US-013 AC-5, `T-PERF-002`). MIT, no transitive runtime dependencies, and
  // headless — it computes a window and renders nothing itself. Absent from
  // specs/security.md §8's prose list, which enumerated the API's dependencies
  // and the SPA's framework three; that row is corrected alongside this entry.
  '@tanstack/react-virtual',
  // Audited SHA-256 for the canonical id derivation in packages/domain.
  // Deliberately NOT node:crypto: the domain package is isomorphic and these
  // ids are computed in the browser as well as the API.
  '@noble/hashes',
]);

/** Workspace manifests, in the order `npm` resolves them. */
const WORKSPACE_MANIFESTS = [
  'package.json',
  'packages/domain/package.json',
  'apps/api/package.json',
  'apps/web/package.json',
];

/** @returns {string[]} findings */
export function checkRuntimeDependencyAllowList(root = ROOT) {
  const findings = [];

  for (const relPath of WORKSPACE_MANIFESTS) {
    const file = path.join(root, relPath);
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue; // A workspace that does not exist yet is not a violation.
    }

    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (!RUNTIME_DEPENDENCY_ALLOWLIST.has(name)) {
        findings.push(
          `${relPath}: runtime dependency "${name}" is not on the allow-list (NFR-004, T-DEP-001). ` +
            `Justify it in specs/security.md §8 and add it to RUNTIME_DEPENDENCY_ALLOWLIST, or move it to devDependencies if it does not ship.`,
        );
      }
    }
  }

  return findings;
}

/**
 * `T-DEP-002` — no HEIC/H.26x ENCODER anywhere in the tree (TASK-147).
 *
 * The HEIC decode chain is `heic-convert` → `heic-decode` → `libheif-js`,
 * which is **LGPL-3.0** and **decode-only** (it carries `libde265`, a
 * decoder). That is what keeps this MIT repository's licence floor at weak
 * copyleft, which `T-LICENSE-001` permits with a retained notice.
 *
 * An **encoder** breaks that in two ways at once: `x265` is **GPL-2.0**, which
 * would relicense the app outright, and it is patent-encumbered. nextup never
 * writes HEIC — the transcode goes HEIC → PNG, one direction only — so an
 * encoder appearing in the tree is always an accident, and always a serious
 * one.
 *
 * This scans the **whole lockfile**, transitives included, because that is the
 * realistic failure: not someone typing `npm i x265`, but a patch bump to an
 * image package quietly pulling an encoder in three levels down.
 *
 * ⚠ `libde265`, `libheif-js` and `heic-decode` must NOT match. Broadening
 * these patterns to "anything containing heif" re-bans the decoder and takes
 * every iPhone upload (ASM-058) with it.
 */
const FORBIDDEN_CODEC_PACKAGES = [
  /^x26[45]$/i,
  /^(lib)?x26[45](-.*)?$/i,
  /^@?[\w-]*\/?x26[45](-.*)?$/i,
  /^heic-enc(ode|oder)?(-.*)?$/i,
  /^heif-enc(ode|oder)?(-.*)?$/i,
  /^libheif-enc(ode|oder)?(-.*)?$/i,
];

/** The package name for a `package-lock.json` v3 path key. */
export function lockfilePackageName(key, entry) {
  if (entry?.name) return entry.name;
  const marker = 'node_modules/';
  const at = key.lastIndexOf(marker);
  return at === -1 ? '' : key.slice(at + marker.length);
}

/** @returns {string[]} findings */
export function checkImageCodecs(lockfilePath = path.join(ROOT, 'package-lock.json')) {
  const findings = [];

  let lockfile;
  try {
    lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  } catch {
    return [`${rel(lockfilePath)}: package-lock.json is missing or unreadable (T-DEP-002)`];
  }

  for (const [key, entry] of Object.entries(lockfile.packages ?? {})) {
    if (key === '') continue; // the root project itself
    const name = lockfilePackageName(key, entry);
    if (!name) continue;

    if (FORBIDDEN_CODEC_PACKAGES.some((re) => re.test(name))) {
      findings.push(
        `package-lock.json: "${name}" is a HEIC/H.26x ENCODER (T-DEP-002). ` +
          `The HEIC path is decode-only: an encoder raises the licence floor to GPL and is patent-encumbered. See specs/security.md §8.`,
      );
    }
  }

  return findings;
}

/**
 * `T-CI-006` — every GitHub Action is pinned to a full 40-character commit
 * SHA, not a tag. A tag is mutable: `@v2` can be re-pointed at new code by
 * anyone who can push to that repository, which makes it a supply-chain hole
 * in a workflow that holds `GITHUB_TOKEN`.
 */
export async function checkActionPinning() {
  const findings = [];
  const workflowDir = path.join(ROOT, '.github', 'workflows');

  let entries;
  try {
    entries = await readdir(workflowDir);
  } catch {
    return findings;
  }

  for (const name of entries) {
    if (!/\.ya?ml$/.test(name)) continue;
    const file = path.join(workflowDir, name);
    if (!(await stat(file)).isFile()) continue;

    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) {
      const ref = m[1].replace(/['"]/g, '');
      // Local composite actions (./...) and docker:// images are not tags.
      if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
      const at = ref.lastIndexOf('@');
      const version = at === -1 ? '' : ref.slice(at + 1);
      if (!/^[0-9a-f]{40}$/.test(version)) {
        findings.push(
          `.github/workflows/${name}: action "${ref}" is pinned to a mutable tag, not a 40-character commit SHA (T-CI-006, specs/security.md §8)`,
        );
      }
    }
  }
  return findings;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const findings = [
    ...(await checkDependencies()),
    ...checkRuntimeDependencyAllowList(),
    ...checkImageCodecs(),
    ...(await checkActionPinning()),
  ];
  if (findings.length > 0) {
    console.error('Supply-chain check FAILED:\n');
    for (const f of findings) console.error(`  ✗ ${f}`);
    console.error(`\n${findings.length} finding(s). See specs/security.md §8 and NFR-005.`);
    process.exit(1);
  }
  console.log('Supply-chain check passed: no telemetry packages, no third-party');
  console.log('scripts, no analytics hosts, every runtime dependency allow-listed,');
  console.log('no HEIC/H.26x encoder, all actions pinned to commit SHAs.');
}
