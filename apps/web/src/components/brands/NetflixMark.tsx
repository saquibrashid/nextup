// Netflix — bundled CC0 mark from Simple Icons (ADR-0014).
// Slug: `netflix`. Upstream `source` field: the Netflix brand-assets site.
//
// ⚠ Path data is VERBATIM and must not be hand-edited. Refreshing it is a
// re-vendor from the pinned upstream commit recorded in `ATTRIBUTION.md`,
// never a tweak in place — an edited path is an altered trademark.

import type { JSX } from 'react';

import { BrandMarkBase, type BrandMarkProps } from './BrandMarkBase';

export function NetflixMark(props: BrandMarkProps): JSX.Element {
  return (
    <BrandMarkBase {...props}>
      <path d="m5.398 0 8.348 23.602c2.346.059 4.856.398 4.856.398L10.113 0H5.398zm8.489 0v9.172l4.715 13.33V0h-4.715zM5.398 1.5V24c1.873-.225 2.81-.312 4.715-.398V14.83L5.398 1.5z" />
    </BrandMarkBase>
  );
}
