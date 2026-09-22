import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from '../src/components/ui/Dialog';
import { RemoveTitleDialog } from '../src/components/RemoveTitleDialog';
import { SuppressDialog } from '../src/components/SuppressDialog';
import { AddTitleDialog } from '../src/components/AddTitleDialog';
import { FixMatchDialog } from '../src/components/FixMatchDialog';

describe('T-MOD-001 shared modal context', () => {
  it.each(['add', 'fix'] as const)(
    'T-MOD-001e: %s cannot dismiss while its write is pending',
    async (action) => {
      const user = userEvent.setup();
      const close = vi.fn();
      const searchTmdb = vi.fn().mockResolvedValue({
        items: [
          { tmdbId: 1, mediaType: 'movie', name: 'One', releaseYear: 2024, posterPath: null },
        ],
      });
      const pending = vi.fn(() => new Promise<never>(() => {}));
      render(
        action === 'add' ? (
          <AddTitleDialog searchTmdb={searchTmdb} addTitle={pending} onClose={close} />
        ) : (
          <FixMatchDialog
            titleId="one"
            name="One"
            badges={[]}
            searchTmdb={searchTmdb}
            fixMatch={pending}
            onClose={close}
          />
        ),
      );
      await user.type(screen.getByRole('searchbox'), 'One');
      await user.click(
        await screen.findByTestId(action === 'add' ? 'add-select-1' : 'select-result-1'),
      );
      if (action === 'add') await user.click(screen.getByRole('radio', { name: 'Netflix' }));
      await user.click(
        screen.getByTestId(action === 'add' ? 'confirm-add-title' : 'confirm-fix-match'),
      );
      expect(pending).toHaveBeenCalledOnce();
      await user.keyboard('{Escape}');
      fireEvent.click(screen.getByRole('dialog').parentElement!);
      expect(close).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    },
  );

  it('T-MOD-001a: default dialogs portal, lock scroll and restore existing background state', () => {
    document.documentElement.style.overflow = 'auto';
    document.documentElement.style.scrollbarGutter = 'auto';
    const alreadyInert = document.createElement('div');
    alreadyInert.setAttribute('inert', '');
    document.body.append(alreadyInert);
    const { container, unmount } = render(
      <Dialog aria-labelledby="modal-heading" onDismiss={vi.fn()}>
        <h2 id="modal-heading">Confirm action</h2>
        <button>Cancel</button>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(dialog).toHaveClass('dialog--overlay');
    expect(dialog.parentElement).toHaveClass('dialog-backdrop');
    expect(container).toHaveAttribute('inert');
    expect(document.documentElement.style.overflow).toBe('hidden');
    unmount();
    expect(container).not.toHaveAttribute('inert');
    expect(alreadyInert).toHaveAttribute('inert');
    expect(document.documentElement.style.overflow).toBe('auto');
    expect(document.documentElement.style.scrollbarGutter).toBe('auto');
    alreadyInert.remove();
    document.documentElement.style.overflow = '';
    document.documentElement.style.scrollbarGutter = '';
  });

  it('T-MOD-001b: removal starts on Cancel and cannot dismiss during remove or undo', async () => {
    const user = userEvent.setup();
    let remove!: (result: { titleId: string; removedListingIds: string[] }) => void;
    let undo!: () => void;
    const close = vi.fn();
    render(
      <RemoveTitleDialog
        titleId="one"
        name="One"
        removeTitle={() =>
          new Promise((resolve) => {
            remove = resolve;
          })
        }
        restoreListing={() =>
          new Promise<void>((resolve) => {
            undo = resolve;
          })
        }
        onRowState={vi.fn()}
        onClose={close}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(screen.getByTestId('confirm-remove-title'));
    await user.keyboard('{Escape}');
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(close).not.toHaveBeenCalled();
    await act(async () => remove({ titleId: 'one', removedListingIds: ['listing'] }));
    await user.click(screen.getByTestId('undo-remove-title'));
    await user.keyboard('{Escape}');
    expect(close).not.toHaveBeenCalled();
    await act(async () => undo());
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledOnce();
  });

  it('T-MOD-001c: suppression cannot close during its write or undo', async () => {
    let finish!: () => void;
    let restore!: () => void;
    const close = vi.fn();
    render(
      <SuppressDialog
        titleId="one"
        name="One"
        suppress={() =>
          new Promise((resolve) => {
            finish = () =>
              resolve({
                suppressionId: 'sup',
                workIdentity: 'tmdb:movie:1',
                alreadySuppressed: false,
              });
          })
        }
        unsuppress={() =>
          new Promise<void>((resolve) => {
            restore = resolve;
          })
        }
        onRowState={vi.fn()}
        onClose={close}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Not interested' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    await act(async () => finish());
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    await act(async () => restore());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(['next', 'previous', 'heading'] as const)(
    'T-MOD-001d: closing after a removed row focuses a surviving %s without scrolling',
    (fallback) => {
      function Example() {
        const [open, setOpen] = useState(false);
        const [removed, setRemoved] = useState(false);
        return (
          <main>
            <h1>Library</h1>
            <ul>
              {fallback === 'previous' && (
                <li>
                  <button>Previous</button>
                </li>
              )}
              {!removed && (
                <li>
                  <button onClick={() => setOpen(true)}>Open</button>
                </li>
              )}
              {fallback === 'next' && (
                <li>
                  <button>Next</button>
                </li>
              )}
            </ul>
            {open && (
              <Dialog aria-labelledby="delete-heading" onDismiss={() => setOpen(false)}>
                <h2 id="delete-heading">Delete</h2>
                <button onClick={() => setRemoved(true)}>Remove</button>
                <button onClick={() => setOpen(false)}>Close</button>
              </Dialog>
            )}
          </main>
        );
      }
      render(<Example />);
      const trigger = screen.getByRole('button', { name: 'Open' });
      trigger.focus();
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      const target =
        fallback === 'heading'
          ? screen.getByRole('heading', { name: 'Library' })
          : screen.getByRole('button', { name: fallback === 'next' ? 'Next' : 'Previous' });
      const focus = vi.spyOn(target, 'focus');
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
      expect(target).toHaveFocus();
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    },
  );
});
