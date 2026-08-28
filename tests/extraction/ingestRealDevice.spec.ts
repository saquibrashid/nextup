/**
 * TASK-151 — the REAL-DEVICE half. Fixtures that came off the owner's phone.
 *
 * This file was `ingestFixturesBlocked.spec.ts` and was red on purpose: nothing
 * in this repository can produce HEIC bytes, because `T-DEP-002` forbids a HEIC
 * ENCODER anywhere in the dependency tree. The owner has now supplied the file,
 * so the assertions run for real against a genuine 4032x3024 Apple photograph
 * carrying a genuine 15-tag GPS sub-IFD.
 *
 * ⚠ NOTE WHICH PATH THESE DRIVE. WebKit strips EXIF on
 * `navigator.clipboard.read()` but NOT on file upload. A GPS assertion exercised
 * through the PASTE path passes VACUOUSLY — the browser already removed the data
 * — while GPS flows in untouched through the upload route. `ingestSource:
 * 'upload'` below is load-bearing, not incidental
 * (`.github/copilot-instructions.md` invariant 18).
 *
 * ⚠ AND NOTE HOW PRESENCE AND ABSENCE ARE DECIDED. Structurally, via
 * `exifProbe.ts`, never by searching the bytes for a tag number: the two bytes of
 * tag 0x8825 occur 33 times little-endian and 38 times big-endian by pure
 * coincidence inside this one fixture's compressed data. See that module's
 * header — an earlier revision of this file made exactly that mistake.
 *
 * ⚠ THESE TESTS LIVE IN `tests/extraction/` BECAUSE THAT IS WHERE VITEST LOOKS.
 * `tests/fixtures` is collected by no runner (it is data), so a `.spec.ts` placed
 * beside the fixtures would never execute and would report green forever
 * (`T-CI-008`, and the canary incident recorded in the copilot instructions).
 */

import { describe, expect, it } from 'vitest';

import { ingestFiles, type IngestStages } from '../../apps/api/src/images/ingest.js';
import { stripAllMetadata, transcodeHeicToPng } from '../../apps/api/src/images/transcode.js';
import type { ImageBlobStore } from '../../apps/api/src/storage/blobStore.js';
import {
  EXIF_TAG,
  GPS_TAG,
  hasGpsCoordinates,
  isPngMetadataChunk,
  jpegSegmentMarkers,
  pngChunkTypes,
  readExif,
} from '../fixtures/golden/ingest/exifProbe.js';
import { INGEST_FIXTURES, loadIngestFixture } from '../fixtures/golden/ingest/index.js';

const AT = new Date(Date.UTC(2026, 7, 18, 14, 32, 13));

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
 * ⚠ NOTHING IS DOUBLED HERE. The transcode is the real `transcodeHeicToPng` with
 * its real `heic-convert` decoder, and the strip is the real `stripAllMetadata`.
 * A double anywhere on this path would return the assertion to proving that our
 * test agrees with our test.
 */
const realStages: IngestStages = {
  transcode: (bytes, from) => transcodeHeicToPng(bytes, from),
  stripMetadata: (bytes, format) => Promise.resolve(stripAllMetadata(bytes, format)),
};

async function upload(
  fixture: 'heicWithGps' | 'iosScreenshotJpeg',
  stages: IngestStages,
): Promise<{ uploadedFormat: string | undefined; format: string | undefined; stored: Uint8Array }> {
  const store = makeStore();
  const outcome = await ingestFiles(
    [{ clientFileName: INGEST_FIXTURES[fixture].file, bytes: loadIngestFixture(fixture) }],
    {
      ownerId: 'owner-fixture',
      batchId: '01JXXXXXXXXXXXXXXXXXXXXXXX',
      // ⚠ UPLOAD, NOT PASTE. See the file header.
      ingestSource: 'upload',
      firstSeqInBatch: 1,
      receivedAt: AT,
      store,
      stages,
      correlationId: 'corr-ingest-real-device',
      logSink: () => {},
    },
  );
  expect(outcome.rejected).toEqual([]);
  expect(outcome.accepted).toHaveLength(1);
  const stored = [...store.written.values()][0];
  expect(stored).toBeDefined();
  return {
    uploadedFormat: outcome.accepted[0]?.uploadedFormat,
    format: outcome.accepted[0]?.format,
    stored: stored as Uint8Array,
  };
}

describe('T-SEC-033 · the UPLOAD path strips EXIF/GPS from a real iPhone HEIC', () => {
  it('T-SEC-033e: the owner-supplied HEIC really does carry a GPS sub-IFD and a device model', () => {
    // NON-VACUITY, and the first thing that must be true. Every "absent"
    // assertion below is worthless unless the fixture demonstrably carried
    // location data and a device identity to begin with.
    const bytes = loadIngestFixture('heicWithGps');

    const exif = readExif(bytes);
    expect(exif).not.toBeNull();
    // REQ-078 names the device model as well as location.
    expect(exif?.ifd0Tags).toContain(EXIF_TAG.MAKE);
    expect(exif?.ifd0Tags).toContain(EXIF_TAG.MODEL);
    expect(exif?.ifd0Tags).toContain(EXIF_TAG.GPS_IFD_POINTER);
    // The pointer must RESOLVE — a dangling 0x8825 would be no evidence at all.
    expect(exif?.gpsTags).toContain(GPS_TAG.LATITUDE);
    expect(exif?.gpsTags).toContain(GPS_TAG.LONGITUDE);
    expect(hasGpsCoordinates(bytes)).toBe(true);
  });

  it('T-SEC-033f: driven through the FILE-UPLOAD path it lands in the blob store with no metadata at all', async () => {
    const result = await upload('heicWithGps', realStages);

    expect(result.uploadedFormat).toBe('heic');
    expect(result.format).toBe('png');

    // Exact, not probabilistic: the stored PNG's entire chunk table.
    const chunks = pngChunkTypes(result.stored);
    expect(chunks.filter(isPngMetadataChunk)).toEqual([]);
    expect(chunks).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(readExif(result.stored)).toBeNull();
    expect(hasGpsCoordinates(result.stored)).toBe(false);
  });

  it('T-SEC-033g: on the HEIC path that cleanliness comes from the TRANSCODE, not from the strip', async () => {
    // ⚠ THIS TEST EXISTS TO RECORD A VACUITY HONESTLY, AND IT IS THE REASON
    // T-SEC-033f MUST NOT BE READ AS DISCHARGING REQ-078 ON ITS OWN.
    //
    // `transcodeHeicToPng` decodes to a raw raster and re-encodes. Metadata
    // cannot survive that, so the stored blob is clean whether or not
    // `stripAllMetadata` ever runs — T-SEC-033f would keep passing if the strip
    // were deleted from the codebase outright. `specs/testing.md` §29.2 says as
    // much: the transcode's incidental metadata loss is NOT what discharges
    // REQ-078.
    //
    // So: run the same real fixture with the strip replaced by an IDENTITY
    // function. The blob is still clean. That is the proof of the vacuity, and
    // it is why the strip's own evidence has to come from the PNG and JPEG
    // paths — where the bytes pass through un-re-encoded and the strip is the
    // only thing standing between EXIF and the blob store (T-SEC-032m below).
    const withoutStrip: IngestStages = {
      transcode: (bytes, from) => transcodeHeicToPng(bytes, from),
      stripMetadata: (bytes) => Promise.resolve(bytes),
    };

    const result = await upload('heicWithGps', withoutStrip);

    expect(pngChunkTypes(result.stored)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(hasGpsCoordinates(result.stored)).toBe(false);
  });
});

describe('T-SEC-032 · a real iOS screenshot carries EXIF but no location', () => {
  it('T-SEC-032l: the owner-supplied iOS screenshot is a JPEG with an EXIF block, no GPS and no device model', () => {
    // ⚠ THE FORMAT IS THE FINDING. ASM-058 and invariant 11 both reason from
    // "iOS SCREENSHOTS are normally PNG"; on the owner's device they are JPEG.
    // The conclusion (accept all three, sniff by magic bytes) is unaffected —
    // this is precisely why the sniff must not trust a filename or a declared
    // type.
    const bytes = loadIngestFixture('iosScreenshotJpeg');

    const markers = jpegSegmentMarkers(bytes);
    // APP1 present: the screenshot route is NOT metadata-free, so the strip
    // matters here too...
    expect(markers).toContain(0xe1);

    const exif = readExif(bytes);
    expect(exif).not.toBeNull();
    expect(exif?.exifTags).not.toBeNull();
    // ...but location arrives only by the camera-roll HEIC route, which is the
    // assumption T-SEC-033 is built on. Assert it against a real device file.
    expect(exif?.ifd0Tags).not.toContain(EXIF_TAG.GPS_IFD_POINTER);
    expect(exif?.ifd0Tags).not.toContain(EXIF_TAG.MODEL);
    expect(exif?.gpsTags).toBeNull();
    expect(hasGpsCoordinates(bytes)).toBe(false);
  });

  it('T-SEC-032m: uploaded, the real screenshot lands with its EXIF removed and its pixels intact', async () => {
    // Unlike the HEIC path there is no re-encode here: the JPEG is stored as a
    // JPEG. The strip is therefore the ONLY thing removing the APP1 block, so
    // this assertion is not vacuous — contrast T-SEC-033g.
    const result = await upload('iosScreenshotJpeg', realStages);

    expect(result.uploadedFormat).toBe('jpeg');
    expect(result.format).toBe('jpeg');

    const markers = jpegSegmentMarkers(result.stored);
    expect(markers).not.toContain(0xe1);
    expect(readExif(result.stored)).toBeNull();
    // Still a decodable JPEG: a start-of-scan is present and the entropy-coded
    // data was not thrown away with the metadata.
    expect(markers).toContain(0xda);
    expect(result.stored.length).toBeGreaterThan(1024);
  });
});
