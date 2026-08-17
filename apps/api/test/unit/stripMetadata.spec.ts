/**
 * TASK-150 — the EXIF/XMP/GPS strip (`stripAllMetadata` in
 * `apps/api/src/images/transcode.ts`, REQ-078, `specs/security.md` §4.2).
 *
 * ⚠ THE TRAP THIS FILE EXISTS TO AVOID. WebKit strips EXIF when a page reads
 * an image from the CLIPBOARD, and does NOT strip it on FILE UPLOAD. So a test
 * that asserts "the stored blob has no EXIF" against a PASTED image passes
 * whatever our code does — the browser already did the work — and proves
 * nothing. The load-bearing cases below therefore carry REAL EXIF with REAL
 * GPS through the UPLOAD path, and `T-SEC-032e` deliberately fails if the
 * fixture ever stops carrying it, so the suite cannot go vacuous quietly.
 */

import { describe, expect, it } from 'vitest';

import { AppError } from '../../src/errors/AppError.js';
import { stripAllMetadata } from '../../src/images/transcode.js';

const EXIF_MAGIC = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // 'Exif\0\0'
/** A GPS latitude of 47.6205° N — the kind of thing an iPhone writes. */
const GPS_LATITUDE = [0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x01];

function contains(haystack: Uint8Array, needle: readonly number[]): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

function segment(marker: number, payload: readonly number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

/**
 * A JPEG carrying an APP1 EXIF block with a GPS IFD, plus an XMP APP1, an
 * IPTC APP13 and a comment — and an ICC APP2 that must SURVIVE.
 */
function jpegWithExif(): Uint8Array {
  const exifPayload = [
    ...EXIF_MAGIC,
    0x4d,
    0x4d,
    0x00,
    0x2a, // big-endian TIFF header
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01, // one IFD entry
    0x88,
    0x25, // GPSInfoIFDPointer
    0x00,
    0x04,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x1a,
    ...GPS_LATITUDE,
    0x00,
    0x00,
    0x00,
    0x00,
  ];
  const xmpPayload = [
    ...'http://ns.adobe.com/xap/1.0/\u0000'.split('').map((c) => c.charCodeAt(0)),
    ...'<x:xmpmeta><gps>47.6205</gps></x:xmpmeta>'.split('').map((c) => c.charCodeAt(0)),
  ];
  const iccPayload = [
    ...'ICC_PROFILE\u0000'.split('').map((c) => c.charCodeAt(0)),
    0x01,
    0x01,
    0xde,
    0xad,
    0xbe,
    0xef,
  ];

  return new Uint8Array([
    0xff,
    0xd8, // SOI
    ...segment(
      0xe0,
      [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00],
    ), // APP0/JFIF
    ...segment(0xe1, exifPayload), // APP1 EXIF + GPS
    ...segment(0xe1, xmpPayload), // APP1 XMP
    ...segment(0xe2, iccPayload), // APP2 ICC — must survive
    ...segment(0xed, [0x50, 0x68, 0x6f, 0x74, 0x6f, 0x73, 0x68, 0x6f, 0x70]), // APP13 IPTC
    ...segment(0xfe, [0x69, 0x50, 0x68, 0x6f, 0x6e, 0x65, 0x20, 0x31, 0x35]), // COM 'iPhone 15'
    ...segment(
      0xc0,
      [0x08, 0x03, 0x20, 0x02, 0x80, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01],
    ), // SOF0 800×640
    0xff,
    0xda,
    0x00,
    0x08,
    0x01,
    0x01,
    0x00,
    0x00,
    0x3f,
    0x00, // SOS
    0x12,
    0x34,
    0x56,
    0x78, // entropy-coded data
    0xff,
    0xd9, // EOI
  ]);
}

function chunk(type: string, data: readonly number[]): number[] {
  const length = data.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...type.split('').map((c) => c.charCodeAt(0)),
    ...data,
    0xde,
    0xad,
    0xbe,
    0xef, // CRC — never recomputed, because whole chunks are copied or dropped
  ];
}

/**
 * A PNG carrying `eXIf` (with GPS), `iTXt` (XMP) and `tEXt`.
 *
 * ⚠ THIS IS NOT A HYPOTHETICAL. `heic-convert` output is a PNG, and a PNG is
 * exactly where an `eXIf` chunk lands if any step in the chain propagates the
 * source metadata. The strip must be able to remove it.
 */
function pngWithExif(): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [0, 0, 0x04, 0x9b, 0, 0, 0x09, 0xfc, 8, 6, 0, 0, 0]),
    ...chunk('eXIf', [...EXIF_MAGIC, ...GPS_LATITUDE]),
    ...chunk(
      'iTXt',
      'XML:com.adobe.xmp'.split('').map((c) => c.charCodeAt(0)),
    ),
    ...chunk(
      'tEXt',
      'Model\u0000iPhone 15 Pro'.split('').map((c) => c.charCodeAt(0)),
    ),
    ...chunk('tIME', [0x07, 0xea, 0x08, 0x0b, 0x0f, 0x2a, 0x21]),
    ...chunk('IDAT', [0x78, 0x9c, 0x01, 0x02]),
    ...chunk('IEND', []),
  ]);
}

describe('T-SEC-032 EXIF, XMP and GPS never reach the blob', () => {
  it('T-SEC-032a: an uploaded JPEG loses its EXIF, GPS, XMP, IPTC and comment', () => {
    const stripped = stripAllMetadata(jpegWithExif(), 'jpeg');

    expect(contains(stripped, EXIF_MAGIC)).toBe(false);
    expect(contains(stripped, GPS_LATITUDE)).toBe(false);
    expect(contains(stripped, [0x50, 0x68, 0x6f, 0x74, 0x6f, 0x73, 0x68, 0x6f, 0x70])).toBe(false);
    expect(
      contains(
        stripped,
        'iPhone 15'.split('').map((c) => c.charCodeAt(0)),
      ),
    ).toBe(false);
    expect(
      contains(
        stripped,
        'xmpmeta'.split('').map((c) => c.charCodeAt(0)),
      ),
    ).toBe(false);
  });

  it('T-SEC-032b: the JPEG raster and its ICC profile survive intact', () => {
    // Privacy that costs image quality is not privacy, it is a quality
    // regression wearing its badge: NFR-012a. The ICC profile decides how the
    // image renders and identifies nobody, so it is kept deliberately.
    const stripped = stripAllMetadata(jpegWithExif(), 'jpeg');

    expect(
      contains(
        stripped,
        'ICC_PROFILE'.split('').map((c) => c.charCodeAt(0)),
      ),
    ).toBe(true);
    expect(contains(stripped, [0xff, 0xc0])).toBe(true); // SOF0 — the raster
    expect(contains(stripped, [0x12, 0x34, 0x56, 0x78])).toBe(true); // scan data
    expect(Array.from(stripped.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect(Array.from(stripped.subarray(-2))).toEqual([0xff, 0xd9]);
  });

  it('T-SEC-032c: a PNG loses eXIf, iTXt, tEXt and tIME but keeps IHDR/IDAT/IEND', () => {
    const stripped = stripAllMetadata(pngWithExif(), 'png');

    expect(contains(stripped, EXIF_MAGIC)).toBe(false);
    expect(
      contains(
        stripped,
        'eXIf'.split('').map((c) => c.charCodeAt(0)),
      ),
    ).toBe(false);
    expect(
      contains(
        stripped,
        'iTXt'.split('').map((c) => c.charCodeAt(0)),
      ),
    ).toBe(false);
    expect(
      contains(
        stripped,
        'iPhone 15 Pro'.split('').map((c) => c.charCodeAt(0)),
      ),
    ).toBe(false);
    for (const kept of ['IHDR', 'IDAT', 'IEND']) {
      expect(
        contains(
          stripped,
          kept.split('').map((c) => c.charCodeAt(0)),
        ),
        kept,
      ).toBe(true);
    }
  });

  it('T-SEC-032d: an image with no metadata is returned byte-identical', () => {
    // The pass-through case must not be a re-encode. A pasted screenshot is
    // already clean, and a strip that rewrote it would be a lossy operation
    // performed for no reason at all.
    const clean = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...chunk('IHDR', [0, 0, 0x04, 0x9b, 0, 0, 0x09, 0xfc, 8, 6, 0, 0, 0]),
      ...chunk('IDAT', [0x78, 0x9c, 0x01, 0x02]),
      ...chunk('IEND', []),
    ]);

    expect(Array.from(stripAllMetadata(clean, 'png'))).toEqual(Array.from(clean));
  });

  it('T-SEC-032e: the fixtures really do carry EXIF and GPS to begin with', () => {
    // ⚠ THE NON-VACUITY GUARD. Every assertion above is of the form "this byte
    // sequence is absent". If a fixture silently stopped containing it, they
    // would all pass against a strip that did nothing whatsoever.
    for (const [name, bytes] of [
      ['jpeg', jpegWithExif()],
      ['png', pngWithExif()],
    ] as const) {
      expect(contains(bytes, EXIF_MAGIC), name).toBe(true);
      expect(contains(bytes, GPS_LATITUDE), name).toBe(true);
    }
  });

  it('T-SEC-032f: stripping shrinks the file — it does not merely blank it', () => {
    const before = jpegWithExif();
    expect(stripAllMetadata(before, 'jpeg').byteLength).toBeLessThan(before.byteLength);
  });
});

describe('T-SEC-033 the strip is unconditional and fails closed', () => {
  it('T-SEC-033a: a truncated PNG chunk stream is refused, not stored unexamined', () => {
    // Failing OPEN here would store bytes whose contents we never established,
    // which is the one outcome this step exists to prevent.
    const truncated = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0x00,
      0x00,
      0xff,
      0x00, // a length far beyond the buffer
      0x49,
      0x44,
      0x41,
      0x54,
    ]);

    expect(() => stripAllMetadata(truncated, 'png')).toThrow(AppError);
  });

  it('T-SEC-033b: a malformed JPEG marker stream is refused', () => {
    const malformed = new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03]);
    expect(() => stripAllMetadata(malformed, 'jpeg')).toThrow(AppError);
  });

  it('T-SEC-033c: the refusal names neither memory nor the runbook', () => {
    // `T-IMG-020`'s standing constraint — up-sizing the container cannot fix a
    // malformed file.
    let caught: AppError | undefined;
    try {
      stripAllMetadata(new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03]), 'jpeg');
    } catch (error) {
      caught = error as AppError;
    }

    expect(caught?.code).toBe('IMAGE_DECODE_FAILED');
    expect(caught?.message.toLowerCase()).not.toContain('memory');
    expect(caught?.message).not.toContain('scale-up-memory');
  });

  it('T-SEC-033d: the route\u2019s default stage is the real strip, not a pass-through', async () => {
    // The discriminator against the seam's previous default, which returned
    // its input untouched. REQ-078 is discharged by the WIRING, not by the
    // function existing.
    const { DEFAULT_STAGES } = await import('../../src/routes/batchImages.js');
    const stripped = await DEFAULT_STAGES.stripMetadata(jpegWithExif(), 'jpeg');

    expect(contains(stripped, EXIF_MAGIC)).toBe(false);
    expect(contains(stripped, GPS_LATITUDE)).toBe(false);
    // 20s, not the 5s default: this is the only case here that cold-imports the
    // whole route graph (sharp + prisma + blob) through a dynamic import. It
    // runs in ~600ms alone but times out under five-project contention, which
    // makes CI intermittently red for a reason unrelated to what it asserts.
  }, 20_000);
});
