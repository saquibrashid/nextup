/**
 * TASK-262 — the phone review, drawn from the owner's mobile mockup
 * (`specs/ui.md` §5.0a). Below `--bp-sm` the review is an OVERVIEW of four
 * groups — New titles, Uncertain matches, Already on your list and Other
 * extracted items — and a PAGER that shows one candidate at a time.
 *
 * ⚠ THE GROUPS ARE THE SERVER'S SECTIONS, NOT A RE-DERIVATION (`ReviewPage`
 * rule 3). New and Uncertain split the `additions` section on the domain's own
 * `individualReviewReason` — the same test that keeps a row out of Confirm
 * all — and Uncertain also takes the `unmatched` section. Nothing moves a
 * candidate between the server's sections here.
 *
 * ⚠ "ALREADY ON YOUR LIST" IS ALWAYS OFFERED IN A FULL UPDATE, EVEN AT ZERO
 * (product invariant 2). The mockup omits it; the safety property does not.
 * It is absent only when the server omits the section (append-only, REQ-022).
 *
 * ⚠ THE TEXT READ FROM THE SCREENSHOT STAYS BESIDE THE MATCH (`T-REV-013`).
 * A row shows it whenever it differs from the name, and the pager always
 * shows it, because a plausible wrong match is only visible against it.
 *
 * ⚠ NOTHING HAPPENS BY INACTION (REQ-014). Every decision is an explicit
 * press on the same four handlers the wide cards use, and a refused write
 * leaves the candidate pending and says so.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  SERVICE_LABELS,
  TITLE_CATEGORY_LABELS,
  individualReviewReason,
  isTitleCategory,
  releaseYearText,
  type ReviewCandidate,
  type ReviewResponse,
} from '@nextup/domain';

import type { TmdbSearchResult } from '../lib/apiClient';
import {
  ADDITION_CONFIRMED,
  ADDITION_DISCARDED,
  CANDIDATE_UNREADABLE_NO_TITLE,
  KNOWN_CONFIRMED,
  REVIEW_PHONE_ADD_MANUALLY,
  REVIEW_PHONE_BACK,
  REVIEW_PHONE_CHIP_ALL,
  REVIEW_PHONE_CHIP_NEW,
  REVIEW_PHONE_CHIP_OTHER,
  REVIEW_PHONE_CHIP_SAVED,
  REVIEW_PHONE_CHIP_UNCERTAIN,
  REVIEW_PHONE_CHOOSE_INSTEAD,
  REVIEW_PHONE_COVERAGE_CAVEAT,
  REVIEW_PHONE_COVERAGE_CHECK,
  REVIEW_PHONE_COVERAGE_TITLE,
  REVIEW_PHONE_COVERAGE_WITHHELD,
  REVIEW_PHONE_EMPTY,
  REVIEW_PHONE_FILTERS,
  REVIEW_PHONE_FOCUS_NEW,
  REVIEW_PHONE_FOCUS_OTHER,
  REVIEW_PHONE_FOCUS_SAVED,
  REVIEW_PHONE_FOCUS_UNCERTAIN,
  REVIEW_PHONE_GROUP_EMPTY,
  REVIEW_PHONE_GROUP_NEW,
  REVIEW_PHONE_GROUP_OTHER,
  REVIEW_PHONE_GROUP_SAVED,
  REVIEW_PHONE_GROUP_UNCERTAIN,
  REVIEW_PHONE_LEARN_MORE,
  REVIEW_PHONE_LOW_CONFIDENCE,
  REVIEW_PHONE_NEXT,
  REVIEW_PHONE_NO_MATCH,
  REVIEW_PHONE_NOT_A_TITLE,
  REVIEW_PHONE_NOTHING_READ,
  REVIEW_PHONE_PREVIOUS,
  REVIEW_PHONE_READ_FROM,
  REVIEW_PHONE_SEARCH,
  REVIEW_PHONE_SEE_ALL,
  REVIEW_PHONE_SHOW_LESS,
  REVIEW_PHONE_TITLE,
  REVIEW_PHONE_WHAT_NEXT,
  REVIEW_PHONE_YES_ADDITION,
  REVIEW_PHONE_YES_KNOWN,
  REVIEW_PHONE_YES_RESCUE,
  REVIEW_PHONE_YES_UNMATCHED,
  UNMATCHED_ACTION_FAILED,
  UNMATCHED_DISCARDED,
  UNMATCHED_FIND_LABEL,
  UNMATCHED_KEPT,
  UNMATCHED_MATCH_LABEL,
  UNMATCHED_MATCHED,
  UNMATCHED_MATCHED_UNNAMED,
  UNMATCHED_NO_RESULTS,
  UNMATCHED_SEARCH_FAILED,
  UNMATCHED_SEARCH_LABEL,
  UNMATCHED_SEARCHING,
  reviewPhoneAddAll,
  reviewPhoneAddLabel,
  reviewPhoneChangeLabel,
  reviewPhoneCoverage,
  reviewPhoneMatchScore,
  reviewPhoneNoLabel,
  reviewPhoneOpenLabel,
  reviewPhonePosition,
  reviewPhoneQuestion,
  reviewPhoneRead,
  reviewPhoneYesLabel,
} from '../copy';
import { chipsFor, reviewCandidateDomId } from './CandidateCard';
import { CandidateList } from './CandidateList';
import { ManualEntryPanel, resultLabel } from './ManualEntryPanel';
import { SourceTile } from './SourceTile';
import { TMDB_IMAGE_BASE } from './TitleRow';
import { CheckIcon, ChevronIcon, CloseIcon, PlusIcon, SearchIcon, WarningIcon } from './icons';
import { Button } from './ui/Button';
import { Fieldset } from './ui/Fieldset';
import { Input } from './ui/Input';

export type PhoneReviewGroup = 'new' | 'uncertain' | 'saved' | 'other';
type Filter = 'all' | PhoneReviewGroup;
type Variant = 'addition' | 'unmatched' | 'known' | 'correction';
type Disposition = ReviewCandidate['disposition'];

interface Entry {
  readonly candidate: ReviewCandidate;
  readonly group: PhoneReviewGroup;
  readonly variant: Variant;
  /** A "probably not a title" row, which the owner may rescue as a title. */
  readonly rescuable: boolean;
  /**
   * False for an unreadable tile: there is no reading to keep, only a title to
   * find or a tile to discard — the tile-first card's `hideKeep`.
   */
  readonly keepable: boolean;
}

/** How many rows a group previews on the overview before *See all*. */
export const PHONE_REVIEW_PREVIEW = 3;
/** How many cards the uncertain carousel draws before *See all*. */
export const PHONE_REVIEW_CAROUSEL = 12;

/**
 * The phone groups, in the server's section order.
 *
 * ⚠ `individualReviewReason` is the DOMAIN's rule (`packages/domain`), shared
 * with Confirm all and the bulk API — using it here is reading the server's
 * judgement, not forming a second one. An addition with no match cannot be a
 * clear new title, so it goes to Uncertain whatever the reason says.
 */
export function phoneReviewEntries(review: ReviewResponse): readonly Entry[] {
  const { sections } = review;
  const fresh: Entry[] = [];
  const uncertain: Entry[] = [];
  for (const candidate of sections.additions.items) {
    const clear = candidate.match !== null && individualReviewReason(candidate) === null;
    (clear ? fresh : uncertain).push({
      candidate,
      group: clear ? 'new' : 'uncertain',
      variant: 'addition',
      rescuable: false,
      keepable: true,
    });
  }
  for (const candidate of sections.unmatched.items) {
    uncertain.push({
      candidate,
      group: 'uncertain',
      variant: 'unmatched',
      rescuable: false,
      keepable: true,
    });
  }
  // As on the tile-first card: an unreadable tile is an unmatched reading with
  // nothing to keep, decided by finding its title or discarding it.
  for (const candidate of sections.unreadableTiles.items) {
    uncertain.push({
      candidate,
      group: 'uncertain',
      variant: 'unmatched',
      rescuable: false,
      keepable: false,
    });
  }
  const saved: Entry[] = sections.alreadyOnYourList.omitted
    ? []
    : sections.alreadyOnYourList.items.map((candidate) => ({
        candidate,
        group: 'saved',
        variant: 'known',
        rescuable: false,
        keepable: true,
      }));
  const other: Entry[] = [
    ...(sections.probablyNotTitles.omitted ? [] : sections.probablyNotTitles.items).map(
      (candidate): Entry => ({
        candidate,
        group: 'other',
        variant: 'correction',
        rescuable: true,
        keepable: false,
      }),
    ),
  ];
  return [...fresh, ...uncertain, ...saved, ...other];
}

function displayName(candidate: ReviewCandidate): string | null {
  if (candidate.verdict === 'chrome-suspected') return null;
  return candidate.match?.name ?? candidate.inferredTitle;
}

function labelFor(candidate: ReviewCandidate): string {
  return (
    displayName(candidate) ??
    (candidate.rawText !== '' ? candidate.rawText : CANDIDATE_UNREADABLE_NO_TITLE)
  );
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** The read text, when it says something the name does not. */
function readText(candidate: ReviewCandidate): string | null {
  if (candidate.rawText === '') return null;
  const name = displayName(candidate);
  return name !== null && normalise(name) === normalise(candidate.rawText)
    ? null
    : candidate.rawText;
}

function factsFor(candidate: ReviewCandidate, service: string | null): string | null {
  const match = candidate.verdict === 'chrome-suspected' ? null : candidate.match;
  const parts = [
    match === null ? null : releaseYearText(match.releaseYear, match.edition !== undefined),
    match === null || !isTitleCategory(match.mediaType)
      ? null
      : TITLE_CATEGORY_LABELS[match.mediaType],
    service,
  ].filter((part): part is string => part !== null && part !== '');
  return parts.length === 0 ? null : parts.join(' · ');
}

function badgeFor(candidate: ReviewCandidate): string | null {
  const match = candidate.verdict === 'chrome-suspected' ? null : candidate.match;
  if (candidate.verdict === 'low-confidence') return REVIEW_PHONE_LOW_CONFIDENCE;
  if (match === null) return REVIEW_PHONE_NO_MATCH;
  if (match.uncertain || match.ambiguous) return reviewPhoneMatchScore(match.score);
  return null;
}

function outcomeText(
  variant: Variant,
  disposition: Disposition,
  name: string | null,
): string | null {
  if (disposition === 'corrected') {
    return name === null ? UNMATCHED_MATCHED_UNNAMED : UNMATCHED_MATCHED.replace('{name}', name);
  }
  if (disposition === 'confirmed') {
    return variant === 'unmatched'
      ? UNMATCHED_KEPT
      : variant === 'known'
        ? KNOWN_CONFIRMED
        : ADDITION_CONFIRMED;
  }
  if (disposition === 'discarded') {
    return variant === 'unmatched' ? UNMATCHED_DISCARDED : ADDITION_DISCARDED;
  }
  return null;
}

const GROUP_TITLES: Record<PhoneReviewGroup, string> = {
  new: REVIEW_PHONE_GROUP_NEW,
  uncertain: REVIEW_PHONE_GROUP_UNCERTAIN,
  saved: REVIEW_PHONE_GROUP_SAVED,
  other: REVIEW_PHONE_GROUP_OTHER,
};

const FOCUS_TITLES: Record<PhoneReviewGroup, string> = {
  new: REVIEW_PHONE_FOCUS_NEW,
  uncertain: REVIEW_PHONE_FOCUS_UNCERTAIN,
  saved: REVIEW_PHONE_FOCUS_SAVED,
  other: REVIEW_PHONE_FOCUS_OTHER,
};

const CHIP_LABELS: Record<Filter, string> = {
  all: REVIEW_PHONE_CHIP_ALL,
  new: REVIEW_PHONE_CHIP_NEW,
  uncertain: REVIEW_PHONE_CHIP_UNCERTAIN,
  saved: REVIEW_PHONE_CHIP_SAVED,
  other: REVIEW_PHONE_CHIP_OTHER,
};

export interface PhoneReviewProps {
  readonly review: ReviewResponse;
  readonly subtitle: string;
  readonly controlled: boolean;
  /** The disposition to show, with any local press already folded in. */
  readonly dispositionOf: (candidate: ReviewCandidate) => Disposition;
  readonly thumbnailUrlFor: (candidate: ReviewCandidate) => string | null;
  /** How many New rows one *Add all* press would confirm (`canBulkConfirm`). */
  readonly bulkCount: number;
  readonly confirmAllDisabled?: boolean;
  readonly onConfirmAll?: () => void;
  readonly onKeep?: ((candidateId: string) => Promise<void>) | undefined;
  readonly onDiscard?: ((candidateId: string) => Promise<void>) | undefined;
  readonly onMatch?: ((candidateId: string, result: TmdbSearchResult) => Promise<void>) | undefined;
  readonly onSearch?: ((query: string) => Promise<TmdbSearchResult[]>) | undefined;
  readonly onRescue?: ((candidateId: string) => Promise<void>) | undefined;
  readonly onManualEntry?: ((result: TmdbSearchResult) => Promise<void>) | undefined;
  /** §6.14 — a refused close opens the first still-pending candidate. */
  readonly pendingIds?: readonly string[] | null;
  /** Banners and recovery tools, drawn under the coverage card. */
  readonly lead?: ReactNode;
  /** Removals, manual entry and the action bar — the overview's foot. */
  readonly tail?: ReactNode;
}

type Screen = { readonly kind: 'overview' } | { readonly kind: 'focus'; readonly id: string };

function Thumb({
  candidate,
  thumbnailUrl,
}: {
  readonly candidate: ReviewCandidate;
  readonly thumbnailUrl: string | null;
}): JSX.Element {
  const match = candidate.verdict === 'chrome-suspected' ? null : candidate.match;
  if (match?.posterPath !== undefined && match.posterPath !== null) {
    return (
      <img className="phone-review__poster" src={`${TMDB_IMAGE_BASE}${match.posterPath}`} alt="" />
    );
  }
  const crop = candidate.tileCrop ?? null;
  if (thumbnailUrl !== null && crop !== null) {
    return (
      <span className="phone-review__tile">
        <SourceTile crop={crop} src={thumbnailUrl} />
      </span>
    );
  }
  if (thumbnailUrl !== null) {
    return <img className="phone-review__whole" src={thumbnailUrl} alt="Whole screenshot" />;
  }
  return <span className="phone-review__poster phone-review__poster--empty" aria-hidden="true" />;
}

export function PhoneReview({
  review,
  subtitle,
  controlled,
  dispositionOf,
  thumbnailUrlFor,
  bulkCount,
  confirmAllDisabled = false,
  onConfirmAll,
  onKeep,
  onDiscard,
  onMatch,
  onSearch,
  onRescue,
  onManualEntry,
  pendingIds = null,
  lead = null,
  tail = null,
}: PhoneReviewProps): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const [screen, setScreen] = useState<Screen>({ kind: 'overview' });
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [local, setLocal] = useState<
    Readonly<Record<string, { disposition: Disposition; name: string | null }>>
  >({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const returnTo = useRef<string | null>(null);
  const focusHeading = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ⚠ ALL FOUR OR NONE, as on the wide cards: a control with no handler is a
  // decision the owner believes they made and did not.
  const wired =
    onKeep !== undefined &&
    onDiscard !== undefined &&
    onMatch !== undefined &&
    onSearch !== undefined;

  const entries = phoneReviewEntries(review);
  const inGroup = (group: PhoneReviewGroup): readonly Entry[] =>
    entries.filter((entry) => entry.group === group);
  const service = review.service === null ? null : SERVICE_LABELS[review.service];

  const disposition = (candidate: ReviewCandidate): Disposition =>
    controlled
      ? dispositionOf(candidate)
      : (local[candidate.candidateId]?.disposition ?? dispositionOf(candidate));
  const chosenName = (candidate: ReviewCandidate): string | null =>
    (controlled ? null : local[candidate.candidateId]?.name) ?? candidate.match?.name ?? null;

  const run = (
    candidateId: string,
    action: () => Promise<void>,
    next: Disposition,
    name: string | null = null,
  ): void => {
    if (busyId !== null) return;
    setBusyId(candidateId);
    setFailedId(null);
    void action().then(
      () => {
        setLocal((current) => ({ ...current, [candidateId]: { disposition: next, name } }));
        setBusyId(null);
      },
      () => {
        // ⚠ No local outcome: the card stays as the server still holds it.
        setFailedId(candidateId);
        setBusyId(null);
      },
    );
  };

  const keep = (entry: Entry): void => {
    if (onKeep === undefined) return;
    run(entry.candidate.candidateId, () => onKeep(entry.candidate.candidateId), 'confirmed');
  };
  const discard = (entry: Entry): void => {
    if (onDiscard === undefined) return;
    run(entry.candidate.candidateId, () => onDiscard(entry.candidate.candidateId), 'discarded');
  };

  const open = (candidateId: string): void => {
    returnTo.current = candidateId;
    setScreen({ kind: 'focus', id: candidateId });
  };
  const back = (): void => {
    setScreen({ kind: 'overview' });
  };

  // §6.14 — a refused close opens the first candidate the owner still has to
  // decide. A fresh array on every refusal, so a repeat refusal re-opens it.
  useEffect(() => {
    if (pendingIds === null) return;
    const first = pendingIds.find((id) =>
      phoneReviewEntries(review).some((entry) => entry.candidate.candidateId === id),
    );
    if (first !== undefined) setScreen({ kind: 'focus', id: first });
  }, [pendingIds, review]);

  const focusId = screen.kind === 'focus' ? screen.id : null;
  useEffect(() => {
    if (typeof window.scrollTo === 'function' && !navigator.userAgent.includes('jsdom')) {
      window.scrollTo(0, 0);
    }
    if (focusId !== null) {
      focusHeading.current?.focus();
      return;
    }
    const opener = returnTo.current;
    if (opener === null) return;
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-open-id="${CSS.escape(opener)}"]`)
      ?.focus({ preventScroll: true });
  }, [focusId]);

  const focused =
    focusId === null ? undefined : entries.find((entry) => entry.candidate.candidateId === focusId);

  return (
    <div className="phone-review" data-testid="phone-review" ref={rootRef}>
      <div
        className="phone-review__head"
        data-screen={focused === undefined ? 'overview' : 'focus'}
      >
        <h1>{REVIEW_PHONE_TITLE}</h1>
        <p className="phone-review__subtitle" data-testid="review-context">
          {subtitle}
        </p>
      </div>
      {focused === undefined ? (
        renderOverview()
      ) : (
        <PhoneReviewFocus
          key={focused.candidate.candidateId}
          entry={focused}
          list={inGroup(focused.group)}
          ctx={{
            disposition,
            chosenName,
            busyId,
            failedId,
            run,
            keep,
            discard,
            open,
            back,
            wired,
            onMatch,
            onSearch,
            onRescue,
            onManualEntry,
            service,
            thumbnailUrlFor,
            focusHeading,
          }}
        />
      )}
    </div>
  );

  function renderOverview(): JSX.Element {
    const coverage = review.tileCoverage ?? [];
    const detected = coverage.reduce((sum, image) => sum + image.detectedTiles, 0);
    const located = coverage.reduce((sum, image) => sum + image.locatedTiles, 0);
    const withheld = review.sections.removals.withheld;
    const incomplete = withheld || located < detected;
    const groups: readonly PhoneReviewGroup[] = (
      ['new', 'uncertain', 'saved', 'other'] as const
    ).filter(
      (group) =>
        inGroup(group).length > 0 ||
        // ⚠ Invariant 2: the saved group is offered at zero in a full update.
        (group === 'saved' && !review.sections.alreadyOnYourList.omitted),
    );
    const chips: readonly Filter[] = ['all', ...groups];
    const shown = filter === 'all' ? groups : groups.filter((group) => group === filter);

    return (
      <>
        <div className="phone-review__chips" role="group" aria-label={REVIEW_PHONE_FILTERS}>
          {chips.map((chip) => (
            <Button
              key={chip}
              variant="ghost"
              aria-pressed={filter === chip}
              data-testid={`phone-review-chip-${chip}`}
              onClick={() => {
                setFilter(chip);
              }}
            >
              <span>{CHIP_LABELS[chip]}</span>
              <span className="phone-review__count">
                {chip === 'all' ? entries.length : inGroup(chip).length}
              </span>
            </Button>
          ))}
        </div>

        {incomplete && (
          <section
            className="phone-review__coverage"
            aria-labelledby="phone-review-coverage"
            data-testid="phone-review-coverage"
          >
            <WarningIcon />
            <div>
              <h2 id="phone-review-coverage">{REVIEW_PHONE_COVERAGE_TITLE}</h2>
              {detected > 0 && <p>{reviewPhoneCoverage(located, detected)}</p>}
              <p>{withheld ? REVIEW_PHONE_COVERAGE_WITHHELD : REVIEW_PHONE_COVERAGE_CHECK}</p>
              {coverage.length > 0 && (
                <Button
                  variant="ghost"
                  aria-expanded={coverageOpen}
                  onClick={() => {
                    setCoverageOpen(!coverageOpen);
                  }}
                >
                  {coverageOpen ? REVIEW_PHONE_SHOW_LESS : REVIEW_PHONE_LEARN_MORE}
                </Button>
              )}
              {coverageOpen && (
                <ul className="phone-review__coverage-list">
                  {coverage.map((image) => (
                    <li key={image.imageId}>
                      <a href={image.href} target="_blank" rel="noreferrer">
                        {image.fileName}
                      </a>
                      {`: ${image.titleCandidates} title candidates; readings located in ${image.locatedTiles} of ${image.detectedTiles} detected tiles.`}
                      {image.locatedTiles < image.detectedTiles &&
                        ' An unlocated tile is not necessarily unread.'}
                    </li>
                  ))}
                </ul>
              )}
              {coverageOpen && <p>{REVIEW_PHONE_COVERAGE_CAVEAT}</p>}
            </div>
          </section>
        )}

        {lead}

        {entries.length === 0 && (
          <p className="phone-review__empty" data-testid="review-additions-empty">
            {REVIEW_PHONE_EMPTY}
          </p>
        )}

        {shown.map((group) => renderGroup(group, filter !== 'all'))}

        {tail}
      </>
    );
  }

  function renderGroup(group: PhoneReviewGroup, expanded: boolean): JSX.Element {
    const items = inGroup(group);
    const headingId = `phone-review-group-${group}`;
    const limit = group === 'uncertain' ? PHONE_REVIEW_CAROUSEL : PHONE_REVIEW_PREVIEW;
    const visible = expanded ? items : items.slice(0, limit);
    const carousel = group === 'uncertain' && !expanded;
    return (
      <section
        key={group}
        className="phone-review__group"
        data-group={group}
        aria-labelledby={headingId}
        data-testid={`phone-review-group-${group}`}
      >
        <div className="phone-review__group-head">
          <span className="phone-review__group-mark" aria-hidden="true">
            {group === 'new' ? <PlusIcon /> : group === 'uncertain' ? '?' : null}
            {group === 'saved' ? <CheckIcon /> : null}
            {group === 'other' ? <SearchIcon /> : null}
          </span>
          <h2 id={headingId}>{GROUP_TITLES[group]}</h2>
          <span className="phone-review__count">{items.length}</span>
          {!expanded && items.length > visible.length && (
            <Button
              variant="ghost"
              data-testid={`phone-review-see-all-${group}`}
              onClick={() => {
                setFilter(group);
              }}
            >
              {REVIEW_PHONE_SEE_ALL}
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="phone-review__empty">{REVIEW_PHONE_GROUP_EMPTY}</p>
        ) : carousel ? (
          <ul className="phone-review__cards">
            {visible.map((entry) => (
              <li key={entry.candidate.candidateId}>{renderCard(entry)}</li>
            ))}
          </ul>
        ) : (
          <CandidateList
            items={visible}
            keyFor={(entry) => entry.candidate.candidateId}
            renderItem={(entry) => renderRow(entry)}
          />
        )}
        {group === 'new' && bulkCount > 0 && onConfirmAll !== undefined && (
          <p className="phone-review__add-all">
            <Button
              variant="secondary"
              data-testid="confirm-all-button"
              disabled={confirmAllDisabled || busyId !== null}
              onClick={onConfirmAll}
            >
              {reviewPhoneAddAll(bulkCount)}
            </Button>
          </p>
        )}
      </section>
    );
  }

  function renderDecision(entry: Entry, name: string): JSX.Element {
    const { candidate } = entry;
    const current = disposition(candidate);
    const outcome = outcomeText(entry.variant, current, chosenName(candidate));
    const busy = busyId !== null;
    if (outcome !== null) {
      return (
        <Button
          variant="ghost"
          data-open-id={candidate.candidateId}
          data-state={current}
          aria-label={reviewPhoneChangeLabel(name, outcome)}
          onClick={() => {
            open(candidate.candidateId);
          }}
        >
          {current === 'discarded' ? <CloseIcon /> : <CheckIcon />}
        </Button>
      );
    }
    if (!wired || !entry.keepable) {
      return (
        <Button
          variant="ghost"
          data-open-id={candidate.candidateId}
          aria-label={reviewPhoneOpenLabel(name)}
          onClick={() => {
            open(candidate.candidateId);
          }}
        >
          <ChevronIcon />
        </Button>
      );
    }
    return (
      <Button
        variant="primary"
        disabled={busy}
        data-open-id={candidate.candidateId}
        data-testid={`phone-review-yes-${candidate.candidateId}`}
        aria-label={entry.group === 'new' ? reviewPhoneAddLabel(name) : reviewPhoneYesLabel(name)}
        onClick={() => {
          keep(entry);
        }}
      >
        {entry.group === 'new' ? <PlusIcon /> : <CheckIcon />}
      </Button>
    );
  }

  function renderRow(entry: Entry): JSX.Element {
    const { candidate } = entry;
    const name = labelFor(candidate);
    const read = readText(candidate);
    const facts = factsFor(candidate, null);
    return (
      <div className="phone-review__row" data-testid={`phone-review-row-${candidate.candidateId}`}>
        <Thumb candidate={candidate} thumbnailUrl={thumbnailUrlFor(candidate)} />
        <div className="phone-review__row-body">
          <Button
            variant="ghost"
            data-testid={`phone-review-open-${candidate.candidateId}`}
            onClick={() => {
              open(candidate.candidateId);
            }}
          >
            {name}
          </Button>
          {facts !== null && <p className="phone-review__facts">{facts}</p>}
          {read !== null && <p className="phone-review__read">{reviewPhoneRead(read)}</p>}
          {failedId === candidate.candidateId && (
            <p role="alert" className="phone-review__failure">
              {UNMATCHED_ACTION_FAILED}
            </p>
          )}
        </div>
        <div className="phone-review__row-action">{renderDecision(entry, name)}</div>
      </div>
    );
  }

  function renderCard(entry: Entry): JSX.Element {
    const { candidate } = entry;
    const name = labelFor(candidate);
    const matched = displayName(candidate);
    const read = readText(candidate);
    const badge = badgeFor(candidate);
    const facts = factsFor(candidate, null);
    const current = disposition(candidate);
    const outcome = outcomeText(entry.variant, current, chosenName(candidate));
    return (
      <div
        className="phone-review__card"
        data-testid={`phone-review-card-${candidate.candidateId}`}
      >
        <div className="phone-review__card-art">
          <Thumb candidate={candidate} thumbnailUrl={thumbnailUrlFor(candidate)} />
          {badge !== null && <span className="phone-review__badge">{badge}</span>}
        </div>
        <Button
          variant="ghost"
          data-testid={`phone-review-open-${candidate.candidateId}`}
          onClick={() => {
            open(candidate.candidateId);
          }}
        >
          {reviewPhoneQuestion(matched)}
        </Button>
        <p className="phone-review__facts">
          {matched === null ? (read ?? REVIEW_PHONE_NOTHING_READ) : (facts ?? '')}
        </p>
        {matched !== null && read !== null && (
          <p className="phone-review__read">{reviewPhoneRead(read)}</p>
        )}
        {failedId === candidate.candidateId && (
          <p role="alert" className="phone-review__failure">
            {UNMATCHED_ACTION_FAILED}
          </p>
        )}
        <div className="phone-review__card-actions">
          {outcome !== null || !wired || !entry.keepable ? (
            renderDecision(entry, name)
          ) : (
            <>
              {renderDecision(entry, name)}
              <Button
                variant="secondary"
                disabled={busyId !== null}
                data-testid={`phone-review-no-${candidate.candidateId}`}
                aria-label={reviewPhoneNoLabel(name)}
                onClick={() => {
                  // ⚠ "No" answers the card's question. For a match that is
                  // "not this match", which needs a choice, so it opens the
                  // pager; for "Is this a title?" it is a discard.
                  if (matched === null) discard(entry);
                  else open(candidate.candidateId);
                }}
              >
                <CloseIcon />
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }
}

interface FocusContext {
  readonly disposition: (candidate: ReviewCandidate) => Disposition;
  readonly chosenName: (candidate: ReviewCandidate) => string | null;
  readonly busyId: string | null;
  readonly failedId: string | null;
  readonly run: (
    candidateId: string,
    action: () => Promise<void>,
    next: Disposition,
    name?: string | null,
  ) => void;
  readonly keep: (entry: Entry) => void;
  readonly discard: (entry: Entry) => void;
  readonly open: (candidateId: string) => void;
  readonly back: () => void;
  readonly wired: boolean;
  readonly onMatch: PhoneReviewProps['onMatch'];
  readonly onSearch: PhoneReviewProps['onSearch'];
  readonly onRescue: PhoneReviewProps['onRescue'];
  readonly onManualEntry: PhoneReviewProps['onManualEntry'];
  readonly service: string | null;
  readonly thumbnailUrlFor: (candidate: ReviewCandidate) => string | null;
  readonly focusHeading: RefObject<HTMLHeadingElement | null>;
}

/**
 * The pager's one candidate. ⚠ A TOP-LEVEL COMPONENT, keyed by candidate, so
 * its search box and manual-entry state survive every re-render of the
 * overview and reset only when the owner moves to another candidate.
 */ function PhoneReviewFocus({
  entry,
  list,
  ctx,
}: {
  readonly entry: Entry;
  readonly list: readonly Entry[];
  readonly ctx: FocusContext;
}): JSX.Element {
  const {
    disposition,
    chosenName,
    busyId,
    failedId,
    run,
    keep,
    discard,
    open,
    back,
    wired,
    onMatch,
    onSearch,
    onRescue,
    onManualEntry,
    service,
    thumbnailUrlFor,
    focusHeading,
  } = ctx;
  const { candidate, variant } = entry;
  const index = list.findIndex((item) => item.candidate.candidateId === candidate.candidateId);
  const previous = index > 0 ? list[index - 1] : undefined;
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : undefined;
  const matched = displayName(candidate);
  const match = candidate.verdict === 'chrome-suspected' ? null : candidate.match;
  const badge = badgeFor(candidate);
  const facts = factsFor(candidate, service);
  const chips = chipsFor(candidate, match === null && candidate.verdict !== 'chrome-suspected');
  const reason = individualReviewReason(candidate);
  const current = disposition(candidate);
  const outcome = outcomeText(variant, current, chosenName(candidate));
  const thumbnailUrl = thumbnailUrlFor(candidate);
  const crop = candidate.tileCrop ?? null;
  const busy = busyId !== null;
  const alternatives = candidate.alternatives.filter(
    (alternative) =>
      match === null ||
      alternative.tmdbId !== match.tmdbId ||
      alternative.mediaType !== match.mediaType,
  );
  const searchInputId = useId();
  const [searchOpen, setSearchOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [query, setQuery] = useState(candidate.rawText);
  const [results, setResults] = useState<TmdbSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);

  const choose = (result: TmdbSearchResult): void => {
    if (onMatch === undefined) return;
    run(
      candidate.candidateId,
      () => onMatch(candidate.candidateId, result),
      'corrected',
      result.name,
    );
  };
  const search = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed === '' || searching || onSearch === undefined) return;
    setSearching(true);
    setSearchFailed(false);
    void onSearch(trimmed).then(
      (items) => {
        setResults(items);
        setSearching(false);
      },
      () => {
        setResults(null);
        setSearchFailed(true);
        setSearching(false);
      },
    );
  };
  const yesLabel =
    variant === 'unmatched'
      ? REVIEW_PHONE_YES_UNMATCHED
      : variant === 'known'
        ? REVIEW_PHONE_YES_KNOWN
        : REVIEW_PHONE_YES_ADDITION;

  return (
    <div
      className="phone-review__focus"
      data-testid={`candidate-${candidate.candidateId}`}
      id={reviewCandidateDomId(candidate.candidateId)}
      tabIndex={-1}
    >
      <div className="phone-review__focus-bar">
        <Button variant="ghost" aria-label={REVIEW_PHONE_BACK} onClick={back}>
          <ChevronIcon />
        </Button>
        <h2 ref={focusHeading} tabIndex={-1}>
          {FOCUS_TITLES[entry.group]}
        </h2>
        {index >= 0 && (
          <span className="phone-review__position">{reviewPhonePosition(index, list.length)}</span>
        )}
      </div>

      <div className="phone-review__hero">
        {thumbnailUrl !== null && crop !== null ? (
          <SourceTile crop={crop} src={thumbnailUrl} />
        ) : thumbnailUrl !== null ? (
          <img className="phone-review__whole" src={thumbnailUrl} alt="Whole screenshot" />
        ) : (
          <span className="phone-review__poster phone-review__poster--empty" aria-hidden="true" />
        )}
        {match?.posterPath !== undefined && match.posterPath !== null && thumbnailUrl !== null && (
          <img
            className="phone-review__hero-poster"
            src={`${TMDB_IMAGE_BASE}${match.posterPath}`}
            alt={`Catalogue poster for ${match.name}`}
          />
        )}
      </div>

      <div className="phone-review__question">
        <h3>{reviewPhoneQuestion(matched)}</h3>
        {badge !== null && <span className="phone-review__badge">{badge}</span>}
      </div>
      {facts !== null && <p className="phone-review__facts">{facts}</p>}
      {chips.length > 0 && (
        <ul className="phone-review__chips-static">
          {chips.map((chip) => (
            <li key={chip}>{chip}</li>
          ))}
        </ul>
      )}
      <div className="phone-review__evidence">
        <span>{REVIEW_PHONE_READ_FROM}</span>
        <p data-testid="candidate-raw-text">
          {candidate.rawText === '' ? REVIEW_PHONE_NOTHING_READ : candidate.rawText}
        </p>
      </div>
      {current === 'pending' && reason !== null && <p className="phone-review__reason">{reason}</p>}
      {thumbnailUrl !== null && (
        <a className="phone-review__source" href={thumbnailUrl} target="_blank" rel="noreferrer">
          Open source screenshot
        </a>
      )}

      <div className="phone-review__options">
        <Fieldset legend={REVIEW_PHONE_WHAT_NEXT} disabled={busy}>
          {outcome !== null && (
            <p className="phone-review__outcome" role="status" data-testid={`${variant}-outcome`}>
              {outcome}
            </p>
          )}
          {entry.rescuable && onRescue !== undefined && (
            <Button
              variant="ghost"
              data-option="yes"
              onClick={() => {
                run(candidate.candidateId, () => onRescue(candidate.candidateId), current);
              }}
            >
              <CheckIcon />
              {REVIEW_PHONE_YES_RESCUE}
            </Button>
          )}
          {wired && entry.keepable && (
            <Button
              variant="ghost"
              data-option="yes"
              data-testid={`${variant}-keep`}
              aria-pressed={current === 'confirmed'}
              onClick={() => {
                keep(entry);
              }}
            >
              <CheckIcon />
              {yesLabel}
            </Button>
          )}
          {wired && alternatives.length > 0 && (
            <>
              <p className="phone-review__options-label">{REVIEW_PHONE_CHOOSE_INSTEAD}</p>
              {alternatives.map((alternative) => (
                <Button
                  key={`${alternative.mediaType}:${alternative.tmdbId}`}
                  variant="ghost"
                  data-option="alternative"
                  aria-label={UNMATCHED_MATCH_LABEL.replace('{name}', alternative.name)}
                  onClick={() => {
                    choose(alternative);
                  }}
                >
                  {alternative.posterPath === null ? (
                    <span className="phone-review__alt-art" aria-hidden="true" />
                  ) : (
                    <img
                      className="phone-review__alt-art"
                      src={`${TMDB_IMAGE_BASE}${alternative.posterPath}`}
                      alt=""
                    />
                  )}
                  <span>{resultLabel(alternative)}</span>
                  <ChevronIcon />
                </Button>
              ))}
            </>
          )}
          {wired && (
            <Button
              variant="ghost"
              data-option="search"
              data-testid={`${variant}-find`}
              aria-expanded={searchOpen}
              onClick={() => {
                setSearchOpen(!searchOpen);
              }}
            >
              <SearchIcon />
              {REVIEW_PHONE_SEARCH}
            </Button>
          )}
          {searchOpen && (
            <div className="phone-review__search">
              <form onSubmit={search}>
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
              {results !== null &&
                results.map((result) => (
                  <Button
                    key={`${result.mediaType}:${result.tmdbId}`}
                    variant="ghost"
                    data-option="alternative"
                    aria-label={UNMATCHED_MATCH_LABEL.replace('{name}', result.name)}
                    onClick={() => {
                      choose(result);
                    }}
                  >
                    <span>{resultLabel(result)}</span>
                    <ChevronIcon />
                  </Button>
                ))}
            </div>
          )}
          {wired && (variant === 'addition' || variant === 'unmatched') && (
            <Button
              variant="ghost"
              data-option="discard"
              data-testid={`${variant}-discard`}
              aria-pressed={current === 'discarded'}
              onClick={() => {
                discard(entry);
              }}
            >
              <CloseIcon />
              {REVIEW_PHONE_NOT_A_TITLE}
            </Button>
          )}
          {onManualEntry !== undefined && onSearch !== undefined && (
            <Button
              variant="ghost"
              data-option="manual"
              aria-expanded={manualOpen}
              onClick={() => {
                setManualOpen(!manualOpen);
              }}
            >
              <PlusIcon />
              {REVIEW_PHONE_ADD_MANUALLY}
            </Button>
          )}
          {failedId === candidate.candidateId && (
            <p role="alert" data-testid={`${variant}-failure`}>
              {UNMATCHED_ACTION_FAILED}
            </p>
          )}
        </Fieldset>
      </div>
      {manualOpen && onManualEntry !== undefined && onSearch !== undefined && (
        <ManualEntryPanel onAdd={onManualEntry} onSearch={onSearch} />
      )}

      <div className="phone-review__pager">
        <Button
          variant="secondary"
          disabled={previous === undefined}
          onClick={() => {
            if (previous !== undefined) open(previous.candidate.candidateId);
          }}
        >
          <ChevronIcon />
          {REVIEW_PHONE_PREVIOUS}
        </Button>
        <Button
          variant="primary"
          disabled={next === undefined}
          onClick={() => {
            if (next !== undefined) open(next.candidate.candidateId);
          }}
        >
          {REVIEW_PHONE_NEXT}
          <ChevronIcon />
        </Button>
      </div>
    </div>
  );
}
