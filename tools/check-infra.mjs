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
export const BUDGET_BICEP_FILE = join(ROOT, 'infra', 'budget.bicep');
export const BUDGET_ARM_FILE = join(ROOT, 'infra', 'budget.json');

/**
 * Every Bicep template with a committed ARM artifact.
 *
 * The budget is SEPARATE rather than a module of main.bicep because it is
 * subscription-scoped, and Bicep cannot deploy upward from a resource group.
 * It therefore needs its own compile + drift pair; folding it into the single
 * `main` pair above would leave it ungated, which is how an untested template
 * ends up deployed by hand.
 */
export const TEMPLATES = [
  { name: 'main', bicep: BICEP_FILE, arm: ARM_FILE },
  { name: 'budget', bicep: BUDGET_BICEP_FILE, arm: BUDGET_ARM_FILE },
];

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

/** Compile a Bicep file and return the normalised ARM template. */
export function compileArm(bicepFile = BICEP_FILE) {
  const dir = mkdtempSync(join(tmpdir(), 'nextup-infra-'));
  const outfile = join(dir, 'out.json');
  try {
    execFileSync('az', ['bicep', 'build', '--file', bicepFile, '--outfile', outfile], {
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
    return stripGenerator(JSON.parse(readFileSync(outfile, 'utf8')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Read a committed ARM template. */
export function readCommittedArm(armFile = ARM_FILE) {
  return stripGenerator(JSON.parse(readFileSync(armFile, 'utf8')));
}

/** Read the committed budget template (TASK-142). */
export function readCommittedBudgetArm() {
  return readCommittedArm(BUDGET_ARM_FILE);
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

    // ⚠ AUTO-PAUSE IS THE ENTIRE STAGING COST MODEL (TASK-010, 2026-08-17).
    //
    // Verified list price: GP_S Gen5 compute is $0.521758 per vCore-hour, so at
    // the 0.5-vCore serverless minimum a staging database that never pauses
    // costs ~$190/month — SIXTEEN TIMES the entire published system total of
    // $11.77. The ~$0.50/month figure in architecture.md is not a list price;
    // it is an assumption that the database is paused almost all of the time.
    //
    // Deleting `autoPauseDelay` deploys cleanly, passes every other test, and
    // serves staging perfectly well. The only symptom is the bill. This is the
    // single most expensive one-line change anyone can make to this repo.
    if (isServerless) {
      const delay = db.properties?.autoPauseDelay;
      if (typeof delay !== 'number' || delay <= 0) {
        violations.push(
          `sql: serverless ${db.name} must declare a positive autoPauseDelay — ` +
            'without it staging never pauses and costs ~$190/month instead of ~$0.50 ' +
            '(verified 2026-08-17, ADR-0005 addendum)',
        );
      }
    }
    if (db.properties?.zoneRedundant !== false) {
      violations.push(`sql: ${db.name} must not be zone-redundant`);
    }
  }

  // The registry is ghcr.io and the package is PUBLIC, so no credential exists
  // (TASK-146 / R8). A `registries` entry fails CLOSED — once one is present
  // ACA stops attempting the anonymous pull, so a wrong or expired secret
  // breaks every revision. An Azure Container Registry of ANY tier is a design
  // change, not an optimisation (ADR-0003 Rev 3).
  const registries = resourcesOfType(template, 'Microsoft.ContainerRegistry/registries');
  if (registries.length > 0) {
    violations.push('registry: no Azure Container Registry may exist — the registry is ghcr.io');
  }
  for (const app of resourcesOfType(template, 'Microsoft.App/containerApps')) {
    const configured = app.properties?.configuration?.registries ?? [];
    if (configured.length > 0) {
      violations.push(
        'registry: no registry credential may be configured — the ghcr.io package is public ' +
          'and a registries entry fails closed (see docs/ghcr-pat.md)',
      );
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
 * T-INFRA-008 — Easy Auth is configured, and configured CLOSED (TASK-027).
 *
 * ADR-0002's whole argument is that the safest authentication is the
 * authentication nobody writes. That only holds if the configuration is
 * right, and every failure mode below deploys successfully and looks fine:
 *
 *   - `platform.enabled: false`      — the app serves everything anonymously.
 *   - `unauthenticatedClientAction: 'AllowAnonymous'` — likewise.
 *   - a name other than `current`    — Easy Auth reads one config per app and
 *                                      ignores the rest, without complaint.
 *   - an `excludedPaths` entry       — an auth BYPASS by path prefix,
 *                                      evaluated before any application code,
 *                                      so every app-level test still passes.
 *   - a literal client secret        — a credential in the repository.
 *
 * None of these is observable from the application, which is exactly why they
 * are asserted against the compiled ARM.
 */
export function authPolicyViolations(template) {
  const violations = [];
  const configs = resourcesOfType(template, 'Microsoft.App/containerApps/authConfigs');

  if (configs.length === 0) {
    violations.push('auth: no authConfig — the app would serve anonymously (ADR-0002)');
    return violations;
  }

  for (const config of configs) {
    // ARM emits the child name as an expression:
    // `[format('{0}/{1}', parameters('containerAppName'), 'current')]`.
    // Splitting on `/` is not safe (the format string contains one), so match
    // the QUOTED literal — `'currentish'` compiles to `'currentish'` and does
    // not match, which a substring test on `current` would wave through.
    const name = String(config.name);
    if (!/'current'/.test(name) && name !== 'current') {
      violations.push(`auth: authConfig must be named "current", not ${config.name}`);
    }

    const props = config.properties ?? {};
    if (props.platform?.enabled !== true) {
      violations.push('auth: platform.enabled must be true');
    }

    const global = props.globalValidation ?? {};
    if (global.unauthenticatedClientAction !== 'RedirectToLoginPage') {
      violations.push(
        `auth: unauthenticatedClientAction must be RedirectToLoginPage (found ${global.unauthenticatedClientAction})`,
      );
    }
    if ((global.excludedPaths ?? []).length > 0) {
      violations.push(
        `auth: excludedPaths is an authentication bypass by path prefix — none may exist (found ${JSON.stringify(global.excludedPaths)})`,
      );
    }

    const aad = props.identityProviders?.azureActiveDirectory;
    if (!aad || aad.enabled !== true) {
      violations.push('auth: the azureActiveDirectory provider must be enabled (ADR-0002)');
      continue;
    }

    const registration = aad.registration ?? {};
    if (!registration.clientSecretSettingName) {
      violations.push('auth: registration must reference a secret by name');
    }
    // The secret must be a REFERENCE, never a value. A compiled template
    // carries `[parameters('entraClientSecret')]` here; a literal would be a
    // credential committed to the repository.
    if (registration.clientSecret !== undefined) {
      violations.push('auth: registration.clientSecret must never be set — use a secret reference');
    }
    if (!String(registration.openIdIssuer ?? '').includes('login.microsoftonline.com')) {
      violations.push(
        `auth: openIdIssuer must be a Microsoft identity platform issuer (found ${registration.openIdIssuer})`,
      );
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

/**
 * T-INFRA-009 — the cost guardrail exists, and it only ever SENDS EMAIL.
 *
 * TASK-142. Two independent failure modes, both of which deploy successfully:
 *
 *   - a budget with one threshold, or a disabled one, looks configured in the
 *     portal while silently monitoring nothing above it;
 *   - a notification wired to an ACTION GROUP turns a cost alert into an
 *     actuator. Action groups can run automation runbooks, and an automated
 *     response to a billing threshold could stop the container app or delete a
 *     resource. REQ-028 says deletion is never automatic, and TASK-142 says in
 *     terms: "Do not add auto-shutdown or any automated remediation".
 *
 * The second is the dangerous one, because it would be added by someone being
 * helpful, and nothing else in the suite would notice.
 */
export const BUDGET_ACTIONABLE_KEYS = [
  'actionGroups',
  'contactGroups',
  'contactRoles',
  'webhooks',
  'actions',
];

export function budgetPolicyViolations(template) {
  const violations = [];
  const budgets = resourcesOfType(template, 'Microsoft.Consumption/budgets');

  if (budgets.length !== 1) {
    violations.push(`budget: expected exactly 1 budget, found ${budgets.length}`);
    return violations;
  }

  const props = budgets[0].properties ?? {};
  if (props.category !== 'Cost') {
    violations.push(`budget: category must be Cost (found ${props.category})`);
  }
  if (props.timeGrain !== 'Monthly') {
    violations.push(`budget: timeGrain must be Monthly (found ${props.timeGrain})`);
  }

  const notifications = props.notifications ?? {};
  const entries = Object.entries(notifications);
  if (entries.length !== 2) {
    violations.push(
      `budget: expected exactly 2 notifications (1.0x informational, 1.5x action-required), found ${entries.length}`,
    );
  }

  const thresholds = new Set();
  for (const [name, notification] of entries) {
    if (notification?.enabled !== true) {
      violations.push(`budget: notification ${name} must be enabled`);
    }
    if ((notification?.contactEmails ?? []).length === 0) {
      violations.push(`budget: notification ${name} must email someone`);
    }
    for (const key of BUDGET_ACTIONABLE_KEYS) {
      const value = notification?.[key];
      if (value !== undefined && !(Array.isArray(value) && value.length === 0)) {
        violations.push(
          `budget: notification ${name} declares "${key}" — a cost alert must NOTIFY, never act ` +
            '(TASK-142: no auto-shutdown, no automated remediation)',
        );
      }
    }
    thresholds.add(Number(notification?.threshold));
  }

  // 100 = the published monthly total, 150 = 1.5x it. Percentages of ONE
  // amount, so the pair cannot drift apart.
  for (const required of [100, 150]) {
    if (!thresholds.has(required)) {
      violations.push(
        `budget: missing the ${required}% threshold (found ${[...thresholds].join(', ')})`,
      );
    }
  }

  for (const resource of allResources(template)) {
    if (PROHIBITED_TYPES.includes(resource.type)) {
      violations.push(`budget: prohibited automation resource ${resource.type}`);
    }
  }

  return violations;
}

function main() {
  const check = process.argv.includes('--check');
  let failed = false;

  for (const { name, bicep, arm } of TEMPLATES) {
    const compiled = compileArm(bicep);
    const rendered = renderArm(compiled);

    if (!check) {
      writeFileSync(arm, rendered);
      console.log(`wrote infra/${name}.json (${allResources(compiled).length} resources)`);
      continue;
    }

    let committed;
    try {
      committed = renderArm(readCommittedArm(arm));
    } catch (error) {
      console.error(`infra/${name}.json is missing or unreadable: ${error.message}`);
      console.error('Run `npm run infra:build` and commit the result.');
      failed = true;
      continue;
    }

    if (committed !== rendered) {
      console.error(`infra/${name}.json is STALE — it does not match infra/${name}.bicep.`);
      console.error('Run `npm run infra:build` and commit the result.');
      failed = true;
      continue;
    }
    console.log(`infra/${name}.json is up to date.`);
  }

  if (failed) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('check-infra.mjs')) main();
