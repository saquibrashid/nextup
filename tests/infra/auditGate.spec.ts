import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  EXCEPTIONS,
  assertAuditRan,
  collectAdvisories,
  loadReport,
} from '../../tools/check-audit.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const ciYml = readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const gateSrc = readFileSync(path.join(repoRoot, 'tools/check-audit.mjs'), 'utf8');

// A synthetic `npm audit --json` payload. Using a fixture rather than a live
// audit keeps this test offline and deterministic; the live behaviour is what
// CI itself exercises on every run.
function report(advisories) {
  return {
    vulnerabilities: Object.fromEntries(
      advisories.map((a, i) => [`pkg-${i}`, { via: [a], severity: a.severity }]),
    ),
  };
}

const HIGH = {
  name: 'some-pkg',
  severity: 'high',
  title: 'A high severity thing',
  url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
};

describe('T-SEC-034 the production audit gate suppresses by exception, never by blanket', () => {
  it('T-SEC-034a: high and critical advisories are collected', () => {
    const found = collectAdvisories(
      report([HIGH, { ...HIGH, severity: 'critical', url: 'https://x/advisories/GHSA-dddd' }]),
    );
    expect([...found.keys()]).toEqual(['GHSA-aaaa-bbbb-cccc', 'GHSA-dddd']);
  });

  it('T-SEC-034b: moderate and low advisories are not collected, so the gate stays high-only', () => {
    const found = collectAdvisories(
      report([
        { ...HIGH, severity: 'moderate' },
        { ...HIGH, severity: 'low', url: 'https://x/advisories/GHSA-eeee' },
      ]),
    );
    expect(found.size).toBe(0);
  });

  it('T-SEC-034c: string `via` edges are ignored — they are dependency paths, not advisories', () => {
    // npm lists indirect edges as bare strings. Treating one as an advisory
    // would invent an id that no exception could ever match, making the gate
    // permanently and unfixably red.
    const found = collectAdvisories({ vulnerabilities: { p: { via: ['deepmerge-ts'] } } });
    expect(found.size).toBe(0);
  });

  it('T-SEC-034d: every exception carries an id, a date and a substantive justification', () => {
    // The point of the allow-list is the reasoning, not the suppression. A
    // one-word reason is how "documented exception" decays into "muted".
    expect(EXCEPTIONS.length).toBeGreaterThan(0);
    for (const e of EXCEPTIONS) {
      expect(e.id, 'exception needs an advisory id').toMatch(/^GHSA-|^npm-/);
      expect(e.package, `${e.id} needs a package`).toBeTruthy();
      expect(e.accepted, `${e.id} needs an accepted date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.reason.length, `${e.id}: justification is too thin to review`).toBeGreaterThan(200);
    }
  });

  it('T-SEC-034e: the gate still fails on stale exceptions — the self-deleting half is present', () => {
    // Without this rule the allow-list only ever grows, and a suppression
    // added for an unfixable finding silently survives the fix. Asserted
    // against the source because deleting the rule is the plausible edit.
    expect(gateSrc).toMatch(/STALE EXCEPTION/);
    expect(gateSrc).toMatch(/for \(const exc of EXCEPTIONS\)/);
  });

  it('T-SEC-034f: CI actually invokes the gate, and has not reverted to a bare npm audit', () => {
    // REQ-078-class wiring lesson: the gate existing is not the control; the
    // gate being CALLED is. A revert to `npm audit --omit=dev` would restore
    // the all-or-nothing behaviour this replaces.
    expect(ciYml).toMatch(/run: npm run check:audit/);
    expect(ciYml).not.toMatch(/run: npm audit --omit=dev --audit-level=high/);
  });

  it('T-SEC-034g: the non-blocking full-tree report survives, so dev findings stay visible', () => {
    // Scoping the blocking gate to production must not make dev-tooling
    // compromise invisible — it runs in CI with repository credentials.
    expect(ciYml).toMatch(/npm audit --audit-level=high/);
    expect(ciYml).toMatch(/continue-on-error: true/);
  });

  it('T-SEC-034h: an audit that did not run is rejected, not read as a clean tree', () => {
    /*
      ⚠ THIS IS THE BUG THAT REACHED CI, AND IT FAILED IN THE DESTRUCTIVE
      DIRECTION.

      npm's quick-audit endpoint returned `400 Bad Request` while being
      retired. `npm audit --json` still printed parseable JSON — an `error`
      object with no `vulnerabilities` key — so the gate saw zero advisories
      and concluded that the one documented, still-applicable exception was
      STALE, instructing the reader to delete reviewed security reasoning
      because "upstream has fixed it".

      The same empty shape would also wave through a genuine unfixed critical.
      A transport failure must never be interpreted as a statement about the
      dependency tree.
    */
    const outage = {
      error: { code: 'EAUDITENDPOINT', summary: 'audit endpoint returned an error' },
    };

    expect(() => assertAuditRan(outage)).toThrow(/NEVER CHECKED/);
    expect(() => assertAuditRan(outage)).toThrow(/audit endpoint returned an error/);
    // The advice matters as much as the failure: the old message told you to
    // delete the exception.
    expect(() => assertAuditRan(outage)).toThrow(/do NOT delete any exception/);

    // A real report with no findings is still a valid, passing result.
    expect(assertAuditRan({ vulnerabilities: {} })).toEqual({ vulnerabilities: {} });
  });

  it('T-SEC-034i: a transient outage is retried, and a persistent one still fails closed', () => {
    // A gate that goes red on somebody else's intermittent outage gets
    // switched off — but retrying forever, or passing after the last attempt,
    // would leave the production tree unchecked and call it green.
    const slept: number[] = [];
    let calls = 0;
    const flaky = () => {
      calls += 1;
      if (calls < 3) throw new Error('npm audit did not return a usable report');
      return { vulnerabilities: {} };
    };

    expect(loadReport({ read: flaky, waitMs: 1, sleep: (ms: number) => slept.push(ms) })).toEqual({
      vulnerabilities: {},
    });
    expect(calls).toBe(3);
    expect(slept).toEqual([1, 1]);

    const alwaysDown = () => {
      throw new Error('npm audit did not return a usable report');
    };
    expect(() => loadReport({ read: alwaysDown, attempts: 2, waitMs: 1, sleep: () => {} })).toThrow(
      /usable report/,
    );
  });
});
