// TASK-213 — the compact genre presentation (REQ-112/REQ-120,
// `specs/ui-refresh.md` §4.3/§4.4, `A53` OQ-7/OQ-9).
//
// ⚠ **"COMPACT" IS A PRESENTATION CHANGE, NOT A CONTENT CHANGE.** §4.3 is
// explicit: the genres are **all** still present and still readable; what
// changes is the room they take. The owner rejected trimming them outright —
// *"use another ux to make it compact but still list the genres"* — and the
// reason the trim was put to them rather than built is that genres are one of
// the three filter dimensions (`specs/ui.md` §2.1). Cutting them removes the
// only on-screen explanation of why a genre filter returned what it returned.
//
// ⚠ **THE CHIPS ARE `<span>`s INSIDE A `<span>`, NOT A `<ul>`.** This renders
// inside `.title-row__meta`, which is a `<p>`: a `<ul>` there is invalid HTML
// and browsers silently close the paragraph around it, breaking the row's
// layout in a way jsdom never reproduces. Phrasing content only.

import { useState, type JSX } from 'react';
import { normaliseGenres } from '@nextup/domain';

import { Button } from './ui/Button';
import { Chip } from './ui/Chip';

/**
 * How many chips show before the rest collapse behind `+n`.
 *
 * ⚠ **A COUNT, NOT A MEASUREMENT, AND IT HAS TO BE.** §4.3 asks for "at most
 * one line", but a line is a rendered fact: measuring it needs layout, layout
 * needs a browser, and the row would then render one way on first paint and
 * another after a resize observer fired — a visible reflow on every row of the
 * list. A fixed count is stable, server-consistent, and testable without a
 * browser. The number is tuned to the narrowest supported viewport (320 px),
 * which is the only width where the choice can go wrong.
 */
export const GENRE_CHIP_LIMIT = 2;

export interface GenreChipsProps {
  /** The genres as STORED — combined TV names included. Normalised here. */
  readonly genres: readonly string[];
  /**
   * The genres in the ACTIVE filter (`?genre=`), if any.
   *
   * ⚠ **§4.3: a genre in the active filter is ALWAYS VISIBLE, never hidden
   * behind `+n`.** Otherwise the row stops explaining the very filter that
   * produced it — the owner filters on `Thriller`, and the row that came back
   * shows other genres and an overflow count. That is the same
   * silent-lack-of-explanation failure as the filter bug in §4.4, arriving by
   * a different route.
   */
  readonly activeGenres?: readonly string[] | undefined;
}

export function GenreChips({ genres, activeGenres = [] }: GenreChipsProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);

  // REQ-120 — the DISPLAY half. `Action & Adventure` becomes `Action` and
  // `Adventure`, from the same closed map the API filters with.
  const canonical = normaliseGenres(genres);

  // ⚠ US-019 AC-6 — `genres: []` RENDERS NOTHING AT ALL. Not "Unknown", not a
  // dash, and — the case this component newly makes possible — not an empty
  // `+0`. A placeholder reads as a fact about the work rather than an absence
  // of data, and the owner cannot tell the difference. `T-UX-102b` guards the
  // whole meta line, not just this element.
  if (canonical.length === 0) return null;

  // Active genres are HOISTED, not merely exempted from the cut. Exempting
  // them would leave a filtered-on genre sitting after the `+n` in source
  // order, visible but out of place; hoisting puts the reason the row matched
  // first, which is where the eye goes.
  const active = canonical.filter((genre) => activeGenres.includes(genre));
  const ordered = [...active, ...canonical.filter((genre) => !activeGenres.includes(genre))];

  // ⚠ `Math.max` RATHER THAN A PLAIN SLICE. With four active genres and a
  // limit of two, a plain slice hides one of them — satisfying the limit and
  // breaking the rule the limit exists under. The limit yields to the
  // guarantee, never the other way round.
  const visible = expanded ? ordered.length : Math.max(GENRE_CHIP_LIMIT, active.length);
  const shown = ordered.slice(0, visible);
  const hidden = ordered.length - shown.length;

  return (
    <span
      className="genre-chips"
      data-testid="genres"
      data-filtered={active.length > 0 || undefined}
    >
      {shown.map((genre) => (
        // ⚠ THE `Chip` PRIMITIVE, NOT A LOCAL `<span>` — `specs/ui-refresh.md`
        // §7d names `chip` as "the compact genre presentation of §4.3,
        // including its `+n` overflow", so this IS the primitive's one
        // consumer. A private `genre-chips__chip` alongside it is the
        // each-screen-re-solves-it duplication REQ-125 exists to end, and it
        // left the primitive mounted by nothing but its own test.
        <Chip key={genre} data-testid={`genre-chip-${genre}`}>
          {genre === 'Science Fiction' ? <abbr title={genre}>Sci-Fi</abbr> : genre}
        </Chip>
      ))}
      {hidden > 0 && (
        // ⚠ REVEALS IN PLACE; IT IS NOT A LINK, A TOOLTIP OR A DIALOG. §4.3
        // says the overflow "reveals the rest in place". A title attribute
        // would be invisible to touch and to a screen reader, which is most of
        // how this app is used.
        //
        // ⚠ A `Button` PRIMITIVE, NOT A BARE `<button>` — `T-UI-031a` forbids
        // one outside `src/components/ui/`, and an unlabelled `+2` is silent
        // to assistive technology, hence the explicit `aria-label`.
        <Button
          variant="ghost"
          aria-label={`Show ${hidden} more ${hidden === 1 ? 'genre' : 'genres'}`}
          data-testid="genre-overflow"
          onClick={() => {
            setExpanded(true);
          }}
        >
          {`+${hidden}`}
        </Button>
      )}
    </span>
  );
}
