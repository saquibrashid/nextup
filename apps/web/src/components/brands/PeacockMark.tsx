// ⚠ ORIGINALLY DRAWN HERE — NOT VENDORED. Owner-directed 2026-09-17
// (ADR-0014 Revision 2). See PrimeVideoMark.tsx and ATTRIBUTION.md.
//
// A fan of six TAPERED TEARDROPS — round at the tip, drawn to a point at the
// pivot. ⚠ **The taper is the whole design, not styling.** Six ellipses (the
// first attempt) overlap near the pivot because an ellipse is still at full
// width there, so the gaps between the feathers close up and the fan renders
// as one solid blob. It looked correct in the path data and wrong on screen.
// A shape that narrows to nothing at the pivot keeps every gap open, which is
// what makes it read as six feathers rather than a bush.
//
// ⚠ The outermost tip must still land inside the 24-grid: at this pivot,
// length and spread the widest feather reaches x ≈ 23.4. Increasing the spread
// angle or the feather length pushes the outer tips off the viewBox, where
// they are silently clipped and the fan quietly becomes lopsided.
//
// ~~Superseded 2026-09-17 (owner review at badge size): "A six-feather fan.
// The geometry is a FAN OF ROTATED ELLIPSES about a pivot below the canvas
// floor, not six drawn teardrops." That geometry is what produced the blob.~~

import type { JSX } from 'react';

import { BrandMarkBase, type BrandMarkProps } from './BrandMarkBase';

const FEATHER_ANGLES = [-48, -28.8, -9.6, 9.6, 28.8, 48] as const;

const FEATHER =
  'M12 6.4c1.55 0 2.45 1.25 2.45 2.7 0 2.1-1.65 3.8-2.45 6.9-.8-3.1-2.45-4.8-2.45-6.9 0-1.45.9-2.7 2.45-2.7z';

export function PeacockMark(props: BrandMarkProps): JSX.Element {
  return (
    <BrandMarkBase {...props}>
      {FEATHER_ANGLES.map((angle) => (
        <path key={angle} d={FEATHER} transform={`rotate(${angle} 12 19.5)`} />
      ))}
    </BrandMarkBase>
  );
}
