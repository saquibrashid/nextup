/**
 * T3 — the live quality suite. `npm run golden:live`. TASK-079b.
 * `specs/ai.md` §9.5, `specs/testing.md` §4A (assertions L1–L7).
 *
 * ⚠ THIS SUITE SPENDS REAL MONEY AGAINST REAL AZURE AND MUST NEVER RUN IN CI.
 * It makes 33 live vision calls (11 golden images × 3 runs) plus 33 live OCR
 * calls. `T-CI-007l` asserts, file by file, that the only npm script selecting
 * its Vitest project is `golden:live`; `T-AI-045f` and `T-CI-004` assert no
 * workflow references that script. It is run BY A HUMAN, deliberately, and its
 * output is a committed report — not a merge gate.
 *
 * ── WHY IT IS A VITEST PROJECT AT ALL ─────────────────────────────────────
 *
 * Not so that it runs: so that it is not INVISIBLE. `T-CI-008` fails any
 * `.spec.*` file that no runner collects, because an uncollected spec passes
 * by never executing — and this is the worst possible file to be silently
 * dead, since nothing else in the repository ever touches the live providers.
 * A dead `goldenLive.spec.ts` would mean the product's only model-drift alarm
 * had been disconnected, while every gate stayed green. It therefore lives in
 * a `live` project that no other script and no workflow ever selects.
 *
 * ── IT IS ALLOWED TO BE FLAKY, AND THE ASSERTIONS ARE BANDS ───────────────
 *
 * The primary reader is sampled. §9.5 states the prohibitions plainly and they
 * are repeated here because they are the failure an implementer reaches for
 * when a live run is red:
 *
 *   ❌ never assert exact string equality against a live response
 *   ❌ never assert an exact candidate count
 *   ❌ never assert ORDER — compare sorted sets
 *   ❌ never snapshot live output
 *   ❌ never add this to a workflow, a schedule or a hook
 *
 *   ✅ recall floors, Jaccard stability floors, rate ceilings, membership over
 *      a sorted set, and cost ceilings
 *
 * ── THE REPORT IS WRITTEN BEFORE THE ASSERTIONS RUN, ON PURPOSE ───────────
 *
 * `docs/evaluation/golden-<ISO date>.md` is written at the end of the live
 * phase, before a single band is checked. A run that FAILS a band is the run
 * whose numbers matter most, and a report emitted only on success would
 * discard exactly those. A drop between two reports is the only early warning
 * of model drift this product has.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DefaultAzureCredential } from '@azure/identity';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ImageMimeType, LlmTile, OcrLine } from '@nextup/domain';

import {
  AzureVisionExtractor,
  type VisionLogEvent,
} from '../../apps/api/src/extraction/azureVisionExtractor.js';
import {
  LlmVisionExtractor,
  type LlmLogEvent,
} from '../../apps/api/src/extraction/llmVisionExtractor.js';
import {
  DEFAULT_RECORDING_MODEL_ID,
  inMemoryRecordingStore,
  sha256OfBytes,
  type Recording,
} from '../../apps/api/src/extraction/recordings.js';
import { transcodeHeicToPng } from '../../apps/api/src/images/transcode.js';

import {
  IMAGES,
  RECALL_VERDICTS,
  aggregate,
  manifest,
  mimeOf,
  needsTranscode,
  scoreAll,
  scoreWithStore,
  type Scored,
} from './goldenScorer.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
const EVALUATION_DIR = path.join(REPO_ROOT, 'docs', 'evaluation');

/** §4A: "It runs each golden image N = 3 times". Not a tuning knob. */
const RUNS = 3;

/** The §4A bands. Every one of these is quoted from the table in §9.5. */
const JACCARD_STABILITY_FLOOR = 0.95; // L2
const UNSTABLE_TITLE_CEILING = 0.05; // L3
const FABRICATION_CEILING = 0.05; // L4
const FALSE_TITLE_CEILING = 0.1; // L5
const ARTWORK_ONLY_RECALL_FLOOR = 0.8; // L6
const COST_CEILING_USD = 0.5; // L7

/** The §9.2 artwork-only fixture L6 names. */
const ARTWORK_ONLY_IMAGE = 'netflix-artwork-only-01';

/**
 * Azure OpenAI `gpt-4.1` global-standard list price, USD per 1M tokens.
 *
 * ⚠ L7 IS A REGRESSION GUARD ON PROMPT AND TOKEN GROWTH, NOT A BILLING
 * RECONCILIATION. The dollar figure only scales the token counts, so a list
 * price that drifts by a few percent moves the number without changing what
 * the assertion detects — a prompt that doubled, an image detail setting that
 * changed, or a reader that started emitting far more output. The Azure AI
 * Vision leg is the **F0 free tier** (`docs/architecture.md`), so it
 * contributes 0 and is reported as such rather than silently omitted.
 */
const USD_PER_1M_PROMPT_TOKENS = 2.0;
const USD_PER_1M_COMPLETION_TOKENS = 8.0;

/**
 * L1's per-image `minRecall`.
 *
 * ⚠ THESE ARE FLOORS, NOT THE MEASURED VALUES, AND THE DIFFERENCE IS THE
 * WHOLE POINT. §9.2's offline numbers are pinned to four decimal places
 * because the recordings are fixed; a live run resamples, so pinning it would
 * fail on the model's own variance and teach the reader to ignore this suite.
 * Each floor is the offline per-image recall dropped to the next band below,
 * so ordinary sampling noise passes and a real regression does not.
 *
 * ⚠ `netflix-continue-watching-01` IS 0 AND THAT IS NOT AN OVERSIGHT. It has
 * one expected title, which the offline recordings do not recover at all
 * (`T-AI-030b` records `found: 0`). A floor above 0 would fail every live run
 * for a known offline shortfall, which is not drift. `T-AI-051j` holds every
 * floor at or below what the committed recordings already achieve, so this
 * table cannot quietly become aspirational.
 *
 * ⚠ `blank-no-content-01` HAS NO EXPECTED TITLES, so its recall is 1 by
 * definition (see `scoreWithStore`'s 0/0 note) and its floor of 1 asserts that
 * the fixture keeps behaving that way rather than asserting reader quality.
 */
const MIN_RECALL: Readonly<Record<string, number>> = {
  'netflix-mylist-mobile-01': 0.75, // offline 0.875 (7/8)
  'netflix-mylist-mobile-02': 0.875, // offline 1.0 (8/8)
  'netflix-mylist-desktop-01': 0.9, // offline 1.0 (10/10)
  'netflix-continue-watching-01': 0, // offline 0.0 (0/1) — see above
  'max-saved-mobile-01': 0.83, // offline 1.0 (6/6)
  'max-saved-desktop-01': 0.83, // offline 1.0 (6/6)
  'netflix-artwork-only-01': 0.8, // offline 1.0 (10/10); L6 names the same floor
  'blank-no-content-01': 1, // 0 expected — recall is 1 by definition
  'truncated-titles-01': 0.75, // offline 1.0 (4/4)
  'low-quality-jpeg-01': 0.75, // offline 0.875 (7/8)
  'rotated-01': 0.83, // offline 1.0 (6/6)
};

interface RunUsage {
  promptTokens: number;
  completionTokens: number;
  llmCalls: number;
  ocrCalls: number;
}

interface LiveRun {
  readonly index: number;
  readonly scored: readonly Scored[];
  readonly usage: RunUsage;
}

/** The normalised titles a run ACCEPTED, corpus-wide. Sorted set, never ordered output. */
function acceptedTitles(scored: readonly Scored[]): Set<string> {
  const out = new Set<string>();
  for (const s of scored) {
    for (const c of s.candidates) {
      if (RECALL_VERDICTS.has(c.cleanupVerdict)) out.add(c.normalisedText);
    }
  }
  return out;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  // ⚠ TWO EMPTY SETS ARE IDENTICAL, NOT UNDEFINED. Returning NaN here would
  // make L2 pass by comparison-with-NaN semantics on a run that extracted
  // nothing at all — the zero-yield trap, arriving through the stability gate.
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function requireEnv(name: string, why: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set. ${why}\n` +
        'The live suite is MANUAL: export the endpoints and sign in with an ' +
        'identity holding `Cognitive Services OpenAI User` and ' +
        '`Cognitive Services User`, then re-run `npm run golden:live`.',
    );
  }
  return value;
}

/**
 * Read one image through both LIVE readers.
 *
 * ⚠ HEIC IS TRANSCODED FOR THE PROVIDER CALL ONLY, AND THE SHA256 IS OF THE
 * COMMITTED BYTES — the same rule `tools/golden-record.mjs` follows, for the
 * same reason: the recording store is keyed on the bytes the pipeline is
 * handed, and hashing a transcode would key it on an artefact that exists
 * nowhere in the repository.
 */
async function readLive(
  llm: LlmVisionExtractor,
  vision: AzureVisionExtractor,
  file: string,
): Promise<{ sha256: string; recording: Recording }> {
  const bytes = new Uint8Array(readFileSync(path.join(IMAGES, file)));
  const sha256 = sha256OfBytes(bytes);
  // Post-transcode by construction — `ImageMimeType` is png|jpeg and must not
  // be widened (REQ-077). See `mimeOf`.
  const mime: ImageMimeType = mimeOf(file);

  let sent = bytes;
  if (needsTranscode(file)) {
    // The pixel guard reads the header before allocating a decode buffer.
    // These two fixtures are monitor photographs and decode large; a developer
    // workstation is not the 0.5 GiB container, so the ceiling is raised for
    // this call alone and production's value is untouched (REQ-079).
    const transcoded = await transcodeHeicToPng(bytes, 'heic', {
      env: { ...process.env, NEXTUP_MAX_DECODE_PIXELS: '50000000' },
    });
    sent = new Uint8Array(transcoded.bytes);
  }

  // Sequential and separately awaited: the two `.heic` slots decode large and
  // recording throughput is not a problem worth risking memory for.
  const tiles: LlmTile[] = await llm.readTiles(sent, mime);
  const lines: OcrLine[] = await vision.readLines(sent, mime);
  return { sha256, recording: { llm: tiles, ocr: lines } };
}

function reportMarkdown(runs: readonly LiveRun[], cost: number): string {
  const lines: string[] = [];
  const iso = new Date().toISOString();
  lines.push(`# Golden live quality report — ${iso}`);
  lines.push('');
  lines.push(
    `Model \`${DEFAULT_RECORDING_MODEL_ID}\`, ${String(RUNS)} runs over ` +
      `${String(manifest.images.length)} images. Generated by \`npm run golden:live\` ` +
      '(`specs/testing.md` §4A). **Manual, band-asserted, never run in CI.**',
  );
  lines.push('');

  lines.push('## Per-run aggregates');
  lines.push('');
  lines.push('| Run | Recall | False-title rate | Fabrication rate | Chrome rejection |');
  lines.push('|---|---|---|---|---|');
  for (const run of runs) {
    const agg = aggregate(run.scored);
    lines.push(
      `| ${String(run.index + 1)} | ${agg.recall.toFixed(4)} | ` +
        `${agg.falseTitleRate.toFixed(4)} | ${agg.fabricationRate.toFixed(4)} | ` +
        `${agg.chromeRejectionRate.toFixed(4)} |`,
    );
  }
  lines.push('');

  lines.push('## L1 — per-image recall against its floor');
  lines.push('');
  lines.push(`| Image | Floor | ${runs.map((r) => `Run ${String(r.index + 1)}`).join(' | ')} |`);
  lines.push(`|---|---|${runs.map(() => '---').join('|')}|`);
  for (const image of manifest.images) {
    const floor = MIN_RECALL[image.id] ?? 0;
    const cells = runs.map((run) => {
      const s = run.scored.find((x) => x.image.id === image.id);
      return s === undefined ? 'n/a' : s.recall.toFixed(3);
    });
    lines.push(`| \`${image.id}\` | ${floor.toFixed(3)} | ${cells.join(' | ')} |`);
  }
  lines.push('');

  const unstable = unstableTitles(runs);
  lines.push('## L3 — unstable titles (present in fewer than 3 of 3 runs)');
  lines.push('');
  if (unstable.length === 0) {
    lines.push('None. Every expected title that was found was found in all three runs.');
  } else {
    // §4A: "each is printed by name in the report". A count alone tells the
    // reader that the model wobbled but not on WHAT, which is the only part
    // that can be acted on.
    for (const entry of unstable) {
      lines.push(`- \`${entry.title}\` — found in ${String(entry.runs)} of ${String(RUNS)} runs`);
    }
  }
  lines.push('');

  lines.push('## L7 — cost');
  lines.push('');
  const prompt = runs.reduce((n, r) => n + r.usage.promptTokens, 0);
  const completion = runs.reduce((n, r) => n + r.usage.completionTokens, 0);
  lines.push(`- Prompt tokens: ${String(prompt)}`);
  lines.push(`- Completion tokens: ${String(completion)}`);
  lines.push(
    `- Estimated cost: **$${cost.toFixed(4)}** at $${USD_PER_1M_PROMPT_TOKENS.toFixed(2)}/1M ` +
      `prompt and $${USD_PER_1M_COMPLETION_TOKENS.toFixed(2)}/1M completion. The Azure AI ` +
      'Vision leg is F0 (free tier) and contributes $0.',
  );
  lines.push('');
  lines.push(
    '> A drop between two reports is the only early warning of model drift this ' +
      'product has. Commit this file.',
  );
  lines.push('');
  return lines.join('\n');
}

/** Expected titles found in fewer than every run — L3. */
function unstableTitles(runs: readonly LiveRun[]): { title: string; runs: number }[] {
  const expected = new Set<string>();
  for (const s of runs[0]?.scored ?? []) {
    for (const c of s.expected.expectedCandidates) expected.add(c.normalisedText);
  }
  const perRun = runs.map((r) => acceptedTitles(r.scored));
  const out: { title: string; runs: number }[] = [];
  for (const title of [...expected].sort()) {
    const hits = perRun.filter((set) => set.has(title)).length;
    if (hits > 0 && hits < runs.length) out.push({ title, runs: hits });
  }
  return out;
}

describe('T-AI-051 · §4A the live quality suite — MANUAL, COSTS MONEY', () => {
  let runs: LiveRun[] = [];
  let totalCostUsd = 0;
  let reportPath = '';
  let offline: readonly Scored[] = [];

  beforeAll(async () => {
    const endpoint = requireEnv(
      'NEXTUP_AOAI_ENDPOINT',
      'The primary reader cannot be measured without it (specs/ai.md §2.1a).',
    );
    const visionEndpoint = requireEnv(
      'NEXTUP_VISION_ENDPOINT',
      'The OCR cross-check cannot be measured without it (specs/ai.md §2.1b).',
    );
    const deployment = process.env['NEXTUP_AOAI_DEPLOYMENT']?.trim() ?? DEFAULT_RECORDING_MODEL_ID;

    const credential = new DefaultAzureCredential();
    let usage: RunUsage = { promptTokens: 0, completionTokens: 0, llmCalls: 0, ocrCalls: 0 };

    const llm = new LlmVisionExtractor({
      endpoint,
      deployment,
      credential,
      log: (event: LlmLogEvent) => {
        if (event.event !== 'success') return;
        usage.llmCalls += 1;
        usage.promptTokens += event.promptTokens ?? 0;
        usage.completionTokens += event.completionTokens ?? 0;
      },
    });
    const vision = new AzureVisionExtractor({
      endpoint: visionEndpoint,
      credential,
      log: (event: VisionLogEvent) => {
        if (event.event === 'success') usage.ocrCalls += 1;
      },
    });

    for (let index = 0; index < RUNS; index += 1) {
      usage = { promptTokens: 0, completionTokens: 0, llmCalls: 0, ocrCalls: 0 };
      const entries = new Map<string, Recording>();
      for (const image of manifest.images) {
        const { sha256, recording } = await readLive(llm, vision, image.file);
        entries.set(sha256, recording);
      }
      // ⚠ SCORED THROUGH THE SHARED SCORER, NOT A COPY OF IT. See
      // `scoreWithStore`'s header: a live suite with its own scoring rules
      // would report divergence between the copies as model drift, which is
      // the one conclusion this suite exists to support.
      const scored = await scoreWithStore(inMemoryRecordingStore(entries));
      runs.push({ index, scored, usage });
    }

    totalCostUsd =
      (runs.reduce((n, r) => n + r.usage.promptTokens, 0) / 1_000_000) * USD_PER_1M_PROMPT_TOKENS +
      (runs.reduce((n, r) => n + r.usage.completionTokens, 0) / 1_000_000) *
        USD_PER_1M_COMPLETION_TOKENS;

    // ⚠ WRITTEN BEFORE ANY BAND IS CHECKED. A run that fails a band is the run
    // whose numbers matter most; a report emitted only on success would throw
    // exactly those away. See the file header.
    mkdirSync(EVALUATION_DIR, { recursive: true });
    reportPath = path.join(EVALUATION_DIR, `golden-${new Date().toISOString().slice(0, 10)}.md`);
    writeFileSync(reportPath, reportMarkdown(runs, totalCostUsd), 'utf8');
    console.log(`\nLive quality report written to ${path.relative(REPO_ROOT, reportPath)}\n`);

    // The offline baseline, replayed from the committed recordings. Free, and
    // the only thing that keeps `MIN_RECALL` honest (`T-AI-051j`).
    offline = await scoreAll(DEFAULT_RECORDING_MODEL_ID);
  });

  it('T-AI-051i · the run actually reached the live providers', () => {
    // ⚠ THE ZERO-YIELD TRAP, ASSERTED FIRST BECAUSE IT INVALIDATES EVERY OTHER
    // NUMBER BELOW. A run that made no calls scores recall 0 — but also
    // false-title 0 and fabrication 0, so L4 and L5 PASS. Two of the bands
    // agreeing on an empty run is not evidence; it is the shape of a broken
    // harness. Nothing else in this file may be believed without this.
    expect(runs).toHaveLength(RUNS);
    for (const run of runs) {
      expect(run.usage.llmCalls, `run ${String(run.index + 1)} made no LLM calls`).toBe(
        manifest.images.length,
      );
      expect(run.usage.ocrCalls, `run ${String(run.index + 1)} made no OCR calls`).toBe(
        manifest.images.length,
      );
      expect(run.usage.promptTokens).toBeGreaterThan(0);
      expect(acceptedTitles(run.scored).size).toBeGreaterThan(0);
    }
  });

  it('T-AI-051a · L1 · per-image recall clears its floor in 3 of 3 runs', () => {
    const failures: string[] = [];
    for (const run of runs) {
      for (const s of run.scored) {
        const floor = MIN_RECALL[s.image.id];
        expect(floor, `${s.image.id} has no declared minRecall`).toBeTypeOf('number');
        if (s.recall < (floor ?? 0)) {
          failures.push(
            `run ${String(run.index + 1)}: ${s.image.id} recall ${s.recall.toFixed(3)} < ${String(floor)}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('T-AI-051b · L2 · pairwise Jaccard of the accepted-title sets is ≥ 0.95', () => {
    const sets = runs.map((r) => acceptedTitles(r.scored));
    const pairs: { pair: string; value: number }[] = [];
    for (let i = 0; i < sets.length; i += 1) {
      for (let j = i + 1; j < sets.length; j += 1) {
        // Non-null: both indices are inside `sets` by construction, and
        // `noUncheckedIndexedAccess` cannot see that.
        pairs.push({
          pair: `${String(i + 1)}×${String(j + 1)}`,
          value: jaccard(sets[i] as Set<string>, sets[j] as Set<string>),
        });
      }
    }
    expect(pairs).toHaveLength(3);
    const below = pairs.filter((p) => p.value < JACCARD_STABILITY_FLOOR);
    expect(below.map((p) => `${p.pair}=${p.value.toFixed(4)}`)).toEqual([]);
  });

  it('T-AI-051c · L3 · fewer than 5 % of expected titles are unstable, each named', () => {
    const expectedTotal = runs[0]?.scored.reduce(
      (n, s) => n + s.expected.expectedCandidates.length,
      0,
    );
    expect(expectedTotal).toBeGreaterThan(0);
    const unstable = unstableTitles(runs);
    // Named in the failure message as well as the report — a bare ratio tells
    // the reader the model wobbled but not on what.
    expect(
      unstable.length / (expectedTotal ?? 1),
      `unstable: ${unstable.map((u) => `${u.title} (${String(u.runs)}/${String(RUNS)})`).join(', ')}`,
    ).toBeLessThanOrEqual(UNSTABLE_TITLE_CEILING);
  });

  it('T-AI-051d · L4 · the fabrication rate stays under 0.05 in every run', () => {
    for (const run of runs) {
      const agg = aggregate(run.scored);
      expect(
        agg.candidateCount,
        'a run with no candidates fabricates nothing vacuously',
      ).toBeGreaterThan(0);
      expect(agg.fabricationRate, `run ${String(run.index + 1)}`).toBeLessThanOrEqual(
        FABRICATION_CEILING,
      );
    }
  });

  it('T-AI-051e · L5 · the false-title rate stays under 0.10 in every run', () => {
    for (const run of runs) {
      const agg = aggregate(run.scored);
      expect(agg.falseTitleRate, `run ${String(run.index + 1)}`).toBeLessThanOrEqual(
        FALSE_TITLE_CEILING,
      );
    }
  });

  it('T-AI-051f · L6 · artwork-only recall is ≥ 0.80 in 3 of 3 runs', () => {
    for (const run of runs) {
      const s = run.scored.find((x) => x.image.id === ARTWORK_ONLY_IMAGE);
      expect(s, `${ARTWORK_ONLY_IMAGE} is missing from run ${String(run.index + 1)}`).toBeDefined();
      expect(s?.recall, `run ${String(run.index + 1)}`).toBeGreaterThanOrEqual(
        ARTWORK_ONLY_RECALL_FLOOR,
      );
    }
  });

  it('T-AI-051g · L7 · the whole run costs no more than $0.50', () => {
    // A ceiling on PROMPT AND TOKEN GROWTH, not a billing reconciliation. If
    // this fires, the question is what got bigger — the prompt, the image
    // detail setting, or the reader's output — not what Azure charged.
    expect(totalCostUsd).toBeGreaterThan(0);
    expect(totalCostUsd).toBeLessThanOrEqual(COST_CEILING_USD);
  });

  it('T-AI-051h · the report is written to docs/evaluation/ before any band is judged', () => {
    expect(reportPath).not.toBe('');
    const text = readFileSync(reportPath, 'utf8');
    expect(text).toContain('# Golden live quality report');
    expect(text).toContain('## L1 — per-image recall against its floor');
    expect(text).toContain('## L3 — unstable titles');
    expect(text).toContain('## L7 — cost');
  });

  it('T-AI-051j · every declared minRecall is achievable — no floor exceeds the offline baseline', () => {
    // ⚠ WITHOUT THIS, `MIN_RECALL` DRIFTS INTO ASPIRATION AND L1 FAILS FOR A
    // REASON THAT IS NOT DRIFT. A floor above what the committed recordings
    // already achieve makes the suite red on a good day, and the fix an
    // implementer reaches for is to stop running it.
    const tooHigh: string[] = [];
    for (const s of offline) {
      const floor = MIN_RECALL[s.image.id] ?? 0;
      if (floor > s.recall) {
        tooHigh.push(`${s.image.id}: floor ${String(floor)} > offline ${s.recall.toFixed(3)}`);
      }
    }
    expect(tooHigh).toEqual([]);
    // Non-vacuity, in the direction that matters: a table of zeroes would pass
    // the check above while asserting nothing at all.
    expect(Object.values(MIN_RECALL).filter((v) => v > 0).length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(MIN_RECALL).sort()).toEqual(manifest.images.map((i) => i.id).sort());
  });
});
