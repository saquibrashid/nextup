// The combined list itself (`specs/ui.md` §2.1, TASK-038).
//
// Separate from `ListPage` because the page owns the screen furniture - the
// freshness strip (TASK-042), the filter bar and the sort control - while this
// owns only the ordered sequence of rows. Keeping them apart means the list can
// be rendered in a test, or later inside the load-more sentinel, without
// dragging the whole screen along.
//
// ⚠ THIS COMPONENT DOES NOT SORT, GROUP OR DEDUPE. Ordering is the server's
// (`specs/data-model.md` §5.3, `packages/domain/src/ordering.ts`) and the
// work-level collapse is `GET /api/titles`'. A client-side `sort()` here would
// silently disagree with the cursor the API pages on, so page 2 would interleave
// wrongly with page 1 and the owner would see rows apparently jump position.

import type { JSX } from 'react';

import { TitleRow, type TitleListItem } from './TitleRow';

export interface TitleListProps {
  readonly items: readonly TitleListItem[];
  readonly onOpenMenu?: ((item: TitleListItem) => void) | undefined;
  readonly onFixMatch?: ((item: TitleListItem) => void) | undefined;
}

export function TitleList({ items, onOpenMenu, onFixMatch }: TitleListProps): JSX.Element {
  return (
    <ul className="title-list" data-testid="title-list">
      {items.map((item) => (
        <TitleRow key={item.titleId} item={item} onOpenMenu={onOpenMenu} onFixMatch={onFixMatch} />
      ))}
    </ul>
  );
}
