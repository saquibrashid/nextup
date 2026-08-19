/**
 * `T-STUB-001` — TASK-055.
 *
 * The property under test is DETERMINISM: the same batch, extracted three
 * times, produces byte-identical `ExtractionResult` documents. Everything
 * downstream — the golden suite, the review pass, every full-update
 * reconciliation — is only reproducible if this is.
 *
 * The fault-injection cases are here too, because each token drives a distinct
 * downstream safety path and a token that silently stopped working would leave
 * that path untested while the suite stayed green.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  type CrossCheckFn,
  type ExtractedTextItem,
  type LlmTile,
  type OcrLine,
  compareExtractedItems,
  isExtractorError,
  llmOnlyItems,
  ocrOnlyItems,
} from '@nextup/domain';

import {
  createExtractor,
  DEFAULT_EXTRACTOR,
  ExtractorNotAvailableError,
  readExtractorName,
} from '../../../src/extraction/factory.js';
import {
  goldenRecordingStore,
  inMemoryRecordingStore,
  sha256OfBytes,
} from '../../../src/extraction/recordings.js';
import { faultTokenIn, StubExtractor } from '../../../src/extraction/stubExtractor.js';

// ── The recordings under test ───────────────────────────────────────────────

const TILES: LlmTile[] = [
  {
    visibleText: 'Dune',
    identifiedTitle: 'Dune',
    basis: 'both',
    confidence: 0.97,
    box: { x: 0.1, y: 0.2, w: 0.2, h: 0.3 },
  },
  {
    visibleText: null,
    identifiedTitle: null,
    basis: 'unknown',
    confidence: 0.1,
    box: { x: 0.4, y: 0.2, w: 0.2, h: 0.3 },
  },
];

const LINES: OcrLine[] = [
  { text: 'Dune', box: { x: 0.11, y: 0.21, w: 0.18, h: 0.05 }, confidence: 0.99 },
  { text: 'Heat', box: { x: 0.7, y: 0.6, w: 0.18, h: 0.05 }, confidence: 0.92 },
];

/**
 * A stand-in for the real merge (TASK-056c). `T-STUB-001` asserts the stub is
 * deterministic and wires its legs correctly; it is `T-AI-034` that asserts the
 * merge itself is pure. Using a trivial, obviously-deterministic function here
 * keeps those two properties from being tested through one another.
 */
const mergeSpy: { calls: Array<{ llm: LlmTile[]; ocr: OcrLine[] }> } = { calls: [] };
const fakeCrossCheck: CrossCheckFn = (llm, ocr) => {
  mergeSpy.calls.push({ llm: [...llm], ocr: [...ocr] });
  return llm.map((tile): ExtractedTextItem => ({
    rawText: tile.visibleText ?? '',
    inferredTitle: tile.identifiedTitle,
    basis: tile.basis,
    ocrSupport: 'exact',
    provider: 'llm',
    boundingBox: { ...tile.box },
    boxSource: 'ocr',
    confidence: tile.confidence,
  }));
};

const KNOWN_IMAGE = Buffer.from('a-screenshot-of-a-saved-list');
const UNKNOWN_IMAGE = Buffer.from('a-screenshot-nobody-recorded');

function makeExtractor(): StubExtractor {
  return new StubExtractor({
    recordings: inMemoryRecordingStore({
      [sha256OfBytes(KNOWN_IMAGE)]: { llm: TILES, ocr: LINES },
    }),
    crossCheck: fakeCrossCheck,
  });
}

/** A fault fixture: the token travels INSIDE the bytes — see stubExtractor.ts. */
const faultImage = (token: string): Buffer => Buffer.from(`\x89PNG\r\n${token}\r\npayload`);

describe('T-STUB-001 the stub extractor is deterministic and injects faults', () => {
  it('T-STUB-001 · three runs over the same batch produce identical results', async () => {
    const batch = [KNOWN_IMAGE, UNKNOWN_IMAGE];

    const run = async (): Promise<string> => {
      const extractor = makeExtractor();
      const results = [];
      for (const image of batch) {
        results.push(await extractor.extract(image, 'image/png'));
      }
      return JSON.stringify(results);
    };

    const [first, second, third] = [await run(), await run(), await run()];
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('T-STUB-001a · a recorded image replays both legs through the real merge', async () => {
    mergeSpy.calls = [];
    const result = await makeExtractor().extract(KNOWN_IMAGE, 'image/png');

    expect(mergeSpy.calls).toHaveLength(1);
    expect(mergeSpy.calls[0]?.llm).toEqual(TILES);
    expect(mergeSpy.calls[0]?.ocr).toEqual(LINES);
    expect(result.crossCheck).toBe('ok');
    expect(result.items).toHaveLength(TILES.length);
    expect(result.providerMeta['recorded']).toBe(true);
  });

  it('T-STUB-001b · an unrecorded image is the ZERO-YIELD path, not a crash', async () => {
    // A forgotten fixture must surface as the low-yield banner the product
    // already handles (specs/ai.md §8), never as an exception inside a job.
    const result = await makeExtractor().extract(UNKNOWN_IMAGE, 'image/png');

    expect(result.items).toEqual([]);
    expect(result.crossCheck).toBe('ok');
    expect(result.providerMeta['recorded']).toBe(false);
  });

  it('T-STUB-001c · __llm_down__ degrades to OCR-only rather than failing', async () => {
    const image = faultImage('__llm_down__');
    const extractor = new StubExtractor({
      recordings: inMemoryRecordingStore({
        [sha256OfBytes(image)]: { llm: TILES, ocr: LINES },
      }),
      crossCheck: fakeCrossCheck,
    });

    const result = await extractor.extract(image, 'image/png');

    // specs/ai.md §2.2a: degraded is a COMPLETED batch at a lower quality, and
    // `crossCheck !== 'ok'` is what later forces computeRemovals: false.
    expect(result.crossCheck).toBe('llm-unavailable');
    expect(result.items.map((i) => i.rawText)).toEqual(['Dune', 'Heat']);
    expect(result.items.every((i) => i.provider === 'ocr-only')).toBe(true);
    // OCR identifies nothing; it reports glyphs. An inferred title here would
    // be an identification the product never made.
    expect(result.items.every((i) => i.inferredTitle === null)).toBe(true);
  });

  it('T-STUB-001d · __ocr_down__ proceeds on the primary reader, uncorroborated', async () => {
    const image = faultImage('__ocr_down__');
    const extractor = new StubExtractor({
      recordings: inMemoryRecordingStore({
        [sha256OfBytes(image)]: { llm: TILES, ocr: LINES },
      }),
      crossCheck: fakeCrossCheck,
    });

    const result = await extractor.extract(image, 'image/png');

    expect(result.crossCheck).toBe('ocr-unavailable');
    expect(result.items).toHaveLength(TILES.length);
    // 'not-checked', NOT 'none': "we could not look" is not "we looked and
    // found nothing".
    expect(result.items.every((i) => i.ocrSupport === 'not-checked')).toBe(true);
    expect(result.items.every((i) => i.boxSource === 'llm')).toBe(true);
  });

  it('T-STUB-001e · __truncated__ is an ERROR, never a short result', async () => {
    // A truncated tile list reads, in full-update mode, as a wave of removals.
    const error = await makeExtractor()
      .extract(faultImage('__truncated__'), 'image/png')
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(isExtractorError(error)).toBe(true);
    expect(isExtractorError(error) && error.kind).toBe('truncated');
  });

  it('T-STUB-001f · __fail_error__, __fail_429__ and __slow__ each throw their kind', async () => {
    const extractor = makeExtractor();
    const kinds: Array<[string, string, number | null]> = [
      ['__fail_error__', 'invalid-response', null],
      ['__fail_429__', 'unavailable', 429],
      ['__slow__', 'timeout', null],
    ];

    for (const [token, kind, status] of kinds) {
      const error = await extractor.extract(faultImage(token), 'image/png').then(
        () => null,
        (e: unknown) => e,
      );
      expect(isExtractorError(error), `${token} should throw an ExtractorError`).toBe(true);
      expect(isExtractorError(error) && error.kind).toBe(kind);
      expect(isExtractorError(error) && error.httpStatus).toBe(status);
    }
  });

  it('T-STUB-001g · a clean image carries no fault token', () => {
    expect(faultTokenIn(KNOWN_IMAGE)).toBeNull();
    expect(faultTokenIn(faultImage('__slow__'))).toBe('__slow__');
  });
});

describe('T-STUB-001h the factory selects one extractor and never silently downgrades', () => {
  it('T-STUB-001h · NEXTUP_EXTRACTOR defaults to hybrid and rejects unknown values', () => {
    // NFR-012a: the default is a quality decision. A typo must not quietly
    // select a cheaper, worse reader.
    expect(DEFAULT_EXTRACTOR).toBe('hybrid');
    expect(readExtractorName({})).toBe('hybrid');
    expect(readExtractorName({ NEXTUP_EXTRACTOR: '' })).toBe('hybrid');
    expect(readExtractorName({ NEXTUP_EXTRACTOR: 'stub' })).toBe('stub');
    expect(() => readExtractorName({ NEXTUP_EXTRACTOR: 'hybird' })).toThrow(
      /not a known extractor/,
    );
  });

  it('T-STUB-001i · the factory builds the stub and names the task for the rest', () => {
    const stub = createExtractor({
      NEXTUP_EXTRACTOR: 'stub',
      recordings: inMemoryRecordingStore({}),
      crossCheck: fakeCrossCheck,
    });
    expect(stub.name).toBe('stub');

    expect(() => createExtractor({ NEXTUP_EXTRACTOR: 'stub' })).toThrow(/RecordingStore/);
    expect(() =>
      createExtractor({ NEXTUP_EXTRACTOR: 'stub', recordings: inMemoryRecordingStore({}) }),
    ).toThrow(/crossCheck/);

    // `hybrid` (TASK-056c) is now BUILT too. Like the two single-leg readers
    // it reports a MISCONFIGURATION rather than "not available", and it names
    // each missing leg separately — "hybrid" with one leg is not a hybrid, and
    // must never silently become the other reader while still reporting
    // `crossCheck: 'ok'`.
    expect(() => createExtractor({ NEXTUP_EXTRACTOR: 'hybrid' })).toThrow(
      /requires an Azure OpenAI endpoint/,
    );
    expect(() => createExtractor({ NEXTUP_EXTRACTOR: 'hybrid' })).not.toThrow(
      ExtractorNotAvailableError,
    );

    // `azure-vision-read` (TASK-056) and `llm-vision` (TASK-056b) are BUILT, so
    // they no longer report "not available" — they report a misconfiguration,
    // which is a different fault with a different fix. Both must still refuse
    // rather than fall back: a silent downgrade to the stub would return zero
    // titles from a real batch, and in full-update mode zero titles reads as
    // "remove everything".
    expect(() => createExtractor({ NEXTUP_EXTRACTOR: 'llm-vision' })).toThrow(
      /requires an Azure OpenAI endpoint/,
    );
    expect(() => createExtractor({ NEXTUP_EXTRACTOR: 'llm-vision' })).not.toThrow(
      ExtractorNotAvailableError,
    );

    expect(() => createExtractor({ NEXTUP_EXTRACTOR: 'azure-vision-read' })).toThrow(
      /requires a Vision endpoint and credential/,
    );
    expect(() => createExtractor({ NEXTUP_EXTRACTOR: 'azure-vision-read' })).not.toThrow(
      ExtractorNotAvailableError,
    );
  });
});

/**
 * The golden store's degradation rule (`recordings.ts`): EVERY read failure —
 * absent directory, absent manifest, absent or unparseable fixture — becomes
 * "no recording", which the stub reports as the zero-yield path.
 *
 * This is tested rather than assumed because the alternative failure mode is
 * the expensive one: an exception thrown from inside extraction surfaces as an
 * opaque batch failure, while a missing fixture is supposed to surface as the
 * low-yield banner the product already handles (`specs/ai.md` §8).
 */
describe('T-STUB-001j the golden recording store degrades instead of throwing', () => {
  const goldenDir = join(tmpdir(), `nextup-golden-${randomUUID()}`);
  const sha = sha256OfBytes(KNOWN_IMAGE);

  afterEach(() => {
    rmSync(goldenDir, { recursive: true, force: true });
  });

  function write(relative: string, contents: string): void {
    const target = join(goldenDir, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf8');
  }

  it('T-STUB-001j · an absent directory or manifest is zero-yield, not a crash', () => {
    expect(goldenRecordingStore(join(goldenDir, 'does-not-exist')).get(sha)).toBeUndefined();

    mkdirSync(goldenDir, { recursive: true });
    expect(goldenRecordingStore(goldenDir).get(sha)).toBeUndefined();
  });

  it('T-STUB-001k · an unparseable manifest is zero-yield, not a crash', () => {
    write('manifest.json', '{ not json');
    expect(goldenRecordingStore(goldenDir).get(sha)).toBeUndefined();
  });

  it('T-STUB-001l · a manifested image with missing fixture files reads as empty legs', () => {
    // Not `undefined`: the manifest DID pair this image, so the pairing is
    // intact and the recording is simply empty. Collapsing the two would hide
    // a half-committed fixture.
    write('manifest.json', JSON.stringify({ [sha]: 'dune' }));
    expect(goldenRecordingStore(goldenDir).get(sha)).toEqual({ llm: [], ocr: [] });
  });

  it('T-STUB-001m · a committed recording is read, and read once', () => {
    write('manifest.json', JSON.stringify({ [sha]: 'dune' }));
    write('llm/dune.llm.json', JSON.stringify(TILES));
    write('ocr/dune.ocr.json', JSON.stringify(LINES));

    const store = goldenRecordingStore(goldenDir);
    expect(store.get(sha)).toEqual({ llm: TILES, ocr: LINES });

    // The second read is cached, so deleting the fixtures cannot change it —
    // that is what makes a batch's replay stable mid-run.
    rmSync(join(goldenDir, 'llm'), { recursive: true, force: true });
    expect(store.get(sha)).toEqual({ llm: TILES, ocr: LINES });

    // An unmanifested image stays unmanifested, and that answer is cached too.
    expect(store.get(sha256OfBytes(faultImage('__slow__')))).toBeUndefined();
    expect(store.get(sha256OfBytes(faultImage('__slow__')))).toBeUndefined();
  });

  it('T-STUB-001n · the in-memory store accepts a Map and a plain object alike', () => {
    const recording = { llm: TILES, ocr: LINES };
    expect(inMemoryRecordingStore({ [sha]: recording }).get(sha)).toBe(recording);
    expect(inMemoryRecordingStore(new Map([[sha, recording]])).get(sha)).toBe(recording);
    expect(inMemoryRecordingStore({}).get(sha)).toBeUndefined();
  });
});

/**
 * The comparator is the reason two runs agree. It is asserted directly, and
 * not only through a sorted result, because a sort with an INCONSISTENT
 * comparator still returns an array — it just returns a different one
 * depending on the engine's sort implementation and the input order, which is
 * exactly the class of bug `T-STUB-001` exists to catch.
 */
describe('T-STUB-001o the ordering is total, tie-free and locale-independent', () => {
  function at(x: number, y: number, rawText: string): ExtractedTextItem {
    return {
      rawText,
      inferredTitle: null,
      basis: 'text',
      ocrSupport: 'exact',
      provider: 'ocr-only',
      boundingBox: { x, y, w: 0.1, h: 0.1 },
      boxSource: 'ocr',
      confidence: 1,
    };
  }

  it('T-STUB-001o · row band wins, then x, then text — and equal items compare 0', () => {
    // y is quantised to 1/40, so a sub-band wobble must NOT reorder a row:
    // both y values below land in band 8, leaving x to decide.
    expect(compareExtractedItems(at(0.9, 0.2, 'a'), at(0.1, 0.201, 'b'))).toBeGreaterThan(0);

    expect(compareExtractedItems(at(0.1, 0.1, 'a'), at(0.9, 0.9, 'b'))).toBeLessThan(0);
    expect(compareExtractedItems(at(0.9, 0.9, 'a'), at(0.1, 0.1, 'b'))).toBeGreaterThan(0);

    // Same band, different x.
    expect(compareExtractedItems(at(0.1, 0.2, 'z'), at(0.5, 0.2, 'a'))).toBeLessThan(0);
    expect(compareExtractedItems(at(0.5, 0.2, 'a'), at(0.1, 0.2, 'z'))).toBeGreaterThan(0);

    // Same band, same x: plain lexicographic, both directions and the tie.
    expect(compareExtractedItems(at(0.1, 0.2, 'a'), at(0.1, 0.2, 'b'))).toBe(-1);
    expect(compareExtractedItems(at(0.1, 0.2, 'b'), at(0.1, 0.2, 'a'))).toBe(1);
    expect(compareExtractedItems(at(0.1, 0.2, 'a'), at(0.1, 0.2, 'a'))).toBe(0);
  });

  it('T-STUB-001p · ordering does not depend on the host locale', () => {
    // `localeCompare` would order these by the host's ICU data. A plain
    // comparison is machine-independent, which is what reproducibility means.
    const items = [at(0.1, 0.1, 'Zebra'), at(0.1, 0.1, 'apple'), at(0.1, 0.1, 'Apple')];
    expect([...items].sort(compareExtractedItems).map((i) => i.rawText)).toEqual([
      'Apple',
      'Zebra',
      'apple',
    ]);
  });

  it('T-STUB-001q · a null visibleText becomes empty text, never the string "null"', () => {
    const box = { x: 0.1, y: 0.2, w: 0.2, h: 0.3 };
    const items = llmOnlyItems([
      { visibleText: null, identifiedTitle: 'Dune', basis: 'art', confidence: 0.5, box },
    ]);
    expect(items[0]?.rawText).toBe('');
    expect(items[0]?.ocrSupport).toBe('not-checked');
  });

  it('T-STUB-001r · OCR-only items identify nothing', () => {
    const box = { x: 0.1, y: 0.2, w: 0.2, h: 0.3 };
    const items = ocrOnlyItems([{ text: 'Dune', confidence: 0.9, box }]);
    expect(items[0]).toMatchObject({
      rawText: 'Dune',
      inferredTitle: null,
      ocrSupport: 'exact',
      provider: 'ocr-only',
      boxSource: 'ocr',
    });
  });
});
