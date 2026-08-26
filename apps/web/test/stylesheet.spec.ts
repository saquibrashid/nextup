/**
 * `T-CSS-001`…`004` — the stylesheet (`specs/ui.md` §13, TASK-179/180).
 *
 * ⚠ THE PROJECT SHIPPED WITH NO CSS AT ALL and every gate stayed green,
 * including an axe-core pass and a 320 px no-horizontal-scroll pass — an
 * unstyled document has no overflow and no rendered contrast pair to fail on.
 * These assertions read the stylesheet as a FILE, so they cannot be satisfied
 * by a document that never loaded it.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ⚠ NOT `fileURLToPath(import.meta.url)` — the `web` project runs in jsdom,
// where `import.meta.url` is an http URL and that call THROWS at import time,
// failing the whole file in a way that reads as a broken test rather than a
// failed assertion.
const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const SRC_ROOT = join(WEB_ROOT, 'src');
const CSS_PATH = join(SRC_ROOT, 'index.css');

const css = readFileSync(CSS_PATH, 'utf8');

/** Strips comments so a class name mentioned in prose is not counted as a rule. */
const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const sourceFiles = walk(SRC_ROOT);

/** Every class name any component actually renders. */
const usedClasses = new Set<string>(
  sourceFiles.flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/className="([^"]+)"/g)].flatMap((match) =>
      (match[1] ?? '').split(/\s+/).filter(Boolean),
    ),
  ),
);

/** Every class name the stylesheet defines a rule for. */
const definedClasses = new Set<string>(
  [...cssWithoutComments.matchAll(/\.([a-z][a-z0-9_-]*)/gi)].map((match) => match[1] ?? ''),
);

describe('T-CSS-001 — the class vocabulary matches in BOTH directions', () => {
  it('T-CSS-001a: every class a component renders is defined in the stylesheet', () => {
    const undefinedClasses = [...usedClasses].filter((name) => !definedClasses.has(name)).sort();
    expect(undefinedClasses).toEqual([]);
  });

  it('T-CSS-001b: every class the stylesheet defines is actually rendered', () => {
    // ⚠ THE REVERSE DIRECTION IS THE ONE THAT CATCHES A RENAME. Checking only
    // that used classes exist lets a component rename leave dead CSS behind
    // and the screen silently unstyled — which looks like a CSS bug, not a
    // rename, and is hunted in the wrong file.
    const unused = [...definedClasses].filter((name) => !usedClasses.has(name)).sort();
    expect(unused).toEqual([]);
  });

  it('T-CSS-001c: no className is computed, so both directions above are exact', () => {
    // A template-literal or conditional className would make the static scan
    // above incomplete while still passing — a vacuous green.
    const computed = sourceFiles.filter((file) => /className=\{/.test(readFileSync(file, 'utf8')));
    expect(computed).toEqual([]);
  });
});

describe('T-CSS-002 — the stylesheet is imported', () => {
  it('T-CSS-002a: main.tsx imports index.css', () => {
    // ⚠ WITHOUT THIS EVERY OTHER ASSERTION HERE PASSES ON AN UNSTYLED PAGE.
    // A stylesheet that exists but is never imported is indistinguishable
    // from no stylesheet at build time; Vite will not warn.
    const main = readFileSync(join(SRC_ROOT, 'main.tsx'), 'utf8');
    expect(main).toMatch(/import\s+['"]\.\/index\.css['"]/);
  });

  it('T-CSS-002b: the stylesheet is not empty', () => {
    expect(cssWithoutComments.trim().length).toBeGreaterThan(500);
  });
});

describe('T-CSS-003 — colours and breakpoints come from :root only', () => {
  const rootBlock = /:root\s*\{([\s\S]*?)\}/.exec(cssWithoutComments)?.[1] ?? '';
  const outsideRoot = cssWithoutComments.replace(/:root\s*\{[\s\S]*?\}/, '');

  it('T-CSS-003a: :root declares every token in §13.2', () => {
    for (const token of [
      '--bp-sm',
      '--bp-lg',
      '--layout-max-width',
      '--tap-target-min',
      '--color-text',
      '--color-text-muted',
      '--color-bg',
      '--color-surface',
      '--color-border',
      '--color-accent',
      '--color-danger',
      '--space-1',
      '--space-2',
      '--space-3',
      '--space-4',
      '--space-5',
      '--space-6',
      '--radius',
      '--font-stack',
    ]) {
      expect(rootBlock).toContain(`${token}:`);
    }
  });

  it('T-CSS-003b: no hex literal appears outside :root', () => {
    // A token file is exactly where a "slightly nicer" grey gets substituted.
    const hexes = [...outsideRoot.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => match[0]);
    expect(hexes).toEqual([]);
  });

  it('T-CSS-003c: no rgb()/hsl() colour literal appears outside :root', () => {
    // Otherwise T-CSS-003b is trivially evaded by changing notation.
    expect(outsideRoot).not.toMatch(/\b(rgba?|hsla?)\s*\(/i);
  });

  it('T-CSS-003d: no !important outside the reduced-motion reset', () => {
    const withoutReducedMotion = cssWithoutComments.replace(
      /@media\s*\(prefers-reduced-motion[\s\S]*?\}\s*\}/,
      '',
    );
    expect(withoutReducedMotion).not.toContain('!important');
  });

  it('T-CSS-003e: nothing is styled by data-testid', () => {
    // Coupling the test contract to presentation makes a visual tidy-up break
    // tests for a reason that is invisible in the diff.
    expect(cssWithoutComments).not.toMatch(/\[data-testid/);
  });

  it('T-CSS-003f: no external @import and no web font', () => {
    // NFR-005 — a third-party request per page load, plus the layout shift.
    expect(cssWithoutComments).not.toMatch(/@import|@font-face|fonts\.googleapis/i);
  });
});

/* ------------------------------------------------------------------------ */
/* T-CSS-004 — WCAG ratios computed from the token values themselves.       */
/* ------------------------------------------------------------------------ */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function token(name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (match?.[1] === undefined) throw new Error(`Token ${name} is not a 6-digit hex in :root`);
  return match[1];
}

describe('T-CSS-004 — contrast is computed from the tokens, not eyeballed', () => {
  /**
   * ⚠ FOUR OF THE FIVE RATIOS IN THE FIRST DRAFT OF §13.2 WERE WRONG, in both
   * directions: a border asserted at "≥ 3:1" is 1.47:1, and a grey rejected as
   * "4.28:1, fails" actually passes at 4.83:1. Both were plausible enough to
   * survive review, which is why this is arithmetic and not prose.
   *
   * ⚠ axe-core CANNOT REPLACE THIS. It only evaluates the pairs a rendered
   * page happens to use, so a token that is momentarily unused — or used only
   * on a screen no test visits — is never checked at all.
   */
  const bg = () => token('--color-bg');
  const surface = () => token('--color-surface');

  const textPairs: readonly [string, string][] = [
    ['--color-text', 'surface'],
    ['--color-text', 'bg'],
    ['--color-text-muted', 'surface'],
    ['--color-text-muted', 'bg'],
    ['--color-accent', 'surface'],
    ['--color-accent', 'bg'],
    ['--color-danger', 'surface'],
    ['--color-danger', 'bg'],
  ];

  it('T-CSS-004a: every text token meets the 4.5:1 floor on both surfaces', () => {
    // Reported as a table rather than one assertion per pair so a failure
    // names every offending token at once, not just the first.
    const failures = textPairs
      .map(([fg, against]) => ({
        pair: `${fg} on ${against}`,
        value: ratio(token(fg), against === 'surface' ? surface() : bg()),
      }))
      .filter((row) => row.value < 4.5);
    expect(failures).toEqual([]);
  });

  it('T-CSS-004b: --color-border meets the 3:1 boundary floor on both surfaces', () => {
    // ⚠ NON-TEXT CONTRAST IS THE TRAP. A border can look entirely normal and
    // still be less than half the required ratio — #d1d5db is 1.47:1.
    const failures = (['surface', 'bg'] as const)
      .map((against) => ({
        pair: `--color-border on ${against}`,
        value: ratio(token('--color-border'), against === 'surface' ? surface() : bg()),
      }))
      .filter((row) => row.value < 3);
    expect(failures).toEqual([]);
  });

  it('T-CSS-004c: the values match the ratios §13.2 documents', () => {
    // Keeps the spec table honest: a token changed here without updating the
    // documented ratio is caught, rather than the two drifting apart.
    expect(ratio(token('--color-text'), surface())).toBeCloseTo(17.7, 0);
    expect(ratio(token('--color-text-muted'), surface())).toBeCloseTo(7.6, 0);
    expect(ratio(token('--color-border'), surface())).toBeCloseTo(3.3, 0);
    expect(ratio(token('--color-accent'), surface())).toBeCloseTo(6.7, 0);
    expect(ratio(token('--color-danger'), surface())).toBeCloseTo(6.5, 0);
  });

  it('T-CSS-004d: the contrast helper itself is correct', () => {
    // ⚠ A BROKEN HELPER PASSES EVERYTHING ABOVE. Black on white is exactly
    // 21:1 and identical colours are exactly 1:1 — if these two are wrong,
    // every assertion in this block is meaningless.
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(ratio('#777777', '#777777')).toBeCloseTo(1, 5);
    expect(ratio('#d1d5db', '#ffffff')).toBeCloseTo(1.47, 1);
  });
});

describe('the 320 px floor is written mobile-first', () => {
  it('T-CSS-001d: every media query is min-width, never max-width', () => {
    // §13.3 — desktop-first makes the narrow layout the case reached by
    // subtraction, which is the one nobody looks at and the one NFR-006
    // actually mandates.
    const queries = [...cssWithoutComments.matchAll(/@media[^{]+/g)].map((match) => match[0]);
    const widthQueries = queries.filter((query) => /width/.test(query));
    expect(widthQueries.length).toBeGreaterThan(0);
    expect(widthQueries.filter((query) => /max-width/.test(query))).toEqual([]);
  });

  it('T-CSS-005a: prefers-reduced-motion: reduce is honoured', () => {
    expect(cssWithoutComments).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });
});
