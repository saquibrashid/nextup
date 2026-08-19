/**
 * Structural readers for the ingest fixtures — TIFF/EXIF, PNG chunks, JPEG segments.
 *
 * ⚠ WHY THIS EXISTS: SUBSTRING MATCHING FOR EXIF TAGS IS UNSOUND ON REAL FILES.
 * The obvious way to assert "this file carries GPS" is to look for the two bytes
 * of the GPSInfo tag (0x8825) in either byte order. Measured against the real
 * owner-supplied 1.8 MB iPhone HEIC in this directory, those two byte pairs occur
 * **33 times little-endian and 38 times big-endian** — every one of them a
 * coincidence inside compressed image data. Against the 309 KB iOS screenshot:
 * 6 and 2. An assertion built that way passes, or fails, by chance, and would
 * keep on "passing" if the stripper were deleted outright.
 *
 * So presence and absence are both decided STRUCTURALLY here: parse the TIFF
 * header, walk IFD0, follow the GPSInfo pointer, and report which tags exist.
 * Exact, not probabilistic, in both directions.
 *
 * ⚠ THIS MODULE NEVER RETURNS, LOGS OR FORMATS A COORDINATE VALUE. It reports
 * tag PRESENCE only. `heic-with-gps.heic` lives in a public repository with its
 * coordinates redacted (see `redact-gps.mjs`); a helper that printed decoded
 * values into CI logs would quietly undo that for any future fixture.
 */

/** EXIF/TIFF tag numbers this project asserts on. */
export const EXIF_TAG = {
  MAKE: 0x010f,
  MODEL: 0x0110,
  SOFTWARE: 0x0131,
  DATE_TIME: 0x0132,
  EXIF_IFD_POINTER: 0x8769,
  GPS_IFD_POINTER: 0x8825,
} as const;

/** GPS sub-IFD tag numbers. */
export const GPS_TAG = {
  LATITUDE_REF: 0x0001,
  LATITUDE: 0x0002,
  LONGITUDE_REF: 0x0003,
  LONGITUDE: 0x0004,
  ALTITUDE: 0x0006,
} as const;

const TYPE_SIZE: Readonly<Record<number, number>> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  7: 1,
  9: 4,
  10: 8,
};

export interface ExifReport {
  /** Byte offset of the TIFF header within the file. */
  readonly tiffOffset: number;
  readonly bigEndian: boolean;
  /** Tag numbers present in IFD0, in file order. */
  readonly ifd0Tags: readonly number[];
  /** Tag numbers in the Exif sub-IFD, or `null` when there is no pointer. */
  readonly exifTags: readonly number[] | null;
  /** Tag numbers in the GPS sub-IFD, or `null` when there is no pointer. */
  readonly gpsTags: readonly number[] | null;
}

interface Reader {
  u16(at: number): number;
  u32(at: number): number;
}

function readerFor(view: DataView, bigEndian: boolean): Reader {
  return {
    u16: (at) => view.getUint16(at, !bigEndian),
    u32: (at) => view.getUint32(at, !bigEndian),
  };
}

/**
 * Locate every plausible TIFF header in a buffer.
 *
 * ⚠ DO NOT SEARCH FOR THE STRING `Exif\0\0` IN A HEIF FILE. It occurs at least
 * twice: the first hit is the item TYPE recorded in an `infe` box, not a payload,
 * so a naive reader lands 126 KB before the real data and parses garbage. HEIF
 * stores EXIF as an item whose payload begins with a 4-byte big-endian offset to
 * the TIFF header — scanning for the TIFF magic itself sidesteps all of that, and
 * getting exactly one hit is the evidence that the right block was found.
 */
export function findTiffHeaders(bytes: Uint8Array): { offset: number; bigEndian: boolean }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hits: { offset: number; bigEndian: boolean }[] = [];
  for (let i = 0; i + 8 <= bytes.length; i++) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const b3 = bytes[i + 3];
    let bigEndian: boolean | null = null;
    if (b0 === 0x4d && b1 === 0x4d && b2 === 0x00 && b3 === 0x2a) bigEndian = true;
    else if (b0 === 0x49 && b1 === 0x49 && b2 === 0x2a && b3 === 0x00) bigEndian = false;
    if (bigEndian === null) continue;

    // A real header points at an IFD that lies inside the file, past the header.
    const ifd0 = view.getUint32(i + 4, !bigEndian);
    if (ifd0 < 8 || i + ifd0 + 2 > bytes.length) continue;
    // ...and that IFD must declare a tag count that fits.
    const count = view.getUint16(i + ifd0, !bigEndian);
    if (count === 0 || count > 512) continue;
    if (i + ifd0 + 2 + count * 12 > bytes.length) continue;
    hits.push({ offset: i, bigEndian });
  }
  return hits;
}

interface Entry {
  tag: number;
  type: number;
  count: number;
  valueOffset: number;
}

function readIfd(
  bytes: Uint8Array,
  r: Reader,
  tiffOffset: number,
  ifdOffset: number,
): Entry[] | null {
  const base = tiffOffset + ifdOffset;
  if (base + 2 > bytes.length) return null;
  const count = r.u16(base);
  if (base + 2 + count * 12 > bytes.length) return null;
  const entries: Entry[] = [];
  for (let n = 0; n < count; n++) {
    const e = base + 2 + n * 12;
    const type = r.u16(e + 2);
    const num = r.u32(e + 4);
    const byteLength = (TYPE_SIZE[type] ?? 0) * num;
    entries.push({
      tag: r.u16(e),
      type,
      count: num,
      // Values of four bytes or fewer live inline in the entry.
      valueOffset: byteLength <= 4 ? e + 8 : tiffOffset + r.u32(e + 8),
    });
  }
  return entries;
}

/**
 * Parse the EXIF block of a file, whatever container it sits in.
 *
 * Returns `null` when the file carries no parseable TIFF block at all — which is
 * exactly what a correctly stripped output looks like, and is therefore an
 * assertion in its own right.
 */
export function readExif(bytes: Uint8Array): ExifReport | null {
  const headers = findTiffHeaders(bytes);
  const header = headers[0];
  if (header === undefined) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r = readerFor(view, header.bigEndian);
  const ifd0Offset = r.u32(header.offset + 4);
  const ifd0 = readIfd(bytes, r, header.offset, ifd0Offset);
  if (ifd0 === null) return null;

  const sub = (pointerTag: number): readonly number[] | null => {
    const p = ifd0.find((e) => e.tag === pointerTag);
    if (p === undefined) return null;
    const entries = readIfd(bytes, r, header.offset, r.u32(p.valueOffset));
    return entries === null ? null : entries.map((e) => e.tag);
  };

  return {
    tiffOffset: header.offset,
    bigEndian: header.bigEndian,
    ifd0Tags: ifd0.map((e) => e.tag),
    exifTags: sub(EXIF_TAG.EXIF_IFD_POINTER),
    gpsTags: sub(EXIF_TAG.GPS_IFD_POINTER),
  };
}

/**
 * `true` when the file carries a GPS sub-IFD holding real coordinate tags.
 *
 * Deliberately stricter than "a 0x8825 pointer exists": the pointer must resolve
 * to an IFD that actually contains latitude AND longitude.
 */
export function hasGpsCoordinates(bytes: Uint8Array): boolean {
  const exif = readExif(bytes);
  if (exif === null || exif.gpsTags === null) return false;
  return exif.gpsTags.includes(GPS_TAG.LATITUDE) && exif.gpsTags.includes(GPS_TAG.LONGITUDE);
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * The PNG chunk types in file order.
 *
 * ⚠ THIS IS THE EXACT FORM OF "NO METADATA SURVIVED". Walking the chunk table and
 * asserting it equals `['IHDR', 'IDAT', 'IEND']` is a complete statement about the
 * file; searching the bytes for the string `eXIf` is not, because a four-character
 * ASCII sequence can and does occur inside compressed pixel data by chance.
 */
export function pngChunkTypes(bytes: Uint8Array): string[] {
  for (const [i, expected] of PNG_SIGNATURE.entries()) {
    if (bytes[i] !== expected) throw new Error('not a PNG: bad signature');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types: string[] = [];
  let at = PNG_SIGNATURE.length;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    types.push(type);
    if (type === 'IEND') break;
    at += 12 + length;
  }
  return types;
}

/** `true` for the chunk types PNG uses to carry metadata. */
export function isPngMetadataChunk(type: string): boolean {
  return ['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME', 'pHYs', 'dSIG'].includes(type);
}

/**
 * The JPEG marker numbers present, in file order (`0xFFE1` reported as `0xe1`).
 *
 * Stops at the start-of-scan, past which the entropy-coded data is not a segment
 * stream and must not be walked as one.
 */
export function jpegSegmentMarkers(bytes: Uint8Array): number[] {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG: bad SOI');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const markers: number[] = [];
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] as number;
    markers.push(marker);
    if (marker === 0xda) break;
    at += 2 + view.getUint16(at + 2);
  }
  return markers;
}
