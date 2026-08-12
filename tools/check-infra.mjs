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

/**
 * The ONLY permitted (cpu, memory, NEXTUP_MAX_DECODE_PIXELS) combinations.
 *
 * REQ-079 / A43 / invariant 14: these are one setting in three places. Raising
 * the guard without the memory removes the only thing stopping a large image
 * killing the container; raising the memory without the guard buys ~$4/month
 * of nothing. A half-applied up-size is strictly worse than none.
 */
export const ALLOWED_COMPUTE_PAIRS = [
  { cpu: '0.25', memory: '0.5Gi', pixels: '25000000' },
  { cpu: '0.5', memory: '1.0Gi', pixels: '50000000' },
];

export const COUPLING_MESSAGE =
  'compute size and NEXTUP_MAX_DECODE_PIXELS must move together — see docs/runbooks/scale-up-memory.md';

/** `[json('0.25')]` in compiled ARM, or a bare number/string elsewhere. */
export function normaliseCpu(value) {
  if (typeof value === 'number') return String(value);
  const match = /json\('([^']+)'\)/.exec(String(value));
  return match ? match[1] : String(value);
}

/**
 * T-INFRA-005 — SKU pinning AND the compute/decode-guard coupling.
 *
 * A failing assertion here is a FEATURE: it is what forces the reactive
 * up-size (A43) to be taken completely rather than half-applied.
 */
export function skuViolations(template) {
  const violations = [];

  for (const app of resourcesOfType(template, 'Microsoft.App/containerApps')) {
    const container = app.properties?.template?.containers?.[0];
    if (!container) {
      violations.push(`aca: ${app.name} declares no container`);
      continue;
    }
    const cpu = normaliseCpu(container.resources?.cpu);
    const memory = String(container.resources?.memory);
    const pixels = String(
      (container.env ?? []).find((e) => e.name === 'NEXTUP_MAX_DECODE_PIXELS')?.value,
    );

    const matched = ALLOWED_COMPUTE_PAIRS.some(
      (pair) => pair.cpu === cpu && pair.memory === memory && pair.pixels === pixels,
    );
    if (!matched) {
      violations.push(`${COUPLING_MESSAGE} (found cpu=${cpu}, memory=${memory}, pixels=${pixels})`);
    }
  }

  // Azure SQL: Basic for prod, serverless GP_S for staging. Never Standard,
  // never zone-redundant, never a failover group.
  for (const db of resourcesOfType(template, 'Microsoft.Sql/servers/databases')) {
    const sku = db.sku ?? {};
    const isBasic = sku.name === 'Basic' && sku.tier === 'Basic';
    const isServerless = String(sku.name).startsWith('GP_S_');
    if (!isBasic && !isServerless) {
      violations.push(
        `sql: unpinned SKU ${sku.name}/${sku.tier} — expected Basic or GP_S_ serverless`,
      );
    }
    if (db.properties?.zoneRedundant !== false) {
      violations.push(`sql: ${db.name} must not be zone-redundant`);
    }
  }

  // The registry is ghcr.io. An Azure Container Registry of ANY tier is a
  // design change, not an optimisation (ADR-0003 Rev 3).
  const registries = resourcesOfType(template, 'Microsoft.ContainerRegistry/registries');
  if (registries.length > 0) {
    violations.push('registry: no Azure Container Registry may exist — the registry is ghcr.io');
  }
  for (const app of resourcesOfType(template, 'Microsoft.App/containerApps')) {
    for (const registry of app.properties?.configuration?.registries ?? []) {
      if (registry.server !== 'ghcr.io') {
        violations.push(`registry: expected ghcr.io, found ${registry.server}`);
      }
    }
  }

  // Always warm in prod, scale-to-zero in staging, and NO scale rule.
  for (const app of resourcesOfType(template, 'Microsoft.App/containerApps')) {
    const scale = app.properties?.template?.scale ?? {};
    if (scale.rules && scale.rules.length > 0) {
      violations.push(`aca: ${app.name} must declare no scale rule`);
    }
  }

  return violations;
}

/**
 * T-INV-013 — soft delete is FOREVER.
 *
 * The ABSENCE of any expiry mechanism IS the requirement (REQ-028), so this
 * asserts a negative. Azure SQL Agent jobs and Elastic Jobs are prohibited
 * outright, as is any TTL-shaped property.
 */
export const PROHIBITED_TYPES = [
  'Microsoft.Sql/servers/jobAgents',
  'Microsoft.Sql/servers/jobAgents/jobs',
  'Microsoft.Scheduler/jobCollections',
  'Microsoft.Logic/workflows',
  'Microsoft.Automation/automationAccounts',
];

export const PROHIBITED_PROPERTY_KEYS = [
  'defaultTtl',
  'ttl',
  'timeToLive',
  'timeToLiveInSeconds',
  'expirationPolicy',
  'retentionPolicy',
];

export function ttlViolations(template) {
  const violations = [];

  for (const resource of allResources(template)) {
    if (PROHIBITED_TYPES.includes(resource.type)) {
      violations.push(
        `prohibited resource type: ${resource.type} (REQ-028 — no scheduled deletion)`,
      );
    }
  }

  // A TTL could hide at any depth, so walk the whole tree rather than only the
  // properties we happen to know about. The blob lifecycle purge is the ONE
  // sanctioned expiry and is matched by type, not by key name.
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (PROHIBITED_PROPERTY_KEYS.includes(key)) {
        violations.push(
          `TTL-shaped property "${key}" at ${path} (REQ-028 — soft delete is forever)`,
        );
      }
      walk(value, `${path}.${key}`);
    }
  };

  for (const resource of allResources(template)) {
    if (resource.type === 'Microsoft.Storage/storageAccounts/managementPolicies') continue;
    walk(resource.properties, resource.type);
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
