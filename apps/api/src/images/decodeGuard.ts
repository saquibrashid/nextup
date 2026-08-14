/**
 * `assertDecodable` - the pre-decode guard's entry point (TASK-145).
 *
 * ⚠ THIS MUST BE THE FIRST STATEMENT ON ANY PATH THAT DECODES AN IMAGE, before
 * `heic-convert` is constructed, before any buffer is allocated and before the
 * blob write (`specs/api.md` §5.0; backlog TASK-149). The guard's whole value
 * is its position in the order. Called after a decoder exists, it is decoration.
 *
 * The order fixed by `specs/api.md` §5.0 is:
 *
 *   magic-byte sniff            -> no allocation   (images/sniffFormat.ts)
 *     -> byte ceiling           -> no allocation   (cheap first filter only)
 *     -> header dimension read  -> bounded, <= 64 KiB, NO decode
 *     -> THIS GUARD             -> accept or reject here
 *     -> decode / transcode     -> the ONLY place a raster is allocated
 *
 * ⚠ MODULE NAMING, RESOLVED RATHER THAN GUESSED. `specs/api.md` §5.0 names
 * `apps/api/src/images/pixelGuard.ts` for this role and `specs/api.md` §5.0.1
 * names `packages/domain/src/pixelGuard.ts` for the pure decision; the backlog
 * row for TASK-145 names `apps/api/src/images/decodeGuard.ts` exposing
 * `assertDecodable(header)`. The backlog is the work order, so the entry point
 * is `assertDecodable` and it lives here - and TASK-149's row, which mandates
 * calling `assertDecodable()` from `decodeGuard.ts` by name, resolves against
 * a real module. The pure decision is in the domain exactly where §5.0.1 puts
 * it, so there is one implementation, not two. Recorded in
 * `specs/testing.md` §26.3.
 */

import {
  evaluatePixelGuard,
  type PixelGuardVerdict,
  type PixelGuardRejectionCode,
} from '@nextup/domain';

import { maxDecodePixels } from '../config.js';
import { AppError } from '../errors/AppError.js';
import { readDimensions, type ImageDimensions } from './readDimensions.js';

/**
 * HTTP status per rejection reason (`specs/api.md` §5.0.1). These are the
 * statuses used when nothing else in the request was accepted; a guard verdict
 * is otherwise reported per file in `rejected[]` and never fails the request
 * (`specs/api.md` §5.2, REQ-080/081).
 */
const REJECTION_STATUS: Readonly<Record<PixelGuardRejectionCode, number>> = {
  UNSUPPORTED_IMAGE_FORMAT: 415,
  IMAGE_DIMENSIONS_UNSUPPORTED: 400,
  IMAGE_TOO_LARGE_TO_DECODE: 413,
};

/**
 * Messages are owned by TASK-155 and are not invented here beyond the two
 * constraints that are already load-bearing and testable (`A43-M3`,
 * `T-IMG-020`): a memory-related refusal MUST name memory and cite the
 * runbook, and the corrupt/unsupported-file refusal MUST mention NEITHER -
 * telling the owner to up-size the container because their file is truncated
 * is advice that cannot work.
 */
const RUNBOOK = 'docs/runbooks/scale-up-memory.md';

const REJECTION_MESSAGE: Readonly<Record<PixelGuardRejectionCode, string>> = {
  UNSUPPORTED_IMAGE_FORMAT:
    "We couldn't read that file. It may be damaged or in a format we don't support.",
  IMAGE_DIMENSIONS_UNSUPPORTED:
    'That image is outside the size we can read. Each side needs to be between 50 and 16,000 pixels.',
  IMAGE_TOO_LARGE_TO_DECODE: `That image has too many pixels to open in the memory we have. See ${RUNBOOK}.`,
};

export interface DecodeGuardResult extends ImageDimensions {
  readonly megapixels: number;
}

/**
 * Evaluate the guard without throwing - the shape a per-file loop wants, since
 * one image's refusal must never fail the batch (REQ-080/081).
 *
 * `env` is a parameter so a test can vary `NEXTUP_MAX_DECODE_PIXELS` without
 * mutating the process, and so the request-time read is visible in the
 * signature rather than hidden in a module constant.
 */
export function inspectDecodable(
  header: Uint8Array,
  env: NodeJS.ProcessEnv = process.env,
): PixelGuardVerdict {
  return evaluatePixelGuard(readDimensions(header), maxDecodePixels(env));
}

/**
 * Reject an image the container cannot safely decode, BEFORE any decoder is
 * constructed. Returns the header-declared dimensions when the image passes.
 *
 * Throws `AppError` rather than returning a verdict so that a caller cannot
 * proceed to decode by ignoring a return value - the failure mode this guards
 * against is a call site that runs the guard and then decodes anyway.
 */
export function assertDecodable(
  header: Uint8Array,
  env: NodeJS.ProcessEnv = process.env,
): DecodeGuardResult {
  const verdict = inspectDecodable(header, env);
  if (verdict.ok) {
    return { width: verdict.width, height: verdict.height, megapixels: verdict.megapixels };
  }
  throw new AppError(
    verdict.code,
    REJECTION_STATUS[verdict.code],
    REJECTION_MESSAGE[verdict.code],
    {
      ...(verdict.width === undefined ? {} : { width: verdict.width }),
      ...(verdict.height === undefined ? {} : { height: verdict.height }),
      ...(verdict.megapixels === undefined ? {} : { megapixels: verdict.megapixels }),
      maxMegapixels: verdict.maxMegapixels,
    },
  );
}
