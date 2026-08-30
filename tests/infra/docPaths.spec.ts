/**
 * `T-INFRA-015` — no document may cite a repository document that does not exist.
 *
 * ⚠ WHY THIS EXISTS. `T-INFRA-014` (`tests/infra/specPaths.spec.ts`) guards
 * spec→CODE paths: it asks whether `apps/api/src/…` files named by a spec are
 * really there. Nothing guarded doc→DOC paths, and the gap was not theoretical.
 * 56 references across 20 documents pointed at an `artifacts/` tree that does
 * not exist in this repository at all — residue from the prefix the generating
 * app used, where `docs/PRD.md` was `artifacts/PRD.md` and `specs/ai.md` was
 * `artifacts/specs/ai.md`. Every one of them was in live, load-bearing text,
 * including `sourceOfTruth:` front-matter.
 *
 * They were invisible to `T-INFRA-014` **by design**: its property is
 * "path absent + its DIRECTORY present + basename exists elsewhere", and the
 * middle clause is what stops it firing on correctly-described future work.
 * `artifacts/` is absent as a directory, so the gate deliberately said nothing.
 * That is right for code and wrong for documents — a document either exists now
 * or the citation is broken, because specs cross-reference each other in the
 * present tense.
 *
 * ⚠ THE BASELINE IS FOR SUPERSEDED TEXT ONLY. `docs/runbook.md` is cited inside
 * ADR-0003's Revision-2 narrative about a `ghcr.io` PAT — a decision Revision 3
 * reversed (the package is public and there is NO credential). That text is
 * history, and "correcting" its path would imply it is live guidance, which is
 * the F-001 defect this project already paid for. So it is baselined with its
 * reason rather than repaired.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DOC_ROOTS = ['docs', 'specs'] as const;

/** A backticked repo-relative path to a markdown document. */
const DOC_PATH = /`((?:docs|specs)\/[A-Za-z0-9_./-]+\.md)`/g;

/**
 * Paths that are cited but deliberately NOT repaired, each with the reason.
 * ⚠ Adding an entry here is a claim that the citing text is DEAD. If the text
 * is live, fix the path instead — a baseline entry silences the only signal
 * that would have told a reader the document they were sent to is not there.
 */
const SUPERSEDED_CITATIONS: ReadonlyMap<string, string> = new Map([
  [
    'docs/runbook.md',
    'ADR-0003 Revision-2 narrative about a ghcr PAT; Revision 3 made the package public with no credential, so the passage is history.',
  ],
]);

function markdownFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.md')) found.push(relative(REPO_ROOT, full).split(sep).join('/'));
    }
  };
  for (const root of DOC_ROOTS) walk(join(REPO_ROOT, root));
  return found.sort();
}

export interface Citation {
  readonly file: string;
  readonly path: string;
}

/**
 * THE DETECTOR — pure, so `T-INFRA-015c` can drive it over text it has never
 * seen. A version that returned nothing would otherwise be indistinguishable
 * from a repository with no broken citations.
 */
export function brokenCitations(
  file: string,
  text: string,
  exists: (path: string) => boolean,
): Citation[] {
  const out: Citation[] = [];
  for (const match of text.matchAll(DOC_PATH)) {
    const path = match[1] as string;
    if (!exists(path)) out.push({ file, path });
  }
  return out;
}

export function allCitations(file: string, text: string): string[] {
  return [...text.matchAll(DOC_PATH)].map((m) => m[1] as string);
}

const files = markdownFiles();
const onDisk = (path: string): boolean => existsSync(join(REPO_ROOT, path));

const broken = files.flatMap((file) =>
  brokenCitations(file, readFileSync(join(REPO_ROOT, file), 'utf8'), onDisk),
);
const citationCount = files.reduce(
  (n, file) => n + allCitations(file, readFileSync(join(REPO_ROOT, file), 'utf8')).length,
  0,
);

describe('T-INFRA-015 every cited repository document exists', () => {
  it('T-INFRA-015a · the scan sees a real corpus of documents and citations', () => {
    // Guards the two inputs. If the walk or the regex silently produced
    // nothing, `b` would pass while asserting absolutely nothing — the exact
    // hole found in this repo's own specPaths gate after it shipped.
    expect(files.length).toBeGreaterThan(15);
    expect(citationCount).toBeGreaterThan(100);
    expect(files.some((f) => f.startsWith('docs/adr/'))).toBe(true);
    expect(files.some((f) => f.startsWith('specs/'))).toBe(true);
  });

  it('T-INFRA-015b · no live document cites a document that is not there', () => {
    const unexpected = broken.filter((c) => !SUPERSEDED_CITATIONS.has(c.path));

    expect(
      unexpected.map((c) => `${c.file} → ${c.path}`),
      'These documents cite a file that does not exist. Fix the path — do not\n' +
        'create the file, and do not baseline it unless the citing text is dead:\n' +
        unexpected.map((c) => `  ${c.file} → ${c.path}`).join('\n'),
    ).toEqual([]);
  });

  it('T-INFRA-015c · the detector fires on a broken path AND stays quiet on a real one', () => {
    // Positive control, both directions: "reports nothing" and "reports
    // everything" are equally broken detectors.
    const text = 'see `docs/PRD.md` and also `specs/gone.md` for detail';
    const exists = (p: string): boolean => p === 'docs/PRD.md';

    expect(brokenCitations('f.md', text, exists)).toEqual([
      { file: 'f.md', path: 'specs/gone.md' },
    ]);
    expect(brokenCitations('f.md', text, () => true)).toEqual([]);
    expect(brokenCitations('f.md', 'no citations here', exists)).toEqual([]);

    // ⚠ THE THREE ASSERTIONS ABOVE INJECT THEIR OWN `exists`, so they prove
    // the pure detector works and prove NOTHING about the predicate actually
    // wired into `broken`. Mutation testing caught this: replacing the real
    // `onDisk` with `() => true` left this case green and was killed only by
    // `e`, and only because the baseline happens to be non-empty. With an
    // empty baseline the whole gate would have gone vacuously green.
    // So assert the REAL predicate, in both directions.
    expect(onDisk('docs/PRD.md')).toBe(true);
    expect(onDisk('docs/this-file-does-not-exist-anywhere.md')).toBe(false);
  });

  it('T-INFRA-015d · it ignores paths that are not markdown documents', () => {
    // `apps/api/src/config.ts` is T-INFRA-014's business, not this gate's.
    // Overlapping the two would produce duplicate, contradictory failures.
    const text = 'see `apps/api/src/config.ts` and `infra/aca.bicep`';

    expect(brokenCitations('f.md', text, () => false)).toEqual([]);
  });

  it('T-INFRA-015e · every baseline entry is still cited and still missing', () => {
    // A baseline that is allowed to go stale stops describing reality. If a
    // superseded citation is deleted or the file is created, the entry must go.
    for (const [path, reason] of SUPERSEDED_CITATIONS) {
      expect(reason.length, `${path} must record WHY it is exempt`).toBeGreaterThan(40);
      expect(onDisk(path), `${path} now exists — delete the baseline entry`).toBe(false);
      expect(
        broken.some((c) => c.path === path),
        `${path} is no longer cited anywhere — delete the baseline entry`,
      ).toBe(true);
    }
  });
});
