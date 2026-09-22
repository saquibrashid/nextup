import { Input } from './ui/Input';
/**
 * TASK-068 — the three actions an unmatched candidate carries
 * (`specs/ux-states.md` §6.8, US-008 AC-2/AC-4). `T-UNM-010`, `T-UX-063`.
 *
 * ⚠ **KEEPING IS THE POINT OF THE SECTION, AND IT IS LISTED FIRST.** US-008 is
 * "unmatched candidates are surfaced, never silently discarded": a title TMDB
 * cannot name is still a title the owner saw on their list, and at close it
 * becomes a real row under an `unmatched:` identity (`unresolvedKept`,
 * `T-UNM-012`). A card that offered only "find a match" and "discard" would
 * make the supported outcome the one with no button.
 *
 * ⚠ **NOTHING HAPPENS BY INACTION** (REQ-014). All three actions are explicit
 * presses. In particular the inline search does NOT match on the top hit as
 * you type — for an unmatched row the reader's text is by definition text TMDB
 * did not recognise, so the top hit for it is more often wrong than right.
 *
 * ⚠ **A REFUSED PATCH LEAVES THE CARD PENDING AND SAYS SO.** Optimistically
 * showing "kept" on a request the server rejected would let the owner close a
 * batch believing a row was preserved that in fact still needs a decision —
 * and the close would then 409 on `PENDING_ADDITIONS` with no explanation the
 * owner could connect to the card they thought they had dealt with.
 *
 * This component decides nothing about SECTIONS. Which candidates are
 * unmatched is `sectionForCandidate` in `packages/domain/src/review.ts`,
 * server-side; this renders the actions for the rows that arrived in it.
 */

import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';

import {
  ADDITION_CHANGE_MATCH_LABEL,
  ADDITION_CONFIRM_LABEL,
  ADDITION_CONFIRMED,
  ADDITION_DISCARD_LABEL,
  ADDITION_DISCARDED,
  UNMATCHED_ACTION_FAILED,
  UNMATCHED_CANCEL_LABEL,
  UNMATCHED_DISCARD_LABEL,
  UNMATCHED_DISCARDED,
  UNMATCHED_FIND_LABEL,
  UNMATCHED_KEEP_LABEL,
  UNMATCHED_KEPT,
  UNMATCHED_MATCH_LABEL,
  UNMATCHED_MATCH_SHORT,
  UNMATCHED_MATCHED,
  UNMATCHED_MATCHED_UNNAMED,
  UNMATCHED_NO_RESULTS,
  UNMATCHED_SEARCH_FAILED,
  UNMATCHED_SEARCH_LABEL,
  UNMATCHED_SEARCHING,
} from '../copy';
import { resultLabel } from './ManualEntryPanel';
import type { TmdbSearchResult } from '../lib/apiClient';
import { Button } from './ui/Button';

export type CandidateActionsVariant = 'unmatched' | 'addition' | 'correction';

interface VariantCopy {
  readonly keepLabel: string;
  readonly findLabel: string;
  readonly discardLabel: string;
  readonly keptText: string;
  readonly discardedText: string;
}

/**
 * ⚠ **THE KEEP LABEL IS NOT SHARED, AND MUST NOT BE.** On an unmatched card
 * the button has to say what keeping MEANS, because the row will be stored
 * under an `unmatched:` identity. An addition already carries a resolved TMDB
 * match, so the same words would tell the owner a correctly identified title
 * was unidentified.
 */
const VARIANT_COPY: Record<CandidateActionsVariant, VariantCopy> = {
  correction: {
    keepLabel: ADDITION_CONFIRM_LABEL,
    findLabel: 'Find the right title',
    discardLabel: ADDITION_DISCARD_LABEL,
    keptText: ADDITION_CONFIRMED,
    discardedText: ADDITION_DISCARDED,
  },
  unmatched: {
    keepLabel: UNMATCHED_KEEP_LABEL,
    findLabel: UNMATCHED_FIND_LABEL,
    discardLabel: UNMATCHED_DISCARD_LABEL,
    keptText: UNMATCHED_KEPT,
    discardedText: UNMATCHED_DISCARDED,
  },
  addition: {
    keepLabel: ADDITION_CONFIRM_LABEL,
    findLabel: ADDITION_CHANGE_MATCH_LABEL,
    discardLabel: ADDITION_DISCARD_LABEL,
    keptText: ADDITION_CONFIRMED,
    discardedText: ADDITION_DISCARDED,
  },
};

export interface UnmatchedActionsProps {
  readonly alternatives?: readonly TmdbSearchResult[];
  readonly hideKeep?: boolean;
  readonly candidateId: string;
  /**
   * Which review section this card sits in. Drives the button words and the
   * test ids ONLY — the three patches are identical, because the API has no
   * notion of sections either (`PATCH …/candidates/:id` takes a disposition).
   *
   * ⚠ **`'addition'` IS NOT AN AFTERTHOUGHT VARIANT.** `specs/ui.md` §5.3
   * requires Confirm / Change match / Discard on the review card, and the
   * additions section shipped without any of them (TASK-200): the only control
   * was "Confirm all {n}", so an owner who saw one false extra among ten good
   * rows had no way to reject it short of abandoning the batch. That is the
   * defect this prop closes — do not "simplify" it back to unmatched-only.
   */
  readonly variant?: CandidateActionsVariant;
  /**
   * Controlled cards report the saved decision. Decided cards offer an
   * explicit edit, never an automatic reversal of the saved choice.
   */
  readonly disposition: string;
  readonly controlled?: boolean;
  /**
   * REQ-109 — the name of the work this candidate was corrected TO, as the
   * SERVER now reports it (`candidate.match.name` once the disposition is
   * `'corrected'`).
   *
   * ⚠ **This is what makes the correction survive a re-render.** The component
   * holds the name in local state for the click path only; on any render from
   * server state that local value is gone, and without this prop the card
   * falls back to a generic "Matched to the title you chose." — the owner is
   * told something was matched but not what, which is the defect REQ-109
   * exists to close.
   */
  readonly correctedName?: string | null;
  /** §6.18 `{ disposition: 'confirmed' }` — the keep-anyway path. */
  readonly onKeep: (candidateId: string) => Promise<void>;
  /** §6.18 `{ disposition: 'discarded' }`. */
  readonly onDiscard: (candidateId: string) => Promise<void>;
  /** §6.18 `{ disposition: 'corrected', tmdbId, mediaType }`. */
  readonly onMatch: (candidateId: string, result: TmdbSearchResult) => Promise<void>;
  /** §6.29. Rejects on any failure; the card says so and stays usable. */
  readonly onSearch: (query: string) => Promise<TmdbSearchResult[]>;
}

type Outcome = { kind: 'kept' } | { kind: 'discarded' } | { kind: 'matched'; name: string | null };

/**
 * What the card says once a decision has been made.
 *
 * ⚠ Derived from the disposition the CALLER passed, not from local state
 * alone: a reload must keep saying what the server holds, and a card that
 * forgot the owner's decision on refresh would invite them to make it twice.
 *
 * ⚠ `'corrected'` names the work WHEN THE SERVER KNOWS IT (REQ-109). The name
 * arrives as `correctedName`, projected from the candidate's `match` — which
 * the review read now builds from the owner's correction rather than from
 * `matchCandidates[0]`, the identity they rejected.
 *
 * ⚠ It can still be absent, and the unnamed copy stays for that case rather
 * than interpolating an empty string: a correction stored before these display
 * fields existed, or one made by a client that sent none, has no name on the
 * server and none is invented. "Matched to ." would read as a bug in the
 * match.
 */
function outcomeFor(disposition: string, correctedName: string | null): Outcome | null {
  if (disposition === 'confirmed') return { kind: 'kept' };
  if (disposition === 'discarded') return { kind: 'discarded' };
  if (disposition === 'corrected') return { kind: 'matched', name: correctedName };
  return null;
}

function outcomeText(outcome: Outcome, copy: VariantCopy): string {
  if (outcome.kind === 'kept') return copy.keptText;
  if (outcome.kind === 'discarded') return copy.discardedText;
  return outcome.name === null
    ? UNMATCHED_MATCHED_UNNAMED
    : UNMATCHED_MATCHED.replace('{name}', outcome.name);
}

export function UnmatchedActions({
  candidateId,
  variant = 'unmatched',
  disposition,
  controlled = false,
  correctedName = null,
  onKeep,
  onDiscard,
  onMatch,
  onSearch,
  hideKeep = false,
  alternatives = [],
}: UnmatchedActionsProps): JSX.Element {
  const searchInputId = useId();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [local, setLocal] = useState<Outcome | null>(null);
  const [editing, setEditing] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (busy || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (
      document.activeElement === document.body ||
      actionsRef.current?.contains(document.activeElement)
    ) {
      actionsRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({
        preventScroll: true,
      });
    }
  }, [busy, editing, disposition, local]);

  const copy = VARIANT_COPY[variant];
  // ⚠ SERVER STATE WINS ON A RE-RENDER. `local` is the click path's optimistic
  // outcome; once the refetched payload names the correction, the two agree.
  // Preferring `local` forever would rebuild the REQ-109 defect from the other
  // side — a name that is right until the component re-mounts.
  const outcome = controlled
    ? outcomeFor(disposition, correctedName)
    : (local ?? outcomeFor(disposition, correctedName));

  const run = (action: () => Promise<void>, next: Outcome): void => {
    if (busy) return;
    restoreFocus.current = actionsRef.current?.contains(document.activeElement) === true;
    setBusy(true);
    setFailure(null);
    void action().then(
      () => {
        setLocal(next);
        setBusy(false);
        setSearchOpen(false);
        setEditing(false);
      },
      () => {
        // ⚠ NO `setLocal` HERE. The refusal must leave the card exactly as the
        // server still holds it — see the header note.
        setFailure(UNMATCHED_ACTION_FAILED);
        setBusy(false);
      },
    );
  };

  const search = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed === '' || searching) return;
    setSearching(true);
    setSearchFailed(false);
    void onSearch(trimmed).then(
      (items) => {
        setResults(items);
        setSearching(false);
      },
      () => {
        // Cleared, for the same reason as the manual-entry panel: results left
        // under a failure belong to a search the owner is no longer looking at.
        setResults(null);
        setSearchFailed(true);
        setSearching(false);
      },
    );
  };

  if (outcome !== null && !editing) {
    return (
      <div className="unmatched-actions" ref={actionsRef}>
        <p className="unmatched-actions__outcome" data-testid={`${variant}-outcome`} role="status">
          {outcomeText(outcome, copy)}
        </p>
        <Button
          variant="ghost"
          onClick={() => {
            restoreFocus.current = true;
            setEditing(true);
          }}
        >
          Change decision
        </Button>
      </div>
    );
  }

  return (
    <div className="unmatched-actions" data-testid={`${variant}-actions`} ref={actionsRef}>
      {outcome !== null && (
        <p className="unmatched-actions__outcome">
          {outcomeText(outcome, copy)}{' '}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              restoreFocus.current = true;
              setEditing(false);
            }}
          >
            Keep current decision
          </Button>
        </p>
      )}
      <div className="unmatched-actions__buttons">
        {/* ⚠ FIRST. See the header note — this is the outcome US-008 exists for. */}
        {variant !== 'correction' && !hideKeep && (
          <Button
            variant="secondary"
            data-testid={`${variant}-keep`}
            disabled={busy}
            onClick={() => {
              run(
                async () => {
                  await onKeep(candidateId);
                },
                { kind: 'kept' },
              );
            }}
          >
            {copy.keepLabel}
          </Button>
        )}
        <Button
          variant="secondary"
          data-testid={`${variant}-find`}
          disabled={busy}
          onClick={() => {
            setSearchOpen(!searchOpen);
          }}
        >
          {searchOpen ? UNMATCHED_CANCEL_LABEL : copy.findLabel}
        </Button>
        {variant !== 'correction' && (
          <Button
            variant="secondary"
            data-testid={`${variant}-discard`}
            disabled={busy}
            onClick={() => {
              run(
                async () => {
                  await onDiscard(candidateId);
                },
                { kind: 'discarded' },
              );
            }}
          >
            {copy.discardLabel}
          </Button>
        )}
      </div>

      {searchOpen && (
        <>
          {alternatives.length > 0 && (
            <div className="unmatched-actions__results">
              <p>Catalogue alternatives for this reading</p>
              {alternatives.map((result) => (
                <div
                  className="unmatched-actions__result"
                  key={`${result.mediaType}:${result.tmdbId}`}
                >
                  <span className="unmatched-actions__result-label">{resultLabel(result)}</span>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    aria-label={UNMATCHED_MATCH_LABEL.replace('{name}', result.name)}
                    onClick={() =>
                      run(
                        async () => {
                          await onMatch(candidateId, result);
                        },
                        { kind: 'matched', name: result.name },
                      )
                    }
                  >
                    {UNMATCHED_MATCH_SHORT}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <form className="unmatched-actions__form" onSubmit={search}>
            <label htmlFor={searchInputId}>{UNMATCHED_SEARCH_LABEL}</label>
            <Input
              id={searchInputId}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
            <Button variant="secondary" type="submit" disabled={searching}>
              {searching ? UNMATCHED_SEARCHING : UNMATCHED_FIND_LABEL}
            </Button>
          </form>

          {searchFailed && <p role="alert">{UNMATCHED_SEARCH_FAILED}</p>}
          {results !== null && results.length === 0 && <p>{UNMATCHED_NO_RESULTS}</p>}
          {results !== null && results.length > 0 && (
            <ul className="unmatched-actions__results">
              {results.map((result) => (
                <li
                  className="unmatched-actions__result"
                  key={`${result.mediaType}:${String(result.tmdbId)}`}
                >
                  <span className="unmatched-actions__result-label">{resultLabel(result)}</span>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    aria-label={UNMATCHED_MATCH_LABEL.replace('{name}', result.name)}
                    onClick={() => {
                      run(
                        async () => {
                          await onMatch(candidateId, result);
                        },
                        { kind: 'matched', name: result.name },
                      );
                    }}
                  >
                    {UNMATCHED_MATCH_SHORT}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {failure !== null && (
        <p role="alert" data-testid={`${variant}-failure`}>
          {failure}
        </p>
      )}
    </div>
  );
}
