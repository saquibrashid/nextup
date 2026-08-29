// `T-UI-013` — the client does not hide the diagnosis (TASK-155, `A43-M3`,
// `specs/ui.md` §3.2a, `specs/ux-states.md` §4.6a/§4.6b, US-004 AC-11).
//
// ⚠ WHAT THIS FILE IS ACTUALLY GUARDING. The server text specified by
// `api.md` §5.2.4 is long, names a dollar figure and cites a runbook path. It
// is the exact shape of message a well-meaning front end shortens into
// *"Upload failed"*, tucks behind a "details" disclosure, or drops into a
// toast that fades after four seconds. Every one of those looks like polish in
// review and every one of them re-opens `RSK-016` — the risk the owner paid
// for this containment to close. So the assertions below are mostly about what
// the client MUST NOT do, and they are deliberately hostile:
//
//   - the reason is compared with `.textContent` and `toBe`, so a re-wrap or a
//     truncation fails even though the text still "looks right";
//   - the card is asserted NOT to be inside a `<details>` and NOT to carry a
//     live-region/alert role that auto-dismisses;
//   - the remedy link is asserted ABSENT for `IMAGE_DECODE_FAILED`, because
//     offering it there sends the owner to buy memory that cannot help.

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ImageDropzone } from '../src/components/ImageDropzone';
import type { ServerRejection } from '../src/components/RejectionList';
import { DECODE_BATCH_UNAFFECTED, DECODE_REMEDY_LINK_LABEL, MEMORY_REMEDY_PATH } from '../src/copy';

/** `api.md` §5.2.4, exactly as the server composes it. */
const GUARD_MESSAGE =
  'beach-list-03.heic is 48.0 MP (8064 × 5952). nextup decodes images in a 0.5 GiB ' +
  'container and refuses anything above 25.0 MP before allocating memory, because ' +
  'decoding this one would exhaust container memory and kill the import. This is a ' +
  'memory limit, not a problem with your image. Remedy: up-size compute to 0.5 vCPU / ' +
  '1.0 GiB (+~$4/month) — one command, see docs/runbooks/scale-up-memory.md. No other ' +
  'image in this batch was affected; re-attach this file after up-sizing.';

const OOM_MESSAGE =
  'beach-list-03.heic ran out of memory while being decoded (HEIC → PNG) in the 0.5 GiB ' +
  'container. This is a memory limit, not a corrupt file. Remedy: up-size compute to ' +
  '0.5 vCPU / 1.0 GiB (+~$4/month) — docs/runbooks/scale-up-memory.md. Only this image ' +
  'failed; the rest of the batch is intact and nothing has been committed. Re-attach ' +
  'this file after up-sizing.';

const CORRUPT_MESSAGE =
  "truncated.heic couldn't be read — the file appears to be corrupt or incomplete. " +
  'Try re-exporting or re-taking the screenshot and attaching it again. Only this ' +
  'image failed; the rest of the batch is intact.';

const GUARD: ServerRejection = {
  fileName: 'beach-list-03.heic',
  code: 'IMAGE_TOO_LARGE_TO_DECODE',
  message: GUARD_MESSAGE,
  details: { width: 8064, height: 5952, megapixels: 48, maxMegapixels: 25 },
};

const OOM: ServerRejection = {
  fileName: 'beach-list-03.heic',
  code: 'IMAGE_DECODE_OOM',
  message: OOM_MESSAGE,
  // ⚠ DIMENSIONS DELIBERATELY PRESENT ON A NON-GUARD CODE. Without them
  // `T-UI-013e` passes for the wrong reason — the facts line would be absent
  // because there was nothing to render, not because the code is scoped. A
  // mutant that dropped the `IMAGE_TOO_LARGE_TO_DECODE` check walked straight
  // through the weaker fixture.
  details: { width: 8064, height: 5952, megapixels: 48, maxMegapixels: 25 },
};

const CORRUPT: ServerRejection = {
  fileName: 'truncated.heic',
  code: 'IMAGE_DECODE_FAILED',
  message: CORRUPT_MESSAGE,
  details: { width: 8064, height: 5952, megapixels: 48, maxMegapixels: 25 },
};

function renderWith(rejected: readonly ServerRejection[]) {
  return render(<ImageDropzone batchReady serverRejected={rejected} />);
}

describe('T-UI-013 — the diagnostic reaches the owner intact', () => {
  it.each([
    ['IMAGE_TOO_LARGE_TO_DECODE', GUARD, GUARD_MESSAGE],
    ['IMAGE_DECODE_OOM', OOM, OOM_MESSAGE],
    ['IMAGE_DECODE_FAILED', CORRUPT, CORRUPT_MESSAGE],
  ] as const)('T-UI-013a: %s renders the server message verbatim', (_code, rejection, text) => {
    renderWith([rejection]);
    // ⚠ `.textContent` + `toBe`, NOT `toHaveTextContent`: the latter normalises
    // whitespace, so a client that re-wrapped or re-punctuated the specified
    // text would pass. Verbatim means verbatim.
    expect(screen.getByTestId('rejected-reason').textContent).toBe(text);
    expect(screen.getByTestId('rejected-name').textContent).toBe(rejection.fileName);
  });

  it('T-UI-013b: the message is not truncated and not behind a disclosure', () => {
    renderWith([GUARD]);
    const reason = screen.getByTestId('rejected-reason');

    // `ui.md` §3.2a item 2, all three of its prohibitions.
    expect(reason.textContent?.length).toBe(GUARD_MESSAGE.length);
    expect(reason.textContent).not.toContain('…');
    expect(reason.closest('details')).toBeNull();
    // A toast auto-dismisses; a card does not. `status`/`alert` are how the
    // dismissing variety is usually announced, and neither belongs here.
    expect(reason.closest('[role="status"]')).toBeNull();
    expect(reason.closest('[role="alert"]')).toBeNull();
  });

  it('T-UI-013c: the message is still present after the time a toast would have gone', async () => {
    renderWith([GUARD]);
    // Not a fake-timer assertion on purpose: the failure mode is a component
    // that schedules its own dismissal, and the only honest check is that the
    // node is still there later. If this ever needs `vi.advanceTimersByTime`,
    // something is scheduling a dismissal and that is the defect.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitFor(() => {
      expect(screen.getByTestId('rejected-reason').textContent).toBe(GUARD_MESSAGE);
    });
  });

  it('T-UI-013d: the guard rejection shows the dimension facts as secondary text', () => {
    renderWith([GUARD]);
    // `ui.md` §3.2a item 3 — MEGApixels to one decimal, and the LIMIT the
    // server computed, never one the client holds.
    expect(screen.getByTestId('rejected-facts').textContent).toBe(
      '8064 × 5952 · 48.0 MP · limit 25.0 MP',
    );
  });

  it('T-UI-013e: the facts line is absent for the two non-guard codes', () => {
    renderWith([OOM, CORRUPT]);
    expect(screen.queryByTestId('rejected-facts')).toBeNull();
  });

  it('T-UI-013f: both MEMORY codes offer the remedy, as a link AND as literal text', () => {
    renderWith([GUARD, OOM]);
    const links = screen.getAllByTestId('rejected-remedy');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.textContent).toBe(DECODE_REMEDY_LINK_LABEL);
      expect(link.getAttribute('href')).toContain(MEMORY_REMEDY_PATH);
    }
    // ⚠ `ui.md` §3.2a item 4 — "rendered as literal text as well as a link, so
    // it survives being read in a screenshot or a copied error report". That
    // is exactly how this failure will be reported, and a bare anchor loses
    // the path the moment the page becomes an image.
    const paths = screen.getAllByTestId('rejected-remedy-path').map((el) => el.textContent);
    expect(paths).toEqual([MEMORY_REMEDY_PATH, MEMORY_REMEDY_PATH]);
  });

  it('T-UI-013g: IMAGE_DECODE_FAILED offers NO remedy link and no remedy path', () => {
    renderWith([CORRUPT]);
    // More memory can never fix a truncated file. Offering the remedy here
    // sends the owner to spend money they do not need to spend
    // (`api.md` §5.2.3, product invariant 15).
    expect(screen.queryByTestId('rejected-remedy')).toBeNull();
    expect(screen.queryByTestId('rejected-remedy-path')).toBeNull();
    expect(screen.getByTestId('rejected-reason').textContent?.toLowerCase()).not.toContain(
      'memory',
    );
  });

  it('T-UI-013h: every one of the three shows the reassurance line', () => {
    renderWith([GUARD, OOM, CORRUPT]);
    // `ui.md` §3.2a item 5 — "always". It is true by construction
    // (`api.md` §5.2.1) and it is the half of the diagnostic that makes the
    // failure non-frightening rather than merely explained.
    const lines = screen.getAllByTestId('rejected-reassurance').map((el) => el.textContent);
    expect(lines).toEqual([
      DECODE_BATCH_UNAFFECTED,
      DECODE_BATCH_UNAFFECTED,
      DECODE_BATCH_UNAFFECTED,
    ]);
  });

  it('T-UI-013i: the card order is name, message, facts, remedy, reassurance', () => {
    renderWith([GUARD]);
    const card = screen.getByTestId('rejected-file');
    const order = Array.from(card.children).map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual([
      'rejected-name',
      'rejected-reason',
      'rejected-facts',
      'rejected-remedy-block',
      'rejected-reassurance',
    ]);
  });
});
