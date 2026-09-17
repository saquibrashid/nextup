// ⚠ ORIGINALLY DRAWN HERE — NOT VENDORED. Owner-directed 2026-09-17
// (ADR-0014 Revision 2). See PrimeVideoMark.tsx and ATTRIBUTION.md.
//
// A six-feather fan. ⚠ The geometry is a FAN OF ROTATED ELLIPSES about a
// pivot below the canvas floor, not six drawn teardrops: the outermost tip
// must land inside the 24-grid, and at the pivot and radius below the widest
// feather reaches x ≈ 21.8. Increasing the spread angle or the feather length
// pushes the outer tips off the viewBox, where they are silently clipped and
// the fan quietly becomes lopsided.

import type { JSX } from 'react';

import { BrandMarkBase, type BrandMarkProps } from './BrandMarkBase';

const FEATHER_ANGLES = [-55, -33, -11, 11, 33, 55] as const;

export function PeacockMark(props: BrandMarkProps): JSX.Element {
  return (
    <BrandMarkBase {...props}>
      {FEATHER_ANGLES.map((angle) => (
        <ellipse
          key={angle}
          cx="12"
          cy="12"
          rx="1.9"
          ry="4.2"
          transform={`rotate(${angle} 12 20)`}
        />
      ))}
    </BrandMarkBase>
  );
}
