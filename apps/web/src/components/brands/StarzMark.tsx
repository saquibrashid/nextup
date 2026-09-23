// Vendored artwork; origin, revision and presentation changes: ATTRIBUTION.md.
import type { JSX } from 'react';

import { BrandMarkBase, type BrandMarkProps } from './BrandMarkBase';
import artwork from './assets/starz.svg?inline';

export function StarzMark(props: BrandMarkProps): JSX.Element {
  return <BrandMarkBase {...props} source={artwork} />;
}
