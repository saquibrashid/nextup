/**
 * The decode sentinel's event NAMES (TASK-157, `A43-M5`, `specs/api.md` §9.1).
 *
 * ⚠ THESE STRINGS ARE AN INTERFACE, NOT AN IMPLEMENTATION DETAIL. They are
 * matched verbatim by the `nextup-prod-decode-abandoned` log-search alert in
 * `infra/alerts.bicep`. Renaming one here without changing the alert query
 * disables the alert SILENTLY — the app keeps logging, the rule keeps running,
 * and it simply never matches again. `T-INFRA-012` greps the compiled alert
 * template for these exact literals so that failure cannot ship.
 *
 * ⚠ THEY LIVE IN THE DOMAIN, NOT IN `apps/api`, for that reason alone: the
 * infra test must be able to import the one true spelling without importing
 * the API's Node-only surface.
 *
 * ⚠ THIS IS NOT TELEMETRY (`NFR-005`, `T-SEC-009`). No SDK, no third party, no
 * product instrumentation, no user content — two stdout debug lines that name
 * which image was being decoded when the container died. `specs/testing.md`
 * §AC-6 records the collision and why both requirements pass together, so
 * nobody resolves it by deleting the sentinel.
 */

/**
 * Logged immediately before a decode buffer is allocated, and ONLY after the
 * pre-decode pixel guard has passed. A guard rejection allocates nothing and
 * therefore emits no `begin` (`api.md` §9.1 rule 3).
 */
export const IMAGE_DECODE_BEGIN = 'image.decode.begin';

/**
 * Logged from a `finally`, so it is emitted on the success path, on
 * `IMAGE_DECODE_FAILED` and on the CATCHABLE out-of-memory path (P1).
 *
 * ⚠ ITS ABSENCE IS THE SIGNAL. A kernel OOM kill (P2) raises no error to
 * catch and runs no `finally`: the process simply stops. A `begin` with no
 * `end` is then the only record naming the image that killed it, which is why
 * the sentinel is the PRIMARY signal and `RestartCount` is the backstop
 * (`specs/testing.md` §31.6 — Azure Container Apps exposes no OOM-distinct
 * metric at all).
 */
export const IMAGE_DECODE_END = 'image.decode.end';

/**
 * How the decode finished.
 *
 * `oom` is the catchable WASM allocation failure that becomes
 * `IMAGE_DECODE_OOM`; `failed` is any other per-image decode refusal. They are
 * kept apart for the same reason their error codes are: more memory fixes one
 * and can never fix the other.
 */
export type DecodeOutcome = 'ok' | 'oom' | 'failed';

/** The `image.decode.begin` line, exactly as `specs/api.md` §9.1 fixes it. */
export interface ImageDecodeBeginEvent {
  readonly event: typeof IMAGE_DECODE_BEGIN;
  readonly ts: string;
  readonly level: 'info';
  readonly correlationId: string;
  readonly batchId: string;
  /** The join key for `begin` ⇄ `end`. */
  readonly imageId: string;
  /** As uploaded, or the SYNTHESISED name for a pasted image. Never `''`. */
  readonly fileName: string;
  readonly ingestSource: string;
  readonly uploadedFormat: string;
  readonly width: number;
  readonly height: number;
  /** `(width * height) / 1e6`, one decimal place. */
  readonly megapixels: number;
  readonly declaredBytes: number;
  /** The `NEXTUP_MAX_DECODE_PIXELS` in force for THIS request. */
  readonly maxDecodePixels: number;
}

/** The `image.decode.end` line, exactly as `specs/api.md` §9.1 fixes it. */
export interface ImageDecodeEndEvent {
  readonly event: typeof IMAGE_DECODE_END;
  readonly ts: string;
  readonly level: 'info' | 'error';
  readonly correlationId: string;
  readonly batchId: string;
  /** MUST equal the matching `begin` line's `imageId`. */
  readonly imageId: string;
  readonly outcome: DecodeOutcome;
  readonly durationMs: number;
  readonly peakRssBytes: number;
  /** The error CLASS only — never a message, never a stack. */
  readonly errorName?: string;
}

export type ImageDecodeEvent = ImageDecodeBeginEvent | ImageDecodeEndEvent;
