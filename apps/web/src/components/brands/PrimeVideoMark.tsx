// ⚠ ORIGINALLY DRAWN HERE — NOT VENDORED. Owner-directed 2026-09-17
// (ADR-0014 Revision 2). Prime Video, Disney+ and Peacock have no mark in the
// CC0 source, so these three are hand-authored geometric approximations: a
// suggestion of the brand at 16 px, never a reproduction of its artwork.
// See ATTRIBUTION.md for what that does and does not claim.
//
// A play triangle above a smile. ⚠ The triangle is not decoration — reviewed
// live at badge size, the smile ALONE read as a stray squiggle, because a
// swoosh is a qualifier and there was nothing for it to qualify. The triangle
// says "video" first; the curve underneath then reads as the Prime smile
// rather than as a scratch. Do not drop it back to the single curve.
//
// The pair is shifted right of the naive centre: the triangle sits high-right
// and the smile low-left, so centring each shape on its own leaves the ink
// pooled to the left. The composition's bbox is what is centred (x 3.6–20.3).

import type { JSX } from 'react';

import { BrandMarkBase, type BrandMarkProps } from './BrandMarkBase';

export function PrimeVideoMark(props: BrandMarkProps): JSX.Element {
  return (
    <BrandMarkBase {...props}>
      <path d="M10.9 3.9 20.3 9.3l-9.4 5.4z" />
      <path d="M4.7 16.1c3.9 3 9 4.2 13.9 3.2l.4 1.9c-5.4 1.1-11.1-.2-15.4-3.6z" />
    </BrandMarkBase>
  );
}
