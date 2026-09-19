#!/usr/bin/env node
/**
 * §9.7 Stage 0 — the disqualifier probe for a candidate primary reader.
 *
 * ⚠ THIS EXISTS BECAUSE THE FIRST STAGE 0 WAS RUN AD HOC AND LEFT NO ARTEFACT.
 * `specs/ai.md` §9.7 and `infra/ai.bicep` both record that `gpt-5.4-mini` was
 * "probed against the real deployment" on 2026-09-08, and that claim is now
 * unreproducible — the script was never committed, so the only evidence is a
 * prose assertion in two files. The same gap produced an unauditable
 * "extraction has degraded" claim that turned out to be a misreading. A gate
 * that cannot be re-run is a gate nobody can check.
 *
 * ⚠ IT DRIVES THE REAL PROMPT, THE REAL SCHEMA AND THE REAL PARAMETERS, NOT AN
 * APPROXIMATION. Stage 0 asks whether a candidate can honour §2.1a's CONTRACT.
 * A hand-rolled `{"type":"json_object"}` probe with a toy prompt would answer a
 * different and easier question, pass a model that cannot do strict Structured
 * Outputs over `TILE_SCHEMA`, and spend a full bake-off before anyone noticed.
 *
 * Usage:
 *   node tools/stage0-probe.mjs <deployment> [<deployment> ...]
 * Requires NEXTUP_AOAI_ENDPOINT and an `az login` identity with
 * `Cognitive Services OpenAI User` on the account.
 *
 * Exit code is 0 when EVERY probed deployment is admissible, 1 otherwise, so
 * this can gate a bake-off run rather than merely inform one.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { DefaultAzureCredential } from '@azure/identity';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_VERSION = '2024-10-21';

/**
 * ⚠ A REAL GOLDEN IMAGE, NOT A SYNTHETIC ONE. "Does it accept vision input"
 * and "does it return usable tiles for a streaming list" are different
 * questions, and a 1x1 pixel answers only the first. `max-saved-mobile-01` is
 * the image §9.7 already used for the first probe, so results stay comparable.
 */
const PROBE_IMAGE = 'max-saved-mobile-01.jpg';

async function loadContract() {
  // ⚠ IMPORTED FROM SOURCE, NEVER COPIED. A copied prompt or schema drifts from
  // production silently, and then Stage 0 certifies something the app no longer
  // sends — the candidate passes a contract nobody is using.
  //
  // ⚠ LOADED THROUGH VITE'S SSR LOADER RATHER THAN BY ADDING `tsx`. `prompts.ts`
  // is TypeScript and node cannot import it; `vite` is already a devDependency,
  // so this costs no new dependency to justify against NFR-004.
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true },
    logLevel: 'error',
  });
  try {
    return await server.ssrLoadModule('/apps/api/src/extraction/prompts.ts');
  } finally {
    await server.close();
  }
}

async function probeOnce(endpoint, deployment, token, body) {
  const url =
    `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}` +
    `/chat/completions?api-version=${API_VERSION}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { ok: res.ok, status: res.status, json, text };
}

/**
 * Reads the provider's rejection reason.
 *
 * ⚠ A 400 IS NOT AUTOMATICALLY A DISQUALIFICATION, which is the subtlety that
 * makes Stage 0 worth scripting. `gpt-5.4-mini` rejects `max_tokens` with
 * `unsupported_parameter` naming `max_completion_tokens` as the replacement —
 * a SPELLING difference that §9.7 resolves by sending the accepted spelling to
 * both arms. Treating that as "fails Stage 0" would have disqualified a
 * candidate that was in fact admissible. So the parameter named in the error is
 * extracted and reported, never collapsed to a boolean.
 */
function rejection(res) {
  const err = res.json?.error;
  if (err === undefined)
    return { code: `http-${String(res.status)}`, param: null, message: res.text.slice(0, 200) };
  return {
    code: err.code ?? `http-${String(res.status)}`,
    param: err.param ?? null,
    message: (err.message ?? '').slice(0, 300),
  };
}

async function probeDeployment(endpoint, deployment, token, contract) {
  const { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_PROMPT, TILE_SCHEMA, TILE_SCHEMA_NAME } =
    contract;

  const imagePath = path.join(ROOT, 'tests/fixtures/golden/images', PROBE_IMAGE);
  const bytes = await readFile(imagePath);
  const dataUri = `data:image/jpeg;base64,${bytes.toString('base64')}`;

  const base = {
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: EXTRACTION_USER_PROMPT },
          { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: TILE_SCHEMA_NAME, strict: true, schema: TILE_SCHEMA },
    },
  };

  const result = {
    deployment,
    vision: false,
    strictStructuredOutputs: false,
    temperature: false,
    seed: false,
    tokenParam: null,
    tiles: null,
    notes: [],
  };

  // ── Probe 1: the FULL production contract, `max_tokens` spelling. ─────────
  let res = await probeOnce(endpoint, deployment, token, {
    ...base,
    temperature: 0,
    top_p: 1,
    seed: 1729,
    max_tokens: 4096,
  });

  // ── Probe 2: the `max_completion_tokens` spelling, only if 1 was rejected
  // for that parameter. Ordered this way so a model that accepts the
  // production spelling is never recorded as needing the promotion cost §9.7
  // says to count.
  if (!res.ok) {
    const r = rejection(res);
    if (r.param === 'max_tokens' || /max_tokens/.test(r.message)) {
      result.notes.push(`rejects max_tokens (${r.code}) — retrying max_completion_tokens`);
      res = await probeOnce(endpoint, deployment, token, {
        ...base,
        temperature: 0,
        top_p: 1,
        seed: 1729,
        max_completion_tokens: 4096,
      });
      if (res.ok) result.tokenParam = 'max_completion_tokens';
    }
  } else {
    result.tokenParam = 'max_tokens';
  }

  // ── Probe 3: isolate temperature/seed. A model may reject EITHER; §9.7
  // disqualifies on both, so they are distinguished rather than lumped.
  if (!res.ok) {
    const r = rejection(res);
    result.notes.push(`${r.code}${r.param ? ` on '${r.param}'` : ''}: ${r.message}`);
    const drop = { ...base, max_completion_tokens: 4096 };
    const noTemp = await probeOnce(endpoint, deployment, token, { ...drop, seed: 1729 });
    const noSeed = await probeOnce(endpoint, deployment, token, { ...drop, temperature: 0 });
    result.temperature = !noSeed.ok ? false : true;
    result.seed = !noTemp.ok ? false : true;
    if (noTemp.ok || noSeed.ok) {
      result.vision = true;
      result.strictStructuredOutputs = true;
      result.tokenParam ??= 'max_completion_tokens';
    }
    // Neither reduced form worked either — report the original reason.
    if (!noTemp.ok && !noSeed.ok) {
      result.notes.push(`also fails without temperature and without seed`);
    }
    return result;
  }

  // Full contract accepted: every Stage 0 gate is discharged at once, because
  // the request that succeeded CARRIED all of them.
  result.vision = true;
  result.strictStructuredOutputs = true;
  result.temperature = true;
  result.seed = true;

  const content = res.json?.choices?.[0]?.message?.content;
  const finish = res.json?.choices?.[0]?.finish_reason ?? null;
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      const tiles = parsed?.tiles;
      result.tiles = Array.isArray(tiles) ? tiles.length : null;
    } catch {
      // A model can accept `strict: true` and still return unparseable content
      // if it truncated. Distinguish the two — one is a contract failure, the
      // other is a token ceiling.
      result.notes.push(`content did not parse; finish_reason=${String(finish)}`);
      result.strictStructuredOutputs = finish !== 'length';
    }
  }
  if (finish === 'length') result.notes.push('finish_reason=length — truncated at 4096');
  const usage = res.json?.usage;
  if (usage !== undefined) {
    result.notes.push(
      `tokens in/out ${String(usage.prompt_tokens)}/${String(usage.completion_tokens)}`,
    );
  }
  return result;
}

function admissible(r) {
  return r.vision && r.strictStructuredOutputs && r.temperature && r.seed && r.tokenParam !== null;
}

async function main() {
  const deployments = process.argv.slice(2);
  if (deployments.length === 0) {
    console.error('usage: node tools/stage0-probe.mjs <deployment> [<deployment> ...]');
    process.exit(2);
  }
  const endpoint = process.env['NEXTUP_AOAI_ENDPOINT'];
  if (endpoint === undefined || endpoint.trim() === '') {
    console.error('NEXTUP_AOAI_ENDPOINT is required.');
    process.exit(2);
  }

  const credential = new DefaultAzureCredential();
  const { token } = await credential.getToken('https://cognitiveservices.azure.com/.default');
  const contract = await loadContract();

  const results = [];
  for (const deployment of deployments) {
    process.stderr.write(`probing ${deployment} ...\n`);
    try {
      results.push(await probeDeployment(endpoint, deployment, token, contract));
    } catch (error) {
      results.push({
        deployment,
        vision: false,
        strictStructuredOutputs: false,
        temperature: false,
        seed: false,
        tokenParam: null,
        tiles: null,
        notes: [`threw: ${String(error)}`],
      });
    }
  }

  const tick = (b) => (b ? 'yes' : 'NO');
  console.log('');
  console.log(
    '| Deployment | Vision | Strict SO | temperature:0 | seed | Token param | Tiles | Admissible |',
  );
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(
      `| \`${r.deployment}\` | ${tick(r.vision)} | ${tick(r.strictStructuredOutputs)} | ` +
        `${tick(r.temperature)} | ${tick(r.seed)} | ${r.tokenParam ?? '—'} | ` +
        `${r.tiles ?? '—'} | ${admissible(r) ? '**YES**' : '**NO**'} |`,
    );
  }
  console.log('');
  for (const r of results) {
    for (const n of r.notes) console.log(`- \`${r.deployment}\`: ${n}`);
  }

  process.exit(results.every(admissible) ? 0 : 1);
}

await main();
