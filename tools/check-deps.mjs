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

/** Recursively collect files, skipping build output and vendored code. */
async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
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
  const findings = [...(await checkDependencies()), ...(await checkActionPinning())];
  if (findings.length > 0) {
    console.error('Supply-chain check FAILED:\n');
    for (const f of findings) console.error(`  ✗ ${f}`);
    console.error(`\n${findings.length} finding(s). See specs/security.md §8 and NFR-005.`);
    process.exit(1);
  }
  console.log('Supply-chain check passed: no telemetry packages, no third-party');
  console.log('scripts, no analytics hosts, all actions pinned to commit SHAs.');
}
