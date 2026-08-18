// `/` - the combined list (`specs/ui.md` §2, TASK-038).
//
// This task owns the information hierarchy, the row and the freshness strip.
// The other pieces §2.1 calls for arrive with their own tasks and their own
// tests, and are NOT stubbed here - a placeholder that renders would report as
// shipped:
//   - the filter bar           `T-UI-016`
//   - the sort control         TASK-166
//   - the empty states 2.3/2.4/2.5, load-more, error and offline states
//     (`specs/ux-states.md` §2) `T-UX-012`…`T-UX-018`
//
// ⚠ THE EMPTY STATES ARE NOT INTERCHANGEABLE (US-019 AC-5). "Nothing here yet"
// (never uploaded), "No titles match these filters" and "Nothing on your list
// right now" (all removed or suppressed) are three different facts, and showing
// the first when the truth is the second reads as data loss. Rendering one
// generic "no results" here would be worse than rendering none, so this
// component renders none and leaves the distinction to `T-UX-012`…`T-UX-014`.

import type { JSX } from 'react';

import { FreshnessStrip, type ServiceFreshness } from '../components/FreshnessStrip';
import { TitleList } from '../components/TitleList';
import type { TitleListItem } from '../components/TitleRow';

export interface ListPageProps {
  readonly items?: readonly TitleListItem[];
  /** `null` when `GET /api/service-state` could not be read (`T-FRESH-014`). */
  readonly serviceState?: readonly ServiceFreshness[] | null;
}

export function ListPage({ items = [], serviceState = null }: ListPageProps): JSX.Element {
  return (
    <>
      <h1>Your list</h1>
      {/*
        The strip is informational and NEVER blocks the list (§2.1), so it is a
        sibling of the list rather than a gate in front of it: whatever it is
        showing, the rows below render unchanged.
      */}
      <FreshnessStrip services={serviceState} />
      <TitleList items={items} />
    </>
  );
}
