/**
 * The closed service-mark register (ADR-0014, issue #288).
 *
 * All eight use vendored artwork, not hand-drawn substitutes (Revision 3).
 * ATTRIBUTION.md records the pinned CC0/public-domain sources, presentation
 * changes and trademark limits. No streaming-service asset requests.
 *
 * ⚠ **THE WORD-MARK FALLBACK IN `ServiceMark` IS STILL LIVE CODE.** No service
 * reaches it today, which is exactly why it is easy to delete as dead. It is
 * the removal path: if a brand objects, deleting its component and its entry
 * here restores the word mark and changes nothing else. `T-BRAND-002c` covers
 * that path with this register mocked.
 *
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
