// `T-IMG-020` c-k - the diagnostic decode messages, TASK-155 / `A43-M3`.
//
// `T-IMG-020` a-b already live in `batchImagesRoute.spec.ts` and assert the two
// constraints that were load-bearing before the wording existed: a memory
// refusal names memory and cites the runbook, and the unsupported-format
// refusal names neither. This file asserts the REST of `api.md` §5.2.4 - the
// text that ADR-0008 R2.3 specifies rather than suggests.
//
// ⚠ ASSERTED ON `outcome.rejected[].message`, THE CARRIER, NOT ON THE BUILDER
// ALONE. A builder can be perfect and still never be reached: `assertDecodable`
// and `transcodeHeicToPng` are handed bytes, not a file name, so their own
// messages cannot name the file, and the whole point of TASK-155 is that the
// name reaches the owner. Two cases below therefore drive `ingestFiles` and
// read what an owner would actually be shown; the builder-level cases exist
// only for the values a route cannot vary.

import { describe, expect, it, vi } from 'vitest';

import {
  imageDecodeFailedMessage,
  imageDecodeOomMessage,
  imageTooLargeToDecodeMessage,
} from '../../src/images/decodeErrorMessages.js';
import { ingestFiles, type IngestStages } from '../../src/images/ingest.js';
import { AppError } from '../../src/errors/AppError.js';
import { MEMORY_RUNBOOK_PATH, UPSIZE_REMEDY } from '../../src/config.js';

/** A PNG that is nothing but a valid signature + IHDR — enough to be READ. */
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** `ftyp` (major brand `heic`) + a single `ispe` declaring the extent. */
function heicBytes(width: number, height: number): Uint8Array {
  const head = new Uint8Array(24);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, 24);
  head.set([0x66, 0x74, 0x79, 0x70], 4);
  head.set([0x68, 0x65, 0x69, 0x63], 8);
  hv.setUint32(12, 0);
  head.set([0x68, 0x65, 0x69, 0x63], 16);
  head.set([0x6d, 0x69, 0x66, 0x31], 20);

  const ispe = new Uint8Array(20);
  const iv = new DataView(ispe.buffer);
  iv.setUint32(0, 20);
  ispe.set([0x69, 0x73, 0x70, 0x65], 4);
  iv.setUint32(8, 0);
  iv.setUint32(12, width);
  iv.setUint32(16, height);

  const out = new Uint8Array(head.length + ispe.length);
  out.set(head, 0);
  out.set(ispe, head.length);
  return out;
}

const AT = new Date('2026-08-29T12:00:00.000Z');

function makeStore() {
  const written = new Map<string, Uint8Array>();
  return {
    written,
    put(path: string, bytes: Uint8Array) {
      written.set(path, bytes);
      return Promise.resolve();
    },
    get(path: string) {
      return Promise.resolve(written.get(path) ?? null);
    },
    remove(path: string) {
      written.delete(path);
      return Promise.resolve();
    },
  };
}

function context(stages: IngestStages, env?: NodeJS.ProcessEnv) {
  return {
    ownerId: 'owner_1',
    batchId: 'batch_1',
    ingestSource: 'upload' as const,
    firstSeqInBatch: 1,
    receivedAt: AT,
    store: makeStore(),
    stages,
    correlationId: 'corr-decode-messages',
    logSink: () => {},
    ...(env === undefined ? {} : { env }),
  };
}

const passThrough: IngestStages = {
  transcode: vi.fn((bytes: Uint8Array) => Promise.resolve({ bytes })),
  stripMetadata: vi.fn((bytes: Uint8Array) => Promise.resolve(bytes)),
};

async function guardRefusal(env?: NodeJS.ProcessEnv, width = 8064, height = 5952): Promise<string> {
  const outcome = await ingestFiles(
    [{ clientFileName: 'beach-list-03.png', bytes: pngBytes(width, height) }],
    context(passThrough, env),
  );
  expect(outcome.rejected[0]?.code).toBe('IMAGE_TOO_LARGE_TO_DECODE');
  return outcome.rejected[0]?.message ?? '';
}

/** 60.0 MP — over the up-sized 50 MP budget as well as the default one. */
const OVER_UPSIZED = [10_000, 6_000] as const;

async function transcodeRefusal(error: AppError): Promise<string> {
  const stages: IngestStages = {
    transcode: vi.fn(() => Promise.reject(error)),
    stripMetadata: vi.fn((bytes: Uint8Array) => Promise.resolve(bytes)),
  };
  const outcome = await ingestFiles(
    [{ clientFileName: 'beach-list-03.heic', bytes: heicBytes(1179, 2556) }],
    context(stages),
  );
  return outcome.rejected[0]?.message ?? '';
}

describe('T-IMG-020 the diagnostic decode messages are the specified text', () => {
  it('T-IMG-020c: the guard refusal names the file, its MP and its dimensions', async () => {
    const message = await guardRefusal();
    // ⚠ The FILE NAME is the reason this is composed in `ingest.ts` at all. A
    // batch may hold 40 images; "an image was too large" is not actionable.
    expect(message).toContain('beach-list-03.png');
    expect(message).toContain('48.0 MP');
    expect(message).toContain('8064 × 5952');
  });

  it('T-IMG-020d: the guard refusal states the LIVE container memory, not a hard-coded one', async () => {
    // ⚠ THE CASE WITH THE MOST TEETH IN THIS FILE. REQ-079 makes memory and
    // the pixel budget ONE setting; the message must therefore DERIVE the
    // memory figure from the live budget. A hard-coded "0.5 GiB" passes every
    // other assertion here and starts lying the instant the owner follows the
    // runbook - telling them to buy memory they already bought, which is the
    // `RSK-016` failure mode `A43-M3` exists to close.
    // ⚠ ASSERTED ON "in a X GiB container", NOT ON "X GiB". The remedy
    // sentence itself contains the literal "1.0 GiB" ("up-size compute to
    // 0.5 vCPU / 1.0 GiB"), so a bare `toContain('1.0 GiB')` passes against a
    // hard-coded message via the REMEDY text while the diagnosis stays wrong.
    // That weaker assertion was written first and a hard-coding mutant walked
    // straight through it.
    expect(await guardRefusal({ NEXTUP_MAX_DECODE_PIXELS: '25000000' })).toContain(
      'in a 0.5 GiB container',
    );
    expect(await guardRefusal({ NEXTUP_MAX_DECODE_PIXELS: '50000000' }, ...OVER_UPSIZED)).toContain(
      'in a 1.0 GiB container',
    );
  });

  it('T-IMG-020e: the guard refusal renders the limit as MEGApixels from the LIVE budget', async () => {
    // `specs/testing.md` §28.3(a): a field holding raw pixels renders
    // "50000000.0 MP", which compiles and satisfies every comparison.
    const upsized = await guardRefusal({ NEXTUP_MAX_DECODE_PIXELS: '50000000' }, ...OVER_UPSIZED);
    expect(upsized).toContain('50.0 MP');
    expect(upsized).toContain('60.0 MP');
    expect(upsized).not.toContain('50000000');
  });

  it('T-IMG-020f: the guard refusal carries the priced remedy and the reassurance', async () => {
    const message = await guardRefusal();
    expect(message).toContain(UPSIZE_REMEDY);
    expect(message).toContain('+~$4/month');
    expect(message).toContain('one command');
    expect(message).toContain(MEMORY_RUNBOOK_PATH);
    expect(message).toContain('No other image in this batch was affected');
    expect(message).toContain('re-attach this file after up-sizing');
    expect(message).toContain('not a problem with your image');
  });

  it('T-IMG-020g: the OOM refusal names the file, the container and the remedy', async () => {
    const message = await transcodeRefusal(
      new AppError('IMAGE_DECODE_OOM', 503, 'ran out of memory'),
    );
    // ⚠ The stage's own message ("ran out of memory") names no file. If this
    // assertion passes on the stage text instead of the composed text, the
    // re-composition in `ingest.ts` has been removed.
    expect(message).toContain('beach-list-03.heic');
    expect(message).toContain('0.5 GiB container');
    expect(message).toContain('not a corrupt file');
    expect(message).toContain(UPSIZE_REMEDY);
    expect(message).toContain(MEMORY_RUNBOOK_PATH);
    expect(message).toContain('nothing has been committed');
    expect(message).toContain('Re-attach this file after up-sizing');
  });

  it('T-IMG-020h: the corrupt-file refusal names the file and NEITHER memory NOR the up-size', async () => {
    const message = await transcodeRefusal(
      new AppError('IMAGE_DECODE_FAILED', 415, "That image couldn't be read.", {
        detail: 'truncated',
      }),
    );
    expect(message).toContain('beach-list-03.heic');
    expect(message).toContain('corrupt or incomplete');
    expect(message).toContain('the rest of the batch is intact');
    // ⚠ ASSERTED NEGATIVELY AND DELIBERATELY. More memory can never fix a
    // truncated file; offering the remedy sends the owner to spend money on
    // the wrong problem (`api.md` §5.2.3, product invariant 15).
    expect(message.toLowerCase()).not.toContain('memory');
    expect(message.toLowerCase()).not.toContain('up-size');
    expect(message).not.toContain(MEMORY_RUNBOOK_PATH);
    expect(message).not.toContain('$');
  });

  it('T-IMG-020i: the three builders share no memory sentence with the corrupt-file one', () => {
    // A structural guard against the three messages being refactored into one
    // template, which is the single edit that would leak the memory sentence
    // into the corrupt-file path.
    const corrupt = imageDecodeFailedMessage('x.heic');
    for (const memoryText of [
      imageDecodeOomMessage('x.heic'),
      imageTooLargeToDecodeMessage({
        fileName: 'x.heic',
        megapixels: 48,
        width: 8064,
        height: 5952,
        maxMegapixels: 25,
      }),
    ]) {
      expect(memoryText.toLowerCase()).toContain('memory');
      expect(memoryText).toContain(MEMORY_RUNBOOK_PATH);
      expect(corrupt).not.toBe(memoryText);
    }
    expect(corrupt.toLowerCase()).not.toContain('memory');
  });
});
