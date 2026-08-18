/**
 * Generator for the committed `golden/ingest/` fixture set (TASK-151).
 *
 * ⚠ THIS SCRIPT IS PROVENANCE, NOT A TEST DEPENDENCY. Every byte it emits is
 * COMMITTED to the repository and the tests read the committed files. Nothing
 * in the suite runs this script: a fixture generated at test time can drift
 * with the generator and still agree with it, which is exactly the class of
 * vacuous agreement `T-SEC-032e` exists to prevent.
 *
 * Run it only when a fixture must change:
 *
 *   node tests/fixtures/golden/ingest/generate.mjs
 *
 * It is deterministic — re-running it produces byte-identical files — so a
 * dirty tree afterwards means a fixture was edited by hand.
 *
 * ⚠ WHAT IT DELIBERATELY CANNOT PRODUCE: a real HEIC. `T-DEP-002` forbids a
 * HEIC ENCODER anywhere in the dependency tree (patent exposure and a GPL
 * licence floor), so nothing in this repository can encode HEVC. The `.heic`
 * fixtures below are therefore CONTAINER-ACCURATE HEADER STUBS: a real
 * ISO-BMFF `ftyp` + `meta/iprp/ipco/ispe` structure with no decodable image
 * item. That is enough to exercise the magic-byte sniff, the header dimension
 * read, the pre-decode pixel guard and the graceful decode failure — and it is
 * NOT enough to exercise a real decode or a real EXIF strip, which is why
 * `heic-with-gps.heic` is an owner-supplied file this script does not fake.
 * See `README.md` in this directory.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const out = (name, bytes) => {
  writeFileSync(path.join(HERE, name), bytes);
  console.log(`wrote ${name} (${String(bytes.length)} bytes)`);
};

const concat = (parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));
const ascii = (s) => Buffer.from(s, 'latin1');
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
};
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n & 0xffff, 0);
  return b;
};

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** A real PNG chunk: length, type, payload, CRC over type+payload. */
function pngChunk(type, payload) {
  const body = concat([ascii(type), payload]);
  return concat([u32(payload.length), body, u32(crc32(body))]);
}

/**
 * A genuinely decodable 8-bit RGB PNG of a solid colour.
 *
 * Solid on purpose: the raster is not what any assertion here is about, and a
 * flat colour deflates to a couple of kilobytes, which keeps a committed
 * fixture small (the brief's constraint).
 */
function pngImage(width, height, rgb, extraChunks = []) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0 (None)
    for (let x = 0; x < width; x += 1) {
      const at = rowStart + 1 + x * 3;
      raw[at] = rgb[0];
      raw[at + 1] = rgb[1];
      raw[at + 2] = rgb[2];
    }
  }
  const ihdr = concat([
    u32(width),
    u32(height),
    Buffer.from([8, 2, 0, 0, 0]), // 8-bit, truecolour, deflate, adaptive, no interlace
  ]);
  return concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    ...extraChunks,
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// A real little-endian TIFF/EXIF block carrying a GPS IFD
// ---------------------------------------------------------------------------

/**
 * ⚠ THIS IS THE NON-VACUITY PAYLOAD. Every "no GPS in the stored blob"
 * assertion in the suite is worthless unless the fixture demonstrably carried
 * GPS to begin with, so this is a structurally valid EXIF block — `II*\0`
 * header, an IFD0 with a `Make` string and a `GPSInfoIFDPointer`, and a GPS
 * IFD with real latitude/longitude rationals — not a string that merely reads
 * like one.
 *
 * ⚠ AND IT IS STILL NOT A SUBSTITUTE FOR A REAL PHONE PHOTO. It proves this
 * generator and the stripper agree about a hand-built block. It cannot prove
 * the stripper survives what an actual iPhone writes, and it is JPEG/PNG —
 * the two formats the camera-roll HEIC path does not use. See `README.md`.
 */
function exifWithGps() {
  const makeAt = 8 + 2 + 2 * 12 + 4; // after IFD0
  const make = ascii('Apple\0');
  const gpsIfdAt = makeAt + make.length;
  const gpsEntries = 4;
  const latAt = gpsIfdAt + 2 + gpsEntries * 12 + 4;
  const lonAt = latAt + 24;

  const entry = (tag, type, count, valueBytes) =>
    concat([u16le(tag), u16le(type), u32le(count), valueBytes]);

  const ifd0 = concat([
    u16le(2),
    entry(0x010f, 2, make.length, u32le(makeAt)), // Make → "Apple"
    entry(0x8825, 4, 1, u32le(gpsIfdAt)), // GPSInfoIFDPointer
    u32le(0), // no IFD1
  ]);

  const rational = (num, den) => concat([u32le(num), u32le(den)]);
  const dms = (d, m, s) => concat([rational(d, 1), rational(m, 1), rational(s, 1)]);

  const gpsIfd = concat([
    u16le(gpsEntries),
    entry(0x0001, 2, 2, Buffer.from([0x4e, 0x00, 0x00, 0x00])), // GPSLatitudeRef 'N'
    entry(0x0002, 5, 3, u32le(latAt)), // GPSLatitude
    entry(0x0003, 2, 2, Buffer.from([0x57, 0x00, 0x00, 0x00])), // GPSLongitudeRef 'W'
    entry(0x0004, 5, 3, u32le(lonAt)), // GPSLongitude
    u32le(0),
  ]);

  return concat([
    ascii('II'),
    u16le(42),
    u32le(8),
    ifd0,
    make,
    gpsIfd,
    dms(51, 30, 0), // 51°30'00" N
    dms(0, 7, 0), // 0°07'00" W
  ]);
}

function u16le(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff, 0);
  return b;
}
function u32le(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

/** `FF <marker> <u16 length incl. itself> <payload>`. */
function jpegSegment(marker, payload) {
  return concat([Buffer.from([0xff, marker]), u16(payload.length + 2), payload]);
}

/**
 * A structurally complete JPEG: SOI / APP0 / APP1(EXIF+GPS) / APP2(ICC) /
 * APP13(IPTC) / COM / SOF0 / SOS / EOI.
 *
 * ⚠ COMPLETE ON PURPOSE. `specs/testing.md` §30.3(a) records that the previous
 * integration fixture was a 29-byte stub that stopped mid-`SOF0`; the metadata
 * strip WALKS the file and correctly refused it as truncated, which surfaced
 * as a 415 on a test expecting 201. The fixture was wrong, not the refusal.
 */
function jpegImage(width, height, { withMetadata }) {
  const app0 = jpegSegment(
    0xe0,
    concat([ascii('JFIF\0'), Buffer.from([1, 1, 0]), u16(1), u16(1), Buffer.from([0, 0])]),
  );
  // APP2 ICC — KEPT by the stripper on purpose (it decides how the image
  // renders and identifies nobody). Its survival is an assertion, not an
  // oversight, so the fixture has to carry one.
  const app2 = jpegSegment(
    0xe2,
    concat([ascii('ICC_PROFILE\0'), Buffer.from([1, 1]), ascii('nextup-fixture-icc-stub')]),
  );
  const sof0 = jpegSegment(
    0xc0,
    concat([
      Buffer.from([8]), // sample precision
      u16(height), // ⚠ HEIGHT PRECEDES WIDTH in an SOFn segment.
      u16(width),
      Buffer.from([3]), // components
      Buffer.from([1, 0x22, 0]),
      Buffer.from([2, 0x11, 1]),
      Buffer.from([3, 0x11, 1]),
    ]),
  );
  const sos = jpegSegment(
    0xda,
    concat([
      Buffer.from([3]),
      Buffer.from([1, 0x00]),
      Buffer.from([2, 0x11]),
      Buffer.from([3, 0x11]),
      Buffer.from([0, 63, 0]),
    ]),
  );
  const entropy = Buffer.from([0x9a, 0x28, 0xa2, 0x80, 0x3f, 0xff, 0x00, 0xd2, 0x77, 0x14]);

  const metadata = withMetadata
    ? [
        jpegSegment(0xe1, concat([ascii('Exif\0\0'), exifWithGps()])),
        jpegSegment(0xed, concat([ascii('Photoshop 3.0\0'), ascii('8BIM')])),
        jpegSegment(0xfe, ascii('Captured on iPhone 15 Pro at 51.5N 0.1W')),
      ]
    : [];

  return concat([
    Buffer.from([0xff, 0xd8]), // SOI
    app0,
    ...metadata,
    app2,
    sof0,
    sos,
    entropy,
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

// ---------------------------------------------------------------------------
// HEIC/HEIF container stubs (ISO-BMFF)
// ---------------------------------------------------------------------------

const box = (type, payload) => concat([u32(payload.length + 8), ascii(type), payload]);
const fullBox = (type, payload) => box(type, concat([Buffer.alloc(4), payload]));

const ispe = (width, height) => fullBox('ispe', concat([u32(width), u32(height)]));

/**
 * `ftyp` with a HEIF-family major brand plus a compatible-brand list, exactly
 * as an iPhone writes one.
 */
const ftyp = (major, compatible) =>
  box('ftyp', concat([ascii(major), u32(0), ...compatible.map(ascii)]));

/**
 * ⚠ TWO `ispe` BOXES, SMALL ONE FIRST — deliberately. A real iPhone file
 * carries several (thumbnail, auxiliary/depth images, one per burst frame),
 * and the FIRST is frequently the thumbnail. A header reader that took the
 * first match would report a few hundred kilopixels and wave a 48 MP master
 * straight past the pixel guard, passing every single-`ispe` fixture on the
 * way. `readDimensions` takes the MAXIMUM; this fixture is what makes that
 * falsifiable.
 */
function heicStub(width, height, { mdatBytes = 4096, truncateTo = null } = {}) {
  const meta = fullBox(
    'meta',
    box('iprp', box('ipco', concat([ispe(320, 240), ispe(width, height)]))),
  );
  // `mdat` stands in for the HEVC-coded image item this repository cannot
  // encode. Filler is a fixed pattern so the file is byte-reproducible.
  const filler = Buffer.alloc(mdatBytes);
  for (let i = 0; i < filler.length; i += 1) filler[i] = (i * 7) & 0xff;
  const full = concat([ftyp('heic', ['mif1', 'heic']), meta, box('mdat', filler)]);
  return truncateTo === null ? full : full.subarray(0, truncateTo);
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const SCREENSHOT = [1179, 2556]; // iPhone 15 Pro screenshot
const PASTED = [1170, 2532]; // iPhone 13/14 screenshot, the paste path's shape

out('control-screenshot.png', pngImage(SCREENSHOT[0], SCREENSHOT[1], [18, 18, 20]));

out(
  'control-screenshot-with-metadata.png',
  pngImage(
    640,
    480,
    [30, 90, 140],
    [
      pngChunk('eXIf', exifWithGps()),
      pngChunk('tEXt', concat([ascii('Software\0'), ascii('nextup fixture generator')])),
      pngChunk(
        'zTXt',
        concat([ascii('Comment\0'), Buffer.from([0]), deflateSync(ascii('shot at home'))]),
      ),
      pngChunk(
        'iTXt',
        concat([
          ascii('XML:com.adobe.xmp\0'),
          Buffer.from([0, 0]),
          ascii('\0\0'),
          ascii('<x:xmpmeta>51.5N 0.1W</x:xmpmeta>'),
        ]),
      ),
      pngChunk('tIME', concat([u16(2026), Buffer.from([8, 18, 14, 32, 13])])),
    ],
  ),
);

out('clipboard-blob.png', pngImage(PASTED[0], PASTED[1], [200, 40, 60]));

out('control-photo.jpeg', jpegImage(2048, 1536, { withMetadata: false }));
out('control-photo-with-gps.jpeg', jpegImage(2048, 1536, { withMetadata: true }));

out('heic-header.heic', heicStub(SCREENSHOT[0], SCREENSHOT[1]));
out('heic-truncated.heic', heicStub(SCREENSHOT[0], SCREENSHOT[1], { truncateTo: 200 }));
out('heic-oversize.heic', heicStub(8000, 6000, { mdatBytes: 512 }));

// A real, minimal PDF. The fixture exists to be handed to the pipeline while
// its DECLARED type claims `image/png` — the lying-client case. Its bytes must
// therefore be a plausible non-image, not random noise.
out(
  'lying-blob.pdf',
  concat([
    ascii('%PDF-1.7\n'),
    ascii('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'),
    ascii('2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'),
    ascii('3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n'),
    ascii('trailer<</Root 1 0 R>>\n%%EOF\n'),
  ]),
);
