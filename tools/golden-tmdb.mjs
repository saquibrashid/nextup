/**
 * Resolve `expectedWorkIdentity` for the golden answer key, and RECORD the
 * TMDB responses that justify each one (TASK-078, `specs/ai.md` §9.2).
 *
 *   TMDB_API_KEY=... node tools/golden-tmdb.mjs            # resolve + record
 *   TMDB_API_KEY=... node tools/golden-tmdb.mjs --only dune
 *
 * ⚠ TWO OUTPUTS, AND BOTH ARE LOAD-BEARING.
 *
 *   1. `tests/fixtures/golden/tmdb/<normalised>.json` — the recorded
 *      `search/multi` response. §9.2's match-accuracy metric is an OFFLINE
 *      metric ("against recorded TMDB fixtures"): the suite runs on every PR
 *      with no network and no key, so the candidate set the matcher scores
 *      has to be committed. Without these files `T-AI-031` could only run
 *      live, which means it would not run.
 *
 *   2. `expectedWorkIdentity` written back into `expected/*.expected.json`.
 *
 * ⚠ THIS SCRIPT DOES NOT DECIDE THE ANSWER — IT PROPOSES ONE. It accepts a
 * result only when the result's own title NORMALISES EQUAL to the expected
 * title. Anything else is printed as an ambiguity and left `null` for a human
 * to resolve by looking. Letting a fuzzy score pick the identity would make
 * the answer key agree with `matchCandidate()` by construction, and
 * `T-AI-031` would then be measuring the matcher against itself — the same
 * defect as deriving the titles from the reader's output, one stage later.
 *
 * ⚠ PROVENANCE, NOT A TEST DEPENDENCY. Everything it emits is committed and
 * the suite reads the committed files; nothing runs this at test time.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GOLDEN = path.join(ROOT, 'tests', 'fixtures', 'golden');
const EXPECTED = path.join(GOLDEN, 'expected');
const TMDB_DIR = path.join(GOLDEN, 'tmdb');

const { normaliseTitleText } = await import(
  pathToFileURL(path.join(ROOT, 'packages', 'domain', 'dist', 'identity.js')).href
);

const key = process.env.TMDB_API_KEY;
if (!key) {
  console.error('TMDB_API_KEY is not set.');
  process.exit(1);
}

const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex === -1 ? null : process.argv[onlyIndex + 1];

/* ------------------------------------------------------------------ *
 * Collect every distinct title in the key.
 *
 * The same work appears in up to four captures (the Netflix list is
 * deliberately overlapping), so this is keyed on the normalised text: one
 * lookup, one recording, one identity, reused everywhere it occurs. A
 * per-image recording would let the SAME work resolve to two identities in
 * two images, which is the one thing an answer key must never permit.
 * ------------------------------------------------------------------ */
const files = readdirSync(EXPECTED).filter((f) => f.endsWith('.expected.json'));
const docs = files.map((f) => ({
  file: f,
  doc: JSON.parse(readFileSync(path.join(EXPECTED, f), 'utf8')),
}));

const wanted = new Map();
for (const { doc } of docs) {
  for (const c of doc.expectedCandidates) {
    if (!wanted.has(c.normalisedText)) wanted.set(c.normalisedText, c.title);
  }
}

const slug = (normalised) => normalised.replace(/ /g, '-');

const search = async (query) => {
  const url = new URL('https://api.themoviedb.org/3/search/multi');
  url.searchParams.set('api_key', key);
  url.searchParams.set('query', query);
  url.searchParams.set('include_adult', 'false');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB ${String(res.status)} for "${query}"`);
  return res.json();
};

mkdirSync(TMDB_DIR, { recursive: true });

const resolved = new Map();
const ambiguous = [];

for (const [normalised, title] of wanted) {
  if (only && normalised !== only) continue;

  const body = await search(title);

  // Only movie and tv can carry a work identity; `person` results are noise
  // that would otherwise be recorded and scored.
  const results = (body.results ?? [])
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .map((r) => ({
      id: r.id,
      mediaType: r.media_type,
      title: r.media_type === 'movie' ? r.title : r.name,
      originalTitle: r.media_type === 'movie' ? r.original_title : r.original_name,
      releaseDate: (r.media_type === 'movie' ? r.release_date : r.first_air_date) || null,
      popularity: r.popularity ?? 0,
      overview: r.overview ?? '',
    }));

  writeFileSync(
    path.join(TMDB_DIR, `${slug(normalised)}.json`),
    `${JSON.stringify({ query: title, normalisedText: normalised, results }, null, 2)}\n`,
    'utf8',
  );

  // ⚠ EXACT NORMALISED EQUALITY ONLY — see the header. When more than one
  // result ties, the most popular wins, which is a tie-break between
  // ALREADY-CORRECT answers (a re-release, a remake sharing a title) and not
  // a similarity judgement.
  const exact = results.filter(
    (r) =>
      normaliseTitleText(r.title ?? '') === normalised ||
      normaliseTitleText(r.originalTitle ?? '') === normalised,
  );
  exact.sort((a, b) => b.popularity - a.popularity);

  if (exact.length === 0) {
    ambiguous.push({ normalised, title, results: results.slice(0, 4) });
    console.log(`?  ${title} — no exact normalised match in ${String(results.length)} results`);
    continue;
  }

  const pick = exact[0];
  resolved.set(normalised, `tmdb:${pick.mediaType}:${String(pick.id)}`);
  const tie = exact.length > 1 ? ` (${String(exact.length)} candidates, most popular wins)` : '';
  console.log(
    `ok ${title} -> tmdb:${pick.mediaType}:${String(pick.id)} ` +
      `"${pick.title}" ${pick.releaseDate ?? '—'}${tie}`,
  );
}

for (const { file, doc } of docs) {
  let changed = false;
  for (const c of doc.expectedCandidates) {
    const identity = resolved.get(c.normalisedText);
    if (identity && c.expectedWorkIdentity !== identity) {
      c.expectedWorkIdentity = identity;
      changed = true;
    }
  }
  if (changed)
    writeFileSync(path.join(EXPECTED, file), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

if (ambiguous.length > 0) {
  console.log(
    `\n⚠ ${String(ambiguous.length)} unresolved — decide these by LOOKING, not by score:`,
  );
  for (const a of ambiguous) {
    console.log(`\n  ${a.title}  (normalised: ${a.normalised})`);
    for (const r of a.results) {
      console.log(
        `    tmdb:${r.mediaType}:${String(r.id)}  "${r.title}"  ${r.releaseDate ?? '—'}  pop ${String(Math.round(r.popularity))}`,
      );
    }
  }
}

console.log(
  `\n${String(resolved.size)} resolved, ${String(ambiguous.length)} unresolved, ` +
    `${String(wanted.size)} distinct titles in the key.`,
);
