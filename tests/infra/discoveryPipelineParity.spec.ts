/**
 * TASK-126 — `T-WAIT-012`, the last unmapped criterion in the matrix:
 * **US-040 AC-2**, "a discovery batch uses the SAME ingest, extraction,
 * cross-check and TMDB matching path as a service capture — no parallel
 * pipeline exists" (REQ-082, ADR-0010 D-1).
 *
 * ⚠ THIS AC IS A NEGATIVE, AND A BEHAVIOURAL TEST CANNOT PROVE IT. The
 * obvious form — run the same screenshot through a discovery batch and a
 * Netflix batch and diff the candidates — proves the two paths AGREE TODAY on
 * ONE INPUT. It says nothing about the input that diverges tomorrow, and it
 * would pass just as happily against two separately-maintained pipelines that
 * happened to coincide on the fixture. The thing US-040 AC-2 actually
 * promises is stronger and structural: there is only one pipeline, and it
 * cannot tell the two kinds of batch apart.
 *
 * So this file asserts exactly that. The extraction path never reads the
 * discriminator (`a`), so it cannot branch on it; the entry point does not
 * accept one (`b`), so no caller can select a variant; and there is no second
 * implementation to select (`c`, `d`). A pipeline blind to the distinction is
 * the same pipeline by construction — which is why a divergence has to be
 * introduced as a visible, reviewable edit to one of these files rather than
 * appearing quietly in a branch nobody tested.
 *
 * ⚠ AND IT ASSERTS THE POSITIVE CONTROL. `e` pins that the discriminator IS
 * still read where it legitimately belongs — batch creation and close. A test
 * of the form "no file mentions X" is trivially satisfiable by deleting the
 * feature, and this project has already shipped one gate that passed because
 * the code it guarded was never called (`T-AI-030f`, TASK-190). If the
 * discovery concept ever evaporates, `e` fails rather than `a` passing louder.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Every module the extraction path runs through, from the submitted batch to
 * a resolved candidate. Ingest is included because AC-2 names it.
 */
const PIPELINE_FILES = [
  'apps/api/src/jobs/startExtraction.ts',
  'apps/api/src/jobs/runExtraction.ts',
  'apps/api/src/jobs/resolveCandidates.ts',
  'apps/api/src/extraction/configFromEnv.ts',
  'packages/domain/src/extraction/TitleExtractor.ts',
  'packages/domain/src/extraction/chooseReader.ts',
  'packages/domain/src/extraction/cleanup.ts',
  'packages/domain/src/extraction/crossCheck.ts',
  'packages/domain/src/matching/tmdbMatcher.ts',
];

/**
 * The names by which a module could learn a batch is a discovery capture.
 * Reading any one of them on the extraction path is the mechanism by which a
 * second pipeline would come into existence.
 */
const DISCRIMINATORS = [
  'discoverySource',
  'isDiscoverySource',
  'DISCOVERY_SOURCES',
  'DISCOVERY_SOURCE_LABELS',
  'discoverySourceOf',
  'requireService',
  'serviceOf',
];

function read(relative: string): string {
  const absolute = join(REPO_ROOT, relative);
  if (!existsSync(absolute)) {
    throw new Error(
      `${relative} does not exist. If the extraction path was restructured, update ` +
        'PIPELINE_FILES — do not delete the assertion.',
    );
  }
  return readFileSync(absolute, 'utf8');
}

/**
 * Prose mentions are not branches. A comment naming `discoverySource` to
 * explain why the pipeline ignores it is exactly the documentation this test
 * wants to encourage, so only code lines are considered.
 */
function codeLines(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('*') && !line.startsWith('//'));
}

describe('T-WAIT-012 — US-040 AC-2: one pipeline, blind to the batch kind', () => {
  it('T-WAIT-012a — no module on the extraction path reads the discovery discriminator', () => {
    const offences: string[] = [];

    for (const file of PIPELINE_FILES) {
      for (const line of codeLines(read(file))) {
        for (const name of DISCRIMINATORS) {
          if (line.includes(name)) offences.push(`${file}: ${name} in \`${line}\``);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('T-WAIT-012b — the extraction entry point takes no source, so no caller can pick a variant', () => {
    const source = read('apps/api/src/jobs/startExtraction.ts');

    const signature = /export async function startExtraction\(([^)]*)\)/.exec(source);
    expect(signature, 'startExtraction was renamed or restructured').not.toBeNull();

    const parameters = (signature?.[1] ?? '')
      .split(',')
      .map((part) => part.split(':')[0]?.trim())
      .filter((part): part is string => part !== undefined && part !== '');

    expect(parameters).toEqual(['ownerId', 'batchId', 'deps']);
  });

  it('T-WAIT-012c — extraction is started unconditionally, not behind a source test', () => {
    const source = read('apps/api/src/routes/batches.ts');
    const lines = source.split('\n');

    const callSites = lines
      .map((line, index) => ({ line: line.trim(), index }))
      .filter(({ line }) => line.startsWith('beginExtraction('));

    // Both are real and both matter: submit (§6.14) and re-extract (§6.24).
    expect(callSites).toHaveLength(2);

    for (const { line, index } of callSites) {
      // A guarded call would either be an `if (...) beginExtraction(...)` on
      // one line, or sit under a condition naming the discriminator.
      expect(line).toMatch(/^beginExtraction\([^)]*\);$/);

      const preceding = lines
        .slice(Math.max(0, index - 6), index)
        .map((entry) => entry.trim())
        .filter((entry) => !entry.startsWith('*') && !entry.startsWith('//'))
        .join(' ');

      for (const name of DISCRIMINATORS) {
        expect(
          preceding,
          `beginExtraction at line ${index + 1} is guarded by ${name}`,
        ).not.toContain(name);
      }
    }
  });

  it('T-WAIT-012d — there is no second extraction pipeline to route a discovery batch to', () => {
    const jobs = readdirSync(join(REPO_ROOT, 'apps/api/src/jobs'));
    const rivals = jobs.filter((name) => /discovery|rental|waiting/i.test(name));

    expect(rivals).toEqual([]);

    // And exactly one module owns the run loop.
    const extractionEntryPoints = jobs.filter((name) => /^(run|start)Extraction\.ts$/.test(name));
    expect(extractionEntryPoints.sort()).toEqual(['runExtraction.ts', 'startExtraction.ts']);
  });

  it('T-WAIT-012e — positive control: the discriminator is still read where it belongs', () => {
    // If discovery batches stopped existing, `a` would pass vacuously. These
    // are the two places ADR-0010 requires the distinction to be made.
    expect(read('apps/api/src/routes/batches.ts')).toContain('discoverySource');
    expect(read('apps/api/src/services/batchClose.ts')).toContain('discoverySource');
  });
});
