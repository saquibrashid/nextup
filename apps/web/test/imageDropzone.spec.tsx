/**
 * TASK-053 - the attach area (`specs/ui.md` §3.2, `specs/ux-states.md`
 * §4.3/§4.4).
 *
 * Tests: `T-UI-004` (PNG, JPEG and HEIC in `accept` and in the copy),
 * `T-UX-041` (all three affordances in the empty state), `T-UX-042` (partial
 * acceptance - running totals and per-file rejections, both visible at once).
 *
 * ⚠ `T-UI-014` (all three affordances present simultaneously, end to end) is
 * TASK-162's, not this file's: asserting it here would need TASK-159/160/162,
 * which depend on this task (`docs/backlog.md` §8.12).
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_IMAGES_PER_BATCH, MAX_IMAGE_BYTES } from '@nextup/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImageDropzone, isPasteSupported, reviewFiles } from '../src/components/ImageDropzone';
import {
  CHOOSE_FILES_LABEL,
  DROPZONE_ACTIVE_LABEL,
  DROPZONE_IDLE_LABEL,
  HEIC_PREVIEW_PLACEHOLDER,
  IMAGE_ACCEPT_ATTRIBUTE,
  PASTE_BUTTON_LABEL,
  UNSUPPORTED_FORMAT_REJECTION,
} from '../src/copy';

/**
 * jsdom has no Clipboard API, so `isPasteSupported()` is false by default -
 * which would hide the paste affordance and make `T-UX-041` unwinnable for the
 * wrong reason. Stubbing it models the supported browser; the deliberately
 * UNstubbed case below is its own assertion.
 */
function withClipboard(): void {
  vi.stubGlobal('navigator', {
    ...navigator,
    clipboard: { read: (): Promise<never[]> => Promise.resolve([]) },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function file(name: string, type: string, size = 1024): File {
  const handle = new File(['x'], name, { type });
  Object.defineProperty(handle, 'size', { value: size });
  return handle;
}

describe('T-UI-004 - PNG, JPEG and HEIC, all three, in accept and in the copy', () => {
  it('T-UI-004a the file input accepts all three formats by MIME type and by extension', () => {
    render(<ImageDropzone />);
    const accept = screen.getByTestId('file-input').getAttribute('accept') ?? '';

    // Product invariant 11: without HEIC the iOS picker greys out the owner's
    // own camera photos and it reads as a broken phone, not a missing format.
    for (const token of ['image/png', 'image/jpeg', 'image/heic', 'image/heif', '.heic', '.heif']) {
      expect(accept.split(',')).toContain(token);
    }
    expect(accept).toBe(IMAGE_ACCEPT_ATTRIBUTE);
  });

  it('T-UI-004b the idle copy names all three formats and both ceilings', () => {
    render(<ImageDropzone />);
    const label = screen.getByTestId('dropzone-label');

    expect(label.textContent).toBe(DROPZONE_IDLE_LABEL);
    for (const token of ['PNG', 'JPEG', 'HEIC', '10 MB', '40 per batch']) {
      expect(label.textContent ?? '').toContain(token);
    }
  });

  it('T-UI-004c the rejection message enumerates all three accepted formats', () => {
    const { rejected } = reviewFiles([file('notes.pdf', 'application/pdf')], 0);

    expect(rejected[0]?.reason).toBe(UNSUPPORTED_FORMAT_REJECTION);
    for (const token of ['PNG', 'JPEG', 'HEIC']) {
      expect(rejected[0]?.reason ?? '').toContain(token);
    }
  });

  it('T-UI-004d accepts an unknown or empty type rather than hard-filtering on File.type', async () => {
    const onFilesAccepted = vi.fn();
    render(<ImageDropzone onFilesAccepted={onFilesAccepted} />);

    // iOS routinely reports HEIC as `application/octet-stream` or as nothing at
    // all. Refusing it here reintroduces exactly the defect A42 fixed; the
    // server's magic-byte sniff is the authority.
    await userEvent.upload(
      screen.getByTestId('file-input'),
      [file('IMG_0042.HEIC', ''), file('IMG_0043.HEIC', 'application/octet-stream')],
      { applyAccept: false },
    );

    expect(screen.getAllByTestId('accepted-file')).toHaveLength(2);
    expect(screen.queryByTestId('rejected-list')).toBeNull();
  });

  it('T-UI-004e shows a HEIC placeholder instead of a broken image tile', async () => {
    render(<ImageDropzone />);

    await userEvent.upload(
      screen.getByTestId('file-input'),
      [file('IMG_0042.HEIC', 'image/heic'), file('shot.png', 'image/png')],
      { applyAccept: false },
    );

    // Only Safari renders HEIC in an <img>; everywhere else it would break.
    expect(screen.getAllByTestId('heic-placeholder')).toHaveLength(1);
    expect(screen.getByTestId('heic-placeholder')).toHaveTextContent(HEIC_PREVIEW_PLACEHOLDER);
  });
});

describe('T-UX-041 - the empty dropzone shows all three ingest affordances', () => {
  it('T-UX-041a renders paste, file selection and drag-and-drop at once', () => {
    withClipboard();
    render(<ImageDropzone />);

    // Product invariant 16: paste was ADDED, not swapped in. A tidied-up
    // single-affordance dropzone silently removes a working capture path.
    expect(screen.getByTestId('paste-button')).toHaveTextContent(PASTE_BUTTON_LABEL);
    expect(screen.getByTestId('file-input')).toBeInTheDocument();
    expect(screen.getByText(CHOOSE_FILES_LABEL)).toBeInTheDocument();
    expect(screen.getByTestId('drop-target')).toBeInTheDocument();
    expect(screen.getByTestId('dropzone-label').textContent).toBe(DROPZONE_IDLE_LABEL);
  });

  it('T-UX-041b keeps file selection fully working when navigator.clipboard is absent', async () => {
    const onFilesAccepted = vi.fn();
    render(<ImageDropzone onFilesAccepted={onFilesAccepted} />);

    // Product invariant 19: `navigator.clipboard` does not exist over plain
    // `http://`. The file input is an equal path, not a fallback, so it must be
    // untouched by paste being unavailable.
    expect(isPasteSupported()).toBe(false);
    expect(screen.queryByTestId('paste-button')).toBeNull();

    await userEvent.upload(screen.getByTestId('file-input'), [file('shot.png', 'image/png')], {
      applyAccept: false,
    });
    expect(onFilesAccepted).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'shot.png' })],
      'upload',
    );
    expect(screen.getByTestId('accepted-name')).toHaveTextContent('shot.png');
  });

  it('T-UX-041c shows the iOS hint under the button on a touch viewport', () => {
    withClipboard();
    render(<ImageDropzone touch />);

    // iOS screenshots go to Photos, not the clipboard, unless the owner acts on
    // the transient preview. Without the hint the button looks broken.
    expect(screen.getByTestId('paste-hint')).toBeInTheDocument();
  });

  it('T-UX-041d all three affordances end in the same path, none branching on source', async () => {
    withClipboard();
    const onFilesAccepted = vi.fn();
    render(<ImageDropzone onFilesAccepted={onFilesAccepted} />);

    await userEvent.upload(screen.getByTestId('file-input'), [file('a.png', 'image/png')], {
      applyAccept: false,
    });
    const dropped = file('b.png', 'image/png');
    fireEvent.drop(screen.getByTestId('drop-target'), { dataTransfer: { files: [dropped] } });

    // Same accepted list, same ceilings, same rejection rules - only the
    // reported source differs. A per-source branch is how "works dragged, not
    // pasted" bugs start.
    expect(onFilesAccepted.mock.calls.map(([, source]) => source)).toEqual(['upload', 'drop']);
    expect(screen.getAllByTestId('accepted-file')).toHaveLength(2);
  });

  it('T-UX-041e the drop target announces itself while a file is dragged over it', () => {
    render(<ImageDropzone />);
    const target = screen.getByTestId('drop-target');

    fireEvent.dragOver(target);
    expect(screen.getByTestId('dropzone-label').textContent).toBe(DROPZONE_ACTIVE_LABEL);
    expect(target).toHaveAttribute('data-dragging', 'true');

    // Leaving must restore the idle copy, or the label would keep naming only
    // one of the three affordances for the rest of the session.
    fireEvent.dragLeave(target);
    expect(screen.getByTestId('dropzone-label').textContent).toBe(DROPZONE_IDLE_LABEL);
    expect(target).not.toHaveAttribute('data-dragging');
  });
});

describe('T-UX-042 - partial acceptance names every rejected file and its reason', () => {
  it('T-UX-042a shows running totals and the per-file rejection list at once', async () => {
    render(<ImageDropzone />);

    await userEvent.upload(
      screen.getByTestId('file-input'),
      [
        file('good.png', 'image/png', 2 * 1024 * 1024),
        file('notes.pdf', 'application/pdf'),
        file('huge.png', 'image/png', 14 * 1024 * 1024),
      ],
      { applyAccept: false },
    );

    // Product invariant 15 at the UI layer: one bad image fails alone. Both
    // lists are visible together - a rejection list that replaced the grid
    // would read as "everything failed".
    expect(screen.getByTestId('dropzone-totals')).toHaveTextContent('1 screenshots · 2.0 MB');
    const rejections = screen.getAllByTestId('rejected-file');
    expect(rejections).toHaveLength(2);
    expect(within(rejections[0] as HTMLElement).getByTestId('rejected-name')).toHaveTextContent(
      'notes.pdf',
    );
    expect(within(rejections[0] as HTMLElement).getByTestId('rejected-reason')).toHaveTextContent(
      UNSUPPORTED_FORMAT_REJECTION,
    );
  });

  it('T-UX-042b names the actual size and the actual limit, never just "too big"', () => {
    const { rejected } = reviewFiles([file('huge.png', 'image/png', 14 * 1024 * 1024)], 0);

    // "Too big" leaves the owner guessing how much to shrink by.
    expect(rejected[0]?.reason).toBe('That file is 14 MB. The limit is 10 MB.');
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('T-UX-042c names the resulting count and the batch ceiling', () => {
    const overflowing = Array.from({ length: 3 }, (_, index) =>
      file(`shot-${String(index)}.png`, 'image/png'),
    );
    const { accepted, rejected } = reviewFiles(overflowing, MAX_IMAGES_PER_BATCH - 1);

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]?.reason).toBe(
      `That would be ${String(MAX_IMAGES_PER_BATCH + 1)} screenshots. The limit is ${String(
        MAX_IMAGES_PER_BATCH,
      )} per batch.`,
    );
  });

  it('T-UX-042d judges each file on its own - a rejection never takes the batch with it', () => {
    const { accepted, rejected } = reviewFiles(
      [
        file('a.png', 'image/png'),
        file('notes.pdf', 'application/pdf'),
        file('b.jpg', 'image/jpeg'),
        file('huge.png', 'image/png', 20 * 1024 * 1024),
        file('c.heic', 'image/heic'),
      ],
      0,
    );

    expect(accepted.map((entry) => entry.name)).toEqual(['a.png', 'b.jpg', 'c.heic']);
    expect(rejected.map((entry) => entry.name)).toEqual(['notes.pdf', 'huge.png']);
    // Every rejection is actionable: it says which file, and why.
    for (const entry of rejected) expect(entry.reason).not.toBe('');
  });

  it('T-UX-042e keeps accepted files when a later selection is entirely rejected', async () => {
    render(<ImageDropzone />);
    const input = screen.getByTestId('file-input');

    await userEvent.upload(input, [file('good.png', 'image/png')], { applyAccept: false });
    await userEvent.upload(input, [file('notes.pdf', 'application/pdf')], { applyAccept: false });

    expect(screen.getAllByTestId('accepted-file')).toHaveLength(1);
    expect(screen.getAllByTestId('rejected-file')).toHaveLength(1);
  });

  it('T-UX-042f lets the owner remove an accepted file before submit', async () => {
    render(<ImageDropzone />);

    await userEvent.upload(
      screen.getByTestId('file-input'),
      [file('a.png', 'image/png'), file('b.png', 'image/png')],
      { applyAccept: false },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove a.png' }));

    expect(screen.getAllByTestId('accepted-file')).toHaveLength(1);
    expect(screen.getByTestId('accepted-name')).toHaveTextContent('b.png');
  });
});
