/**
 * `T-A11Y-006` — *"Dialogs trap focus, restore it to the trigger on close, and
 * close on `Escape`"* (`specs/ui.md` §9 focus-order row).
 *
 * ⚠ ALL THREE DIALOGS SHIPPED WITH `aria-modal="true"` AND NONE OF THE
 * BEHAVIOUR IT PROMISES. That combination is worse than an unlabelled div:
 * `aria-modal` tells assistive technology the rest of the page is inert, so a
 * screen-reader user who tabs out of an untrapped dialog lands in content
 * their software has been told does not exist, with nothing to signal they
 * have left. The attribute was a claim the code did not honour.
 *
 * ⚠ `T-A11Y-006e` IS THE ONE THAT KEEPS THIS TRUE. Every behavioural case
 * below mounts a dialog the author remembered to wire; none of them says a
 * word about the fourth dialog added next quarter. That case reads the source
 * instead: every component asserting `aria-modal` must call `useDialogFocus`.
 * Without it this id is a snapshot of today's three components, and a green
 * suite is exactly what a newly-untrapped dialog would produce.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REMOVAL_CANCEL_LABEL, REMOVAL_CONFIRM_LABEL } from '../src/copy';
import { RemovalConfirmDialog } from '../src/components/RemovalConfirmDialog';
import { SuppressDialog } from '../src/components/SuppressDialog';
import type { ReviewRemovalItem } from '@nextup/domain';

afterEach(cleanup);

// ⚠ NOT `fileURLToPath(import.meta.url)` — the `web` project runs in jsdom,
// where `import.meta.url` is an http URL and that call THROWS at import time,
// failing the whole file in a way that reads as a broken test rather than a
// failed assertion. Same pattern as `stylesheet.spec.ts`.
const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const COMPONENTS = join(WEB_ROOT, 'src', 'components');

function removal(n: number, ticked: boolean): ReviewRemovalItem {
  return {
    listingId: `l${String(n)}`,
    titleId: `t${String(n)}`,
    name: `Gone ${String(n)}`,
    ticked,
  } as unknown as ReviewRemovalItem;
}

const ITEMS = [removal(1, true), removal(2, true)];

describe('T-A11Y-006 dialogs trap focus, restore it, and close on Escape', () => {
  it('T-A11Y-006a: opening moves focus INTO the dialog, not to the body', () => {
    render(
      <RemovalConfirmDialog
        service="netflix"
        items={ITEMS}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );

    const dialog = screen.getByTestId('removal-confirm');
    expect(dialog.contains(document.activeElement)).toBe(true);
    // Cancel is first in the DOM deliberately (a destructive confirmation must
    // not open with the destructive control focused), so it is what receives it.
    expect(document.activeElement).toBe(screen.getByText(REMOVAL_CANCEL_LABEL));
  });

  it('T-A11Y-006b: Tab cycles WITHIN the dialog instead of leaving it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside</button>
        <RemovalConfirmDialog
          service="netflix"
          items={ITEMS}
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />
      </>,
    );

    const cancel = screen.getByText(REMOVAL_CANCEL_LABEL);
    const confirm = screen.getByText(REMOVAL_CONFIRM_LABEL);
    expect(document.activeElement).toBe(cancel);

    await user.tab();
    expect(document.activeElement).toBe(confirm);

    // ⚠ The assertion that matters: from the LAST control, Tab must come back
    // to the first, NOT reach the button outside the dialog.
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    expect(document.activeElement).not.toBe(screen.getByText('outside'));

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('T-A11Y-006c: Escape dismisses, and dismisses to CANCEL rather than confirm', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <RemovalConfirmDialog
        service="netflix"
        items={ITEMS}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
    /*
      ⚠ This dialog authorises deletions (REQ-020) and is the only confirmation
      in the product. Wiring Escape to the confirming handler would turn the
      universal "get me out of here" gesture into the destructive action.
    */
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('T-A11Y-006d: closing returns focus to the control that opened it', async () => {
    const user = userEvent.setup();

    function Harness(): React.JSX.Element {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            open the dialog
          </button>
          {open && (
            <RemovalConfirmDialog
              service="netflix"
              items={ITEMS}
              onConfirm={() => undefined}
              onCancel={() => setOpen(false)}
            />
          )}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByText('open the dialog');
    await user.click(trigger);
    expect(document.activeElement).not.toBe(trigger);

    await user.keyboard('{Escape}');

    /*
      ⚠ Not a courtesy. Every dialog here opens from a control part-way down a
      long list; unmounting without restoring drops focus to `<body>`, so the
      next Tab restarts at the top of the document and the owner loses their
      place with nothing on screen to say so.
    */
    expect(screen.queryByTestId('removal-confirm')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('T-A11Y-006e: EVERY component claiming `aria-modal` uses the hook', () => {
    /*
      ⚠ THE CASES ABOVE CANNOT MAKE THIS CLAIM. They each mount a dialog
      someone remembered to wire. A fourth dialog added later, with
      `aria-modal="true"` copied from its neighbours and no focus handling,
      leaves all of them green — which is precisely the state this whole id was
      written to end. So the expected set is READ OFF THE SOURCE rather than
      listed here, and cannot drift from it.
    */
    const modal = readdirSync(COMPONENTS)
      .filter((file) => file.endsWith('.tsx'))
      .filter((file) => readFileSync(join(COMPONENTS, file), 'utf8').includes('aria-modal'));

    // Non-vacuity floor: if the detector matches nothing, it proves nothing.
    expect(modal.length).toBeGreaterThanOrEqual(3);

    const unwired = modal.filter((file) => {
      /*
        ⚠ `useDialogFocus(` — THE CALL, not the identifier. A mutation that
        deleted the call from `SuppressDialog` while leaving its import
        SURVIVED an earlier version of this assertion, which searched for the
        bare name. An unused import is exactly what a half-finished wiring
        leaves behind, so the bare name matches precisely the case this is
        meant to catch.
      */
      return !readFileSync(join(COMPONENTS, file), 'utf8').includes('useDialogFocus(');
    });
    expect(unwired).toEqual([]);
  });

  it('T-A11Y-006f: focus never rests on a control disabled mid-close', () => {
    /*
      §6.12 disables every control while the close is in flight. A trap that
      still cycles through them strands focus on something the owner cannot
      operate, so the dialog element itself carries `tabIndex={-1}` and takes
      focus instead. Without that, focus falls to `<body>` at exactly the
      moment the dialog claims the page is inert.
    */
    render(
      <RemovalConfirmDialog
        service="netflix"
        items={ITEMS}
        onConfirm={() => undefined}
        onCancel={() => undefined}
        submitting
      />,
    );

    const dialog = screen.getByTestId('removal-confirm');
    expect(document.activeElement).toBe(dialog);
    expect((document.activeElement as HTMLElement).hasAttribute('disabled')).toBe(false);
  });

  it('T-A11Y-006g: the suppress dialog honours the same contract', async () => {
    /*
      A second real dialog, not a repeat: `T-A11Y-006a`-`d` would all pass with
      the hook wired into exactly one component, and `SuppressDialog` renders
      its `aria-modal` div in a different shape (no `data-testid`, heading
      first).
    */
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SuppressDialog
        titleId="t1"
        name="Gone 1"
        suppress={() => new Promise(() => {})}
        unsuppress={() => new Promise(() => {})}
        onRowState={() => undefined}
        onClose={onClose}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
