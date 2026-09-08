/**
 * strip-metadata.mjs — hand-run, in-place metadata removal for the golden
 * extraction corpus.
 *
 * WHY THIS EXISTS
 * ---------------
 * `saquibrashid/nextup` is a PUBLIC repository, and the two desktop fixtures are
 * iPhone PHOTOGRAPHS OF A MONITOR taken at the owner's home. As supplied they
 * carried a fully-populated Apple GPS IFD — latitude, longitude, altitude, image
 * direction and a GPS datestamp — plus `Make`, `Model` and the Apple MakerNote.
 *
 * ⚠ THE COMMIT THAT ADDED THEM IS TITLED "add owner golden screenshots with
 * metadata stripped" (4a3da2c, 2026-08-18) AND THE METADATA WAS NOT STRIPPED.
 * Nothing checked the claim, so it stood for months. That is the whole argument
 * for `T-AI-046f`: a commit message is an assertion nobody runs. The gate now
 * fails the build if any corpus image carries coordinates, and it found these
 * two on its first execution.
 *
 * HOW THIS DIFFERS FROM `../ingest/redact-gps.mjs`
 * -----------------------------------------------
 * That script REDACTS to a decoy, because `heic-with-gps.heic` exists precisely
 * to prove the production stripper coifpes with a real, fully-populated Apple GPS
 * IFD — removing the IFD would destroy the fixture. These two images have no
 * such reason to carry location at all, so this script REMOVES.
 *
 * WHAT IS CHANGED, IN PLACE, WITH NO CHANGE TO FILE LENGTH
 * --------------------------------------------------------
 *   - The GPS sub-IFD: entry count set to 0, every entry zeroed, and every
 *     out-of-line value byte zeroed.
 *
 *     ⚠ Zeroing the value bytes is the load-bearing half. Setting the count to
 *     zero merely hides the IFD from a parser; the raw latitude and longitude
 *     rationals would still sit in the file, recoverable by anyone reading it
 *     as hex. "Not visible to exiftool" is not "not published".
 *
 *   - IFD0 `Make` (0x010f) and `Model` (0x0110) value bytes -> NUL, so they read
 *     as empty strings. REQ-078 names device model alongside location.
 *   - The Exif sub-IFD `MakerNote` (0x927c) value bytes -> NUL. Opaque Apple
 *     vendor data; a dense device fingerprint with no value to this corpus.
 *
 * Deliberately NOT changed: the ISO-BMFF container, item layout, TIFF header,
 * the remaining IFD0 and Exif tags (orientation, dimensions, exposure, the
 * capture timestamp) and the image raster. Orientation in particular must
 * survive — `rotated-01` exists to prove the reader does not depend on it, which
 * is only a meaningful test while other fixtures still carry one.
 *
 * Run by hand from the repository root. It is idempotent: re-running produces no
 * diff, and it verifies its own output before writing.
 *
 *   node tests/fixtures/golden/images/strip-metadata.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const TIFF_MAGIC = [
  { bytes: [0x4d, 0x4d, 0x00, 0x2a], big: true }, // 'MM\0*'
  { bytes: [0x49, 0x49, 0x2a, 0x00], big: false }, // 'II*\0'
];

const TAG = {
  MAKE: 0x010f,
  MODEL: 0x0110,
  EXIF_IFD_POINTER: 0x8769,
  GPS_IFD_POINTER: 0x8825,
  MAKER_NOTE: 0x927c,
};

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/**
 * Find the one true TIFF header.
 *
 * The literal `Exif\0\0` occurs more than once in a HEIF file — the first is an
 * item TYPE recorded in an `infe` box, not a payload. Scanning for TIFF magic
 * finds the real block, and requiring exactly one plausible hit is the check
 * that we found the right one rather than a coincidence in compressed pixels.
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
        if (ifd0 < 8 || i + ifd0 + 2 > buf.length) continue;
        const count = big ? buf.readUInt16BE(i + ifd0) : buf.readUInt16LE(i + ifd0);
        if (count === 0 || count > 512) continue;
        if (i + ifd0 + 2 + count * 12 > buf.length) continue;
        hits.push({ offset: i, big, ifd0 });
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
    const type = big ? buf.readUInt16BE(e + 2) : buf.readUInt16LE(e + 2);
    const numValues = big ? buf.readUInt32BE(e + 4) : buf.readUInt32LE(e + 4);
    const byteLength = (TYPE_SIZE[type] ?? 0) * numValues;
    entries.push({
      tag: big ? buf.readUInt16BE(e) : buf.readUInt16LE(e),
      byteLength,
      entryOffset: e,
      // Values of four bytes or fewer live inline in the entry itself.
      valueOffset:
        byteLength <= 4
          ? e + 8
          : tiffStart + (big ? buf.readUInt32BE(e + 8) : buf.readUInt32LE(e + 8)),
    });
  }
  return { base, count, entries };
}

/**
 * Zero an entry's payload wherever it lives. Inline payloads sit in the entry.
 *
 * Returns 0 when the payload was ALREADY all zero, so a second run reports
 * "already clean" rather than re-announcing removals it did not perform. The
 * file is byte-identical either way; the difference is whether the operator is
 * told the truth about what this run did.
 */
function zeroValue(buf, entry) {
  const [from, to] =
    entry.byteLength <= 4
      ? [entry.entryOffset + 8, entry.entryOffset + 12]
      : [entry.valueOffset, entry.valueOffset + entry.byteLength];
  if (to > buf.length) {
    throw new Error(`tag 0x${entry.tag.toString(16)} value runs past end of file`);
  }
  let alreadyZero = true;
  for (let i = from; i < to; i++) {
    if (buf[i] !== 0) {
      alreadyZero = false;
      break;
    }
  }
  if (alreadyZero) return 0;
  buf.fill(0, from, to);
  return to - from;
}

function strip(file) {
  const target = join(HERE, file);
  const buf = readFileSync(target);
  const before = buf.length;

  const headers = findTiffHeaders(buf);
  if (headers.length === 0) return { file, skipped: 'no EXIF block' };
  if (headers.length !== 1) {
    throw new Error(
      `${file}: expected exactly one TIFF header, found ${headers.length}. ` +
        `Refusing to guess which one carries the GPS IFD.`,
    );
  }
  const [{ offset: tiffStart, big, ifd0 }] = headers;
  const { entries: ifd0Entries } = readEntries(buf, tiffStart, ifd0, big);

  let zeroed = 0;
  const removed = [];

  for (const tag of [TAG.MAKE, TAG.MODEL]) {
    const entry = ifd0Entries.find((e) => e.tag === tag);
    if (entry) {
      const n = zeroValue(buf, entry);
      if (n > 0) {
        zeroed += n;
        removed.push(`0x${tag.toString(16)}`);
      }
    }
  }

  const exifPointer = ifd0Entries.find((e) => e.tag === TAG.EXIF_IFD_POINTER);
  if (exifPointer) {
    const exifOffset = big
      ? buf.readUInt32BE(exifPointer.valueOffset)
      : buf.readUInt32LE(exifPointer.valueOffset);
    const { entries } = readEntries(buf, tiffStart, exifOffset, big);
    const makerNote = entries.find((e) => e.tag === TAG.MAKER_NOTE);
    if (makerNote) {
      const n = zeroValue(buf, makerNote);
      if (n > 0) {
        zeroed += n;
        removed.push('MakerNote');
      }
    }
  }

  const gpsPointer = ifd0Entries.find((e) => e.tag === TAG.GPS_IFD_POINTER);
  if (gpsPointer) {
    const gpsOffset = big
      ? buf.readUInt32BE(gpsPointer.valueOffset)
      : buf.readUInt32LE(gpsPointer.valueOffset);
    const { base, count, entries } = readEntries(buf, tiffStart, gpsOffset, big);

    // Payloads FIRST: once the count is zero the entries can no longer be
    // walked, and the coordinate bytes would be stranded in the file.
    for (const entry of entries) zeroed += zeroValue(buf, entry);

    // Then the IFD itself: count, every entry, and the trailing next-IFD
    // pointer (which becomes 0 = "no next IFD" once the region is zeroed).
    buf.fill(0, base, base + 2 + count * 12 + 4);
    if (count > 0) removed.push(`GPS IFD (${String(count)} tags)`);
  }

  if (buf.length !== before) throw new Error(`${file}: length changed — aborting.`);

  // Verify against a fresh parse before writing: the GPS IFD must now be empty.
  const reparsed = readEntries(buf, tiffStart, ifd0, big);
  const stillGps = reparsed.entries.find((e) => e.tag === TAG.GPS_IFD_POINTER);
  if (stillGps) {
    const gpsOffset = big
      ? buf.readUInt32BE(stillGps.valueOffset)
      : buf.readUInt32LE(stillGps.valueOffset);
    const { count } = readEntries(buf, tiffStart, gpsOffset, big);
    if (count !== 0) throw new Error(`${file}: GPS IFD still holds ${String(count)} tags`);
  }

  writeFileSync(target, buf);
  return { file, removed, zeroed, bytes: buf.length };
}

const targets = readdirSync(HERE).filter((name) =>
  ['.heic', '.jpg', '.jpeg'].includes(extname(name).toLowerCase()),
);

for (const file of targets) {
  const result = strip(file);
  if (result.skipped) {
    console.log(`${file}: ${result.skipped}`);
  } else if (result.removed.length === 0) {
    console.log(`${file}: already clean`);
  } else {
    console.log(
      `${file}: removed ${result.removed.join(', ')} (${String(result.zeroed)} bytes zeroed)`,
    );
  }
}
