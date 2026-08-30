// TASK-116 — the §8.4 undo-refusal contract (`specs/data-model.md` §8.4,
// US-033, `specs/ux-states.md` §9.8).
//
// ⚠ SHARED ON PURPOSE. These types were first declared inside
// `apps/api/src/services/batchUndo.ts`, where the SPA could not reach them.
// The refusal panel is the CLIENT half of the same contract — it renders every
// entry the API enumerates — so a second, hand-written copy in `apps/web` would
// be free to drift from the producer without anything failing to compile. That
// drift is invisible in exactly the way this feature cannot afford: a field the
// panel stops reading is a title the owner stops seeing.

/**
 * Where a work stands NOW, relative to the owner's list, so the refusal panel
 * can say what its remedy will do. NOT a `TitleState`: `'suppressed'` is the
 * existence of a `Suppression` row against the WORK (REQ-071), evaluated for
 * display only and never written back onto the title.
 */
export type UndoRefusalCurrentState = 'active' | 'removed' | 'suppressed';

/** Why the batch could not be undone in one step. */
export type UndoRefusalReason =
  'modified-or-removed' | 'later-owner-edits' | 'provenance-unavailable';

export interface UndoRefusalCreatedEntry {
  titleId: string;
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
  currentState: UndoRefusalCurrentState;
  remedy: 'not-interested';
  remedyHref: string;
}

export interface UndoRefusalModifiedEntry {
  titleId: string;
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
  attr: string;
  before: unknown;
  currentState: UndoRefusalCurrentState;
  remedy: 'fix-match';
  remedyHref: string;
}

export interface UndoRefusalRemovedEntry {
  titleId: string;
  listingId: string;
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
  currentState: UndoRefusalCurrentState;
  remedy: 'restore';
  remedyHref: string;
}

/** Any one of the three groups, for code that treats them uniformly. */
export type UndoRefusalEntry =
  UndoRefusalCreatedEntry | UndoRefusalModifiedEntry | UndoRefusalRemovedEntry;

export interface UndoRefusalDetails {
  batchId: string;
  reason: UndoRefusalReason;
  created: UndoRefusalCreatedEntry[];
  modified: UndoRefusalModifiedEntry[];
  removed: UndoRefusalRemovedEntry[];
  /**
   * ⚠ ALWAYS `false`, typed as the literal so a summarising change fails to
   * compile. The enumeration is NEVER capped, paged or sliced (US-033 AC-5,
   * `specs/testing.md` §6 row 10): a truncated refusal shows the owner a
   * partial list of what undo would touch and the difference is invisible. The
   * UI paginates client-side.
   */
  truncated: false;
  /** Carried on `AppError.details` (a `Record<string, unknown>`). */
  [key: string]: unknown;
}
