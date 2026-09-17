// `T-UI-030` and `T-A11Y-016` — the icon set (REQ-124, `specs/ui-refresh.md`
// §7c, TASK-209).
//
// ⚠ `T-A11Y-016` WAS WRITTEN IN §7c AS `T-A11Y-014`, WHICH WAS ALREADY TAKEN
// (`specs/testing.md` L1247, the US-033 refusal enumeration). `check:test-ids`
// only asks whether a cited id is defined *somewhere*, so the collision passed
// every gate — and TASK-209 would have reported **done** off a passing refusal
// test that asserts nothing whatever about icons. Corrected in place in §7c.
//
// ⚠ THE SOURCE SCAN AND THE RENDER ARE BOTH NECESSARY, and neither subsumes
// the other. Rendering proves what the browser is actually handed; the file
// scan proves that a *future* icon cannot bypass `IconBase` and quietly lose
// the accessibility contract, because the scan fails on any `<svg` outside
// this directory rather than waiting for someone to render it in a test.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import * as icons from '../src/components/icons';
import { IconBase } from '../src/components/icons/IconBase';

// ⚠ NOT `fileURLToPath(import.meta.url)` — the `web` project runs in jsdom,
// where `import.meta.url` is an http URL and that call THROWS at import time,
// failing the whole file in a way that reads as a broken test rather than as a
// failed assertion. Same reasoning, same shape, as `stylesheet.spec.ts`.
const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const SRC_ROOT = join(WEB_ROOT, 'src');
const ICONS_ROOT = join(SRC_ROOT, 'components', 'icons');

/** §7c's closed Revision 2 set, transcribed. A 22nd icon fails `T-UI-030b`. */
const CLOSED_SET = [
  'AlphabetIcon',
  'BookmarkIcon',
  'BrandIcon',
  'CalendarIcon',
  'CheckIcon',
  'ChevronIcon',
  'ClockIcon',
  'CloseIcon',
  'CompactIcon',
  'FlagIcon',
  'GridIcon',
  'HistoryIcon',
  'ImageIcon',
  'InfoIcon',
  'ListIcon',
  'MoreIcon',
  'RatingIcon',
  'SearchIcon',
  'SuppressedIcon',
  'UploadIcon',
  'WarningIcon',
] as const;

type IconComponent = (props: { readonly label?: string }) => JSX.Element;

const iconEntries: readonly (readonly [string, IconComponent])[] = CLOSED_SET.map((name) => {
  const component = (icons as unknown as Record<string, IconComponent | undefined>)[name];
  if (component === undefined) throw new Error(`${name} is not exported from the icons barrel`);
  return [name, component] as const;
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('T-UI-030 — every icon inherits its colour and declares none of its own', () => {
  it.each(iconEntries)('T-UI-030a: %s renders stroke="currentColor"', (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
  });

  it('T-UI-030b: the exported set is exactly the 21 §7c names', () => {
    // ⚠ A SET THAT GROWS ONE FILE AT A TIME IS NOT CLOSED. §7c's "no icon
    // package" decision rests on the set being small and deliberate; without
    // this the barrel becomes a library with extra steps and nobody notices.
    const exported = Object.keys(icons)
      .filter((name) => name.endsWith('Icon') && name !== 'IconBase')
      .sort();
    expect(exported).toEqual([...CLOSED_SET].sort());
  });

  it('T-UI-030c: no icon source declares a hard-coded colour', () => {
    // ⚠ THIS IS THE HALF `T-CSS-004` CANNOT SEE. The computed-contrast gate
    // reads `:root`; a `#hex` in a `.tsx` file sits outside the stylesheet
    // entirely, so an icon with its own colour passes every contrast check
    // while being precisely the thing those checks exist to catch.
    const offenders = walk(ICONS_ROOT).filter((file) => {
      const source = readFileSync(file, 'utf8');
      return (
        /#[0-9a-f]{3,8}\b/i.test(source) ||
        /\b(rgba?|hsla?)\s*\(/i.test(source) ||
        /(fill|stroke)="(?!currentColor|none")/.test(source)
      );
    });
    expect(offenders).toEqual([]);
  });

  it('T-UI-030d: every icon is drawn on the 24px grid at stroke-width 1.5', () => {
    // Mixed viewBoxes are the reason hand-drawn sets look subtly wrong
    // together: each icon is individually fine and the row is ragged.
    for (const [name, Icon] of iconEntries) {
      const { container, unmount } = render(<Icon />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('viewBox'), name).toBe('0 0 24 24');
      expect(svg?.getAttribute('stroke-width'), name).toBe('1.5');
      unmount();
    }
  });

  it('T-UI-030e: no icon font, sprite URL or icon package is introduced', () => {
    // §7c / NFR-004 / `T-CI-007`. The owner accepted icons at `A53` (OQ-8)
    // specifically on the basis that neither a runtime dependency nor a
    // network request is incurred; both would arrive here first.
    const manifest = JSON.parse(readFileSync(join(WEB_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const named = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    expect(named.filter((pkg) => /icon|lucide|heroicon|feather|fontawesome/i.test(pkg))).toEqual(
      [],
    );

    const sources = walk(ICONS_ROOT).map((file) => readFileSync(file, 'utf8'));
    for (const source of sources) {
      expect(source).not.toMatch(/xlinkHref|href="[^"]*\.svg|url\(/i);
    }
  });
});

describe('T-A11Y-016 — an icon is never the sole label', () => {
  it('T-A11Y-016a: an unlabelled icon is hidden from the accessibility tree', () => {
    const { container } = render(<icons.ListIcon />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
    expect(svg?.getAttribute('aria-label')).toBeNull();
  });

  it('T-A11Y-016b: a labelled icon is exposed with that name', () => {
    render(<icons.MoreIcon label="More actions" />);
    const svg = screen.getByRole('img', { name: 'More actions' });
    // ⚠ `role="img"` IS LOAD-BEARING. An `aria-label` on a bare `<svg>` is
    // ignored by several screen readers because the element has no implicit
    // role to name — the icon is silently anonymous while the attribute is
    // right there in the markup, which is why this asserts the ROLE lookup
    // and not `getAttribute('aria-label')`.
    expect(svg.getAttribute('aria-hidden')).toBeNull();
  });

  it('T-A11Y-016c: every icon supports both modes', () => {
    for (const [name, Icon] of iconEntries) {
      const decorative = render(<Icon />);
      expect(decorative.container.querySelector('svg')?.getAttribute('aria-hidden'), name).toBe(
        'true',
      );
      decorative.unmount();

      const named = render(<Icon label={name} />);
      expect(named.container.querySelector('svg')?.getAttribute('aria-label'), name).toBe(name);
      named.unmount();
    }
  });

  it('T-A11Y-016d: no <svg> exists in apps/web/src outside the icons directory', () => {
    // ⚠ THE WHOLE ACCESSIBILITY CONTRACT LIVES IN `IconBase`, so this is the
    // assertion that keeps it universal. A hand-authored `<svg>` elsewhere
    // draws perfectly and inherits none of it, and only a screen reader ever
    // discovers that the control containing it has no name.
    const offenders = walk(SRC_ROOT)
      .filter((file) => !file.startsWith(ICONS_ROOT))
      .filter((file) => /<svg\b/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('T-A11Y-016e: an icon-only control renders with a non-empty accessible name', () => {
    // The composition §7c requires, asserted end to end so the rule is
    // demonstrated and not merely described — REQ-117's bar and REQ-105's row
    // menu are both built exactly this way.
    render(
      <button type="button" aria-label="Close">
        <icons.CloseIcon />
      </button>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('T-A11Y-016f: an icon beside a visible label does not duplicate that label', () => {
    // ⚠ THE OPPOSITE DEFECT, AND IT IS THE COMMONER ONE. Labelling a
    // decorative icon inside an already-named control makes the reader
    // announce "Upload Upload" — which nobody reviewing the diff can hear.
    render(
      <button type="button">
        <IconBase>
          <path d="M12 16V4" />
        </IconBase>
        Upload
      </button>,
    );
    expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy();
  });
});
