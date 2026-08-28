/**
 * `/batches/:batchId` — extraction status (`specs/ux-states.md` §5, US-006,
 * TASK-059, `T-UX-007` / `T-UX-008`).
 *
 * ⚠ **THIS IS A PRIMARY SURFACE, NOT A SPINNER.** LLM vision latency makes it
 * visible for *minutes* (`ADR-0001`), so the owner sits here watching. That is
 * why §5 specifies nine distinct states with their own copy, why progress is
 * per-image rather than indeterminate, and why `T-UX-007` says "renders
 * per-image progress and per-image failure states **without navigating
 * away**". A spinner would be the natural, wrong implementation.
 *
 * ⚠ **THE DEGRADED BANNER IS AN EXPLANATION THE OWNER CANNOT DO WITHOUT
 * (`T-UX-008`).** Whenever it shows, full-update removals were withheld
 * entirely (product invariant 2, `specs/ai.md` §2.2) — so a banner that
 * silently fails to render leaves the owner staring at a review screen with no
 * removal section and no reason given. It is imported from the domain, not
 * written here, because `ux-states.md` §5.9 requires the SAME banner on this
 * page and on review, and one string is the only way that stays true.
 *
 * ⚠ **AN ERROR AND A DEGRADED READ ARE NOT THE SAME EVENT (§5 R2 note).**
 * `EXTRACTOR_ERROR` / `EXTRACTOR_UNAVAILABLE` now mean **both** readers failed
 * and the batch is dead. A *single* reader failing is §5.9/§5.10: the batch
 * **completes**, and rendering it as an error would throw away a good read.
 *
 * ⚠ **NO POLLING LIVES HERE.** `T-UX-007`/`T-UX-008` are level `C` component
 * tests, `GET /api/batches/:batchId` is not implemented yet (see the ledger),
 * and every other page in this app (`ReviewPage`, `RemovedPage`,
 * `SuppressedPage`) is props-driven with the fetching in a container. The
 * poll interval, its pause on `offline`, and §5.4's auto-navigation are the
 * container's job; this file renders a state and nothing else.
 */

import type { JSX } from 'react';

import { DEGRADED_EXTRACTION_BANNER } from '@nextup/domain';

import {
  STATUS_CONTINUE_LABEL,
  STATUS_DISCARD_BATCH_LABEL,
  STATUS_DISCARD_LABEL,
  STATUS_ERROR_EXTRACTOR,
  STATUS_ERROR_PURGED,
  STATUS_ERROR_UNAVAILABLE,
  STATUS_OFFLINE,
  STATUS_PURGED_ACTION_LABEL,
  STATUS_QUEUED,
  STATUS_RETRY_LABEL,
  STATUS_RUNNING,
  STATUS_TITLE,
  STATUS_ZERO_YIELD,
} from '../copy';
import type { BatchImage, BatchStatus } from '../lib/apiClient';

export interface BatchStatusPageProps {
  readonly batch?: BatchStatus | null;
  readonly loadFailed?: boolean;
  readonly offline?: boolean;
  readonly onDiscard?: () => void;
  readonly onRetry?: () => void;
  readonly onContinue?: () => void;
  readonly onUploadNew?: () => void;
}

/**
 * §5.1 vs §5.2 — the headline, and which one depends on `status`, never on
 * whether `imagesDone` is zero.
 *
 * ⚠ A batch can legitimately be `extracting` with nothing finished yet, and
 * inferring "queued" from `imagesDone === 0` would show the owner a stalled
 * queue while the extractor is in fact running.
 */
export function statusHeadline(batch: BatchStatus): string | null {
  const progress = batch.progress;
  if (progress === undefined) {
    return null;
  }
  const template = batch.status === 'submitted' ? STATUS_QUEUED : STATUS_RUNNING;
  return template
    .replace('{done}', String(progress.imagesDone))
    .replace('{total}', String(progress.imagesTotal));
}

/**
 * §5.9/§5.10 — is either reading leg missing?
 *
 * ⚠ **BOTH `crossCheck` values count**, not just the severe one. §5.10 (the
 * cross-check reader down) says "same banner wording, milder consequence", so
 * treating `ocr-unavailable` as healthy would hide from the owner that this
 * read was uncorroborated. `degradedExtraction` is accepted as well because
 * the review response (§6.17) reports the same condition under that name.
 */
export function isDegraded(batch: BatchStatus): boolean {
  return (
    batch.degradedExtraction === true ||
    batch.crossCheck === 'llm-unavailable' ||
    batch.crossCheck === 'ocr-unavailable'
  );
}

/**
 * §5.3 — the images that produced nothing.
 *
 * ⚠ `candidateCount === null` means **not yet read**, and an image still in
 * flight is not a zero-yield image. Coercing null to zero would accuse every
 * unprocessed screenshot of being unreadable while the batch is still running.
 */
export function zeroYieldImages(images: readonly BatchImage[]): BatchImage[] {
  return images.filter((image) => image.candidateCount === 0);
}

function ImageTile({ image }: { image: BatchImage }): JSX.Element {
  // ⚠ NAMED as well as thumbnailed (US-006 AC-3). A thumbnail alone is not
  // enough to find the file again in a camera roll of near-identical
  // screenshots, which is the action this state exists to enable.
  return (
    <li className="batch-status__image" data-testid="batch-status-image">
      {image.available ? (
        <img
          className="batch-status__thumb"
          src={image.href}
          alt=""
          data-testid="batch-status-thumb"
        />
      ) : (
        <div
          className="batch-status__thumb batch-status__thumb--missing"
          data-testid="batch-status-thumb-missing"
        />
      )}
      <span className="batch-status__filename" data-testid="batch-status-filename">
        {image.fileName}
      </span>
      {image.candidateCount !== null && (
        <span className="batch-status__count" data-testid="batch-status-count">
          {image.candidateCount}
        </span>
      )}
    </li>
  );
}

function ExtractionError({
  code,
  onRetry,
  onDiscard,
  onUploadNew,
}: {
  code: string;
  onRetry?: () => void;
  onDiscard?: () => void;
  onUploadNew?: () => void;
}): JSX.Element {
  if (code === 'IMAGES_PURGED') {
    // ⚠ NO RETRY. The blobs are gone under the 30-day purge (NFR-019), so a
    // retry here could only ever fail again; offering one would send the
    // owner around a loop that cannot terminate.
    return (
      <div role="alert" data-testid="batch-status-error">
        <p data-testid="batch-status-error-message">{STATUS_ERROR_PURGED}</p>
        {onUploadNew !== undefined && (
          <button type="button" className="tap-target" onClick={onUploadNew}>
            {STATUS_PURGED_ACTION_LABEL}
          </button>
        )}
      </div>
    );
  }

  const unavailable = code === 'EXTRACTOR_UNAVAILABLE';
  return (
    <div role="alert" data-testid="batch-status-error">
      <p data-testid="batch-status-error-message">
        {unavailable ? STATUS_ERROR_UNAVAILABLE : STATUS_ERROR_EXTRACTOR}
      </p>
      <div className="batch-status__actions">
        {onRetry !== undefined && (
          <button type="button" className="tap-target" onClick={onRetry}>
            {STATUS_RETRY_LABEL}
          </button>
        )}
        {/* §5.5 offers Discard batch as well as Try again (US-006 AC-4/AC-6);
            §5.6 is transient — the service is merely busy, the batch is still
            good, and offering to destroy it there would be wrong. */}
        {!unavailable && onDiscard !== undefined && (
          <button type="button" className="tap-target" onClick={onDiscard}>
            {STATUS_DISCARD_BATCH_LABEL}
          </button>
        )}
      </div>
    </div>
  );
}

export function BatchStatusPage({
  batch = null,
  loadFailed = false,
  offline = false,
  onDiscard,
  onRetry,
  onContinue,
  onUploadNew,
}: BatchStatusPageProps): JSX.Element {
  if (loadFailed || batch === null) {
    return (
      <>
        <h1>{STATUS_TITLE}</h1>
        {loadFailed ? (
          <div role="alert" data-testid="batch-status-load-error">
            <p>{STATUS_ERROR_EXTRACTOR}</p>
            {onRetry !== undefined && (
              <button type="button" className="tap-target" onClick={onRetry}>
                {STATUS_RETRY_LABEL}
              </button>
            )}
          </div>
        ) : (
          <p role="status" data-testid="batch-status-loading">
            {STATUS_QUEUED.replace('{done}', '0').replace('{total}', '0')}
          </p>
        )}
      </>
    );
  }

  const headline = statusHeadline(batch);
  const zeroYield = zeroYieldImages(batch.images);
  const inProgress = batch.status === 'submitted' || batch.status === 'extracting';

  return (
    <>
      <h1>{STATUS_TITLE}</h1>

      {/* ⚠ ABOVE the error branch, and deliberately so. Offline is not a
          failure of the batch — §5.8 says polling pauses and "no error is
          invented" — so it must be able to show alongside whatever the last
          known state was. */}
      {offline && (
        <p role="status" data-testid="batch-status-offline">
          {STATUS_OFFLINE}
        </p>
      )}

      {/* ⚠ `T-UX-008`. Rendered for a COMPLETED batch too: the read finished,
          and the banner is the only record that it finished one-legged. */}
      {isDegraded(batch) && (
        <p className="batch-status__banner" role="status" data-testid="batch-status-degraded">
          {DEGRADED_EXTRACTION_BANNER}
        </p>
      )}

      {batch.extractionError !== null ? (
        <ExtractionError
          code={batch.extractionError}
          {...(onRetry === undefined ? {} : { onRetry })}
          {...(onDiscard === undefined ? {} : { onDiscard })}
          {...(onUploadNew === undefined ? {} : { onUploadNew })}
        />
      ) : (
        <>
          {headline !== null && (
            <p className="batch-status__progress" role="status" data-testid="batch-status-headline">
              {headline}
            </p>
          )}

          {zeroYield.length > 0 && (
            <p className="batch-status__zero-yield" data-testid="batch-status-zero-yield">
              {STATUS_ZERO_YIELD.replace('{count}', String(zeroYield.length)).replace(
                '{total}',
                String(batch.images.length),
              )}
            </p>
          )}

          <ul className="batch-status__images" data-testid="batch-status-images">
            {batch.images.map((image) => (
              <ImageTile key={image.imageId} image={image} />
            ))}
          </ul>

          <div className="batch-status__actions">
            {inProgress && onDiscard !== undefined && (
              <button type="button" className="tap-target" onClick={onDiscard}>
                {STATUS_DISCARD_LABEL}
              </button>
            )}
            {!inProgress && onContinue !== undefined && (
              <button type="button" className="tap-target" onClick={onContinue}>
                {STATUS_CONTINUE_LABEL}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}
