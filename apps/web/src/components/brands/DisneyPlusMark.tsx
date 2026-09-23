// Vendored artwork; origin, revision and presentation changes: ATTRIBUTION.md.
import type { JSX } from 'react';

import { BrandMarkBase, type BrandMarkProps } from './BrandMarkBase';
import artwork from './assets/disney-plus.svg?inline';

export function DisneyPlusMark(props: BrandMarkProps): JSX.Element {
  return <BrandMarkBase {...props} source={artwork} />;
}
