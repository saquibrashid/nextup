// tools/check-infra.mjs — compile infra/main.bicep to ARM and gate on drift.
//
// TASK-006. Deliberately NO shebang: a `#!` line makes this file unimportable
// by Vitest (`SyntaxError: Invalid or unexpected token`), which is how the
// status gate lost its teeth once already. Invoke it with `node`.
//
// WHY A COMMITTED ARTIFACT AT ALL
// The infra tests assert against the COMPILED ARM, not against the Bicep
// source text, because the compiled ARM is what actually deploys — a regex
// over .bicep would pass happily while the emitted template said something
// else. Compiling inside the test would make every infra test depend on the
// Bicep CLI being installed. So the compiled template is committed, and this
// gate makes a stale artifact impossible.
//
// WHY NORMALISED, NOT BYTE-FOR-BYTE
// Bicep stamps `metadata._generator` with its own version and a templateHash.
// A byte comparison would therefore fail whenever CI's Bicep differs from the
// author's — a false failure whose only obvious "fix" is to weaken the gate.
// `_generator` is stripped recursively and the comparison is a deep structural
// one, so real changes are still caught exactly.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BICEP_FILE = join(ROOT, 'infra', 'main.bicep');
export const ARM_FILE = join(ROOT, 'infra', 'main.json');

/**
 * Recursively remove Bicep's `_generator` stamp (version + templateHash) so a
 * comparison reflects the template's MEANING, not the compiler build.
 */
export function stripGenerator(node) {
  if (Array.isArray(node)) return node.map(stripGenerator);
  if (node === null || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'metadata' && value && typeof value === 'object' && '_generator' in value) {
      const rest = Object.fromEntries(
        Object.entries(value).filter(([metaKey]) => metaKey !== '_generator'),
      );
      if (Object.keys(rest).length > 0) out[key] = stripGenerator(rest);
      continue;
    }
    out[key] = stripGenerator(value);
  }
  return out;
}

/** Compile infra/main.bicep and return the normalised ARM template. */
export function compileArm() {
  const dir = mkdtempSync(join(tmpdir(), 'nextup-infra-'));
  const outfile = join(dir, 'main.json');
  try {
    execFileSync('az', ['bicep', 'build', '--file', BICEP_FILE, '--outfile', outfile], {
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
    return stripGenerator(JSON.parse(readFileSync(outfile, 'utf8')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Read the committed ARM template. */
export function readCommittedArm() {
  return stripGenerator(JSON.parse(readFileSync(ARM_FILE, 'utf8')));
}

export function renderArm(template) {
  return `${JSON.stringify(template, null, 2)}\n`;
}

/**
 * Walk every resource in the template, descending into the nested deployments
 * that Bicep emits for modules. Without this, a module's contents are
 * invisible and an assertion over `template.resources` silently checks
 * nothing — the whole storage account lives inside a nested deployment.
 */
export function allResources(template) {
  const found = [];
  const visit = (tpl) => {
    const resources = tpl?.resources;
    const list = Array.isArray(resources) ? resources : Object.values(resources ?? {});
    for (const resource of list) {
      found.push(resource);
      const nested = resource?.properties?.template;
      if (nested) visit(nested);
    }
  };
  visit(template);
  return found;
}

/** Find exactly one resource of a type; throws if absent or ambiguous. */
export function resourceOfType(template, type) {
  const matches = allResources(template).filter((r) => r.type === type);
  if (matches.length !== 1) {
    throw new Error(`expected exactly 1 resource of type ${type}, found ${matches.length}`);
  }
  return matches[0];
}

export function resourcesOfType(template, type) {
  return allResources(template).filter((r) => r.type === type);
}

/**
 * T-INFRA-002 — the storage trap.
 *
 * Blob soft delete, container soft delete, versioning and point-in-time
 * restore must all be DISABLED. Enabling any of them looks like good practice,
 * costs pennies, and would silently retain the owner's screenshots past 30
 * days WHILE EVERY OTHER TEST STILL PASSES — the lifecycle rule would appear
 * to delete the blob, but a soft-deleted or versioned blob is recoverable and
 * therefore still retained. That breaks NFR-019 invisibly. This is the
 * tripwire.
 */
export function storagePolicyViolations(template) {
  const violations = [];
  const account = resourceOfType(template, 'Microsoft.Storage/storageAccounts');
  const props = account.properties ?? {};

  if (props.allowBlobPublicAccess !== false) {
    violations.push('storage: allowBlobPublicAccess must be false');
  }
  if (props.allowSharedKeyAccess !== false) {
    violations.push('storage: allowSharedKeyAccess must be false (managed identity only)');
  }
  if (props.minimumTlsVersion !== 'TLS1_2') {
    violations.push('storage: minimumTlsVersion must be TLS1_2');
  }
  if (props.supportsHttpsTrafficOnly !== true) {
    violations.push('storage: supportsHttpsTrafficOnly must be true');
  }

  const blob = resourceOfType(template, 'Microsoft.Storage/storageAccounts/blobServices');
  const bp = blob.properties ?? {};
  const mustBeOff = [
    ['deleteRetentionPolicy', bp.deleteRetentionPolicy?.enabled],
    ['containerDeleteRetentionPolicy', bp.containerDeleteRetentionPolicy?.enabled],
    ['changeFeed', bp.changeFeed?.enabled],
    ['restorePolicy', bp.restorePolicy?.enabled],
  ];
  for (const [name, enabled] of mustBeOff) {
    if (enabled !== false) {
      violations.push(`storage: ${name}.enabled must be explicitly false (retains past 30 days)`);
    }
  }
  if (bp.isVersioningEnabled !== false) {
    violations.push('storage: isVersioningEnabled must be explicitly false (retains past 30 days)');
  }

  for (const container of resourcesOfType(
    template,
    'Microsoft.Storage/storageAccounts/blobServices/containers',
  )) {
    if (container.properties?.publicAccess !== 'None') {
      violations.push(`storage: container ${container.name} must have publicAccess None`);
    }
  }

  return violations;
}

/**
 * T-INFRA-003 — ingress must refuse plaintext.
 *
 * HTTPS here is a FUNCTIONAL dependency, not merely a security one:
 * navigator.clipboard is absent on http://, so over plaintext the paste ingest
 * affordance (REQ-001/REQ-004) simply would not exist.
 */
export function ingressPolicyViolations(template) {
  const violations = [];
  for (const app of resourcesOfType(template, 'Microsoft.App/containerApps')) {
    const ingress = app.properties?.configuration?.ingress;
    if (!ingress) {
      violations.push(`aca: ${app.name} has no ingress block`);
      continue;
    }
    if (ingress.allowInsecure !== false) {
      violations.push(`aca: ${app.name} must set allowInsecure false`);
    }
  }
  return violations;
}

/**
 * T-INFRA-001 — least-privilege RBAC.
 *
 * The blob grant must be scoped to a single CONTAINER. An account-scoped grant
 * would silently hand the staging identity read/write access to every
 * production screenshot, which is precisely what the spec forbids.
 */
export function rbacPolicyViolations(template) {
  const violations = [];
  const assignments = resourcesOfType(template, 'Microsoft.Authorization/roleAssignments');
  if (assignments.length === 0) {
    violations.push('rbac: no role assignment found');
  }
  for (const assignment of assignments) {
    const scope = assignment.scope ?? '';
    if (!scope.includes('Microsoft.Storage/storageAccounts/blobServices/containers')) {
      violations.push(
        `rbac: grant must be scoped to a blob CONTAINER, not the account (scope: ${scope})`,
      );
    }
    if (assignment.properties?.principalType !== 'ServicePrincipal') {
      violations.push('rbac: principalType must be ServicePrincipal');
    }
  }
  return violations;
}

function main() {
  const check = process.argv.includes('--check');
  const compiled = compileArm();
  const rendered = renderArm(compiled);

  if (!check) {
    writeFileSync(ARM_FILE, rendered);
    console.log(`wrote infra/main.json (${allResources(compiled).length} resources)`);
    return;
  }

  let committed;
  try {
    committed = renderArm(readCommittedArm());
  } catch (error) {
    console.error(`infra/main.json is missing or unreadable: ${error.message}`);
    console.error('Run `npm run infra:build` and commit the result.');
    process.exit(1);
  }

  if (committed !== rendered) {
    console.error('infra/main.json is STALE — it does not match infra/main.bicep.');
    console.error('Run `npm run infra:build` and commit the result.');
    process.exit(1);
  }
  console.log('infra/main.json is up to date.');
}

if (process.argv[1] && process.argv[1].endsWith('check-infra.mjs')) main();
