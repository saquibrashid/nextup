// Vendored artwork; origin, revision and presentation changes: ATTRIBUTION.md.
import type { JSX } from 'react';

import { BrandMarkBase, type BrandMarkProps } from './BrandMarkBase';
import artwork from './assets/paramount-plus.svg?inline';

export function ParamountPlusMark(props: BrandMarkProps): JSX.Element {
  return <BrandMarkBase {...props} source={artwork} />;
}
