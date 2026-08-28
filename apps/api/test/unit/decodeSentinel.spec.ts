/**
 * `T-IMG-021` — the decode sentinel (TASK-157, `A43-M5`, `specs/api.md` §9.1).
 *
 * ⚠ WHAT THIS PROTECTS IS A DECISION, NOT A FEATURE. The owner chose to run at
 * 0.25 vCPU / 0.5 GiB and up-size REACTIVELY (`A43` / `OQ-028`: "Start at
 * 0.5 GiB, up-size only if it OOMs"). That trigger only exists if an OOM can
 * be OBSERVED. Azure Container Apps publishes no OOM-distinct metric at all —
 * verified read-only against the deployed staging app and written up as
 * `specs/testing.md` §31.6 — so these two log lines are the ONLY signal that
 * names WHICH image died. Delete them and the owner does not learn their app
 * ran out of memory; they experience a flaky app.
 *
 * ⚠ THE ABSENCE OF `end` IS THE SIGNAL, WHICH MAKES THIS SUITE UNUSUALLY
 * PRONE TO PASSING VACUOUSLY. "No `end` was logged" is also true of a pipeline
 * that logs nothing at all, so every negative case here is paired with a
 * positive one that proves the instrument works.
 *
 * ⚠ THE TWO FAILURE PATHS ARE DIFFERENT AND BOTH ARE COVERED.
 *   P1 — a WASM allocation failure inside `libheif-js` raises a CATCHABLE
 *        `RangeError`; one image fails, the container keeps running, and the
 *        `finally` DOES run. This is the likelier case, and a design resting
 *        on replica restarts misses it entirely.
 *   P2 — the kernel kills the process; nothing is raised, no `finally` runs,
 *        and the `end` line is simply never written. P2 cannot be simulated
 *        in-process (that is the whole point of it), so what is asserted here
 *        is the property that MAKES P2 legible: `end` comes from a `finally`
 *        and `begin` is written before any allocation.
 *
 * ⚠ NOT TELEMETRY (`NFR-005`, `T-SEC-009`). No SDK, no third party, no product
 * instrumentation, no user content. `specs/testing.md` §AC-6 records the
 * apparent collision and why both requirements pass together — so that nobody
 * "resolves" it by deleting the sentinel.
 */

import { IMAGE_DECODE_BEGIN, IMAGE_DECODE_END } from '@nextup/domain';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/errors/AppError.js';
import { ingestFiles, type IncomingFile, type IngestStages } from '../../src/images/ingest.js';
import type { ImageBlobStore } from '../../src/storage/blobStore.js';

const AT = new Date(Date.UTC(2026, 7, 11, 15, 42, 33, 0));

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

function makeStore(): ImageBlobStore {
  const written = new Map<string, Uint8Array>();
  return {
    put(path, bytes) {
      written.set(path, bytes);
      return Promise.resolve();
    },
    get(path) {
      return Promise.resolve(written.get(path) ?? null);
    },
    remove(path) {
      written.delete(path);
      return Promise.resolve();
    },
  };
}

function makeStages(overrides: Partial<IngestStages> = {}): IngestStages {
  return {
    transcode: vi.fn(() => Promise.resolve({ bytes: pngBytes(1179, 2556) })),
    stripMetadata: vi.fn((bytes: Uint8Array) => Promise.resolve(bytes)),
    ...overrides,
  } as never;
}

const file = (bytes: Uint8Array, clientFileName?: string): IncomingFile => ({
  clientFileName,
  bytes,
});

interface Captured {
  readonly lines: Record<string, unknown>[];
  readonly context: Parameters<typeof ingestFiles>[1];
}

function capturing(overrides: Partial<Parameters<typeof ingestFiles>[1]> = {}): Captured {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    context: {
      ownerId: 'owner-1',
      batchId: '01JBATCHBATCHBATCHBATCHBAT',
      ingestSource: 'upload' as const,
      firstSeqInBatch: 1,
      receivedAt: AT,
      store: makeStore(),
      stages: makeStages(),
      correlationId: 'corr-decode-sentinel',
      // ⚠ THE SINK IS PARSED BACK FROM JSON, NOT INSPECTED AS AN OBJECT.
      // §9.1 fixes ONE JSON OBJECT PER LINE on stdout, because Container Apps
      // ships stdout line-by-line into `ContainerAppConsoleLogs` and the alert
      // query parses `Log_s`. Asserting against a live object would pass for a
      // sink that emitted something unparseable.
      logSink: (line: string) => {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
      ...overrides,
    },
  };
}

const sentinels = (lines: Record<string, unknown>[]): Record<string, unknown>[] =>
  lines.filter(
    (line) => line['event'] === IMAGE_DECODE_BEGIN || line['event'] === IMAGE_DECODE_END,
  );

describe('T-IMG-021 the decode sentinel (A43-M5, api.md §9.1)', () => {
  it('T-IMG-021a: a successful decode emits begin then end, paired by imageId', async () => {
    const captured = capturing();
    const outcome = await ingestFiles([file(pngBytes(800, 600), 'shelf.png')], captured.context);

    expect(outcome.accepted).toHaveLength(1);
    const [begin, end] = sentinels(captured.lines);
    // ORDER MATTERS AND IS NOT INCIDENTAL. An `end` written before the decode
    // would satisfy a naive pairing assertion while making the P2 signal —
    // "a `begin` with no `end`" — impossible to ever observe.
    expect(begin?.['event']).toBe(IMAGE_DECODE_BEGIN);
    expect(end?.['event']).toBe(IMAGE_DECODE_END);
    expect(begin?.['imageId']).toBe(end?.['imageId']);
    // The id is also the one the owner sees, so an incident can be traced from
    // the log to the row without a second lookup table.
    expect(begin?.['imageId']).toBe(outcome.accepted[0]?.imageId);
  });

  it('T-IMG-021b: the begin line carries every §9.1 field, correctly typed', async () => {
    const captured = capturing({ env: { NEXTUP_MAX_DECODE_PIXELS: '25000000' } });
    await ingestFiles([file(pngBytes(4000, 3000), 'shelf.png')], captured.context);

    const [begin] = sentinels(captured.lines);
    expect(begin).toEqual({
      event: 'image.decode.begin',
      ts: expect.any(String) as unknown,
      level: 'info',
      correlationId: 'corr-decode-sentinel',
      batchId: '01JBATCHBATCHBATCHBATCHBAT',
      imageId: expect.any(String) as unknown,
      fileName: 'shelf.png',
      ingestSource: 'upload',
      uploadedFormat: 'png',
      width: 4000,
      height: 3000,
      megapixels: 12,
      declaredBytes: 33,
      maxDecodePixels: 25_000_000,
    });
    // ⚠ THE TIMESTAMP IS THE EMISSION INSTANT, NOT `receivedAt`. Reusing the
    // request's receipt time would give every image in a batch the same `ts`,
    // and the abandoned-decode query orders `begin` against `end` by time.
    expect(begin?.['ts']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(String(begin?.['ts']))).toBeGreaterThanOrEqual(AT.getTime());
  });

  it('T-IMG-021c: the end line carries every §9.1 field, correctly typed', async () => {
    const captured = capturing({
      monotonicNow: vi.fn().mockReturnValueOnce(1000).mockReturnValue(1042),
      rss: () => 123_456_789,
    });
    await ingestFiles([file(pngBytes(800, 600), 'shelf.png')], captured.context);

    const [begin, end] = sentinels(captured.lines);
    expect(end).toEqual({
      event: 'image.decode.end',
      ts: expect.any(String) as unknown,
      level: 'info',
      correlationId: 'corr-decode-sentinel',
      batchId: '01JBATCHBATCHBATCHBATCHBAT',
      imageId: begin?.['imageId'],
      outcome: 'ok',
      durationMs: 42,
      peakRssBytes: 123_456_789,
    });
    // `errorName` is ABSENT on success, not `null`. `JSON.stringify` drops
    // `undefined` members, and a `null` here would read in a log search as
    // "an error whose class we failed to record".
    expect(Object.keys(end ?? {})).not.toContain('errorName');
  });

  it('T-IMG-021d: ingestSource is carried verbatim from every route (A45, T-PASTE-007)', async () => {
    for (const source of ['paste', 'upload', 'drop'] as const) {
      const captured = capturing({ ingestSource: source });
      await ingestFiles([file(pngBytes(800, 600), 'shelf.png')], captured.context);
      const [begin] = sentinels(captured.lines);
      // Provenance in a log line, not analytics: it is how a decode failure is
      // read against the route that produced it. It must NEVER select a branch
      // in the pipeline — that property is `T-IMG-023`'s.
      expect(begin?.['ingestSource']).toBe(source);
    }
  });

  it('T-IMG-021e: the CATCHABLE OOM still emits end, with outcome oom (path P1)', async () => {
    const captured = capturing({
      stages: makeStages({
        transcode: vi.fn(() =>
          Promise.reject(
            new AppError('IMAGE_DECODE_OOM', 503, 'ran out of memory', {
              remedy: 'docs/runbooks/scale-up-memory.md',
            }),
          ),
        ),
      }),
    });

    const outcome = await ingestFiles(
      [file(heicBytes(4000, 3000), 'photo.heic')],
      captured.context,
    );
    expect(outcome.rejected[0]?.code).toBe('IMAGE_DECODE_OOM');

    const [begin, end] = sentinels(captured.lines);
    expect(begin?.['event']).toBe(IMAGE_DECODE_BEGIN);
    // ⚠ THIS IS THE LIKELIER OF THE TWO OOM PATHS AND IT LEAVES NO OTHER
    // TRACE: the container does not restart, so `RestartCount` never moves.
    // Reporting it as a plain `failed` would make it indistinguishable from a
    // corrupt file, and more memory fixes one and can never fix the other.
    expect(end?.['outcome']).toBe('oom');
    expect(end?.['level']).toBe('error');
    expect(end?.['errorName']).toBe('AppError');
    expect(end?.['imageId']).toBe(begin?.['imageId']);
  });

  it('T-IMG-021f: an ordinary decode failure emits end with outcome failed', async () => {
    const captured = capturing({
      stages: makeStages({
        transcode: vi.fn(() =>
          Promise.reject(new AppError('IMAGE_DECODE_FAILED', 415, "couldn't be read", {})),
        ),
      }),
    });

    await ingestFiles([file(heicBytes(4000, 3000), 'photo.heic')], captured.context);
    const [, end] = sentinels(captured.lines);
    expect(end?.['outcome']).toBe('failed');
    expect(end?.['level']).toBe('error');
  });

  it('T-IMG-021g: a guard rejection emits NO begin at all (§9.1 rule 3)', async () => {
    // ⚠ PAIRED WITH A POSITIVE CASE ON PURPOSE. "No `begin` was logged" is
    // equally true of a pipeline that logs nothing, so the same run must show
    // a `begin` for the image that PASSED. Without the second file this case
    // would pass against a deleted sentinel.
    const captured = capturing({ env: { NEXTUP_MAX_DECODE_PIXELS: '1000000' } });
    const outcome = await ingestFiles(
      [file(pngBytes(6000, 5000), 'huge.png'), file(pngBytes(800, 600), 'fine.png')],
      captured.context,
    );

    expect(outcome.rejected[0]?.code).toBe('IMAGE_TOO_LARGE_TO_DECODE');
    const begins = sentinels(captured.lines).filter((line) => line['event'] === IMAGE_DECODE_BEGIN);
    expect(begins).toHaveLength(1);
    expect(begins[0]?.['fileName']).toBe('fine.png');
    // There was no decode, so there is nothing to go unanswered — a `begin`
    // here would be a permanent false positive for the abandoned-decode alert.
    expect(sentinels(captured.lines)).toHaveLength(2);
  });

  it('T-IMG-021h: neither line carries image bytes or owner identity (§9.1 rule 5)', async () => {
    const captured = capturing({ ownerId: 'o_deadbeefdeadbeef' });
    await ingestFiles([file(pngBytes(800, 600), 'shelf.png')], captured.context);

    for (const line of sentinels(captured.lines)) {
      const serialised = JSON.stringify(line);
      // The owner id belongs on the request line, reachable via
      // `correlationId`. Repeating it here would put an identifier on every
      // image event for no debugging gain.
      expect(serialised).not.toContain('o_deadbeefdeadbeef');
      expect(serialised).not.toContain('ownerId');
      expect(serialised).not.toContain('ownerIdHash');
      expect(line['bytes']).toBeUndefined();
      expect(line['data']).toBeUndefined();
    }
  });

  it('T-IMG-021i: maxDecodePixels reports the value IN FORCE, not the default', async () => {
    // ⚠ THE UP-SIZED CASE IS EXACTLY WHEN THIS LINE IS READ. A log that always
    // printed 25 000 000 would misdescribe the incident in the one situation
    // the runbook exists for — after compute has been raised to 1.0 GiB and
    // the guard moved with it (REQ-079 keeps the pair together).
    const captured = capturing({ env: { NEXTUP_MAX_DECODE_PIXELS: '50000000' } });
    await ingestFiles([file(pngBytes(800, 600), 'shelf.png')], captured.context);

    const [begin] = sentinels(captured.lines);
    expect(begin?.['maxDecodePixels']).toBe(50_000_000);
  });

  it('T-IMG-021j: the event names are the domain constants, not local strings', async () => {
    // The alert query in `infra/alerts.bicep` matches these literals; the
    // infra half of the pairing is `T-INFRA-012g`. Two independently spelled
    // copies would let the app and the alert drift apart in silence.
    expect(IMAGE_DECODE_BEGIN).toBe('image.decode.begin');
    expect(IMAGE_DECODE_END).toBe('image.decode.end');

    const captured = capturing();
    await ingestFiles([file(pngBytes(800, 600), 'shelf.png')], captured.context);
    expect(sentinels(captured.lines).map((line) => line['event'])).toEqual([
      IMAGE_DECODE_BEGIN,
      IMAGE_DECODE_END,
    ]);
  });

  it('T-IMG-021k: one image failing does not suppress the next image\u2019s sentinel', async () => {
    // REQ-080/081 and `A43-M2`. If a contained failure short-circuited the
    // loop, the batch would still return 201 with the surviving images — and
    // the ONE image that mattered would have no `end` line for a reason that
    // has nothing to do with memory, permanently poisoning the alert.
    let call = 0;
    const captured = capturing({
      stages: makeStages({
        transcode: vi.fn(() => {
          call += 1;
          return call === 1
            ? Promise.reject(new AppError('IMAGE_DECODE_OOM', 503, 'oom', {}))
            : Promise.resolve({ bytes: pngBytes(1179, 2556) });
        }),
      }),
    });

    await ingestFiles(
      [file(heicBytes(4000, 3000), 'a.heic'), file(heicBytes(1179, 2556), 'b.heic')],
      captured.context,
    );

    const lines = sentinels(captured.lines);
    expect(lines).toHaveLength(4);
    expect(lines.map((line) => line['event'])).toEqual([
      IMAGE_DECODE_BEGIN,
      IMAGE_DECODE_END,
      IMAGE_DECODE_BEGIN,
      IMAGE_DECODE_END,
    ]);
    expect(lines[1]?.['outcome']).toBe('oom');
    expect(lines[3]?.['outcome']).toBe('ok');
    // Distinct ids, or the alert would pair the failed image's `begin` with
    // the healthy image's `end` and see nothing wrong.
    expect(lines[0]?.['imageId']).not.toBe(lines[2]?.['imageId']);
  });
});
