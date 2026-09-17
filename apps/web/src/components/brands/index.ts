/**
 * The closed service-mark register (ADR-0014, issue #288).
 *
 * ⚠ **ALL EIGHT SERVICES HAVE A MARK, AND THEY DO NOT ALL COME FROM THE SAME
 * PLACE.** Five are vendored verbatim from a CC0 source. Three — Prime Video,
 * Disney+ and Peacock — are **originally drawn here** at the owner's explicit
 * direction (2026-09-17), because those brands are absent from that source:
 * Amazon and Disney are among the brands removed from it through its published
 * removal process. The drawn three are geometric approximations, not traces of
 * the brands' artwork, and they carry a weaker position than the vendored
 * five. `ATTRIBUTION.md` records which is which; ADR-0014 Revision 2 records
 * the decision and the risk the owner accepted.
 *
 * ⚠ **DO NOT SILENTLY "UPGRADE" A DRAWN MARK INTO A TRACED ONE.** Tracing a
 * press-kit asset reproduces the artwork the approximation deliberately does
 * not, which changes the legal position without changing a single test.
 *
 * ⚠ **THE WORD-MARK FALLBACK IN `ServiceMark` IS STILL LIVE CODE.** No service
 * reaches it today, which is exactly why it is easy to delete as dead. It is
 * the removal path: if a brand objects, deleting its component and its entry
 * here restores the word mark and changes nothing else. `T-BRAND-002c` covers
 * that path with this register mocked.
 *
 * ~~Superseded 2026-09-17: "`SERVICE_MARKS` IS DELIBERATELY PARTIAL … DO NOT
 * 'COMPLETE' THIS MAP. A future contributor adding `'disney-plus':
 * DisneyPlusMark` would be undoing the decision, not finishing the work."~~
 * The owner reviewed the mixed presentation on the live list and directed that
 * the three be drawn. The reasoning behind the original gap is kept in
 * ADR-0014 §5 because it is still why these three differ in kind.
 */

import type { Service } from '@nextup/domain';

import { AppleTvMark } from './AppleTvMark';
import { DisneyPlusMark } from './DisneyPlusMark';
import { HboMaxMark } from './HboMaxMark';
import { NetflixMark } from './NetflixMark';
import { ParamountPlusMark } from './ParamountPlusMark';
import { PeacockMark } from './PeacockMark';
import { PrimeVideoMark } from './PrimeVideoMark';
import { StarzMark } from './StarzMark';
import type { BrandMarkProps } from './BrandMarkBase';

import type { JSX } from 'react';

export { BrandMarkBase, type BrandMarkProps } from './BrandMarkBase';
export { AppleTvMark } from './AppleTvMark';
export { DisneyPlusMark } from './DisneyPlusMark';
export { HboMaxMark } from './HboMaxMark';
export { NetflixMark } from './NetflixMark';
export { ParamountPlusMark } from './ParamountPlusMark';
export { PeacockMark } from './PeacockMark';
export { PrimeVideoMark } from './PrimeVideoMark';
export { StarzMark } from './StarzMark';

export type BrandMarkComponent = (props: BrandMarkProps) => JSX.Element;

export const SERVICE_MARKS: Readonly<Partial<Record<Service, BrandMarkComponent>>> = {
  netflix: NetflixMark,
  max: HboMaxMark,
  'apple-tv-plus': AppleTvMark,
  'paramount-plus': ParamountPlusMark,
  starz: StarzMark,
  'prime-video': PrimeVideoMark,
  'disney-plus': DisneyPlusMark,
  peacock: PeacockMark,
};
