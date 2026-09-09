/**
 * Author `tests/fixtures/golden/expected/*.expected.json` — the ANSWER KEY for
 * the §9.2 offline metric suite (TASK-078).
 *
 * ⚠ THE TITLES IN THIS FILE WERE READ OFF THE IMAGES BY A HUMAN-DRIVEN PASS,
 * NOT TAKEN FROM ANY MODEL'S OUTPUT. That is the whole point of an answer key.
 * A key derived from the incumbent reader's response grades that reader against
 * itself — it scores 1.0 by construction, hides every miss, and makes §9.7's
 * bake-off between two readers a comparison of two different answer keys rather
 * than of two readers. If you are tempted to regenerate this from
 * `llm/gpt-4.1/*.llm.json`, don't: open the image instead.
 *
 * ⚠ FOUR OF THE ELEVEN HAVE A STRONGER PROVENANCE THAN "someone looked".
 * `blank-no-content-01` and `truncated-titles-01` are SYNTHETIC — their exact
 * strings are literals in `tests/fixtures/golden/images/generate.mjs`, so their
 * ground truth is the generator's source, not an observation. `low-quality-jpeg-01`
 * and `rotated-01` are DERIVED from `netflix-mylist-mobile-01` and
 * `max-saved-mobile-01`, so their expected titles are, by construction, their
 * source's expected titles. That is what makes degradation measurable at all:
 * a degraded fixture whose clean counterpart is absent yields a number with
 * nothing to compare it against.
 *
 *   node tools/golden-expected.mjs           # write the files
 *   node tools/golden-expected.mjs --check   # fail if the committed files differ
 *
 * ⚠ THIS IS PROVENANCE, NOT A TEST DEPENDENCY — same rule as the two
 * `generate.mjs` scripts. The emitted files are COMMITTED and the suite reads
 * the committed files. Nothing runs this at test time: a key generated during
 * the run can drift with its generator and still agree with it, which is
 * agreement, not evidence.
 *
 * `expectedWorkIdentity` is filled in by `tools/golden-tmdb.mjs`, which is a
 * separate step on purpose — resolving an identity needs the network, and
 * reading a title off a screenshot must not.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GOLDEN = path.join(ROOT, 'tests', 'fixtures', 'golden');
const OUT = path.join(GOLDEN, 'expected');

const { normaliseTitleText } = await import(
  pathToFileURL(path.join(ROOT, 'packages', 'domain', 'dist', 'identity.js')).href
);

/* ------------------------------------------------------------------ *
 * The Netflix "My List" set, as it stands across the four captures.
 *
 * ⚠ THE OVERLAP IS DELIBERATE AND MUST NOT BE "TIDIED" — `manifest.json`
 * documents it. mobile-01 and mobile-02 are two scroll positions of the SAME
 * list, and the desktop capture is the same list again at a different
 * viewport. That is what lets §7.4's intra-batch overlap collapse be measured
 * on real data rather than on a constructed duplicate.
 * ------------------------------------------------------------------ */
const LADIES_FIRST = 'Ladies First';
const RAW = 'Raw';
const WICKED = 'Wicked: For Good';
const HIS_AND_HERS = 'His & Hers';
const MAN_ON_FIRE = 'Man on Fire';
const STRANGER_VHS = 'Stranger Things: VHS Special Edition';
const DANTE = 'In the Hand of Dante';
const LOUIS_CK = 'Louis C.K.: Ridiculous';
const FRANKENSTEIN = 'Frankenstein';
const DDLJ = 'Dilwale Dulhania Le Jayenge';

/** The Max "My Stuff → My List" set, identical across both captures. */
const MAX_MY_LIST = [
  'Lanterns',
  'Normal',
  'The Drama',
  'Ramy Youssef: In Love',
  'Greenland 2: Migration',
  'True Detective',
];

const NETFLIX_DESKTOP_CHROME = [
  'Netflix',
  'Home',
  'Shows',
  'Movies',
  'Games',
  'New & Popular',
  'My List',
  'Browse by Languages',
];

const NETFLIX_MOBILE_CHROME = [
  'My List',
  'TV Shows & Movies',
  'Games',
  'Home',
  'Clips',
  'Search',
  'My Netflix',
];

const MAX_CHROME = [
  'My Stuff',
  'My List',
  'Continue Watching',
  'My Purchases',
  'Recommended For You',
];

/**
 * ⚠ `basis` HERE IS THE IDEAL, NOT A PREDICTION. It records how the work is
 * *knowable* from the tile, which is what §9.4's artwork recall is measured
 * against — not how any particular reader happened to arrive at it.
 *
 * `netflix-artwork-only-01` is the one image where that distinction bites: it
 * has no captions under the tiles, so every title is legible only from the
 * artwork's own title treatment. Under Revision 2 the reader is expected to
 * READ it (§9.4), which is why its titles are `artwork` and its `minRecall`
 * is the §9.2 artwork floor rather than the caption floor.
 */
const IMAGES = [
  {
    id: 'netflix-mylist-mobile-01',
    titles: [LADIES_FIRST, RAW, WICKED, HIS_AND_HERS, MAN_ON_FIRE, STRANGER_VHS, DANTE, LOUIS_CK],
    basis: 'text',
    chrome: [
      ...NETFLIX_MOBILE_CHROME,
      'TV Shows',
      'Movies',
      "Haven't Started",
      'Started',
      'Sort By',
      'Top Matches',
    ],
    // ⚠ 7 of 8, not 8 of 8. The phone's floating nav bar OCCLUDES the last
    // tile's caption, so a reader that returns 7 here has not failed — it has
    // correctly declined to invent the row it cannot see. The floor stays
    // below 1.0 for exactly that tile and no other.
    minRecall: 0.85,
    maxFalseTitles: 1,
    maxFabricated: 0,
  },
  {
    id: 'netflix-mylist-mobile-02',
    titles: [WICKED, HIS_AND_HERS, MAN_ON_FIRE, STRANGER_VHS, DANTE, LOUIS_CK, FRANKENSTEIN, DDLJ],
    basis: 'text',
    chrome: NETFLIX_MOBILE_CHROME,
    minRecall: 1.0,
    maxFalseTitles: 1,
    maxFabricated: 0,
  },
  {
    id: 'netflix-mylist-desktop-01',
    titles: [
      LADIES_FIRST,
      RAW,
      WICKED,
      HIS_AND_HERS,
      MAN_ON_FIRE,
      STRANGER_VHS,
      DANTE,
      LOUIS_CK,
      FRANKENSTEIN,
      DDLJ,
    ],
    basis: 'text',
    chrome: NETFLIX_DESKTOP_CHROME,
    minRecall: 1.0,
    maxFalseTitles: 1,
    maxFabricated: 0,
  },
  {
    id: 'netflix-continue-watching-01',
    titles: [DANTE],
    basis: 'text',
    // ⚠ The heading names the PROFILE ("Continue Watching for Let's Go!").
    // A reader that emits it as a title has produced a false title, not a
    // profile name — which is why it is listed as chrome rather than ignored.
    chrome: ["Continue Watching for Let's Go!"],
    minRecall: 1.0,
    maxFalseTitles: 1,
    maxFabricated: 0,
  },
  {
    id: 'max-saved-mobile-01',
    titles: MAX_MY_LIST,
    basis: 'text',
    chrome: MAX_CHROME,
    minRecall: 1.0,
    // ⚠ 2, not 1. A "Recommended For You" carousel is partly visible at the
    // bottom edge and its tiles are NOT saved content. Reading them is a
    // recall-neutral mistake this fixture deliberately leaves room for,
    // because clipping the image to hide it would remove the only real
    // example of the mistake from the corpus.
    maxFalseTitles: 2,
    maxFabricated: 0,
  },
  {
    id: 'max-saved-desktop-01',
    titles: MAX_MY_LIST,
    basis: 'text',
    chrome: MAX_CHROME,
    minRecall: 1.0,
    maxFalseTitles: 2,
    maxFabricated: 0,
  },
  {
    id: 'netflix-artwork-only-01',
    titles: [
      "Stranger Things: Tales From '85",
      RAW,
      'The Whisper Man',
      'Hamnet',
      LADIES_FIRST,
      HIS_AND_HERS,
      MAN_ON_FIRE,
      LOUIS_CK,
      FRANKENSTEIN,
      'Sol Levante',
    ],
    basis: 'artwork',
    chrome: NETFLIX_DESKTOP_CHROME,
    minRecall: 0.8,
    maxFalseTitles: 2,
    maxFabricated: 0,
  },
  {
    id: 'blank-no-content-01',
    titles: [],
    basis: 'text',
    // Verbatim from `images/generate.mjs`. ⚠ "Genuinely contentless" means
    // ZERO TITLES, not zero pixels — the empty-state sentences are chrome and
    // a reader that turns one into a title has fabricated.
    chrome: [
      'My List',
      'Search',
      "You haven't added anything yet.",
      'Titles you add to your list will appear here.',
      'Home',
      'New & Hot',
    ],
    // ⚠ Recall over an EMPTY expected set is 1.0 by definition (0/0), so this
    // image cannot fail on recall and is not what it is here to test. It
    // tests fabrication: `maxFabricated: 0` over a page with no titles at all.
    minRecall: 1.0,
    maxFalseTitles: 0,
    maxFabricated: 0,
  },
  {
    id: 'truncated-titles-01',
    // ⚠ THE EXPECTED TITLE IS THE DE-TRUNCATED WORK, NOT THE ELLIPSISED
    // CAPTION. `normalisedText` is `inferredTitle ?? rawText`, and R2.3b is
    // the requirement that the reader completes the caption. Keying the
    // answer on the visible glyphs would assert the opposite of T-AI-043.
    titles: [
      'The Lord of the Rings: The Fellowship of the Ring',
      'Everything Everywhere All at Once',
      'Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb',
      "The Hitchhiker's Guide to the Galaxy",
    ],
    basis: 'both',
    chrome: ['My List'],
    minRecall: 0.75,
    maxFalseTitles: 1,
    maxFabricated: 0,
  },
  {
    id: 'low-quality-jpeg-01',
    titles: [LADIES_FIRST, RAW, WICKED, HIS_AND_HERS, MAN_ON_FIRE, STRANGER_VHS, DANTE, LOUIS_CK],
    basis: 'text',
    chrome: [
      ...NETFLIX_MOBILE_CHROME,
      'TV Shows',
      'Movies',
      "Haven't Started",
      'Started',
      'Sort By',
      'Top Matches',
    ],
    // Derived from `netflix-mylist-mobile-01` at width 640, quality 18. It
    // inherits that image's occluded last tile AND adds compression damage,
    // so its floor is the source's floor and no lower — a degradation fixture
    // whose gate is relaxed to whatever the incumbent scores measures nothing.
    minRecall: 0.85,
    maxFalseTitles: 1,
    maxFabricated: 0,
  },
  {
    id: 'rotated-01',
    titles: MAX_MY_LIST,
    basis: 'text',
    chrome: MAX_CHROME,
    // Derived from `max-saved-mobile-01` by a 90° rotation with NO EXIF
    // orientation tag (sharp rasterises the rotation), so the reader sees a
    // genuinely sideways page and cannot be rescued by metadata.
    minRecall: 1.0,
    maxFalseTitles: 2,
    maxFabricated: 0,
  },
];

/**
 * Identities that `tools/golden-tmdb.mjs` deliberately refuses to decide,
 * recorded here with the reasoning rather than left to a similarity score.
 *
 * ⚠ `Stranger Things: VHS Special Edition` HAS NO TMDB ENTRY OF ITS OWN. It is
 * Netflix's own presentation of the series, so the work it denotes is
 * Stranger Things — `tmdb:tv:66732` — and that is the ground truth even though
 * the strings are far apart. Recording it as `null` would be the easy answer
 * and the wrong one: `null` asserts "this work is unidentifiable", which would
 * quietly EXCUSE the matcher from the hardest case in the corpus instead of
 * measuring it on it. If match accuracy suffers here, that is a true reading.
 */
const MANUAL_IDENTITIES = new Map([['stranger things vhs special edition', 'tmdb:tv:66732']]);

const manifest = JSON.parse(readFileSync(path.join(GOLDEN, 'manifest.json'), 'utf8'));
const manifestById = new Map(manifest.images.map((i) => [i.id, i]));

const check = process.argv.includes('--check');
let failures = 0;

mkdirSync(OUT, { recursive: true });

for (const image of IMAGES) {
  const entry = manifestById.get(image.id);
  if (!entry) throw new Error(`${image.id} is not in manifest.json`);
  if (entry.expectedTitleCount !== image.titles.length) {
    throw new Error(
      `${image.id}: manifest says ${String(entry.expectedTitleCount)} titles, the key has ${String(image.titles.length)}`,
    );
  }

  const target = path.join(OUT, `${image.id}.expected.json`);
  const existing = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : null;
  const priorIdentity = new Map(
    (existing?.expectedCandidates ?? []).map((c) => [c.normalisedText, c.expectedWorkIdentity]),
  );

  const doc = {
    imageId: image.id,
    expectedCandidates: image.titles.map((title) => ({
      title,
      normalisedText: normaliseTitleText(title),
      // ⚠ `title-candidate` is the IDEAL verdict, and recall counts
      // `low-confidence` and `inferred-unverified` towards it too (§9.2) — a
      // reader that finds the title but flags it has still found it.
      verdict: 'title-candidate',
      // Preserved across regeneration: filled in by `tools/golden-tmdb.mjs`,
      // which needs the network. Losing it on every re-run of THIS script
      // would make the two steps mutually destructive.
      expectedWorkIdentity:
        MANUAL_IDENTITIES.get(normaliseTitleText(title)) ??
        priorIdentity.get(normaliseTitleText(title)) ??
        null,
      expectedBasis: image.basis,
    })),
    expectedChrome: image.chrome.map((c) => normaliseTitleText(c)).filter((c) => c.length > 0),
    minRecall: image.minRecall,
    maxFalseTitles: image.maxFalseTitles,
    maxFabricated: image.maxFabricated,
  };

  const json = `${JSON.stringify(doc, null, 2)}\n`;
  if (check) {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (current !== json) {
      console.error(`DIFFERS: expected/${image.id}.expected.json`);
      failures += 1;
    }
  } else {
    writeFileSync(target, json, 'utf8');
    const resolved = doc.expectedCandidates.filter((c) => c.expectedWorkIdentity !== null).length;
    console.log(
      `wrote ${image.id}.expected.json — ${String(image.titles.length)} titles ` +
        `(${String(resolved)} identified), ${String(doc.expectedChrome.length)} chrome`,
    );
  }
}

if (check && failures > 0) {
  console.error(
    `\n${String(failures)} answer-key file(s) differ. Run: node tools/golden-expected.mjs`,
  );
  process.exit(1);
}
