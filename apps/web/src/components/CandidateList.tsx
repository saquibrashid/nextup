// SD-11c (`specs/ui.md` §5.4) — the candidate list is virtualised above 100
// items in a section, so a 500-candidate batch stays responsive on a phone
// (US-013 AC-5, `T-PERF-002`).
//
// ⚠ VIRTUALISATION IS CONDITIONAL AND THE THRESHOLD IS LOAD-BEARING IN BOTH
// DIRECTIONS. Below it the list renders plainly, because a windowed list is
// only correct while a scroll container exists to measure — and every other
// review assertion in this suite reads the DOM for candidates it expects to be
// there. Virtualising unconditionally would make a nine-item additions section
// render a subset of itself in any environment that reports no layout, which
// is precisely what a component test environment reports.
//
// ⚠ ONE `<ul>` EITHER WAY. The windowed branch keeps the same list semantics
// and the same row element, so a screen reader and `T-REV-013`'s DOM queries
// see the same structure at 9 items and at 500. A windowed list built from
// `<div>`s reads as unstructured text at exactly the size where structure
// matters most.

import { useRef, type JSX, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/** SD-11c, verbatim: "above 100 items in a section". */
export const VIRTUALISE_ABOVE = 100;

/**
 * A generous row estimate. `@tanstack/react-virtual` measures real rows once
 * they mount, so this only has to be close enough that the initial window is
 * not absurd; a card carries a poster, two lines and a chip row.
 */
const ROW_ESTIMATE_PX = 120;

export interface CandidateListProps<T> {
  readonly items: readonly T[];
  readonly keyFor: (item: T) => string;
  readonly renderItem: (item: T) => ReactNode;
}

function PlainList<T>({ items, keyFor, renderItem }: CandidateListProps<T>): JSX.Element {
  return (
    <ul className="review-section__list" data-testid="candidate-list">
      {items.map((item) => (
        <li className="review-section__row" key={keyFor(item)}>
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
}

function WindowedList<T>({ items, keyFor, renderItem }: CandidateListProps<T>): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 8,
  });

  return (
    <div
      className="review-section__viewport"
      data-testid="candidate-list-viewport"
      ref={viewportRef}
    >
      <ul
        className="review-section__list"
        data-testid="candidate-list"
        style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          if (item === undefined) return null;
          return (
            <li
              className="review-section__row"
              data-index={row.index}
              key={keyFor(item)}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start}px)`,
              }}
            >
              {renderItem(item)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CandidateList<T>(props: CandidateListProps<T>): JSX.Element {
  // ⚠ Two components rather than one branching on a hook result: `useVirtualizer`
  // must not be called at all in the plain branch, and hooks may not be
  // conditional. The branch is on the element, which may be.
  return props.items.length > VIRTUALISE_ABOVE ? (
    <WindowedList {...props} />
  ) : (
    <PlainList {...props} />
  );
}
