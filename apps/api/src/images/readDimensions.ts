/**
 * Header-only dimension reading (`specs/api.md` §5.0.3, TASK-145).
 *
 * Reads STRUCTURE, never pixels. Touches at most the first 64 KiB of a file,
 * allocates no raster, constructs no decoder, and returns `null` rather than
 * throwing on anything malformed - a hostile or truncated file must fail one
 * image, never the request (REQ-080/081).
 *
 * ⚠ THE HEIC BRANCH IS PARSED HERE BY HAND, DELIBERATELY. Delegating it to
 * `heic-convert`/`libheif-js` "just to get the size" constructs exactly the
 * decoder the pixel guard exists to avoid constructing, which defeats the
 * guard entirely while looking like a simplification.
 */

const MAX_HEADER_SCAN_BYTES = 64 * 1024;

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

function readUInt32BE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || bytes.length < offset + 4) return null;
  return (
    (bytes[offset] as number) * 0x1000000 +
    ((bytes[offset + 1] as number) << 16) +
    ((bytes[offset + 2] as number) << 8) +
    (bytes[offset + 3] as number)
  );
}

function readUInt16BE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || bytes.length < offset + 2) return null;
  return ((bytes[offset] as number) << 8) + (bytes[offset + 1] as number);
}

function tagAt(bytes: Uint8Array, offset: number): string | null {
  if (offset < 0 || bytes.length < offset + 4) return null;
  let tag = '';
  for (let i = offset; i < offset + 4; i += 1) {
    tag += String.fromCharCode(bytes[i] as number);
  }
  return tag;
}

/**
 * PNG: `IHDR` is mandated by the spec to be the FIRST chunk, at a fixed
 * offset. Total read: 24 bytes.
 */
function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (tagAt(bytes, 12) !== 'IHDR') return null;
  const width = readUInt32BE(bytes, 16);
  const height = readUInt32BE(bytes, 20);
  if (width === null || height === null) return null;
  return { width, height };
}

const SOF_MARKERS_EXCLUDED = new Set([0xc4, 0xc8, 0xcc]); // DHT, JPG, DAC

/**
 * JPEG: walk the marker segments to the first Start-of-Frame.
 *
 * ⚠ IN AN SOFn SEGMENT, HEIGHT PRECEDES WIDTH. That is the classic
 * implementation bug in this parser, and getting it backwards is silent: the
 * guard still computes the same product, so every pixel-budget decision is
 * unchanged and only the axis-bound check and the reported dimensions are
 * wrong - on non-square images only. `T-IMG-025` pins the orientation with a
 * deliberately non-square fixture for exactly that reason.
 */
function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  const end = Math.min(bytes.length, MAX_HEADER_SCAN_BYTES);
  let offset = 2;

  while (offset + 1 < end) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] as number;
    // Fill bytes: a marker may be preceded by any number of 0xFF padding
    // bytes, so advance by one and re-read rather than assuming a segment.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers with no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) return null; // SOS: entropy-coded data begins, no SOF found.

    const segmentLength = readUInt16BE(bytes, offset + 2);
    if (segmentLength === null || segmentLength < 2) return null;

    if (marker >= 0xc0 && marker <= 0xcf && !SOF_MARKERS_EXCLUDED.has(marker)) {
      const height = readUInt16BE(bytes, offset + 5);
      const width = readUInt16BE(bytes, offset + 7);
      if (width === null || height === null) return null;
      return { width, height };
    }

    offset += 2 + segmentLength;
  }

  return null;
}

interface BoxWalkTarget {
  readonly bytes: Uint8Array;
  readonly start: number;
  readonly end: number;
}

/**
 * Collect every `ispe` box inside `meta > iprp > ipco`.
 *
 * ⚠ TAKE THE MAXIMUM `width * height` ACROSS ALL OF THEM, NEVER THE FIRST. A
 * real iPhone file carries several: a thumbnail, auxiliary and depth images,
 * and one per frame of a burst or Live Photo. The first is frequently the
 * thumbnail, so a first-match reader would report a few hundred kilopixels and
 * wave a 48 MP master straight past the guard - the guard would appear to work
 * on every synthetic fixture and fail on every real photograph.
 */
function collectIspe(target: BoxWalkTarget, depth: number, found: ImageDimensions[]): void {
  if (depth > 6) return;
  const { bytes } = target;
  let offset = target.start;

  while (offset + 8 <= target.end) {
    const declaredSize = readUInt32BE(bytes, offset);
    const type = tagAt(bytes, offset + 4);
    if (declaredSize === null || type === null) return;

    let headerSize = 8;
    let boxSize: number;
    if (declaredSize === 1) {
      // 64-bit largesize. We only ever scan the first 64 KiB, so a box that
      // needs 64 bits cannot be one we descend into; skipping to the end is
      // both correct and safe.
      const high = readUInt32BE(bytes, offset + 8);
      const low = readUInt32BE(bytes, offset + 12);
      if (high === null || low === null) return;
      boxSize = high * 0x100000000 + low;
      headerSize = 16;
    } else if (declaredSize === 0) {
      boxSize = target.end - offset; // "to end of file"
    } else {
      boxSize = declaredSize;
    }

    if (boxSize < headerSize) return; // Malformed: refuse rather than loop forever.
    const boxEnd = Math.min(offset + boxSize, target.end);
    const payloadStart = offset + headerSize;

    if (type === 'meta') {
      // FullBox: skip the 4 version/flags bytes before its children.
      collectIspe({ bytes, start: payloadStart + 4, end: boxEnd }, depth + 1, found);
    } else if (type === 'iprp' || type === 'ipco') {
      collectIspe({ bytes, start: payloadStart, end: boxEnd }, depth + 1, found);
    } else if (type === 'ispe') {
      const width = readUInt32BE(bytes, payloadStart + 4);
      const height = readUInt32BE(bytes, payloadStart + 8);
      if (width !== null && height !== null) found.push({ width, height });
    }

    offset = boxEnd;
    if (boxSize === 0) return;
  }
}

function readHeifDimensions(bytes: Uint8Array): ImageDimensions | null {
  const found: ImageDimensions[] = [];
  collectIspe({ bytes, start: 0, end: Math.min(bytes.length, MAX_HEADER_SCAN_BYTES) }, 0, found);
  if (found.length === 0) return null;
  return found.reduce((largest, candidate) =>
    candidate.width * candidate.height > largest.width * largest.height ? candidate : largest,
  );
}

const PNG_SIGNATURE_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function hasPngSignature(buf: Uint8Array): boolean {
  if (buf.length < PNG_SIGNATURE_BYTES.length) return false;
  return PNG_SIGNATURE_BYTES.every((byte, index) => buf[index] === byte);
}

/**
 * Read the declared dimensions of a PNG, JPEG or HEIC/HEIF from its header.
 *
 * Returns `null` for an unparseable, truncated or unrecognised header. A
 * `null` is a REJECTION upstream (`evaluatePixelGuard` maps it to
 * `UNSUPPORTED_IMAGE_FORMAT`), never a licence to decode and find out.
 *
 * The format is re-derived from the bytes here rather than accepted as a
 * parameter, for the same reason the sniff takes no declared type: a caller
 * that could tell this function which parser to run could tell it the wrong
 * one, and a JPEG parsed as a PNG returns dimensions from arbitrary offsets.
 */
export function readDimensions(buf: Uint8Array): ImageDimensions | null {
  if (hasPngSignature(buf)) {
    return readPngDimensions(buf);
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return readJpegDimensions(buf);
  }
  if (tagAt(buf, 4) === 'ftyp') {
    return readHeifDimensions(buf);
  }
  return null;
}
