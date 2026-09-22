/**
 * TASK-212 — the list surface, hybrid list and grid (`specs/ui-refresh.md`
 * §4.1/§4.2, REQ-110/REQ-111).
 *
 * Tests: `T-UX-110`, `T-UX-111`, `T-UX-112`.
 *
 * ⚠ **THESE READ `index.css` AS A FILE, AND THEY HAVE TO.** The whole subject
 * of this task is a layout that exists only in the stylesheet: §4.1 requires
 * the grid and the list to be ONE component at two densities, selected by a
 * media query, so there is deliberately no JS branch and therefore no DOM
 * difference for a jsdom query to see. jsdom applies no stylesheet and
 * computes no layout, so `getBoundingClientRect()` returns zeroes, `matchMedia`
 * changes nothing about what renders, and an overflow check passes *perfectly*
 * on an unstyled document — the exact trap `specs/ui.md` §13's own header
 * records, and the reason the project once shipped with no CSS at all behind a
 * green suite including a 320 px no-horizontal-scroll pass.
 *
 * The visual half is `T-A11Y-001a`/`T-A11Y-001c` in `tests/e2e/a11y.spec.ts`,
 * which drive a real browser at 320 px. These assertions are the half that can
 * fail *before* a browser is involved, and they fail on the file rather than on
 * the render.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { TitleList } from '../src/components/TitleList';
import { RowMenu } from '../src/components/RowMenu';
import type { TitleListItem } from '../src/components/TitleRow';

// ⚠ NOT `fileURLToPath(import.meta.url)` — the `web` project runs in jsdom,
// where `import.meta.url` is an http URL and that call THROWS at import time,
// failing the whole file in a way that reads as a broken test rather than as a
// failed assertion. Copied deliberately from `stylesheet.spec.ts`.
const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const CSS = readFileSync(join(WEB_ROOT, 'src', 'index.css'), 'utf8');

/** Strips comments, so a selector named in prose is never read as a rule. */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * All `@media` blocks with the exact condition, in source order.
 *
 * ⚠ **Brace-counted, not regex-matched.** A media block contains nested rules,
 * so the `[^}]*` shape used for a flat rule stops at the FIRST inner `}` and
 * silently returns only the first declaration — which would make every
 * "…is inside the grid query" assertion below pass while reading almost none
 * of the block.
 */
function mediaBlock(condition: string): string {
  const head = `@media ${condition} {`;
  let start = CSS_CODE.indexOf(head);
  expect(start, `no \`@media ${condition}\` block in index.css`).toBeGreaterThanOrEqual(0);
  const blocks: string[] = [];
  while (start !== -1) {
    let depth = 1;
    let end = start + head.length;
    for (; end < CSS_CODE.length && depth > 0; end += 1) {
      if (CSS_CODE[end] === '{') depth += 1;
      else if (CSS_CODE[end] === '}') depth -= 1;
    }
    if (depth !== 0) throw new Error(`unbalanced braces in \`@media ${condition}\``);
    blocks.push(CSS_CODE.slice(start + head.length, end - 1));
    start = CSS_CODE.indexOf(head, end);
  }
  return blocks.join('\n');
}

/** The declarations of a rule, searched in `scope` (default: the whole file). */
function ruleBody(selector: string, scope: string = CSS_CODE): string | undefined {
  // ⚠ `selector` ARRIVES ALREADY REGEX-ESCAPED, and must not be escaped again
  // here — a second pass turns `\.` into `\\.`, which matches a literal
  // backslash and therefore nothing. That failure reads as "the rule is
  // missing", which is indistinguishable from the defect these tests look for.
  // The `(?:^|[},])` prefix stops `.title-list` from also matching
  // `.title-list--loading`'s neighbour in a selector list.
  const pattern = new RegExp(`(?:^|[},])\\s*${selector}\\s*\\{([^}]*)\\}`);
  return pattern.exec(scope)?.[1];
}

/** Everything in `CSS_CODE` that is NOT inside an `@media` block. */
const BASE_CSS = (() => {
  let out = '';
  let i = 0;
  while (i < CSS_CODE.length) {
    const at = CSS_CODE.indexOf('@media', i);
    if (at === -1) {
      out += CSS_CODE.slice(i);
      break;
    }
    out += CSS_CODE.slice(i, at);
    let depth = 0;
    let j = CSS_CODE.indexOf('{', at);
    for (; j < CSS_CODE.length; j += 1) {
      if (CSS_CODE[j] === '{') depth += 1;
      else if (CSS_CODE[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    i = j + 1;
  }
  return out;
})();

const GRID_QUERY = '(min-width: 1024px)';

const DUNE: TitleListItem = {
  titleId: '01J8ZC',
  workIdentity: 'tmdb:movie:438631',
  matchState: 'matched',
  name: 'Dune',
  mediaType: 'movie',
  releaseYear: 2021,
  genres: ['Science Fiction', 'Adventure'],
  runtimeMinutes: 155,
  posterPath: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
  badges: [{ service: 'netflix', listingId: '01J8ZD', dateAdded: '2026-04-02' }],
  sortDateAdded: '2026-04-02',
  dateAddedLabel: 'Added to nextup 2 Apr 2026',
};

/* ------------------------------------------------------------------------ */
/* T-UX-110 — the 320 px floor, and the list layout is the BASE rule.       */
/* ------------------------------------------------------------------------ */

describe('T-UX-110 · ui-refresh.md §4.1 · at 320 px the list layout renders, without sideways scroll', () => {
  it('T-UX-110a: the base .title-list is a vertical list, not a grid', () => {
    const base = ruleBody('\\.title-list', BASE_CSS);

    expect(base).toBeDefined();
    expect(base).toMatch(/display:\s*flex/);
    expect(base).toMatch(/flex-direction:\s*column/);
    // The failure this forbids is the whole of §4.1's mobile-first warning: a
    // grid base with a `max-width` override for phones renders the 320 px case
    // by subtraction, so the narrowest viewport — the one NFR-006 requires —
    // is the least-considered one.
    expect(base).not.toMatch(/display:\s*grid/);
  });

  it('T-UX-110b: the grid exists ONLY inside a min-width query, so it cannot reach 320 px', () => {
    const widthQueries = [...CSS_CODE.matchAll(/@media\s*\(([^)]*width[^)]*)\)\s*\{/g)].map(
      (m) => m[1] ?? '',
    );

    // Every WIDTH query in the sheet is a `min-width`. A single `max-width`
    // would mean some rule somewhere is written desktop-first, and this is the
    // cheapest place to notice it. Feature queries such as
    // `prefers-reduced-motion` are deliberately outside the filter — they say
    // nothing about layout direction.
    expect(widthQueries.length).toBeGreaterThan(0);
    expect(widthQueries.filter((q) => /max-width/.test(q))).toStrictEqual([]);
    expect(ruleBody('\\.title-list', mediaBlock(GRID_QUERY))).toMatch(/display:\s*grid/);
  });

  it('T-UX-110c: no list rule pins a width that cannot fit inside 320 px', () => {
    // 320 px minus `.app-shell`'s mobile padding on both sides. A rule wider
    // than this is a guaranteed horizontal scrollbar at the floor — which is
    // precisely what `T-A11Y-001a` catches in a browser and what nothing can
    // catch in jsdom.
    const offenders: string[] = [];
    for (const match of BASE_CSS.matchAll(/(\.(?:title-list|title-row)[^{]*)\{([^}]*)\}/g)) {
      const selector = (match[1] ?? '').trim();
      const body = match[2] ?? '';
      for (const decl of body.matchAll(/(?:^|;)\s*(min-width|width)\s*:\s*([\d.]+)px/g)) {
        if (Number(decl[2]) > 288) offenders.push(`${selector}: ${decl[1]}: ${decl[2]}px`);
      }
    }

    expect(offenders).toStrictEqual([]);
  });

  it('T-UX-110d: .title-row__body keeps `min-width: 0`, the one rule that lets a long name wrap', () => {
    // Without it a flex child refuses to shrink below its content's intrinsic
    // width, so a single long title forces the whole page sideways at 320 px.
    // It is one declaration, it looks like noise, and deleting it is invisible
    // at every width except the one that is tested least.
    expect(ruleBody('\\.title-row__body', BASE_CSS)).toMatch(/min-width:\s*0/);
  });

  it('T-UX-110e: the list still renders its rows when the viewport reports 320 px', () => {
    // The render half. It cannot prove the absence of overflow (jsdom computes
    // no layout), and it is here only to prove the list is not JS-branched on
    // width — §4.1 forbids that outright.
    render(
      <MemoryRouter>
        <TitleList items={[DUNE]} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId(`title-row-${DUNE.titleId}`)).toBeInTheDocument();
    expect(screen.getByTestId('title-name')).toHaveTextContent('Dune');
  });
});

/* ------------------------------------------------------------------------ */
/* T-UX-111 — the grid, and the uniform poster box (REQ-111).              */
/* ------------------------------------------------------------------------ */

describe('T-UX-111 · ui-refresh.md §4.1/§4.2 · at 1280 px the grid layout renders', () => {
  it('T-UX-111a: 1280 px is above the grid breakpoint, so the grid query applies there', () => {
    // Stated as an assertion rather than left implicit: `T-UX-111`'s wording
    // names 1280 px, the rule names `--bp-lg`, and the two are only the same
    // claim while `--bp-lg` is at or below 1280.
    const token = /--bp-lg:\s*(\d+)px/.exec(CSS_CODE)?.[1];

    expect(token).toBe('1024');
    expect(Number(token)).toBeLessThanOrEqual(1280);
    expect(GRID_QUERY).toContain(String(token));
  });

  it('T-UX-111b: the grid is a real multi-column track list, not a one-column fallback', () => {
    const grid = ruleBody('\\.title-list', mediaBlock(GRID_QUERY));

    expect(grid).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  });

  it('T-UX-111c: Cover browser stacks bounded portrait artwork above details', () => {
    const block = mediaBlock('(min-width: 640px)');
    const gridSelector = "\\.title-list\\[data-view='grid'\\]";
    expect(ruleBody(`${gridSelector} \\.title-row`, block)).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(ruleBody(`${gridSelector} \\.title-row__poster`, block)).toMatch(/width:\s*100%/);
    expect(ruleBody(`${gridSelector} \\.title-row__poster`, BASE_CSS)).toMatch(/height:\s*auto/);
  });

  it('T-UX-111d: REQ-111 — the poster box is a uniform 2:3 declared on the BASE rule', () => {
    const base = ruleBody('\\.title-row__poster', BASE_CSS);

    expect(base).toMatch(/aspect-ratio:\s*2\s*\/\s*3/);
    // On the base, not on the grid override, because the grid sets `height:
    // auto` — so in the grid layout the ratio is the ONLY thing giving
    // `.title-row__poster--empty` (a bare <div>, no intrinsic size) a height at
    // all. A missing poster is a rendered state; losing its box in one layout
    // is the row-jumping defect that rule exists to prevent.
    expect(ruleBody('\\.title-row__poster', mediaBlock(GRID_QUERY))).not.toMatch(/aspect-ratio/);
  });

  it('T-UX-111e: REQ-111 — no poster is smaller than 72 × 108 px in the list layout', () => {
    const base = ruleBody('\\.title-row__poster', BASE_CSS) ?? '';
    const rem = (decl: string): number =>
      Number(new RegExp(`${decl}:\\s*([\\d.]+)rem`).exec(base)?.[1] ?? 0) * 16;

    expect(rem('width')).toBeGreaterThanOrEqual(72);
    expect(rem('height')).toBeGreaterThanOrEqual(108);

    // ⚠ AND NO WIDER RULE MAY SHRINK IT AGAIN. `@media (min-width: 640px)`
    // used to set 64 × 96 — an increase over the OLD 48 × 72 base and a
    // decrease against this one. Left in place it would drop the list back
    // under the floor at the width with the most room to spare, and every
    // assertion above would still pass.
    for (const [, condition] of CSS_CODE.matchAll(/@media\s*(\([^)]*\))\s*\{/g)) {
      const override = ruleBody('\\.title-row__poster', mediaBlock(condition ?? ''));
      if (override === undefined) continue;
      for (const [, prop, value] of override.matchAll(/(width|height):\s*([\d.]+)rem/g)) {
        const px = Number(value) * 16;
        expect(px, `${condition} shrinks ${prop} to ${px}px`).toBeGreaterThanOrEqual(
          prop === 'width' ? 72 : 108,
        );
      }
    }
  });
});

/* ------------------------------------------------------------------------ */
/* T-UX-112 — the SAME actions in both layouts. The load-bearing case.     */
/* ------------------------------------------------------------------------ */

describe('T-UX-112 · ui-refresh.md §4.1 · the ⋮ menu offers the same item set in both layouts', () => {
  const ITEMS = ['Not interested', 'Fix match', 'Remove from list', 'Cancel'];

  async function openMenuItems(): Promise<string[]> {
    render(
      <MemoryRouter>
        <RowMenu
          item={DUNE}
          canRemove
          onChoose={() => {
            /* not the subject */
          }}
          onDismiss={() => {
            /* not the subject */
          }}
        />
      </MemoryRouter>,
    );
    const menu = await screen.findByRole('menu');
    return within(menu)
      .getAllByRole('menuitem')
      .map((node) => node.textContent ?? '');
  }

  it('T-UX-112a: the menu renders one known, complete item set', async () => {
    // The baseline the rest of this block is a claim ABOUT. Asserted as an
    // exact set, not a superset: a grid that quietly drops "Not interested" or
    // "Remove" makes an action unreachable at one width only, and a
    // `toContain` check would not notice.
    expect(await openMenuItems()).toStrictEqual(ITEMS);
  });

  it('T-UX-112b: there is exactly ONE list DOM — the layouts cannot diverge in JS', async () => {
    // ⚠ THIS IS THE ACTUAL MECHANISM, AND IT IS WHY THE REST OF THIS BLOCK IS
    // A STYLESHEET TEST. §4.1 requires one component at two densities selected
    // by a media query. With no JS width branch anywhere in the list tree,
    // "the same item set in both layouts" is not a claim about two code paths
    // staying in step — it is a fact about one. A future `useWideViewport()` in
    // here would silently turn this test's subject into something it no longer
    // covers, so the absence is asserted rather than assumed.
    const listSources = ['TitleList.tsx', 'TitleRow.tsx', 'RowMenu.tsx'].map((name) =>
      readFileSync(join(WEB_ROOT, 'src', 'components', name), 'utf8'),
    );

    for (const source of listSources) {
      expect(source).not.toMatch(/useWideViewport|matchMedia|innerWidth|clientWidth/);
    }
    expect(await openMenuItems()).toStrictEqual(ITEMS);
  });

  it('T-UX-112c: the grid query hides nothing belonging to the row or its menu', () => {
    // Given one DOM, the ONLY remaining way to make an action unreachable at
    // one width is to hide it from the stylesheet — and that failure is
    // invisible to every render-based test in the suite, because the element
    // is still in the document and still has its accessible name.
    const block = mediaBlock(GRID_QUERY);
    const offenders: string[] = [];

    for (const [, selector, body] of block.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/\.(?:row-menu|title-row|title-list)/.test(selector ?? '')) continue;
      if (
        /display:\s*none/.test(body ?? '') ||
        /visibility:\s*hidden/.test(body ?? '') ||
        /content-visibility:\s*hidden/.test(body ?? '')
      ) {
        offenders.push((selector ?? '').trim());
      }
    }

    expect(offenders).toStrictEqual([]);
  });

  it('T-UX-112d: the open menu stays anchored to its row in BOTH layouts', () => {
    // `.row-menu` is `position: absolute`, which resolves against the nearest
    // positioned ancestor — `.title-row__actions`. The grid block restyles
    // that box, so this asserts it restyles it WITHOUT dropping the
    // `position: relative` that makes the anchoring work. Losing it does not
    // remove the menu; it floats it over the page, which is a visual-only
    // failure no DOM query sees (see `T-UX-100`).
    expect(ruleBody('\\.title-row__actions', BASE_CSS)).toMatch(/position:\s*relative/);
    expect(ruleBody('\\.title-row__actions', mediaBlock(GRID_QUERY))).not.toMatch(/position:/);
  });

  it('T-UX-112e: the ⋮ trigger itself is never hidden or disabled by the grid', async () => {
    // The menu is reachable only through the trigger, so a grid that hid the
    // trigger would make every item above unreachable while `T-UX-112a` still
    // passed. Asserted on both halves: the stylesheet, and that the trigger is
    // an enabled control in the one DOM both layouts share.
    render(
      <MemoryRouter>
        <TitleList
          items={[DUNE]}
          onOpenMenu={() => {
            /* not the subject */
          }}
        />
      </MemoryRouter>,
    );

    const trigger = screen.getByTestId('row-menu');
    expect(trigger).toBeEnabled();
    await userEvent.click(trigger);

    expect(ruleBody('\\.title-row__menu', mediaBlock(GRID_QUERY))).toBeUndefined();
  });
});
