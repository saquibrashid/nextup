/**
 * TASK-050 — the ingest pipeline (`apps/api/src/images/ingest.ts`).
 *
 * `T-IMG-002` (partial acceptance), `T-IMG-010` (per-file rejection reasons),
 * `T-IMG-012` (`uploadedFormat` distinct from stored `format`), `T-IMG-023`
 * and `T-PASTE-006`/`T-PASTE-007` (`ingestSource` is provenance, never a
 * control input).
 *
 * The properties here are the ones that fail SILENTLY:
 *
 *  - A pasted image taking a shortcut past the sniff, a ceiling or the guard
 *    looks identical in every happy-path test, because a real paste is a
 *    well-formed PNG.
 *  - `ingestSource` selecting the transcode branch is EQUIVALENT TODAY and
 *    wrong in principle — it makes a security decision from untrusted client
 *    input. Only a deliberately mismatched case can tell the two apart.
 *  - Serial processing is invisible unless it is asserted directly: two 24 MP
 *    images each pass a 25 MP guard and together exhaust the container.
 */

import { describe, expect, it, vi } from 'vitest';

import { ingestFiles, type IncomingFile, type IngestStages } from '../../src/images/ingest.js';
import type { ImageBlobStore } from '../../src/storage/blobStore.js';

const AT = new Date(Date.UTC(2026, 7, 11, 15, 42, 33, 0));

function pngBytes(width: number, height: number, pad = 0): Uint8Array {
  const bytes = new Uint8Array(33 + pad);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function heicBytes(width: number, height: number): Uint8Array {
  // `ftyp` with a HEIF major brand, then a single `ispe`.
  const head = new Uint8Array(24);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, 24);
  head.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'
  head.set([0x68, 0x65, 0x69, 0x63], 8); // 'heic'
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

function makeStore(): ImageBlobStore & { written: Map<string, Uint8Array> } {
  const written = new Map<string, Uint8Array>();
  return {
    written,
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

function makeStages(): IngestStages & {
  transcode: ReturnType<typeof vi.fn>;
  stripMetadata: ReturnType<typeof vi.fn>;
} {
  return {
    // The transcode returns DIFFERENT bytes on purpose: a stage that echoed
    // its input would let "transcoded" and "passed through" look identical.
    transcode: vi.fn(() => Promise.resolve({ bytes: pngBytes(1179, 2556) })),
    stripMetadata: vi.fn((bytes: Uint8Array) => Promise.resolve(bytes)),
  } as never;
}

function context(overrides: Partial<Parameters<typeof ingestFiles>[1]> = {}) {
  return {
    ownerId: 'owner-1',
    batchId: 'batch-1',
    ingestSource: 'upload' as const,
    firstSeqInBatch: 1,
    receivedAt: AT,
    store: makeStore(),
    stages: makeStages(),
    ...overrides,
  };
}

const file = (bytes: Uint8Array, clientFileName?: string): IncomingFile => ({
  clientFileName,
  bytes,
});

describe('T-IMG-002 partial acceptance', () => {
  it('T-IMG-002a: a valid file alongside an invalid one is still accepted', async () => {
    const ctx = context();
    const outcome = await ingestFiles(
      [
        file(pngBytes(1179, 2556), 'good.png'),
        file(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'notes.pdf'),
      ],
      ctx,
    );
    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.accepted[0]?.fileName).toBe('good.png');
    expect(outcome.rejected[0]).toMatchObject({
      fileName: 'notes.pdf',
      code: 'UNSUPPORTED_IMAGE_FORMAT',
    });
  });

  it('T-IMG-002b: one file failing the guard never removes an already-accepted file', async () => {
    // REQ-080/081: the blast radius is exactly one image. The accepted file
    // comes FIRST so that a naive "abort on failure" implementation would have
    // to actively un-accept it to fail this.
    const ctx = context();
    const outcome = await ingestFiles(
      [file(pngBytes(1179, 2556), 'ok.png'), file(pngBytes(8064, 5952), 'huge.png')],
      ctx,
    );
    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.accepted[0]?.fileName).toBe('ok.png');
    expect(outcome.rejected[0]?.code).toBe('IMAGE_TOO_LARGE_TO_DECODE');
    // And the accepted one really did land.
    expect((ctx.store as ReturnType<typeof makeStore>).written.size).toBe(1);
  });

  it('T-IMG-002c: the failed file is the ONLY one missing from storage', async () => {
    const ctx = context();
    const outcome = await ingestFiles(
      [
        file(pngBytes(600, 400), 'a.png'),
        file(new Uint8Array([1, 2, 3, 4]), 'b.bin'),
        file(pngBytes(700, 500), 'c.png'),
      ],
      ctx,
    );
    expect(outcome.accepted.map((a) => a.fileName)).toEqual(['a.png', 'c.png']);
    expect((ctx.store as ReturnType<typeof makeStore>).written.size).toBe(2);
  });
});

describe('T-IMG-010 per-file rejection reasons', () => {
  it('T-IMG-010a: each rejection names the file and carries its own code', async () => {
    const outcome = await ingestFiles(
      [
        file(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'notes.pdf'),
        file(pngBytes(8064, 5952), 'huge.png'),
        file(pngBytes(10, 10), 'tiny.png'),
      ],
      context(),
    );
    expect(outcome.rejected.map((r) => [r.fileName, r.code])).toEqual([
      ['notes.pdf', 'UNSUPPORTED_IMAGE_FORMAT'],
      ['huge.png', 'IMAGE_TOO_LARGE_TO_DECODE'],
      ['tiny.png', 'IMAGE_DIMENSIONS_UNSUPPORTED'],
    ]);
  });

  it('T-IMG-010b: the memory refusal names memory and the runbook in MEGApixels', async () => {
    const outcome = await ingestFiles([file(pngBytes(8064, 5952), 'huge.png')], context());
    const message = outcome.rejected[0]?.message ?? '';
    expect(message).toContain('memory');
    expect(message).toContain('docs/runbooks/scale-up-memory.md');
    // The unit trap: raw pixels would render "47996928.0 MP".
    expect(message).toContain('48.0 MP');
    expect(message).toContain('25.0 MP');
  });

  it('T-IMG-010c: the unsupported-format refusal mentions NEITHER memory nor the runbook', async () => {
    // More memory never fixes a file that is not an image; saying so would
    // send the owner to buy capacity they do not need.
    const outcome = await ingestFiles(
      [file(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'notes.pdf')],
      context(),
    );
    const message = outcome.rejected[0]?.message ?? '';
    expect(message.toLowerCase()).not.toContain('memory');
    expect(message).not.toContain('scale-up-memory');
  });

  it('T-IMG-010d: an oversized file is rejected per-file, not by failing the request', async () => {
    const outcome = await ingestFiles(
      [file(pngBytes(1179, 2556, 11 * 1024 * 1024), 'big.png'), file(pngBytes(600, 400), 'ok.png')],
      context(),
    );
    expect(outcome.rejected[0]).toMatchObject({ fileName: 'big.png', code: 'IMAGE_TOO_LARGE' });
    expect(outcome.accepted).toHaveLength(1);
  });
});

describe('T-IMG-012 uploadedFormat is distinct from the stored format', () => {
  it('T-IMG-012a: a PNG stores as png and reports uploadedFormat png', async () => {
    const outcome = await ingestFiles([file(pngBytes(1179, 2556), 'a.png')], context());
    expect(outcome.accepted[0]).toMatchObject({ format: 'png', uploadedFormat: 'png' });
  });

  it('T-IMG-012b: a HEIC stores as png while uploadedFormat stays heic', async () => {
    const outcome = await ingestFiles([file(heicBytes(1179, 2556), 'IMG.HEIC')], context());
    expect(outcome.accepted[0]).toMatchObject({ format: 'png', uploadedFormat: 'heic' });
  });

  it('T-IMG-012e: uploadedByteSize is what the DEVICE sent, byteSize what is STORED', async () => {
    // The two diverge across a transcode most dramatically — the owner's own
    // phone
    // expands ~8.5x (1.76 MiB HEIC -> 17.8 MiB PNG). Reading the post-transcode
    // buffer for BOTH looks correct in every PNG test and silently restores the
    // unit mix that made the batch ceiling fire at ~7 MiB of a 60 MiB budget.
    const incoming = heicBytes(1179, 2556);
    const stored = pngBytes(1179, 2556, 4096);
    expect(stored.byteLength).toBeGreaterThan(incoming.byteLength);
    const ctx = context({
      stages: {
        transcode: vi.fn(() => Promise.resolve({ bytes: stored })),
        stripMetadata: vi.fn((bytes: Uint8Array) => Promise.resolve(bytes)),
      } as never,
    });

    const outcome = await ingestFiles([file(incoming, 'IMG.HEIC')], ctx);

    expect(outcome.accepted[0]?.uploadedByteSize).toBe(incoming.byteLength);
    expect(outcome.accepted[0]?.byteSize).toBe(stored.byteLength);
  });

  it('T-IMG-012f: the STRIP moves the two apart as well, not only the transcode', async () => {
    // The metadata strip (REQ-078) rewrites the file for every image from
    // every source, so a plain PNG that never transcodes still stores smaller
    // than it arrived. An integration test that asserted these two were equal
    // for PNG failed on exactly this — 106 uploaded, 102 stored.
    const incoming = pngBytes(600, 400, 64);
    const ctx = context({
      stages: {
        transcode: vi.fn(() => Promise.resolve({ bytes: pngBytes(600, 400) })),
        stripMetadata: vi.fn(() => Promise.resolve(pngBytes(600, 400))),
      } as never,
    });

    const outcome = await ingestFiles([file(incoming, 'shot.png')], ctx);

    expect(ctx.stages.transcode).not.toHaveBeenCalled();
    expect(outcome.accepted[0]?.uploadedByteSize).toBe(incoming.byteLength);
    expect(outcome.accepted[0]?.byteSize).toBeLessThan(incoming.byteLength);
  });

  it('T-IMG-012c: the declared name is NOT what decides the format', async () => {
    // PNG bytes under a .heic name. Trusting the name would transcode it.
    const ctx = context();
    const outcome = await ingestFiles([file(pngBytes(600, 400), 'lying.heic')], ctx);
    expect(outcome.accepted[0]).toMatchObject({ uploadedFormat: 'png', format: 'png' });
    expect(ctx.stages.transcode).not.toHaveBeenCalled();
  });
});

describe('T-IMG-023 / T-PASTE-006 / T-PASTE-007 ingestSource is provenance, never control', () => {
  it('T-PASTE-006a: a paste whose bytes are a PDF is refused exactly like an upload', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const asPaste = await ingestFiles([file(pdf, 'image.png')], context({ ingestSource: 'paste' }));
    const asUpload = await ingestFiles([file(pdf, 'notes.pdf')], context());
    expect(asPaste.rejected[0]?.code).toBe('UNSUPPORTED_IMAGE_FORMAT');
    expect(asUpload.rejected[0]?.code).toBe('UNSUPPORTED_IMAGE_FORMAT');
    expect(asPaste.accepted).toHaveLength(0);
  });

  it('T-PASTE-007a: every ceiling and the guard apply identically to a pasted image', async () => {
    for (const source of ['paste', 'upload', 'drop'] as const) {
      const outcome = await ingestFiles(
        [file(pngBytes(8064, 5952), 'huge.png'), file(pngBytes(10, 10), 'tiny.png')],
        context({ ingestSource: source }),
      );
      expect(outcome.rejected.map((r) => r.code)).toEqual([
        'IMAGE_TOO_LARGE_TO_DECODE',
        'IMAGE_DIMENSIONS_UNSUPPORTED',
      ]);
    }
  });

  it('T-IMG-023a: the TRANSCODE is chosen by the sniffed format, NEVER by ingestSource', async () => {
    // The discriminating pair. `if (ingestSource === "paste") skipTranscode()`
    // is equivalent today — a real paste is a PNG — so only a HEIC arriving BY
    // PASTE, and a PNG arriving by upload, can tell the two rules apart.
    const pastedHeic = context({ ingestSource: 'paste' });
    await ingestFiles([file(heicBytes(1179, 2556), 'image.png')], pastedHeic);
    expect(pastedHeic.stages.transcode).toHaveBeenCalledTimes(1);

    const uploadedPng = context({ ingestSource: 'upload' });
    await ingestFiles([file(pngBytes(1179, 2556), 'a.png')], uploadedPng);
    expect(uploadedPng.stages.transcode).not.toHaveBeenCalled();
  });

  it('T-IMG-023b: the metadata strip runs for EVERY image, outside the transcode condition', async () => {
    // ⚠ WebKit strips EXIF on clipboard read but NOT on file upload, so the
    // strip must not sit inside any source- or format-conditional branch.
    for (const source of ['paste', 'upload', 'drop'] as const) {
      const ctx = context({ ingestSource: source });
      await ingestFiles(
        [file(pngBytes(600, 400), 'a.png'), file(heicBytes(600, 400), 'b.heic')],
        ctx,
      );
      expect(ctx.stages.stripMetadata).toHaveBeenCalledTimes(2);
    }
  });

  it('T-IMG-023c: ingestSource is recorded verbatim on every accepted image', async () => {
    for (const source of ['paste', 'upload', 'drop'] as const) {
      const outcome = await ingestFiles(
        [file(pngBytes(600, 400), 'a.png')],
        context({ ingestSource: source }),
      );
      expect(outcome.accepted[0]?.ingestSource).toBe(source);
    }
  });
});

describe('T-IMG-006 naming and paths', () => {
  it('T-IMG-006a: a pasted file is renamed server-side; the client name is ignored', async () => {
    const outcome = await ingestFiles(
      [file(pngBytes(600, 400), 'image.png'), file(pngBytes(600, 400), 'image.png')],
      context({ ingestSource: 'paste' }),
    );
    expect(outcome.accepted.map((a) => a.fileName)).toEqual([
      'pasted-20260811-154233-01.png',
      'pasted-20260811-154233-02.png',
    ]);
  });

  it('T-IMG-006b: ordinals continue from what the batch already holds', async () => {
    const outcome = await ingestFiles(
      [file(pngBytes(600, 400), 'image.png')],
      context({ ingestSource: 'paste', firstSeqInBatch: 3 }),
    );
    expect(outcome.accepted[0]?.fileName).toBe('pasted-20260811-154233-03.png');
  });

  it('T-IMG-006c: an ordinal is consumed by a REJECTED file too', async () => {
    // Reusing it would give two files in one request the same synthesised
    // name, which is the collision the whole scheme exists to prevent.
    const outcome = await ingestFiles(
      [file(new Uint8Array([1, 2, 3, 4])), file(pngBytes(600, 400))],
      context({ ingestSource: 'paste' }),
    );
    expect(outcome.rejected[0]?.fileName).toBe('pasted-20260811-154233-01.png');
    expect(outcome.accepted[0]?.fileName).toBe('pasted-20260811-154233-02.png');
  });

  it('T-IMG-006d: blobPath is composed from ULIDs and contains no part of any client name', async () => {
    const outcome = await ingestFiles(
      [file(pngBytes(600, 400), '../../etc/passwd.png')],
      context(),
    );
    const image = outcome.accepted[0];
    expect(image?.blobPath).toBe(`owner-1/batch-1/${String(image?.imageId)}.png`);
    expect(image?.blobPath).not.toContain('passwd');
    expect(image?.blobPath).not.toContain('..');
    // And the device name IS kept for display — which is exactly why the path
    // must be built from ids instead.
    expect(image?.fileName).toBe('../../etc/passwd.png');
  });
});

describe('T-IMG-018 serial processing and isolation', () => {
  it('T-IMG-018a: files are processed SERIALLY, never concurrently', async () => {
    // ⚠ Concurrency multiplies peak memory by the number of in-flight decodes,
    // and the guard is sized for one. `Promise.all` passes every other test in
    // this file; only overlap detection catches it.
    let inFlight = 0;
    let maxInFlight = 0;
    const stages: IngestStages = {
      transcode: () => Promise.resolve({ bytes: pngBytes(600, 400) }),
      async stripMetadata(bytes) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return bytes;
      },
    };
    await ingestFiles(
      [pngBytes(600, 400), pngBytes(700, 500), pngBytes(800, 600)].map((b) => file(b, 'a.png')),
      context({ stages }),
    );
    expect(maxInFlight).toBe(1);
  });

  it('T-IMG-018b: retainUntil is 30 days from receipt, identical for a pasted image', async () => {
    for (const source of ['paste', 'upload', 'drop'] as const) {
      const outcome = await ingestFiles(
        [file(pngBytes(600, 400), 'a.png')],
        context({ ingestSource: source }),
      );
      expect(outcome.accepted[0]?.retainUntil.toISOString()).toBe('2026-09-10T15:42:33.000Z');
    }
  });
});
