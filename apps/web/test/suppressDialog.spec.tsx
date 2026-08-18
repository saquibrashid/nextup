/**
 * TASK-102 — `components/SuppressDialog.tsx`.
 *
 * `T-UX-085` — US-027 AC-6: a persistence failure returns the row and shows an
 * error; never a silent optimistic hide.
 * `T-UX-022`  — US-029 AC-5 / `specs/ux-states.md` §2.14: an undo affordance is
 * offered immediately after suppressing, in a `role="status"` message.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  ALREADY_SUPPRESSED_BODY,
  SUPPRESS_FAILED_BODY,
  SUPPRESS_SUCCESS_BODY,
  SUPPRESS_UNDONE_BODY,
  SuppressDialog,
  withName,
  type RowState,
  type SuppressResult,
} from '../src/components/SuppressDialog';
import { SUPPRESS_CONFIRM_BODY } from '../src/copy';

const NAME = 'Dune';
const TITLE_ID = '01J8ZE0000000000000000000T';
const SUPPRESSION_ID = 'supp:tmdb:movie:438631';

const result = (over: Partial<SuppressResult> = {}): SuppressResult => ({
  suppressionId: SUPPRESSION_ID,
  workIdentity: 'tmdb:movie:438631',
  alreadySuppressed: false,
  ...over,
});

function mount(
  over: {
    suppress?: (titleId: string) => Promise<SuppressResult>;
    unsuppress?: (suppressionId: string) => Promise<unknown>;
  } = {},
) {
  const states: RowState[] = [];
  const suppress = vi.fn(over.suppress ?? (() => Promise.resolve(result())));
  const unsuppress = vi.fn(over.unsuppress ?? (() => Promise.resolve({})));
  const onClose = vi.fn();
  render(
    <SuppressDialog
      titleId={TITLE_ID}
      name={NAME}
      suppress={suppress}
      unsuppress={unsuppress}
      onRowState={(s) => states.push(s)}
      onClose={onClose}
    />,
  );
  return { states, suppress, unsuppress, onClose, user: userEvent.setup() };
}

const confirmButton = () => screen.getByRole('button', { name: 'Not interested' });

describe('T-UX-085 - a failed suppression returns the row and states the error', () => {
  it('T-UX-085a never reports the row as suppressed when the request rejects', async () => {
    const { states, user } = mount({ suppress: () => Promise.reject(new Error('500')) });

    await user.click(confirmButton());
    await screen.findByRole('alert');

    // The heart of US-027 AC-6. A component that hid the row first and only
    // reconciled afterwards would still end on 'present', so the assertion is
    // that 'suppressed' is never reported AT ALL on this path.
    expect(states).not.toContain('suppressed');
    expect(states.at(-1)).toBe('present');
  });

  it('T-UX-085b shows an error that says nothing changed', async () => {
    const { user } = mount({ suppress: () => Promise.reject(new Error('500')) });

    await user.click(confirmButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(withName(SUPPRESS_FAILED_BODY, NAME));
    expect(alert.textContent).toContain(NAME);
  });

  it('T-UX-085c offers no undo after a failure - there is nothing to undo', async () => {
    const { user } = mount({ suppress: () => Promise.reject(new Error('500')) });

    await user.click(confirmButton());
    await screen.findByRole('alert');

    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('T-UX-085d leaves the failed suppression retryable', async () => {
    const suppress = vi
      .fn<[string], Promise<SuppressResult>>()
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValueOnce(result());
    const { states, user } = mount({ suppress });

    await user.click(confirmButton());
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByRole('status');
    expect(suppress).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toBe('suppressed');
  });

  it('T-UX-085e dims rather than hides while the request is in flight', async () => {
    let settle: (r: SuppressResult) => void = () => {};
    const { states, user } = mount({
      suppress: () =>
        new Promise<SuppressResult>((resolve) => {
          settle = resolve;
        }),
    });

    await user.click(confirmButton());
    expect(states).toEqual(['pending']);

    settle(result());
    await screen.findByRole('status');
    expect(states).toEqual(['pending', 'suppressed']);
  });

  it('T-UX-085f suppresses by title id and never by a row-scoped key it invented', async () => {
    const { suppress, user } = mount();

    await user.click(confirmButton());
    await screen.findByRole('status');

    // REQ-071: the work identity is derived server-side from the title id
    // (`specs/api.md` §6.6). The client must pass the id through untouched.
    expect(suppress).toHaveBeenCalledWith(TITLE_ID);
  });
});

describe('T-UX-022 - undo is offered immediately, and rolls back if it fails', () => {
  it('T-UX-022a announces the success in a role="status" message naming the work', async () => {
    const { user } = mount();

    await user.click(confirmButton());

    const status = await screen.findByRole('status');
    expect(status.textContent).toBe(withName(SUPPRESS_SUCCESS_BODY, NAME));
  });

  it('T-UX-022b offers Undo in the same render as the success message', async () => {
    const { user } = mount();

    await user.click(confirmButton());

    const status = await screen.findByRole('status');
    expect(status).toBeTruthy();
    // "Immediately" — not behind a second click, not on another page.
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('T-UX-022c undo un-suppresses through the returned suppression id', async () => {
    const { unsuppress, user } = mount();

    await user.click(confirmButton());
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(unsuppress).toHaveBeenCalledWith(SUPPRESSION_ID));
  });

  it('T-UX-022d returns the row to the list once undo succeeds', async () => {
    const { states, user } = mount();

    await user.click(confirmButton());
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(states.at(-1)).toBe('present'));
    expect(states).toEqual(['pending', 'suppressed', 'pending', 'present']);
  });

  it('T-UX-022e says plainly that undo does not bring removed listings back', async () => {
    const { user } = mount();

    await user.click(confirmButton());
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    // `specs/api.md` §6.8: `restoredAnything` is always false, so the copy must
    // not imply a restore.
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(withName(SUPPRESS_UNDONE_BODY, NAME)),
    );
  });

  it('T-UX-022f keeps the row hidden when undo itself fails', async () => {
    const { states, user } = mount({ unsuppress: () => Promise.reject(new Error('500')) });

    await user.click(confirmButton());
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    // The suppression is still persisted, so showing the row again would lie.
    await waitFor(() => expect(states.at(-1)).toBe('suppressed'));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('T-UX-022g reports an idempotent 200 as already-suppressed, not as a new hide', async () => {
    const { states, user } = mount({
      suppress: () => Promise.resolve(result({ alreadySuppressed: true })),
    });

    await user.click(confirmButton());

    const status = await screen.findByRole('status');
    expect(status.textContent).toBe(withName(ALREADY_SUPPRESSED_BODY, NAME));
    expect(states.at(-1)).toBe('suppressed');
    // Nothing changed, so there is nothing to undo — §3.2 offers Close only.
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('T-UX-022h states the consequence before asking for confirmation', async () => {
    mount();

    expect(screen.getByText(withName(SUPPRESS_CONFIRM_BODY, NAME))).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('T-UX-022i cancels without touching the list or the server', async () => {
    const { states, suppress, onClose, user } = mount();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(suppress).not.toHaveBeenCalled();
    expect(states).toEqual([]);
  });

  it('T-UX-022j closes from the success state without re-showing the row', async () => {
    const { states, onClose, user } = mount();

    await user.click(confirmButton());
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe('suppressed');
  });

  it('T-UX-022k disables the undo control while the un-suppress is in flight', async () => {
    let settle: () => void = () => {};
    const { user } = mount({
      unsuppress: () =>
        new Promise((resolve) => {
          settle = () => resolve({});
        }),
    });

    await user.click(confirmButton());
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    const busy = screen.getByRole('button', { name: 'Undoing…' });
    expect(busy).toHaveProperty('disabled', true);

    settle();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(NAME));
  });

  it('T-UX-022l substitutes the work name rather than leaving the placeholder', () => {
    expect(withName(SUPPRESS_CONFIRM_BODY, NAME)).not.toContain('{name}');
    expect(withName(SUPPRESS_CONFIRM_BODY, NAME)).toContain(NAME);
  });
});
