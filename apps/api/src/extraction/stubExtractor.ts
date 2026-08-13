/**
 * `StubExtractor` — the offline extractor (`specs/testing.md` §3.1). TASK-055,
 * `T-STUB-001`.
 *
 * Selected by `NEXTUP_EXTRACTOR=stub`. It replays committed recordings of both
 * readers and then runs them through the **real** `crossCheck()`, so the merge
 * logic is exercised rather than stubbed — the merge is where every flag the
 * owner sees is computed, and a stub that faked it would test nothing.
 *
 * ⚠ It is byte-for-byte deterministic. `T-STUB-001` runs the same batch three
 * times and asserts identical output. Nothing here may consult the clock, a
 * random source, the environment, the filesystem outside the recording store,
 * or iteration order of anything unordered.
 *
 * FAULT INJECTION — WHY IT READS THE BYTES, NOT A FILENAME
 * -------------------------------------------------------
 * `specs/testing.md` §3.1 describes the faults by filename convention
 * (`__llm_down__.png`). But `TitleExtractor.extract()` is given bytes and a
 * MIME type and NOTHING ELSE — no filename, no image id, no ingest source —
 * and that omission is a deliberate, load-bearing part of the contract
 * (`specs/ai.md` §2.3). So the token must travel inside the fixture's own
 * bytes: a fault fixture is a file whose contents contain the ASCII token,
 * which for a real PNG means a `tEXt` chunk and for a synthetic test buffer
 * means the literal string.
 *
 * This scan runs ONLY in the stub. No production reader inspects image bytes
 * for control tokens, and none may be taught to.
 */

import {
  type CrossCheckFn,
  type ExtractionResult,
  type ImageMimeType,
  type TitleExtractor,
  ExtractorError,
  llmOnlyItems,
  ocrOnlyItems,
} from '@nextup/domain';

import { type RecordingStore, sha256OfBytes } from './recordings.js';

/**
 * The fault tokens, in the order they are matched. The order matters only
 * because a fixture could carry two; first-listed wins, deterministically.
 */
export const FAULT_TOKENS = [
  /** Both legs fail outright — a generic extractor error. */
  '__fail_error__',
  /** Rate-limited: a 429-shaped failure, so retry/backoff paths can be driven. */
  '__fail_429__',
  /** The per-image timeout elapsed. */
  '__slow__',
  /** The primary reader is down; OCR answers. DEGRADED MODE (`specs/ai.md` §2.2a). */
  '__llm_down__',
  /** The cross-check reader is down; the primary answers. Removals still permitted. */
  '__ocr_down__',
  /** `finish_reason: 'length'` — a truncated tile list. ALWAYS an error (`T-AI-040`). */
  '__truncated__',
] as const;

export type FaultToken = (typeof FAULT_TOKENS)[number];

/** @returns the first fault token present in the bytes, or `null`. */
export function faultTokenIn(imageBytes: Uint8Array): FaultToken | null {
  // latin1 so every byte maps to exactly one character and the search cannot be
  // thrown off by an invalid UTF-8 sequence in binary image data.
  const text = new TextDecoder('latin1').decode(imageBytes);
  return FAULT_TOKENS.find((token) => text.includes(token)) ?? null;
}

export interface StubExtractorOptions {
  recordings: RecordingStore;
  /**
   * The REAL merge (TASK-056c). Injected rather than imported so that the stub
   * cannot quietly become a second implementation of it — the whole point of
   * the stub is that the merge under test is the shipped one.
   */
  crossCheck: CrossCheckFn;
}

export class StubExtractor implements TitleExtractor {
  readonly name = 'stub' as const;

  readonly #recordings: RecordingStore;
  readonly #crossCheck: CrossCheckFn;

  constructor(options: StubExtractorOptions) {
    this.#recordings = options.recordings;
    this.#crossCheck = options.crossCheck;
  }

  extract(imageBytes: Uint8Array, mimeType: ImageMimeType): Promise<ExtractionResult> {
    // Async in signature, synchronous in fact. A real `await` would introduce a
    // scheduling point and, with it, the possibility of interleaving affecting
    // output — the one thing `T-STUB-001` exists to rule out.
    //
    // The try/catch is not decoration: `extract()` returns a Promise, so a
    // fault must REJECT it, not throw past the call site. A synchronous throw
    // from an async-shaped API is a different failure mode that no caller
    // written against the interface will catch.
    try {
      return Promise.resolve(this.#extractSync(imageBytes, mimeType));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  #extractSync(imageBytes: Uint8Array, mimeType: ImageMimeType): ExtractionResult {
    const fault = faultTokenIn(imageBytes);
    const sha256 = sha256OfBytes(imageBytes);
    // An unknown hash yields BOTH legs empty — the zero-yield case. See
    // `goldenRecordingStore`: a forgotten fixture must surface as the low-yield
    // path the product already handles, never as a crash.
    const recording = this.#recordings.get(sha256) ?? { llm: [], ocr: [] };

    const providerMeta = {
      extractor: 'stub',
      mimeType,
      sha256,
      fault,
      // `false` for a genuinely absent recording; the zero-yield path is a
      // RESULT, and telling the two apart in a log is the difference between
      // "the screenshot had nothing in it" and "nobody committed the fixture".
      recorded: this.#recordings.get(sha256) !== undefined,
    };

    switch (fault) {
      case '__fail_error__':
        throw new ExtractorError('invalid-response', 'stub', 'Injected extractor failure.');

      case '__fail_429__':
        throw new ExtractorError(
          'unavailable',
          'stub',
          'Injected rate-limit failure after retries.',
          429,
        );

      case '__slow__':
        // The OUTCOME of the timeout, not a real sleep: sleeping past a 60 s
        // per-image ceiling would add a minute to CI per fixture and make the
        // result depend on machine load, which is the opposite of `T-STUB-001`.
        throw new ExtractorError('timeout', 'stub', 'Injected per-image timeout.');

      case '__truncated__':
        // NEVER a partial result. A short tile list reads, in full-update mode,
        // as a wave of removals (`T-AI-040`).
        throw new ExtractorError('truncated', 'stub', 'Injected truncated response.');

      case '__llm_down__':
        return {
          items: ocrOnlyItems(recording.ocr),
          crossCheck: 'llm-unavailable',
          providerMeta,
        };

      case '__ocr_down__':
        return {
          items: llmOnlyItems(recording.llm),
          crossCheck: 'ocr-unavailable',
          providerMeta,
        };

      case null:
        return {
          items: this.#crossCheck(recording.llm, recording.ocr),
          crossCheck: 'ok',
          providerMeta,
        };
    }
  }
}
