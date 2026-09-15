import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../src/components/ui/Button';

export function buttonVariantMarkup(): string {
  const variants = ['primary', 'secondary', 'ghost', 'danger'] as const;
  return renderToStaticMarkup(
    createElement(
      'main',
      {},
      ...variants.map((variant) => createElement(Button, { variant, key: variant }, variant)),
    ),
  );
}
