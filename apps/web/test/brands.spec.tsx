/**
 * `T-BRAND-001` / `T-BRAND-002` — the bundled service marks (ADR-0014,
 * issue #288, `specs/ui.md` §2.2a).
 *
 * ⚠ **THIS FILE IS THE PRICE OF EXCLUDING `brands/` FROM `T-A11Y-016d`.** The
 * icon gate stops scanning this directory because a filled brand glyph cannot
 * satisfy ADR-0013's stroke contract; without an equivalent gate here, the
 * exclusion would be a hole rather than a boundary, and the next `<svg>`
 * dropped in would inherit nothing and be caught by nothing.
 *
 * ⚠ **ORIGIN IS ASSERTED, NOT JUST SHAPE.** Five marks are vendored from a CC0
 * source and three are drawn here (ADR-0014 Revision 2). Nothing at render
 * time tells them apart — both are monochrome paths on a 24-grid — so
 * `T-BRAND-001g` pins the distinction in the source files, and
 * `T-BRAND-002c` keeps the word-mark fallback (the removal path a brand
 * objection would use) alive even though no service reaches it today.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SERVICES, SERVICE_LABELS } from '@nextup/domain';

import * as brands from '../src/components/brands';
import { ServiceMark } from '../src/components/ServiceMark';

// ⚠ Not `import.meta.url`: the `web` project runs in jsdom, where that is an
// http URL and `fileURLToPath` THROWS at import time — the same trap
// `icons.spec.tsx` and `stylesheet.spec.ts` document.
const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const BRANDS_ROOT = join(WEB_ROOT, 'src', 'components', 'brands');

/**
 * ADR-0014's closed set, transcribed. A ninth mark fails `T-BRAND-001b`.
 *
 * ⚠ The last three are **drawn here**, not vendored (ADR-0014 Revision 2), and
 * `T-BRAND-001g` pins that distinction in their source. They are listed in the
 * same set on purpose: every mark, whatever its origin, owes the same
 * monochrome, decorative-by-default, no-network contract.
 */
const CLOSED_SET = [
  'AppleTvMark',
  'HboMaxMark',
  'NetflixMark',
  'ParamountPlusMark',
  'StarzMark',
  'PrimeVideoMark',
  'DisneyPlusMark',
  'PeacockMark',
] as const;

/** The three the owner directed be drawn rather than left as word marks. */
const DRAWN = ['PrimeVideoMark', 'DisneyPlusMark', 'PeacockMark'] as const;

/** The five taken verbatim from the CC0 source, which `ATTRIBUTION.md` pins. */
const VENDORED = [
  'AppleTvMark',
  'HboMaxMark',
  'NetflixMark',
  'ParamountPlusMark',
  'StarzMark',
] as const;

type MarkComponent = (props: { readonly label?: string }) => JSX.Element;

const markEntries: readonly (readonly [string, MarkComponent])[] = CLOSED_SET.map((name) => {
  const component = (brands as unknown as Record<string, MarkComponent | undefined>)[name];
  if (component === undefined) throw new Error(`${name} is not exported from the brands barrel`);
  return [name, component] as const;
});

/**
 * ⚠ COMMENTS ARE STRIPPED BEFORE THE COLOUR SCAN, and the reason is not
 * cosmetic: `#288` — this feature's own issue number — is three hex digits and
 * matches a `#rgb` literal exactly. Scanning raw source makes the gate fire on
 * prose, which teaches the next person to delete the reference or weaken the
 * regex. A hex inside a comment colours nothing; a hex in code colours
 * something.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('T-BRAND-001 — the bundled marks are monochrome, closed and self-contained', () => {
  it('T-BRAND-001a: every mark fills with currentColor on the 24px grid', () => {
    for (const [name, Mark] of markEntries) {
      const { container, unmount } = render(<Mark />);
      const svg = container.querySelector('svg');
      expect(svg, name).not.toBeNull();
      expect(svg?.getAttribute('fill'), name).toBe('currentColor');
      expect(svg?.getAttribute('viewBox'), name).toBe('0 0 24 24');
      unmount();
    }
  });

  it('T-BRAND-001b: the exported set is exactly the eight ADR-0014 marks', () => {
    const exported = Object.keys(brands)
      .filter((name) => name.endsWith('Mark') && name !== 'BrandMarkBase')
      .sort();
    expect(exported).toEqual([...CLOSED_SET].sort());
  });

  it('T-BRAND-001c: no mark source declares a colour of its own', () => {
    // ⚠ The half the stylesheet gate cannot see. A brand-coloured mark sits
    // outside `:root` entirely, so it passes every contrast check while being
    // precisely what those checks exist to catch — and Netflix red on the dark
    // surface is a real failure, not a hypothetical one.
    const offenders = walk(BRANDS_ROOT).filter((file) => {
      const source = stripComments(readFileSync(file, 'utf8'));
      return (
        /#[0-9a-f]{3,8}\b/i.test(source) ||
        /\b(rgba?|hsla?)\s*\(/i.test(source) ||
        /(fill|stroke)="(?!currentColor")/.test(source)
      );
    });
    expect(offenders).toEqual([]);
  });

  it('T-BRAND-001d: nothing is fetched — no package, no sprite, no URL', () => {
    // Product invariant 10 and ADR-0014: the marks are COMPILED IN. A request
    // for a logo is a request to a streaming service's CDN, which this product
    // never makes, and it would also leak that the owner is using this app.
    const manifest = JSON.parse(readFileSync(join(WEB_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const named = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    expect(named.filter((pkg) => /simple-icons|brandicons|logo/i.test(pkg))).toEqual([]);

    for (const source of walk(BRANDS_ROOT).map((file) => readFileSync(file, 'utf8'))) {
      expect(source).not.toMatch(/xlinkHref|href="[^"]*\.svg|url\(|fetch\(/i);
    }
  });

  it('T-BRAND-001e: the attribution file exists and records the pinned source', () => {
    // The AC the owner wrote: bundled marks are only defensible alongside a
    // record of where they came from and on what terms.
    const attribution = readFileSync(join(BRANDS_ROOT, 'ATTRIBUTION.md'), 'utf8');
    expect(attribution).toMatch(/CC0 1\.0 Universal/);
    expect(attribution).toMatch(/f2365d33171bd1897a41aaae6c0b6e795bcc0483/);
    for (const name of CLOSED_SET) expect(attribution).toContain(name);
  });

  it('T-BRAND-001g: a drawn mark says so in its own source, and a vendored one does not', () => {
    /*
     * ⚠ THE TWO ORIGINS MUST STAY TELLABLE APART IN THE FILE ITSELF. The
     * difference is invisible at render time — both are monochrome paths on a
     * 24-grid — but it is the whole of the legal position: five are CC0 and
     * re-vendorable from a pinned commit, three are approximations the owner
     * accepted the risk of (ADR-0014 Rev 2). Someone quietly replacing a drawn
     * mark with a traced press-kit asset reproduces the artwork the drawing
     * avoids, and nothing else in this suite would notice.
     */
    for (const name of DRAWN) {
      const source = readFileSync(join(BRANDS_ROOT, `${name}.tsx`), 'utf8');
      expect(source, name).toMatch(/ORIGINALLY DRAWN HERE — NOT VENDORED/);
    }
    for (const name of VENDORED) {
      const source = readFileSync(join(BRANDS_ROOT, `${name}.tsx`), 'utf8');
      expect(source, name).not.toMatch(/ORIGINALLY DRAWN/);
      expect(source, name).toMatch(/Slug: /);
    }
  });

  it('T-BRAND-001f: a mark is decorative unless named, and named marks announce', () => {
    for (const [name, Mark] of markEntries) {
      const decorative = render(<Mark />);
      expect(decorative.container.querySelector('svg')?.getAttribute('aria-hidden'), name).toBe(
        'true',
      );
      decorative.unmount();

      const named = render(<Mark label={name} />);
      expect(screen.getByRole('img', { name })).toBeTruthy();
      named.unmount();
    }
  });
});

describe('T-BRAND-002 — a mark never becomes the sole carrier of meaning', () => {
  it.each(SERVICES)('T-BRAND-002a: the %s badge keeps its accessible name', (service) => {
    const { container } = render(<ServiceMark service={service} nameHidden />);
    // ⚠ `textContent`, not a visibility query. The name is CLIPPED, not
    // removed: this is what a screen reader reads and what the browser's own
    // in-page text search finds, and a logo-only badge loses both silently.
    expect(container.textContent).toBe(SERVICE_LABELS[service]);
  });

  it.each(SERVICES)('T-BRAND-002b: hiding the %s name does not change it', (service) => {
    const hidden = render(<ServiceMark service={service} nameHidden />);
    const hiddenText = hidden.container.textContent;
    hidden.unmount();
    const shown = render(<ServiceMark service={service} />);
    expect(shown.container.textContent).toBe(hiddenText);
  });

  it('T-BRAND-002c: the word-mark fallback still works when a service has no mark', async () => {
    /*
     * ⚠ THIS PATH IS UNREACHABLE IN PRODUCTION AND MUST STAY ALIVE ANYWAY.
     * All eight services now have a mark (ADR-0014 Rev 2), so `ServiceMark`'s
     * fallback branch never runs for real data — which makes it look exactly
     * like dead code to the next person reading it. It is the removal path the
     * whole trademark position rests on: if a brand objects, deleting its
     * component and its `SERVICE_MARKS` entry must restore the word mark and
     * change nothing else. The register is mocked empty to prove that is still
     * true.
     *
     * ~~Superseded 2026-09-17: this case asserted that Prime Video, Disney+
     * and Peacock had NO mark, to stop the set being "completed" from a press
     * kit.~~ The owner directed that they be drawn; the guard that replaced it
     * is `T-BRAND-001g`, which keeps drawn and vendored origins tellable apart.
     */
    vi.resetModules();
    vi.doMock('../src/components/brands', () => ({ SERVICE_MARKS: {} }));
    const { ServiceMark: WithoutMarks } = await import('../src/components/ServiceMark');
    const { container, unmount } = render(<WithoutMarks service="netflix" nameHidden />);
    expect(container.querySelector('svg')).toBeNull();
    // The word mark stays VISIBLE — hiding it would leave an empty chip.
    expect(container.querySelector('.service-mark__name--hidden')).toBeNull();
    expect(container.textContent).toBe(SERVICE_LABELS.netflix);
    unmount();
    vi.doUnmock('../src/components/brands');
    vi.resetModules();
  });

  it('T-BRAND-002d: every service renders its mark beside the hidden name', () => {
    for (const service of SERVICES) {
      const { container, unmount } = render(<ServiceMark service={service} nameHidden />);
      expect(container.querySelector('svg'), service).not.toBeNull();
      expect(container.querySelector('.service-mark__name--hidden'), service).not.toBeNull();
      unmount();
    }
  });
});
