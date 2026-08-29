// The attach area (`specs/ui.md` §3.2, `specs/ux-states.md` §4.3/§4.4,
// TASK-053).
//
// ⚠ THREE AFFORDANCES, ALL VISIBLE AT ONCE (`A45`, product invariant 16):
// paste, file selection and drag-and-drop. Paste was ADDED, not swapped in.
// Tidying this down to one affordance silently removes a working capture path -
// the file input is the ONLY route that delivers raw HEIC from iOS Photos, and
// the only route once the iOS screenshot preview's "Copy" has disappeared.
//
// ⚠ THE CLIENT NEVER BRANCHES ON INGEST SOURCE for validation, preview,
// ceilings or error handling. One path, three entry points: every affordance
// ends in the same `addFiles`. A per-source branch is how "the same file works
// when dragged but not when pasted" bugs are born.
//
// ⚠ VALIDATION IS LENIENT AND THE SERVER IS AUTHORITATIVE. iOS routinely
// reports HEIC with an empty or `application/octet-stream` type, so an unknown
// type is ACCEPTED and left to the server's magic-byte sniff (`api.md` §5). A
// client that hard-filters on `File.type` reintroduces exactly the defect
// `A42` fixed: refusing the owner's own phone photos.
//
// This task owns the attach area and its slots. `PasteCapture` (TASK-160) and
// the drop target's full behaviour (TASK-162, `T-UI-014`) fill them in.

import { useCallback, useId, useState, type DragEvent, type JSX } from 'react';
import { MAX_IMAGES_PER_BATCH, MAX_IMAGE_BYTES } from '@nextup/domain';

import {
  CHOOSE_FILES_LABEL,
  DROPZONE_ACTIVE_LABEL,
  DROPZONE_IDLE_LABEL,
  FOLDER_REJECTION,
  HEIC_PREVIEW_PLACEHOLDER,
  IMAGE_ACCEPT_ATTRIBUTE,
  UNSUPPORTED_FORMAT_REJECTION,
} from '../copy';
import { useHeldImages } from '../lib/useHeldImages';
import { PasteButton, type PasteFailure } from './PasteButton';
import { PasteCapture } from './PasteCapture';
import {
  RejectionList,
  mergeRejections,
  type RejectedFile,
  type ServerRejection,
} from './RejectionList';

/** Where a file entered from. Reported to the server, never branched on here. */
export type IngestSource = 'paste' | 'upload' | 'drop';

export type { RejectedFile, ServerRejection };

export interface DropzoneReview {
  readonly accepted: readonly File[];
  readonly rejected: readonly RejectedFile[];
}

const MEGABYTE = 1024 * 1024;

/** Whole megabytes, rounded up - the number the ceiling message names. */
function megabytes(bytes: number): number {
  return Math.ceil(bytes / MEGABYTE);
}

function isHeic(file: File): boolean {
  return /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]$/i.test(file.type);
}

/**
 * Whether a browser-declared type is a positive statement that this is not an
 * image.
 *
 * Empty and `application/octet-stream` are NOT: they are "I don't know", and
 * iOS Safari reports HEIC as both. Treating "I don't know" as "not an image"
 * is precisely how the owner's own camera roll gets refused, and it is the
 * defect `A42` fixed. The server's magic-byte sniff is the authority.
 */
function declaresNonImage(type: string): boolean {
  if (type === '' || type === 'application/octet-stream') return false;
  return !type.startsWith('image/');
}

/**
 * Client-side triage (`specs/ux-states.md` §4.4/§4.6).
 *
 * ⚠ ONE BAD FILE FAILS ALONE (product invariant 15 at the UI layer). Every
 * file is judged on its own and the rest of the selection is unaffected, which
 * is only actionable for the owner if the refusal names the file and the
 * reason - so a rejection carries both.
 *
 * `alreadyAccepted` is passed in rather than read from state so the count
 * ceiling is evaluated against the batch as it will be, not as it was.
 */
export function reviewFiles(files: readonly File[], alreadyAccepted: number): DropzoneReview {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];

  for (const file of files) {
    if (declaresNonImage(file.type)) {
      rejected.push({ name: file.name, reason: UNSUPPORTED_FORMAT_REJECTION });
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      // The specific number is always named (§4.6) - "too big" alone leaves
      // the owner guessing how much to shrink it by.
      rejected.push({
        name: file.name,
        reason: `That file is ${String(megabytes(file.size))} MB. The limit is ${String(
          megabytes(MAX_IMAGE_BYTES),
        )} MB.`,
      });
      continue;
    }
    const wouldBe = alreadyAccepted + accepted.length + 1;
    if (wouldBe > MAX_IMAGES_PER_BATCH) {
      rejected.push({
        name: file.name,
        reason: `That would be ${String(wouldBe)} screenshots. The limit is ${String(
          MAX_IMAGES_PER_BATCH,
        )} per batch.`,
      });
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejected };
}

/**
 * Whether the "Paste screenshot" button can work at all (`ux-states.md` §4.16).
 *
 * ⚠ `navigator.clipboard` is absent over plain `http://`, so on a LAN IP the
 * button would simply not function (product invariant 19). Hiding it there is
 * honest; a button that silently does nothing is not. The file input and the
 * drop target are unaffected - they are not a fallback, they are equals.
 */
export function isPasteSupported(): boolean {
  return typeof navigator.clipboard?.read === 'function';
}

/**
 * Whether this is a touch device, and therefore whether the iOS paste hint
 * must be shown (product invariant 16, `ux-states.md` §4.0a).
 *
 * ⚠ **THIS FUNCTION DID NOT EXIST, AND ITS ABSENCE MADE THE HINT DEAD CODE.**
 * `PasteButton` renders the hint on `touch === true` and nothing in the SPA
 * ever passed `touch` — so the hint rendered **only in tests**, while both
 * this file and `PasteButton` carried a comment promising it was "otherwise
 * inferred from the viewport". No inference had ever been written. Found at a
 * 320 px viewport by the a11y suite; see the struck-through comments below.
 *
 * ⚠ **`pointer: coarse`, NOT a width breakpoint.** The hint is instructions
 * for a *touch* interaction — take a screenshot, tap Copy, tap here — and a
 * narrow desktop window is not an iPhone. Keying it on width would show the
 * wrong instructions to a desktop owner who resized their browser, and hide
 * them on a tablet in landscape.
 *
 * ⚠ Probed defensively: `matchMedia` is absent in jsdom unless a test stubs
 * it, and a throw here would take down the whole upload screen — the one
 * screen the product cannot work without.
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export interface ImageDropzoneProps {
  /** Every affordance funnels here - the single submit path (`api.md` §5.3.1). */
  readonly onFilesAccepted?: (files: readonly File[], source: IngestSource) => void;
  /** Whether service and mode are chosen, so a batch exists (`ux-states.md` §4.0a). */
  readonly batchReady?: boolean;
  /** TASK-161 maps this to the four §4.13–§4.15 messages. */
  readonly onPasteFailed?: (failure: PasteFailure) => void;
  /**
   * The server's `rejected[]` from `POST /api/batches/:batchId/images`
   * (`api.md` §6.12), rendered verbatim in the same list as client refusals.
   */
  readonly serverRejected?: readonly ServerRejection[];
  /**
   * Overrides the touch probe; `undefined` in the SPA — see `PasteButton`.
   *
   * ~~Superseded: "Forces the touch hint on in tests; otherwise inferred from
   * the viewport."~~
   */
  readonly touch?: boolean;
}

export function ImageDropzone({
  onFilesAccepted,
  batchReady = false,
  onPasteFailed,
  serverRejected = [],
  touch,
}: ImageDropzoneProps = {}): JSX.Element {
  const [accepted, setAccepted] = useState<readonly File[]>([]);
  const [rejected, setRejected] = useState<readonly RejectedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputId = useId();

  const addFiles = useCallback(
    (
      files: readonly File[],
      source: IngestSource,
      extraRejections?: readonly RejectedFile[],
    ): void => {
      if (files.length === 0 && (extraRejections === undefined || extraRejections.length === 0))
        return;
      const review =
        files.length > 0 ? reviewFiles(files, accepted.length) : { accepted: [], rejected: [] };
      // Rejections REPLACE the previous batch's rejections but never the
      // accepted list (§4.4): both are visible at once, because a rejection
      // that clears the grid reads as "everything failed".
      setRejected([...(extraRejections ?? []), ...review.rejected]);
      if (review.accepted.length > 0) {
        setAccepted([...accepted, ...review.accepted]);
        onFilesAccepted?.(review.accepted, source);
      }
    },
    [accepted, onFilesAccepted],
  );

  const pastedByListener = useCallback(
    (files: readonly File[]): void => {
      addFiles(files, 'paste');
    },
    [addFiles],
  );
  // The desktop listener holds too. A hold implemented only behind the button
  // would leave Ctrl/Cmd+V silently lossy before service/mode are chosen —
  // the same defect, on the platform where paste is used most.
  const listener = useHeldImages(batchReady, pastedByListener);

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);

    // ⚠ FOLDER DETECTION: DataTransferItem.webkitGetAsEntry() is the only
    // reliable way to distinguish a folder from a file at drop time. The check
    // is synchronous (entry must be read before the event is recycled) and
    // happens before we call addFiles so folder rejections go into the same
    // RejectionList as every other client refusal.
    const items = event.dataTransfer.items;
    if (items !== null && items !== undefined && items.length > 0) {
      const folderRejections: RejectedFile[] = [];
      const filesToPass: File[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item === undefined) continue;
        const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
        if (entry !== null && entry.isDirectory) {
          folderRejections.push({ name: entry.name, reason: FOLDER_REJECTION });
        } else {
          const file = item.getAsFile?.();
          if (file !== null && file !== undefined) {
            filesToPass.push(file);
          }
        }
      }

      // Pass folder rejections as extra so addFiles merges them with file
      // review rejections rather than one set overwriting the other.
      addFiles(filesToPass, 'drop', folderRejections.length > 0 ? folderRejections : undefined);
      return;
    }

    // DataTransferItem API unavailable (some legacy browsers): fall back to
    // the FileList. No folder detection possible, but at least files work.
    addFiles([...event.dataTransfer.files], 'drop');
  }

  const totalBytes = accepted.reduce((sum, file) => sum + file.size, 0);

  return (
    <section className="dropzone" data-testid="dropzone" aria-label="Attach screenshots">
      {/*
        Primitive 1 (TASK-159). Mounted HERE, not globally, so the listener's
        lifetime is exactly the attach area's — on `/upload` and on the
        open-draft view alike — and it cannot outlive the page and swallow a
        paste meant for the fix-match search box.
      */}
      <PasteCapture onImagesPasted={listener.deliver} />

      <div
        className="dropzone__target"
        data-testid="drop-target"
        data-dragging={dragging ? 'true' : undefined}
        aria-label={dragging ? DROPZONE_ACTIVE_LABEL : DROPZONE_IDLE_LABEL}
        tabIndex={0}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={onDrop}
      >
        <p data-testid="dropzone-label">{dragging ? DROPZONE_ACTIVE_LABEL : DROPZONE_IDLE_LABEL}</p>

        {/*
          Primitive 2 (TASK-160). Absent entirely where `navigator.clipboard`
          is - which includes every `http://` origin, so on a LAN IP this slot
          is simply not there and the other two affordances carry the load.
        */}
        <PasteButton
          batchReady={batchReady}
          onImagesPasted={(files) => {
            addFiles(files, 'paste');
          }}
          {...(onPasteFailed === undefined ? {} : { onPasteFailed })}
          {...(touch === undefined ? {} : { touch })}
        />

        {/*
          ⚠ ALWAYS PRESENT, never behind a menu, never replaced by paste. This
          is the only route raw HEIC from iOS Photos can take, and the only one
          left once the screenshot preview's "Copy" has gone.
        */}
        <label className="dropzone__choose tap-target" htmlFor={inputId}>
          {CHOOSE_FILES_LABEL}
        </label>
        <input
          id={inputId}
          type="file"
          multiple
          data-testid="file-input"
          accept={IMAGE_ACCEPT_ATTRIBUTE}
          onChange={(event) => {
            addFiles([...(event.target.files ?? [])], 'upload');
          }}
        />
      </div>

      {accepted.length > 0 && (
        <>
          <p aria-live="polite" data-testid="dropzone-totals">
            {`${String(accepted.length)} screenshots · ${(totalBytes / MEGABYTE).toFixed(1)} MB`}
          </p>
          <ul data-testid="accepted-list">
            {accepted.map((file) => (
              <li key={`${file.name}:${String(file.size)}`} data-testid="accepted-file">
                <span data-testid="accepted-name">{file.name}</span>
                {/*
                  No client preview of HEIC: only Safari can render it, so every
                  other browser would show a broken image tile.
                */}
                {isHeic(file) && (
                  <span data-testid="heic-placeholder">{HEIC_PREVIEW_PLACEHOLDER}</span>
                )}
                <button
                  type="button"
                  className="tap-target"
                  onClick={() => {
                    setAccepted((current) => current.filter((candidate) => candidate !== file));
                  }}
                >
                  {`Remove ${file.name}`}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/*
        ⚠ ONE list for client and server refusals, and it is rendered
        UNCONDITIONALLY alongside the accepted list — never in place of it.
        Partial acceptance is the normal case (`api.md` §6.12), so a rejection
        that clears the grid reads as "everything failed".
      */}
      <RejectionList entries={mergeRejections(rejected, serverRejected)} />
    </section>
  );
}
