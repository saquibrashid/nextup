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
import ts from 'typescript';
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

function analyzeClassNames(inputs: readonly { fileName: string; text: string }[]) {
  const files = new Map(
    inputs.map(({ fileName, text }) => [
      fileName.replaceAll('\\', '/'),
      ts.createSourceFile(fileName.replaceAll('\\', '/'), text, ts.ScriptTarget.Latest, true),
    ]),
  );
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, jsx: ts.JsxEmit.Preserve };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (fileName) => files.get(fileName);
  const program = ts.createProgram([...files.keys()], options, host);
  const checker = program.getTypeChecker();
  const classes = new Set<string>();
  const offenders: string[] = program.getSyntacticDiagnostics().map((diagnostic) => {
    const position = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return `${diagnostic.file?.fileName ?? 'source'}:${(position?.line ?? 0) + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
  const maps = new Map<ts.Symbol, ts.VariableDeclaration>();
  const approvedReferences = new Set<ts.Identifier>();

  function visit(node: ts.Node, callback: (node: ts.Node) => void) {
    callback(node);
    ts.forEachChild(node, (child) => visit(child, callback));
  }

  function reject(node: ts.Node) {
    const file = node.getSourceFile();
    const { line, character } = file.getLineAndCharacterOfPosition(node.getStart());
    offenders.push(`${file.fileName}:${line + 1}:${character + 1}: ${node.getText()}`);
  }

  function harvest(value: string) {
    for (const name of value.split(/\s+/).filter(Boolean)) classes.add(name);
  }

  function literalMap(identifier: ts.Identifier): ts.StringLiteral[] | undefined {
    const symbol = checker.getSymbolAtLocation(identifier);
    const declaration = symbol?.valueDeclaration;
    if (
      !symbol ||
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      declaration.getSourceFile() !== identifier.getSourceFile() ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      !(declaration.parent.flags & ts.NodeFlags.Const) ||
      !declaration.initializer
    ) {
      return undefined;
    }
    const statement = declaration.parent.parent;
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      return undefined;
    }
    let initializer = declaration.initializer;
    while (
      ts.isParenthesizedExpression(initializer) ||
      ts.isSatisfiesExpression(initializer) ||
      (ts.isAsExpression(initializer) && initializer.type.getText() === 'const')
    ) {
      initializer = initializer.expression;
    }
    if (!ts.isObjectLiteralExpression(initializer)) return undefined;
    const values: ts.StringLiteral[] = [];
    const keys = new Set<string>();
    for (const property of initializer.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        !(
          ts.isIdentifier(property.name) ||
          ts.isStringLiteral(property.name) ||
          ts.isNumericLiteral(property.name)
        ) ||
        !ts.isStringLiteral(property.initializer) ||
        keys.has(property.name.text) ||
        property.name.text === '__proto__'
      ) {
        return undefined;
      }
      keys.add(property.name.text);
      values.push(property.initializer);
    }
    maps.set(symbol, declaration);
    approvedReferences.add(identifier);
    return values;
  }

  for (const file of files.values()) {
    visit(file, (node) => {
      if (!ts.isJsxAttribute(node) || node.name.getText() !== 'className') return;
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer)) {
        harvest(initializer.text);
        return;
      }
      const expression =
        initializer && ts.isJsxExpression(initializer) ? initializer.expression : undefined;
      if (expression && ts.isStringLiteral(expression)) {
        harvest(expression.text);
        return;
      }
      if (
        expression &&
        ts.isElementAccessExpression(expression) &&
        !expression.questionDotToken &&
        ts.isIdentifier(expression.expression) &&
        ts.isIdentifier(expression.argumentExpression)
      ) {
        const values = literalMap(expression.expression);
        if (values) {
          for (const value of values) harvest(value.text);
          return;
        }
      }
      reject(node);
    });
  }

  // A const binding does not freeze its object: disallow writes and escaping aliases.
  for (const file of files.values()) {
    visit(file, (node) => {
      if (!ts.isIdentifier(node)) return;
      const symbol = ts.isExportSpecifier(node.parent)
        ? checker.getExportSpecifierLocalTargetSymbol(node.parent)
        : ts.isShorthandPropertyAssignment(node.parent)
          ? checker.getShorthandAssignmentValueSymbol(node.parent)
          : checker.getSymbolAtLocation(node);
      const declaration = symbol && maps.get(symbol);
      if (declaration && node !== declaration.name && !approvedReferences.has(node)) reject(node);
    });
  }
  return { classes, offenders };
}

const sourceAnalysis = analyzeClassNames(
  sourceFiles.map((fileName) => ({ fileName, text: readFileSync(fileName, 'utf8') })),
);
const usedClasses = sourceAnalysis.classes;

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

  it('T-CSS-001c: className is literal or a local const literal-map lookup', () => {
    expect(sourceAnalysis.offenders).toEqual([]);
  });
});

describe('T-UI-032 — static class vocabulary analysis', () => {
  function analyze(text: string) {
    return analyzeClassNames([{ fileName: 'fixture.tsx', text }]);
  }

  it('T-UI-032a: harvests all literal attributes and only referenced map values', () => {
    const result = analyze(`
      const BUTTON_CLASS: Record<string, string> = {
        'primary': "btn btn--primary", secondary: 'btn btn--secondary',
      };
      const UNUSED_CLASS = { unused: 'not-rendered' };
      const copy = 'not-a-class';
      function Button(variant: string) {
        return <><button className = { BUTTON_CLASS[variant] } />
          <div className='single quoted' /><span className="double" />
          <i className={'expression-literal'} /></>;
      }
    `);
    expect(result.offenders).toEqual([]);
    expect([...result.classes].sort()).toEqual(
      [
        'btn',
        'btn--primary',
        'btn--secondary',
        'single',
        'quoted',
        'double',
        'expression-literal',
      ].sort(),
    );
  });

  it('T-UI-032b: ignores comments and string contents, not real JSX', () => {
    const result = analyze(`
      // <div className={runtime + 'fake'} />
      /* const FAKE_CLASS = { fake: 'comment-only' };
         <div className="comment-class" /> */
      const prose = '<div className="string-only" />';
      const element = <div className="real">
        {/* <span className={MISSING_CLASS[key]} /> */}
      </div>;
    `);
    expect(result.offenders).toEqual([]);
    expect([...result.classes]).toEqual(['real']);
  });

  it.each([
    ['interpolated template', '<div className={`btn ${variant}`} />'],
    ['plain template', '<div className={`btn`} />'],
    ['concatenation', '<div className={"btn " + variant} />'],
    ['conditional', '<div className={active ? "yes" : "no"} />'],
    ['missing map', '<div className={MISSING_CLASS[variant]} />'],
    ['dynamic map', 'const MAP = build(); <div className={MAP[key]} />'],
    ['let map', 'let MAP = { a: "btn" }; <div className={MAP[key]} />'],
    ['var map', 'var MAP = { a: "btn" }; <div className={MAP[key]} />'],
    ['spread', 'const MAP = { ...other, a: "btn" }; <div className={MAP[key]} />'],
    ['call value', 'const MAP = { a: build() }; <div className={MAP[key]} />'],
    ['computed value', 'const MAP = { a: "btn " + variant }; <div className={MAP[key]} />'],
    ['template value', 'const MAP = { a: `btn ${variant}` }; <div className={MAP[key]} />'],
    ['computed property', 'const MAP = { [key]: "btn" }; <div className={MAP[key]} />'],
    ['shorthand', 'const MAP = { value }; <div className={MAP[key]} />'],
    ['getter', 'const MAP = { get a() { return "btn"; } }; <div className={MAP[key]} />'],
    ['duplicate key', 'const MAP = { a: "old", a: "new" }; <div className={MAP[key]} />'],
    ['prototype setter', 'const MAP = { __proto__: "btn" }; <div className={MAP[key]} />'],
    ['imported map', 'import { MAP } from "./map"; <div className={MAP[key]} />'],
    ['exported map', 'export const MAP = { a: "btn" }; <div className={MAP[key]} />'],
    ['runtime key', 'const MAP = { a: "btn" }; <div className={MAP[getKey()]} />'],
    ['literal key', 'const MAP = { a: "btn" }; <div className={MAP["a"]} />'],
    ['property access', 'const MAP = { a: "btn" }; <div className={MAP.a} />'],
    ['optional lookup', 'const MAP = { a: "btn" }; <div className={MAP?.[key]} />'],
    ['boolean attribute', '<div className />'],
  ])('T-UI-032c: rejects %s', (_label, text) => {
    expect(analyze(text).offenders.length).toBeGreaterThan(0);
  });

  it.each([
    'MAP.a = "changed";',
    'MAP[key] += " changed";',
    'delete MAP.a;',
    'Object.assign(MAP, { a: "changed" });',
    'const alias = MAP; alias.a = "changed";',
    'const holder = { MAP }; holder.MAP.a = "changed";',
    'mutate(MAP);',
    'export { MAP };',
    'export { MAP as exported };',
  ])('T-UI-032d: rejects mutable or escaped const maps: %s', (mutation) => {
    const result = analyze(`
      const MAP = { a: "btn" };
      ${mutation}
      const element = <div className={MAP[key]} />;
    `);
    expect(result.offenders.length).toBeGreaterThan(0);
  });

  it('T-UI-032e: resolves lexical bindings rather than matching map names', () => {
    const result = analyze(`
      const MAP = { a: "btn" };
      const outer = <div className={MAP[key]} />;
      function Component(MAP: Record<string, string>, key: string) {
        return <div className={MAP[key]} />;
      }
    `);
    expect(result.offenders).toHaveLength(1);
    expect([...result.classes]).toEqual(['btn']);
  });

  it('T-UI-032f: accepts scoped maps with const assertions and satisfies', () => {
    const result = analyze(`
      function Component(key: string) {
        const variants = ({ a: 'local local--a', b: 'local local--b' } as const) satisfies Record<string, string>;
        return <div className={variants[key]} />;
      }
    `);
    expect(result.offenders).toEqual([]);
    expect([...result.classes].sort()).toEqual(['local', 'local--a', 'local--b']);
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
      '--bp-md',
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
  it('T-MOCK-004c: artwork text and priority boundaries retain contrast over a white poster', () => {
    function overWhite(name: string): string {
      const shade = new RegExp(
        `${name}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)`,
      ).exec(css);
      if (shade?.[4] === undefined) throw new Error(`Missing artwork token ${name}`);
      const alpha = Number(shade[4]);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThanOrEqual(1);
      return `#${shade
        .slice(1, 4)
        .map((value) =>
          Math.round(Number(value) * alpha + 255 * (1 - alpha))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')}`;
    }
    const background = overWhite('--color-artwork-shade');
    for (const foreground of [
      '--color-text',
      '--color-artwork-text-muted',
      '--color-secondary',
      '--color-rating',
    ]) {
      expect(ratio(token(foreground), background), foreground).toBeGreaterThanOrEqual(4.5);
    }
    const control = overWhite('--color-artwork-control');
    for (const foreground of [
      '--color-artwork-text-muted',
      '--color-accent',
      '--color-secondary',
      '--color-success',
    ]) {
      expect(ratio(token(foreground), control), foreground).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(token('--color-artwork-control-border'), control)).toBeGreaterThanOrEqual(3);
    expect(css).toMatch(/--color-text-muted:\s*var\(--color-artwork-text-muted\)/);
    expect(css).toMatch(/border:\s*1px solid var\(--color-artwork-control-border\)/);
    expect(css).toMatch(/\.genre-chips \.btn\s*\{\s*color:\s*var\(--color-secondary\)/);
    expect(css).toMatch(/var\(--color-artwork-shade\)\s+var\(--space-6\)/);
    expect(css).toMatch(/padding:\s*var\(--space-6\)\s+var\(--space-3\)\s+var\(--space-2\)/);
  });

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

  it('T-UX-155b library semantic text and control boundaries retain contrast on elevated surfaces', () => {
    for (const foreground of [
      '--color-text',
      '--color-text-muted',
      '--color-secondary',
      '--color-rating',
      '--color-success',
      '--color-accent',
    ]) {
      for (const background of [
        '--color-bg',
        '--color-surface',
        '--color-surface-raised',
        '--color-catalog',
        '--color-catalog-raised',
      ]) {
        expect(
          ratio(token(foreground), token(background)),
          `${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Controls use the base surface/background, not the lighter card endpoint.
    for (const background of [
      '--color-bg',
      '--color-surface',
      '--color-catalog',
      '--color-catalog-raised',
    ]) {
      expect(ratio(token('--color-border'), token(background))).toBeGreaterThanOrEqual(3);
    }
  });

  it('T-CSS-004c: the values match the ratios §13.2 documents', () => {
    // Keeps the spec table honest: a token changed here without updating the
    // documented ratio is caught, rather than the two drifting apart.
    expect(ratio(token('--color-text'), surface())).toBeCloseTo(14.97, 0);
    expect(ratio(token('--color-text-muted'), surface())).toBeCloseTo(8.54, 0);
    expect(ratio(token('--color-border'), surface())).toBeCloseTo(3.3, 0);
    // ⚠ 7.9, NOT 6.7. ADR-0013 replaced #1d4ed8 (6.70:1) with the owner's
    // deeper indigo #4338ca (7.90:1) in TASK-208. This literal is the whole
    // point of the assertion — DO NOT widen `toBeCloseTo`'s precision to make
    // both values pass, which would turn a computed-contrast gate into one
    // that accepts any accent within ±5.
    expect(ratio(token('--color-accent'), surface())).toBeCloseTo(7.57, 0);
    expect(ratio(token('--color-danger'), surface())).toBeCloseTo(8.47, 0);
  });

  it('T-CSS-004e: white text on the accent is legible, so one token serves link AND button', () => {
    // ⚠ THE PAIR THE `textPairs` SWEEP CANNOT SEE. It only checks accent-as-
    // FOREGROUND on the two surfaces; a filled primary button uses it as the
    // BACKGROUND, and that pair appears in no other assertion here. An accent
    // darkened for link contrast can pass everything above while white label
    // text on the button fails.
    expect(ratio(token('--color-accent'), surface())).toBeGreaterThanOrEqual(4.5);
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

/* ------------------------------------------------------------------------ */
/* T-CSS-006 / T-CSS-007 — the type scale (REQ-123, ui-refresh.md §7b).     */
/* ------------------------------------------------------------------------ */

const ROOT_BLOCK = /:root\s*\{([\s\S]*?)\n\}/.exec(cssWithoutComments)?.[1] ?? '';
const OUTSIDE_ROOT = cssWithoutComments.replace(/:root\s*\{[\s\S]*?\n\}/, '');

/** The rem value of a scale token, for ordering assertions. */
function remToken(name: string): number {
  const match = new RegExp(`${name}:\\s*([\\d.]+)rem`).exec(ROOT_BLOCK);
  if (match?.[1] === undefined) throw new Error(`Token ${name} is not a rem value in :root`);
  return Number(match[1]);
}

describe('T-CSS-006 — the scale is declared once, and nothing sizes text off it', () => {
  const SCALE = [
    '--text-xs',
    '--text-sm',
    '--text-base',
    '--text-lg',
    '--text-xl',
    '--text-2xl',
    '--leading-tight',
    '--leading-normal',
    '--weight-normal',
    '--weight-medium',
    '--weight-bold',
  ] as const;

  it('T-CSS-006a: :root declares every type token in §7b', () => {
    for (const name of SCALE) expect(ROOT_BLOCK).toContain(`${name}:`);
  });

  it('T-CSS-006b: no rule body contains a raw font-size literal', () => {
    // ⚠ THIS IS THE ASSERTION THAT MAKES THE SCALE REAL. Declaring the tokens
    // changes nothing on its own — the defect being fixed is that sixteen
    // literals in FIVE ad-hoc sizes were scattered through the rule bodies,
    // including a `0.85rem` that sat on no scale at all. A single survivor
    // re-establishes the second scale silently.
    const raw = [...OUTSIDE_ROOT.matchAll(/font-size:\s*([^;]+);/g)]
      .map((match) => (match[1] ?? '').trim())
      .filter((value) => !value.startsWith('var(--text-') && value !== 'inherit');
    expect(raw).toEqual([]);
  });

  it('T-CSS-006c: no rule body contains a raw font-weight or line-height literal', () => {
    // Same failure, different property. Weight tokens that nothing consumes
    // are decoration: §7b declares three, and eleven bare `600`s meant the
    // scale was declared and then ignored.
    const rawWeights = [...OUTSIDE_ROOT.matchAll(/font-weight:\s*([^;]+);/g)]
      .map((match) => (match[1] ?? '').trim())
      .filter((value) => !value.startsWith('var(--weight-') && value !== 'inherit');
    const rawLeading = [...OUTSIDE_ROOT.matchAll(/line-height:\s*([^;]+);/g)]
      .map((match) => (match[1] ?? '').trim())
      .filter((value) => !value.startsWith('var(--leading-') && value !== 'inherit');
    expect({ rawWeights, rawLeading }).toEqual({ rawWeights: [], rawLeading: [] });
  });

  it('T-CSS-006d: the scale ascends, and is expressed in rem so the user setting is honoured', () => {
    // ⚠ A `px` SCALE OVERRIDES AN ACCESSIBILITY PREFERENCE THE USER HAS
    // ALREADY EXPRESSED, and looks perfectly correct in every screenshot.
    const sizes = ['--text-xs', '--text-sm', '--text-base', '--text-lg', '--text-xl', '--text-2xl'];
    const values = sizes.map(remToken);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
    expect(remToken('--text-base')).toBeGreaterThanOrEqual(1);
  });
});

describe('T-CSS-007 — nothing shrinks content below the --text-sm floor', () => {
  /**
   * ⚠ `--text-xs` IS NOT A DENSITY CONTROL, and reaching for it to fit more
   * in is the failure mode this guards. REQ-112's density comes from layout
   * and from the compact genre presentation — never from making content
   * smaller. It always looks fine to the person who has just done it.
   *
   * The allow-list is CLOSED on purpose: `--text-xs` is for supplementary
   * labels that are not content. Adding a selector here is a deliberate,
   * reviewable act rather than a silent side effect of a density pass.
   */
  const XS_ALLOWED = [
    '.title-row__rating-source',
    '.tmdb-attribution',
    '.justwatch-attribution',
    // #380 — a condition of Watchmode's free plan, the same kind of label.
    '.watchmode-attribution',
  ] as const;

  /** Selector → the font-size it sets, for every rule in the sheet. */
  const rules = [...OUTSIDE_ROOT.matchAll(/([^{}]+)\{([^}]*)\}/g)].flatMap((match) => {
    const size = /font-size:\s*([^;]+);/.exec(match[2] ?? '')?.[1]?.trim();
    return size === undefined ? [] : [{ selector: (match[1] ?? '').trim(), size }];
  });

  it('T-CSS-007a: only the declared supplementary labels use --text-xs', () => {
    const offenders = rules
      .filter((rule) => rule.size === 'var(--text-xs)')
      .map((rule) => rule.selector)
      .filter((selector) => !XS_ALLOWED.includes(selector as (typeof XS_ALLOWED)[number]));
    expect(offenders).toEqual([]);
  });

  it('T-CSS-007b: genre chips sit at --text-sm, which §7b names explicitly', () => {
    // ⚠ BOTH CHIP RULES WERE AT `--text-xs` BEFORE TASK-208 — the precise
    // "shrink it to win density" case, already present in the sheet. §7b
    // lists genre chips under `--text-sm`, so this is spec text, not taste.
    for (const selector of ['.title-row__chip', '.candidate-card__chip']) {
      const rule = rules.find((entry) => entry.selector === selector);
      expect({ selector, size: rule?.size }).toEqual({ selector, size: 'var(--text-sm)' });
    }
  });

  it('T-CSS-007c: the floor is a real floor — --text-sm is at least 0.875rem', () => {
    // Without this the allow-list is evadable by redefining the token itself:
    // every selector would still name `--text-sm` while rendering at 10px.
    expect(remToken('--text-sm')).toBeGreaterThanOrEqual(0.875);
    expect(remToken('--text-xs')).toBeGreaterThanOrEqual(0.75);
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

// ── §5.3a — the crop wrapper actually clips ────────────────────────────────
//
// ⚠ WITHOUT THIS ASSERTION THE CROP IS UNTESTABLE FROM THE DOM. jsdom applies
// no stylesheet, so a component test can prove the wrapper element and the
// scaled `<img>` exist while `overflow: hidden` is absent and the "cropped
// thumbnail" is in fact a hugely magnified screenshot spilling out of the
// card. The rule is read from the FILE for the same reason the rest of this
// suite is: it is the only place the clip is real.
describe('T-AI-041 - the cropped tile thumbnail clips, and is legible', () => {
  const rule =
    cssWithoutComments.match(/\.candidate-card__thumb--cropped\s*\{([^}]*)\}/)?.[1] ?? '';

  it('T-AI-041s: the crop wrapper hides its overflow - this is what makes it a crop', () => {
    expect(rule).toMatch(/overflow:\s*hidden/);
    // A clipped child can only be positioned against a positioned ancestor.
    expect(rule).toMatch(/position:\s*relative/);
  });

  it('T-AI-041t: the crop is at least 96px on the short edge, per specs/ui.md 5.3a', () => {
    const px = (prop: string) => Number(rule.match(new RegExp(`${prop}:\\s*(\\d+)px`))?.[1] ?? '0');
    // Both edges, because `min-width` alone leaves the height free to collapse
    // to whatever the row happens to be - and then the SHORT edge is not 96px.
    expect(Math.min(px('width'), px('height'))).toBeGreaterThanOrEqual(96);
  });

  it('T-AI-041u: the image inside the crop is absolutely positioned and unconstrained', () => {
    const inner =
      cssWithoutComments.match(/\.candidate-card__thumb--cropped img\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(inner).toMatch(/position:\s*absolute/);
    // A global `max-width: 100%` reset would silently defeat the magnification.
    expect(inner).toMatch(/max-width:\s*none/);
  });
});

/* T-UX-168e — the stylesheet half of the owner's mockup dropdowns. */
describe('T-UX-168e · filter pills, panels, ticks, card marks and the sidebar surface', () => {
  function rule(selector: string): string {
    const at = cssWithoutComments.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return /\{([^}]*)\}/.exec(cssWithoutComments.slice(at))?.[1] ?? '';
  }

  it('T-UX-168e: every pinned declaration is present', () => {
    const pill = rule('.filter-bar[data-inline] .filter-disclosure > .btn');
    expect(pill).toMatch(/background:\s*var\(--color-catalog-raised\)/);
    expect(pill).toMatch(/border-color:\s*var\(--color-border-soft\)/);
    expect(rule('.filter-bar[data-inline] .filter-disclosure > .btn[data-active]')).toMatch(
      /border-color:\s*var\(--color-accent\)/,
    );
    expect(rule('.filter-disclosure__panel fieldset.field:has(.input--choice)')).toMatch(
      /display:\s*grid/,
    );
    expect(rule('.filter-disclosure__panel .field label:has(.input--choice)')).toMatch(
      /display:\s*flex/,
    );
    expect(rule('.range-slider__tick')).toMatch(/--tick/);
    const badge = rule("  .title-list[data-view='grid'] .title-row__badges .badge");
    expect(badge).toMatch(/padding:\s*var\(--space-1\) var\(--space-2\)/);
    const frame = cssWithoutComments.slice(
      cssWithoutComments.lastIndexOf('grid-template-columns: 12rem minmax(0, 1fr)'),
    );
    const shell = /^[^}]*/.exec(frame)?.[0];
    expect(shell).toMatch(/background:\s*var\(--color-surface\)/);
  });
});

/* T-UX-169c — the page never jolts sideways when a short skeleton replaces the list. */
describe('T-UX-169c · the root reserves the scrollbar gutter', () => {
  it('T-UX-169c: `html` declares `scrollbar-gutter: stable`', () => {
    const root = /(?:^|\n)html\s*\{([^}]*)\}/.exec(cssWithoutComments)?.[1] ?? '';
    expect(root).toMatch(/scrollbar-gutter:\s*stable/);
  });
});
