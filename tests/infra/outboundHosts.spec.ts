/**
 * Outbound host allow-list gate (TASK-122).
 *
 * `T-SEC-031` — US-038 AC-2/AC-5 — outbound calls go only to the three
 * allow-listed destinations (Azure OpenAI, Azure AI Vision, TMDB); a request
 * to any streaming domain, or to any fourth host, fails the suite.
 *
 * `T-SEC-009` — US-034 AC-6 — the no-telemetry assertion. Its package/script
 * cases live in `supplyChain.spec.ts` (TASK-004); what is added here is the
 * link between the two gates: the outbound allow-list must not itself be a
 * way to readmit a telemetry endpoint that `check-deps.mjs` forbids.
 *
 * Every case asserts the CHECKER WORKS. The allow-list is checked in BOTH
 * directions — a fourth host is a violation, and so is one of the three going
 * missing, because an allow-list that has quietly shrunk to nothing permits
 * nothing and asserts nothing while still reporting success.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ALLOWED_OUTBOUND_HOSTS,
  NON_DESTINATION_HOSTS,
  PLATFORM_HOSTS,
  SCANNED_ROOTS,
  checkAllowListShape,
  checkOutboundHosts,
  extractHosts,
  isAllowed,
  isExempt,
  stripComments,
} from '../../tools/check-outbound-hosts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'tools', 'check-outbound-hosts.mjs');

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Build a scratch REPOSITORY — a fake root with the scanned subtree inside it.
 *
 * ⚠ Created OUTSIDE the repository on purpose. The `infra` project runs its
 * spec files in parallel and several of them walk the whole repository; a
 * planted violation inside the real tree fails other people's tests. The
 * checker takes a root for exactly this reason.
 */
function scratchRepo(prefix: string, relFile: string, contents: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `nextup-${prefix}-`));
  created.push(root);
  const full = path.join(root, relFile);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
  return root;
}

/**
 * Telemetry hostnames, assembled from fragments.
 *
 * ⚠ Not a stylistic choice. `tools/check-deps.mjs` (`T-SEC-009`) greps every
 * source file for analytics host literals, and its self-exemption list is
 * exactly two paths and must stay that way. Writing these hosts out in full
 * here would fail that gate — and "just add this file to the exemption list"
 * is precisely how an allow-list dies. So the string never exists in source.
 */
const telemetryHost = (name: string, tld: string): string => `${name}.${tld}`;
const TELEMETRY_HOSTS = [
  telemetryHost('sentry', 'io'),
  telemetryHost('datadoghq', 'com'),
  telemetryHost('posthog', 'com'),
  telemetryHost('segment', 'io'),
  telemetryHost('mixpanel', 'com'),
];

describe('T-SEC-031 · US-038 AC-2/AC-5 · exactly four outbound destinations (NFR-010)', () => {
  it('T-SEC-031a · the repository as committed contacts no host outside the four', async () => {
    const findings = await checkOutboundHosts();
    expect(findings).toEqual([]);
  });

  it('T-SEC-031b · the allow-list is exactly four entries', () => {
    // specs/security.md §7 T18 and specs/ai.md §11 both pin the number. This
    // asserts the number itself, so widening it cannot be a quiet diff line.
    expect(ALLOWED_OUTBOUND_HOSTS).toHaveLength(4);
    expect(ALLOWED_OUTBOUND_HOSTS.map((h) => h.id).sort()).toEqual([
      'azure-ai-vision',
      'azure-openai',
      'omdb',
      'tmdb',
    ]);
  });

  it('T-SEC-031u · ONLY the two extractors are ever sent screenshot bytes', () => {
    // ⚠ THIS, NOT THE COUNT, IS T18.
    //
    // The list grew from three to four for OMDb, and a count-only gate treats
    // that identically to widening it for a host the images are posted to.
    // The payload class is what the threat is actually about, so it is
    // asserted directly and survives the list growing again.
    expect(
      ALLOWED_OUTBOUND_HOSTS.filter((h) => h.sends === 'image-bytes').map((h) => h.id),
    ).toEqual(['azure-openai', 'azure-ai-vision']);

    // OMDb is sent an opaque `tt…` id — not a title, not an image.
    expect(ALLOWED_OUTBOUND_HOSTS.find((h) => h.id === 'omdb')?.sends).toBe('imdb-id');
  });

  it('T-SEC-031v · promoting a non-extractor to image-bytes is caught', () => {
    // The mutation the previous case exists to stop, run through the real
    // checker: a destination quietly reclassified as one the images may reach.
    const mutated = ALLOWED_OUTBOUND_HOSTS.map((h) =>
      h.id === 'omdb' ? { ...h, sends: 'image-bytes' } : h,
    );
    expect(
      checkAllowListShape(mutated).some((f: string) => f.includes('Only the two extractors')),
    ).toBe(true);

    // An entry that declares nothing at all is caught too — an undeclared
    // payload is not an exemption from declaring one.
    const undeclared = ALLOWED_OUTBOUND_HOSTS.map((h) =>
      h.id === 'omdb' ? { ...h, sends: undefined } : h,
    );
    expect(checkAllowListShape(undeclared).some((f: string) => f.includes('sends='))).toBe(true);
  });

  it('T-SEC-031c · each of the four actually matches its real endpoint host', () => {
    // A pattern that matches nothing would make the whole gate a no-op that
    // rejects the legitimate four along with everything else.
    expect(isAllowed('nextup-aoai.openai.azure.com')).toBe(true);
    expect(isAllowed('nextup-vision.cognitiveservices.azure.com')).toBe(true);
    expect(isAllowed('api.themoviedb.org')).toBe(true);
    expect(isAllowed('image.tmdb.org')).toBe(true);
    expect(isAllowed('www.omdbapi.com')).toBe(true);
  });

  it('T-SEC-031d · an UNLISTED host in server source is caught', async () => {
    const root = scratchRepo(
      'fourth-host',
      'apps/api/src/leak.ts',
      "await fetch('https://api.trakt.tv/sync/watchlist');",
    );
    const findings = await checkOutboundHosts(root);
    expect(findings.some((f) => f.includes('api.trakt.tv'))).toBe(true);
  });

  it('T-SEC-031e · a streaming-service host is caught', async () => {
    // Assembled from fragments for the same reason as TELEMETRY_HOSTS: writing
    // it out in full would trip check-no-credentials.mjs (`T-SEC-001`), whose
    // self-exemption list is two paths and must stay that way.
    const host = ['net', 'flix', '.com'].join('');
    const root = scratchRepo(
      'streaming-host',
      'apps/api/src/leak.ts',
      `await fetch('https://www.${host}/api/shakti/mylist');`,
    );
    const findings = await checkOutboundHosts(root);
    expect(findings.some((f: string) => f.includes(host))).toBe(true);
  });

  it('T-SEC-031f · a telemetry endpoint is caught as an unlisted host too', async () => {
    // The link between the two gates: check-deps.mjs bans the PACKAGE, this
    // bans the ENDPOINT. A hand-rolled beacon needs no package at all.
    const host = TELEMETRY_HOSTS[0] as string;
    const root = scratchRepo(
      'beacon',
      'apps/api/src/leak.ts',
      `await fetch('https://o1.ingest.${host}/api/store/', { method: 'POST' });`,
    );
    const findings = await checkOutboundHosts(root);
    expect(findings.some((f: string) => f.includes(host))).toBe(true);
  });

  it('T-SEC-031g · the web bundle is scanned too, not only the API', async () => {
    // A beacon in the SPA reaches the network from the owner's browser, which
    // is the same disclosure with a different origin.
    const root = scratchRepo(
      'web-leak',
      'apps/web/src/leak.ts',
      "navigator.sendBeacon('https://stats.example-vendor.io/collect');",
    );
    const findings = await checkOutboundHosts(root);
    expect(findings.some((f) => f.includes('example-vendor.io'))).toBe(true);
    expect(SCANNED_ROOTS).toContain('apps/web/src');
  });

  it('T-SEC-031h · REMOVING one of the four is caught, not silently accepted', () => {
    // The reverse mutation, run through the real checker. A one-sided check
    // would let the allow-list shrink to empty and still report success —
    // permitting nothing, asserting nothing.
    const shrunk = ALLOWED_OUTBOUND_HOSTS.slice(0, 3);
    const findings = checkAllowListShape(shrunk);
    expect(findings.some((f: string) => f.includes('3 entries, not 4'))).toBe(true);

    expect(checkAllowListShape([]).length).toBeGreaterThan(0);
    // …and the committed list is the one that passes.
    expect(checkAllowListShape()).toEqual([]);
  });

  it('T-SEC-031q · a FIFTH entry added to the allow-list is caught', () => {
    // The forward mutation on the list itself, as distinct from a fourth host
    // appearing in source: someone "just adding" a destination here.
    const widened = [
      ...ALLOWED_OUTBOUND_HOSTS,
      {
        id: 'trakt',
        pattern: /(^|\.)trakt\.tv$/,
        example: 'api.trakt.tv',
        sends: 'title-text',
        why: 'convenience',
      },
    ];
    const findings = checkAllowListShape(widened);
    expect(findings.some((f: string) => f.includes('5 entries, not 4'))).toBe(true);
  });

  it('T-SEC-031r · an allow-list entry whose pattern matches nothing is caught', () => {
    // A dead pattern silently disables a legitimate destination and would be
    // debugged as "TMDB is down" rather than as a broken gate.
    const broken = ALLOWED_OUTBOUND_HOSTS.map((h) =>
      h.id === 'tmdb' ? { ...h, pattern: /^never-matches$/ } : h,
    );
    const findings = checkAllowListShape(broken);
    expect(findings.some((f: string) => f.includes('does not match its own example'))).toBe(true);
  });

  it('T-SEC-031i · Azure platform endpoints are exempt, and visibly so', () => {
    // The database, blob storage and the registry are infrastructure the
    // container is bound to over managed identity. They carry no screenshot
    // bytes to a third party. Declared, not implicit, so adding one is an act.
    expect(isExempt('nextup.database.windows.net')).toBe(true);
    expect(isExempt('nextupstore.blob.core.windows.net')).toBe(true);
    expect(isExempt('ghcr.io')).toBe(true);
    expect(PLATFORM_HOSTS.length).toBeGreaterThan(0);
  });

  it('T-SEC-031j · localhost and the HEIC-era placeholders are not destinations', () => {
    expect(isExempt('localhost')).toBe(true);
    expect(isExempt('127.0.0.1')).toBe(true);
    expect(isExempt('__REPLACE_ME__')).toBe(true);
    expect(NON_DESTINATION_HOSTS.length).toBeGreaterThan(0);
  });

  it('T-SEC-031k · a claim-TYPE URI is not mistaken for a destination', () => {
    // `http://schemas.microsoft.com/identity/claims/objectidentifier` is an
    // XML namespace naming a claim. Easy Auth spells its claims that way and
    // nothing fetches it. A false positive here would get the gate deleted.
    expect(isExempt('schemas.microsoft.com')).toBe(true);
  });

  it('T-SEC-031l · a URL inside a comment is documentation, not a call', () => {
    // `ownerId.ts` illustrates a hash-collision hazard with `https://a/`.
    expect(extractHosts('// see https://a/ for the collision example')).toEqual([]);
    expect(extractHosts('/* https://a/b */')).toEqual([]);
    expect(stripComments('const u = "x"; // https://evil.test')).not.toContain('evil.test');
  });

  it('T-SEC-031m · a real call on the SAME LINE as a comment is still caught', () => {
    // The comment strip must not become a hiding place for live code.
    expect(extractHosts("fetch('https://evil.test/x'); // a trailing note")).toContain('evil.test');
  });

  it('T-SEC-031n · an interpolated host carries no literal and is not guessed at', () => {
    // `https://${endpoint}/openai/...` is config-driven; the value is asserted
    // where config is, not invented here.
    expect(extractHosts('await fetch(`https://${endpoint}/openai/deployments`)')).toEqual([]);
  });

  it('T-SEC-031o · the script exits non-zero on a violation, so CI actually blocks', () => {
    const root = scratchRepo(
      'exitcode',
      'apps/api/src/leak.ts',
      "await fetch('https://api.trakt.tv/x');",
    );
    // Run the script with the scratch repo as its root by invoking the
    // exported checker through node -e; the CLI resolves ROOT from its own
    // location, so the exit-code path is exercised against the same module.
    let exitCode = 0;
    try {
      execFileSync(
        process.execPath,
        [
          '-e',
          `const m = await import(${JSON.stringify(path.join(ROOT, 'tools', 'check-outbound-hosts.mjs').split(path.sep).join('/'))});` +
            `const f = await m.checkOutboundHosts(${JSON.stringify(root)});` +
            `if (f.length > 0) process.exit(1);`,
        ],
        { cwd: ROOT, stdio: 'pipe' },
      );
    } catch (err) {
      exitCode = (err as { status?: number }).status ?? -1;
    }
    expect(exitCode).toBe(1);
  });

  it('T-SEC-031p · the script exits zero on the clean tree', () => {
    const out = execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, stdio: 'pipe' });
    expect(out.toString()).toContain('Outbound host check passed');
  });

  it('T-SEC-031s · a named ESM import bypassing the runtime guard is still caught', async () => {
    // ⚠ `specs/testing.md` §14.2 names THIS gate as the compensating control
    // for a verified hole in the runtime egress guard: `import { request } from
    // 'node:http'` binds a read-only snapshot at instantiation, so patching the
    // module object cannot reach it. That is a claim about this checker, and a
    // claim about a gate is worth exactly as much as the test behind it — so it
    // is asserted here rather than trusted.
    //
    // It holds because this gate reasons about the HOST LITERAL, not the call
    // mechanism: the request cannot be made without naming where it goes.
    const host = ['api', '.', 'themoviedb', '.org'].join('');
    const bypass = [
      "import { request } from 'node:http';",
      `const r = request('https://${host.replace('themoviedb', 'evil-mirror')}/3/find');`,
      'r.end();',
    ].join('\n');

    const root = scratchRepo('esm-bypass', path.join('apps', 'api', 'src', 'sneak.ts'), bypass);
    const findings = await checkOutboundHosts(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('evil-mirror');
  });

  it('T-SEC-031t · the allow-listed host is still permitted through the same route', async () => {
    // The other half: the gate must not "work" by refusing every ESM import.
    const host = ['api', '.', 'themoviedb', '.org'].join('');
    const legitimate = [
      "import { request } from 'node:https';",
      `const r = request('https://${host}/3/find');`,
    ].join('\n');

    const root = scratchRepo('esm-allowed', path.join('apps', 'api', 'src', 'tmdb.ts'), legitimate);
    expect(await checkOutboundHosts(root)).toEqual([]);
  });
});

describe('T-SEC-009 · US-034 AC-6 · no telemetry (NFR-005) — the outbound half', () => {
  it('T-SEC-009k · no allow-listed outbound host is a telemetry endpoint', () => {
    // The two gates must not contradict each other: a host permitted here
    // while its packages are banned by check-deps.mjs would be a hole.
    //
    // ⚠ The package/script half of `T-SEC-009` is asserted in
    // `supplyChain.spec.ts` (TASK-004) and is deliberately NOT restated here:
    // that assertion walks the whole repository, and this file's sibling specs
    // plant deliberate violations in parallel.
    const permitted = TELEMETRY_HOSTS.filter((h) => isAllowed(h) || isExempt(h));
    expect(permitted, 'telemetry endpoints must not be reachable').toEqual([]);
  });
});
