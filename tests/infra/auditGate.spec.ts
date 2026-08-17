import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { EXCEPTIONS, collectAdvisories } from '../../tools/check-audit.mjs';

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
});
