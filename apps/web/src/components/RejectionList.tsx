// Per-file rejections, client-side and server-side, in ONE list
// (`specs/ui.md` §3.2, `specs/ux-states.md` §4.4/§4.6/§4.6a/§4.6b/§4.18,
// TASK-152).
//
// ⚠ ONE LIST, ONE RENDERING, THREE INGEST SOURCES. `ux-states.md` §4.18 is
// explicit that a pasted image rejected by a ceiling or the guard is
// "identical to §4.6/§4.6a/§4.6b — no separate copy, no separate code path, no
// exemption". So this component is deliberately given no way to learn how a
// file arrived: there is no `ingestSource` prop to branch on.
//
// ⚠ THE SERVER'S MESSAGE IS RENDERED VERBATIM, NEVER RECOMPOSED. The guard
// message interpolates the LIVE container memory and the LIVE
// `NEXTUP_MAX_DECODE_PIXELS` (`api.md` §5.2.4). A client that rebuilds it from
// its own constants would state the wrong limit the moment the container is
// up-sized — telling the owner to buy memory they already bought.
//
// ⚠ THE SERVER'S `fileName` IS RENDERED VERBATIM TOO. A pasted part has no
// usable device name, so the server synthesises `pasted-YYYYMMDD-HHMMSS-NN.png`
// and echoes it (`api.md` §6.12, `data-model.md` §3.8.1). Substituting a local
// label ("image.png", "Pasted image") breaks the one thing that lets the owner
// tell two pasted screenshots apart.

import type { JSX } from 'react';

import { DECODE_BATCH_UNAFFECTED, DECODE_REMEDY_LINK_LABEL, MEMORY_REMEDY_PATH } from '../copy';

/** A per-file refusal the client itself decided (`ImageDropzone.reviewFiles`). */
export interface RejectedFile {
  readonly name: string;
  readonly reason: string;
}

/**
 * One element of the server's `rejected[]` (`api.md` §6.12).
 *
 * `code` is carried so the list can be tested and styled, **not** so the
 * message can be swapped out for a client one.
 */
export interface ServerRejection {
  readonly fileName: string;
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RejectionEntry {
  readonly name: string;
  readonly reason: string;
  /** Absent for a client-side refusal, which has no server error code. */
  readonly code?: string;
  /** `ux-states.md` §4.6a — only the memory case offers the remedy. */
  readonly remedy?: string;
  /**
   * `ui.md` §3.2a item 3 — *"8064 × 5952 · 48.0 MP · limit 25.0 MP"*, for
   * `IMAGE_TOO_LARGE_TO_DECODE` only. Absent when the server did not send the
   * numbers, rather than rendered with zeroes.
   */
  readonly facts?: string;
  /** `ui.md` §3.2a item 5 — the reassurance line, on every server refusal. */
  readonly reassurance?: string;
}

/**
 * The codes whose message is a **capacity** statement and therefore carries the
 * up-size remedy link.
 *
 * ⚠ `IMAGE_DECODE_FAILED` is deliberately absent (`ux-states.md` §4.6b,
 * product invariant 15). A corrupt or truncated file is never fixed by more
 * memory, and offering the remedy there sends the owner to buy capacity they
 * do not need.
 */
const MEMORY_CODES: ReadonlySet<string> = new Set([
  'IMAGE_TOO_LARGE_TO_DECODE',
  'IMAGE_DECODE_OOM',
]);

/**
 * `ui.md` §3.2a item 3 — the dimension facts, as secondary text, for
 * `IMAGE_TOO_LARGE_TO_DECODE` only.
 *
 * ⚠ THIS IS THE ONE THING THE CLIENT FORMATS, AND IT FORMATS ONLY NUMBERS THE
 * SERVER SENT. It does not re-derive the limit from a client constant — that
 * is the mistake the header note forbids — it renders `details.maxMegapixels`,
 * which the server computed from the LIVE `NEXTUP_MAX_DECODE_PIXELS`.
 *
 * ⚠ MEGApixels, to one decimal place. `details.megapixels` and
 * `details.maxMegapixels` are MEGApixels; the raw pixel budget rendered here
 * would read "limit 25000000.0 MP" (`specs/testing.md` §28.3(a)).
 *
 * Returns `undefined` rather than a partially-filled string when any number is
 * missing: half a fact is worse than none in a diagnostic.
 */
function dimensionFacts(
  details: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const width = numeric(details?.['width']);
  const height = numeric(details?.['height']);
  const megapixels = numeric(details?.['megapixels']);
  const maxMegapixels = numeric(details?.['maxMegapixels']);
  if (
    width === undefined ||
    height === undefined ||
    megapixels === undefined ||
    maxMegapixels === undefined
  ) {
    return undefined;
  }
  return `${width} × ${height} · ${megapixels.toFixed(1)} MP · limit ${maxMegapixels.toFixed(1)} MP`;
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Fold client and server refusals into one ordered list.
 *
 * Client entries come first because they were decided first, and because a
 * file the client refused was never sent — so it cannot also appear in the
 * server's list.
 */
export function mergeRejections(
  client: readonly RejectedFile[],
  server: readonly ServerRejection[],
): readonly RejectionEntry[] {
  const fromClient = client.map((file) => ({ name: file.name, reason: file.reason }));
  const fromServer = server.map((rejection) => {
    const facts =
      rejection.code === 'IMAGE_TOO_LARGE_TO_DECODE'
        ? dimensionFacts(rejection.details)
        : undefined;
    return {
      // Verbatim on both fields. See the header note.
      name: rejection.fileName,
      reason: rejection.message,
      code: rejection.code,
      ...(MEMORY_CODES.has(rejection.code) ? { remedy: MEMORY_REMEDY_PATH } : {}),
      ...(facts === undefined ? {} : { facts }),
      // ⚠ ALWAYS, on every SERVER refusal (`ui.md` §3.2a item 5). It is true
      // by construction (`api.md` §5.2.1 — a per-file refusal never fails the
      // request) and it is the half of the diagnostic that makes the failure
      // non-frightening. It is NOT attached to client-side refusals: those
      // files were never sent, so there is no batch state to reassure about.
      reassurance: DECODE_BATCH_UNAFFECTED,
    };
  });
  return [...fromClient, ...fromServer];
}

export interface RejectionListProps {
  readonly entries: readonly RejectionEntry[];
}

export function RejectionList({ entries }: RejectionListProps): JSX.Element | null {
  if (entries.length === 0) return null;

  return (
    // `role="list"` is explicit: some styling resets strip the implicit role
    // off `<ul>`, and the count is the point of the list here.
    <ul data-testid="rejected-list" role="list">
      {entries.map((entry) => (
        <li key={`${entry.name}:${entry.code ?? 'client'}`} data-testid="rejected-file">
          <span data-testid="rejected-name">{entry.name}</span>
          <span data-testid="rejected-reason">{entry.reason}</span>
          {entry.facts !== undefined && <span data-testid="rejected-facts">{entry.facts}</span>}
          {entry.remedy !== undefined && (
            // ⚠ THE PATH IS RENDERED AS LITERAL TEXT AS WELL AS A LINK
            // (`ui.md` §3.2a item 4), so it survives being read in a
            // screenshot or pasted into a copied error report — which is
            // exactly how this failure will actually be reported.
            <span data-testid="rejected-remedy-block">
              <a data-testid="rejected-remedy" href={`/${entry.remedy}`}>
                {DECODE_REMEDY_LINK_LABEL}
              </a>
              <span data-testid="rejected-remedy-path">{entry.remedy}</span>
            </span>
          )}
          {entry.reassurance !== undefined && (
            <span data-testid="rejected-reassurance">{entry.reassurance}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
