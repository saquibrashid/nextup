/**
 * TASK-260 — the owner's mobile mockup for the import flow.
 *
 * `T-PHONE-008` (the two phone screens) and `T-PHONE-009` (the phone
 * dropzone).
 *
 * ⚠ **`matchMedia` IS STUBBED, NOT MOCKED AWAY.** `useWideViewport` falls back
 * to the WIDE layout when the API is missing (jsdom), so a phone assertion
 * without the stub would render the desktop tree and pass for the wrong
 * reason. Every phone test first asserts the stepper is there.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WIDE_VIEWPORT_QUERY } from '../src/breakpoints';
import { ImageDropzone, PHONE_THUMBNAIL_LIMIT } from '../src/components/ImageDropzone';
import { UploadRoute } from '../src/containers/UploadRoute';
import {
  CHOOSE_FILES_LABEL,
  IMPORT_PHONE_TITLE,
  IMPORT_SCREENSHOTS_HEADING,
  SUBMIT_NEEDS_SELECTION,
  imagesAddedLabel,
} from '../src/copy';
import { apiClient, type CreatedBatch } from '../src/lib/apiClient';

function stubMatchMedia(wide: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === WIDE_VIEWPORT_QUERY ? wide : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
});

function client() {
  return {
    ...apiClient,
    listBatches: vi.fn(async () => ({ batches: [] })),
    createBatch: vi.fn(async (service: string, mode: string): Promise<CreatedBatch> => ({
      batchId: 'bat_1',
      service,
      mode,
      status: 'draft',
      createdAt: '2026-09-26T00:00:00Z',
    })),
  };
}

function mountUpload(wide = false): void {
  stubMatchMedia(wide);
  render(
    <MemoryRouter initialEntries={['/upload']}>
      <Routes>
        <Route path="/upload" element={<UploadRoute client={client()} />} />
        <Route path="/" element={<p>Library destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function png(name: string): File {
  return new File(['image'], name, { type: 'image/png' });
}

function attach(count: number): void {
  const files = Array.from({ length: count }, (_, index) => png(`shot-${String(index)}.png`));
  fireEvent.change(screen.getByTestId('file-input'), { target: { files } });
}

async function chooseBoth(): Promise<void> {
  fireEvent.click(await screen.findByRole('radio', { name: 'Netflix' }));
  fireEvent.click(within(screen.getByTestId('mode-card-append-only')).getByRole('radio'));
}

function stepStates(): (string | null)[] {
  return within(screen.getByTestId('import-stepper'))
    .getAllByRole('listitem')
    .map((step) => step.getAttribute('data-state'));
}

describe('T-PHONE-008 — the phone import is two screens, and Continue says why it waits', () => {
  it('T-PHONE-008a: the first screen asks the two questions with nothing pre-chosen', async () => {
    mountUpload();
    expect(await screen.findByRole('heading', { level: 1, name: IMPORT_PHONE_TITLE })).toBeTruthy();
    expect(stepStates()).toEqual(['current', 'upcoming', 'upcoming']);
    // ⚠ No mode is agreed to by default (US-003): the owner taps one.
    const modes = screen
      .getAllByRole('radio')
      .filter((radio) => radio.closest('[data-testid^="mode-card-"]'));
    expect(modes.length).toBe(2);
    for (const mode of modes) expect(mode).not.toBeChecked();
    expect(screen.getByTestId('import-continue')).toBeDisabled();
    expect(screen.getByTestId('import-continue-reason')).toHaveTextContent(SUBMIT_NEEDS_SELECTION);
    expect(screen.getByTestId('images-step-panel').closest('[hidden]')).not.toBeNull();
  });

  it('T-PHONE-008b: Continue opens the screenshots screen and focuses its heading', async () => {
    mountUpload();
    await chooseBoth();
    expect(stepStates()).toEqual(['done', 'done', 'upcoming']);
    expect(screen.queryByTestId('import-continue-reason')).toBeNull();
    fireEvent.click(screen.getByTestId('import-continue'));
    expect(stepStates()).toEqual(['done', 'done', 'current']);
    expect(screen.getByTestId('images-step-panel').closest('[hidden]')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Netflix' })).toBeNull();
    expect(
      screen.getByRole('radio', { name: 'Netflix', hidden: true }).closest('[hidden]'),
    ).not.toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: IMPORT_SCREENSHOTS_HEADING }),
      );
    });
  });

  it('T-PHONE-008c: going back keeps both answers and every held screenshot', async () => {
    mountUpload();
    await chooseBoth();
    fireEvent.click(screen.getByTestId('import-continue'));
    attach(2);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Service' }));
    expect(screen.getByRole('radio', { name: 'Netflix' })).toBeChecked();
    expect(within(screen.getByTestId('mode-card-append-only')).getByRole('radio')).toBeChecked();
    fireEvent.click(screen.getByTestId('import-continue'));
    expect(screen.getAllByTestId('accepted-file')).toHaveLength(2);
  });

  it('T-PHONE-008d: the close control leaves for the library, on the first screen only', async () => {
    mountUpload();
    await chooseBoth();
    fireEvent.click(screen.getByTestId('import-continue'));
    expect(screen.queryByTestId('import-close')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Mode' }));
    fireEvent.click(screen.getByTestId('import-close'));
    expect(screen.getByText('Library destination')).toBeTruthy();
  });

  it('T-PHONE-008e: the wide layout is untouched — no stepper, no Continue, no paging', async () => {
    mountUpload(true);
    await screen.findByRole('radio', { name: 'Netflix' });
    expect(screen.queryByTestId('import-stepper')).toBeNull();
    expect(screen.queryByTestId('import-continue')).toBeNull();
    expect(screen.getByTestId('images-step-panel').closest('[hidden]')).toBeNull();
  });
});

describe('T-PHONE-009 — the phone dropzone: tabs choose emphasis, never existence', () => {
  it('T-PHONE-009a: Choose files and the file input exist under every tab', () => {
    render(<ImageDropzone batchReady onClearAll={() => undefined} />);
    const tabs = within(screen.getByRole('group', { name: /add screenshots/i })).getAllByRole(
      'button',
    );
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    for (const tab of tabs) {
      fireEvent.click(tab);
      expect(tab).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText(CHOOSE_FILES_LABEL)).toBeTruthy();
      expect(screen.getByTestId('file-input')).toBeEnabled();
    }
  });

  it('T-PHONE-009b: the count reads "n images added" and Clear all calls the container', () => {
    const clear = vi.fn();
    render(<ImageDropzone batchReady onClearAll={clear} />);
    attach(3);
    expect(screen.getByTestId('dropzone-totals')).toHaveTextContent(imagesAddedLabel(3));
    expect(imagesAddedLabel(1)).toBe('1 image added');
    fireEvent.click(screen.getByTestId('dropzone-clear-all'));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('T-PHONE-009c: past six screenshots a +n tile stands for the rest and reveals them', () => {
    render(<ImageDropzone batchReady />);
    attach(8);
    expect(screen.getByTestId('accepted-list')).toHaveAttribute('data-collapsed', 'true');
    const more = screen.getByTestId('dropzone-show-more');
    expect(more).toHaveTextContent(`+${String(8 - PHONE_THUMBNAIL_LIMIT)}`);
    fireEvent.click(more);
    expect(screen.getByTestId('accepted-list')).not.toHaveAttribute('data-collapsed');
    expect(screen.queryByTestId('dropzone-show-more')).toBeNull();
    expect(screen.getAllByTestId('accepted-file')).toHaveLength(8);
  });

  it('T-PHONE-009d: exactly six screenshots show all six, with no tile', () => {
    render(<ImageDropzone batchReady />);
    attach(PHONE_THUMBNAIL_LIMIT + 1);
    expect(screen.queryByTestId('dropzone-show-more')).toBeNull();
  });

  it('T-PHONE-009e: without a container discard there is no Clear all', () => {
    render(<ImageDropzone batchReady />);
    attach(1);
    expect(screen.queryByTestId('dropzone-clear-all')).toBeNull();
  });
});
