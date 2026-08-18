/**
 * TASK-056b — the PRIMARY reader: Azure OpenAI `gpt-4.1` vision
 * (`specs/ai.md` §2.1a, ADR-0001 Revision 2).
 *
 * ⚠ `T-AI-010b`: THIS IS THE ONLY FILE IN THE REPO THAT MAY IMPORT THE OPENAI
 * SDK. A second importer means a second place where the model, the
 * temperature, the schema or the auth mode can drift, and the golden metrics
 * would then be measuring one call site while production uses another.
 * `tests/infra/extractionBoundaries.spec.ts` fails the build on a second
 * importer.
 *
 * ⚠ RULE B / REQ-058: this module must not name, receive or emit a streaming
 * service. `extract()` is given bytes and a MIME type and nothing else. The
 * response schema has no field a service name could occupy. `T-AI-009`
 * asserts that no service name appears anywhere under `src/**\/extraction/`.
 *
 * ⚠ NFR-009 / NFR-015: nothing read from the owner's screenshot — no prompt,
 * no image bytes, no data URI, no tile text — may reach a log. `LlmLogEvent`
 * carries counts, statuses and ids only, and its type makes that structural.
 *
 * ⚠ NFR-012a: the model is a QUALITY decision. `gpt-4.1-mini` is cheaper and
 * must not be selected to save money, and `detail: 'high'` must not be
 * downgraded to `'low'` — `'low'` downsamples to 512 px and destroys exactly
 * the small tile captions and artwork detail this reader exists to read.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * -----------------------------------------
 *  - It does not cross-check. Standalone (`NEXTUP_EXTRACTOR=llm-vision`) it
 *    reports `crossCheck: 'ocr-unavailable'`, because the OCR leg genuinely
 *    did not run. Per §2.2 that still PERMITS removals — the primary reader
 *    worked — which is the difference from the `azure-vision-read` path.
 *  - It does not re-check image size. The ingest stage already did
 *    (REQ-079); a second, separately-configured limit is exactly how two
 *    limits drift apart.
 *  - It does not interpret anything the model returned. Text from a
 *    screenshot is data, never instruction (`T-AI-044`).
 */

import { randomUUID } from 'node:crypto';

import type { TokenCredential } from '@azure/identity';
import { AzureOpenAI } from 'openai';

import type {
  ExtractedTextItem,
  ExtractionResult,
  ExtractorName,
  ImageMimeType,
  LlmTile,
  NormalisedBox,
  TitleExtractor,
} from '@nextup/domain';
import { CANDIDATE_BASES, ExtractorError } from '@nextup/domain';

import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_USER_PROMPT,
  TILE_SCHEMA,
  TILE_SCHEMA_NAME,
} from './prompts.js';

/** `specs/ai.md` §2.2 — the per-image LLM ceiling. Longer than OCR's 30 s. */
export const AOAI_TIMEOUT_MS = 60_000;

/**
 * Two retries, 1 s then 4 s (`specs/ai.md` §2.2), on 429/500/502/503/504 and
 * network errors ONLY.
 *
 * ⚠ Implemented HERE rather than by handing `maxRetries` to the SDK, for the
 * same reason as the Vision reader: two retry layers compose
 * multiplicatively (3 × 3 = 9 calls), and a vision call at `detail: 'high'`
 * with `max_tokens: 4096` is the single most expensive request this product
 * makes. The SDK's own retry is switched OFF in the constructor.
 */
export const AOAI_RETRY_BACKOFF_MS: readonly number[] = [1_000, 4_000];

/** The retryable HTTP statuses, exactly as §2.2 lists them. */
export const AOAI_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/**
 * ⚠ Every one of these is load-bearing (`specs/ai.md` §2.1a) and none is a
 * cost lever. `temperature: 0` and `seed` are what make the §9.5 golden runs
 * comparable between two runs of the same fixture.
 */
export const AOAI_TEMPERATURE = 0;
export const AOAI_TOP_P = 1;
export const AOAI_SEED = 1729;
export const AOAI_MAX_TOKENS = 4096;
/** `'low'` downsamples to 512 px. See the NFR-012a note in the header. */
export const AOAI_IMAGE_DETAIL = 'high';

/** Structured Outputs requires this or later. */
export const AOAI_API_VERSION = '2024-10-21';

const EXTRACTOR: ExtractorName = 'llm-vision';

export interface LlmVisionExtractorOptions {
  /** `NEXTUP_AOAI_ENDPOINT` — config, not a secret. */
  endpoint: string;
  /** `NEXTUP_AOAI_DEPLOYMENT` — e.g. `nextup-extract`. Config, not a secret. */
  deployment: string;
  /**
   * Container App system-assigned managed identity, RBAC role
   * `Cognitive Services OpenAI User`. **There is no API key option, here or
   * anywhere** — a key would be a secret to store, rotate and leak, and the
   * container already has an identity.
   *
   * Injected so the offline contract suite can supply a static token; without
   * that seam every test would reach for IMDS and the suite would stop being
   * offline.
   */
  credential: TokenCredential;
  apiVersion?: string;
  /** Injected so retry backoff does not add five seconds to every test. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so the timeout path is assertable without waiting 60 s. */
  timeoutMs?: number;
  /** Injected so the correlation id is deterministic in recordings. */
  newCorrelationId?: () => string;
  /** Structured diagnostics. Receives counts and statuses — never content. */
  log?: (event: LlmLogEvent) => void;
}

/**
 * ⚠ Every field here is a number, a status, an id or a closed enum value. If
 * you ever need to add a free `string` field to this type, stop: the only
 * strings this module has access to came out of the owner's screenshot.
 */
export interface LlmLogEvent {
  event: 'attempt' | 'retry' | 'success' | 'failure';
  correlationId: string;
  attempt: number;
  httpStatus: number | null;
  elapsedMs: number;
  /** Present on `'success'` only. */
  tileCount?: number;
  /** Present on `'success'` only. Token counts are cost data, not content. */
  promptTokens?: number | null;
  completionTokens?: number | null;
  /** Present on `'failure'` only — the `ExtractorFailureKind`, not a message. */
  kind?: string;
  /** Present on `'failure'` only. A closed enum from the provider, not prose. */
  finishReason?: string | null;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Reads the Azure OpenAI configuration.
 *
 * Throws when unset rather than defaulting, for the same reason
 * `readExtractorName` throws on a typo: a primary reader that silently does
 * not run is indistinguishable, downstream, from a reader that saw nothing —
 * and "saw nothing" is what a full-update batch reads as removals.
 */
export function readAoaiConfig(env: Record<string, string | undefined>): {
  endpoint: string;
  deployment: string;
} {
  const endpoint = env['NEXTUP_AOAI_ENDPOINT']?.trim();
  const deployment = env['NEXTUP_AOAI_DEPLOYMENT']?.trim();
  const missing: string[] = [];
  if (endpoint === undefined || endpoint === '') missing.push('NEXTUP_AOAI_ENDPOINT');
  if (deployment === undefined || deployment === '') missing.push('NEXTUP_AOAI_DEPLOYMENT');
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set. ` +
        'The Azure OpenAI vision endpoint and deployment are required by the primary ' +
        'reader (specs/ai.md §2.1a).',
    );
  }
  return { endpoint: endpoint as string, deployment: deployment as string };
}

/** The subset of the SDK response this module reads. */
interface ChatCompletionLike {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null } | null;
  }> | null;
  usage?: { prompt_tokens?: number | null; completion_tokens?: number | null } | null;
}

export class LlmVisionExtractor implements TitleExtractor {
  readonly name: ExtractorName = EXTRACTOR;

  readonly #client: AzureOpenAI;
  readonly #deployment: string;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #timeoutMs: number;
  readonly #newCorrelationId: () => string;
  readonly #log: (event: LlmLogEvent) => void;

  constructor(options: LlmVisionExtractorOptions) {
    this.#deployment = options.deployment;
    this.#sleep = options.sleep ?? realSleep;
    this.#timeoutMs = options.timeoutMs ?? AOAI_TIMEOUT_MS;
    this.#newCorrelationId = options.newCorrelationId ?? (() => randomUUID());
    this.#log = options.log ?? (() => undefined);

    this.#client = new AzureOpenAI({
      endpoint: options.endpoint,
      deployment: options.deployment,
      apiVersion: options.apiVersion ?? AOAI_API_VERSION,
      // Managed identity. `apiKey` is deliberately never passed.
      azureADTokenProvider: async () => {
        const token = await options.credential.getToken(
          'https://cognitiveservices.azure.com/.default',
        );
        if (token === null) {
          throw new ExtractorError(
            'unavailable',
            EXTRACTOR,
            'No managed-identity token was issued for Azure OpenAI.',
          );
        }
        return token.token;
      },
      // §2.2's retry policy lives in #post, not in the SDK pipeline.
      maxRetries: 0,
    });
  }

  /**
   * The real API: bytes in, tiles out.
   *
   * This is what the hybrid extractor (TASK-056c) calls for its primary leg.
   * `extract()` below is the thin standalone wrapper.
   */
  async readTiles(imageBytes: Uint8Array, mimeType: ImageMimeType): Promise<LlmTile[]> {
    const correlationId = this.#newCorrelationId();
    // Constructed here and never logged, never returned, never stored.
    const dataUri = `data:${mimeType};base64,${Buffer.from(imageBytes).toString('base64')}`;
    return await this.#post(dataUri, correlationId);
  }

  async extract(imageBytes: Uint8Array, mimeType: ImageMimeType): Promise<ExtractionResult> {
    const tiles = await this.readTiles(imageBytes, mimeType);
    const items: ExtractedTextItem[] = tiles.map((tile) => ({
      rawText: tile.visibleText ?? '',
      inferredTitle: tile.identifiedTitle,
      basis: tile.basis,
      // ⚠ Set by crossCheck(), never by a provider. The OCR leg did not run,
      // so this is 'not-checked' — safety state, not a statistic.
      ocrSupport: 'not-checked',
      provider: 'llm',
      boundingBox: tile.box,
      boxSource: 'llm',
      confidence: tile.confidence,
    }));

    return {
      items,
      /**
       * ⚠ `'ocr-unavailable'`, not `'ok'`: standalone, the cross-check reader
       * genuinely did not run, and `crossCheck` is safety state rather than a
       * description of this module's own success.
       *
       * Note the asymmetry with `azureVisionExtractor.extract()`, which
       * reports `'llm-unavailable'` and thereby WITHHOLDS removals. Here
       * removals stay permitted, because §2.2 says so: the primary,
       * higher-quality reader worked, so a title's absence is evidence. There
       * the only reader that ran was the strictly weaker one, so it is not.
       */
      crossCheck: 'ocr-unavailable',
      providerMeta: {
        extractor: EXTRACTOR,
        deployment: this.#deployment,
        tileCount: tiles.length,
        identifiedCount: tiles.filter((t) => t.identifiedTitle !== null).length,
      },
    };
  }

  /** §2.2's retry loop: 2 retries, 1 s then 4 s, retryable conditions only. */
  async #post(dataUri: string, correlationId: string): Promise<LlmTile[]> {
    const maxAttempts = AOAI_RETRY_BACKOFF_MS.length + 1;
    let lastError: ExtractorError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      this.#log({
        event: 'attempt',
        correlationId,
        attempt,
        httpStatus: null,
        elapsedMs: 0,
      });

      try {
        const tiles = await this.#postOnce(dataUri, correlationId, attempt, startedAt);
        return tiles;
      } catch (error) {
        const failure =
          error instanceof ExtractorError
            ? error
            : new ExtractorError(
                'unavailable',
                EXTRACTOR,
                'The Azure OpenAI request failed at the network layer.',
              );
        lastError = failure;

        const retryable =
          failure.kind === 'unavailable' &&
          (failure.httpStatus === null || AOAI_RETRYABLE_STATUSES.has(failure.httpStatus));

        const backoff = AOAI_RETRY_BACKOFF_MS[attempt - 1];
        if (!retryable || backoff === undefined) {
          this.#log({
            event: 'failure',
            correlationId,
            attempt,
            httpStatus: failure.httpStatus,
            elapsedMs: Date.now() - startedAt,
            kind: failure.kind,
          });
          throw failure;
        }

        this.#log({
          event: 'retry',
          correlationId,
          attempt,
          httpStatus: failure.httpStatus,
          elapsedMs: Date.now() - startedAt,
          kind: failure.kind,
        });
        await this.#sleep(backoff);
      }
    }

    /* c8 ignore next 6 -- unreachable: the loop either returns or throws. */
    throw (
      lastError ?? new ExtractorError('unavailable', EXTRACTOR, 'The Azure OpenAI request failed.')
    );
  }

  async #postOnce(
    dataUri: string,
    correlationId: string,
    attempt: number,
    startedAt: number,
  ): Promise<LlmTile[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.#timeoutMs);
    let timedOut = false;
    const onAbort = (): void => {
      timedOut = true;
    };
    controller.signal.addEventListener('abort', onAbort);

    let response: ChatCompletionLike;
    try {
      response = (await this.#client.chat.completions.create(
        {
          model: this.#deployment,
          temperature: AOAI_TEMPERATURE,
          top_p: AOAI_TOP_P,
          seed: AOAI_SEED,
          max_tokens: AOAI_MAX_TOKENS,
          response_format: {
            type: 'json_schema',
            json_schema: { name: TILE_SCHEMA_NAME, strict: true, schema: TILE_SCHEMA },
          },
          messages: [
            { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: EXTRACTION_USER_PROMPT },
                { type: 'image_url', image_url: { url: dataUri, detail: AOAI_IMAGE_DETAIL } },
              ],
            },
          ],
        },
        {
          signal: controller.signal,
          headers: { 'x-ms-client-request-id': correlationId },
        },
        // The SDK's overloads are narrower than the Structured-Outputs shape
        // above; the schema is validated by the service, and by T-AI-011b here.
      )) as unknown as ChatCompletionLike;
    } catch (error) {
      if (timedOut) {
        // ⚠ Terminal, NOT retried. §2.2 lists the timeout as a condition
        // separate from the retry set, and three 60 s attempts would spend
        // 180 s of a 15-minute whole-batch ceiling on one image.
        throw new ExtractorError(
          'timeout',
          EXTRACTOR,
          `The Azure OpenAI request did not complete within ${this.#timeoutMs} ms.`,
        );
      }
      throw toExtractorError(error);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
    }

    return this.#parse(response, correlationId, attempt, startedAt);
  }

  #parse(
    response: ChatCompletionLike,
    correlationId: string,
    attempt: number,
    startedAt: number,
  ): LlmTile[] {
    const choice = response.choices?.[0];
    const finishReason = choice?.finish_reason ?? null;
    const fail = (kind: 'truncated' | 'refused' | 'invalid-response', message: string): never => {
      this.#log({
        event: 'failure',
        correlationId,
        attempt,
        httpStatus: 200,
        elapsedMs: Date.now() - startedAt,
        kind,
        finishReason,
      });
      throw new ExtractorError(kind, EXTRACTOR, message, 200);
    };

    if (choice === undefined) {
      fail('invalid-response', 'The Azure OpenAI response contained no choices.');
    }

    // ⚠ T-AI-040. A truncated tile list is a SHORT tile list, and in
    // full-update mode a short tile list reads as a wave of removals. This is
    // an error, never a partial result, and it is deliberately checked BEFORE
    // the content is parsed — truncated JSON sometimes still parses.
    if (finishReason === 'length') {
      fail(
        'truncated',
        'The Azure OpenAI response was truncated (finish_reason: length). A partial tile ' +
          'list is never treated as a complete one.',
      );
    }

    // A refusal is an explicit answer, not an empty one. Reporting it as zero
    // tiles would, in full-update mode, propose removing everything.
    if (finishReason === 'content_filter' || typeof choice?.message?.refusal === 'string') {
      fail('refused', 'The Azure OpenAI content filter refused this image.');
    }

    const content = choice?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      fail('invalid-response', 'The Azure OpenAI response carried no message content.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content as string);
    } catch {
      // ⚠ Terminal, not retried. §2.2's retry set is explicit and exclusive
      // ("on 429, 500, 502, 503, 504 and network errors only"), and with
      // temperature 0, a fixed seed and strict Structured Outputs a repeat
      // request is near-deterministic — it would burn the most expensive call
      // this product makes to get the same answer.
      fail('invalid-response', 'The Azure OpenAI response was not valid JSON.');
    }

    const tiles = toTiles(parsed);
    if (tiles === null) {
      fail('invalid-response', 'The Azure OpenAI response did not match the committed schema.');
    }

    this.#log({
      event: 'success',
      correlationId,
      attempt,
      httpStatus: 200,
      elapsedMs: Date.now() - startedAt,
      tileCount: (tiles as LlmTile[]).length,
      promptTokens: response.usage?.prompt_tokens ?? null,
      completionTokens: response.usage?.completion_tokens ?? null,
    });
    return tiles as LlmTile[];
  }
}

/**
 * Maps an SDK/transport error onto the failure taxonomy.
 *
 * ⚠ 400/401/403/413 are NEVER retried: the answer cannot change, and a retry
 * only spends money and batch time. A status we do not recognise is treated as
 * `unavailable` but is only retried if it is in the retryable set, so an
 * unknown 4xx still fails immediately.
 */
function toExtractorError(error: unknown): ExtractorError {
  const status = readStatus(error);
  if (status === null) {
    return new ExtractorError(
      'unavailable',
      EXTRACTOR,
      'The Azure OpenAI request failed at the network layer.',
    );
  }
  if (status === 400 && isContentFilterError(error)) {
    return new ExtractorError(
      'refused',
      EXTRACTOR,
      'The Azure OpenAI content filter refused this image.',
      400,
    );
  }
  return new ExtractorError(
    'unavailable',
    EXTRACTOR,
    `The Azure OpenAI request failed with HTTP ${status}.`,
    status,
  );
}

function readStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

/**
 * Detects a content-filter rejection without ever putting the provider's
 * message into a log or an error: only the closed `code` is inspected.
 */
function isContentFilterError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'content_filter') return true;
  const inner = (error as { error?: { code?: unknown } } | null)?.error?.code;
  return inner === 'content_filter';
}

/**
 * Validates the model's JSON against `TILE_SCHEMA` and returns typed tiles, or
 * `null` if it does not conform.
 *
 * ⚠ `T-AI-044`: nothing here interprets the strings. A prompt-injection
 * payload inside `visibleText` is copied through as data and is never
 * evaluated, never concatenated into a later prompt, and cannot introduce a
 * field — an unknown property is dropped by construction, because this builds
 * a NEW object from known keys rather than spreading the parsed one.
 */
export function toTiles(parsed: unknown): LlmTile[] | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const raw = (parsed as { tiles?: unknown }).tiles;
  if (!Array.isArray(raw)) return null;

  const tiles: LlmTile[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const tile = entry as Record<string, unknown>;

    const visibleText = tile['visibleText'];
    const identifiedTitle = tile['identifiedTitle'];
    const basis = tile['basis'];
    const confidence = tile['confidence'];
    const box = toBox(tile['box']);

    if (visibleText !== null && typeof visibleText !== 'string') return null;
    if (identifiedTitle !== null && typeof identifiedTitle !== 'string') return null;
    if (typeof basis !== 'string' || !(CANDIDATE_BASES as readonly string[]).includes(basis)) {
      return null;
    }
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
    if (box === null) return null;

    tiles.push({
      visibleText,
      identifiedTitle,
      basis: basis as LlmTile['basis'],
      // Clamped, not rejected: a provider reporting 1.02 is a usable answer,
      // and every downstream threshold in §7 assumes 0..1.
      confidence: clamp01(confidence),
      box,
    });
  }
  return tiles;
}

function toBox(value: unknown): NormalisedBox | null {
  if (typeof value !== 'object' || value === null) return null;
  const box = value as Record<string, unknown>;
  const nums: number[] = [];
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const n = box[key];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    nums.push(n);
  }
  const [x, y, w, h] = nums as [number, number, number, number];
  // Clamped for the same reason the OCR reader clamps: the §2.1c overlap test
  // computes an area, and a negative one silently reads as "no support".
  return { x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
