/**
 * TASK-151 — the BLOCKED half. `T-SEC-033`, the leg that needs a real HEIC.
 *
 * ⚠ THESE TESTS ARE RED ON PURPOSE, AND THE RED IS THE DELIVERABLE.
 *
 * `specs/security.md` §4.2 and `specs/testing.md` §30.2 both record that
 * `T-SEC-033`'s spec-mandated leg — a REAL HEIC upload carrying GPS, landing
 * stripped — is not asserted anywhere in this repository. It cannot be, from
 * inside the repository: `T-DEP-002` forbids a HEIC ENCODER anywhere in the
 * dependency tree, so nothing here can produce HEIC bytes. The fixture has to
 * come from the owner's phone.
 *
 * The two wrong ways to make this file green are both worse than the red:
 *
 *   - FABRICATE the fixture. A hand-built HEIC with hand-written EXIF proves
 *     that this repository's writer and this repository's reader agree. It
 *     proves nothing about what an actual iPhone produces, which is the entire
 *     point of REQ-078. Nor may a GPS-bearing JPEG stand in: HEIC is precisely
 *     the format that carries location in through the camera-roll path.
 *   - SKIP the tests. A skipped test is indistinguishable from a passing one
 *     in a green run, and this is a privacy control.
 *
 * ⚠ AND NOTE WHICH PATH THESE DRIVE. WebKit strips EXIF on
 * `navigator.clipboard.read()` but NOT on file upload. A GPS assertion
 * exercised through the PASTE path passes VACUOUSLY — the browser already
 * removed the data — while GPS flows in untouched through the upload route.
 * `ingestSource: 'upload'` below is load-bearing, not incidental
 * (`.github/copilot-instructions.md` invariant 18).
 */

import { describe, expect, it } from 'vitest';

import { ingestFiles, type IngestStages } from '../../apps/api/src/images/ingest.js';
import { stripAllMetadata, transcodeHeicToPng } from '../../apps/api/src/images/transcode.js';
import type { ImageBlobStore } from '../../apps/api/src/storage/blobStore.js';
import { INGEST_FIXTURES, loadIngestFixture } from '../fixtures/golden/ingest/index.js';

const AT = new Date(Date.UTC(2026, 7, 18, 14, 32, 13));

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

function makeStore(): ImageBlobStore & { written: Map<string, Uint8Array> } {
  const written = new Map<string, Uint8Array>();
  return {
    written,
    put(blobPath, bytes) {
      written.set(blobPath, bytes);
      return Promise.resolve();
    },
    get(blobPath) {
      return Promise.resolve(written.get(blobPath) ?? null);
    },
    remove(blobPath) {
      written.delete(blobPath);
      return Promise.resolve();
    },
  };
}

/**
 * ⚠ NOTHING IS DOUBLED HERE. The transcode is the real `transcodeHeicToPng`
 * with its real `heic-convert` decoder, and the strip is the real
 * `stripAllMetadata`. A double anywhere on this path would return the
 * assertion to proving that our test agrees with our test.
 */
const realStages: IngestStages = {
  transcode: (bytes, from) => transcodeHeicToPng(bytes, from),
  stripMetadata: (bytes, format) => Promise.resolve(stripAllMetadata(bytes, format)),
};

describe('T-SEC-033 · the UPLOAD path strips EXIF/GPS from a real HEIC (BLOCKED — owner fixture outstanding)', () => {
  it('T-SEC-033e: the owner-supplied HEIC is present and really does carry GPS EXIF', () => {
    // NON-VACUITY, and the first thing that must be true. Every "absent"
    // assertion in `T-SEC-033f` is worthless unless the fixture demonstrably
    // carried location data to begin with.
    expect(INGEST_FIXTURES.heicWithGps.ownerSupplied).toBeDefined();

    const bytes = loadIngestFixture('heicWithGps');
    const raw = text(bytes);
    expect(raw).toContain('ftyp');
    expect(raw).toContain('Exif');
    // The GPSInfoIFDPointer tag (0x8825) in either TIFF byte order.
    expect(raw.includes('\x25\x88') || raw.includes('\x88\x25')).toBe(true);
  });

  it('T-SEC-033f: driven through the FILE-UPLOAD path it lands in the blob store with no GPS', async () => {
    const store = makeStore();

    const outcome = await ingestFiles(
      [
        {
          clientFileName: INGEST_FIXTURES.heicWithGps.file,
          bytes: loadIngestFixture('heicWithGps'),
        },
      ],
      {
        ownerId: 'owner-fixture',
        batchId: '01JXXXXXXXXXXXXXXXXXXXXXXX',
        // ⚠ UPLOAD, NOT PASTE. See the file header: the paste path's free
        // stripping makes a pasted assertion vacuous.
        ingestSource: 'upload',
        firstSeqInBatch: 1,
        receivedAt: AT,
        store,
        stages: realStages,
      },
    );

    expect(outcome.rejected).toEqual([]);
    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.accepted[0]?.uploadedFormat).toBe('heic');
    expect(outcome.accepted[0]?.format).toBe('png');

    const stored = [...store.written.values()][0];
    expect(stored).toBeDefined();
    const out = text(stored as Uint8Array);
    expect(out).not.toContain('eXIf');
    expect(out).not.toContain('Exif\0\0');
    expect(out.includes('\x25\x88') || out.includes('\x88\x25')).toBe(false);
    // The device model must go too (REQ-078 names it explicitly).
    expect(out).not.toContain('Apple');
    expect(out).not.toContain('iPhone');
  });
});
