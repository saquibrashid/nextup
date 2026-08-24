/**
 * Outbound host allow-list gate (TASK-122 — `T-SEC-031`, `T-SEC-009`).
 *
 * **Exactly four hosts may ever be contacted from server-side code:**
 *
 *   1. Azure OpenAI — `*.openai.azure.com` (gpt-4.1 vision, ADR-0001 Rev 2)
 *   2. Azure AI Vision — `*.cognitiveservices.azure.com` (Read F0 cross-check)
 *   3. TMDB — `api.themoviedb.org` / `image.tmdb.org` (metadata, NFR-014)
 *   4. OMDb — `www.omdbapi.com` (the IMDb rating, ADR-0011 / REQ-088)
 *
 * The threat this closes is **T18** (`specs/security.md` §7): screenshot bytes
 * reaching a further host after a well-meaning change.
 *
 * ⚠ **THE COUNT IS NOT THE SECURITY PROPERTY — `sends` IS.** This file used to
 * pin the list at three and describe that number as the guarantee. It is not:
 * T18 is about screenshot bytes, and a count says nothing about what a host
 * receives. Widening from three to four for OMDb (which is sent an IMDb id and
 * nothing else) would have looked exactly like widening it for a host that is
 * posted the images. Every entry therefore declares what it is sent, and
 * `checkAllowListShape` asserts that **exactly two** entries — the two
 * extractors — are ever sent image bytes. That assertion survives the list
 * growing; a count does not.
 *
 * ~~Superseded (Epic M): "Exactly three hosts… `specs/ai.md` §11 and
 * `docs/architecture.md` §NFR-010 both pin the number at three, and the count
 * is asserted here precisely so that 'we also need X' is a decision somebody
 * has to make in the open rather than a line in a diff."~~ The open-decision
 * intent is retained and still enforced — an amendment to this list is an
 * amendment to NFR-010 — but it is now carried by `sends` as well as by length.
 *
 * ⚠ **The check fails BOTH ways, and that is deliberate.** An unlisted host is
 * a violation; so is one of the four going missing. A one-sided check would let
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
 * THE closed list. Four entries, one per extraction/metadata destination.
 *
 * ⚠ Adding an entry is an amendment to NFR-010 and `specs/ai.md` §11, not an
 * implementation decision. `T-SEC-031` asserts the length AND the `sends`
 * classification — see the `sends` note in the file header.
 *
 * `sends` values:
 *   `'image-bytes'` — the screenshot itself. T18's subject. Only the two
 *                     extractors may ever carry this.
 *   `'title-text'`  — a search string derived from an extracted title.
 *   `'imdb-id'`     — an opaque `tt…` identifier and nothing else.
 */
export const ALLOWED_OUTBOUND_HOSTS = [
  {
    id: 'azure-openai',
    /** Matches the tenant-specific subdomain the endpoint actually uses. */
    pattern: /(^|\.)openai\.azure\.com$/,
    example: 'nextup-aoai.openai.azure.com',
    sends: 'image-bytes',
    why: 'Azure OpenAI gpt-4.1 vision — the primary extractor (ADR-0001 Rev 2)',
  },
  {
    id: 'azure-ai-vision',
    pattern: /(^|\.)cognitiveservices\.azure\.com$/,
    example: 'nextup-vision.cognitiveservices.azure.com',
    sends: 'image-bytes',
    why: 'Azure AI Vision Read F0 — the deterministic OCR cross-check (ADR-0001 Rev 2)',
  },
  {
    id: 'tmdb',
    pattern: /(^|\.)(api\.)?themoviedb\.org$|(^|\.)tmdb\.org$/,
    example: 'api.themoviedb.org',
    sends: 'title-text',
    why: 'TMDB — title metadata and artwork (NFR-013 attribution, NFR-014 refresh)',
  },
  {
    id: 'omdb',
    pattern: /(^|\.)omdbapi\.com$/,
    example: 'www.omdbapi.com',
    sends: 'imdb-id',
    why: 'OMDb — the IMDb rating for an already-matched work (ADR-0011, REQ-088)',
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
 * `T-SEC-031` half one — the allow-list itself is exactly four entries, one
 * per named destination, none of them a telemetry host, and **exactly two of
 * them ever sent image bytes**.
 *
 * @returns {string[]} findings
 */
export function checkAllowListShape(list = ALLOWED_OUTBOUND_HOSTS) {
  const findings = [];

  if (list.length !== 4) {
    findings.push(
      `the outbound allow-list has ${list.length} entries, not 4. NFR-010 and specs/security.md §7 T18 pin it at exactly four: Azure OpenAI, Azure AI Vision, TMDB and OMDb. Widening it is an amendment, not a change (T-SEC-031).`,
    );
  }

  const ids = list.map((h) => h.id).sort();
  const expected = ['azure-ai-vision', 'azure-openai', 'omdb', 'tmdb'];
  if (ids.join(',') !== expected.join(',')) {
    findings.push(
      `the outbound allow-list is [${ids.join(', ')}], expected [${expected.join(', ')}] (T-SEC-031)`,
    );
  }

  // ⚠ THE ACTUAL T18 GUARANTEE. The list may grow again; this may not.
  const SENDS = new Set(['image-bytes', 'title-text', 'imdb-id']);
  for (const entry of list) {
    if (!SENDS.has(entry.sends)) {
      findings.push(
        `allow-list entry "${entry.id}" declares sends="${entry.sends}", which is not one of ${[...SENDS].join(', ')}. Every destination must say what it receives — T18 is about the payload, not the count (T-SEC-031).`,
      );
    }
  }

  const imageBytes = list.filter((h) => h.sends === 'image-bytes').map((h) => h.id);
  const expectedImageBytes = ['azure-openai', 'azure-ai-vision'];
  if (imageBytes.join(',') !== expectedImageBytes.join(',')) {
    findings.push(
      `screenshot bytes are declared to reach [${imageBytes.join(', ') || 'nothing'}], expected exactly [${expectedImageBytes.join(', ')}]. Only the two extractors may ever be sent an image — specs/security.md §7 T18, NFR-010 (T-SEC-031).`,
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
          `${rel}: contacts host "${host}", which is not one of the four allow-listed outbound destinations (Azure OpenAI, Azure AI Vision, TMDB, OMDb). Screenshot bytes must never reach a further host — specs/security.md §7 T18, NFR-010, T-SEC-031.`,
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
  console.log('Outbound host check passed: exactly four allow-listed destinations,');
  console.log('no source file contacts a further host.');
}
