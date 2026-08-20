// The combined list's "nothing to show" and "couldn't show it" states
// (`specs/ux-states.md` §2.3, §2.4, §2.5, §2.9, TASK-040).
//
// ⚠ THREE DIFFERENT FACTS, THREE DIFFERENT MESSAGES, THREE DIFFERENT WAYS OUT
// (US-019 AC-5). This module exists because the tempting shape — one
// `<EmptyState>` taking a message prop — is the shape that lets a caller pass
// the wrong one. `listEmptyKind()` decides from the facts instead, so the
// choice is made in one tested place rather than at each call site:
//
//   never uploaded      → "Nothing here yet."          → go and upload
//   filters exclude all → "No titles match…"           → clear the filters
//   all removed/suppr.  → "Nothing on your list…"      → go and restore
//
// Telling an owner whose titles are all in the removal log that there is
// "nothing here yet" says their library was never there. It is the same class
// of defect as a silent deletion, arriving through copy instead of through SQL.
//
// ⚠ THE ERROR STATE MUST SAY NOTHING CHANGED (§2.9). A failed GET is the one
// moment the owner cannot verify the product's central promise for themselves,
// so the message states it. Retry is offered because the read is safe to
// repeat — nothing was written to fail halfway.

import type { JSX } from 'react';

import {
  LIST_EMPTY_ALL_GONE_TITLE,
  LIST_EMPTY_NEVER_UPLOADED_BODY,
  LIST_EMPTY_NEVER_UPLOADED_TITLE,
  LIST_LOAD_FAILED_BODY,
  RETRY_LABEL,
  UPLOAD_SCREENSHOTS_LABEL,
} from '../copy';
import { ZeroMatch, isFiltered, type ListFilters } from './FilterBar';

export type ListEmptyKind = 'never-uploaded' | 'zero-match' | 'all-gone' | null;

export interface ListEmptyFacts {
  /** Rows the API returned for the CURRENT filters. */
  readonly shown: number;
  /** Rows the API would return with no filters at all. */
  readonly total: number;
  readonly filters: ListFilters;
  /** Titles in the removal log (`/removed`). */
  readonly removedCount: number;
  /** Suppressed works (`/not-interested`). */
  readonly suppressedCount: number;
}

/**
 * Which of the three states is true — decided from the facts, never chosen by
 * a caller.
 *
 * ⚠ ORDER MATTERS. The filter check comes FIRST: an owner who has filtered
 * everything out has a full library, and reporting the first-run state there
 * is the data-loss reading §2.4 forbids. Only once no filter is hiding
 * anything is "the list is genuinely empty" a question worth asking.
 */
export function listEmptyKind(facts: ListEmptyFacts): ListEmptyKind {
  if (facts.shown > 0) return null;
  if (isFiltered(facts.filters)) return 'zero-match';
  // Nothing has ever been in the list only if nothing is anywhere else either.
  // A single removed or suppressed title makes "nothing here yet" false.
  if (facts.removedCount + facts.suppressedCount > 0 || facts.total > 0) return 'all-gone';
  return 'never-uploaded';
}

export interface ListEmptyStateProps {
  readonly facts: ListEmptyFacts;
  readonly onClearFilters?: () => void;
}

export function ListEmptyState({ facts, onClearFilters }: ListEmptyStateProps): JSX.Element | null {
  const kind = listEmptyKind(facts);
  if (kind === null) return null;

  if (kind === 'zero-match') {
    return (
      <ZeroMatch
        filters={facts.filters}
        {...(onClearFilters === undefined ? {} : { onClear: onClearFilters })}
      />
    );
  }

  if (kind === 'all-gone') {
    return (
      <div data-testid="list-empty-all-gone">
        <p data-testid="list-empty-title">{LIST_EMPTY_ALL_GONE_TITLE}</p>
        {/*
          Both counts are named and both links are offered: the titles are not
          gone, they are in one of two places, and the owner cannot know which
          without being told.
        */}
        <a href="/removed" data-testid="link-removed">
          {`Removal history (${String(facts.removedCount)})`}
        </a>
        <a href="/not-interested" data-testid="link-suppressed">
          {`Not interested (${String(facts.suppressedCount)})`}
        </a>
      </div>
    );
  }

  return (
    <div data-testid="list-empty-never-uploaded">
      <p data-testid="list-empty-title">{LIST_EMPTY_NEVER_UPLOADED_TITLE}</p>
      <p data-testid="list-empty-body">{LIST_EMPTY_NEVER_UPLOADED_BODY}</p>
      <a href="/upload" className="tap-target" data-testid="list-empty-cta">
        {UPLOAD_SCREENSHOTS_LABEL}
      </a>
    </div>
  );
}

export interface ListLoadErrorProps {
  readonly onRetry?: () => void;
}

export function ListLoadError({ onRetry }: ListLoadErrorProps): JSX.Element {
  return (
    // `role="alert"` — this one interrupts, because the owner is looking at a
    // screen that appears to have lost their list and the reassurance is the
    // whole message.
    <div data-testid="list-load-error" role="alert">
      <p data-testid="list-load-error-body">{LIST_LOAD_FAILED_BODY}</p>
      <button type="button" className="tap-target" data-testid="list-retry" onClick={onRetry}>
        {RETRY_LABEL}
      </button>
    </div>
  );
}
