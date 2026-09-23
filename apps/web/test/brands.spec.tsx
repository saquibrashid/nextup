import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SERVICES, SERVICE_LABELS } from '@nextup/domain';

import * as brands from '../src/components/brands';
import { ServiceMark } from '../src/components/ServiceMark';

const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const BRANDS_ROOT = join(WEB_ROOT, 'src', 'components', 'brands');
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

const ARTWORK_HASHES = {
  'prime-video': '4d2874553d1df490cdec9694c761f7cb2389d7fab417466885bcdadcfcf1a49a',
  'disney-plus': '435b6cc464dac531962f7f098fa8ac3241e4e2ee1035645a2624337f15e59d17',
  peacock: 'f974ecfa0b93fdfae2629c40a797471cf6989b32d4e7bb23f5a99a21e2453a66',
  'apple-tv-plus': '00e64e52cc4eb88999740d5abdcdf3e413031e43da9176254ab91bc7f1ee993b',
  netflix: '7160e35c5d7d90dfb9c94ce6f3ca62da154f52c90159da3eb64fb55323d1605c',
  max: '347eddb7773c13331e0cc198b061db50d15e0a111b62eb3facbcf490e32164ca',
  'paramount-plus': 'cd22e71f842bc000b7a277932aae279f2824840bd70589306ffb2b6bc0703dc5',
  starz: '85f8f5b6b901c789b56cafc6a66a520a89ca543cd7494a49dd702164ff87dee2',
} as const;

const markEntries = CLOSED_SET.map((name) => [name, brands[name]] as const);

function artwork(service: string): string {
  return readFileSync(join(BRANDS_ROOT, 'assets', `${service}.svg`), 'utf8').replace(/\r\n/g, '\n');
}

describe('T-BRAND-001 — authentic artwork is closed, attributed and self-contained', () => {
  it('T-BRAND-001a: every mark embeds its own local artwork, retaining a native viewBox', () => {
    for (const service of SERVICES) {
      const Mark = brands.SERVICE_MARKS[service];
      if (Mark === undefined) throw new Error(`Missing ${service} artwork`);
      const { container, unmount } = render(<Mark />);
      const image = container.querySelector('img');
      const source = image?.getAttribute('src') ?? '';
      expect(source, service).toMatch(/^data:image\/svg\+xml[;,]/);
      const separator = source.indexOf(',');
      const decoded = source.slice(0, separator).includes(';base64')
        ? Buffer.from(source.slice(separator + 1), 'base64').toString('utf8')
        : decodeURIComponent(source.slice(separator + 1));
      const embedded = new DOMParser().parseFromString(decoded, 'image/svg+xml');
      const local = new DOMParser().parseFromString(artwork(service), 'image/svg+xml');
      expect(embedded.querySelector('parsererror'), service).toBeNull();
      expect(embedded.documentElement.getAttribute('viewBox'), service).toBe(
        local.documentElement.getAttribute('viewBox'),
      );
      expect(
        [...embedded.querySelectorAll('path')].map((path) => path.getAttribute('d')),
        service,
      ).toEqual([...local.querySelectorAll('path')].map((path) => path.getAttribute('d')));
      expect(image?.getAttribute('draggable')).toBe('false');
      unmount();
    }
  });

  it('T-BRAND-001b: exports and bundled assets are exactly the eight approved marks', () => {
    expect(
      Object.keys(brands)
        .filter((name) => name.endsWith('Mark') && name !== 'BrandMarkBase')
        .sort(),
    ).toEqual([...CLOSED_SET].sort());
    expect(readdirSync(join(BRANDS_ROOT, 'assets')).sort()).toEqual(
      SERVICES.map((service) => `${service}.svg`).sort(),
    );
  });

  it('T-BRAND-001c: brand colours stay inside the pinned artwork, not component styling', () => {
    for (const file of readdirSync(BRANDS_ROOT).filter((name) => /\.tsx?$/.test(name))) {
      const source = readFileSync(join(BRANDS_ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(source, file).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/i);
      expect(source, file).not.toMatch(/<(?:svg|path)\b/);
    }
    expect(artwork('netflix')).toContain('#e50914');
    expect(artwork('prime-video')).toContain('#0779ff');
    expect(new Set(artwork('peacock').match(/#[0-9a-f]{6}/gi)).size).toBe(7);
  });

  it('T-BRAND-001d: artwork cannot execute code, load external resources or add a package', () => {
    const manifest = JSON.parse(readFileSync(join(WEB_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(
      [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
      ].filter((pkg) => /simple-icons|brandicons|logo/i.test(pkg)),
    ).toEqual([]);
    const allowedElements = new Set(['svg', 'path', 'g', 'defs', 'radialGradient', 'stop']);
    const allowedAttributes = new Set([
      'xmlns',
      'viewBox',
      'fill',
      'id',
      'd',
      'fill-opacity',
      'stroke',
      'gradientUnits',
      'cx',
      'cy',
      'r',
      'fx',
      'fy',
      'offset',
      'stop-color',
      'stop-opacity',
    ]);
    for (const service of SERVICES) {
      const text = artwork(service);
      expect(text, service).not.toMatch(/<!DOCTYPE|<!ENTITY|@import/i);
      const document = new DOMParser().parseFromString(text, 'image/svg+xml');
      expect(document.querySelector('parsererror'), service).toBeNull();
      for (const element of document.querySelectorAll('*')) {
        expect(allowedElements.has(element.localName), `${service}: ${element.localName}`).toBe(
          true,
        );
        for (const attribute of element.attributes) {
          expect(allowedAttributes.has(attribute.name), `${service}: ${attribute.name}`).toBe(true);
          if (attribute.name === 'xmlns') {
            expect(attribute.value).toBe('http://www.w3.org/2000/svg');
          } else {
            expect(attribute.value).not.toMatch(/https?:|data:|javascript:/i);
          }
          if (attribute.value.includes('url(')) {
            expect(attribute.value).toMatch(/^url\(#[a-zA-Z0-9-]+\)$/);
            const id = attribute.value.slice(5, -1);
            expect(document.getElementById(id)).not.toBeNull();
          }
        }
      }
    }
    for (const file of readdirSync(BRANDS_ROOT).filter((name) => /\.tsx?$/.test(name))) {
      const source = readFileSync(join(BRANDS_ROOT, file), 'utf8');
      expect(source, file).not.toMatch(/fetch\(|https?:\/\/|dangerouslySetInnerHTML/);
    }
  });

  it('T-BRAND-001e: attribution records both source families, pinned revisions and changes', () => {
    const attribution = readFileSync(join(BRANDS_ROOT, 'ATTRIBUTION.md'), 'utf8');
    expect(attribution).toContain('CC0 1.0 Universal');
    expect(attribution).toContain('f2365d33171bd1897a41aaae6c0b6e795bcc0483');
    expect(attribution).toContain('PD-textlogo');
    expect(attribution).toContain('Presentation changes');
    for (const name of CLOSED_SET) expect(attribution).toContain(name);
    for (const hash of Object.values(ARTWORK_HASHES)) expect(attribution).toContain(hash);
  });

  it('T-BRAND-001g: every asset matches its reviewed provenance hash, not an approximation', () => {
    for (const service of SERVICES) {
      expect(createHash('sha256').update(artwork(service)).digest('hex'), service).toBe(
        ARTWORK_HASHES[service],
      );
    }
    for (const name of CLOSED_SET) {
      const source = readFileSync(join(BRANDS_ROOT, `${name}.tsx`), 'utf8');
      expect(source).toMatch(/import artwork from '\.\/assets\/[a-z-]+\.svg\?inline'/);
      expect(source).toContain('ATTRIBUTION.md');
      expect(source).not.toMatch(/ORIGINALLY DRAWN/);
    }
  });

  it('T-BRAND-001f: marks are decorative unless named, and named marks announce', () => {
    for (const [name, Mark] of markEntries) {
      const decorative = render(<Mark />);
      expect(decorative.container.querySelector('img')?.getAttribute('aria-hidden'), name).toBe(
        'true',
      );
      expect(decorative.container.querySelector('img')?.getAttribute('alt'), name).toBe('');
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
    expect(container.textContent).toBe(SERVICE_LABELS[service]);
  });

  it.each(SERVICES)('T-BRAND-002b: hiding the %s name does not change it', (service) => {
    const hidden = render(<ServiceMark service={service} nameHidden />);
    const hiddenText = hidden.container.textContent;
    hidden.unmount();
    const shown = render(<ServiceMark service={service} />);
    expect(shown.container.textContent).toBe(hiddenText);
  });

  it('T-BRAND-002c: removing artwork restores visible service-name text', async () => {
    vi.resetModules();
    vi.doMock('../src/components/brands', () => ({ SERVICE_MARKS: {} }));
    const { ServiceMark: WithoutMarks } = await import('../src/components/ServiceMark');
    const { container, unmount } = render(<WithoutMarks service="netflix" nameHidden />);
    expect(container.querySelector('img, svg')).toBeNull();
    expect(container.querySelector('.service-mark__name--hidden')).toBeNull();
    expect(container.textContent).toBe(SERVICE_LABELS.netflix);
    unmount();
    vi.doUnmock('../src/components/brands');
    vi.resetModules();
  });

  it('T-BRAND-002d: every service renders one local image beside its hidden name', () => {
    for (const service of SERVICES) {
      const { container, unmount } = render(<ServiceMark service={service} nameHidden />);
      expect(container.querySelectorAll('img'), service).toHaveLength(1);
      expect(container.querySelector('.service-mark__name--hidden'), service).not.toBeNull();
      unmount();
    }
  });
});
