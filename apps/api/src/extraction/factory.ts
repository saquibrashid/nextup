/**
 * The extractor factory — `specs/ai.md` §2.3. TASK-055.
 *
 * ⚠ This is the ONLY place a `TitleExtractor` implementation is chosen. Every
 * call site above stage 1 takes a `TitleExtractor` and never names one, which
 * is what makes ADR-0001's revert path a single configuration value rather
 * than a refactor (`NEXTUP_EXTRACTOR=azure-vision-read` restores Revision 1
 * behaviour exactly).
 *
 * ⚠ `NFR-012a` — the default is `'hybrid'` and it is a QUALITY decision.
 * `'azure-vision-read'` alone is cheaper and materially worse. Changing this
 * default to save money is non-compliance, not an optimisation; the only
 * admissible reason is a measured improvement on the `specs/ai.md` §9 gates,
 * recorded as an ADR-0001 addendum.
 *
 * PATH NOTE. `specs/ai.md` §2.3 shows this function in
 * `apps/api/src/extraction/index.ts`; `docs/backlog.md` TASK-055 names
 * `factory.ts`. The backlog is the work order, so the file is `factory.ts`.
 */

import {
  type CrossCheckFn,
  type ExtractorName,
  type TitleExtractor,
  isExtractorName,
} from '@nextup/domain';

import { AzureVisionExtractor, type AzureVisionExtractorOptions } from './azureVisionExtractor.js';
import { LlmVisionExtractor, type LlmVisionExtractorOptions } from './llmVisionExtractor.js';
import { type RecordingStore } from './recordings.js';
import { StubExtractor } from './stubExtractor.js';

/** The default, and the ADR-0001 Revision 2 design. */
export const DEFAULT_EXTRACTOR: ExtractorName = 'hybrid';

export interface ExtractorConfig {
  NEXTUP_EXTRACTOR: ExtractorName;
  /** Required by, and only by, the `'stub'` extractor. */
  recordings?: RecordingStore;
  /** The real merge (TASK-056c). Required by `'stub'` and `'hybrid'`. */
  crossCheck?: CrossCheckFn;
  /** Required by `'azure-vision-read'`, and later by `'hybrid'` (TASK-056c). */
  vision?: AzureVisionExtractorOptions;
  /** Required by `'llm-vision'`, and later by `'hybrid'` (TASK-056c). */
  llm?: LlmVisionExtractorOptions;
}

/**
 * Reads `NEXTUP_EXTRACTOR` from an environment.
 *
 * An unset value is the default. An UNRECOGNISED value throws rather than
 * falling back: a typo that silently downgrades the reader is exactly the
 * class of change `NFR-012a` forbids, and it would be invisible until a
 * golden run months later.
 */
export function readExtractorName(env: Record<string, string | undefined>): ExtractorName {
  const raw = env['NEXTUP_EXTRACTOR'];
  if (raw === undefined || raw === '') return DEFAULT_EXTRACTOR;
  if (!isExtractorName(raw)) {
    throw new Error(
      `NEXTUP_EXTRACTOR="${raw}" is not a known extractor. ` +
        `Expected one of: hybrid, llm-vision, azure-vision-read, stub (specs/ai.md §2.3).`,
    );
  }
  return raw;
}

/** Thrown for a valid selection whose implementation has not landed yet. */
export class ExtractorNotAvailableError extends Error {
  constructor(name: ExtractorName, task: string) {
    super(`The "${name}" extractor is not implemented yet — it lands with ${task}.`);
    this.name = 'ExtractorNotAvailableError';
  }
}

export function createExtractor(cfg: ExtractorConfig): TitleExtractor {
  switch (cfg.NEXTUP_EXTRACTOR) {
    case 'stub': {
      // Both are hard requirements, not defaults: a stub with no recordings
      // reports zero yield for every image, and a stub with a home-made merge
      // would be testing a second implementation of the thing under test.
      if (!cfg.recordings) {
        throw new Error('The "stub" extractor requires a RecordingStore (specs/testing.md §3.1).');
      }
      if (!cfg.crossCheck) {
        throw new Error(
          'The "stub" extractor requires the REAL crossCheck() (specs/testing.md §3.1) — ' +
            'it replays both readers and runs the shipped merge over them.',
        );
      }
      return new StubExtractor({ recordings: cfg.recordings, crossCheck: cfg.crossCheck });
    }

    // ── Not yet implemented ────────────────────────────────────────────────
    // Each of these is one line's work once its task lands. They throw a named
    // error rather than silently falling back to another reader: a fallback
    // here would change extraction quality without anything saying so.
    case 'hybrid':
      throw new ExtractorNotAvailableError('hybrid', 'TASK-056c (hybridExtractor.ts)');
    case 'llm-vision': {
      // The primary reader on its own (TASK-056b). Usable, and BETTER than
      // `'azure-vision-read'` — see `LlmVisionExtractor.extract` on why it
      // reports `crossCheck: 'ocr-unavailable'` and therefore still permits
      // removals. It is still not the shipped design: `'hybrid'` is.
      if (!cfg.llm) {
        throw new Error(
          'The "llm-vision" extractor requires an Azure OpenAI endpoint, deployment and ' +
            'credential (specs/ai.md §2.1a). There is no API-key fallback: auth is ' +
            'managed identity.',
        );
      }
      return new LlmVisionExtractor(cfg.llm);
    }
    case 'azure-vision-read': {
      // The ADR-0001 Revision 1 revert path (TASK-056). It runs, and it is
      // materially worse than `'hybrid'` — see `AzureVisionExtractor.extract`
      // on why it always reports `crossCheck: 'llm-unavailable'` and therefore
      // withholds removals. Selecting it is a deliberate, temporary act.
      if (!cfg.vision) {
        throw new Error(
          'The "azure-vision-read" extractor requires a Vision endpoint and credential ' +
            '(specs/ai.md §2.1b). There is no API-key fallback: auth is managed identity.',
        );
      }
      return new AzureVisionExtractor(cfg.vision);
    }
  }
}
