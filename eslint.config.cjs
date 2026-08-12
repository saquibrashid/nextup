// ESLint flat configuration.
//
// ESLint 10 removed `.eslintrc.*` support entirely, so this file replaces the
// former `.eslintrc.cjs`. The migration is behaviour-preserving: the same
// rule sets, the same two overrides, and the same ignore list, expressed in
// flat form.
//
// Flat config resolves plugins through normal module resolution rather than by
// name-guessing, so the in-repo plugin at `tools/eslint-plugin-nextup` is now
// imported directly instead of being discovered via the npm-workspace symlink.
//
// This file is CommonJS (`.cjs`) on purpose: the root `package.json` has no
// `"type": "module"`, and the in-repo plugin it loads is CommonJS.

'use strict';

const js = require('@eslint/js');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettier = require('eslint-config-prettier');
const globals = require('globals');

const nextup = require('./tools/eslint-plugin-nextup/index.js');

/**
 * T-META-004 applies to every test file in the suite, wherever it lives
 * (specs/testing.md §11 puts unit tests inside the workspaces and the
 * cross-cutting suites under tests/).
 */
const TEST_FILES = [
  'packages/*/test/**/*.{ts,tsx}',
  'apps/*/test/**/*.{ts,tsx}',
  'tests/**/*.{ts,tsx}',
  'tools/**/*.spec.{ts,tsx}',
];

module.exports = [
  {
    // Flat config has no `ignorePatterns`; a config object with only `ignores`
    // is the global ignore list.
    ignores: [
      'dist/',
      'build/',
      'coverage/',
      'node_modules/',
      '**/dist/**',
      // The local-development build output (`apps/api/tsconfig.dev.json`).
      // It is compiled JavaScript, so linting it reports on generated code —
      // and it must NOT share `dist`, because that directory boundary is what
      // keeps the dev principal shim out of the production build (`T-SEC-019`).
      '**/dist-dev/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.d.ts',
      'playwright-report/',
      'test-results/',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.{js,cjs,mjs,ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.es2022,
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
    },
  },

  {
    // typescript-eslint's own guidance: ESLint's core `no-undef` and
    // `no-redeclare` must be OFF in TypeScript, because they only model the
    // VALUE namespace. A type-only import (`import type { JSX } from 'react'`)
    // is invisible to them, so `no-undef` reports every type the compiler
    // resolves perfectly well, and `no-redeclare` treats a type that shares a
    // name with a global as a duplicate declaration. Both are false positives
    // by construction, and both are already covered properly — and with the
    // real type graph — by `tsc --build`, which CI runs as its own job.
    //
    // Scoped to TypeScript so the rules keep working in the plain .js/.cjs
    // tooling files, where they are genuine findings.
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-undef': 'off',
      'no-redeclare': 'off',
    },
  },

  {
    files: TEST_FILES,
    plugins: { nextup },
    rules: {
      'nextup/test-id-naming': 'error',
    },
  },

  {
    // ESLint loads plugins and shareable config through CommonJS, so these
    // files have to use `require()` — there is no ESM entry point to import.
    // typescript-eslint v8 turned `no-require-imports` on for plain .js/.cjs
    // as well (v7 only flagged it in TypeScript), which made the repo's own
    // lint plugin unlintable. Scoped to the CJS tooling files so the ban still
    // holds everywhere it is a real finding.
    files: ['tools/eslint-plugin-nextup/**/*.js', 'tools/eslint-rules/**/*.js', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.commonjs },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  {
    // `no-console` is not in eslint:recommended, so the `eslint-disable-next-line
    // no-console` in apps/api/src/index.ts was suppressing a rule that had never
    // been switched on — silently useless, and only visible because ESLint 10
    // reports unused directives by default. Turn the rule on for shipped source
    // so the directive means what its author intended and a stray debugging
    // `console.log` cannot reach production.
    //
    // `console.error` in the error middleware is deliberate and stays: it is the
    // only place a 5xx's full detail is recorded under its correlation id, which
    // is what makes redacting the client-facing message safe. Errors and
    // warnings are therefore allowed; `console.log` is not.
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },

  // Must stay LAST: it switches off the stylistic rules that would otherwise
  // fight Prettier. Anything appended after this would resurrect them.
  prettier,
];
