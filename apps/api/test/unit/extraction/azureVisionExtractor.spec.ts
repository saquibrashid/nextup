/**
 * `T-AI-009` (request half) and `T-AI-033` (the Azure AI Vision half of the
 * stage-1 provider-contract suite). TASK-056, US-006.
 *
 * Every case runs against committed recordings (`tests/fixtures/msw/vision/`)
 * through `msw`, so the REAL `AzureVisionExtractor` and the REAL SDK pipeline
 * are exercised with no subscription, no managed identity and no cost
 * (`specs/testing.md` §3.1a).
 *
 * ⚠ `msw` rather than a fake client, deliberately. Half of what this file
 * asserts is a property of the REQUEST — that `features` is `Read` and
 * nothing else, that the correlation id is sent, that no service name appears
 * in the call. A fake client would prove what the extractor does with a
 * response and prove nothing about what it asks for.
 *
 * Backoff is asserted by the sleep LOG, never by actually waiting five
 * seconds.
 *
 * The LLM half of `T-AI-033` (strict-schema rejection, `finish_reason:
 * 'length'`, content-filter refusals) lands with TASK-056b — those cases
 * belong to a reader that does not exist yet, and squatting them here would
 * make the suite green for behaviour nothing implements.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  AzureVisionExtractor,
  VISION_RETRY_BACKOFF_MS,
  readVisionEndpoint,
} from '../../../src/extraction/azureVisionExtractor.js';
import { createExtractor } from '../../../src/extraction/factory.js';
import {
  BAD_REQUEST,
  EMPTY,
  NO_METADATA,
  NO_READ_RESULT,
  RATE_LIMITED,
  SERVER_ERROR,
  VISION_ENDPOINT,
  fakeVisionCredential,
  visionMswServer,
  type RecordedRequest,
  type ReplayOptions,
} from '../../../../../tests/fixtures/msw/vision/index.js';

let server: ReturnType<typeof visionMswServer> | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

function makeExtractor(options: ReplayOptions = {}): {
  extractor: AzureVisionExtractor;
  calls: RecordedRequest[];
  slept: number[];
} {
  const calls: RecordedRequest[] = [];
  const slept: number[] = [];

  server?.close();
  server = visionMswServer({ ...options, calls });
  server.listen({ onUnhandledRequest: 'error' });

  const extractor = new AzureVisionExtractor({
    endpoint: VISION_ENDPOINT,
    credential: fakeVisionCredential(),
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    timeoutMs: 50,
    newCorrelationId: () => 'fixed-correlation-id',
  });

  return { extractor, calls, slept };
}

async function failureOf(promise: Promise<unknown>): Promise<{
  kind: string;
  httpStatus: number | null;
  message: string;
}> {
  try {
    await promise;
  } catch (error) {
    const e = error as { kind?: string; httpStatus?: number | null; message: string };
    return {
      kind: e.kind ?? 'not-an-ExtractorError',
      httpStatus: e.httpStatus ?? null,
      message: e.message,
    };
  }
  throw new Error('expected the call to reject, but it resolved');
}

// ── T-AI-009 — the request ──────────────────────────────────────────────────

describe('T-AI-009 — the Read request', () => {
  it('T-AI-009g · requests features=Read and nothing else', async () => {
    const { extractor, calls } = makeExtractor();
    await extractor.readLines(PNG_BYTES, 'image/png');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.features).toBe('Read');
  });

  it('T-AI-009h · sends no other visual feature as a query parameter', async () => {
    const { extractor, calls } = makeExtractor();
    await extractor.readLines(PNG_BYTES, 'image/png');

    const target = calls[0]?.target ?? '';
    for (const feature of ['Caption', 'DenseCaptions', 'Tags', 'Objects', 'SmartCrops', 'People']) {
      expect(target).not.toContain(feature);
    }
  });

  it('T-AI-009i · names no streaming service anywhere in the request', async () => {
    // RULE B / REQ-058: the reader must not be able to be influenced by, or
    // to leak, which service the owner was looking at.
    const { extractor, calls } = makeExtractor();
    await extractor.readLines(PNG_BYTES, 'image/png');

    expect(calls[0]?.target.toLowerCase()).not.toMatch(/netflix|hbo/);
  });

  it('T-AI-009j · sends the correlation id and raw octets', async () => {
    const { extractor, calls } = makeExtractor();
    await extractor.readLines(PNG_BYTES, 'image/png');

    expect(calls[0]?.correlationId).toBe('fixed-correlation-id');
    expect(calls[0]?.contentType).toBe('application/octet-stream');
  });
});

// ── T-AI-033 — response handling ────────────────────────────────────────────

describe('T-AI-033 — parsing a valid Read result', () => {
  it('T-AI-033a · maps every line, normalising boxes to 0..1', async () => {
    const { extractor } = makeExtractor();
    const lines = await extractor.readLines(PNG_BYTES, 'image/png');

    expect(lines.map((l) => l.text)).toEqual([
      'Stranger Things',
      'Continue Watching',
      'The Last of Us',
    ]);
    // 100..500 of 1000 wide, 400..500 of 2000 tall. Asserted per component
    // rather than by deep equality: `w`/`h` are subtractions of quotients, so
    // `0.05` really arrives as `0.049999999999999996`.
    const box = lines[0]?.box;
    expect(box?.x).toBeCloseTo(0.1, 10);
    expect(box?.y).toBeCloseTo(0.2, 10);
    expect(box?.w).toBeCloseTo(0.4, 10);
    expect(box?.h).toBeCloseTo(0.05, 10);
  });

  it('T-AI-033b · clamps a polygon that straddles the frame edge', async () => {
    // Read really does report coordinates a pixel or two outside the image.
    // Left un-clamped they give the §2.1c overlap test a negative area, which
    // silently reads as "no OCR line supports this tile".
    const { extractor } = makeExtractor();
    const lines = await extractor.readLines(PNG_BYTES, 'image/png');

    const straddling = lines[2];
    expect(straddling?.box.x).toBe(0);
    expect(straddling?.box.x ?? 0 + (straddling?.box.w ?? 0)).toBeLessThanOrEqual(1);
    expect(straddling?.box.y ?? 0 + (straddling?.box.h ?? 0)).toBeLessThanOrEqual(1);
  });

  it('T-AI-033c · reports the mean word confidence, and null when there are no words', async () => {
    const { extractor } = makeExtractor();
    const lines = await extractor.readLines(PNG_BYTES, 'image/png');

    expect(lines[0]?.confidence).toBeCloseTo((0.994 + 0.986) / 2, 10);
    // ⚠ null, not 0 and not 1. "The provider said nothing" must stay
    // distinguishable from "the provider said it is certain".
    expect(lines[1]?.confidence).toBeNull();
    expect(lines[2]?.confidence).toBeCloseTo(0.6, 10);
  });

  it('T-AI-033d · returns no lines for an image that genuinely contains no text', async () => {
    const { extractor } = makeExtractor({ fallback: EMPTY });
    await expect(extractor.readLines(PNG_BYTES, 'image/png')).resolves.toEqual([]);
  });
});

describe('T-AI-033 — a response we cannot use is never an empty one', () => {
  it('T-AI-033e · rejects a 200 with no readResult', async () => {
    // ⚠ ABSENT IS NOT EMPTY. An unread image reported as "no text" is, in
    // full-update mode, a wave of removals (product invariant 2).
    const { extractor } = makeExtractor({ fallback: NO_READ_RESULT });
    const failure = await failureOf(extractor.readLines(PNG_BYTES, 'image/png'));

    expect(failure.kind).toBe('invalid-response');
    expect(failure.httpStatus).toBe(200);
  });

  it('T-AI-033f · rejects a 200 with no image dimensions', async () => {
    const { extractor } = makeExtractor({ fallback: NO_METADATA });
    const failure = await failureOf(extractor.readLines(PNG_BYTES, 'image/png'));

    expect(failure.kind).toBe('invalid-response');
  });

  it('T-AI-033g · does not retry an unusable 200', async () => {
    const { extractor, calls } = makeExtractor({ fallback: NO_READ_RESULT });
    await failureOf(extractor.readLines(PNG_BYTES, 'image/png'));

    expect(calls).toHaveLength(1);
  });
});

describe('T-AI-033 — retries', () => {
  it('T-AI-033h · retries a 429 twice at 1 s then 4 s, then reports unavailable', async () => {
    const { extractor, calls, slept } = makeExtractor({
      script: [RATE_LIMITED, RATE_LIMITED, RATE_LIMITED],
    });
    const failure = await failureOf(extractor.readLines(PNG_BYTES, 'image/png'));

    expect(calls).toHaveLength(3);
    expect(slept).toEqual([...VISION_RETRY_BACKOFF_MS]);
    expect(failure.kind).toBe('unavailable');
    expect(failure.httpStatus).toBe(429);
  });

  it('T-AI-033i · succeeds on the second attempt when the first is transient', async () => {
    const { extractor, calls } = makeExtractor({ script: [SERVER_ERROR] });
    const lines = await extractor.readLines(PNG_BYTES, 'image/png');

    expect(calls).toHaveLength(2);
    expect(lines).toHaveLength(3);
  });

  it('T-AI-033j · retries a transport failure', async () => {
    const { extractor, calls } = makeExtractor({ script: ['network-error'] });
    const lines = await extractor.readLines(PNG_BYTES, 'image/png');

    expect(calls).toHaveLength(2);
    expect(lines).toHaveLength(3);
  });

  it('T-AI-033k · never retries a 400 — the answer cannot change and it costs a transaction', async () => {
    const { extractor, calls, slept } = makeExtractor({ script: [BAD_REQUEST] });
    const failure = await failureOf(extractor.readLines(PNG_BYTES, 'image/png'));

    expect(calls).toHaveLength(1);
    expect(slept).toEqual([]);
    expect(failure.httpStatus).toBe(400);
  });

  it('T-AI-033l · reports a timeout as a timeout, and does not retry it', async () => {
    const { extractor, calls } = makeExtractor({ script: ['hang'] });
    const failure = await failureOf(extractor.readLines(PNG_BYTES, 'image/png'));

    expect(failure.kind).toBe('timeout');
    expect(calls).toHaveLength(1);
  });
});

describe('T-AI-033 — the extract() surface, in the ADR-0001 Rev 1 revert mode', () => {
  it('T-AI-033m · emits OCR-only items that claim no identification and no corroboration', async () => {
    const { extractor } = makeExtractor();
    const result = await extractor.extract(PNG_BYTES, 'image/png');

    expect(result.items).toHaveLength(3);
    for (const item of result.items) {
      expect(item.provider).toBe('ocr-only');
      expect(item.basis).toBe('text');
      // OCR reads glyphs; it identifies nothing. A non-null value here would
      // be an invented title, which is worse than none.
      expect(item.inferredTitle).toBeNull();
      expect(item.ocrSupport).toBe('not-checked');
      expect(item.boxSource).toBe('ocr');
    }
  });

  it('T-AI-033n · always reports crossCheck: llm-unavailable, so removals stay withheld', async () => {
    // ⚠ Not a bug to fix. In this mode the primary reader is deliberately not
    // called, so the extraction genuinely was never corroborated. Reporting
    // 'ok' would let a strictly-lower-quality read propose mass removals.
    const { extractor } = makeExtractor();
    const result = await extractor.extract(PNG_BYTES, 'image/png');

    expect(result.crossCheck).toBe('llm-unavailable');
  });

  it('T-AI-033o · carries counts in providerMeta and nothing read from the image', async () => {
    const { extractor } = makeExtractor();
    const result = await extractor.extract(PNG_BYTES, 'image/png');

    expect(result.providerMeta).toEqual({ extractor: 'azure-vision-read', lineCount: 3 });
    const serialised = JSON.stringify(result.providerMeta);
    expect(serialised).not.toContain('Stranger');
  });
});

describe('T-AI-033 — logging carries no image content', () => {
  it('T-AI-033p · logs counts, statuses and ids only', async () => {
    const events: unknown[] = [];
    server?.close();
    server = visionMswServer({});
    server.listen({ onUnhandledRequest: 'error' });

    const extractor = new AzureVisionExtractor({
      endpoint: VISION_ENDPOINT,
      credential: fakeVisionCredential(),
      sleep: () => Promise.resolve(),
      newCorrelationId: () => 'fixed-correlation-id',
      log: (event) => events.push(event),
    });
    await extractor.readLines(PNG_BYTES, 'image/png');

    const serialised = JSON.stringify(events);
    expect(serialised).toContain('"lineCount":3');
    for (const leaked of ['Stranger', 'Things', 'Continue', 'Last of Us']) {
      expect(serialised).not.toContain(leaked);
    }
  });
});

describe('the endpoint and the factory', () => {
  it('T-AI-033q · refuses to run without NEXTUP_VISION_ENDPOINT', () => {
    // Defaulting would make "the reader silently did not run" look exactly
    // like "the reader saw nothing" — which a full-update batch reads as
    // removals.
    expect(() => readVisionEndpoint({})).toThrow(/NEXTUP_VISION_ENDPOINT/);
    expect(() => readVisionEndpoint({ NEXTUP_VISION_ENDPOINT: '  ' })).toThrow();
    expect(readVisionEndpoint({ NEXTUP_VISION_ENDPOINT: ' https://x ' })).toBe('https://x');
  });

  it('T-AI-033r · is what NEXTUP_EXTRACTOR=azure-vision-read selects', () => {
    const extractor = createExtractor({
      NEXTUP_EXTRACTOR: 'azure-vision-read',
      vision: { endpoint: VISION_ENDPOINT, credential: fakeVisionCredential() },
    });

    expect(extractor).toBeInstanceOf(AzureVisionExtractor);
    expect(extractor.name).toBe('azure-vision-read');
  });

  it('T-AI-033s · refuses to build one without a credential rather than falling back', () => {
    expect(() => createExtractor({ NEXTUP_EXTRACTOR: 'azure-vision-read' })).toThrow(
      /managed identity/,
    );
  });
});
