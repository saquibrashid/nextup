/**
 * TASK-056c — the HYBRID reader, and the shipped design (ADR-0001 Rev 2).
 *
 * Two independent readers issued together for one image, merged by the pure
 * deterministic `crossCheck()`. This is `DEFAULT_EXTRACTOR`; everything else in
 * `factory.ts` is a revert path or a test double.
 *
 * ⚠ THIS MODULE CONTAINS NO PROVIDER CODE. It composes `LlmVisionExtractor`
 * and `AzureVisionExtractor` through their `readTiles()` / `readLines()`
 * methods and never touches an SDK — `tests/infra/extractionBoundaries.spec.ts`
 * (`T-AI-010b`) fails the build if a second file imports the OpenAI SDK.
 *
 * ⚠ THE LEGS ARE ISSUED IN PARALLEL, AND THAT IS THE ONLY PARALLELISM ALLOWED
 * HERE. `specs/ai.md` §2.2: reader concurrency 2 (the two legs for ONE image),
 * image concurrency 1. The two legs cost no additional decoded raster — the
 * same `imageBytes` is handed to both — which is exactly why this "2" is safe
 * at 0.5 GiB while the image-level "2" is not (REQ-079, `RSK-016`).
 *
 * ⚠ `Promise.allSettled`, NEVER `Promise.all`. `all` rejects on the first
 * failure and abandons the other leg's result — which would turn every
 * single-leg outage into a whole-batch failure and delete degraded mode
 * (§2.2a) by accident. The whole point is that one leg failing is survivable.
 */

import {
  ExtractorError,
  crossCheck as defaultCrossCheck,
  isExtractorError,
  llmOnlyItems,
  ocrOnlyItems,
  type CrossCheckOutcome,
  type ExtractionResult,
  type ExtractorName,
  type ImageMimeType,
  type LlmTile,
  type OcrLine,
  type ProviderMeta,
  type TitleExtractor,
} from '@nextup/domain';

import type { AzureVisionExtractor } from './azureVisionExtractor.js';
import type { LlmVisionExtractor } from './llmVisionExtractor.js';

const EXTRACTOR: ExtractorName = 'hybrid';

/** The two legs, narrowed to what this module actually uses. */
export interface HybridLegs {
  /** The primary reader (`specs/ai.md` §2.1a). */
  llm: Pick<LlmVisionExtractor, 'readTiles'>;
  /** The deterministic cross-check reader (§2.1b). */
  vision: Pick<AzureVisionExtractor, 'readLines'>;
}

export interface HybridExtractorOptions extends HybridLegs {
  /**
   * The merge. Injected so tests can prove the extractor CALLS it rather than
   * re-implementing a merge inline; production always gets the real one.
   */
  crossCheck?: typeof defaultCrossCheck;
  /**
   * Diagnostics only. ⚠ NFR-009/NFR-015 — nothing derived from the owner's
   * screenshot may be passed here: no tile text, no OCR text, no bytes.
   */
  log?: (event: HybridLogEvent) => void;
}

export interface HybridLogEvent {
  extractor: 'hybrid';
  /** Which legs answered. Counts and statuses only — never content. */
  llmOk: boolean;
  visionOk: boolean;
  tileCount: number;
  lineCount: number;
  itemCount: number;
  crossCheck: CrossCheckOutcome;
  elapsedMs: number;
}

/**
 * ⚠ THE FAILURE TABLE, AND WHY EACH ROW IS WHAT IT IS (`specs/ai.md` §2.2).
 *
 * | LLM | OCR | Outcome | Removals |
 * |-----|-----|---------|----------|
 * | ok   | ok   | `'ok'`               | permitted |
 * | ok   | fail | `'ocr-unavailable'`  | **permitted** — the PRIMARY reader worked |
 * | fail | ok   | `'llm-unavailable'`  | **withheld** — degraded mode, §2.2a |
 * | fail | fail | throws               | whole batch fails |
 *
 * The asymmetry in the middle two rows is the part that looks like a bug and
 * is not. Losing OCR costs corroboration; losing the LLM costs the reading
 * itself and drops quality to Revision 1, so a full-update batch read that way
 * must never propose mass removal. `T-AI-036`.
 */
export class HybridExtractor implements TitleExtractor {
  readonly name: ExtractorName = EXTRACTOR;

  readonly #llm: HybridLegs['llm'];
  readonly #vision: HybridLegs['vision'];
  readonly #crossCheck: typeof defaultCrossCheck;
  readonly #log: ((event: HybridLogEvent) => void) | undefined;

  constructor(options: HybridExtractorOptions) {
    this.#llm = options.llm;
    this.#vision = options.vision;
    this.#crossCheck = options.crossCheck ?? defaultCrossCheck;
    this.#log = options.log;
  }

  async extract(imageBytes: Uint8Array, mimeType: ImageMimeType): Promise<ExtractionResult> {
    const startedAt = Date.now();

    const [llmSettled, visionSettled] = await Promise.allSettled([
      this.#llm.readTiles(imageBytes, mimeType),
      this.#vision.readLines(imageBytes, mimeType),
    ]);

    const tiles: LlmTile[] | null = llmSettled.status === 'fulfilled' ? llmSettled.value : null;
    const lines: OcrLine[] | null =
      visionSettled.status === 'fulfilled' ? visionSettled.value : null;

    if (tiles === null && lines === null) {
      // Both down. §2.2: the batch fails. Re-raise the PRIMARY reader's error
      // rather than inventing one — it carries the kind and HTTP status the
      // runner maps to `EXTRACTOR_UNAVAILABLE` vs `EXTRACTOR_ERROR`, and
      // synthesising a generic error here would erase the 429-exhaustion
      // signal that tells the owner to wait rather than to give up.
      throw asExtractorError(
        (llmSettled as PromiseRejectedResult).reason,
        (visionSettled as PromiseRejectedResult).reason,
      );
    }

    const outcome: CrossCheckOutcome =
      tiles === null ? 'llm-unavailable' : lines === null ? 'ocr-unavailable' : 'ok';

    // Each branch uses the SHARED projection from `degraded.ts`, never a local
    // one — the StubExtractor must produce byte-identical output on these
    // paths or the golden fixtures diverge from production for reasons no
    // failing test would explain.
    const items =
      tiles !== null && lines !== null
        ? this.#crossCheck(tiles, lines)
        : tiles !== null
          ? llmOnlyItems(tiles)
          : ocrOnlyItems(lines ?? []);

    const providerMeta: ProviderMeta = {
      llmOk: tiles !== null,
      visionOk: lines !== null,
      tileCount: tiles?.length ?? 0,
      lineCount: lines?.length ?? 0,
    };

    this.#log?.({
      extractor: 'hybrid',
      llmOk: tiles !== null,
      visionOk: lines !== null,
      tileCount: tiles?.length ?? 0,
      lineCount: lines?.length ?? 0,
      itemCount: items.length,
      crossCheck: outcome,
      elapsedMs: Date.now() - startedAt,
    });

    return { items, crossCheck: outcome, providerMeta };
  }
}

/**
 * Both legs failed. Prefer the primary reader's `ExtractorError`, then the OCR
 * leg's, and only then synthesise one.
 *
 * ⚠ Preferring an `ExtractorError` over a raw throw is deliberate: a raw
 * `TypeError` from a bug in our own code would otherwise be reported to the
 * owner as "the reader was unavailable, try later", which is advice that can
 * never work.
 */
function asExtractorError(llmReason: unknown, visionReason: unknown): ExtractorError {
  if (isExtractorError(llmReason)) return llmReason;
  if (isExtractorError(visionReason)) return visionReason;
  return new ExtractorError(
    'unavailable',
    EXTRACTOR,
    'Both readers failed and neither reported a usable error.',
  );
}
