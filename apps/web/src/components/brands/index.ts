/**
 * The closed service-mark register (ADR-0014, issue #288).
 *
 * ⚠ **`SERVICE_MARKS` IS DELIBERATELY PARTIAL, AND THE GAPS ARE A DECISION,
 * NOT A BACKLOG.** Prime Video, Disney+ and Peacock have **no** entry because
 * their marks are absent from the CC0 source — Amazon and Disney are among the
 * brands removed from it through its published removal process. Re-drawing
 * them from a press kit would take on precisely the risk the source declined
 * to carry, for three logos out of eight. Those services render their word
 * mark instead, which is what every service rendered before this change.
 *
 * ⚠ **DO NOT "COMPLETE" THIS MAP.** A future contributor adding
 * `'disney-plus': DisneyPlusMark` would be undoing the decision, not finishing
 * the work. `T-BRAND-002c` asserts the three gaps are still gaps.
 */

import type { Service } from '@nextup/domain';

import { AppleTvMark } from './AppleTvMark';
import { HboMaxMark } from './HboMaxMark';
import { NetflixMark } from './NetflixMark';
import { ParamountPlusMark } from './ParamountPlusMark';
import { StarzMark } from './StarzMark';
import type { BrandMarkProps } from './BrandMarkBase';

import type { JSX } from 'react';

export { BrandMarkBase, type BrandMarkProps } from './BrandMarkBase';
export { AppleTvMark } from './AppleTvMark';
export { HboMaxMark } from './HboMaxMark';
export { NetflixMark } from './NetflixMark';
export { ParamountPlusMark } from './ParamountPlusMark';
export { StarzMark } from './StarzMark';

export type BrandMarkComponent = (props: BrandMarkProps) => JSX.Element;

export const SERVICE_MARKS: Readonly<Partial<Record<Service, BrandMarkComponent>>> = {
  netflix: NetflixMark,
  max: HboMaxMark,
  'apple-tv-plus': AppleTvMark,
  'paramount-plus': ParamountPlusMark,
  starz: StarzMark,
};
