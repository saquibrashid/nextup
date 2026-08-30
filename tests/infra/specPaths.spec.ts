/**
 * `T-INFRA-014` — a source path named in a spec must exist.
 *
 * ⚠ **THIS GATE EXISTS BECAUSE FOUR SPEC PATHS WERE WRONG AT ONCE AND
 * NOTHING NOTICED.** `specs/ai.md` told an implementer to put the
 * cross-check merge, the `TitleExtractor` interface, the cleanup rules and
 * the chrome vocabulary in `apps/api/src/extraction/`. All four are pure
 * modules and all four actually live in `packages/domain/src/extraction/`,
 * because `apps/api`'s `stubExtractor` and `hybridExtractor` must run **one**
 * implementation rather than two copies (`specs/testing.md` §3.1).
 *
 * That is not a cosmetic drift. Under the project's own rule, a spec line
 * that a machine executes top-to-bottom is an INSTRUCTION, and these
 * instructions were live: an agent following `specs/ai.md` literally would
 * have created a second `crossCheck.ts` under `apps/api`, and the duplicate
 * would have passed its own tests. The lane building TASK-056c reported the
 * contradiction instead of conforming to it, which is the only reason it was
 * caught at all — by a human reading a report, not by CI.
 *
 * ⚠ **A PATH THAT DOES NOT EXIST YET IS NOT A FAILURE.** Much of the spec
 * describes work not yet built — `apps/api/src/extraction/suppressionGate.ts`
 * (stage 4, REQ-071) is specified and genuinely unwritten. Failing on those
 * would make this gate a backlog tracker that has to be silenced with
 * exceptions, and a gate that gets silenced protects nothing. So the property
 * asserted is narrower and exact:
 *
 *   **A spec must not name a path under a DIRECTORY THAT EXISTS, pointing at
 *   a file that does not, when a file of that name exists SOMEWHERE ELSE in
 *   the repo.**
 *
 * That is precisely the "moved and the spec did not follow" signature, and it
 * cannot fire on unbuilt work: `suppressionGate.ts` exists nowhere, so it is
 * unbuilt, not misplaced.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC_DIRS = ['specs', 'docs'];

/** Source roots a spec may legitimately point into. */
const CODE_ROOTS = ['apps/api/src', 'apps/web/src', 'packages/domain/src', 'tools'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', 'artifacts']);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Every `.ts`/`.tsx` basename in the repo → the paths that carry it. */
function fileIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const root of CODE_ROOTS) {
    for (const file of walk(path.join(ROOT, root))) {
      if (!/\.tsx?$/.test(file)) continue;
      const base = path.basename(file);
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      index.set(base, [...(index.get(base) ?? []), rel]);
    }
  }
  return index;
}

function specFiles(): string[] {
  return SPEC_DIRS.flatMap((d) => walk(path.join(ROOT, d))).filter((f) => f.endsWith('.md'));
}

/**
 * ⚠ Struck-through text is DEAD by the project's own supersession rule, so a
 * corrected-in-place note that quotes the old wrong path must not be read as
 * a live instruction — otherwise fixing a path would fail this gate.
 */
function stripSuperseded(text: string): string {
  return text.replace(/~~[\s\S]*?~~/g, '');
}

interface Reference {
  readonly spec: string;
  readonly cited: string;
  readonly actual: readonly string[];
}

function scanText(spec: string, text: string, index: Map<string, string[]>): Reference[] {
  const found: Reference[] = [];
  const pattern = new RegExp(`(?:${CODE_ROOTS.join('|')})/[A-Za-z0-9_./-]+\\.tsx?`, 'g');

  for (const cited of new Set(stripSuperseded(text).match(pattern) ?? [])) {
    if (existsSync(path.join(ROOT, cited))) continue;

    // Unbuilt work: the whole directory is absent, so nothing has "moved".
    const dir = path.join(ROOT, path.dirname(cited));
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;

    const elsewhere = index.get(path.basename(cited)) ?? [];
    if (elsewhere.length === 0) continue; // specified, not yet written.

    found.push({ spec, cited, actual: elsewhere });
  }
  return found;
}

function misplacedReferences(): Reference[] {
  const index = fileIndex();
  return specFiles().flatMap((spec) =>
    scanText(path.relative(ROOT, spec).replace(/\\/g, '/'), readFileSync(spec, 'utf8'), index),
  );
}

describe('T-INFRA-014 - a spec may not point at a file that has moved', () => {
  it('T-INFRA-014a: the index and the scan are non-vacuous', () => {
    // ⚠ Without this, a broken regex or a wrong ROOT makes `b` pass over an
    // empty set — green, and asserting nothing. That failure mode has already
    // shipped once in this repo (T-CI-008: spec files no runner collected).
    const index = fileIndex();
    expect(index.size).toBeGreaterThan(50);
    expect(index.get('crossCheck.ts')).toEqual(['packages/domain/src/extraction/crossCheck.ts']);
    expect(specFiles().length).toBeGreaterThan(10);

    const pattern = new RegExp(`(?:${CODE_ROOTS.join('|')})/[A-Za-z0-9_./-]+\\.tsx?`, 'g');
    const citations = specFiles().flatMap((f) => readFileSync(f, 'utf8').match(pattern) ?? []);
    expect(citations.length).toBeGreaterThan(50);

    // ⚠ Per-root, not just per-corpus. Mutating `apps/api/src` out of
    // CODE_ROOTS left the total above 50 (the other three roots carry it) and
    // this case stayed green — so a whole root could stop being scanned
    // without any signal. Every root must actually match something.
    for (const root of CODE_ROOTS) {
      expect(citations.filter((c) => c.startsWith(`${root}/`)).length).toBeGreaterThan(0);
    }
  });

  it('T-INFRA-014b: no spec names a path whose file actually lives elsewhere', () => {
    expect(
      misplacedReferences().map((r) => `${r.spec}: ${r.cited} -> ${r.actual.join(', ')}`),
    ).toEqual([]);
  });

  it('T-INFRA-014c: a superseded path is dead text and does not fail the gate', () => {
    // The four corrections in `specs/ai.md` quote their old wrong paths inside
    // `~~ ~~`. If this gate read those, correcting a path would break the
    // build and the only way to stay green would be to delete the history of
    // the mistake — the opposite of what this project wants.
    const live = 'see `apps/api/src/extraction/crossCheck.ts` now';
    const dead = '~~Superseded: "`apps/api/src/extraction/crossCheck.ts`."~~';
    expect(stripSuperseded(dead)).not.toContain('crossCheck.ts');
    expect(stripSuperseded(live)).toContain('crossCheck.ts');
    expect(stripSuperseded(`a ~~x~~ b ~~y~~ c`)).toBe('a  b  c');
  });

  it('T-INFRA-014d: specified-but-unwritten work is NOT reported', () => {
    // `apps/api/src/extraction/suppressionGate.ts` (stage 4, REQ-071) is named
    // by `specs/ai.md` §5 and does not exist anywhere. It is unbuilt, not
    // misplaced, and a gate that fails on it would be a backlog tracker that
    // has to be silenced — so it must stay silent here, on purpose.
    expect(fileIndex().get('suppressionGate.ts')).toBeUndefined();
    expect(misplacedReferences().map((r) => r.cited)).not.toContain(
      'apps/api/src/extraction/suppressionGate.ts',
    );
  });

  it('T-INFRA-014e: a known-moved path IS reported (the gate can still see)', () => {
    // ⚠ `b` and `d` are both satisfied by a detector that returns nothing at
    // all. Mutating `elsewhere.length === 0` to `... || true` blinded the gate
    // completely and every other case in this file stayed green — the exact
    // vacuous-pass shape this repo keeps producing. This case is the positive
    // control: it drives the detector over synthetic text and asserts it fires.
    const index = fileIndex();

    const moved = scanText('synthetic.md', 'see `apps/api/src/extraction/crossCheck.ts`.', index);
    expect(moved).toEqual([
      {
        spec: 'synthetic.md',
        cited: 'apps/api/src/extraction/crossCheck.ts',
        actual: ['packages/domain/src/extraction/crossCheck.ts'],
      },
    ]);

    // ...and stays quiet on the path that is actually correct, so `e` is not
    // just asserting "reports everything".
    expect(
      scanText('synthetic.md', 'see `packages/domain/src/extraction/crossCheck.ts`.', index),
    ).toEqual([]);
  });
});
