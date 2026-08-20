// The desktop `paste` listener - primitive 1 of two (`specs/ui.md` §3.2b,
// `specs/api.md` §5.3.3, TASK-159, `A45`).
//
// Renders nothing. It exists to own one `document` listener's lifetime, which
// is the whole point: a listener that outlives its page is the defect.
//
// ⚠ THIS PRIMITIVE MUST NOT HIJACK TEXT PASTE. The listener is on `document`,
// so it sees every Ctrl/Cmd+V in the page including the ones meant for the
// TMDB search box in the fix-match dialog. Two independent guards keep it out
// of the way, and both are load-bearing:
//
//   1. an editable target returns IMMEDIATELY, before the clipboard is even
//      inspected - a screenshot in the clipboard must not steal a paste the
//      owner aimed at a text field;
//   2. a clipboard carrying no image returns without `preventDefault()` - a
//      text-only paste is a normal, correct, non-error event.
//
// The failure mode both prevent is silent and infuriating: text pasting
// "randomly stops working" on one screen, with nothing in the console.
//
// ⚠ DO NOT call `navigator.clipboard.read()` here. The data is already on the
// event, synchronously, needing no permission, no prompt and no secure
// context. Reaching for `read()` would add a Firefox 127+ permission prompt to
// a path that currently has none - a strict regression. `read()` belongs to
// primitive 2 (`PasteButton`, TASK-160), where there is no event to read from.
//
// ⚠ DO NOT add a hidden `contenteditable` trap. It is a 2015-era workaround
// for WebKit bug 75891, which is RESOLVED; today it only breaks the §10.2
// focus order and confuses screen readers.

import { useEffect, type JSX } from 'react';

/** Set by the caller; matches `ImageDropzone`'s submit path. */
export interface PasteCaptureProps {
  /**
   * Receives every image found on the clipboard, in clipboard order.
   *
   * Called only when there is at least one, so a consumer never has to
   * distinguish "text paste" from "empty paste" - by then it is neither.
   */
  readonly onImagesPasted: (files: readonly File[]) => void;
  /** Escape hatch for tests; defaults to the real `document`. */
  readonly target?: Document;
}

/**
 * Whether a paste aimed at this node belongs to the page's text editing rather
 * than to us.
 *
 * `closest()` rather than a tag check on the target itself: a paste inside a
 * `contenteditable` region reports the innermost node under the caret, which
 * is routinely a `<span>` or a text node's parent, not the editable host.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]') !== null;
}

/**
 * Every image on a paste event, from both places the platform exposes them.
 *
 * `files` and `items` overlap in practice, so the same image is deduplicated
 * by identity - but neither alone is reliable across browsers, and dropping to
 * one would be a silent per-browser regression.
 *
 * ⚠ EVERY image is returned, not the first. A multi-image clipboard is
 * possible and truncating it would discard the owner's screenshots with no
 * message at all.
 */
export function imagesFromClipboard(data: DataTransfer | null): readonly File[] {
  if (data === null) return [];

  const found: File[] = [];
  const add = (file: File | null): void => {
    if (file !== null && !found.includes(file)) found.push(file);
  };

  for (const file of data.files ?? []) add(file);

  for (const item of data.items ?? []) {
    if (item.kind !== 'file') continue;
    if (!item.type.startsWith('image/')) continue;
    add(item.getAsFile());
  }

  // `files` carries no `kind`, so a non-image dragged in through that side is
  // filtered here rather than at the `add` call - the `items` pass has already
  // done its own filtering and would otherwise be applied twice.
  return found.filter((file) => file.type === '' || file.type.startsWith('image/'));
}

export function PasteCapture({ onImagesPasted, target }: PasteCaptureProps): JSX.Element | null {
  useEffect(() => {
    const node = target ?? document;

    function onPaste(event: ClipboardEvent): void {
      // (1) Editable target - hands off, and notably WITHOUT preventDefault:
      // the browser's own paste must still happen.
      if (isEditableTarget(event.target)) return;

      // (2) Nothing we can use. Also without preventDefault: this is the
      // ordinary text-paste case and it is not an error.
      const images = imagesFromClipboard(event.clipboardData);
      if (images.length === 0) return;

      // (3) Ours. Only now do we suppress the default, which on a
      // non-editable target would otherwise do nothing useful anyway.
      event.preventDefault();
      onImagesPasted(images);
    }

    node.addEventListener('paste', onPaste);
    return () => {
      // The reason this component exists. Without this line the handler keeps
      // firing after the owner navigates away, attaching images to a batch
      // that is no longer on screen.
      node.removeEventListener('paste', onPaste);
    };
  }, [onImagesPasted, target]);

  return null;
}
