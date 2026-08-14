/**
 * Magic-byte format sniffing for uploaded images (TASK-148, `specs/api.md` §5).
 *
 * THE ONE RULE THIS MODULE EXISTS TO ENFORCE: the format is decided by the
 * BYTES, never by the declared `Content-Type`, never by `File.type`, never by
 * `Blob.type`, never by the filename extension. iOS Safari routinely sends
 * `application/octet-stream` or an empty type for a `.heic` file, so trusting
 * the declared type would reject the owner's own phone images on first use
 * (ASM-058). Conversely a pasted blob's `type` string is supplied by whatever
 * application performed the copy and is never validated by the page, so a PDF
 * claiming `image/png` must be rejected exactly like an uploaded one
 * (`specs/api.md` §5, A45).
 *
 * That rule is enforced STRUCTURALLY, not by convention: `sniffUploadFormat`
 * takes bytes and nothing else. There is no parameter through which a declared
 * type could reach the decision, so no caller can accidentally hand one over
 * and no future edit can start consulting one without changing the signature.
 * `T-IMG-024h` asserts the arity for exactly that reason.
 *
 * Scope: this module classifies. It does NOT decide the transcode (TASK-149),
 * read dimensions (TASK-145 / `specs/api.md` §5.0) or touch storage. It is the
 * input contract for both.
 */

import { UPLOAD_FORMATS, type UploadFormat } from '@nextup/domain';

/** `89 50 4E 47 0D 0A 1A 0A` - the 8-byte PNG signature. */
export const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * `FF D8 FF` - SOI followed by the first marker of the next segment. Only
 * three bytes are checked because the fourth varies legitimately across JFIF
 * (`E0`), Exif (`E1`), raw (`DB`) and Adobe (`EE`) encoders.
 */
export const JPEG_SIGNATURE = Object.freeze([0xff, 0xd8, 0xff]);

/**
 * The HEIF-family brands from `specs/api.md` §5, split by which `UploadFormat`
 * they report.
 *
 * The split is presentational only. Both values are in `UPLOAD_FORMATS`, both
 * take the transcode branch in TASK-149, and nothing downstream may treat them
 * differently - `heif` is the generic ISO-BMFF image container and `heic` is
 * the HEVC-coded profile of it, which is what an iPhone actually writes.
 * Reporting the brand family the file declares keeps the diagnostic value
 * (`uploadedFormat` is persisted and surfaces in errors) without inviting a
 * behavioural branch.
 */
export const HEIC_BRANDS = Object.freeze(['heic', 'heix', 'heim', 'hevc']);
export const HEIF_BRANDS = Object.freeze(['heif', 'mif1', 'msf1']);

/**
 * The number of leading bytes a caller must supply for the sniff to be able to
 * reach a verdict on every supported format.
 *
 * An `ftyp` box carries its major brand at offset 8 and then a list of
 * compatible brands, and real iPhone files put the discriminating brand in
 * that list rather than in the major brand. 64 bytes covers the largest `ftyp`
 * box observed in practice while staying far below any allocation concern.
 * Supplying fewer bytes is safe - the sniff degrades to `null` rather than
 * throwing - but may under-report a HEIC as unsupported.
 */
export const SNIFF_BYTES = 64;

const FTYP = Object.freeze([0x66, 0x74, 0x79, 0x70]);
const BRAND_SIZE = 4;
const FTYP_HEADER_SIZE = 8;
const MIN_FTYP_BOX_SIZE = 16;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function matchesAt(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Read a four-byte brand, or `null` if the buffer is too short.
 *
 * ⚠ There is deliberately NO "is this printable ASCII?" validation here, and
 * adding one back would be dead code. Every brand this module produces is
 * compared against a fixed set of seven printable ASCII literals, so a byte
 * outside that range can never match anything - the verdict is identical with
 * or without the check. An earlier draft had one and a mutation test proved it
 * unfalsifiable: deleting it changed no result. A guard that cannot fail is
 * worse than no guard, because a test appearing to cover it reports assurance
 * that does not exist.
 */
function readBrand(bytes: Uint8Array, offset: number): string | null {
  if (bytes.length < offset + BRAND_SIZE) return null;
  let brand = '';
  for (let i = offset; i < offset + BRAND_SIZE; i += 1) {
    brand += String.fromCharCode(bytes[i] as number);
  }
  return brand;
}

function formatForBrand(brand: string): UploadFormat | null {
  if (HEIC_BRANDS.includes(brand)) return 'heic';
  if (HEIF_BRANDS.includes(brand)) return 'heif';
  return null;
}

function readUint32BE(bytes: Uint8Array, offset: number): number | null {
  if (bytes.length < offset + 4) return null;
  return (
    (bytes[offset] as number) * 0x1000000 +
    ((bytes[offset + 1] as number) << 16) +
    ((bytes[offset + 2] as number) << 8) +
    (bytes[offset + 3] as number)
  );
}

/**
 * Classify an ISO-BMFF `ftyp` box, or return `null` if the bytes are not one
 * or declare no HEIF-family brand.
 *
 * The major brand is consulted first, then the compatible-brand list. Both are
 * required: an iPhone HEIC commonly declares a major brand of `heic`, but a
 * multi-image file (a burst, or a Live Photo still) declares `mif1`/`msf1`
 * with `heic` appearing only among the compatible brands. Checking the major
 * brand alone would reject those; checking only the compatible list would
 * reject a minimal file that declares no compatible brands at all.
 */
function sniffIsoBmff(bytes: Uint8Array): UploadFormat | null {
  if (!matchesAt(bytes, 4, FTYP)) return null;

  const boxSize = readUint32BE(bytes, 0);
  if (boxSize === null) return null;
  // `size === 1` means a 64-bit largesize follows, displacing the brands. That
  // is not legal for `ftyp` (it is a small, fixed-shape box), so rather than
  // guess at an offset we refuse - the file falls through to 415 instead of
  // being misparsed into a brand that happens to sit at the wrong offset.
  if (boxSize < MIN_FTYP_BOX_SIZE) return null;

  const major = readBrand(bytes, FTYP_HEADER_SIZE);
  if (major !== null) {
    const format = formatForBrand(major);
    if (format !== null) return format;
  }

  // Compatible brands start after major brand (4) + minor version (4). The
  // scan is bounded by BOTH the declared box size and the buffer we were
  // handed: a truncated or lying box size must never walk us off the end, and
  // it must never let us read brands the file does not claim.
  const declaredEnd = Math.min(boxSize, bytes.length);
  for (
    let offset = FTYP_HEADER_SIZE + 8;
    offset + BRAND_SIZE <= declaredEnd;
    offset += BRAND_SIZE
  ) {
    const brand = readBrand(bytes, offset);
    if (brand === null) continue;
    const format = formatForBrand(brand);
    if (format !== null) return format;
  }

  return null;
}

/**
 * Decide the uploaded format from the leading bytes alone.
 *
 * Returns `null` for anything that matches no known signature - the caller
 * turns that into `415 UNSUPPORTED_IMAGE_FORMAT`. A `null` is never coerced
 * into a default format: guessing here would hand unvalidated bytes to a
 * decoder.
 *
 * Never throws. Every length check is explicit, so a zero-length, truncated or
 * hostile buffer produces `null` rather than an exception that would fail the
 * whole multipart request instead of the one file (REQ-080/081).
 */
export function sniffUploadFormat(bytes: Uint8Array): UploadFormat | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'jpeg';
  return sniffIsoBmff(bytes);
}

/**
 * `true` when the sniffed format is one nextup accepts.
 *
 * Kept as a named predicate over `UPLOAD_FORMATS` rather than an inline
 * comparison so that the accepted set has exactly one definition. The trap
 * this guards against is real and named in the product invariants: PNG, JPEG
 * and HEIC/HEIF are three distinct capture paths (laptop screenshot, iOS
 * Safari file input, iOS camera roll), and "tidying" the list by dropping one
 * breaks a path that has no alternative.
 */
export function isAcceptedUploadFormat(format: string | null): format is UploadFormat {
  return format !== null && (UPLOAD_FORMATS as readonly string[]).includes(format);
}
