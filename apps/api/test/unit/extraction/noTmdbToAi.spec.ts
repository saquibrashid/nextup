/**
 * TASK-062 — `T-AI-013`, the NETWORK-SHAPED half of Rule A (`specs/ai.md`
 * §4.4, RSK-022, NFR-016, threat T16 in `specs/security.md`).
 *
 * The rule: **no TMDB content ever reaches an AI service.** TMDB's terms
 * restrict use "in connection with … an AI based Application", and the whole
 * matching design is deterministic (jaro-winkler, no ML) so that the rule
 * holds by construction rather than by care.
 *
 * ⚠ WHY A NETWORK-SHAPED TEST AND NOT AN IMPORT CHECK. `T-AI-012` forbids the
 * AI SDKs from the matching path, which stops the obvious violation — the
 * matcher calling a model. It cannot stop the violation from the other
 * direction: somebody threading a TMDB result INTO the extraction request, so
 * the model can "pick the right TMDB result". No new import is needed for
 * that, so the lint rule stays silent while a TMDB payload goes out over the
 * wire. This file asserts the wire.
 *
 * ⚠ BOTH INFERENCE HOSTS, which is R2's strengthening. ADR-0001 Revision 2
 * made extraction a hybrid of Azure OpenAI vision AND Azure AI Vision Read,
 * so a rule proved against one host is proved against half the egress.
 *
 * ⚠ THIS FILE CAPTURES THE FULL REQUEST BODY, which the shared vision fixture
 * deliberately does not ("The bytes are deliberately NOT captured"). That is
 * the right default for a contract suite and the wrong one here: the assertion
 * IS about the body. Nothing captured is ever logged.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { type SetupServerApi } from 'msw/node';
import { afterEach, describe, expect, it } from 'vitest';

import { AzureVisionExtractor } from '../../../src/extraction/azureVisionExtractor.js';
import { LlmVisionExtractor } from '../../../src/extraction/llmVisionExtractor.js';
import {
  AOAI_DEPLOYMENT,
  AOAI_ENDPOINT,
  fakeAoaiCredential,
} from '../../../../../tests/fixtures/msw/aoai/index.js';
import {
  VISION_ENDPOINT,
  fakeVisionCredential,
} from '../../../../../tests/fixtures/msw/vision/index.js';
import {
  recordingInferenceServer,
  type Wire,
} from '../../../../../tests/fixtures/msw/ruleA/index.js';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

/* ── the TMDB fixture vocabulary ──────────────────────────────────────── */

const TMDB_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../tests/fixtures/msw/tmdb',
);

/**
 * Every human-meaningful string TMDB gave us, from the committed recordings —
 * names, original names, overviews, and ids rendered as text.
 *
 * ⚠ NARROWED ON PURPOSE, and the narrowing is the hard part of this test. A
 * naive "no fixture string appears anywhere" set contains `"en"`, `"movie"`,
 * `"/"` and `"0"`, all of which occur in a perfectly legitimate extraction
 * request — so the test would fail on day one, be softened, and end up
 * asserting nothing. The fields below are exactly the ones that carry TMDB's
 * content: if any of them appears in a request to an inference host, TMDB
 * content has reached an AI service.
 */
const TMDB_CONTENT_FIELDS = new Set([
  'title',
  'name',
  'original_title',
  'original_name',
  'overview',
  'tagline',
]);

function collectTmdbContent(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectTmdbContent(v, out);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, v] of Object.entries(value)) {
    if (TMDB_CONTENT_FIELDS.has(key) && typeof v === 'string' && v.length >= 4) out.add(v);
    // A TMDB id is content too: `438631` in an extraction request is the
    // "let the model pick the TMDB result" change this file exists to catch.
    if (key === 'id' && typeof v === 'number' && v >= 1000) out.add(String(v));
    collectTmdbContent(v, out);
  }
}

const TMDB_CONTENT: readonly string[] = (() => {
  const out = new Set<string>();
  for (const file of readdirSync(TMDB_FIXTURE_DIR)) {
    if (!file.endsWith('.json')) continue;
    collectTmdbContent(JSON.parse(readFileSync(join(TMDB_FIXTURE_DIR, file), 'utf8')), out);
  }
  return [...out];
})();

/* ── the recording transport ──────────────────────────────────────────── */

/**
 * The whole request, serialised — URL, every header, and the raw body. This
 * is what "no TMDB content leaves for an AI host" has to be checked against,
 * because a smuggled title is as bad in a query string or a custom header as
 * it is in the JSON.
 */
function serialise(wire: Wire): string {
  return `${wire.url}\n${Object.entries(wire.headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n${wire.body}`;
}

function tmdbContentIn(wire: Wire): string[] {
  const haystack = serialise(wire);
  return TMDB_CONTENT.filter((needle) => haystack.includes(needle));
}

let server: SetupServerApi | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

/** Both inference hosts, driven through their real, shipped clients. */
async function runBothExtractors(): Promise<Wire[]> {
  const wires: Wire[] = [];
  server = recordingInferenceServer(wires);

  await new LlmVisionExtractor({
    endpoint: AOAI_ENDPOINT,
    deployment: AOAI_DEPLOYMENT,
    credential: fakeAoaiCredential(),
    timeoutMs: 5_000,
    sleep: () => Promise.resolve(),
    newCorrelationId: () => '00000000-0000-4000-8000-0000000000a1',
  }).extract(PNG_BYTES, 'image/png');

  await new AzureVisionExtractor({
    endpoint: VISION_ENDPOINT,
    credential: fakeVisionCredential(),
    timeoutMs: 5_000,
    sleep: () => Promise.resolve(),
    newCorrelationId: () => '00000000-0000-4000-8000-0000000000a2',
  }).extract(PNG_BYTES, 'image/png');

  return wires;
}

/* ── the assertions ───────────────────────────────────────────────────── */

describe('T-AI-013 · RSK-022 · no TMDB content reaches any AI service', () => {
  it('T-AI-013a: the TMDB fixture vocabulary is non-empty and specific', () => {
    // ⚠ THE VACUITY GUARD, and it is not optional. Everything below is a
    // "no needle found" assertion, so an empty or over-filtered needle set
    // makes every one of them pass while proving nothing at all.
    expect(TMDB_CONTENT.length).toBeGreaterThan(3);
    expect(TMDB_CONTENT).toContain('Dune');
    expect(TMDB_CONTENT).toContain('438631');
    // And it must not have swept up the structural vocabulary that a
    // legitimate extraction request legitimately contains.
    for (const generic of ['en', 'movie', 'tv', 'json', 'image/png', 'user', 'system']) {
      expect(TMDB_CONTENT).not.toContain(generic);
    }
  });

  it('T-AI-013b: both inference hosts are actually reached', async () => {
    // The second vacuity guard. If a future refactor stops these extractors
    // making requests at all, every "no TMDB content" assertion still passes.
    const wires = await runBothExtractors();
    expect(wires.filter((w) => w.host === 'aoai').length).toBeGreaterThan(0);
    expect(wires.filter((w) => w.host === 'vision').length).toBeGreaterThan(0);
  });

  it('T-AI-013c: no request to Azure OpenAI carries any TMDB content', async () => {
    const wires = await runBothExtractors();
    for (const wire of wires.filter((w) => w.host === 'aoai')) {
      expect({ url: wire.url, leaked: tmdbContentIn(wire) }).toEqual({
        url: wire.url,
        leaked: [],
      });
    }
  });

  it('T-AI-013d: no request to Azure AI Vision carries any TMDB content', async () => {
    const wires = await runBothExtractors();
    for (const wire of wires.filter((w) => w.host === 'vision')) {
      expect({ url: wire.url, leaked: tmdbContentIn(wire) }).toEqual({
        url: wire.url,
        leaked: [],
      });
    }
  });

  it('T-AI-013e: the detector FIRES on a planted title — headers, query and body alike', () => {
    // The third vacuity guard, and the one that makes the other three mean
    // something: it proves `tmdbContentIn` can fail. All three carriers are
    // exercised, because a body-only check is trivially evaded by a future
    // change that puts the hint in a query parameter.
    const base: Wire = { host: 'aoai', url: 'https://x/', headers: {}, body: '' };

    expect(tmdbContentIn({ ...base, body: JSON.stringify({ hint: 'Dune' }) })).toContain('Dune');
    expect(tmdbContentIn({ ...base, url: 'https://x/?candidate=Dune' })).toContain('Dune');
    expect(tmdbContentIn({ ...base, headers: { 'x-nextup-hint': 'Dune' } })).toContain('Dune');
    expect(tmdbContentIn({ ...base, body: JSON.stringify({ tmdbId: 438631 }) })).toContain(
      '438631',
    );
    expect(tmdbContentIn(base)).toEqual([]);
  });

  it('T-AI-013f: the prompt itself names no work — it asks for what is on screen', () => {
    // Rule A's positive form. The extraction prompt must never be seeded with
    // "is this Dune?" style priors, which is the cheapest way to break the
    // rule without adding an import or a network field.
    const prompts = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../src/extraction/prompts.ts'),
      'utf8',
    );
    for (const needle of TMDB_CONTENT) {
      expect(prompts).not.toContain(needle);
    }
  });
});
