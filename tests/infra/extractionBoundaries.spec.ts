/**
 * Stage-1 boundary gates — `specs/ai.md` §2.1b, ADR-0001 Revision 2.
 * TASK-056.
 *
 * `T-AI-010` — `azureVisionExtractor.ts` is the ONLY file permitted to import
 * the Vision SDK. Confining the SDK to one adapter is what keeps
 * `packages/domain` pure and the matcher deterministic (`NFR-012a`): the
 * moment a second file imports it, provider shapes start leaking into logic
 * that is supposed to be provider-agnostic, and the ADR-0001 revert stops
 * being a configuration change.
 *
 * `T-AI-009` (static half) — no visual feature other than `Read` is named
 * anywhere under `extraction/`, and no streaming-service name appears there
 * at all. The request-level half of `T-AI-009` is asserted over the real wire
 * request in `apps/api/test/unit/extraction/azureVisionExtractor.spec.ts`; a
 * static scan alone could not see a feature assembled at runtime, and a
 * request-level assertion alone could not see a `Caption` call added to a file
 * no test happens to drive.
 *
 * ⚠ EVERY CASE HERE PROVES THE SCANNER WORKS, not merely that the tree is
 * currently clean — a clean tree passes a scanner that does nothing. Each ban
 * is fed a synthetic violation and required to catch it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The SDK, and the sole file allowed to name it. */
const VISION_SDK = '@azure-rest/ai-vision-image-analysis';
const SOLE_ADAPTER = 'apps/api/src/extraction/azureVisionExtractor.ts';

/**
 * The same confinement rule for the second provider SDK (`specs/ai.md` §2.1a,
 * TASK-056b). Two adapters, two SDKs, one importer each — that symmetry is
 * what makes ADR-0001's "swap the primary reader" a configuration change.
 */
const LLM_SDK = 'openai';
const SOLE_LLM_ADAPTER = 'apps/api/src/extraction/llmVisionExtractor.ts';

/**
 * The visual features `imageanalysis:analyze` offers. `Read` is the only one
 * nextup may ever request: `Caption`/`DenseCaptions` would push a generated
 * natural-language description of a personal screenshot through a captioning
 * model, and `People`/`Objects` would run person and face detection over the
 * owner's screen — for no product benefit at all (NFR-015).
 */
const FORBIDDEN_FEATURES = ['Caption', 'DenseCaptions', 'Tags', 'Objects', 'SmartCrops', 'People'];

/**
 * RULE B / REQ-058. The reader is never told which service it is looking at,
 * so no service name may appear under `extraction/` in any form.
 *
 * ⚠ `max` is also a JavaScript identifier. The scan therefore ignores property
 * accesses and longer identifiers — `Math.max`, `maxDecodePixels` and
 * `maxRetries` are not the streaming service, and a gate that fired on them
 * would be turned off within a day. A BARE `max` still fails, which is the
 * form a leaked service name actually takes (`service === 'max'`).
 */
const SERVICE_NAMES = ['netflix', 'max', 'hbo'];

/**
 * The ONE file exempt from the service-name ban, and the reason.
 *
 * ⚠ A GENUINE CONFLICT BETWEEN TWO SPECS, resolved here rather than by moving
 * the file somewhere the scanner cannot see it. `specs/ai.md` §3.2 step 3
 * lists the chrome vocabulary VERBATIM and it includes `hbo max`, `max` and
 * `netflix` — those words are printed on the screenshots, so an OCR orphan of
 * a Netflix page header reads exactly `NETFLIX`. Drop them and that orphan
 * becomes a `title-candidate`, i.e. a false title, which is the rate
 * `T-AI-030` measures. §2.1b's ban exists for a different reason: RULE B says
 * the READER is never told which service it is looking at, so nothing may
 * prompt, branch or steer on the service.
 *
 * A fixed vocabulary of on-screen words does neither. What makes that
 * verifiable rather than asserted is `T-AI-009g` below: the exempt file
 * IMPORTS NOTHING. A module with no imports has no reader, no request and no
 * batch to branch on — it cannot become service-conditional without first
 * failing that case.
 */
const CHROME_VOCABULARY = 'packages/domain/src/extraction/chromeTerms.ts';

interface SourceFile {
  relPath: string;
  text: string;
}

function collect(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const next = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
          continue;
        }
        walk(next);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts)$/.test(entry.name)) continue;
      out.push({
        relPath: path.relative(ROOT, next).split(path.sep).join('/'),
        text: readFileSync(next, 'utf8'),
      });
    }
  };
  walk(dir);
  return out;
}

/**
 * ⚠ Comments are stripped before every scan.
 *
 * Without this the bans fire on the prose that EXPLAINS them — the header of
 * `azureVisionExtractor.ts` names `Caption`, `Tags` and `People` precisely so
 * that the next reader knows not to add them, and a scanner that cannot tell
 * a warning from a violation forces that warning to be deleted. This has
 * already bitten other gates in this repository.
 */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** @returns the offending files. Exported so the cases below can mutate it. */
export function filesImporting(files: readonly SourceFile[], moduleName: string): string[] {
  const pattern = new RegExp(
    `(?:from|require\\()\\s*['"]${moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
  );
  return files.filter((file) => pattern.test(stripComments(file.text))).map((f) => f.relPath);
}

export function filesNaming(files: readonly SourceFile[], needles: readonly string[]): string[] {
  return files
    .filter((file) => {
      const code = stripComments(file.text);
      return needles.some((needle) => new RegExp(`(?<![.\\w])${needle}(?![\\w])`, 'i').test(code));
    })
    .map((f) => f.relPath);
}

const repoFiles = [...collect(path.join(ROOT, 'apps')), ...collect(path.join(ROOT, 'packages'))];
/**
 * PRODUCTION extraction sources only.
 *
 * ⚠ `/src/` is load-bearing. Without it the scan also sweeps
 * `apps/api/test/unit/extraction/`, where the tests that ASSERT these bans
 * necessarily contain the banned words — so the gate would fail on its own
 * test suite and the obvious "fix" would be to weaken the ban.
 */
const extractionFiles = repoFiles.filter((f) => /\/src\/(?:.*\/)?extraction\//.test(f.relPath));

describe('T-AI-010 — the Vision SDK is confined to one adapter', () => {
  it('T-AI-010a · is imported by exactly one file, and that file is the adapter', () => {
    expect(filesImporting(repoFiles, VISION_SDK)).toEqual([SOLE_ADAPTER]);
  });

  it('T-AI-010b · catches a second importer', () => {
    const planted: SourceFile[] = [
      { relPath: SOLE_ADAPTER, text: `import x from '${VISION_SDK}';` },
      { relPath: 'apps/api/src/jobs/runExtraction.ts', text: `import y from '${VISION_SDK}';` },
    ];
    expect(filesImporting(planted, VISION_SDK)).toEqual([
      SOLE_ADAPTER,
      'apps/api/src/jobs/runExtraction.ts',
    ]);
  });

  it('T-AI-010c · is not fooled by an import written as a require', () => {
    const planted: SourceFile[] = [
      { relPath: 'apps/api/src/other.ts', text: `const s = require('${VISION_SDK}');` },
    ];
    expect(filesImporting(planted, VISION_SDK)).toEqual(['apps/api/src/other.ts']);
  });

  it('T-AI-010d · does not count the SDK named only in a comment', () => {
    const planted: SourceFile[] = [
      { relPath: 'apps/api/src/other.ts', text: `// never import from '${VISION_SDK}'` },
    ];
    expect(filesImporting(planted, VISION_SDK)).toEqual([]);
  });
});

describe('T-AI-010 — the LLM SDK is confined to one adapter', () => {
  it('T-AI-010e · is imported by exactly one file, and that file is the adapter', () => {
    expect(filesImporting(repoFiles, LLM_SDK)).toEqual([SOLE_LLM_ADAPTER]);
  });

  it('T-AI-010f · catches a second importer', () => {
    const planted: SourceFile[] = [
      { relPath: SOLE_LLM_ADAPTER, text: `import { AzureOpenAI } from '${LLM_SDK}';` },
      { relPath: 'apps/api/src/routes/batches.ts', text: `import y from '${LLM_SDK}';` },
    ];
    expect(filesImporting(planted, LLM_SDK)).toEqual([
      SOLE_LLM_ADAPTER,
      'apps/api/src/routes/batches.ts',
    ]);
  });

  it('T-AI-010g · does not count the SDK named only in a comment', () => {
    const planted: SourceFile[] = [
      { relPath: 'apps/api/src/other.ts', text: `// do not import from '${LLM_SDK}'` },
    ];
    expect(filesImporting(planted, LLM_SDK)).toEqual([]);
  });
});

describe('T-AI-009 — only the Read feature, and no service ever', () => {
  it('T-AI-009a · scans a non-empty set of extraction files', () => {
    // Guards the whole suite against passing vacuously if `extraction/` is
    // ever moved: an empty input satisfies every assertion below.
    expect(extractionFiles.length).toBeGreaterThan(0);
  });

  it('T-AI-009b · names no visual feature other than Read', () => {
    expect(filesNaming(extractionFiles, FORBIDDEN_FEATURES)).toEqual([]);
  });

  it('T-AI-009c · catches a forbidden feature added to a request', () => {
    const planted: SourceFile[] = [
      {
        relPath: 'apps/api/src/extraction/azureVisionExtractor.ts',
        text: `const features = ['Read', 'Caption'];`,
      },
    ];
    expect(filesNaming(planted, FORBIDDEN_FEATURES)).toEqual([
      'apps/api/src/extraction/azureVisionExtractor.ts',
    ]);
  });

  it('T-AI-009d · names no streaming service anywhere under extraction/', () => {
    const scanned = extractionFiles.filter((f) => f.relPath !== CHROME_VOCABULARY);
    // The exemption must never become vacuous by the file being renamed away.
    expect(extractionFiles.map((f) => f.relPath)).toContain(CHROME_VOCABULARY);
    expect(filesNaming(scanned, SERVICE_NAMES)).toEqual([]);
  });

  it('T-AI-009g · the exempt vocabulary imports nothing, so it cannot branch', () => {
    // This is what buys the exemption. A pure data module has no reader, no
    // request and no batch in scope, so it cannot be made service-conditional
    // without first importing something and failing here.
    const vocabulary = extractionFiles.find((f) => f.relPath === CHROME_VOCABULARY);
    expect(vocabulary).toBeDefined();
    expect(stripComments(vocabulary?.text ?? '')).not.toMatch(/(?:^|\n)\s*import\s/);
    expect(filesNaming([vocabulary!], FORBIDDEN_FEATURES)).toEqual([]);
  });

  it('T-AI-009h · catches an import added to the exempt vocabulary', () => {
    const planted: SourceFile[] = [
      { relPath: CHROME_VOCABULARY, text: `import { service } from '../x.js';` },
    ];
    expect(stripComments(planted[0]!.text)).toMatch(/(?:^|\n)\s*import\s/);
  });

  it('T-AI-009e · catches a service name leaking into the reader', () => {
    const planted: SourceFile[] = [
      { relPath: 'apps/api/src/extraction/x.ts', text: `const hint = 'netflix';` },
      { relPath: 'apps/api/src/extraction/y.ts', text: `if (service === 'max') return;` },
    ];
    expect(filesNaming(planted, SERVICE_NAMES)).toEqual([
      'apps/api/src/extraction/x.ts',
      'apps/api/src/extraction/y.ts',
    ]);
  });

  it('T-AI-009f · does not fire on Math.max or a maxSomething identifier', () => {
    // The narrowing that makes the `max` ban usable must itself be asserted:
    // if it ever widens back, this suite goes red on ordinary arithmetic and
    // the next person's fix will be to delete the ban.
    const planted: SourceFile[] = [
      {
        relPath: 'apps/api/src/extraction/z.ts',
        text: `const a = Math.max(1, 2); const maxRetries = 0; const b = opts.max;`,
      },
    ];
    expect(filesNaming(planted, SERVICE_NAMES)).toEqual([]);
  });
});
