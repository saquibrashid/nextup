// ⚠ ORIGINALLY DRAWN HERE — NOT VENDORED. Owner-directed 2026-09-17
// (ADR-0014 Revision 2). Prime Video, Disney+ and Peacock have no mark in the
// CC0 source, so these three are hand-authored geometric approximations: a
// suggestion of the brand at 16 px, never a reproduction of its artwork.
// See ATTRIBUTION.md for what that does and does not claim.
//
// A curved arrow, in the spirit of the Amazon smile. Two shapes: the tapered
// crescent, then the tip that turns it from a smile into an arrow.

import type { JSX } from 'react';

import { BrandMarkBase, type BrandMarkProps } from './BrandMarkBase';

export function PrimeVideoMark(props: BrandMarkProps): JSX.Element {
  return (
    <BrandMarkBase {...props}>
      <path d="M1.4 7.6c4 5 9.7 8 15.9 8 1.7 0 3.4-.2 5-.7l.5 1.8c-1.8.5-3.7.8-5.5.8-6.8 0-13-3.3-17.3-8.8l1.4-1.1z" />
      <path d="M18.6 11.2l4.6 2.7-4.9 2.6z" />
    </BrandMarkBase>
  );
}
