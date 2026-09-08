/**
 * Generator for the synthetic and derived half of the `golden/images/` corpus
 * (TASK-078).
 *
 * ⚠ THIS SCRIPT IS PROVENANCE, NOT A TEST DEPENDENCY — same rule as
 * `../ingest/generate.mjs`. Every byte it emits is COMMITTED and the suite
 * reads the committed files. Nothing runs this at test time: a fixture
 * generated during the run can drift with its generator and still agree with
 * it, which is agreement, not evidence.
 *
 *   node tests/fixtures/golden/images/generate.mjs
 *
 * ⚠ IT PRODUCES ONLY 4 OF THE 11 IMAGES, AND THAT IS THE POINT. The other 7
 * are the owner's real captures of the owner's real accounts (TASK-011,
 * `docs/evaluation/capture-surfaces.md`). A synthetic screenshot cannot
 * falsify a claim about how Netflix or Max actually render a list — it can
 * only echo whatever its author already believed. Do NOT "complete" the
 * corpus by generating replacements for the real captures.
 *
 * ⚠ HOW THIS DIFFERS FROM `ingest/generate.mjs`, and it matters: that script
 * constructs every byte by hand and is therefore byte-reproducible anywhere.
 * This one rasterises TEXT through libvips/fontconfig, so the exact bytes
 * depend on the fonts installed on the machine that ran it. Re-running it
 * elsewhere may produce a diff that is a font substitution and nothing more.
 * The committed files are the artefact; a dirty tree after a re-run is not
 * automatically a defect here, unlike in `ingest/`.
 *
 * ⚠ NO BRAND ASSETS. The two synthetic images use generic wording and plain
 * colour blocks. They deliberately do not reproduce either service's logo,
 * typeface or artwork.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const FONT = 'Arial, Helvetica, DejaVu Sans, sans-serif';
const BG = '#141414';
const FG = '#ffffff';
const DIM = '#b3b3b3';
const TILE = '#2b2b2b';

const out = (name, bytes) => {
  writeFileSync(path.join(HERE, name), bytes);
  console.log(`wrote ${name} (${String(bytes.length)} bytes)`);
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------------ *
 * 1. blank-no-content-01.png — the low-yield driver (T-AI-021/022).
 *
 * ⚠ "Genuinely contentless" means ZERO TITLES, not zero pixels. A real
 * empty watchlist still renders its chrome, and that is the harder and
 * more honest fixture: a blank rectangle is passed by any implementation
 * whatsoever, including one that returns [] unconditionally. This image
 * has chrome and no titles, so a run that yields a candidate has found
 * a real fabrication rather than a fixture defect.
 * ------------------------------------------------------------------ */
const blank = `<svg xmlns="http://www.w3.org/2000/svg" width="1170" height="2532">
  <rect width="1170" height="2532" fill="${BG}"/>
  <text x="60"  y="150" font-family="${FONT}" font-size="54" fill="${FG}" font-weight="bold">My List</text>
  <text x="820" y="150" font-family="${FONT}" font-size="40" fill="${DIM}">Search</text>
  <text x="60"  y="1180" font-family="${FONT}" font-size="46" fill="${FG}">You haven't added anything yet.</text>
  <text x="60"  y="1260" font-family="${FONT}" font-size="38" fill="${DIM}">Titles you add to your list will appear here.</text>
  <rect x="0" y="2380" width="1170" height="152" fill="#0b0b0b"/>
  <text x="90"  y="2470" font-family="${FONT}" font-size="34" fill="${DIM}">Home</text>
  <text x="400" y="2470" font-family="${FONT}" font-size="34" fill="${DIM}">New &amp; Hot</text>
  <text x="800" y="2470" font-family="${FONT}" font-size="34" fill="${DIM}">My List</text>
</svg>`;

/* ------------------------------------------------------------------ *
 * 2. truncated-titles-01.png — the R2.3b driver (T-AI-043).
 *
 * ⚠ The tiles are DELIBERATELY blank colour blocks. If they carried
 * recognisable artwork the reader could identify each work from the
 * picture and the test would pass without ever exercising the truncated
 * CAPTION, which is the only thing T-AI-043 is about.
 *
 * The ellipsis is U+2026, one character, exactly as a UI renders it —
 * `rawText` must retain it verbatim.
 * ------------------------------------------------------------------ */
const TRUNCATED = [
  'The Lord of the Rings: The Fell\u2026',
  'Everything Everywhere All at O\u2026',
  'Dr. Strangelove or: How I Lear\u2026',
  "The Hitchhiker's Guide to the \u2026",
];

const tiles = TRUNCATED.map((caption, i) => {
  const col = i % 2;
  const row = Math.floor(i / 2);
  const x = 60 + col * 440;
  const y = 160 + row * 540;
  return `
  <rect x="${String(x)}" y="${String(y)}" width="380" height="400" rx="12" fill="${TILE}"/>
  <text x="${String(x)}" y="${String(y + 450)}" font-family="${FONT}" font-size="28" fill="${FG}">${esc(caption)}</text>`;
}).join('');

const truncated = `<svg xmlns="http://www.w3.org/2000/svg" width="940" height="1260">
  <rect width="940" height="1260" fill="${BG}"/>
  <text x="60" y="90" font-family="${FONT}" font-size="46" fill="${FG}" font-weight="bold">My List</text>${tiles}
</svg>`;

/* ------------------------------------------------------------------ *
 * 3 & 4. The two DERIVED images.
 *
 * Both come from the owner's real captures, so their expected titles are
 * the source's expected titles — which is what makes the degraded and the
 * rotated case measurable at all. A degradation fixture whose clean
 * counterpart is absent tells you a number but nothing to compare it to.
 *
 * sharp does not copy metadata unless `withMetadata()` is called, so both
 * outputs are stripped; `verify()` below proves it rather than assuming it.
 * ------------------------------------------------------------------ */
const LOW_QUALITY_SOURCE = 'netflix-mylist-mobile-01.jpg';
const ROTATED_SOURCE = 'max-saved-mobile-01.jpg';

const src = (name) => readFileSync(path.join(HERE, name));

const verify = async (name) => {
  const bytes = readFileSync(path.join(HERE, name));
  const meta = await sharp(bytes).metadata();
  const carries = Boolean(meta.exif) || Boolean(meta.icc) || Boolean(meta.xmp);
  console.log(
    `  ${name}: ${String(meta.width)}x${String(meta.height)} ${String(meta.format)}` +
      ` — metadata: ${carries ? '*** PRESENT ***' : 'none'}`,
  );
  if (carries) throw new Error(`${name} carries metadata; REQ-078 expects none`);
};

const main = async () => {
  out(
    'blank-no-content-01.png',
    await sharp(Buffer.from(blank)).png({ compressionLevel: 9 }).toBuffer(),
  );
  out(
    'truncated-titles-01.png',
    await sharp(Buffer.from(truncated)).png({ compressionLevel: 9 }).toBuffer(),
  );

  out(
    'low-quality-jpeg-01.jpg',
    await sharp(src(LOW_QUALITY_SOURCE))
      .resize({ width: 640 })
      .jpeg({ quality: 18, chromaSubsampling: '4:2:0' })
      .toBuffer(),
  );

  out(
    'rotated-01.png',
    await sharp(src(ROTATED_SOURCE)).rotate(90).png({ compressionLevel: 9 }).toBuffer(),
  );

  console.log('\nverifying:');
  for (const n of [
    'blank-no-content-01.png',
    'truncated-titles-01.png',
    'low-quality-jpeg-01.jpg',
    'rotated-01.png',
  ]) {
    await verify(n);
  }
};

await main();
