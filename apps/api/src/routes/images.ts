/**
 * `GET /api/images/:imageId` — the ONLY way screenshot bytes are ever served
 * (`specs/api.md` §6.27, US-036, NFR-020, ADR-0006, TASK-052).
 *
 * ⚠ THE POINT OF THIS ROUTE IS THAT NOTHING ELSE EXISTS. There is no SAS
 * token, no blob URL and no public container anywhere in the system
 * (US-036 AC-2/AC-4, `T-SEC-003`). `blobPath` is resolved server-side from the
 * row and never leaves the process, so every read of an image is a read that
 * passed `requirePrincipal → requireAllowList → attachOwnerScope` first. Hand
 * a client a URL to the blob once and that whole chain is bypassed for as long
 * as the URL survives in someone's history.
 *
 * ⚠ THREE DIFFERENT ABSENCES, TWO DIFFERENT ANSWERS, AND NEITHER IS A 500.
 *
 *   | Condition                          | Answer                          |
 *   |------------------------------------|---------------------------------|
 *   | no row for this owner              | 404 — indistinguishable from a  |
 *   |                                    | row belonging to somebody else  |
 *   |                                    | (US-036 AC-3)                   |
 *   | `retainUntil` reached              | 410 `IMAGE_EXPIRED`             |
 *   | row present, blob gone             | 410 `IMAGE_EXPIRED`             |
 *
 * The last one is the subtle one (`T-IMG-005`, ADR-0006). The 30-day purge is
 * an **Azure Blob Storage lifecycle rule** — no application code participates
 * in it, and nothing writes back to the row when it fires. So the NORMAL
 * steady state of a purged screenshot is a live `uploadedImage` row pointing
 * at bytes that are gone (the row survives forever, REQ-028: it is the record
 * that a capture happened). Treating that as a 500 would turn the product's
 * designed behaviour into an error page, and would fire an alert every day
 * from day 31 onward.
 *
 * The two conditions are deliberately given the SAME code and the same
 * sentence: from the owner's side they are one event — the screenshot aged out
 * — and the clock skew between "the row says it is due" and "the rule has
 * actually run" is an implementation detail they should never have to think
 * about.
 */

import { type Router } from 'express';

import { IMAGE_RETENTION_DAYS } from '../config.js';
import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import { findUploadedImageById } from '../repository/ownerData.js';
import { azureImageBlobStore, contentTypeFor, type ImageBlobStore } from '../storage/blobStore.js';
import type { ImageFormat } from '@nextup/domain';

/** The stored formats this route can serve. HEIC/HEIF was transcoded away. */
const SERVABLE_FORMATS = new Set<string>(['png', 'jpeg']);

/**
 * Headers mandated by `specs/api.md` §6.27, asserted by `T-IMG-002`.
 *
 * `no-store` rather than `no-cache`: `no-cache` still WRITES the bytes to disk
 * and merely revalidates before reuse, which leaves a screenshot of the
 * owner's watchlist sitting in the browser cache long after the 30-day purge
 * has removed it from Azure. That would quietly defeat NFR-019.
 *
 * `nosniff` and `inline` are the pair that stops a browser from deciding for
 * itself what these bytes are; without `nosniff` a crafted upload could be
 * re-interpreted as HTML and executed on our own origin.
 */
export const IMAGE_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Disposition': 'inline',
});

/** The one sentence the owner sees when a screenshot has aged out. */
export const IMAGE_EXPIRED_MESSAGE = `This screenshot was removed ${String(IMAGE_RETENTION_DAYS)} days after upload.`;

/**
 * Has this image reached its retention horizon?
 *
 * `<=`, not `<`: US-035 AC-1 is "**at** `retainUntil`, bytes are unavailable"
 * (`T-IMG-004`). Exported so the boundary is asserted directly rather than
 * inferred from a request whose own clock the test cannot pin.
 */
export function isExpired(retainUntil: Date, now: Date): boolean {
  return retainUntil.getTime() <= now.getTime();
}

export function registerImageRoutes(
  router: Router,
  store: ImageBlobStore = azureImageBlobStore,
): void {
  router.get('/images/:imageId', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const imageId = req.params.imageId ?? '';

    const image = await findUploadedImageById(ownerId, imageId);
    if (image === null) {
      throw new AppError('NOT_FOUND', 404, 'No such image.');
    }

    // Checked BEFORE the blob is fetched, so an expired image never costs a
    // storage round trip — and so the answer does not depend on how promptly
    // the lifecycle rule happened to run.
    if (isExpired(image.retainUntil, new Date())) {
      throw new AppError('IMAGE_EXPIRED', 410, IMAGE_EXPIRED_MESSAGE, {
        retainUntil: image.retainUntil.toISOString(),
      });
    }

    if (!SERVABLE_FORMATS.has(image.format)) {
      // Unreachable through ingest — the transcode guarantees png/jpeg — but a
      // row that says otherwise must not be streamed under a guessed content
      // type. `nosniff` would then leave the browser with bytes it refuses to
      // render and no explanation.
      throw new AppError('INTERNAL_ERROR', 500, 'That screenshot cannot be displayed.');
    }

    const bytes = await store.get(image.blobPath);
    if (bytes === null) {
      throw new AppError('IMAGE_EXPIRED', 410, IMAGE_EXPIRED_MESSAGE, {
        retainUntil: image.retainUntil.toISOString(),
      });
    }

    res.set(IMAGE_RESPONSE_HEADERS);
    res.type(contentTypeFor(image.format as ImageFormat));
    res.set('Content-Length', String(bytes.byteLength));
    // `res.end`, not `res.send`: `send` would re-derive `Content-Length`, add a
    // weak `ETag` and invite a conditional request for bytes we have just said
    // must not be stored.
    res.end(Buffer.from(bytes));
  });
}
