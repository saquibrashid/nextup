#!/usr/bin/env node
/**
 * `npm run golden:record` — re-record the golden fixture responses from the
 * LIVE providers. TASK-079. `specs/ai.md` §9.6.
 *
 * ⚠ MANUAL AND HUMAN-REVIEWED. `T-CI-004` asserts this script is referenced by
 * no workflow file. It calls Azure OpenAI and Azure AI Vision and it costs
 * money.
 *
 * Because the primary reader is sampled, a refresh **will** produce a diff even
 * with no provider change. The review question after a refresh is therefore
 * *"did the §9.2 metrics move?"*, never *"is the diff empty?"*.
 *
 * ── WHAT IT WRITES, AND WHY THAT IS NOT WHAT §9.1 LITERALLY SAYS ───────────
 *
 * §9.1 describes `llm/<modelId>/<image>.llm.json` as "the raw HTTP body". The
 * consumer — `goldenRecordingStore` in `apps/api/src/extraction/recordings.ts`
 * — parses that file as `LlmTile[]`, i.e. the MAPPED reader output. The two
 * cannot both be true of one file, and the divergence is resolved in favour of
 * the consumer, deliberately:
 *
 *   - The mapping layer (raw body → `LlmTile[]`) is already covered, against
 *     the REAL extractors, by the §9.3 contract suite (`T-AI-033`) using the
 *     hand-authored `msw` fixtures in `tests/fixtures/msw/`. Recording raw
 *     bodies here would test that layer twice and the merge not at all.
 *   - What T1 (`T-AI-030`) needs is a deterministic input to stages 1c–5. That
 *     is exactly `LlmTile[]` / `OcrLine[]`.
 *
 * Reported, not silently absorbed: `specs/ai.md` §9.1 should say "the mapped
 * reader output". See the TASK-079 backlog row.
 *
 * ── THE SHA256 IS OF THE COMMITTED FILE BYTES ─────────────────────────────
 *
 * `goldenRecordingStore` keys on the sha256 of the bytes `extract()` is handed.
 * The offline suite hands it the fixture file exactly as committed, so that is
 * what is hashed here — INCLUDING for the two `.heic` slots, which are
 * transcoded to PNG for the provider call only. Hashing the transcoded bytes
 * would key the recording on an artefact that exists nowhere in the repository.
 *
 * Usage:
 *   node tools/golden-record.mjs [--model <deployment>] [--only <imageId>] [--skip-ocr] [--dry-run]
 *
 * Requires `NEXTUP_AOAI_ENDPOINT`, `NEXTUP_VISION_ENDPOINT`, a signed-in Azure
 * identity with `Cognitive Services OpenAI User` + `Cognitive Services User`,
 * and a prior `npm run build --workspace apps/api` (this script imports the
 * built extractors rather than re-implementing the prompt, auth and retry
 * policy — a second implementation of the reader would be recording something
 * the product does not do).
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const GOLDEN = join(ROOT, 'tests', 'fixtures', 'golden');
const API_DIST = join(ROOT, 'apps', 'api', 'dist');

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

function parseArgs(argv) {
  const args = { model: 'gpt-4.1', only: null, dryRun: false, skipOcr: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--model') args.model = argv[++i];
    else if (flag === '--only') args.only = argv[++i];
    else if (flag === '--skip-ocr') args.skipOcr = true;
    else if (flag === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown flag: ${flag}`);
  }
  if (!args.model) throw new Error('--model requires a deployment name.');
  return args;
}

function requireEnv(name, why) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. ${why}`);
  return value;
}

async function importDist(relative) {
  const path = join(API_DIST, relative);
  if (!existsSync(path)) {
    throw new Error(
      `${path} does not exist. Run \`npm run build --workspace apps/api\` first — ` +
        'this script records through the REAL extractors, not a copy of them.',
    );
  }
  return import(`file://${path}`);
}

function extensionOf(file) {
  const dot = file.lastIndexOf('.');
  return dot === -1 ? '' : file.slice(dot).toLowerCase();
}

/** Stable, diff-friendly JSON: two-space indent and a trailing newline. */
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const manifestPath = join(GOLDEN, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const images = args.only
    ? manifest.images.filter((image) => image.id === args.only)
    : manifest.images;

  if (images.length === 0) {
    throw new Error(`No image matched --only ${args.only}.`);
  }

  const aoaiEndpoint = requireEnv(
    'NEXTUP_AOAI_ENDPOINT',
    'The primary reader cannot be recorded without it (specs/ai.md §2.1a).',
  );
  const visionEndpoint = requireEnv(
    'NEXTUP_VISION_ENDPOINT',
    'The OCR cross-check cannot be recorded without it (specs/ai.md §2.1b).',
  );

  const { DefaultAzureCredential } = await import('@azure/identity');
  const { LlmVisionExtractor } = await importDist('extraction/llmVisionExtractor.js');
  const { AzureVisionExtractor } = await importDist('extraction/azureVisionExtractor.js');
  const { transcodeHeicToPng } = await importDist('images/transcode.js');

  const credential = new DefaultAzureCredential();
  const llm = new LlmVisionExtractor({
    endpoint: aoaiEndpoint,
    deployment: args.model,
    credential,
    // ⚠ BOTH ARMS, ALWAYS — never only the challenger. `gpt-5-4-mini` rejects
    // `max_tokens`, and answering that by giving the two arms different
    // parameters would introduce a second difference into a comparison §9.7
    // Stage 1 requires to differ only by deployment name. `gpt-4.1` accepts
    // `max_completion_tokens` (verified live), so sending it to both keeps the
    // arms identical. Production is untouched: it never sets this option.
    tokenParam: 'max_completion_tokens',
  });
  const vision = new AzureVisionExtractor({ endpoint: visionEndpoint, credential });

  const shaById = {};
  let failures = 0;

  for (const image of images) {
    const bytes = new Uint8Array(readFileSync(join(GOLDEN, 'images', image.file)));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    shaById[image.id] = sha256;

    const ext = extensionOf(image.file);
    const mimeType = MIME_BY_EXT[ext];
    if (!mimeType) throw new Error(`${image.file}: unsupported extension "${ext}".`);

    // ⚠ HEIC IS TRANSCODED FOR THE PROVIDER CALL ONLY. Neither provider
    // accepts HEIC (REQ-077 / ADR-0008), and in production these bytes would
    // have been transcoded at ingest long before stage 1 sees them. The sha256
    // above is of the ORIGINAL committed bytes, on purpose — see the header.
    let sent = bytes;
    let sentMime = mimeType;
    if (mimeType === 'image/heic' || mimeType === 'image/heif') {
      const from = mimeType === 'image/heic' ? 'heic' : 'heif';
      // The pixel guard reads the header before allocating a decode buffer.
      // These fixtures are monitor photographs and decode large; the recorder
      // is not the 0.5 GiB container, so the ceiling is raised for it alone.
      const transcoded = await transcodeHeicToPng(bytes, from, {
        env: { ...process.env, NEXTUP_MAX_DECODE_PIXELS: '50000000' },
      });
      sent = transcoded.bytes;
      sentMime = 'image/png';
    }

    if (args.dryRun) {
      console.log(`· ${image.id.padEnd(30)} sha256=${sha256.slice(0, 12)}… (dry run)`);
      continue;
    }

    try {
      // Sequential, and both legs awaited separately: the container this
      // product ships in has 0.5 GiB and the two `.heic` slots decode large.
      // Recording is not a throughput problem.
      const tiles = await llm.readTiles(sent, sentMime);
      // ⚠ `--skip-ocr` IS A CORRECTNESS FLAG, NOT A SPEED ONE. `ocr/` is
      // deliberately NOT model-scoped, because §9.7 Stage 1 holds the OCR leg
      // identical across arms — it is the constant the comparison is measured
      // against. Re-reading it while recording a challenger would overwrite the
      // incumbent's constant with a fresh read, so any drift in the OCR service
      // would land in the challenger's favour or against it, indistinguishably
      // from a difference in the models. Record OCR once, with the first arm.
      const lines = args.skipOcr ? null : await vision.readLines(sent, sentMime);

      writeJson(join(GOLDEN, 'llm', args.model, `${image.id}.llm.json`), tiles);
      if (lines !== null) writeJson(join(GOLDEN, 'ocr', `${image.id}.ocr.json`), lines);

      console.log(
        `✓ ${image.id.padEnd(30)} tiles=${String(tiles.length).padStart(3)} ` +
          `ocrLines=${lines === null ? ' (kept)' : String(lines.length).padStart(3)} sha256=${sha256.slice(0, 12)}…`,
      );
    } catch (error) {
      failures += 1;
      // ⚠ ONE IMAGE FAILING MUST NOT LOSE THE OTHER TEN RECORDINGS. Each file
      // is written as it is produced, so a mid-run failure leaves every earlier
      // recording on disk and re-running with `--only` completes the set.
      console.error(`✗ ${image.id.padEnd(30)} ${error instanceof Error ? error.message : error}`);
    }
  }

  // The manifest gains `sha256` per image. `goldenRecordingStore` pairs a
  // recording with an image through this value, and its own header states the
  // requirement: the hash must be recorded ALONGSIDE the recording, so that a
  // re-exported image breaks the pairing loudly instead of silently replaying
  // a recording of a different picture.
  //
  // Written even on `--dry-run`: the hash is a pure function of bytes already
  // committed to the repository, so it is never wrong, and a dry run that
  // populated nothing would leave the pairing to the one run that costs money.
  for (const image of manifest.images) {
    if (shaById[image.id] !== undefined) image.sha256 = shaById[image.id];
  }
  writeJson(manifestPath, manifest);

  if (failures > 0) {
    console.error(`\n${failures} image(s) failed. Re-run with --only <id> for each.`);
    process.exitCode = 1;
  }
}

await main();
