// TASK-152 — client format validation + error copy, applied identically to
// every ingest source (`specs/ui.md` §3.2, `specs/ux-states.md`
// §4.4/§4.6/§4.6a/§4.6b/§4.18, `specs/api.md` §6.12).
//
// The load-bearing negatives here are all things that LOOK fine:
//   - a format message that names HEIC as unsupported (HEIC IS supported, A42)
//   - a client that recomposes the guard message from its own constants
//   - a client that labels a pasted rejection with a local name
//   - a corrupt-file rejection that offers the memory remedy
// Each is asserted directly, because each passes a "does it render?" test.

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImageDropzone, reviewFiles } from '../src/components/ImageDropzone';
import {
  RejectionList,
  mergeRejections,
  type ServerRejection,
} from '../src/components/RejectionList';
import {
  DECODE_REMEDY_LINK_LABEL,
  IMAGE_ACCEPT_ATTRIBUTE,
  MEMORY_REMEDY_PATH,
  UNSUPPORTED_FORMAT_REJECTION,
} from '../src/copy';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function file(name: string, type: string, size = 1024): File {
  const handle = new File(['x'], name, { type });
  Object.defineProperty(handle, 'size', { value: size });
  return handle;
}

/** The §5.2.4 guard message, exactly as the server builds it. */
const GUARD_MESSAGE =
  'beach-list-03.heic is 48.0 MP (8064 × 5952). nextup decodes images in a 0.5 GiB ' +
  'container and refuses anything above 25.0 MP before allocating memory, because ' +
  'decoding this one would exhaust container memory and kill the import. This is a ' +
  'memory limit, not a problem with your image. Remedy: up-size compute to 0.5 vCPU / ' +
  '1.0 GiB (+~$4/month) — one command, see runbooks/scale-up-memory.md. No other image ' +
  'in this batch was affected; re-attach this file after up-sizing.';

const PASTED_NAME = 'pasted-20260811-154233-03.png';

function serverRejection(over: Partial<ServerRejection> = {}): ServerRejection {
  return {
    fileName: 'notes.pdf',
    code: 'UNSUPPORTED_IMAGE_FORMAT',
    message: 'nextup accepts PNG, JPEG and HEIC screenshots.',
    ...over,
  };
}

describe('T-UI-004 - the format error copy never disowns a format nextup accepts', () => {
  it('T-UI-004f names PNG, JPEG and HEIC in the client format rejection', () => {
    // The whole point of A42: the owner's phone images are HEIC. A message
    // that omits HEIC teaches them their own camera roll is unusable.
    expect(UNSUPPORTED_FORMAT_REJECTION).toContain('PNG');
    expect(UNSUPPORTED_FORMAT_REJECTION).toContain('JPEG');
    expect(UNSUPPORTED_FORMAT_REJECTION).toContain('HEIC');
  });

  it('T-UI-004g never tells the owner HEIC is unsupported, however it is phrased', () => {
    const forbidden = [
      /heic[^.]*(isn't|is not|not) supported/i,
      /(unsupported|can't read|cannot read)[^.]*heic/i,
      /convert[^.]*heic/i,
    ];
    for (const pattern of forbidden) {
      expect(UNSUPPORTED_FORMAT_REJECTION).not.toMatch(pattern);
    }
    expect(IMAGE_ACCEPT_ATTRIBUTE).toContain('image/heic');
  });

  it('T-UI-004h refuses a HEIC file for its SIZE without ever calling it a bad format', () => {
    // A 14 MB HEIC must fail the ceiling, not the format check - conflating
    // the two is how "HEIC does not work" gets learned from a size problem.
    const oversize = file('IMG_0500.HEIC', '', 14 * 1024 * 1024);
    const review = reviewFiles([oversize], 0);

    expect(review.accepted).toHaveLength(0);
    expect(review.rejected[0]?.reason).not.toBe(UNSUPPORTED_FORMAT_REJECTION);
    expect(review.rejected[0]?.reason).toContain('14 MB');
  });
});

describe('T-UX-042 - server rejections render verbatim, in the same list, for every source', () => {
  it('T-UX-042g renders the server message byte-for-byte, never recomposed', () => {
    // The guard message interpolates the LIVE container size and guard value.
    // A client that rebuilds it states the wrong limit right after an up-size.
    const entries = mergeRejections(
      [],
      [
        serverRejection({
          fileName: 'beach-list-03.heic',
          code: 'IMAGE_TOO_LARGE_TO_DECODE',
          message: GUARD_MESSAGE,
        }),
      ],
    );
    render(<RejectionList entries={entries} />);

    // textContent, not toHaveTextContent: the latter normalises whitespace and
    // would pass against a message the client had re-wrapped.
    expect(screen.getByTestId('rejected-reason').textContent).toBe(GUARD_MESSAGE);
  });

  it('T-UX-042h names a rejected pasted image by the SERVER-synthesised filename', () => {
    const entries = mergeRejections(
      [],
      [
        serverRejection({
          fileName: PASTED_NAME,
          code: 'IMAGE_DIMENSIONS_UNSUPPORTED',
          message: `${PASTED_NAME} is 20 × 20. nextup needs at least 50 × 50.`,
        }),
      ],
    );
    render(<RejectionList entries={entries} />);

    expect(screen.getByTestId('rejected-name').textContent).toBe(PASTED_NAME);
    expect(screen.queryByText(/image\.png|pasted image/i)).toBeNull();
  });

  it('T-UX-042i offers the up-size remedy on a memory rejection', () => {
    const entries = mergeRejections(
      [],
      [
        serverRejection({
          fileName: 'huge.heic',
          code: 'IMAGE_TOO_LARGE_TO_DECODE',
          message: GUARD_MESSAGE,
        }),
      ],
    );
    render(<RejectionList entries={entries} />);

    const link = screen.getByTestId('rejected-remedy');
    expect(link.textContent).toBe(DECODE_REMEDY_LINK_LABEL);
    expect(link.getAttribute('href')).toContain(MEMORY_REMEDY_PATH);
  });

  it('T-UX-042j never offers the remedy for a corrupt file - memory will not fix it', () => {
    // ux-states.md §4.6b. Sending the owner to buy capacity for a truncated
    // file is worse than saying nothing.
    const entries = mergeRejections(
      [],
      [
        serverRejection({
          fileName: 'truncated.heic',
          code: 'IMAGE_DECODE_FAILED',
          message: 'That image is damaged or incomplete. Try attaching it again.',
        }),
      ],
    );
    render(<RejectionList entries={entries} />);

    expect(screen.queryByTestId('rejected-remedy')).toBeNull();
    expect(screen.getByTestId('rejected-reason').textContent).not.toContain('memory');
  });

  it('T-UX-042k shows client and server refusals together in one list', () => {
    const entries = mergeRejections(
      [{ name: 'notes.txt', reason: UNSUPPORTED_FORMAT_REJECTION }],
      [serverRejection({ fileName: PASTED_NAME, message: GUARD_MESSAGE })],
    );
    render(<RejectionList entries={entries} />);

    const names = screen.getAllByTestId('rejected-name').map((el) => el.textContent);
    expect(names).toEqual(['notes.txt', PASTED_NAME]);
  });

  it('T-UX-042l keeps the accepted list visible when the server rejects a sibling', async () => {
    // Partial acceptance is the normal case (api.md §6.12). A rejection that
    // clears the grid reads as "everything failed".
    render(
      <ImageDropzone
        serverRejected={[serverRejection({ fileName: PASTED_NAME, message: GUARD_MESSAGE })]}
      />,
    );

    const good = file('good.png', 'image/png');
    await userEvent.setup().upload(screen.getByTestId('file-input'), good);

    expect(screen.getByTestId('accepted-name').textContent).toBe('good.png');
    expect(screen.getByTestId('rejected-name').textContent).toBe(PASTED_NAME);
  });

  it('T-UX-042m renders a rejection identically whether the file was dropped or chosen', () => {
    // ux-states.md §4.18: "no separate copy, no separate code path, no
    // exemption". Rendering is proven source-blind by rendering twice.
    const bad = file('notes.pdf', 'application/pdf');

    const chosen = render(<ImageDropzone />);
    fireEvent.change(chosen.getByTestId('file-input'), { target: { files: [bad] } });
    const viaInput = chosen.getByTestId('rejected-file').textContent;
    chosen.unmount();

    const dragged = render(<ImageDropzone />);
    fireEvent.drop(dragged.getByTestId('drop-target'), { dataTransfer: { files: [bad] } });
    const viaDrop = dragged.getByTestId('rejected-file').textContent;

    expect(viaDrop).toBe(viaInput);
    expect(viaDrop).toContain(UNSUPPORTED_FORMAT_REJECTION);
  });
});
