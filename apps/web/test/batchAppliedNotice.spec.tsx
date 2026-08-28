/**
 * TASK-091 / `T-UX-065` — US-017 AC-1: *"the undo affordance is offered
 * immediately after confirmation"*.
 *
 * ⚠ **THE POINT OF THIS SUITE IS THAT THE RIGHT UNDO IS OFFERED, NOT THAT A
 * BUTTON EXISTS.** There are two server undos with different admission rules
 * (§6.25 refuses anything that is not creates-only; §6.26 reverses a removal
 * group), so a notice that always rendered "Undo this batch" would satisfy a
 * naive presence assertion and then 409 for every full-update close — the
 * exact batches whose undo US-017 exists for. Every case below therefore
 * asserts the endpoint that was called with the id that was passed, not just
 * the label.
 *
 * ⚠ **`T-UX-065c` IS THE CONTRAST CASE.** Without a batch that can offer
 * nothing, an implementation that offers the removal undo unconditionally
 * passes everything else here.
 */

import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ListPage } from '../src/pages/ListPage';

import {
  BatchAppliedNotice,
  appliedSummary,
  undoOffer,
  UNDO_BATCH_LABEL,
  UNDO_FAILED_BODY,
  UNDO_PENDING_LABEL,
  UNDO_REMOVALS_LABEL,
  VIEW_CHANGES_LABEL,
  type AppliedBatch,
} from '../src/components/BatchAppliedNotice';

function applied(
  over: Partial<AppliedBatch['summary']> = {},
  rest: Partial<AppliedBatch> = {},
): AppliedBatch {
  return {
    batchId: 'batch-1',
    service: 'netflix',
    undoable: false,
    ...rest,
    summary: {
      listingsCreated: 9,
      listingsRemoved: 0,
      removalGroupId: null,
      ...over,
    },
  };
}

/** A full-update close that actually removed something. */
const withRemovals = applied({ listingsRemoved: 3, removalGroupId: 'group-7' });
/** An append-only close that only created — the §6.25 case. */
const createsOnly = applied({}, { undoable: true });

function mount(
  batch: AppliedBatch,
  handlers: Partial<{ group: () => Promise<unknown>; batch: () => Promise<unknown> }> = {},
) {
  const group = vi.fn(handlers.group ?? (() => Promise.resolve({})));
  const whole = vi.fn(handlers.batch ?? (() => Promise.resolve({})));
  render(<BatchAppliedNotice applied={batch} undoRemovalGroup={group} undoBatch={whole} />);
  return { group, whole };
}

describe('BatchAppliedNotice — T-UX-065', () => {
  it('T-UX-065a: a batch that removed titles offers the removal-group undo, keyed on the group the server returned', async () => {
    const { group, whole } = mount(withRemovals);

    await userEvent.click(screen.getByRole('button', { name: UNDO_REMOVALS_LABEL }));

    expect(group).toHaveBeenCalledWith('group-7');
    // ⚠ The batch undo must NOT also fire: §6.25 would 409, and the owner
    // would read a failure for an undo that in fact succeeded.
    expect(whole).not.toHaveBeenCalled();
  });

  it('T-UX-065b: a creates-only batch offers the batch undo, keyed on the batch id', async () => {
    const { group, whole } = mount(createsOnly);

    await userEvent.click(screen.getByRole('button', { name: UNDO_BATCH_LABEL }));

    expect(whole).toHaveBeenCalledWith('batch-1');
    expect(group).not.toHaveBeenCalled();
  });

  it('T-UX-065c: a batch that is neither offers no undo control at all, only the history link', () => {
    mount(applied());

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link', { name: VIEW_CHANGES_LABEL })).toHaveAttribute(
      'href',
      '/batches/batch-1',
    );
  });

  it('T-UX-065d: the undo and the history link are mutually exclusive in every case', () => {
    for (const batch of [withRemovals, createsOnly, applied()]) {
      const { unmount } = render(
        <BatchAppliedNotice applied={batch} undoRemovalGroup={vi.fn()} undoBatch={vi.fn()} />,
      );
      const undo = screen.queryByRole('button');
      const link = screen.queryByRole('link', { name: VIEW_CHANGES_LABEL });
      expect([undo, link].filter((node) => node !== null)).toHaveLength(1);
      unmount();
    }
  });

  it('T-UX-065e: a zero-member removal group is not offered as a removal undo', () => {
    // Unticking every removal still records a group (US-015 AC-5); nothing was
    // removed, so there is nothing to put back.
    mount(applied({ listingsRemoved: 0, removalGroupId: 'group-empty' }, { undoable: true }));

    expect(screen.queryByRole('button', { name: UNDO_REMOVALS_LABEL })).toBeNull();
    expect(screen.getByRole('button', { name: UNDO_BATCH_LABEL })).toBeInTheDocument();
  });

  it('T-UX-065f: the summary names what happened, in a live region, before any undo', () => {
    mount(withRemovals);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Added 9 titles, removed 3 titles from Netflix.',
    );
  });

  it('T-UX-065g: the undo is disabled while it is in flight and says so', async () => {
    let resolve = (): void => {};
    mount(withRemovals, {
      group: () =>
        new Promise((r) => {
          resolve = () => {
            r({});
          };
        }),
    });

    await userEvent.click(screen.getByRole('button', { name: UNDO_REMOVALS_LABEL }));

    const pending = screen.getByRole('button', { name: UNDO_PENDING_LABEL });
    expect(pending).toBeDisabled();
    await act(async () => {
      resolve();
    });
  });

  it('T-UX-065h: a successful undo replaces the summary and withdraws the control', async () => {
    mount(withRemovals);

    await userEvent.click(screen.getByRole('button', { name: UNDO_REMOVALS_LABEL }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Those titles are back on your list.');
    });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('T-UX-065i: a failed undo says the changes are still applied and keeps the control offerable', async () => {
    const { group } = mount(withRemovals, { group: () => Promise.reject(new Error('500')) });

    await userEvent.click(screen.getByRole('button', { name: UNDO_REMOVALS_LABEL }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(UNDO_FAILED_BODY);
    });
    // ⚠ Retry must remain possible: the removal stands, and this control is
    // the only thing that reverses it.
    const retry = screen.getByRole('button', { name: UNDO_REMOVALS_LABEL });
    expect(retry).toBeEnabled();
    await userEvent.click(retry);
    expect(group).toHaveBeenCalledTimes(2);
  });

  it('T-UX-065j: nothing is requested until the owner asks — the notice never undoes on mount', () => {
    const { group, whole } = mount(withRemovals);

    expect(group).not.toHaveBeenCalled();
    expect(whole).not.toHaveBeenCalled();
  });

  it('T-UX-065q: a batch that removed titles offers the removal undo even if the server also flags it undoable', async () => {
    // ⚠ Defensive, and deliberately so. `undoable` and a non-empty removal
    // group are contradictory (`packages/domain/src/undo.ts`), but if the
    // server ever says both, the batch undo would 409 while the removal undo
    // is the one that reverses what the owner just saw happen.
    const { group, whole } = mount(
      applied({ listingsRemoved: 3, removalGroupId: 'group-7' }, { undoable: true }),
    );

    await userEvent.click(screen.getByRole('button', { name: UNDO_REMOVALS_LABEL }));

    expect(group).toHaveBeenCalledWith('group-7');
    expect(whole).not.toHaveBeenCalled();
  });

  it('T-UX-065k: undoOffer refuses a removal with no group id rather than inventing one', () => {
    expect(undoOffer(applied({ listingsRemoved: 3, removalGroupId: null }))).toEqual({
      kind: 'none',
    });
  });
});

describe('appliedSummary — the four arithmetic cases', () => {
  it('T-UX-065l: both counts, one count each way, and neither are all stated', () => {
    expect(appliedSummary(withRemovals)).toBe('Added 9 titles, removed 3 titles from Netflix.');
    expect(appliedSummary(applied({ listingsCreated: 1 }))).toBe('Added 1 title from Netflix.');
    expect(
      appliedSummary(applied({ listingsCreated: 0, listingsRemoved: 2, removalGroupId: 'g' })),
    ).toBe('Removed 2 titles from Netflix.');
    // ⚠ A close that applied nothing must still say something, or it reads as
    // a close that failed.
    expect(appliedSummary(applied({ listingsCreated: 0 }))).toBe(
      'Nothing changed on your Netflix list.',
    );
  });

  it('T-UX-065m: the service is named from the batch, not hardcoded', () => {
    expect(appliedSummary(applied({}, { service: 'max' }))).toBe('Added 9 titles from Max.');
  });
});

describe('the notice on `/` — ux-states.md §6.13', () => {
  function mountList(props: Record<string, unknown>) {
    render(
      <MemoryRouter>
        <ListPage items={[]} total={0} {...props} />
      </MemoryRouter>,
    );
  }

  it('T-UX-065n: `/` shows the notice when the owner arrives from a close, and not otherwise', () => {
    mountList({});
    expect(screen.queryByTestId('applied-notice')).toBeNull();
    cleanup();

    mountList({ applied: withRemovals, onUndoRemovalGroup: vi.fn(), onUndoBatch: vi.fn() });
    expect(screen.getByRole('button', { name: UNDO_REMOVALS_LABEL })).toBeInTheDocument();
  });

  it('T-UX-065o: a failed list read does not take the undo away', () => {
    // ⚠ The write already happened. Hiding the undo because `GET /api/titles`
    // failed removes the remedy at the moment the owner cannot see the damage.
    mountList({
      loadFailed: true,
      applied: withRemovals,
      onUndoRemovalGroup: vi.fn(),
      onUndoBatch: vi.fn(),
    });

    expect(screen.getByRole('button', { name: UNDO_REMOVALS_LABEL })).toBeInTheDocument();
  });

  it('T-UX-065p: an unwired undo handler fails loudly rather than claiming success', async () => {
    mountList({ applied: withRemovals });

    await userEvent.click(screen.getByRole('button', { name: UNDO_REMOVALS_LABEL }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(UNDO_FAILED_BODY);
    });
  });
});
