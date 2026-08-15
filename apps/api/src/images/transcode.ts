/**
 * The HEIC/HEIF -> lossless PNG transcode (TASK-149, `specs/api.md` §5.1).
 *
 * ⚠ THIS STAGE IS CONDITIONAL, NOT OPTIONAL, AND THE CONDITION IS NOT HERE.
 * The caller (`images/ingest.ts` step 5) enters this stage only when the
 * MAGIC-BYTE SNIFF said `heic`/`heif`. `ingestSource` must never select it:
 * a pasted HEIC — a lying client, since WebKit's clipboard exposes only
 * `image/png` — is transcoded exactly like an uploaded one. `T-IMG-023`.
 *
 * ⚠ THE STAGE MUST NOT BE DELETED "because screenshots are always PNG now".
 * The iOS Photos FILE-UPLOAD path still delivers raw HEIC (A42, ADR-0008).
 *
 * ⚠ LOSSLESS PNG ONLY — never a lossy re-encode. Extraction is quality-first
 * (NFR-012a); degrading the raster degrades the small tile captions the
 * extractor reads, and a cost- or size-motivated downgrade here is
 * non-compliance rather than an optimisation.
 *
 * ORDER (§5.1): guard -> decode -> consistency check -> return. The metadata
 * strip, the blob write and the row insert are the caller's, in that order.
 * An interruption therefore leaves an orphan blob at worst, never a row
 * pointing at a missing blob; orphans are collected by the 30-day lifecycle
 * purge and NO compensating cleanup code exists or is to be written.
 */

import convert from 'heic-convert';

import { AppError } from '../errors/AppError.js';
import { assertDecodable } from './decodeGuard.js';
import { readDimensions } from './readDimensions.js';
import type { UploadFormat } from '@nextup/domain';

/**
 * Errors raised when a WASM heap cannot grow. This is the COMMON out-of-memory
 * path for `heic-convert` (libheif compiled to WebAssembly) and — unlike a
 * kernel OOM kill — it is CATCHABLE and leaves the container running
 * (ADR-0008 R2.4). Handling only the kernel path would miss the likelier case;
 * handling only this one would miss the fatal case. The kernel path cannot be
 * handled in-process at all, which is exactly why the pre-decode guard exists.
 *
 * Matched on the MESSAGE because the thrown value is a plain `RangeError`
 * with no distinguishing property: V8 raises `RangeError: WebAssembly.Memory():
 * could not allocate memory`, and Emscripten's own abort path raises
 * `RangeError: Array buffer allocation failed` / "out of memory".
 */
const OOM_PATTERNS: readonly RegExp[] = [
  /out of memory/i,
  /could not allocate/i,
  /array buffer allocation failed/i,
  /memory allocation failed/i,
  /cannot enlarge memory/i,
  /allocation size overflow/i,
];

function isOutOfMemory(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return OOM_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * A decode that exhausted memory is NOT the same failure as a corrupt file,
 * and they must not share a code (`T-IMG-020`): more memory fixes one and can
 * never fix the other. `IMAGE_DECODE_OOM` is a 503 — the request failed for a
 * reason on our side that a retry after up-sizing resolves — while a corrupt
 * file is a 415 the owner must fix by re-exporting.
 */
function oomError(): AppError {
  return new AppError(
    'IMAGE_DECODE_OOM',
    503,
    'That image ran out of memory while being opened. This is a memory limit, ' +
      'not a problem with your image. No other image in this batch was affected; ' +
      're-attach this file after up-sizing compute — see docs/runbooks/scale-up-memory.md.',
    { remedy: 'docs/runbooks/scale-up-memory.md' },
  );
}

function decodeFailed(detail: string): AppError {
  // ⚠ Mentions NEITHER memory NOR the runbook, deliberately (`T-IMG-020`):
  // telling the owner to up-size the container because their file is truncated
  // is advice that cannot work.
  return new AppError(
    'IMAGE_DECODE_FAILED',
    415,
    "That image couldn't be read. Try re-exporting the screenshot as PNG and attaching it again.",
    { detail },
  );
}

/** Injected so a test can drive the OOM and corrupt paths without a fixture. */
export interface HeicDecoder {
  (input: { buffer: Uint8Array; format: 'PNG' }): Promise<ArrayBuffer | Uint8Array>;
}

const defaultDecoder: HeicDecoder = (input) =>
  // `heic-convert` types its input as a Node `Buffer`. The contract here is
  // `Uint8Array` because the ingest pipeline's types are shared with the
  // browser; a `Buffer` IS a `Uint8Array`, so the view is passed through
  // unchanged rather than copied.
  convert(input as unknown as Parameters<typeof convert>[0]) as Promise<ArrayBuffer | Uint8Array>;

/**
 * Transcode HEIC/HEIF bytes to lossless PNG.
 *
 * Throws `AppError` — the caller turns it into ONE `rejected[]` entry, so a
 * failure here fails one image and never the batch (REQ-080/081).
 */
export async function transcodeHeicToPng(
  bytes: Uint8Array,
  from: UploadFormat,
  options: { readonly env?: NodeJS.ProcessEnv; readonly decoder?: HeicDecoder } = {},
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  // ⚠ FIRST STATEMENT, BEFORE ANY BUFFER IS ALLOCATED (backlog TASK-149 R6).
  // The caller already ran the guard; this is not redundant. It makes the
  // guarantee a property of THIS module rather than of one call site, so a
  // second call site cannot be added that decodes unguarded.
  const declared = assertDecodable(bytes, options.env);

  if (from !== 'heic' && from !== 'heif') {
    // Defensive: reaching here means the caller's condition is wrong, which is
    // a bug rather than a bad image. Never silently transcode a PNG — that
    // would hide exactly the regression `T-IMG-023` exists to catch.
    throw new Error(`transcodeHeicToPng called for format "${from}"; the condition is §5.1's.`);
  }

  const decoder = options.decoder ?? defaultDecoder;
  let decoded: ArrayBuffer | Uint8Array;
  try {
    decoded = await decoder({ buffer: bytes, format: 'PNG' });
  } catch (error) {
    if (isOutOfMemory(error)) {
      throw oomError();
    }
    throw decodeFailed(error instanceof Error ? error.message : String(error));
  }

  const png = decoded instanceof Uint8Array ? decoded : new Uint8Array(decoded);
  if (png.byteLength === 0) {
    throw decodeFailed('the decoder produced no output');
  }

  // §5.1 step 4 — a SECONDARY consistency check, not the guard. The guard ran
  // pre-decode, on the header. This compares the raster we actually got with
  // what the header claimed: a file that lies in its header is malformed, not
  // merely large, so a mismatch is `IMAGE_DECODE_FAILED` and never
  // `IMAGE_TOO_LARGE_TO_DECODE`.
  const actual = readDimensions(png);
  if (actual === null) {
    throw decodeFailed('the decoded output is not a readable PNG');
  }
  //
  // ⚠ A TRANSPOSED RASTER IS NOT A MISMATCH, AND THIS IS NOT A LOOSENING.
  // `readDimensions` reads the HEIF `ispe` box, which records the STORED
  // extent and is defined to ignore the `irot`/`imir` transform properties.
  // libheif applies those transforms when it decodes, so a portrait iPhone
  // photo stored 4032x3024 with a 90° `irot` legitimately decodes to
  // 3024x4032. Rejecting that would refuse ordinary camera-roll uploads — the
  // exact case A42 exists to support — while catching no attack: the pixel
  // COUNT, which is the only thing the memory guard cares about, is identical
  // either way. A genuine header lie changes the count and is still caught.
  const transposed = actual.width === declared.height && actual.height === declared.width;
  if (!transposed && (actual.width !== declared.width || actual.height !== declared.height)) {
    throw decodeFailed(
      `header declared ${String(declared.width)}x${String(declared.height)} but the raster is ` +
        `${String(actual.width)}x${String(actual.height)}`,
    );
  }

  return { bytes: png, width: actual.width, height: actual.height };
}
