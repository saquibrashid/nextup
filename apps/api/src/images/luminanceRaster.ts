import sharp from 'sharp';

import type { LuminanceRaster } from '@nextup/domain';

/**
 * Downsampled greyscale raster for `detectTileGrid`.
 *
 * ⚠ THE ONLY IMPURE HALF OF TILE-GRID DETECTION. Everything that decides
 * anything lives in `packages/domain/src/extraction/tileGrid.ts`; this file
 * exists purely so that `sharp` does not have to. Keeping the split means the
 * whole golden corpus can be swept on every commit (`T-AI-061`) against the
 * same code production runs.
 *
 * ⚠ ASPECT RATIO IS DELIBERATELY NOT PRESERVED. `fit: 'fill'` with a width
 * alone leaves the height untouched, so the two axes are scaled
 * independently. That is harmless and intended: every coordinate the detector
 * returns is a FRACTION of the raster's own width or height, and an
 * independent linear scale per axis leaves fractions unchanged. Forcing a
 * proportional resize would only cost detail on the axis that carries the
 * signal.
 *
 * ⚠ The fixed working width is what makes `MIN_PERIOD_PX` and the measured
 * `gutterScore` thresholds mean the same thing for a phone screenshot and a
 * 4K desktop capture. Do not make it a function of the source size.
 */
export const WORKING_WIDTH = 1000;

/**
 * ⚠ Reads the image header only to resize; it does NOT repeat the pre-decode
 * pixel guard. Callers must already have passed `decodeGuard` (REQ-079) -
 * this runs on an image the pipeline has accepted, never on raw upload input.
 */
export async function luminanceRasterFrom(image: Buffer): Promise<LuminanceRaster> {
  const { data, info } = await sharp(image)
    .greyscale()
    .resize({ width: WORKING_WIDTH, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}
