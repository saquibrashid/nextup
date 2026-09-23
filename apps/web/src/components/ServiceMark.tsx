/**
 * One service, rendered as its mark where we have one and as its word mark
 * where we do not (ADR-0014, issue #288, `specs/ui.md` §2.2a).
 *
 * ⚠ **THE ACCESSIBLE NAME IS IDENTICAL IN BOTH BRANCHES, AND THAT IS THE
 * POINT.** A logo-only badge is unreadable to a screen reader *and* unfindable
 * by the browser's own in-page text search — two failures that a screenshot
 * cannot show. `nameHidden` moves the service name out of sight, never out of
 * the DOM: `T-BRAND-002a` asserts the name across all eight services and
 * `T-BRAND-002b` asserts it does not change between the two branches.
 *
 * The visible word-mark fallback remains the removal path if a bundled asset
 * must be withdrawn. All eight services currently have a mark.
 */

import type { JSX } from 'react';
import { SERVICE_LABELS, type Service } from '@nextup/domain';

import { SERVICE_MARKS } from './brands';

// ⚠ A static lookup keyed by an identifier, never an inline ternary or a
// template literal: `T-CSS-001c`'s analyzer harvests map values only in this
// shape, and anything else makes the class vocabulary unscannable.
const NAME_CLASS = {
  shown: 'service-mark__name',
  hidden: 'service-mark__name--hidden',
} as const;

export interface ServiceMarkProps {
  readonly service: Service;
  /**
   * Render the service name visually hidden rather than as visible text. Used
   * by row badges, where the mark carries the meaning on screen; the upload
   * chooser leaves it visible because the option is a labelled control.
   */
  readonly nameHidden?: boolean;
}

export function ServiceMark({ service, nameHidden = false }: ServiceMarkProps): JSX.Element {
  const Mark = SERVICE_MARKS[service];
  const label = SERVICE_LABELS[service];
  if (Mark === undefined) {
    // No mark: the word mark IS the rendering, so `nameHidden` cannot apply —
    // hiding it here would leave an empty chip carrying nothing at all.
    return <span className="service-mark__name">{label}</span>;
  }
  const nameVisibility = nameHidden ? 'hidden' : 'shown';
  return (
    <>
      <Mark />
      <span className={NAME_CLASS[nameVisibility]}>{label}</span>
    </>
  );
}
