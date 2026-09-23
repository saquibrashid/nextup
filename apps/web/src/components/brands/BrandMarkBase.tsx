import type { JSX } from 'react';

export interface BrandMarkProps {
  readonly label?: string;
}

/** Local SVG data URLs preserve artwork proportions without document-level SVG IDs. */
export function BrandMarkBase({
  label,
  source,
}: BrandMarkProps & { readonly source: string }): JSX.Element {
  const named = label !== undefined;
  return (
    <img
      className="brand-mark"
      src={source}
      alt={label ?? ''}
      aria-hidden={named ? undefined : true}
      role={named ? 'img' : undefined}
      draggable={false}
    />
  );
}
