/**
 * TASK-062 — `T-AI-012`, the STRUCTURAL half of Rule A (`specs/ai.md` §4.4,
 * RSK-022, NFR-016, threat T16 in `specs/security.md`).
 *
 * The rule: matching is **deterministic** — jaro-winkler, no ML — and no TMDB
 * content ever reaches an AI service. `eslint.config.cjs` forbids every
 * inference SDK from the matching path and from the TMDB client.
 *
 * ⚠ THIS FILE LINTS SYNTHETIC SOURCE, IT DOES NOT GREP THE CONFIG. A test that
 * asserted the config *contains* `no-restricted-imports` would pass while the
 * rule was scoped to a path that no longer exists, or shadowed by a later
 * config object, or silently dropped by a flat-config ordering change — all
 * three of which are the realistic ways this protection dies. Running ESLint
 * over a file that violates the rule, at a real path, is the only form that
 * fails when the rule stops working.
 *
 * ⚠ AND IT ASSERTS THE NEGATIVE TOO. `specs/ai.md` §4.4 records that the rule
 * once lived in `.eslintrc.cjs`, which ESLint 10 ignores entirely — so a rule
 * can be perfectly written and never applied. A rule that fired on EVERYTHING
 * would be just as broken in the other direction, and would be switched off
 * within a week; `T-AI-012c` pins that the deterministic matcher's own
 * imports still lint clean.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const MATCHING_DIR = join(REPO_ROOT, 'packages/domain/src/matching');

/**
 * ⚠ ONE INSTANCE, REUSED. Constructing `ESLint` re-reads and re-resolves the
 * whole flat config, which takes seconds; a fresh instance per case pushed
 * every one of these past the 5 s default timeout on the first run.
 */
let shared: Promise<import('eslint').ESLint> | undefined;
function eslint(): Promise<import('eslint').ESLint> {
  shared ??= import('eslint').then(({ ESLint }) => new ESLint({ cwd: REPO_ROOT }));
  return shared;
}

/**
 * Lints SOURCE TEXT under a path inside a protected directory. The file never
 * has to exist — the rule is scoped by path, and `lintText`'s `filePath` is
 * what the config matcher sees, so nothing is written to the tree and there is
 * nothing to clean up if a case throws.
 */
async function lint(relativePath: string, source: string): Promise<string[]> {
  const [result] = await (
    await eslint()
  ).lintText(source, { filePath: join(REPO_ROOT, relativePath) });
  return (result?.messages ?? []).map((m) => `${String(m.ruleId)}: ${m.message}`);
}

/** Lints a file that really exists, through the same shared instance. */
async function lintFile(absolutePath: string): Promise<string[]> {
  const results = await (await eslint()).lintFiles([absolutePath]);
  return (results[0]?.messages ?? []).map((m) => `${String(m.ruleId)}: ${m.message}`);
}

/**
 * ⚠ EXPLICIT TIMEOUT, NOT THE 5 s DEFAULT. Resolving the flat config is
 * seconds of real work even once, and these cases share a machine with the
 * rest of the infra project; a default-timeout failure here reads as "Rule A
 * is broken" when it only means the box was busy.
 */
const LINT_TIMEOUT_MS = 60_000;

afterAll(() => {
  shared = undefined;
});

describe('T-AI-012 · RSK-022 · no AI SDK is importable from the matching path', () => {
  it(
    'T-AI-012a: importing an inference SDK from the matcher is an ESLint error',
    async () => {
      const messages = await lint(
        'packages/domain/src/matching/__ruleA_probe_sdk.ts',
        "import OpenAI from 'openai';\nexport const probe = OpenAI;\n",
      );
      expect(messages.join('\n')).toContain('no-restricted-imports');
      expect(messages.join('\n')).toContain('Rule A');
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'T-AI-012b: every inference SDK the repo could plausibly install is caught',
    async () => {
      // A one-package rule is a rule that a `npm i @azure/openai` walks around
      // without noticing. Each of these is a realistic install name for the same
      // violation.
      const sdks = [
        '@azure/openai',
        '@azure-rest/ai-vision-image-analysis',
        '@azure/ai-form-recognizer',
        '@anthropic-ai/sdk',
        '@google/generative-ai',
        'langchain',
        '@langchain/core',
        'ollama',
        'replicate',
        '@huggingface/inference',
      ];
      for (const sdk of sdks) {
        const messages = await lint(
          `packages/domain/src/matching/__ruleA_probe_${sdk.replace(/[^a-z]/gi, '_')}.ts`,
          `import x from '${sdk}';\nexport const probe = x;\n`,
        );
        expect(`${sdk} :: ${messages.join('\n')}`).toContain('no-restricted-imports');
      }
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'T-AI-012c: the deterministic matcher itself lints CLEAN',
    async () => {
      // The negative half. `tmdbMatcher.ts` imports `../extraction/jaroWinkler.js`
      // — the PURE domain string arithmetic, which shares only a name with the
      // API app's SDK-calling extraction layer. A rule broad enough to catch
      // that would break the very matcher it protects.
      const messages = await lintFile(join(MATCHING_DIR, 'tmdbMatcher.ts'));
      expect(messages).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'T-AI-012d: the TMDB client is covered too, not just the matcher',
    async () => {
      // The matcher is the obvious path. The TMDB client is the one that HOLDS
      // TMDB content, so an inference import there is the more direct violation
      // of RSK-022 — and it lives in the API app, where the SDKs are already
      // installed and resolvable. Linted as TEXT under the real file's path,
      // because the rule is scoped to that exact filename.
      const messages = await lint(
        'apps/api/src/clients/tmdbClient.ts',
        "import OpenAI from 'openai';\nexport const probe = OpenAI;\n",
      );
      expect(messages.map((m) => m.split(':')[0])).toContain('no-restricted-imports');
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'T-AI-012e: an ordinary domain import is still allowed',
    async () => {
      // The rule must be a scalpel. If `import { normaliseTitleText } from
      // '../identity.js'` started failing, the rule would be deleted rather
      // than fixed.
      const messages = await lint(
        'packages/domain/src/matching/__ruleA_probe_ok.ts',
        "import { jaroWinkler } from '../extraction/jaroWinkler.js';\nexport const probe = jaroWinkler;\n",
      );
      expect(messages.filter((m) => m.startsWith('no-restricted-imports'))).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );
});
