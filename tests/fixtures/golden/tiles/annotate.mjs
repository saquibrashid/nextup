/**
 * Ground-truth TILE ANNOTATIONS for the golden image corpus (tile-crop work).
 *
 * ⚠ THIS SCRIPT IS PROVENANCE, NOT A TEST DEPENDENCY — the same rule as
 * `../images/generate.mjs` and `../ingest/generate.mjs`. Every `*.tiles.json`
 * beside it is COMMITTED and the suite reads the committed files. Nothing runs
 * this at test time: an annotation regenerated during the run can drift with
 * its generator and still agree with it, which is agreement, not evidence.
 *
 *   node tests/fixtures/golden/tiles/annotate.mjs            # write the JSON
 *   node tests/fixtures/golden/tiles/annotate.mjs --overlay  # verification PNGs
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `boundingBox` reaches the owner as the §5.3a tile thumbnail, and there was
 * no measured statement anywhere of where the tiles on these images ACTUALLY
 * are. Without one, every claim about box quality — the model's or ours — was
 * being argued from the model's own output, which is the thing in question.
 * These files are the independent answer.
 *
 * ── HOW THE NUMBERS WERE OBTAINED, AND HOW FAR TO TRUST THEM ───────────────
 *
 * Each image is described by its GRID (origin, pitch, size) rather than as a
 * list of hand-typed rectangles, because every layout in this corpus really is
 * a regular grid. Writing the pitch down once makes a transcription slip
 * visible as a whole row sliding off the artwork in the overlay, where one
 * wrong number among forty-nine would not be.
 *
 * Three different provenances, strongest first — they are NOT interchangeable:
 *
 *   1. `truncated-titles-01` is EXACT. Its tiles are read off
 *      `../images/generate.mjs`, the script that drew them. It is therefore
 *      the only image here that can VALIDATE the method rather than use it:
 *      the contrast detector below, run blind, returns its tiles to within
 *      0.001 in every coordinate.
 *   2. `low-quality-jpeg-01` and `rotated-01` are DERIVED, by the same
 *      transforms `generate.mjs` applied to their sources. A resize preserves
 *      normalised coordinates exactly, and sharp's `rotate(90)` is a clockwise
 *      quarter turn, so `(x, y, w, h)` becomes `(1 - y - h, x, h, w)`.
 *      ⚠ Deriving the rotated case rather than detecting it is deliberate. A
 *      detector tuned until a rotated image "looks right" is precisely the
 *      axis-specific reasoning this corpus exists to refute.
 *   3. The rest are DETECTED and then verified by eye against a rendered
 *      overlay. Gaps the detector missed — dark artwork, a tile under the nav
 *      bar — are filled from the row pitch and verified the same way.
 *
 * ⚠ SO THESE ARE HUMAN-VERIFIED, NOT MACHINE-CERTIFIED. Treat them as accurate
 * to about a percent of the image, which is far inside the errors they are
 * used to measure (whole tiles), and do NOT re-purpose them for sub-pixel work.
 *
 * ⚠ TILES ONLY, AND ONLY LIST TILES. A recommendation carousel, a "Continue
 * Watching" rail and the bottom nav are not entries in the owner's list, and
 * annotating them would inflate any recall figure computed against this set.
 *
 * ⚠ `title` IS PART OF THE GROUND TRUTH, and is the reason to prefer this over
 * geometry alone: it pairs a tile to a caption BY IDENTITY. Pairing them by
 * overlap instead silently fails on exactly the layouts that matter, where the
 * caption sits outside the tile it names.
 */

import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMAGES = path.join(HERE, '..', 'images');

const grid = ({ xs, ys, w, h, titles }) => {
  const out = [];
  let i = 0;
  for (const y of ys) {
    for (const x of xs) {
      if (i >= titles.length) break;
      out.push({
        x: +x.toFixed(4),
        y: +y.toFixed(4),
        w: +w.toFixed(4),
        h: +h.toFixed(4),
        title: titles[i],
      });
      i += 1;
    }
  }
  return out;
};

const seq = (start, pitch, n) => Array.from({ length: n }, (_, k) => start + k * pitch);

/** @type {Record<string, {ext: string, tiles: {x:number,y:number,w:number,h:number,title:string}[]}>} */
const SPECS = {};

// EXACT — from `../images/generate.mjs`: 380x400 tiles at x = 60 + col*440,
// y = 160 + row*540, on a 940x1260 canvas.
SPECS['truncated-titles-01'] = {
  ext: 'png',
  tiles: grid({
    xs: [60 / 940, 500 / 940],
    ys: [160 / 1260, 700 / 1260],
    w: 380 / 940,
    h: 400 / 1260,
    titles: [
      'The Lord of the Rings: The Fellowship of the Ring',
      'Everything Everywhere All at Once',
      'Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb',
      "The Hitchhiker's Guide to the Galaxy",
    ],
  }),
};

// Netflix desktop "My List" — a 6-across grid, second row short. The captions
// are BAKED INTO the artwork here; there is no separate caption strip.
SPECS['netflix-artwork-only-01'] = {
  ext: 'png',
  tiles: [
    ...grid({
      xs: [0.0383, 0.1933, 0.3467, 0.5, 0.655, 0.8083],
      ys: [0.3904],
      w: 0.1517,
      h: 0.2112,
      titles: [
        'Stranger Things: Tales from 85',
        'Raw',
        'The Whisper Man',
        'Hamnet',
        'Ladies First',
        'His & Hers',
      ],
    }),
    ...grid({
      xs: [0.0383, 0.1933, 0.3467, 0.5],
      ys: [0.6932],
      w: 0.1517,
      h: 0.2072,
      titles: ['Man on Fire', 'Louis C.K.: Ridiculous', 'Frankenstein', 'Sol Levante'],
    }),
  ],
};

// Netflix mobile "My List" — a VERTICAL list: artwork in a left column, the
// caption repeated as text to its right. Two measured captions per title.
SPECS['netflix-mylist-mobile-01'] = {
  ext: 'jpg',
  tiles: grid({
    xs: [0.0175],
    ys: seq(0.2305, 0.0984, 7),
    w: 0.301,
    h: 0.0829,
    titles: [
      'Ladies First',
      'Raw',
      'Wicked: For Good',
      'His & Hers',
      'Man on Fire',
      'Stranger Things: VHS Special Edition',
      'In the Hand of Dante',
    ],
  }),
};

SPECS['netflix-mylist-mobile-02'] = {
  ext: 'jpg',
  tiles: grid({
    xs: [0.0175],
    ys: seq(0.126, 0.09757, 8),
    w: 0.301,
    h: 0.0825,
    titles: [
      'Wicked: For Good',
      'His & Hers',
      'Man on Fire',
      'Stranger Things: VHS Special Edition',
      'In the Hand of Dante',
      'Louis C.K.: Ridiculous',
      'Frankenstein',
      'Dilwale Dulhania Le Jayenge',
    ],
  }),
};

// Max mobile "My Stuff". The six My List tiles only — the "Recommended For
// You" carousel below them is not the owner's list.
SPECS['max-saved-mobile-01'] = {
  ext: 'jpg',
  tiles: grid({
    xs: [0.045],
    ys: seq(0.1474, 0.11108, 6),
    w: 0.365,
    h: 0.1002,
    titles: [
      'Lanterns',
      'Normal',
      'The Drama',
      'Ramy Youssef: In Love',
      'Greenland 2: Migration',
      'True Detective',
    ],
  }),
};

// A single portrait tile. The annotation is the ARTWORK only: the progress bar
// and the info/more controls under it are chrome, not tile.
SPECS['netflix-continue-watching-01'] = {
  ext: 'jpg',
  tiles: [{ x: 0.0217, y: 0.1541, w: 0.2517, h: 0.5706, title: 'In the Hand of Dante' }],
};

// DERIVED — a resize preserves normalised coordinates exactly.
SPECS['low-quality-jpeg-01'] = {
  ext: 'jpg',
  tiles: SPECS['netflix-mylist-mobile-01'].tiles.map((t) => ({ ...t })),
};

// DERIVED — sharp's rotate(90) is a CLOCKWISE quarter turn.
SPECS['rotated-01'] = {
  ext: 'png',
  tiles: SPECS['max-saved-mobile-01'].tiles.map((t) => ({
    x: +(1 - t.y - t.h).toFixed(4),
    y: +t.x.toFixed(4),
    w: +t.h.toFixed(4),
    h: +t.w.toFixed(4),
    title: t.title,
  })),
};

/*
 * The contrast detector that PROPOSED the numbers above. Kept so the proposal
 * is reproducible by someone checking this work, not because its output is the
 * artefact — the committed JSON is.
 *
 * It scores a strip by CONTRAST, not brightness: artwork has texture, so its
 * stddev is high even when the art is dark, while a flat colour block has no
 * texture but a mean that differs from the page background. A gutter has
 * neither. Brightness alone misses a dark still AND a flat placeholder, which
 * is how the first attempt at this returned zero tiles for the one image whose
 * true geometry was already known.
 */
const runs = (profile, thr, minLen) => {
  const out = [];
  let start = -1;
  for (let i = 0; i <= profile.length; i += 1) {
    const on = i < profile.length && profile[i] > thr;
    if (on && start === -1) start = i;
    if (!on && start !== -1) {
      if (i - start >= minLen) out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
};

const pctile = (arr, p) => {
  const s = Float64Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

const contrast = (values, bg) => {
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let varsum = 0;
  for (const v of values) varsum += (v - mean) * (v - mean);
  return Math.sqrt(varsum / values.length) + Math.abs(mean - bg);
};

export const detect = async (file, opts = {}) => {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .greyscale()
    .resize({ width: 600 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const at = (x, y) => data[y * w + x];
  const bg = pctile(data, 0.1);
  const thr = opts.thr ?? 14;

  const rowProfile = [];
  for (let y = 0; y < h; y += 1) {
    const row = [];
    for (let x = 0; x < w; x += 1) row.push(at(x, y));
    rowProfile.push(contrast(row, bg));
  }

  const tiles = [];
  for (const [y0, y1] of runs(rowProfile, thr, Math.max(3, h * 0.02))) {
    const colProfile = [];
    for (let x = 0; x < w; x += 1) {
      const col = [];
      for (let y = y0; y <= y1; y += 1) col.push(at(x, y));
      colProfile.push(contrast(col, bg));
    }
    for (const [x0, x1] of runs(colProfile, thr, Math.max(3, w * 0.02))) {
      // FILL RATIO separates artwork from text. A tile is a solid picture, so
      // nearly every pixel differs from the background; a line of text is
      // mostly background with glyphs scattered through it. Without this the
      // caption under a tile is proposed as a second tile.
      let on = 0;
      let total = 0;
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          total += 1;
          if (Math.abs(at(x, y) - bg) > 10) on += 1;
        }
      }
      if (on / total < (opts.minFill ?? 0.75)) continue;
      const bw = (x1 - x0 + 1) / w;
      const bh = (y1 - y0 + 1) / h;
      if (bw * bh < 0.004) continue;
      tiles.push({
        x: +(x0 / w).toFixed(4),
        y: +(y0 / h).toFixed(4),
        w: +bw.toFixed(4),
        h: +bh.toFixed(4),
      });
    }
  }
  return tiles;
};

const renderOverlay = async (file, tiles, out) => {
  const meta = await sharp(file).metadata();
  const sw = 900;
  const sh = Math.round((meta.height / meta.width) * sw);
  const rects = tiles
    .map(
      (t, i) =>
        `<rect x="${(t.x * sw).toFixed(1)}" y="${(t.y * sh).toFixed(1)}" width="${(t.w * sw).toFixed(1)}" height="${(t.h * sh).toFixed(1)}" fill="none" stroke="#00ff88" stroke-width="3"/>` +
        `<text x="${(t.x * sw + 6).toFixed(1)}" y="${(t.y * sh + 24).toFixed(1)}" font-size="20" fill="#00ff88" font-family="monospace">${String(i)}</text>`,
    )
    .join('');
  await sharp(file)
    .resize({ width: sw })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}">${rects}</svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toFile(out);
};

const wantOverlay = process.argv.includes('--overlay');
for (const [name, { ext, tiles }] of Object.entries(SPECS)) {
  writeFileSync(path.join(HERE, `${name}.tiles.json`), `${JSON.stringify(tiles, null, 2)}\n`);
  console.log(`${name.padEnd(32)} ${String(tiles.length).padStart(2)} tiles`);
  if (wantOverlay) {
    const file = path.join(IMAGES, `${name}.${ext}`);
    await renderOverlay(file, tiles, path.join(HERE, `overlay-${name}.png`));
  }
}
