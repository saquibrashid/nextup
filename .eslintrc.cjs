/* eslint-disable */
// Baseline ESLint config (CommonJS). TASK-002 adds the custom test-ID naming
// rule (tools/eslint-rules/test-id-naming.js, T-META-004). Kept minimal here so
// it is correct on a clean clone without pre-empting later tasks.
module.exports = {
  root: true,
  env: { es2022: true, node: true, browser: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  ignorePatterns: ['dist/', 'build/', 'coverage/', 'node_modules/', '*.d.ts'],
  rules: {},
};
