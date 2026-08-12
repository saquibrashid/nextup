/**
 * eslint-plugin-nextup — in-repo ESLint plugin.
 *
 * Exists so the T-META-004 rule can be referenced from `eslint.config.cjs` as
 * `nextup/test-id-naming` without adding a third-party plugin-loader
 * dependency (NFR-004: keep the dependency set small and mainstream).
 * npm workspaces symlink this package into node_modules, so ESLint resolves
 * it exactly like a published plugin.
 *
 * The rule implementations live in `tools/eslint-rules/` per TASK-002.
 */

'use strict';

module.exports = {
  rules: {
    'test-id-naming': require('../eslint-rules/test-id-naming.js'),
  },
};
