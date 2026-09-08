/**
 * `POST /api/batches` — start a capture batch (`specs/api.md` §6.11, TASK-048).
 *
 * US-003: the owner names exactly ONE service and exactly ONE mode, and the
 * server answers with the plain-language consequence of that choice.
 *
 * Two things here are safety properties rather than validation niceties:
 *
 *   1. **There is no default mode** (US-003 AC-1). Omitting `mode` is a 400,
 *      never an implied `append-only`. Defaulting would be the friendlier
 *      behaviour and the wrong one: the two modes differ in whether titles get
 *      REMOVED, so a default silently picks a destructive-or-not outcome on
 *      the owner's behalf. Same for `service`.
 *   2. **One open batch per owner** (`specs/api.md` §5, US-005 AC-5). A
 *      full-update batch reconciles a whole service against the list in one
 *      transaction (product invariant 3); two open batches could interleave
 *      and reconcile against each other's half-applied state.
 *   3. **A discovery source is structurally append-only** (ADR-0010 D-2,
 *      REQ-083). `full-update` is REFUSED HERE, at the boundary — not hidden
 *      in the UI, and not decided from a client-supplied flag. A rotating
 *      editorial feed reconciled as a full update proposes the owner's entire
 *      waiting list for removal on the second capture, every time, so a caller
 *      posting the request directly must be refused just as firmly as the SPA.
 *      `T-WAIT-001c` is the case that fails a UI-only guard.
 *
 * ⚠ `source` NAMES EITHER KIND OF ORIGIN, AND `service` IS THE LEGACY ALIAS.
 * A service batch and a discovery batch are the same shape at this endpoint;
 * they differ in which of the two exclusive columns gets written
 * (`splitBatchSource`). `SERVICES` is NOT widened — see ADR-0010 D-1.
 *
 * The batch is created in `draft`: images are attached afterwards
 * (§6.12) and nothing touches the owner's list until close (§6.22).
 */

import { type Router } from 'express';
import {
  BATCH_MODES,
  BATCH_SOURCES,
  discoveryModeExplanation,
  forcedModeFor,
  modeExplanation,
  modeRefusalFor,
  splitBatchSource,
  ulid,
  type BatchMode,
  type BatchSource,
} from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import { discardBatch, submitBatch } from '../services/batchLifecycle.js';
import { reextractBatch } from '../services/batchReextract.js';
import { beginExtraction } from '../jobs/startExtraction.js';
import { createUploadBatch, findOpenUploadBatch } from '../repository/ownerData.js';

/** The status every batch starts in. Images attach to a draft; nothing applies. */
export const INITIAL_BATCH_STATUS = 'draft';

interface CreateBatchBody {
  service?: unknown;
  source?: unknown;
  mode?: unknown;
}

/**
 * Validates one enumerated field.
 *
 * Reports the field name and the permitted values, because the client that
 * gets this is the SPA and the developer reading it is the one who mistyped
 * the value. It does NOT echo the received value back into the message: that
 * string came from the request and the error envelope is not the place to
 * discover reflection.
 */
function requireEnum<T extends string>(value: unknown, field: string, permitted: readonly T[]): T {
  if (typeof value !== 'string' || !(permitted as readonly string[]).includes(value)) {
    throw new AppError('VALIDATION_FAILED', 400, `"${field}" is required.`, {
      field,
      permitted: [...permitted],
    });
  }
  return value as T;
}

export function registerBatchRoutes(router: Router): void {
  router.post('/batches', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const body = (req.body ?? {}) as CreateBatchBody;

    // Validated BEFORE the open-batch lookup so a malformed request is a 400
    // regardless of what else the owner has in flight. Reversing these would
    // make the same bad request return 400 or 409 depending on unrelated
    // state, which is untestable and unhelpful.
    //
    // ⚠ `service` remains accepted as the field name so every existing client
    // and test keeps working; `source` is the name that can also carry a
    // discovery source. They are the same field, validated once against
    // `BATCH_SOURCES`.
    //
    // ⚠ THE ERROR STILL NAMES `service`, DELIBERATELY. That is the field
    // `specs/api.md` §6.11 documents and the one `T-BATCH-010i`/`j` assert on.
    // Epic L needs this endpoint to ACCEPT a discovery source; renaming the
    // field it reports would be unrequested churn in a documented contract.
    const rawSource = body.source ?? body.service;
    const source = requireEnum<BatchSource>(rawSource, 'service', BATCH_SOURCES);
    const mode = requireEnum<BatchMode>(body.mode, 'mode', BATCH_MODES);

    // ⚠ REFUSED BY SOURCE TYPE, NEVER BY A CLIENT-SUPPLIED FLAG (ADR-0010 D-2,
    // `T-WAIT-001b`/`c`). This runs before the open-batch lookup for the same
    // reason the validation above does, and it is a REFUSAL rather than a
    // silent coercion to append-only: quietly "fixing" the mode would tell the
    // owner their full update succeeded while it did something else.
    const refusal = modeRefusalFor(source, mode);
    if (refusal !== null) {
      throw new AppError('FULL_UPDATE_NOT_AVAILABLE_FOR_SOURCE', 400, refusal, {
        source,
        permittedModes: [forcedModeFor(source)],
      });
    }

    const { service, discoverySource } = splitBatchSource(source);

    const open = await findOpenUploadBatch(ownerId);
    if (open) {
      // `details.batchId` is required by §6.11: the client uses it to offer
      // "resume" or "discard" rather than a dead end. The service and mode go
      // with it so the UI can name the batch without a second round trip.
      throw new AppError(
        'OPEN_BATCH_EXISTS',
        409,
        'You already have a batch in progress. Finish or discard it before starting another.',
        { batchId: open.id, service: open.service, mode: open.mode, status: open.status },
      );
    }

    const batch = await createUploadBatch(ownerId, {
      id: ulid(),
      service,
      discoverySource,
      mode,
      status: INITIAL_BATCH_STATUS,
    });

    res.status(201).json({
      batchId: batch.id,
      service,
      discoverySource,
      mode: batch.mode,
      status: batch.status,
      createdAt: batch.createdAt.toISOString(),
      // Server-supplied so the consequence has ONE wording wherever it is
      // shown (US-003 AC-2/AC-3). Do not re-type this sentence in the SPA.
      //
      // ⚠ Rendered from the VALIDATED locals, not from the row read back. The
      // stored columns widen to `string | null` through Prisma, and re-narrowing
      // them here would be a cast asserting exactly what this handler already
      // proved a few lines above.
      modeExplanation:
        service !== null
          ? modeExplanation(mode, service)
          : discoveryModeExplanation(discoverySource),
    });
  });

  // §6.14. **202, not 200**: extraction runs in-process and asynchronously,
  // and the client polls `GET /api/batches/:batchId` (US-006 AC-1). A 200
  // would tell the SPA the work is finished, and the review pass would be
  // requested against a batch with no candidates in it yet.
  router.post('/batches/:batchId/submit', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const batchId = req.params.batchId ?? '';
    const result = await submitBatch(ownerId, batchId);
    res.status(202).json(result);

    // ⚠ FIRE-AND-FORGET, AND DELIBERATELY AFTER THE RESPONSE. Awaiting it
    // would turn the 202 into a synchronous wait of up to fifteen minutes and
    // make the "client polls" contract above a lie. `beginExtraction` neither
    // awaits nor rejects; it only records the promise so a test can await
    // the settled state instead of racing it.
    beginExtraction(ownerId, batchId);
  });

  // §6.24. **202, not 201**: like submit, extraction runs asynchronously and
  // the client polls the DERIVED batch id. See `services/batchReextract.ts`
  // for why this creates a new batch rather than re-running the old one.
  router.post('/batches/:batchId/re-extract', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const result = await reextractBatch(ownerId, req.params.batchId ?? '');
    res.status(202).json(result);

    // Fire-and-forget after the response, for the same reason as submit above.
    beginExtraction(ownerId, result.batchId);
  });

  // §6.23. 200 with `listStateChanged: false` — the SPA states plainly that
  // nothing was lost from the list, which is the whole reassurance US-005 AC-4
  // is asking for. Images are retained; NFR-019's purge governs them.
  router.post('/batches/:batchId/discard', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const result = await discardBatch(ownerId, req.params.batchId ?? '');
    res.status(200).json(result);
  });
}
