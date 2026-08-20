/**
 * TASK-159/160/161 — the two paste primitives.
 *
 * `T-PASTE-001` — the desktop `document` listener attaches images, stays out of
 * the way of text pastes into inputs, and is removed on unmount.
 * `T-PASTE-002` — the iOS button calls `clipboard.read()` synchronously inside
 * the click handler; a pre-batch paste is held, not dropped.
 * `T-PASTE-009` — with no clipboard API the button is not rendered, while the
 * file control and drop target stay fully functional.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHOOSE_FILES_LABEL, PASTE_IOS_HINT } from '../src/copy';
import { ImageDropzone } from '../src/components/ImageDropzone';
import { PASTE_HELD_BODY, PasteButton, classifyRejection } from '../src/components/PasteButton';
import {
  PasteCapture,
  imagesFromClipboard,
  isEditableTarget,
} from '../src/components/PasteCapture';

function imageFile(name = 'shot.png', type = 'image/png'): File {
  return new File(['x'], name, { type });
}

/** A `ClipboardItem` carrying a PNG, as `navigator.clipboard.read()` returns. */
function pngItem(): ClipboardItem {
  return {
    types: ['image/png'],
    getType: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })),
  } as unknown as ClipboardItem;
}

function textItem(): ClipboardItem {
  return {
    types: ['text/plain'],
    getType: () => Promise.resolve(new Blob(['x'], { type: 'text/plain' })),
  } as unknown as ClipboardItem;
}

/** jsdom has no Clipboard API at all, so every read path must be stubbed in. */
function withClipboard(read: () => Promise<readonly ClipboardItem[]>): void {
  vi.stubGlobal('navigator', { ...navigator, clipboard: { read } });
}

/**
 * A `paste` event carrying a real `DataTransfer`-shaped payload.
 *
 * jsdom's `ClipboardEvent` does not accept `clipboardData` through its
 * constructor, so it is defined on the instance. The event is dispatched for
 * real, so `preventDefault()` is observed through `defaultPrevented` rather
 * than through a spy that could pass against a handler that never ran.
 */
function pasteEvent(
  clipboardData: Partial<DataTransfer> | null,
  target?: EventTarget,
): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  if (target !== undefined) Object.defineProperty(event, 'target', { value: target });
  return event;
}

function transfer(files: readonly File[], items: readonly DataTransferItem[] = []): DataTransfer {
  return { files, items } as unknown as DataTransfer;
}

function fileItem(file: File): DataTransferItem {
  return { kind: 'file', type: file.type, getAsFile: () => file } as unknown as DataTransferItem;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('T-PASTE-001 - the desktop paste listener', () => {
  it('T-PASTE-001a attaches a PNG from clipboardData.files and prevents the default', () => {
    const onImagesPasted = vi.fn();
    render(<PasteCapture onImagesPasted={onImagesPasted} />);
    const png = imageFile();

    const event = pasteEvent(transfer([png]));
    document.dispatchEvent(event);

    expect(onImagesPasted).toHaveBeenCalledTimes(1);
    expect(onImagesPasted.mock.calls[0]?.[0]).toEqual([png]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('T-PASTE-001b leaves a paste into an <input> entirely alone', () => {
    const onImagesPasted = vi.fn();
    render(<PasteCapture onImagesPasted={onImagesPasted} />);
    const input = document.createElement('input');
    document.body.append(input);

    // ⚠ The load-bearing negative case. The clipboard genuinely holds an image
    // here — the owner copied a screenshot, then pasted TEXT into TMDB search.
    // A handler that checks the clipboard before the target steals it.
    const event = pasteEvent(transfer([imageFile()]), input);
    document.dispatchEvent(event);

    expect(onImagesPasted).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    input.remove();
  });

  it('T-PASTE-001c leaves a text-only paste alone and does not treat it as an error', () => {
    const onImagesPasted = vi.fn();
    render(<PasteCapture onImagesPasted={onImagesPasted} />);

    const event = pasteEvent(
      transfer([], [{ kind: 'string', type: 'text/plain' } as DataTransferItem]),
    );
    document.dispatchEvent(event);

    expect(onImagesPasted).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('T-PASTE-001d removes the listener on unmount, so a later paste attaches nothing', () => {
    const onImagesPasted = vi.fn();
    const { unmount } = render(<PasteCapture onImagesPasted={onImagesPasted} />);

    unmount();
    const event = pasteEvent(transfer([imageFile()]));
    document.dispatchEvent(event);

    expect(onImagesPasted).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('T-PASTE-001e attaches every image on a multi-image clipboard, not just the first', () => {
    const onImagesPasted = vi.fn();
    render(<PasteCapture onImagesPasted={onImagesPasted} />);
    const first = imageFile('one.png');
    const second = imageFile('two.png');

    document.dispatchEvent(pasteEvent(transfer([first, second])));

    expect(onImagesPasted.mock.calls[0]?.[0]).toEqual([first, second]);
  });

  it('T-PASTE-001f reads images from items as well as files, without double-counting', () => {
    const onImagesPasted = vi.fn();
    render(<PasteCapture onImagesPasted={onImagesPasted} />);
    const shared = imageFile();
    const itemsOnly = imageFile('items-only.png');

    // Browsers disagree about which side is populated; relying on one is a
    // silent per-browser regression.
    document.dispatchEvent(pasteEvent(transfer([shared], [fileItem(shared), fileItem(itemsOnly)])));

    expect(onImagesPasted.mock.calls[0]?.[0]).toEqual([shared, itemsOnly]);
  });

  it('T-PASTE-001g ignores a non-image file item', () => {
    const onImagesPasted = vi.fn();
    render(<PasteCapture onImagesPasted={onImagesPasted} />);
    const pdf = new File(['x'], 'notes.pdf', { type: 'application/pdf' });

    const event = pasteEvent(transfer([pdf], [fileItem(pdf)]));
    document.dispatchEvent(event);

    expect(onImagesPasted).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('T-PASTE-001h treats a paste with no clipboardData as a text paste, not a crash', () => {
    const onImagesPasted = vi.fn();
    render(<PasteCapture onImagesPasted={onImagesPasted} />);

    const event = pasteEvent(null);
    expect(() => {
      document.dispatchEvent(event);
    }).not.toThrow();
    expect(event.defaultPrevented).toBe(false);
  });

  it('T-PASTE-001i treats a contenteditable host and its inner nodes as editable', () => {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    host.append(inner);
    document.body.append(host);

    expect(isEditableTarget(host)).toBe(true);
    // The caret reports the innermost node, so a tag check on the target alone
    // would miss this and hijack the paste.
    expect(isEditableTarget(inner)).toBe(true);
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);

    host.remove();
  });

  it('T-PASTE-001j never reads navigator.clipboard on the listener path', () => {
    const read = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { read } });
    const onImagesPasted = vi.fn();
    render(<PasteCapture onImagesPasted={onImagesPasted} />);

    document.dispatchEvent(pasteEvent(transfer([imageFile()])));

    // The data is on the event already. Calling read() here would add a
    // Firefox permission prompt to a path that needs none.
    expect(read).not.toHaveBeenCalled();
    expect(onImagesPasted).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('T-PASTE-001k renders no DOM at all - no hidden contenteditable trap', () => {
    const { container } = render(<PasteCapture onImagesPasted={vi.fn()} />);

    expect(container.innerHTML).toBe('');
    expect(document.querySelector('[contenteditable]')).toBeNull();
  });

  it('T-PASTE-001l accepts an image whose type the browser could not name', () => {
    // Lenient client validation (`ui.md` §3.2): an unknown type is "I don't
    // know", and the server's magic-byte sniff is the authority.
    expect(imagesFromClipboard(transfer([imageFile('unknown', '')]))).toHaveLength(1);
    expect(imagesFromClipboard(null)).toEqual([]);
  });
});

describe('T-PASTE-002 - the iOS button reads the clipboard inside the click handler', () => {
  it('T-PASTE-002a calls clipboard.read() with nothing awaited or timed before it', async () => {
    const order: string[] = [];
    const read = vi.fn(() => {
      order.push('read');
      return Promise.resolve([pngItem()]);
    });
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    withClipboard(read);
    const onImagesPasted = vi.fn();
    render(<PasteButton batchReady onImagesPasted={onImagesPasted} />);

    fireEvent.click(screen.getByRole('button', { name: /paste screenshot/i }));

    // Outside transient activation the promise rejects immediately, on a
    // device, with no way to reproduce it here. So the ORDER is the assertion:
    // read() must be the first thing the handler does.
    expect(order[0]).toBe('read');
    expect(timeout).not.toHaveBeenCalled();
  });

  it('T-PASTE-002b posts the resolved image/png blob as a file', async () => {
    withClipboard(() => Promise.resolve([pngItem()]));
    const onImagesPasted = vi.fn();
    render(<PasteButton batchReady onImagesPasted={onImagesPasted} />);

    fireEvent.click(screen.getByRole('button', { name: /paste screenshot/i }));

    await waitFor(() => expect(onImagesPasted).toHaveBeenCalledTimes(1));
    const [files] = onImagesPasted.mock.calls[0] as [readonly File[]];
    expect(files).toHaveLength(1);
    expect(files[0]?.type).toBe('image/png');
  });

  it('T-PASTE-002c holds a pre-batch paste instead of dropping or sending it', async () => {
    withClipboard(() => Promise.resolve([pngItem()]));
    const onImagesPasted = vi.fn();
    const { rerender } = render(<PasteButton batchReady={false} onImagesPasted={onImagesPasted} />);

    fireEvent.click(screen.getByRole('button', { name: /paste screenshot/i }));

    // Nothing may be sent: there is no batch to attach to yet.
    await screen.findByTestId('paste-held');
    expect(onImagesPasted).not.toHaveBeenCalled();

    rerender(<PasteButton batchReady onImagesPasted={onImagesPasted} />);

    await waitFor(() => expect(onImagesPasted).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('paste-held')).toBeNull();
  });

  it('T-PASTE-002d tells the owner the held image is waiting rather than failing silently', async () => {
    withClipboard(() => Promise.resolve([pngItem()]));
    render(<PasteButton batchReady={false} onImagesPasted={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /paste screenshot/i }));

    const held = await screen.findByTestId('paste-held');
    expect(held.textContent).toBe(PASTE_HELD_BODY);
    expect(held.getAttribute('role')).toBe('status');
  });

  it('T-PASTE-002e never creates or submits a batch by itself', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    withClipboard(() => Promise.resolve([pngItem()]));
    render(<PasteButton batchReady={false} onImagesPasted={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /paste screenshot/i }));
    await screen.findByTestId('paste-held');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('T-PASTE-002f settles every rejection so no pending state can outlive the promise', async () => {
    const denied = new Error('no');
    denied.name = 'NotAllowedError';
    withClipboard(() => Promise.reject(denied));
    const onPasteFailed = vi.fn();
    render(<PasteButton batchReady onImagesPasted={vi.fn()} onPasteFailed={onPasteFailed} />);

    fireEvent.click(screen.getByRole('button', { name: /paste screenshot/i }));

    await waitFor(() => expect(onPasteFailed).toHaveBeenCalledWith('denied'));
    // The button is re-offered, never disabled behind a spinner.
    expect(screen.getByRole('button', { name: /paste screenshot/i })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('T-PASTE-002g distinguishes an empty clipboard from one holding no image', async () => {
    const onPasteFailed = vi.fn();
    withClipboard(() => Promise.resolve([]));
    const { unmount } = render(
      <PasteButton batchReady onImagesPasted={vi.fn()} onPasteFailed={onPasteFailed} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /paste screenshot/i }));
    await waitFor(() => expect(onPasteFailed).toHaveBeenCalledWith('empty'));
    unmount();

    // Two different problems with two different fixes (§4.14).
    withClipboard(() => Promise.resolve([textItem()]));
    render(<PasteButton batchReady onImagesPasted={vi.fn()} onPasteFailed={onPasteFailed} />);
    fireEvent.click(screen.getByRole('button', { name: /paste screenshot/i }));
    await waitFor(() => expect(onPasteFailed).toHaveBeenCalledWith('not-image'));
  });

  it('T-PASTE-002h classifies a bare DOMException as abandoned, not as a denial', () => {
    const denied = new Error('no');
    denied.name = 'NotAllowedError';
    expect(classifyRejection(denied)).toBe('denied');
    // A stray tap, a tab switch or backgrounding Safari. The owner would not
    // recognise any of them as refusing permission, so the copy must differ.
    expect(classifyRejection(new Error('whatever'))).toBe('abandoned');
    expect(classifyRejection(undefined)).toBe('abandoned');
  });

  it('T-PASTE-002i shows the iOS hint on a touch viewport, because screenshots go to Photos', () => {
    withClipboard(() => Promise.resolve([]));
    render(<PasteButton batchReady onImagesPasted={vi.fn()} touch />);

    expect(screen.getByTestId('paste-hint').textContent).toBe(PASTE_IOS_HINT);
  });

  it('T-PASTE-002j offers no "don\u2019t ask again" control - iOS never remembers', async () => {
    withClipboard(() => Promise.resolve([pngItem()]));
    const { container } = render(<PasteButton batchReady onImagesPasted={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /paste screenshot/i }));

    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.textContent).not.toMatch(/again/i);
  });
});

describe('T-PASTE-009 - no clipboard API means no button, and no lost capability', () => {
  it('T-PASTE-009a does not render the button when clipboard.read is absent', () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });

    render(<PasteButton batchReady onImagesPasted={vi.fn()} />);

    // Not disabled, not broken, not there. This is every `http://` origin.
    expect(screen.queryByRole('button', { name: /paste screenshot/i })).toBeNull();
  });

  it('T-PASTE-009b keeps Choose files and the drop target fully functional without it', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const onFilesAccepted = vi.fn();
    render(<ImageDropzone onFilesAccepted={onFilesAccepted} />);

    expect(screen.queryByRole('button', { name: /paste screenshot/i })).toBeNull();
    expect(screen.getByText(CHOOSE_FILES_LABEL)).toBeTruthy();

    const png = imageFile('still-works.png');
    await userEvent.setup().upload(screen.getByTestId('file-input'), png);
    expect(onFilesAccepted).toHaveBeenCalledWith([png], 'upload');

    fireEvent.drop(screen.getByTestId('drop-target'), { dataTransfer: { files: [png] } });
    expect(onFilesAccepted).toHaveBeenCalledWith([png], 'drop');
  });

  it('T-PASTE-009c leaves the desktop paste listener attached - it needs no secure context', () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const onFilesAccepted = vi.fn();
    render(<ImageDropzone batchReady onFilesAccepted={onFilesAccepted} />);

    const png = imageFile();
    act(() => {
      document.dispatchEvent(pasteEvent(transfer([png])));
    });

    expect(onFilesAccepted).toHaveBeenCalledWith([png], 'paste');
  });
});
