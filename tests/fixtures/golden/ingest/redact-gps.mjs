/**
 * redact-gps.mjs — hand-run, in-place redaction of the owner-supplied HEIC fixture.
 *
 * WHY THIS EXISTS
 * ---------------
 * `heic-with-gps.heic` is a genuine Apple iPhone photograph, supplied by the owner
 * because nothing in this repository can synthesise one (T-DEP-002 forbids a HEIC
 * *encoder* anywhere in the dependency tree). It is the only fixture that exercises
 * REQ-078 against the EXIF layout an iPhone actually writes.
 *
 * `saquibrashid/nextup` is a PUBLIC repository. The file as supplied carried the
 * owner's real latitude and longitude. Publishing those to public git history is
 * irreversible in practice, so the coordinates are replaced with a decoy.
 *
 * WHAT IS AND IS NOT CHANGED
 * --------------------------
 * Changed, in place, with NO change to any byte offset or length:
 *   - GPSLatitudeRef  (0x0001, ASCII, inline)  -> 'N'
 *   - GPSLatitude     (0x0002, 3x RATIONAL)    -> decoy degrees/minutes/seconds
 *   - GPSLongitudeRef (0x0003, ASCII, inline)  -> 'W'
 *   - GPSLongitude    (0x0004, 3x RATIONAL)    -> decoy degrees/minutes/seconds
 *
 * Deliberately NOT changed: the ISO-BMFF container, the item layout, the TIFF
 * header, IFD0, the Exif sub-IFD, Make/Model/Software, the XMP packet, the image
 * raster, and the remaining eleven GPS tags (altitude, timestamps, speed, image
 * direction, dilution of precision...). Those are exactly what makes the fixture
 * worth having: the stripper must cope with a real, fully-populated Apple GPS IFD,
 * and REQ-078 names device model as well as location.
 *
 * This is REDACTION, not fabrication. Every structure the test relies on is still
 * the one an iPhone wrote; only six rational values and two reference characters
 * differ. A synthetic HEIC would prove nothing — this still proves everything.
 *
 * The decoy is the Statue of Liberty (40 deg 41' 21" N, 74 deg 2' 40" W): a public
 * landmark, obviously deliberate, and with no zero components so it can never be
 * misread as "GPS absent".
 *
 * Run by hand from the repository root, once, before the fixture is committed:
 *   node tests/fixtures/golden/ingest/redact-gps.mjs
 * It is idempotent: re-running it produces no diff.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, 'heic-with-gps.heic');

/** Statue of Liberty, as degrees/minutes/seconds. No component is zero. */
const DECOY = {
  latRef: 'N',
  lat: [40, 41, 21],
  lonRef: 'W',
  lon: [74, 2, 40],
};

const TIFF_MAGIC = [
  { bytes: [0x4d, 0x4d, 0x00, 0x2a], big: true }, // 'MM\0*'
  { bytes: [0x49, 0x49, 0x2a, 0x00], big: false }, // 'II*\0'
];

const TAG = {
  GPS_IFD_POINTER: 0x8825,
  GPS_LAT_REF: 0x0001,
  GPS_LAT: 0x0002,
  GPS_LON_REF: 0x0003,
  GPS_LON: 0x0004,
};

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/**
 * Find the one true TIFF header.
 *
 * The literal string `Exif\0\0` occurs more than once in a HEIF file: the first
 * occurrence is the item *type* recorded in an `infe` box, not a payload. Scanning
 * for the TIFF magic instead finds the real thing, and finding exactly one hit is
 * the check that we found the right one.
 */
function findTiffHeaders(buf) {
  const hits = [];
  for (let i = 0; i + 8 <= buf.length; i++) {
    for (const { bytes, big } of TIFF_MAGIC) {
      if (
        buf[i] === bytes[0] &&
        buf[i + 1] === bytes[1] &&
        buf[i + 2] === bytes[2] &&
        buf[i + 3] === bytes[3]
      ) {
        const ifd0 = big ? buf.readUInt32BE(i + 4) : buf.readUInt32LE(i + 4);
        // A plausible header points at an IFD inside the file, past the 8-byte header.
        if (ifd0 >= 8 && i + ifd0 + 2 <= buf.length) hits.push({ offset: i, big, ifd0 });
      }
    }
  }
  return hits;
}

function readEntries(buf, tiffStart, ifdOffset, big) {
  const base = tiffStart + ifdOffset;
  const count = big ? buf.readUInt16BE(base) : buf.readUInt16LE(base);
  const entries = [];
  for (let n = 0; n < count; n++) {
    const e = base + 2 + n * 12;
    const tag = big ? buf.readUInt16BE(e) : buf.readUInt16LE(e);
    const type = big ? buf.readUInt16BE(e + 2) : buf.readUInt16LE(e + 2);
    const numValues = big ? buf.readUInt32BE(e + 4) : buf.readUInt32LE(e + 4);
    const byteLength = (TYPE_SIZE[type] ?? 0) * numValues;
    // Values of four bytes or fewer are stored inline in the entry itself.
    const valueOffset =
      byteLength <= 4
        ? e + 8
        : tiffStart + (big ? buf.readUInt32BE(e + 8) : buf.readUInt32LE(e + 8));
    entries.push({ tag, type, numValues, byteLength, valueOffset });
  }
  return entries;
}

function writeRationals(buf, offset, big, triple) {
  triple.forEach((whole, i) => {
    const at = offset + i * 8;
    if (big) {
      buf.writeUInt32BE(whole, at);
      buf.writeUInt32BE(1, at + 4);
    } else {
      buf.writeUInt32LE(whole, at);
      buf.writeUInt32LE(1, at + 4);
    }
  });
}

const buf = readFileSync(TARGET);
const before = buf.length;

const headers = findTiffHeaders(buf);
if (headers.length !== 1) {
  throw new Error(
    `Expected exactly one TIFF header in ${TARGET}, found ${headers.length}. ` +
      `Refusing to guess which one carries the GPS IFD.`,
  );
}
const [{ offset: tiffStart, big, ifd0 }] = headers;

const ifd0Entries = readEntries(buf, tiffStart, ifd0, big);
const gpsPointer = ifd0Entries.find((e) => e.tag === TAG.GPS_IFD_POINTER);
if (!gpsPointer) throw new Error('No GPSInfo pointer (0x8825) in IFD0 — wrong fixture?');

const gpsIfdOffset = big
  ? buf.readUInt32BE(gpsPointer.valueOffset)
  : buf.readUInt32LE(gpsPointer.valueOffset);
const gpsEntries = readEntries(buf, tiffStart, gpsIfdOffset, big);

const need = (tag, label, type, numValues) => {
  const e = gpsEntries.find((x) => x.tag === tag);
  if (!e) throw new Error(`GPS IFD has no ${label} (0x${tag.toString(16)})`);
  if (e.type !== type || e.numValues !== numValues) {
    throw new Error(
      `${label} has unexpected shape (type=${e.type} count=${e.numValues}); refusing to overwrite.`,
    );
  }
  return e;
};

const latRef = need(TAG.GPS_LAT_REF, 'GPSLatitudeRef', 2, 2);
const lat = need(TAG.GPS_LAT, 'GPSLatitude', 5, 3);
const lonRef = need(TAG.GPS_LON_REF, 'GPSLongitudeRef', 2, 2);
const lon = need(TAG.GPS_LON, 'GPSLongitude', 5, 3);

buf.write(`${DECOY.latRef}\0`, latRef.valueOffset, 'ascii');
buf.write(`${DECOY.lonRef}\0`, lonRef.valueOffset, 'ascii');
writeRationals(buf, lat.valueOffset, big, DECOY.lat);
writeRationals(buf, lon.valueOffset, big, DECOY.lon);

if (buf.length !== before) throw new Error('Redaction changed the file length — aborting.');

writeFileSync(TARGET, buf);

console.log(`redacted ${TARGET}`);
console.log(`  TIFF header at byte ${tiffStart} (${big ? 'big' : 'little'}-endian)`);
console.log(`  GPS IFD: ${gpsEntries.length} tags, all but four left untouched`);
console.log(
  `  coordinates now ${DECOY.lat.join('/')} ${DECOY.latRef}, ${DECOY.lon.join('/')} ${DECOY.lonRef}`,
);
console.log(`  length unchanged: ${buf.length} bytes`);
