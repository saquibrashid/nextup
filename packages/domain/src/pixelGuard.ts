/**
 * The pre-decode pixel guard - the pure half (`specs/api.md` §5.0.1, TASK-145).
 *
 * WHY THIS EXISTS. The container runs at 0.25 vCPU / 0.5 GiB. A legal ~10 MiB
 * HEIC can declare 48 megapixels and decode to ~160-195 MB of raw RGBA, and
 * up to roughly two thirds of a gibibyte once the WASM copy and the PNG encode
 * buffer are counted. That kills the process. The guard's entire value is that
 * it decides BEFORE any decoder is constructed and before any raster is
 * allocated (`specs/api.md` §5.0; `T-IMG-017` asserts it with a decoder double
 * that throws if invoked).
 *
 * ⚠ A BYTE CEILING IS NOT A SUBSTITUTE FOR THIS AND MUST NOT BE IMPLEMENTED
 * AS ONE (REQ-079). HEIC's compression ratio varies wildly, so bytes do not
 * predict raster size - a 6 MiB file can be 48 MP. A byte guard passes exactly
 * the file that kills the container. The byte ceiling is retained upstream as
 * a cheap first filter only.
 *
 * This module is pure and does no I/O so that the decision table can be tested
 * exhaustively without a container, a fixture or a decoder. Reading the
 * dimensions out of a container header is the other half and lives in
 * `apps/api/src/images/readDimensions.ts`.
 */

/**
 * The default pixel budget, and the value that is correct for the container
 * size the project actually runs (`specs/api.md` §5.0.2).
 *
 * ⚠ THIS VALUE AND THE CONTAINER MEMORY ARE ONE SETTING IN TWO PLACES
 * (REQ-079). The only permitted pairs are (0.25 vCPU, 0.5 GiB, 25000000) and
 * (0.5 vCPU, 1.0 GiB, 50000000). Raising the guard on a small container is
 * strictly worse than not up-sizing at all: it removes the crash protection
 * while adding no capacity. `T-INFRA-005` fails CI on any other combination.
 *
 * The honest, disclosed cost of 25 MP: 48 MP iPhone Pro captures ARE refused.
 * Cleanly, with a named reason and a one-command remedy - but refused.
 */
export const DEFAULT_MAX_DECODE_PIXELS = 25_000_000;

/**
 * The Azure AI Vision Read 4.0 axis bounds. An image outside these could not
 * be extracted even if it decoded, so refusing it early is the more actionable
 * answer than refusing it for size.
 */
export const MIN_IMAGE_AXIS_PX = 50;
export const MAX_IMAGE_AXIS_PX = 16_000;

export type PixelGuardRejectionCode =
  'IMAGE_TOO_LARGE_TO_DECODE' | 'IMAGE_DIMENSIONS_UNSUPPORTED' | 'UNSUPPORTED_IMAGE_FORMAT';

export type PixelGuardVerdict =
  | {
      readonly ok: true;
      readonly width: number;
      readonly height: number;
      readonly megapixels: number;
    }
  | {
      readonly ok: false;
      readonly code: PixelGuardRejectionCode;
      readonly width?: number;
      readonly height?: number;
      readonly megapixels?: number;
      readonly maxMegapixels: number;
    };

/**
 * Decide accept or reject from header-declared dimensions alone.
 *
 * `dims === null` means the header could not be parsed. That is a REJECTION,
 * never a fallthrough to "decode and find out" - decoding to discover the size
 * is precisely the allocation this guard exists to prevent.
 *
 * ⚠ THE CONDITION ORDER IS PART OF THE CONTRACT (`specs/api.md` §5.0.1). An
 * image that is both out of axis bounds and over the pixel budget must report
 * the AXIS bound, because that is the more actionable message: up-sizing the
 * container would not help it, and telling the owner to up-size would be
 * advice that cannot work.
 */
export function evaluatePixelGuard(
  dims: { readonly width: number; readonly height: number } | null,
  maxDecodePixels: number,
): PixelGuardVerdict {
  const maxMegapixels = maxDecodePixels;

  if (dims === null) {
    return { ok: false, code: 'UNSUPPORTED_IMAGE_FORMAT', maxMegapixels };
  }

  const { width, height } = dims;
  const megapixels = width * height;

  if (
    width < MIN_IMAGE_AXIS_PX ||
    height < MIN_IMAGE_AXIS_PX ||
    width > MAX_IMAGE_AXIS_PX ||
    height > MAX_IMAGE_AXIS_PX
  ) {
    return {
      ok: false,
      code: 'IMAGE_DIMENSIONS_UNSUPPORTED',
      width,
      height,
      megapixels,
      maxMegapixels,
    };
  }

  if (megapixels > maxDecodePixels) {
    return {
      ok: false,
      code: 'IMAGE_TOO_LARGE_TO_DECODE',
      width,
      height,
      megapixels,
      maxMegapixels,
    };
  }

  return { ok: true, width, height, megapixels };
}
