/**
 * TASK-056b — the stage-1 contract suite for the PRIMARY reader.
 *
 * `T-AI-009` (the request half), `T-AI-011b` (the committed schema carries no
 * service field), `T-AI-033` (the `LlmVisionExtractor` half) and `T-AI-040`
 * (`finish_reason: 'length'` is an ERROR). `T-AI-044` (prompt injection) lives
 * here too, because the property it asserts — that nothing extracted is ever
 * interpreted — is a property of this parser.
 *
 * Offline against committed recordings (`specs/testing.md` §3.1a). Nothing
 * here reaches Azure; see `tests/fixtures/msw/aoai/index.ts` for why that is
 * enforced rather than intended.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SetupServerApi } from 'msw/node';

import { ExtractorError, isExtractorError } from '@nextup/domain';

import {
  AOAI_API_VERSION,
  AOAI_IMAGE_DETAIL,
  AOAI_MAX_TOKENS,
  AOAI_RETRY_BACKOFF_MS,
  AOAI_SEED,
  AOAI_TEMPERATURE,
  AOAI_TIMEOUT_MS,
  AOAI_TOP_P,
  LlmVisionExtractor,
  readAoaiConfig,
  toTiles,
  type LlmLogEvent,
} from '../../../src/extraction/llmVisionExtractor.js';
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_USER_PROMPT,
  TILE_SCHEMA,
  TILE_SCHEMA_NAME,
} from '../../../src/extraction/prompts.js';
import { createExtractor, ExtractorNotAvailableError } from '../../../src/extraction/factory.js';
import {
  AOAI_DEPLOYMENT,
  AOAI_ENDPOINT,
  BAD_REQUEST,
  BAD_SHAPE,
  CONTENT_FILTER_400,
  EMPTY,
  EXTRA_FIELD,
  INJECTION,
  NOT_JSON,
  RATE_LIMITED,
  REFUSAL,
  SERVER_ERROR,
  TRUNCATED,
  aoaiMswServer,
  fakeAoaiCredential,
  type RecordedRequest,
  type ReplayOptions,
} from '../../../../../tests/fixtures/msw/aoai/index.js';

/** A one-pixel PNG. The bytes never matter — only that they are transported. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
const CORRELATION_ID = '00000000-0000-4000-8000-000000000001';

let server: SetupServerApi | undefined;

interface Harness {
  extractor: LlmVisionExtractor;
  calls: RecordedRequest[];
  sleeps: number[];
  logs: LlmLogEvent[];
}

/**
 * `timeoutMs` is 50 ms and `sleep` is recorded rather than performed, so the
 * retry and timeout paths are asserted by their SCHEDULE rather than by really
 * waiting 2 × 60 s. A suite that waits is a suite someone eventually deletes.
 */
function makeHarness(options: ReplayOptions = {}, timeoutMs = 50): Harness {
  const calls: RecordedRequest[] = [];
  const sleeps: number[] = [];
  const logs: LlmLogEvent[] = [];

  server = aoaiMswServer({ ...options, calls });
  server.listen({ onUnhandledRequest: 'error' });

  const extractor = new LlmVisionExtractor({
    endpoint: AOAI_ENDPOINT,
    deployment: AOAI_DEPLOYMENT,
    credential: fakeAoaiCredential(),
    timeoutMs,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    newCorrelationId: () => CORRELATION_ID,
    log: (event) => logs.push(event),
  });

  return { extractor, calls, sleeps, logs };
}

beforeEach(() => {
  server = undefined;
});

afterEach(() => {
  server?.close();
  server = undefined;
});

/** Every string reachable from a value, at any depth. */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allStrings(v, out);
    }
  }
  return out;
}

describe('T-AI-009 the request the primary reader actually sends', () => {
  it('T-AI-009k · pins every load-bearing call parameter', async () => {
    const h = makeHarness();
    await h.extractor.readTiles(PNG_BYTES, 'image/png');

    expect(h.calls).toHaveLength(1);
    const body = h.calls[0]?.body as Record<string, unknown>;

    // NFR-012a: none of these is a cost lever, and each has a specific job.
    expect(body['temperature']).toBe(AOAI_TEMPERATURE);
    expect(body['temperature']).toBe(0);
    expect(body['top_p']).toBe(AOAI_TOP_P);
    expect(body['seed']).toBe(AOAI_SEED);
    expect(body['max_tokens']).toBe(AOAI_MAX_TOKENS);
    expect(h.calls[0]?.apiVersion).toBe(AOAI_API_VERSION);
    expect(h.calls[0]?.correlationId).toBe(CORRELATION_ID);
  });

  it('T-AI-009l · requests strict Structured Outputs against the committed schema', async () => {
    const h = makeHarness();
    await h.extractor.readTiles(PNG_BYTES, 'image/png');

    const format = (h.calls[0]?.body as Record<string, unknown>)['response_format'] as {
      type: string;
      json_schema: { name: string; strict: boolean; schema: unknown };
    };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.name).toBe(TILE_SCHEMA_NAME);
    // `strict: false` would make every rejection test below vacuous.
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema).toEqual(TILE_SCHEMA);
  });

  it('T-AI-009m · sends detail: high, and the image as a data URI of the given bytes', async () => {
    const h = makeHarness();
    await h.extractor.readTiles(PNG_BYTES, 'image/png');

    const messages = (h.calls[0]?.body as Record<string, unknown>)['messages'] as Array<{
      role: string;
      content: unknown;
    }>;
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toBe(EXTRACTION_SYSTEM_PROMPT);

    const parts = messages[1]?.content as Array<Record<string, unknown>>;
    expect(parts[0]).toEqual({ type: 'text', text: EXTRACTION_USER_PROMPT });
    const image = parts[1]?.['image_url'] as { url: string; detail: string };
    // 'low' downsamples to 512px and destroys what this reader exists to read.
    expect(image.detail).toBe(AOAI_IMAGE_DETAIL);
    expect(image.detail).toBe('high');
    expect(image.url).toBe(`data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`);
  });

  it('T-AI-009n · sends the JPEG media type when given JPEG bytes', async () => {
    const h = makeHarness();
    await h.extractor.readTiles(PNG_BYTES, 'image/jpeg');
    const parts = (
      (h.calls[0]?.body as Record<string, unknown>)['messages'] as Array<{ content: unknown }>
    )[1]?.content as Array<Record<string, unknown>>;
    expect((parts[1]?.['image_url'] as { url: string }).url).toContain('data:image/jpeg;base64,');
  });

  it('T-AI-009o · authenticates with a bearer token and never an API key', async () => {
    const h = makeHarness();
    await h.extractor.readTiles(PNG_BYTES, 'image/png');

    expect(h.calls[0]?.authorization).toBe('Bearer fixture-token-not-a-real-credential');
    // The api-key header is how Azure OpenAI takes a KEY. It must be absent:
    // there is no key anywhere in this product, and a fallback to one would
    // be a secret to store, rotate and leak.
    expect(JSON.stringify(h.calls[0]?.body)).not.toContain('api-key');
  });

  it('T-AI-009p · names no streaming service anywhere in the request', async () => {
    const h = makeHarness();
    await h.extractor.readTiles(PNG_BYTES, 'image/png');

    const haystack = JSON.stringify(h.calls[0]).toLowerCase();
    // RULE B / REQ-058. The extractor is never TOLD the service, so it cannot
    // leak one -- but the prompt is hand-written text and this is the gate
    // that catches an "e.g. Netflix" example being added to it as a kindness.
    expect(haystack).not.toContain('netflix');
    expect(haystack).not.toMatch(/(?<![.\w])max(?![\w])/);
    expect(haystack).not.toContain('hbo');
    expect(haystack).not.toContain('disney');
  });
});

describe('T-AI-011b the committed schema cannot carry a service', () => {
  it('T-AI-011b · no property name and no enum value contains a service name', () => {
    const strings = allStrings(TILE_SCHEMA).map((s) => s.toLowerCase());
    expect(strings.length).toBeGreaterThan(10);
    for (const banned of ['netflix', 'hbo', 'disney', 'prime', 'hulu']) {
      expect(strings.some((s) => s.includes(banned))).toBe(false);
    }
    expect(strings.some((s) => s === 'service' || s === 'platform' || s === 'provider')).toBe(
      false,
    );
  });

  it('T-AI-011c · is strict everywhere: every object bans additional properties', () => {
    const objects: Array<Record<string, unknown>> = [];
    const walk = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return;
      const obj = node as Record<string, unknown>;
      if (obj['type'] === 'object') objects.push(obj);
      for (const v of Object.values(obj)) walk(v);
    };
    walk(TILE_SCHEMA);
    // Vacuity guard: if the walk found nothing, the loop below asserts nothing.
    expect(objects.length).toBeGreaterThanOrEqual(3);
    for (const obj of objects) {
      expect(obj['additionalProperties']).toBe(false);
      // strict:true requires EVERY property to be listed in `required`.
      const props = Object.keys((obj['properties'] ?? {}) as Record<string, unknown>);
      expect([...(obj['required'] as string[])].sort()).toEqual([...props].sort());
    }
  });

  it('T-AI-011d · a response carrying a service field is stripped, not trusted', () => {
    const content = (
      (EXTRA_FIELD.body as { choices: Array<{ message: { content: string } }> }).choices[0] as {
        message: { content: string };
      }
    ).message.content;
    // The recording really does carry them, or this test proves nothing.
    expect(content).toContain('netflix');

    const tiles = toTiles(JSON.parse(content));
    expect(tiles).not.toBeNull();
    // Built from known keys rather than spread, so an unknown property has
    // nowhere to land. REQ-058 must not depend on a remote service honouring
    // its own schema.
    expect(Object.keys(tiles?.[0] ?? {}).sort()).toEqual(
      ['basis', 'box', 'confidence', 'identifiedTitle', 'visibleText'].sort(),
    );
    expect(JSON.stringify(tiles).toLowerCase()).not.toContain('netflix');
  });
});

describe('T-AI-033 parsing a valid result', () => {
  it('T-AI-033t · maps every tile, including the one it declined to identify', async () => {
    const h = makeHarness();
    const tiles = await h.extractor.readTiles(PNG_BYTES, 'image/png');

    expect(tiles).toHaveLength(4);
    expect(tiles[0]).toEqual({
      visibleText: 'The Diplomat',
      identifiedTitle: 'The Diplomat',
      basis: 'both',
      confidence: 0.94,
      box: { x: 0.04, y: 0.18, w: 0.22, h: 0.31 },
    });
    // ⚠ The unreadable tile SURVIVES. "Never omit a tile" is what stops a
    // full-update batch reading an unreadable tile as a removal.
    expect(tiles[2]?.visibleText).toBeNull();
    expect(tiles[2]?.identifiedTitle).toBeNull();
    expect(tiles[2]?.basis).toBe('unknown');
  });

  it('T-AI-033u · never coerces a declined identification into the visible text', async () => {
    const h = makeHarness();
    const tiles = await h.extractor.readTiles(PNG_BYTES, 'image/png');
    // The truncated caption is preserved VERBATIM, ellipsis and all, and the
    // model's refusal to complete it is preserved as null. An invented title
    // is worse than none (RSK-028).
    expect(tiles[3]?.visibleText).toBe('A Very Long Truncated Title Th…');
    expect(tiles[3]?.identifiedTitle).toBeNull();
  });

  it('T-AI-033v · clamps out-of-range confidence and out-of-frame boxes', async () => {
    const h = makeHarness();
    const tiles = await h.extractor.readTiles(PNG_BYTES, 'image/png');
    // 1.31 in the recording. Every §7 threshold assumes 0..1.
    expect(tiles[3]?.confidence).toBe(1);
    // x: -0.02 and w: 1.06 in the recording. A negative coordinate gives the
    // §2.1c overlap test a negative area, which reads as "no OCR support".
    expect(tiles[3]?.box.x).toBe(0);
    expect(tiles[3]?.box.w).toBe(1);
  });

  it('T-AI-033w · returns no tiles for a screenshot that genuinely has none', async () => {
    const h = makeHarness({ fallback: EMPTY });
    await expect(h.extractor.readTiles(PNG_BYTES, 'image/png')).resolves.toEqual([]);
  });
});

describe('T-AI-040 a truncated tile list is an ERROR, never a partial result', () => {
  it('T-AI-040 · rejects finish_reason: length even though the JSON parses', async () => {
    const h = makeHarness({ fallback: TRUNCATED });
    const error = await h.extractor.readTiles(PNG_BYTES, 'image/png').catch((e: unknown) => e);

    expect(isExtractorError(error)).toBe(true);
    expect((error as ExtractorError).kind).toBe('truncated');
    // The trap: the recording's content is valid JSON with one complete tile,
    // so an implementation that parses first and checks finish_reason after
    // returns 1 tile and looks entirely successful.
    expect((error as ExtractorError).message).toContain('truncated');
  });

  it('T-AI-040b · does not retry a truncation — the answer will not change', async () => {
    const h = makeHarness({ fallback: TRUNCATED });
    await h.extractor.readTiles(PNG_BYTES, 'image/png').catch(() => undefined);
    expect(h.calls).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
  });
});

describe('T-AI-033 responses we cannot use are never empty ones', () => {
  /**
   * Each of these is a 200 the SDK is perfectly happy with. The danger is
   * uniform: the cheapest reading of every one of them is "no tiles found",
   * which is indistinguishable from a genuinely empty screenshot and would
   * silently delete the owner's list on a full update. They must all raise.
   */
  const rejects = async (fallback: ReplayOptions['fallback'], kind: string): Promise<void> => {
    const h = makeHarness({ fallback });
    const error = await h.extractor.readTiles(PNG_BYTES, 'image/png').catch((e: unknown) => e);
    expect(isExtractorError(error)).toBe(true);
    expect((error as ExtractorError).kind).toBe(kind);
  };

  it('T-AI-033x · rejects a refusal on a 200 as refused', async () => {
    await rejects(REFUSAL, 'refused');
  });

  it('T-AI-033am · rejects prose instead of JSON as invalid-response', async () => {
    await rejects(NOT_JSON, 'invalid-response');
  });

  it('T-AI-033an · rejects a basis outside the closed enum as invalid-response', async () => {
    await rejects(BAD_SHAPE, 'invalid-response');
  });

  it('T-AI-033y · a 400 content-filter rejection is a refusal, not an outage', async () => {
    const h = makeHarness({ fallback: CONTENT_FILTER_400 });
    const error = await h.extractor.readTiles(PNG_BYTES, 'image/png').catch((e: unknown) => e);
    // Same status as a malformed request, entirely different meaning: one is
    // our bug, the other is a decision about the owner's screenshot.
    expect((error as ExtractorError).kind).toBe('refused');
    expect(h.calls).toHaveLength(1);
  });

  it('T-AI-033z · never turns an unusable response into zero tiles', async () => {
    for (const fallback of [REFUSAL, NOT_JSON, BAD_SHAPE, TRUNCATED, CONTENT_FILTER_400]) {
      server?.close();
      const h = makeHarness({ fallback });
      const result = await h.extractor.readTiles(PNG_BYTES, 'image/png').catch(() => 'threw');
      // The whole safety property in one line: in full-update mode, [] is a
      // proposal to remove every title on the list.
      expect(result).toBe('threw');
    }
  });
});

describe('T-AI-044 nothing the model returns is ever interpreted', () => {
  it('T-AI-044 · a prompt-injection payload survives as inert data', async () => {
    const h = makeHarness({ fallback: INJECTION });
    const result = await h.extractor.extract(PNG_BYTES, 'image/png');

    expect(result.items).toHaveLength(2);
    // Verbatim, because it is the text on a tile and that is what stage 2
    // matches on. It is data, not instruction.
    expect(result.items[0]?.rawText).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS');
    // It asked for a service name and for deletions. It got neither: there is
    // no field to carry one, and this module has no delete anything.
    expect(result.items[0]?.inferredTitle).toBeNull();
    expect(Object.keys(result.items[0] ?? {})).not.toContain('service');
    expect(result.items[1]?.rawText).toContain('</system>');
  });
});

describe('T-AI-033 retries follow §2.2 exactly', () => {
  it('T-AI-033aa · retries a 429 twice at 1 s then 4 s, then reports unavailable', async () => {
    const h = makeHarness({ script: [RATE_LIMITED, RATE_LIMITED, RATE_LIMITED] });
    const error = await h.extractor.readTiles(PNG_BYTES, 'image/png').catch((e: unknown) => e);

    expect((error as ExtractorError).kind).toBe('unavailable');
    expect((error as ExtractorError).httpStatus).toBe(429);
    expect(h.calls).toHaveLength(3);
    expect(h.sleeps).toEqual([...AOAI_RETRY_BACKOFF_MS]);
    expect(h.sleeps).toEqual([1_000, 4_000]);
  });

  it('T-AI-033ab · recovers when a transient failure is followed by success', async () => {
    const h = makeHarness({ script: [SERVER_ERROR] });
    await expect(h.extractor.readTiles(PNG_BYTES, 'image/png')).resolves.toHaveLength(4);
    expect(h.calls).toHaveLength(2);
    expect(h.sleeps).toEqual([1_000]);
  });

  it('T-AI-033ac · retries a transport failure, which carries no status at all', async () => {
    const h = makeHarness({ script: ['network-error'] });
    await expect(h.extractor.readTiles(PNG_BYTES, 'image/png')).resolves.toHaveLength(4);
    expect(h.calls).toHaveLength(2);
  });

  it('T-AI-033ad · never retries a 400 — it costs the most expensive call we make', async () => {
    const h = makeHarness({ fallback: BAD_REQUEST });
    const error = await h.extractor.readTiles(PNG_BYTES, 'image/png').catch((e: unknown) => e);
    expect((error as ExtractorError).httpStatus).toBe(400);
    expect(h.calls).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
  });

  it('T-AI-033ae · reports a timeout as a timeout, and does not retry it', async () => {
    const h = makeHarness({ script: ['hang'] });
    const error = await h.extractor.readTiles(PNG_BYTES, 'image/png').catch((e: unknown) => e);
    expect((error as ExtractorError).kind).toBe('timeout');
    // Terminal by design: three 60 s attempts spend 180 s of a 15-minute
    // whole-batch ceiling on one image.
    expect(h.sleeps).toEqual([]);
  });
});

describe('T-AI-033 the extract() surface', () => {
  it('T-AI-033af · emits llm items that claim no OCR corroboration', async () => {
    const h = makeHarness();
    const result = await h.extractor.extract(PNG_BYTES, 'image/png');

    expect(result.items).toHaveLength(4);
    for (const item of result.items) {
      expect(item.provider).toBe('llm');
      expect(item.boxSource).toBe('llm');
      // Safety state, not a statistic: the OCR leg did not run.
      expect(item.ocrSupport).toBe('not-checked');
    }
    // A tile with no legible text becomes '' — not the inferred title.
    expect(result.items[2]?.rawText).toBe('');
  });

  it('T-AI-033ag · reports crossCheck ocr-unavailable, which still PERMITS removals', async () => {
    const h = makeHarness();
    const result = await h.extractor.extract(PNG_BYTES, 'image/png');
    // ⚠ Note the asymmetry with azureVisionExtractor, which reports
    // 'llm-unavailable' and WITHHOLDS removals. Here the primary, higher
    // quality reader worked, so a title's absence is evidence (§2.2).
    expect(result.crossCheck).toBe('ocr-unavailable');
    expect(result.crossCheck).not.toBe('ok');
  });

  it('T-AI-033ah · carries counts in providerMeta and nothing read from the image', async () => {
    const h = makeHarness();
    const result = await h.extractor.extract(PNG_BYTES, 'image/png');

    expect(result.providerMeta['tileCount']).toBe(4);
    expect(result.providerMeta['identifiedCount']).toBe(2);
    const meta = JSON.stringify(result.providerMeta);
    expect(meta).not.toContain('Diplomat');
    expect(meta).not.toContain('base64');
  });
});

describe('T-AI-009 logging carries no prompt, no image and no tile text', () => {
  it('T-AI-009q · logs counts, statuses and ids only', async () => {
    const h = makeHarness();
    await h.extractor.extract(PNG_BYTES, 'image/png');

    expect(h.logs.length).toBeGreaterThan(0);
    const dumped = JSON.stringify(h.logs);
    expect(dumped).not.toContain('Diplomat');
    expect(dumped).not.toContain('You read a screenshot');
    expect(dumped).not.toContain('base64');
    expect(h.logs.at(-1)).toMatchObject({ event: 'success', tileCount: 4, httpStatus: 200 });
    expect(h.logs.at(-1)?.promptTokens).toBe(1204);
  });

  it('T-AI-009r · a refusal logs its KIND, never the provider message', async () => {
    const h = makeHarness({ fallback: REFUSAL });
    await h.extractor.readTiles(PNG_BYTES, 'image/png').catch(() => undefined);

    const failure = h.logs.find((e) => e.event === 'failure');
    expect(failure?.kind).toBe('refused');
    // The provider's refusal text is about the owner's screenshot content.
    expect(JSON.stringify(h.logs)).not.toContain("I'm sorry");
  });
});

describe('T-AI-033 configuration and factory wiring', () => {
  it('T-AI-033ai · refuses to run without endpoint and deployment', () => {
    expect(() => readAoaiConfig({})).toThrow(/NEXTUP_AOAI_ENDPOINT and NEXTUP_AOAI_DEPLOYMENT/);
    expect(() => readAoaiConfig({ NEXTUP_AOAI_ENDPOINT: 'https://x' })).toThrow(
      /NEXTUP_AOAI_DEPLOYMENT/,
    );
    expect(
      readAoaiConfig({ NEXTUP_AOAI_ENDPOINT: ' https://x ', NEXTUP_AOAI_DEPLOYMENT: ' d ' }),
    ).toEqual({ endpoint: 'https://x', deployment: 'd' });
  });

  it('T-AI-033aj · is what NEXTUP_EXTRACTOR=llm-vision selects', () => {
    const built = createExtractor({
      NEXTUP_EXTRACTOR: 'llm-vision',
      llm: {
        endpoint: AOAI_ENDPOINT,
        deployment: AOAI_DEPLOYMENT,
        credential: fakeAoaiCredential(),
      },
    });
    expect(built).toBeInstanceOf(LlmVisionExtractor);
    expect(built.name).toBe('llm-vision');
  });

  it('T-AI-033ak · refuses to build one without a credential rather than falling back', () => {
    // A silent fallback to another reader would change extraction quality with
    // nothing saying so (NFR-012a).
    expect(() => createExtractor({ NEXTUP_EXTRACTOR: 'llm-vision' })).toThrow(
      /requires an Azure OpenAI endpoint, deployment and credential/,
    );
    expect(() => createExtractor({ NEXTUP_EXTRACTOR: 'llm-vision' })).not.toThrow(
      ExtractorNotAvailableError,
    );
  });

  it('T-AI-033al · pins the 60 s per-image ceiling', () => {
    expect(AOAI_TIMEOUT_MS).toBe(60_000);
  });
});
