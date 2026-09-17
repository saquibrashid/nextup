// ⚠ ORIGINALLY DRAWN HERE — NOT VENDORED. Owner-directed 2026-09-17
// (ADR-0014 Revision 2). See PrimeVideoMark.tsx and ATTRIBUTION.md.
//
// A "D+" monogram. ⚠ Deliberately NOT a trace of the Disney script or the
// castle: a monogram identifies the service without reproducing the artwork
// that carries the brand's protection, and at 16 px a traced script is an
// illegible smudge anyway. `fillRule="evenodd"` is what makes the counter of
// the D a hole rather than a second filled blob.
//
// The plus is sized and positioned against the D's optical centre rather than
// set as a superscript. Shrunk and raised (the first attempt) it read as a
// stray tick crowding the D instead of as the "+" in the brand's name.

import type { JSX } from 'react';

import { BrandMarkBase, type BrandMarkProps } from './BrandMarkBase';

export function DisneyPlusMark(props: BrandMarkProps): JSX.Element {
  return (
    <BrandMarkBase {...props}>
      <path
        fillRule="evenodd"
        d="M1.8 4.6h4.7a7.4 7.4 0 0 1 0 14.8H1.8zm3.1 3v8.8h1.6a4.4 4.4 0 0 0 0-8.8z"
      />
      <path d="M17.6 7.5h2.5v3.3h3.3v2.5h-3.3v3.3h-2.5v-3.3h-3.3v-2.5h3.3z" />
    </BrandMarkBase>
  );
}
