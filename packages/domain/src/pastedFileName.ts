/**
 * TASK-158 (`A45`) — server-synthesised display/provenance name for an
 * ingested image. `specs/data-model.md` §3.8.1 is normative; `T-PASTE-005`.
 *
 * WHY THIS EXISTS. A clipboard image has no file name.
 * `DataTransfer.files[0].name` is typically `"image.png"` — or empty, or a
 * WebKit placeholder — and `ClipboardItem` supplies no name at all. Three
 * pastes would collide on one meaningless label, in a batch that may hold 40
 * images and whose entire error-reporting model (`api.md` §5.2, `ui.md`
 * §3.2a) works by NAMING the file.
 *
 * ⚠ THIS NAME IS DISPLAY/PROVENANCE ONLY AND MUST NEVER COMPOSE `blobPath`.
 * `blobPath` stays `${ownerId}/${batchId}/${id}.${ext}` from server-generated
 * ULIDs alone, for all three ingest sources (`specs/security.md` T4). A
 * client-supplied name reaching a storage path is a traversal vector; keeping
 * the two concerns in separate functions is what makes that impossible here.
 *
 * ⚠ `ingestSource` MUST NOT BE INFERRED FROM THE PREFIX. The `pasted-` /
 * `dropped-` / `uploaded-` prefixes are display copy and may be re-worded at
 * any time; the `ingestSource` column is the datum. Anything that needs to
 * know how an image arrived reads that column.
 *
 * Pure and deterministic: the clock is injected, there is no `Date.now()` in
 * this file, and there must never be one — `T-PASTE-005` asserts the output
 * for a fixed instant and a `Date.now()` call would make that untestable.
 */

import type { IngestSource, UploadFormat } from './enums.js';

/**
 * Extension per SNIFFED upload format (`apps/api/src/images/sniffFormat.ts`),
 * never the declared MIME type — iOS commonly sends `application/octet-stream`
 * for HEIC, so the declared type is not evidence of anything.
 *
 * ⚠ `jpeg` maps to `.jpg`, NOT `.jpeg`. The format token and the extension are
 * deliberately different strings; a "tidy-up" that makes them agree changes
 * every synthesised JPEG name.
 */
const EXTENSION_BY_FORMAT: Readonly<Record<UploadFormat, string>> = Object.freeze({
  png: 'png',
  jpeg: 'jpg',
  heic: 'heic',
  heif: 'heif',
});

/**
 * Prefix per ingest source. Display copy — see the `ingestSource` warning
 * above before reading anything back out of it.
 */
const PREFIX_BY_SOURCE: Readonly<Record<IngestSource, string>> = Object.freeze({
  paste: 'pasted',
  drop: 'dropped',
  upload: 'uploaded',
});

/**
 * `uploaded_image.file_name` is `NVARCHAR(255)` and the zod schema enforces
 * the same ceiling. A device name longer than that would fail validation or
 * the insert — a real file from a real device, rejected for a reason the owner
 * cannot act on. Truncate instead, preserving the extension so the name still
 * reads as a file.
 */
export const MAX_FILE_NAME_LENGTH = 255;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * `<YYYYMMDD>-<HHMMSS>` from SERVER receipt time in UTC.
 *
 * ⚠ UTC, not local. Every accessor here must be a `getUTC*` one. The local
 * variants would produce a name that differs by host timezone and by daylight
 * saving, so the same paste would be named differently in CI and in
 * production while every synthetic test that happens to run in UTC still
 * passed. `T-PASTE-005f` pins this with a non-UTC instant.
 */
function utcStamp(at: Date): string {
  const date = `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1, 2)}${pad(at.getUTCDate(), 2)}`;
  const time = `${pad(at.getUTCHours(), 2)}${pad(at.getUTCMinutes(), 2)}${pad(at.getUTCSeconds(), 2)}`;
  return `${date}-${time}`;
}

/**
 * The general synthesiser. `synthesisePastedFileName()` below is the
 * spec-named three-argument form for the paste case.
 *
 * Uniqueness within a batch comes from `<NN>` ALONE — `seqInBatch` is assigned
 * server-side in receipt order under the same write that inserts the row, so
 * two images pasted in the same second still get different names. The
 * timestamp is for the human.
 */
export function synthesiseFileName(
  seqInBatch: number,
  uploadedFormat: UploadFormat,
  receivedAt: Date,
  ingestSource: IngestSource,
): string {
  if (!Number.isInteger(seqInBatch) || seqInBatch < 1) {
    throw new RangeError(`seqInBatch must be a positive integer, received ${String(seqInBatch)}`);
  }
  if (Number.isNaN(receivedAt.getTime())) {
    throw new RangeError('receivedAt must be a valid Date');
  }
  const prefix = PREFIX_BY_SOURCE[ingestSource];
  const extension = EXTENSION_BY_FORMAT[uploadedFormat];
  // Padded to 2 because the per-batch ceiling is 40 (`api.md` §5); `padStart`
  // widens rather than truncating, so a hypothetical 100th image would read
  // `-100` instead of silently colliding with `-00`.
  return `${prefix}-${utcStamp(receivedAt)}-${pad(seqInBatch, 2)}.${extension}`;
}

/**
 * `specs/data-model.md` §3.8.1, verbatim signature.
 */
export function synthesisePastedFileName(
  seqInBatch: number,
  uploadedFormat: UploadFormat,
  pastedAt: Date,
): string {
  return synthesiseFileName(seqInBatch, uploadedFormat, pastedAt, 'paste');
}

/**
 * Decide the stored `fileName` for one ingested image.
 *
 * ⚠ FOR `paste` THE CLIENT-SUPPLIED NAME IS IGNORED ENTIRELY — not "used if
 * it looks reasonable". A pasted `File` object carries whatever name the
 * browser invented, and honouring it would let three pastes collide on
 * `image.png`, which is the defect §3.8.1 exists to prevent. The `_` on the
 * parameter at that branch is deliberate.
 *
 * For `upload` and `drop` the device name is kept — it is more useful than a
 * synthetic one and it is what the owner will recognise — falling back to the
 * synthesiser when it is empty or whitespace-only, so `fileName` is NEVER
 * empty for any source.
 */
export function resolveFileName(
  clientFileName: string | undefined,
  seqInBatch: number,
  uploadedFormat: UploadFormat,
  receivedAt: Date,
  ingestSource: IngestSource,
): string {
  if (ingestSource !== 'paste') {
    const trimmed = (clientFileName ?? '').trim();
    if (trimmed.length > 0) {
      return truncateFileName(trimmed);
    }
  }
  return synthesiseFileName(seqInBatch, uploadedFormat, receivedAt, ingestSource);
}

/**
 * Truncate to `MAX_FILE_NAME_LENGTH`, keeping the trailing extension so the
 * result still reads as a file name. A synthesised name is always far shorter
 * than the ceiling, so this only ever applies to a device-supplied one.
 */
function truncateFileName(name: string): string {
  if (name.length <= MAX_FILE_NAME_LENGTH) {
    return name;
  }
  const dot = name.lastIndexOf('.');
  // Only treat the tail as an extension if it is short and not the whole name;
  // a 200-character run after a dot is not an extension worth preserving.
  const extension = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
  return name.slice(0, MAX_FILE_NAME_LENGTH - extension.length) + extension;
}
