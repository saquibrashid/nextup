// Vendored artwork; origin, revision and presentation changes: ATTRIBUTION.md.
import type { JSX } from 'react';

import { BrandMarkBase, type BrandMarkProps } from './BrandMarkBase';
import artwork from './assets/peacock.svg?inline';

export function PeacockMark(props: BrandMarkProps): JSX.Element {
  return <BrandMarkBase {...props} source={artwork} />;
}
