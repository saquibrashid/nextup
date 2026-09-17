// ⚠ ORIGINALLY DRAWN HERE — NOT VENDORED. Owner-directed 2026-09-17
// (ADR-0014 Revision 2). See PrimeVideoMark.tsx and ATTRIBUTION.md.
//
// A "D+" monogram. ⚠ Deliberately NOT a trace of the Disney script or the
// castle: a monogram identifies the service without reproducing the artwork
// that carries the brand's protection, and at 16 px a traced script is an
// illegible smudge anyway. `fillRule="evenodd"` is what makes the counter of
// the D a hole rather than a second filled blob.

import type { JSX } from 'react';

import { BrandMarkBase, type BrandMarkProps } from './BrandMarkBase';

export function DisneyPlusMark(props: BrandMarkProps): JSX.Element {
  return (
    <BrandMarkBase {...props}>
      <path
        fillRule="evenodd"
        d="M2.6 4.4h5a7.6 7.6 0 0 1 0 15.2h-5zm3.3 3.2v8.8h1.7a4.4 4.4 0 0 0 0-8.8z"
      />
      <path d="M18.8 5.2h1.9v3.1h3.1v1.9h-3.1v3.1h-1.9v-3.1h-3.1V8.3h3.1z" />
    </BrandMarkBase>
  );
}
