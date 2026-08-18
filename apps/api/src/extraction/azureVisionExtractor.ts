/**
 * The cross-check reader — Azure AI Vision `Read` OCR. `specs/ai.md` §2.1b,
 * ADR-0001 Revision 2. TASK-056.
 *
 * ⚠ THE ONLY FILE PERMITTED TO IMPORT THE VISION SDK (`T-AI-010`). Confining
 * the SDK to one adapter is what keeps `packages/domain` pure and the matcher
 * deterministic (NFR-012a). Everything above stage 1 sees `OcrLine[]` and
 * `ExtractionResult` and has never heard of Azure.
 *
 * ⚠ `features` IS `['Read']` AND NOTHING ELSE (`T-AI-009`). `Caption`,
 * `DenseCaptions` and `Tags` would push a generated natural-language
 * description of a personal screenshot through a captioning model for no
 * product benefit whatsoever (NFR-015). `People` and `Objects` would run face
 * and person detection over the owner's screen. None of them may be added,
 * not even temporarily for debugging.
 *
 * ⚠ RULE B (`specs/ai.md` §0, REQ-058). This reader is never told which
 * service the screenshot came from, and never reports one. There is no
 * `service` parameter, no `'netflix'`/`'max'` literal, and no field on the
 * result that could carry one. Service attribution belongs to the owner, who
 * declares it on the batch; a reader that guessed it could relabel a title
 * onto a service the owner never uploaded.
 *
 * ⚠ NOTHING DERIVED FROM AN IMAGE IS EVER LOGGED (NFR-009/NFR-015). The log
 * lines below carry a correlation id, an HTTP status, an elapsed time and
 * COUNTS. They never carry recognised text, a title, a bounding box, the image
 * bytes, the blob name or the endpoint's host. `T-AI-032`-class review applies
 * to every future edit here.
 *
 * TWO DELIBERATE DEVIATIONS FROM THE §2.1b CODE SNIPPET
 * ----------------------------------------------------
 * 1. The snippet passes `features: 'Read'` (a string) and `contentType:
 *    mimeType`. The SDK types `features` as `VisualFeatures[]` and
 *    `contentType` as the literal `'application/octet-stream'` — which is
 *    also what the service requires, since `imageanalysis:analyze` takes the
 *    raw octets of the image and sniffs the format itself. The wire query
 *    string is still exactly `features=Read`, which is the property
 *    `T-AI-009` actually cares about.
 * 2. The SDK's own retry pipeline is DISABLED (`retryOptions.maxRetries: 0`)
 *    and §2.2's policy is implemented here instead. Two retry layers compose
 *    multiplicatively — the SDK's three attempts inside our three would be
 *    nine calls against a 5,000/month free tier — and the SDK's schedule is
 *    neither 1 s/4 s nor injectable, so the timing could not be asserted
 *    without really waiting five seconds in CI.
 */

import { randomUUID } from 'node:crypto';

/**
 * ⚠ THE IMPORT SHAPE IS DELIBERATE AND VERIFIED IN BOTH RUNTIMES — do not
 * "simplify" it. It looks like defensive noise and it is not.
 *
 * The SDK ships CommonJS (`exports.default = createClient` plus an
 * `__esModule` marker) and `apps/api` is ESM. The two module systems this code
 * runs under disagree about what a default import of that package IS:
 *
 *   - **Node ESM** (production) binds it to the whole `module.exports`
 *     OBJECT, so the factory sits one level down at `.default`.
 *   - **Vite / Vitest** (the test runner) honours `__esModule` and unwraps it,
 *     so the default import IS the factory function.
 *
 * Either one-liner therefore works in exactly one of the two environments and
 * fails in the other — and the failure mode is `createClient is not a
 * function` at construction time, i.e. an outage of the cross-check reader
 * that no unit test would see if the tests were the environment that worked.
 * Probing the value is the only form that is correct in both.
 */
import visionSdk, {
  isUnexpected,
  type ImageAnalysisClient,
} from '@azure-rest/ai-vision-image-analysis';
import type { TokenCredential } from '@azure/identity';
import {
  ExtractorError,
  type ExtractionResult,
  type ExtractedTextItem,
  type ExtractorName,
  type ImageMimeType,
  type NormalisedBox,
  type OcrLine,
  type TitleExtractor,
} from '@nextup/domain';

type CreateClient = typeof visionSdk.default;

const createClient: CreateClient =
  typeof (visionSdk as unknown) === 'function'
    ? (visionSdk as unknown as CreateClient)
    : visionSdk.default;

/** `specs/ai.md` §2.2 — the per-image OCR ceiling. */
export const VISION_TIMEOUT_MS = 30_000;

/**
 * Two retries, 1 s then 4 s (`specs/ai.md` §2.2). Retried on 429, 500, 502,
 * 503, 504 and network errors ONLY — never on 400/401/403/413, where the
 * answer cannot change and a retry only burns free-tier transactions.
 */
export const VISION_RETRY_BACKOFF_MS: readonly number[] = [1_000, 4_000];

/** The retryable HTTP statuses, exactly as §2.2 lists them. */
export const VISION_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/**
 * ⚠ `['Read']`. See the header. This is exported so `T-AI-009` can assert the
 * literal rather than re-deriving it, and so a change to it is a change to a
 * named constant that shows up in every diff review.
 */
export const VISION_FEATURES = ['Read'] as const;

export const VISION_MODEL_VERSION = 'latest';
export const VISION_LANGUAGE = 'en';

const EXTRACTOR: ExtractorName = 'azure-vision-read';

export interface AzureVisionExtractorOptions {
  /** `NEXTUP_VISION_ENDPOINT`. */
  endpoint: string;
  /**
   * Managed identity in every real environment (RBAC `Cognitive Services
   * User`, `specs/ai.md` §2.1b). There is NO API key and no key option: a key
   * would be a secret to store, rotate and leak, and the container already
   * has an identity.
   *
   * Injected rather than constructed here so the offline contract suite
   * (`T-AI-033`) can supply a static token. Without that seam every test
   * would reach for IMDS and the suite would stop being offline.
   */
  credential: TokenCredential;
  /** Injected so retry backoff does not add five seconds to every test. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so the timeout path is assertable without waiting 30 s. */
  timeoutMs?: number;
  /** Injected so `x-ms-client-request-id` is deterministic in recordings. */
  newCorrelationId?: () => string;
  /** Structured diagnostics. Receives counts and statuses — never content. */
  log?: (event: VisionLogEvent) => void;
}

/**
 * ⚠ Every field here is a number, a status or an id. If you ever need to add
 * a `string` field to this type, stop: the only strings this module has access
 * to are derived from the owner's screenshot.
 */
export interface VisionLogEvent {
  event: 'attempt' | 'retry' | 'success' | 'failure';
  correlationId: string;
  attempt: number;
  httpStatus: number | null;
  elapsedMs: number;
  /** Present on `'success'` only. */
  lineCount?: number;
  /** Present on `'failure'` only — the `ExtractorFailureKind`, not a message. */
  kind?: string;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Reads `NEXTUP_VISION_ENDPOINT`.
 *
 * Throws when unset rather than defaulting, for the same reason
 * `readExtractorName` throws on a typo: a reader that silently does not run is
 * indistinguishable, downstream, from a reader that saw nothing — and "saw
 * nothing" is what a full-update batch reads as removals.
 */
export function readVisionEndpoint(env: Record<string, string | undefined>): string {
  const raw = env['NEXTUP_VISION_ENDPOINT']?.trim();
  if (raw === undefined || raw === '') {
    throw new Error(
      'NEXTUP_VISION_ENDPOINT is not set. The Azure AI Vision Read endpoint is required by ' +
        'the cross-check reader (specs/ai.md §2.1b).',
    );
  }
  return raw;
}

export class AzureVisionExtractor implements TitleExtractor {
  readonly name: ExtractorName = EXTRACTOR;

  readonly #client: ImageAnalysisClient;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #timeoutMs: number;
  readonly #newCorrelationId: () => string;
  readonly #log: (event: VisionLogEvent) => void;

  constructor(options: AzureVisionExtractorOptions) {
    this.#sleep = options.sleep ?? realSleep;
    this.#timeoutMs = options.timeoutMs ?? VISION_TIMEOUT_MS;
    this.#newCorrelationId = options.newCorrelationId ?? (() => randomUUID());
    this.#log = options.log ?? (() => undefined);

    this.#client = createClient(options.endpoint, options.credential, {
      // See the header: §2.2's policy lives in #post, not in the pipeline.
      retryOptions: { maxRetries: 0 },
    });
  }

  /**
   * The real API of this class, and the one the hybrid extractor (TASK-056c)
   * calls: raw OCR lines for `crossCheck()`.
   *
   * Boxes are normalised to `0..1` here, at the only boundary that knows the
   * image's pixel dimensions. Nothing downstream ever sees a pixel coordinate,
   * which is what lets the merge compare an OCR box with a model box at all.
   */
  async readLines(imageBytes: Uint8Array, mimeType: ImageMimeType): Promise<OcrLine[]> {
    // `mimeType` is accepted for interface symmetry and validated by the
    // caller; the analyze endpoint takes raw octets and sniffs the format.
    void mimeType;

    const body = await this.#post(imageBytes);

    const width = body.metadata?.width;
    const height = body.metadata?.height;
    if (!isPositiveFinite(width) || !isPositiveFinite(height)) {
      // Without dimensions the boxes cannot be normalised, and a guessed
      // denominator would put every box in the wrong place — which the merge
      // would then read as "no OCR line overlaps this tile", i.e. as an
      // unsupported title. Refusing is the only safe answer.
      throw new ExtractorError(
        'invalid-response',
        EXTRACTOR,
        'Azure AI Vision returned no image dimensions, so OCR boxes cannot be normalised.',
        200,
      );
    }

    const readResult = body.readResult;
    if (readResult === undefined) {
      // ⚠ ABSENT IS NOT EMPTY. `features=Read` was requested, so a response
      // with no `readResult` at all is a response we do not understand — and
      // an unread image silently reported as "no text" is, in full-update
      // mode, a wave of removals. Same reasoning as `finish_reason: 'length'`
      // on the other reader (`T-AI-040`). An image genuinely containing no
      // text comes back as `readResult.blocks: []`, which IS empty and is
      // handled below.
      throw new ExtractorError(
        'invalid-response',
        EXTRACTOR,
        'Azure AI Vision returned no readResult for a features=Read request.',
        200,
      );
    }

    const lines: OcrLine[] = [];
    for (const block of readResult.blocks ?? []) {
      for (const line of block.lines ?? []) {
        const box = normalisePolygon(line.boundingPolygon, width, height);
        if (box === null) continue;
        lines.push({
          text: line.text,
          box,
          confidence: meanWordConfidence(line.words),
        });
      }
    }
    return lines;
  }

  /**
   * Stage 1 in `azure-vision-read` mode — the ADR-0001 Revision 1 revert path,
   * reachable with `NEXTUP_EXTRACTOR=azure-vision-read` and no code change.
   *
   * ⚠ `crossCheck: 'llm-unavailable'`, ALWAYS, and this is not a bug to fix.
   * In this mode the primary reader is deliberately not called, so the
   * extraction genuinely was never corroborated. Reporting `'ok'` would be a
   * lie that permits a strictly-lower-quality read to propose mass removals —
   * exactly product invariant 2. The consequence is real and intended: the
   * revert path runs in degraded mode (§2.2a) and withholds removals. Restore
   * removals by restoring the hybrid reader, not by relaxing this value.
   *
   * Every item is `provider: 'ocr-only'`, `basis: 'text'`, `inferredTitle:
   * null` — OCR reads glyphs and identifies nothing — and `ocrSupport:
   * 'not-checked'`, because no cross-check ran. (`'exact'` is what §2.1c
   * step 2 assigns to an orphan *inside the merge*, where a second reader did
   * run; borrowing it here would misreport safety state as corroboration.)
   */
  async extract(imageBytes: Uint8Array, mimeType: ImageMimeType): Promise<ExtractionResult> {
    const lines = await this.readLines(imageBytes, mimeType);

    const items: ExtractedTextItem[] = lines.map((line) => ({
      rawText: line.text,
      inferredTitle: null,
      basis: 'text',
      ocrSupport: 'not-checked',
      provider: 'ocr-only',
      boundingBox: line.box,
      boxSource: 'ocr',
      confidence: line.confidence,
    }));

    return {
      items,
      crossCheck: 'llm-unavailable',
      // ⚠ Counts and flags only. `providerMeta` is logged, so nothing derived
      // from the image may appear in it (see the type's own warning).
      providerMeta: {
        extractor: EXTRACTOR,
        lineCount: lines.length,
      },
    };
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  async #post(imageBytes: Uint8Array): Promise<AnalyzeBody> {
    const correlationId = this.#newCorrelationId();
    let lastError: ExtractorError | null = null;

    for (let attempt = 0; attempt <= VISION_RETRY_BACKOFF_MS.length; attempt += 1) {
      if (attempt > 0) {
        const backoff = VISION_RETRY_BACKOFF_MS[attempt - 1] ?? 0;
        this.#log({
          event: 'retry',
          correlationId,
          attempt,
          httpStatus: lastError?.httpStatus ?? null,
          elapsedMs: backoff,
        });
        await this.#sleep(backoff);
      }

      const startedAt = Date.now();
      const outcome = await this.#postOnce(imageBytes, correlationId);
      const elapsedMs = Date.now() - startedAt;

      if (outcome instanceof ExtractorError) {
        this.#log({
          event: 'failure',
          correlationId,
          attempt,
          httpStatus: outcome.httpStatus,
          elapsedMs,
          kind: outcome.kind,
        });
        // A timeout and a 4xx are both terminal for this image: retrying a
        // 30-second timeout twice more spends 90 s of a 15-minute batch
        // ceiling to ask a question that already had time to answer, and
        // 400/401/403/413 cannot change. Only §2.2's transient set continues.
        if (!isRetryable(outcome)) throw outcome;
        lastError = outcome;
        continue;
      }

      this.#log({
        event: 'success',
        correlationId,
        attempt,
        httpStatus: 200,
        elapsedMs,
        lineCount: countLines(outcome),
      });
      return outcome;
    }

    throw (
      lastError ??
      new ExtractorError('unavailable', EXTRACTOR, 'Azure AI Vision could not be reached.', null)
    );
  }

  /** @returns the parsed body, or the error to consider retrying. Never throws. */
  async #postOnce(
    imageBytes: Uint8Array,
    correlationId: string,
  ): Promise<AnalyzeBody | ExtractorError> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);

    try {
      const response = await this.#client.path('/imageanalysis:analyze').post({
        body: imageBytes,
        queryParameters: {
          // ⚠ `Read` ONLY. `T-AI-009`. See the header before touching this.
          features: [...VISION_FEATURES],
          'model-version': VISION_MODEL_VERSION,
          language: VISION_LANGUAGE,
        },
        contentType: 'application/octet-stream',
        headers: { 'x-ms-client-request-id': correlationId },
        abortSignal: controller.signal,
      });

      if (isUnexpected(response)) {
        const status = Number(response.status);
        return new ExtractorError(
          'unavailable',
          EXTRACTOR,
          // The status, never the body: an error body can echo request
          // details, and this one's request is the owner's screenshot.
          `Azure AI Vision returned HTTP ${response.status}.`,
          Number.isFinite(status) ? status : null,
        );
      }

      return response.body;
    } catch (error) {
      if (timedOut) {
        return new ExtractorError(
          'timeout',
          EXTRACTOR,
          `Azure AI Vision did not respond within ${this.#timeoutMs} ms.`,
          null,
        );
      }
      // Deliberately does not include the caught error's text: a transport
      // failure message can carry the request URL and headers.
      void error;
      return new ExtractorError(
        'unavailable',
        EXTRACTOR,
        'The Azure AI Vision request failed at the network layer.',
        null,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

type AnalyzeBody =
  Awaited<ReturnType<ReturnType<ImageAnalysisClient['path']>['post']>> extends infer R
    ? R extends { status: '200'; body: infer B }
      ? B
      : never
    : never;

function isRetryable(error: ExtractorError): boolean {
  if (error.kind === 'timeout') return false;
  if (error.httpStatus === null) return error.kind === 'unavailable';
  return VISION_RETRYABLE_STATUSES.has(error.httpStatus);
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The reported quadrilateral, as a device-independent axis-aligned box.
 *
 * Read reports a polygon in PIXELS; every consumer above stage 1 works in
 * `0..1` so that an OCR box and a model box are comparable at all. Values are
 * clamped because a polygon may legitimately sit a pixel outside the frame,
 * and a negative or >1 coordinate would give the overlap test in §2.1c step 1
 * a negative area.
 *
 * @returns `null` for a polygon we cannot use, which drops that ONE line
 *   rather than failing the image — an unplaceable line is exactly as useful
 *   to a geometry-scoped merge as no line at all.
 */
function normalisePolygon(
  polygon: ReadonlyArray<{ x: number; y: number }> | undefined,
  width: number,
  height: number,
): NormalisedBox | null {
  if (!polygon || polygon.length === 0) return null;

  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of polygon) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    xs.push(point.x);
    ys.push(point.y);
  }

  const x0 = clamp01(Math.min(...xs) / width);
  const x1 = clamp01(Math.max(...xs) / width);
  const y0 = clamp01(Math.min(...ys) / height);
  const y1 = clamp01(Math.max(...ys) / height);

  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Read reports confidence per WORD, never per line, so a line's confidence is
 * the mean of its words'.
 *
 * That is an aggregate of provider-reported numbers, not an inference: no
 * value is invented, and a line with no words reports `null` rather than a
 * flattering default. `OcrLine.confidence` is nullable precisely so that
 * "the provider said nothing" stays distinguishable from "the provider said
 * zero".
 */
function meanWordConfidence(
  words: ReadonlyArray<{ confidence: number }> | undefined,
): number | null {
  if (!words || words.length === 0) return null;
  let total = 0;
  let counted = 0;
  for (const word of words) {
    if (!Number.isFinite(word.confidence)) continue;
    total += word.confidence;
    counted += 1;
  }
  return counted === 0 ? null : total / counted;
}

function countLines(body: AnalyzeBody): number {
  let count = 0;
  for (const block of body.readResult?.blocks ?? []) count += (block.lines ?? []).length;
  return count;
}
