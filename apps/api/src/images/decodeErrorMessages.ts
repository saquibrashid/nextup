/**
 * The exact surfaced text for the three decode refusals — `api.md` §5.2.4,
 * verbatim from ADR-0008 R2.3, with the live values interpolated (TASK-155,
 * `A43-M3`, `T-IMG-020` / `T-UI-013`).
 *
 * ⚠ THIS IS SPECIFIED TEXT, NOT UX POLISH. `RSK-016`'s complaint was never
 * "it runs out of memory" — it was "the failure is undiagnosable". Shortening,
 * re-wording or genericising any of these strings re-opens the risk the owner
 * paid for this containment to close.
 *
 * ⚠ EVERY NUMBER HERE IS READ AT CALL TIME FROM THE LIVE CONFIGURATION.
 * Hard-coding "0.5 GiB" or "25.0 MP" would make the message lie the moment the
 * container is up-sized — telling the owner to buy memory they already bought.
 * That is why `containerMemoryGiB` and `maxDecodePixels` are both functions of
 * `env`, and why this module takes an `env` rather than importing constants.
 *
 * ⚠ THE THREE MESSAGES ARE DELIBERATELY NOT TEMPLATED FROM ONE SHARED BODY.
 * `IMAGE_DECODE_FAILED` must mention NEITHER memory NOR the up-size, because
 * more memory can never fix a truncated file and offering the remedy sends the
 * owner to spend money on the wrong problem (`api.md` §5.2.3). A shared
 * template is one careless edit away from leaking the memory sentence into the
 * corrupt-file path, and the only thing that would notice is a negative
 * assertion. Keeping them separate makes that edit impossible rather than
 * merely detectable.
 */

import {
  MEMORY_RUNBOOK_PATH,
  UPSIZE_REMEDY,
  containerMemoryGiB,
  maxDecodePixels,
} from '../config.js';

export interface GuardRejectionFacts {
  readonly fileName: string;
  /** MEGApixels, not pixels. See the warning below. */
  readonly megapixels: number;
  readonly width: number;
  readonly height: number;
  /** MEGApixels, not pixels. */
  readonly maxMegapixels: number;
}

/**
 * ⚠ MEGApixels, ALWAYS TO ONE DECIMAL PLACE, NEVER THE RAW PIXEL COUNT.
 * `specs/testing.md` §28.3(a): a field holding pixels renders
 * "25000000.0 MP", which compiles, type-checks and satisfies every comparison
 * while being unreadable to the only person who will ever see it.
 */
function mp(megapixels: number): string {
  return `${megapixels.toFixed(1)} MP`;
}

/** `0.5` → `"0.5"`, `1` → `"1.0"` — the GiB figure never renders bare. */
function giB(memoryGiB: number): string {
  return `${memoryGiB.toFixed(1)} GiB`;
}

/**
 * `IMAGE_TOO_LARGE_TO_DECODE` — the pre-decode guard refused the file. Nothing
 * was allocated, nothing was stored, and the remedy is a re-attach after an
 * up-size (`api.md` §5.2.5).
 */
export function imageTooLargeToDecodeMessage(
  facts: GuardRejectionFacts,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    `${facts.fileName} is ${mp(facts.megapixels)} (${String(facts.width)} × ${String(facts.height)}). ` +
    `nextup decodes images in a ${giB(containerMemoryGiB(env))} container and refuses anything above ` +
    `${mp(facts.maxMegapixels)} before allocating memory, because decoding this one would exhaust ` +
    'container memory and kill the import. This is a memory limit, not a problem with your image. ' +
    `Remedy: up-size compute to ${UPSIZE_REMEDY} — one command, see ${MEMORY_RUNBOOK_PATH}. ` +
    'No other image in this batch was affected; re-attach this file after up-sizing.'
  );
}

/**
 * `IMAGE_DECODE_OOM` — the decoder was entered and ran out of memory (the
 * catchable WASM path, P1). A 503: the request failed for a reason on our side
 * that a retry after up-sizing resolves.
 */
export function imageDecodeOomMessage(
  fileName: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    `${fileName} ran out of memory while being decoded (HEIC → PNG) in the ` +
    `${giB(containerMemoryGiB(env))} container. This is a memory limit, not a corrupt file. ` +
    `Remedy: up-size compute to ${UPSIZE_REMEDY} — ${MEMORY_RUNBOOK_PATH}. ` +
    'Only this image failed; the rest of the batch is intact and nothing has been committed. ' +
    'Re-attach this file after up-sizing.'
  );
}

/**
 * `IMAGE_DECODE_FAILED` — a corrupt or truncated file.
 *
 * ⚠ MENTIONS NEITHER MEMORY NOR THE UP-SIZE NOR THE RUNBOOK, AND MUST NOT.
 * This function takes no `env` for exactly that reason: there is no live
 * configuration value it could legitimately want, so the absence of the
 * parameter is a structural guarantee rather than a convention.
 */
export function imageDecodeFailedMessage(fileName: string): string {
  return (
    `${fileName} couldn't be read — the file appears to be corrupt or incomplete. ` +
    'Try re-exporting or re-taking the screenshot and attaching it again. ' +
    'Only this image failed; the rest of the batch is intact.'
  );
}

/**
 * Re-compose a decode `AppError`'s message now that the file name is known.
 *
 * ⚠ THE FILE NAME IS THE REASON THIS EXISTS. `assertDecodable` and
 * `transcodeHeicToPng` are both given bytes, not a name — deliberately, since
 * neither should care where the bytes came from — so neither can build a
 * message that names the file. `ui.md` §3.2a item 1 requires the name, because
 * a batch may hold 40 images and "an image was too large" is not actionable.
 * Composing here, at the one layer that knows both the name and the error, is
 * what `runExtraction.spec.ts` calls "the layer that composes the wording".
 *
 * Returns `undefined` for any code this module does not own, so the caller
 * keeps the original message rather than inventing one.
 */
export function decodeErrorMessageFor(
  code: string,
  fileName: string,
  details: Readonly<Record<string, unknown>> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (code === 'IMAGE_DECODE_OOM') return imageDecodeOomMessage(fileName, env);
  if (code === 'IMAGE_DECODE_FAILED') return imageDecodeFailedMessage(fileName);
  if (code !== 'IMAGE_TOO_LARGE_TO_DECODE') return undefined;

  // Reached when the guard fires from INSIDE `transcodeHeicToPng`, whose
  // `assertDecodable` call is a second, module-local guarantee rather than a
  // duplicate of the caller's. `details` then carries the dimensions.
  const width = numeric(details?.['width']);
  const height = numeric(details?.['height']);
  const megapixels = numeric(details?.['megapixels']);
  const maxMegapixels = numeric(details?.['maxMegapixels']) ?? maxDecodePixels(env) / 1_000_000;
  if (width === undefined || height === undefined || megapixels === undefined) return undefined;

  return imageTooLargeToDecodeMessage({ fileName, width, height, megapixels, maxMegapixels }, env);
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
