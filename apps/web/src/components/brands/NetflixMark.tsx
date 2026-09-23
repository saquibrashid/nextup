// Vendored artwork; origin, revision and presentation changes: ATTRIBUTION.md.
import type { JSX } from 'react';

import { BrandMarkBase, type BrandMarkProps } from './BrandMarkBase';
import artwork from './assets/netflix.svg?inline';

export function NetflixMark(props: BrandMarkProps): JSX.Element {
  return <BrandMarkBase {...props} source={artwork} />;
}
