/**
 * TASK-148 - the magic-byte sniff (`specs/testing.md` §25.1, `specs/api.md` §5).
 *
 * These are pure-function assertions over bytes. The endpoint-level properties
 * this feeds - `T-IMG-006` (a non-image is 415 and named in `rejected[]`) and
 * `T-IMG-013` (a HEIC declared `application/octet-stream` is accepted and
 * transcoded) - are INTEGRATION properties of `POST /api/batches/:batchId/images`,
 * which is TASK-050 and does not exist yet. They are already cited on TASK-050's
 * row. Claiming them here would let an unbuilt endpoint report as verified, so
 * this task takes `T-IMG-024` and leaves them where they belong.
 */

import { describe, expect, it } from 'vitest';

import { UPLOAD_FORMATS } from '@nextup/domain';

import {
  HEIC_BRANDS,
  HEIF_BRANDS,
  JPEG_SIGNATURE,
  PNG_SIGNATURE,
  SNIFF_BYTES,
  isAcceptedUploadFormat,
  sniffUploadFormat,
} from '../../src/images/sniffFormat.js';

function png(trailing: readonly number[] = []): Uint8Array {
  return Uint8Array.from([...PNG_SIGNATURE, ...trailing]);
}

function jpeg(secondMarker: number): Uint8Array {
  return Uint8Array.from([...JPEG_SIGNATURE, secondMarker, 0x00, 0x10]);
}

function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

/**
 * Build an ISO-BMFF `ftyp` box. `declaredSize` defaults to the real byte
 * length; passing a different value is how the "lying box size" cases are
 * expressed, and the whole point of those is that a declared size must never
 * be trusted further than the buffer we actually hold.
 */
function ftyp(
  major: string,
  compatible: readonly string[] = [],
  declaredSize?: number,
): Uint8Array {
  const body = [
    ...ascii(major),
    0x00,
    0x00,
    0x00,
    0x00, // minor version
    ...compatible.flatMap((brand) => ascii(brand)),
  ];
  const size = declaredSize ?? body.length + 8;
  return Uint8Array.from([
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...ascii('ftyp'),
    ...body,
  ]);
}

describe('sniffUploadFormat', () => {
  it('T-IMG-024a: the PNG signature is classified png, and trailing bytes never change that', () => {
    expect(sniffUploadFormat(png())).toBe('png');
    expect(sniffUploadFormat(png([0x00, 0x00, 0x00, 0x0d, ...ascii('IHDR')]))).toBe('png');
  });

  it('T-IMG-024b: every legitimate JPEG second marker is classified jpeg', () => {
    // The fourth byte varies by encoder - JFIF E0, Exif E1, raw DB, Adobe EE.
    // Pinning it to E0 would reject every photo an iPhone has ever written.
    for (const marker of [0xe0, 0xe1, 0xdb, 0xee, 0xfe]) {
      expect(sniffUploadFormat(jpeg(marker))).toBe('jpeg');
    }
  });

  it('T-IMG-024c: every HEIF-family major brand is classified, heic and heif kept distinct', () => {
    for (const brand of HEIC_BRANDS) {
      expect(sniffUploadFormat(ftyp(brand))).toBe('heic');
    }
    for (const brand of HEIF_BRANDS) {
      expect(sniffUploadFormat(ftyp(brand))).toBe('heif');
    }
  });

  it('T-IMG-024d: a HEIF brand present only in the COMPATIBLE list is still found', () => {
    // A burst frame or Live Photo still declares mif1/msf1 as the major brand
    // with heic only among the compatible brands. A major-brand-only sniff
    // would reject those files, which are ordinary camera-roll images.
    expect(sniffUploadFormat(ftyp('qt  ', ['heic', 'isom']))).toBe('heic');
    expect(sniffUploadFormat(ftyp('mp42', ['isom', 'mif1']))).toBe('heif');
  });

  it('T-IMG-024e: an ftyp box with NO HEIF-family brand is rejected, not accepted as an image', () => {
    // The discriminating case for T-IMG-024c/d: if the sniff accepted any
    // ISO-BMFF container it would classify an MP4 as a HEIC and hand video
    // bytes to the image decoder.
    expect(sniffUploadFormat(ftyp('mp42', ['isom', 'mp42', 'avc1']))).toBeNull();
    expect(sniffUploadFormat(ftyp('qt  '))).toBeNull();
  });

  it('T-IMG-024f: non-images are rejected and never coerced to a default format', () => {
    expect(sniffUploadFormat(Uint8Array.from(ascii('%PDF-1.7')))).toBeNull();
    expect(sniffUploadFormat(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(sniffUploadFormat(Uint8Array.from(ascii('GIF89a')))).toBeNull();
    expect(sniffUploadFormat(Uint8Array.from(ascii('<!doctype html>')))).toBeNull();
  });

  it('T-IMG-024g: short, empty and truncated buffers return null and never throw', () => {
    expect(sniffUploadFormat(new Uint8Array(0))).toBeNull();
    for (let length = 1; length < PNG_SIGNATURE.length; length += 1) {
      expect(sniffUploadFormat(png().subarray(0, length))).toBeNull();
    }
    // A truncated ftyp: the box says it is longer than the bytes we hold.
    const truncated = ftyp('mif1', ['heic']).subarray(0, 10);
    expect(() => sniffUploadFormat(truncated)).not.toThrow();
    expect(sniffUploadFormat(truncated)).toBeNull();
  });

  it('T-IMG-024h: the sniff takes BYTES AND NOTHING ELSE - the declared type cannot reach it', () => {
    // Structural, not behavioural. iOS Safari sends application/octet-stream
    // for .heic and a pasted blob's type is set by whatever performed the
    // copy, so consulting a declared type is a security bug, not a shortcut.
    // A one-parameter signature means there is no channel through which one
    // could arrive - and this assertion fails the moment someone adds it.
    expect(sniffUploadFormat).toHaveLength(1);
  });

  it('T-IMG-024i: a declared box size larger than the buffer never reads past the end', () => {
    const lying = ftyp('mp42', ['heic'], 0x7fffffff);
    expect(sniffUploadFormat(lying)).toBe('heic');
    expect(sniffUploadFormat(lying.subarray(0, 16))).toBeNull();
  });

  it('T-IMG-024j: a brand beyond the DECLARED box size is not claimed by the file', () => {
    // Declared size 16 stops the compatible-brand scan at offset 16, so the
    // heic sitting at offset 16 belongs to the next box, not to ftyp.
    const understated = ftyp('mp42', ['heic'], 16);
    expect(sniffUploadFormat(understated)).toBeNull();
  });

  it('T-IMG-024k: an ftyp box declaring an illegal or largesize length is refused', () => {
    expect(sniffUploadFormat(ftyp('heic', [], 0))).toBeNull();
    expect(sniffUploadFormat(ftyp('heic', [], 1))).toBeNull();
    expect(sniffUploadFormat(ftyp('heic', [], 15))).toBeNull();
  });

  it('T-IMG-024l: corrupting a brand byte defeats the match - garbage is never a brand', () => {
    // Non-vacuity for T-IMG-024d: the compatible-brand scan matches the exact
    // four bytes and nothing looser. Note this passes with or without any
    // printable-ASCII validation in readBrand, which is precisely why that
    // validation was removed rather than kept and mis-tested - see the note on
    // readBrand in sniffFormat.ts.
    const box = ftyp('mp42', ['heic']);
    box[16] = 0x00;
    expect(sniffUploadFormat(box)).toBeNull();
  });

  it('T-IMG-024m: ALL FOUR accepted formats are reachable - the add-not-swap guard', () => {
    // PNG, JPEG and HEIC/HEIF are three distinct capture paths (laptop
    // screenshot, iOS Safari file input, iOS camera roll). Dropping one while
    // "tidying" the list breaks a path with no alternative, and every other
    // case here would still pass. This one would not.
    const reached = new Set(
      [png(), jpeg(0xe0), ftyp('heic'), ftyp('mif1')].map((bytes) => sniffUploadFormat(bytes)),
    );
    expect([...reached].sort()).toEqual([...UPLOAD_FORMATS].sort());
  });

  it('T-IMG-024n: SNIFF_BYTES is large enough for the ftyp cases this module classifies', () => {
    const largest = ftyp('mif1', ['mif1', 'MiHB', 'MiHE', 'miaf', 'MiHA', 'heic']);
    expect(largest.length).toBeLessThanOrEqual(SNIFF_BYTES);
    expect(sniffUploadFormat(largest.subarray(0, SNIFF_BYTES))).toBe('heif');
  });
});

describe('isAcceptedUploadFormat', () => {
  it('T-IMG-024o: every member of UPLOAD_FORMATS is accepted', () => {
    for (const format of UPLOAD_FORMATS) {
      expect(isAcceptedUploadFormat(format)).toBe(true);
    }
  });

  it('T-IMG-024p: null and anything outside UPLOAD_FORMATS is refused', () => {
    expect(isAcceptedUploadFormat(null)).toBe(false);
    // gif/webp/tiff are plausible-looking near misses; a stored `format` value
    // is not an accepted UPLOAD format either way, so the two sets stay apart.
    for (const format of ['', 'gif', 'webp', 'tiff', 'pdf', 'PNG']) {
      expect(isAcceptedUploadFormat(format)).toBe(false);
    }
  });
});
