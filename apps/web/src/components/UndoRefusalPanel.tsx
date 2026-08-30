/**
 * TASK-116 — the §8.4 undo-refusal repair panel (`specs/ux-states.md` §9.8,
 * §9.9, US-033, `T-UX-097`, `T-UNDO-006`).
 *
 * ⚠ **A FULL-SCREEN PANEL, NEVER A TOAST.** §9.8 says so in those words, and it
 * is the difference between the feature working and failing: a refused undo is
 * the one moment the owner is told "the thing you asked for cannot happen —
 * here is what to do instead", and a toast that scrolls away takes the entire
 * remedy with it. The panel therefore renders its own landmarks and replaces
 * the batch-history content, rather than floating over it.
 *
 * ⚠ **NOTHING IS SUMMARISED AWAY, EVER** (US-033 AC-5). The API enumerates
 * every created/modified/removed title and `truncated` is the literal `false`;
 * this panel paginates CLIENT-SIDE at {@link PAGE_SIZE} per group with a "Show
 * all" that reveals the rest. Every entry the API returned is reachable in the
 * DOM without another request — an "…and 12 more" here would be the product
 * declining to answer the one question the panel exists to answer.
 *
 * ⚠ **EVERY LISTED TITLE CARRIES A WORKING ACTION** (US-033). "Not interested"
 * opens {@link SuppressDialog}, "Fix match" opens {@link FixMatchDialog}, and
 * "Restore" drives the §6.10 restore path — the same components and endpoints
 * the list and removal views use, never re-implementations. A button that
 * rendered but did nothing would fail the task as surely as a missing one.
 *
 * ⚠ **A TITLE SINCE REMOVED OR SUPPRESSED STILL APPEARS, ANNOTATED** (US-033
 * AC-6). The server sends its `currentState`; this panel renders a state chip
 * for anything that is not `active`, and updates it in place after a remedy
 * succeeds so the chip and the row's meaning stay one fact.
 */

import { useState, type JSX } from 'react';

import type {
  UndoRefusalCreatedEntry,
  UndoRefusalCurrentState,
  UndoRefusalDetails,
  UndoRefusalModifiedEntry,
  UndoRefusalRemovedEntry,
} from '@nextup/domain';

import {
  UNDO_REFUSAL_ACTION_FIX_MATCH,
  UNDO_REFUSAL_ACTION_NOT_INTERESTED,
  UNDO_REFUSAL_ACTION_RESTORE,
  UNDO_REFUSAL_BODY,
  UNDO_REFUSAL_CHIP_REMOVED,
  UNDO_REFUSAL_CHIP_SUPPRESSED,
  UNDO_REFUSAL_CLOSE_LABEL,
  UNDO_REFUSAL_GROUP_ADDED,
  UNDO_REFUSAL_GROUP_CHANGED,
  UNDO_REFUSAL_GROUP_REMOVED,
  UNDO_REFUSAL_PROVENANCE_UNAVAILABLE_BODY,
  UNDO_REFUSAL_PROVENANCE_UNAVAILABLE_TITLE,
  UNDO_REFUSAL_SHOW_ALL_LABEL,
  UNDO_REFUSAL_TITLE,
} from '../copy';
import { ApiError, type RestoreResponse } from '../lib/apiClient';
import {
  FixMatchDialog,
  type FixMatchRequest,
  type FixMatchResponse,
  type TmdbSearchResponse,
} from './FixMatchDialog';
import { SuppressDialog, type SuppressResult } from './SuppressDialog';
import { TMDB_IMAGE_BASE } from './TitleRow';

/**
 * ⚠ CLIENT-SIDE ONLY. This is a rendering convenience, never a fetch boundary:
 * the whole enumeration is already in memory (the API refuses to truncate), so
 * "Show all" is a `useState` flip, not a request. It matches the 50 named in
 * §9.8 so the two never disagree.
 */
export const PAGE_SIZE = 50;

export interface UndoRefusalPanelProps {
  /** The §8.4 body carried on the 409's `details` (`@nextup/domain`). */
  readonly details: UndoRefusalDetails;
  /** Returns the owner to their batch history. */
  readonly onClose: () => void;
  /** `POST /api/titles/:titleId/suppress` — the "Not interested" remedy. */
  readonly suppress: (titleId: string) => Promise<SuppressResult>;
  /** `POST /api/suppressions/:id/unsuppress` — the suppress undo. */
  readonly unsuppress: (suppressionId: string) => Promise<unknown>;
  /** `GET /api/tmdb/search` — the "Fix match" search. */
  readonly searchTmdb: (query: string) => Promise<TmdbSearchResponse>;
  /** `POST /api/titles/:titleId/fix-match` — the "Fix match" remedy. */
  readonly fixMatch: (titleId: string, req: FixMatchRequest) => Promise<FixMatchResponse>;
  /** `POST /api/listings/:listingId/restore` — the "Restore" remedy. */
  readonly restore: (
    listingId: string,
    opts?: { confirmDuplicate?: boolean },
  ) => Promise<RestoreResponse>;
}

/** Which remedy dialog, if any, is open, and for which entry. */
type ActiveDialog =
  | { readonly kind: 'suppress'; readonly titleId: string; readonly name: string }
  | { readonly kind: 'fix-match'; readonly titleId: string; readonly name: string }
  | null;

/** The §9.8 state chip, or `null` for a title still `active`. */
function chipLabel(state: UndoRefusalCurrentState): string | null {
  if (state === 'removed') return UNDO_REFUSAL_CHIP_REMOVED;
  if (state === 'suppressed') return UNDO_REFUSAL_CHIP_SUPPRESSED;
  return null;
}

function Poster({ posterPath }: { posterPath: string | null }): JSX.Element {
  if (posterPath === null) {
    return (
      <div
        className="undo-refusal__poster undo-refusal__poster--empty"
        data-testid="undo-refusal-poster-placeholder"
      />
    );
  }
  return (
    <img
      className="undo-refusal__poster"
      src={`${TMDB_IMAGE_BASE}${posterPath}`}
      alt=""
      data-testid="undo-refusal-poster"
    />
  );
}

function EntryHeader({
  name,
  releaseYear,
  state,
  posterPath,
}: {
  name: string;
  releaseYear: number | null;
  state: UndoRefusalCurrentState;
  posterPath: string | null;
}): JSX.Element {
  const chip = chipLabel(state);
  return (
    <>
      <Poster posterPath={posterPath} />
      <span className="undo-refusal__name" data-testid="undo-refusal-name">
        {name}
      </span>
      {releaseYear !== null && (
        <span className="undo-refusal__year" data-testid="undo-refusal-year">
          {releaseYear}
        </span>
      )}
      {chip !== null && (
        <span className="undo-refusal__chip" data-testid="undo-refusal-state-chip">
          {chip}
        </span>
      )}
    </>
  );
}

/**
 * §9.8 — the "Restore" remedy, driven inline off the §6.10 endpoint.
 *
 * ⚠ Reports the OUTCOME, never a silent success. A restore that failed while
 * looking like it worked would strand a removed title the owner believes is
 * back. The server's own message is surfaced verbatim on failure (REQ-104).
 */
function RestoreAction({
  listingId,
  onRestored,
  restore,
}: {
  listingId: string;
  onRestored: () => void;
  restore: (listingId: string, opts?: { confirmDuplicate?: boolean }) => Promise<RestoreResponse>;
}): JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  function attempt(): void {
    setPhase('submitting');
    restore(listingId).then(
      () => {
        onRestored();
        setPhase('idle');
      },
      (err: unknown) => {
        setMessage(err instanceof ApiError ? err.message : null);
        setPhase('error');
      },
    );
  }

  return (
    <>
      <button
        type="button"
        className="tap-target"
        data-testid="undo-refusal-restore"
        disabled={phase === 'submitting'}
        onClick={attempt}
      >
        {UNDO_REFUSAL_ACTION_RESTORE}
      </button>
      {phase === 'error' && message !== null && (
        <p role="alert" data-testid="undo-refusal-restore-error">
          {message}
        </p>
      )}
    </>
  );
}

/**
 * One paginated group. Renders the first {@link PAGE_SIZE} entries, then a
 * "Show all" that reveals the rest CLIENT-SIDE (US-033 AC-5).
 */
function Group<E>({
  heading,
  testId,
  entries,
  renderEntry,
  keyOf,
}: {
  heading: string;
  testId: string;
  entries: readonly E[];
  renderEntry: (entry: E) => JSX.Element;
  keyOf: (entry: E) => string;
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  if (entries.length === 0) return null;

  const visible = expanded ? entries : entries.slice(0, PAGE_SIZE);
  const hidden = entries.length - visible.length;

  return (
    <section className="undo-refusal__group" data-testid={`undo-refusal-group-${testId}`}>
      <h2>{`${heading} (${entries.length})`}</h2>
      <ul className="undo-refusal__list" data-testid={`undo-refusal-list-${testId}`}>
        {visible.map((entry) => (
          <li className="undo-refusal__entry" data-testid="undo-refusal-entry" key={keyOf(entry)}>
            {renderEntry(entry)}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          className="tap-target"
          data-testid={`undo-refusal-show-all-${testId}`}
          onClick={() => setExpanded(true)}
        >
          {`${UNDO_REFUSAL_SHOW_ALL_LABEL} (${entries.length})`}
        </button>
      )}
    </section>
  );
}

export function UndoRefusalPanel({
  details,
  onClose,
  suppress,
  unsuppress,
  searchTmdb,
  fixMatch,
  restore,
}: UndoRefusalPanelProps): JSX.Element {
  const [active, setActive] = useState<ActiveDialog>(null);
  // Per-work / per-listing chip overrides applied after a remedy succeeds, so
  // the chip reflects what the owner just did without a reload (US-033 AC-6).
  const [overrides, setOverrides] = useState<ReadonlyMap<string, UndoRefusalCurrentState>>(
    new Map(),
  );

  function setOverride(key: string, state: UndoRefusalCurrentState): void {
    setOverrides((prev) => new Map(prev).set(key, state));
  }

  function stateOf(key: string, fallback: UndoRefusalCurrentState): UndoRefusalCurrentState {
    return overrides.get(key) ?? fallback;
  }

  const provenanceUnavailable = details.reason === 'provenance-unavailable';

  const renderCreated = (entry: UndoRefusalCreatedEntry): JSX.Element => (
    <>
      <EntryHeader
        name={entry.name}
        releaseYear={entry.releaseYear}
        state={stateOf(entry.titleId, entry.currentState)}
        posterPath={entry.posterPath}
      />
      <button
        type="button"
        className="tap-target"
        data-testid="undo-refusal-not-interested"
        onClick={() => setActive({ kind: 'suppress', titleId: entry.titleId, name: entry.name })}
      >
        {UNDO_REFUSAL_ACTION_NOT_INTERESTED}
      </button>
    </>
  );

  const renderModified = (entry: UndoRefusalModifiedEntry): JSX.Element => (
    <>
      <EntryHeader
        name={entry.name}
        releaseYear={entry.releaseYear}
        state={stateOf(entry.titleId, entry.currentState)}
        posterPath={entry.posterPath}
      />
      <button
        type="button"
        className="tap-target"
        data-testid="undo-refusal-fix-match"
        onClick={() => setActive({ kind: 'fix-match', titleId: entry.titleId, name: entry.name })}
      >
        {UNDO_REFUSAL_ACTION_FIX_MATCH}
      </button>
    </>
  );

  const renderRemoved = (entry: UndoRefusalRemovedEntry): JSX.Element => (
    <>
      <EntryHeader
        name={entry.name}
        releaseYear={entry.releaseYear}
        state={stateOf(entry.listingId, entry.currentState)}
        posterPath={entry.posterPath}
      />
      <RestoreAction
        listingId={entry.listingId}
        restore={restore}
        onRestored={() => setOverride(entry.listingId, 'active')}
      />
    </>
  );

  const title = provenanceUnavailable
    ? UNDO_REFUSAL_PROVENANCE_UNAVAILABLE_TITLE
    : UNDO_REFUSAL_TITLE;
  const body = provenanceUnavailable ? UNDO_REFUSAL_PROVENANCE_UNAVAILABLE_BODY : UNDO_REFUSAL_BODY;

  return (
    <div className="undo-refusal" data-testid="undo-refusal-panel" data-reason={details.reason}>
      <main>
        <section aria-labelledby="undo-refusal-title" role="alert">
          <h1 id="undo-refusal-title">{title}</h1>
          <p data-testid="undo-refusal-body">{body}</p>

          <Group
            heading={UNDO_REFUSAL_GROUP_ADDED}
            testId="added"
            entries={details.created}
            renderEntry={renderCreated}
            keyOf={(entry) => entry.titleId}
          />
          <Group
            heading={UNDO_REFUSAL_GROUP_CHANGED}
            testId="changed"
            entries={details.modified}
            renderEntry={renderModified}
            keyOf={(entry) => `${entry.titleId}:${entry.attr}`}
          />
          <Group
            heading={UNDO_REFUSAL_GROUP_REMOVED}
            testId="removed"
            entries={details.removed}
            renderEntry={renderRemoved}
            keyOf={(entry) => entry.listingId}
          />

          <button
            type="button"
            className="tap-target"
            data-testid="undo-refusal-close"
            onClick={onClose}
          >
            {UNDO_REFUSAL_CLOSE_LABEL}
          </button>
        </section>
      </main>

      {active?.kind === 'suppress' && (
        <SuppressDialog
          titleId={active.titleId}
          name={active.name}
          suppress={suppress}
          unsuppress={unsuppress}
          onRowState={(state) => {
            if (state === 'suppressed') setOverride(active.titleId, 'suppressed');
            if (state === 'present') setOverride(active.titleId, 'active');
          }}
          onClose={() => setActive(null)}
        />
      )}

      {active?.kind === 'fix-match' && (
        <FixMatchDialog
          titleId={active.titleId}
          name={active.name}
          badges={[]}
          searchTmdb={searchTmdb}
          fixMatch={fixMatch}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}
