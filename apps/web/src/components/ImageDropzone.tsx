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
  HEIC_PREVIEW_PLACEHOLDER,
  IMAGE_ACCEPT_ATTRIBUTE,
  PASTE_BUTTON_LABEL,
  PASTE_IOS_HINT,
  UNSUPPORTED_FORMAT_REJECTION,
} from '../copy';

/** Where a file entered from. Reported to the server, never branched on here. */
export type IngestSource = 'paste' | 'upload' | 'drop';

export interface RejectedFile {
  readonly name: string;
  /** Why this file alone was refused. Shown next to its name (§4.4). */
  readonly reason: string;
}

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

export interface ImageDropzoneProps {
  /** Every affordance funnels here - the single submit path (`api.md` §5.3.1). */
  readonly onFilesAccepted?: (files: readonly File[], source: IngestSource) => void;
  /** TASK-160 wires `navigator.clipboard.read()` to this. */
  readonly onPasteRequested?: () => void;
  /** Forces the touch hint on in tests; otherwise inferred from the viewport. */
  readonly touch?: boolean;
}

export function ImageDropzone({
  onFilesAccepted,
  onPasteRequested,
  touch,
}: ImageDropzoneProps = {}): JSX.Element {
  const [accepted, setAccepted] = useState<readonly File[]>([]);
  const [rejected, setRejected] = useState<readonly RejectedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputId = useId();

  const addFiles = useCallback(
    (files: readonly File[], source: IngestSource): void => {
      if (files.length === 0) return;
      const review = reviewFiles(files, accepted.length);
      // Rejections REPLACE the previous batch's rejections but never the
      // accepted list (§4.4): both are visible at once, because a rejection
      // that clears the grid reads as "everything failed".
      setRejected(review.rejected);
      if (review.accepted.length > 0) {
        setAccepted([...accepted, ...review.accepted]);
        onFilesAccepted?.(review.accepted, source);
      }
    },
    [accepted, onFilesAccepted],
  );

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    addFiles([...event.dataTransfer.files], 'drop');
  }

  const totalBytes = accepted.reduce((sum, file) => sum + file.size, 0);

  return (
    <section className="dropzone" data-testid="dropzone" aria-label="Attach screenshots">
      <div
        className="dropzone__target"
        data-testid="drop-target"
        data-dragging={dragging ? 'true' : undefined}
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

        {isPasteSupported() && (
          <div className="dropzone__paste" data-testid="paste-slot">
            {/*
              A real button, not a hint: on iOS a document-level `paste`
              listener never fires, so this is the ONLY paste path there
              (§3.2b). TASK-160 puts `navigator.clipboard.read()` behind it -
              synchronously inside this click handler, which is what iOS
              requires.
            */}
            <button
              type="button"
              className="tap-target"
              data-testid="paste-button"
              onClick={onPasteRequested}
            >
              {PASTE_BUTTON_LABEL}
            </button>
            {touch === true && <p data-testid="paste-hint">{PASTE_IOS_HINT}</p>}
          </div>
        )}

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
          <p data-testid="dropzone-totals">
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

      {rejected.length > 0 && (
        // Listed per file, by name, with the reason (US-004 AC-3/AC-6), and
        // NEVER in place of the accepted list - partial acceptance is the
        // normal case, not a failure.
        <ul data-testid="rejected-list">
          {rejected.map((file) => (
            <li key={file.name} data-testid="rejected-file">
              <span data-testid="rejected-name">{file.name}</span>
              <span data-testid="rejected-reason">{file.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
