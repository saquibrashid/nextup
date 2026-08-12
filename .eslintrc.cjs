/* eslint-disable */
// Baseline ESLint config (CommonJS).
//
// TASK-002 added the T-META-004 test-ID naming rule
// (tools/eslint-rules/test-id-naming.js), surfaced through the in-repo plugin
// at tools/eslint-plugin-nextup so no third-party plugin loader is needed.
module.exports = {
  root: true,
  env: { es2022: true, node: true, browser: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  ignorePatterns: [
    'dist/',
    'build/',
    'coverage/',
    'node_modules/',
    '*.d.ts',
    'playwright-report/',
    'test-results/',
  ],
  rules: {},
  overrides: [
    {
      // T-META-004 applies to every test file in the suite, wherever it lives
      // (specs/testing.md §11 puts unit tests inside the workspaces and the
      // cross-cutting suites under tests/).
      files: [
        'packages/*/test/**/*.{ts,tsx}',
        'apps/*/test/**/*.{ts,tsx}',
        'tests/**/*.{ts,tsx}',
        'tools/**/*.spec.{ts,tsx}',
      ],
      plugins: ['nextup'],
      rules: {
        'nextup/test-id-naming': 'error',
      },
    },
    {
      // ESLint loads plugins and shareable config through CommonJS, so these
      // files have to use `require()` — there is no ESM entry point to import.
      // typescript-eslint v8 turned `no-require-imports` on for plain .js/.cjs
      // as well (v7 only flagged it in TypeScript), which made the repo's own
      // lint plugin unlintable. Scoped to the CJS tooling files so the ban
      // still holds everywhere it is a real finding.
      files: ['tools/eslint-plugin-nextup/**/*.js', 'tools/eslint-rules/**/*.js', '*.cjs'],
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
      },
    },
  ],
};
