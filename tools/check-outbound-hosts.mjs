/**
 * Outbound host allow-list gate (TASK-122 — `T-SEC-031`, `T-SEC-009`).
 *
 * **Exactly three hosts may ever be contacted from server-side code:**
 *
 *   1. Azure OpenAI — `*.openai.azure.com` (gpt-4.1 vision, ADR-0001 Rev 2)
 *   2. Azure AI Vision — `*.cognitiveservices.azure.com` (Read F0 cross-check)
 *   3. TMDB — `api.themoviedb.org` / `image.tmdb.org` (metadata, NFR-014)
 *
 * The threat this closes is **T18** (`specs/security.md` §7): screenshot bytes
 * reaching a fourth host after a well-meaning change. `specs/ai.md` §11 and
 * `docs/architecture.md` §NFR-010 both pin the number at three, and the count
 * is asserted here precisely so that "we also need X" is a decision somebody
 * has to make in the open rather than a line in a diff.
 *
 * ⚠ **The check fails BOTH ways, and that is deliberate.** A fourth host is a
 * violation; so is one of the three going missing. A one-sided check would let
 * an allow-list quietly shrink to nothing and still report success — at which
 * point it permits nothing and asserts nothing.
 *
 * ⚠ **Azure platform endpoints are NOT outbound calls in this sense.** The
 * database (`*.database.windows.net`), blob storage (`*.blob.core.windows.net`)
 * and the registry (`ghcr.io`) are infrastructure the container is bound to,
 * reached over managed identity, and they carry no screenshot bytes to a third
 * party. They are declared separately below so that the distinction is visible
 * rather than implicit, and so adding one is still a conscious act.
 *
 * Usage: `node tools/check-outbound-hosts.mjs` → exit 0 clean, exit 1 findings.
 */

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * THE closed list. Three entries, one per extraction/metadata destination.
 *
 * ⚠ Adding a fourth entry is an amendment to NFR-010 and `specs/ai.md` §11,
 * not an implementation decision. `T-SEC-031` asserts the length.
 */
export const ALLOWED_OUTBOUND_HOSTS = [
  {
    id: 'azure-openai',
    /** Matches the tenant-specific subdomain the endpoint actually uses. */
    pattern: /(^|\.)openai\.azure\.com$/,
    example: 'nextup-aoai.openai.azure.com',
    why: 'Azure OpenAI gpt-4.1 vision — the primary extractor (ADR-0001 Rev 2)',
  },
  {
    id: 'azure-ai-vision',
    pattern: /(^|\.)cognitiveservices\.azure\.com$/,
    example: 'nextup-vision.cognitiveservices.azure.com',
    why: 'Azure AI Vision Read F0 — the deterministic OCR cross-check (ADR-0001 Rev 2)',
  },
  {
    id: 'tmdb',
    pattern: /(^|\.)(api\.)?themoviedb\.org$|(^|\.)tmdb\.org$/,
    example: 'api.themoviedb.org',
    why: 'TMDB — title metadata and artwork (NFR-013 attribution, NFR-014 refresh)',
  },
];

/**
 * Infrastructure endpoints the container is BOUND to. Not third-party
 * destinations, not carriers of screenshot bytes; listed so the exclusion is
 * explicit and auditable rather than a silent gap in a regex.
 */
export const PLATFORM_HOSTS = [
  /(^|\.)database\.windows\.net$/,
  /(^|\.)blob\.core\.windows\.net$/,
  /(^|\.)queue\.core\.windows\.net$/,
  /(^|\.)vault\.azure\.net$/,
  /^ghcr\.io$/,
  /(^|\.)azurecr\.io$/,
  /(^|\.)login\.microsoftonline\.com$/,
  /(^|\.)sts\.windows\.net$/,
  /(^|\.)azurewebsites\.net$/,
  /(^|\.)azurecontainerapps\.io$/,
];

/**
 * Hosts that are never a network destination at runtime: loopback, the
 * emulator, documentation placeholders, schema namespaces and package
 * registries referenced in config.
 */
export const NON_DESTINATION_HOSTS = [
  /^localhost$/,
  /^127\.0\.0\.1$/,
  /^0\.0\.0\.0$/,
  /^host\.docker\.internal$/,
  /^__REPLACE_ME__$/,
  // Claim-TYPE URIs. `http://schemas.microsoft.com/identity/claims/…` is an
  // XML namespace identifier that names a claim; nothing ever fetches it. It
  // appears in `principal.ts` because Easy Auth spells its claims that way.
  /(^|\.)schemas\.microsoft\.com$/,
  /(^|\.)schemas\.xmlsoap\.org$/,
  /(^|\.)schemas\.openxmlformats\.org$/,
  /(^|\.)schema\.management\.azure\.com$/,
  /(^|\.)json\.schemastore\.org$/,
  /(^|\.)registry\.npmjs\.org$/,
  /(^|\.)example\.(com|org|net)$/,
  /(^|\.)w3\.org$/,
  /(^|\.)opensource\.org$/,
  /(^|\.)spdx\.org$/,
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
 * Where SERVER-SIDE outbound calls can originate. Deliberately narrow: docs
 * and specs cite hosts constantly and are not code, and the e2e/test tree
 * names hosts in order to assert they are never reached.
 */
export const SCANNED_ROOTS = ['apps/api/src', 'apps/web/src', 'packages/domain/src'];

/** @see check-no-credentials.mjs — a checker cannot name what it forbids. */
export const SELF_REFERENTIAL = new Set([
  'tools/check-outbound-hosts.mjs',
  'tests/infra/outboundHosts.spec.ts',
]);

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

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

/**
 * Remove comments before scanning.
 *
 * A URL in a comment is documentation, not a destination — `ownerId.ts`
 * illustrates a hash-collision hazard with `https://a/`, which is not a host
 * anyone contacts. Nothing in a comment executes, so nothing in a comment can
 * carry screenshot bytes anywhere.
 */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Extract every absolute http(s) host literal from a source text. */
export function extractHosts(text) {
  const hosts = new Set();
  for (const m of stripComments(text).matchAll(/https?:\/\/([A-Za-z0-9._-]+|\$\{[^}]*\})/g)) {
    const host = m[1];
    // A fully interpolated host (`https://${endpoint}/…`) carries no literal
    // to check — the value comes from config and is checked at §config level.
    if (host.startsWith('${')) continue;
    hosts.add(host.toLowerCase().replace(/\.$/, ''));
  }
  return [...hosts];
}

export function isAllowed(host) {
  return ALLOWED_OUTBOUND_HOSTS.some((h) => h.pattern.test(host));
}

export function isExempt(host) {
  return (
    PLATFORM_HOSTS.some((re) => re.test(host)) || NON_DESTINATION_HOSTS.some((re) => re.test(host))
  );
}

/**
 * `T-SEC-031` half one — the allow-list itself is exactly three entries, one
 * per named destination, and none of them is a telemetry host.
 *
 * @returns {string[]} findings
 */
export function checkAllowListShape(list = ALLOWED_OUTBOUND_HOSTS) {
  const findings = [];

  if (list.length !== 3) {
    findings.push(
      `the outbound allow-list has ${list.length} entries, not 3. NFR-010 and specs/security.md §7 T18 pin it at exactly three: Azure OpenAI, Azure AI Vision and TMDB. Widening it is an amendment, not a change (T-SEC-031).`,
    );
  }

  const ids = list.map((h) => h.id).sort();
  const expected = ['azure-ai-vision', 'azure-openai', 'tmdb'];
  if (ids.join(',') !== expected.join(',')) {
    findings.push(
      `the outbound allow-list is [${ids.join(', ')}], expected [${expected.join(', ')}] (T-SEC-031)`,
    );
  }

  for (const entry of list) {
    if (!entry.pattern.test(entry.example)) {
      findings.push(
        `allow-list entry "${entry.id}" does not match its own example host "${entry.example}" — the pattern permits nothing (T-SEC-031)`,
      );
    }
  }

  return findings;
}

/**
 * `T-SEC-031` half two — no source file names a host outside the allow-list.
 *
 * @param {string} [root]
 * @returns {Promise<string[]>} findings
 */
export async function checkOutboundHosts(root = ROOT) {
  const findings = [...checkAllowListShape()];

  for (const sub of SCANNED_ROOTS) {
    const files = await walk(path.join(root, sub));
    for (const file of files) {
      const rel = relTo(root, file);
      if (SELF_REFERENTIAL.has(rel)) continue;
      if (!SOURCE_EXT.has(path.extname(file))) continue;

      for (const host of extractHosts(readFileSync(file, 'utf8'))) {
        if (isAllowed(host) || isExempt(host)) continue;
        findings.push(
          `${rel}: contacts host "${host}", which is not one of the three allow-listed outbound destinations (Azure OpenAI, Azure AI Vision, TMDB). Screenshot bytes must never reach a fourth host — specs/security.md §7 T18, NFR-010, T-SEC-031.`,
        );
      }
    }
  }

  return findings;
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  const findings = await checkOutboundHosts();
  if (findings.length > 0) {
    console.error('Outbound host allow-list check FAILED:\n');
    for (const f of findings) console.error(`  ✗ ${f}`);
    console.error(`\n${findings.length} finding(s). See specs/security.md §7 (T18) and NFR-010.`);
    process.exit(1);
  }
  console.log('Outbound host check passed: exactly three allow-listed destinations,');
  console.log('no source file contacts a fourth host.');
}
