import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { IMAGE_DECODE_BEGIN, IMAGE_DECODE_END } from '@nextup/domain';

import {
  allResources,
  alertPolicyViolations,
  ALERTS_ARM_FILE,
  ALERT_RUNBOOK_PATH,
  budgetPolicyViolations,
  ingressPolicyViolations,
  lifecyclePolicyViolations,
  IMAGE_RETENTION_DAYS,
  portViolations,
  rbacPolicyViolations,
  readCommittedArm,
  readCommittedBudgetArm,
  resourceOfType,
  resourcesOfType,
  roleDefinitionIdsInUse,
  skuViolations,
  storagePolicyViolations,
  ttlViolations,
  PROHIBITED_TYPES,
  stripGenerator,
} from '../../tools/check-infra.mjs';

// T-INFRA-001 / T-INFRA-002 / T-INFRA-003 (TASK-006, specs/security.md §496,
// specs/testing.md §11-R4).
//
// These assert against the COMPILED ARM (infra/main.json), not the Bicep
// source text, because the compiled template is what actually deploys — a
// regex over .bicep could pass while the emitted template said something else.
// `npm run check:infra` gates the committed artifact against staleness.
//
// Observing that the current template is clean proves little on its own, so
// every rule below is ALSO fed a deliberately mutated template and asserted to
// be CAUGHT. A gate that cannot fail is decoration.

const template = readCommittedArm();

/** Deep clone so a mutation cannot leak into another test. */
function mutate(fn) {
  const clone = structuredClone(template);
  fn(clone);
  return clone;
}

function storageAccount(t) {
  return resourceOfType(t, 'Microsoft.Storage/storageAccounts');
}

function blobService(t) {
  return resourceOfType(t, 'Microsoft.Storage/storageAccounts/blobServices');
}

describe('T-INFRA-002 storage retention trap', () => {
  it('T-INFRA-002a: the committed template has no storage policy violation', () => {
    const violations = storagePolicyViolations(template);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('T-INFRA-002b: the storage account is private, key-less and TLS 1.2', () => {
    const props = storageAccount(template).properties;
    expect(props.allowBlobPublicAccess).toBe(false);
    expect(props.allowSharedKeyAccess).toBe(false);
    expect(props.minimumTlsVersion).toBe('TLS1_2');
    expect(props.supportsHttpsTrafficOnly).toBe(true);
  });

  it('T-INFRA-002c: catches allowBlobPublicAccess being turned on', () => {
    const bad = mutate((t) => {
      storageAccount(t).properties.allowBlobPublicAccess = true;
    });
    expect(storagePolicyViolations(bad)).toContain('storage: allowBlobPublicAccess must be false');
  });

  it('T-INFRA-002d: catches allowSharedKeyAccess being turned on', () => {
    const bad = mutate((t) => {
      storageAccount(t).properties.allowSharedKeyAccess = true;
    });
    expect(storagePolicyViolations(bad)).toContain(
      'storage: allowSharedKeyAccess must be false (managed identity only)',
    );
  });

  // The four traps. Each of these looks like good practice and would retain
  // screenshots past 30 days while every other test still passed.
  it('T-INFRA-002e: catches blob soft delete being enabled', () => {
    const bad = mutate((t) => {
      blobService(t).properties.deleteRetentionPolicy = { enabled: true, days: 7 };
    });
    expect(storagePolicyViolations(bad)).toContain(
      'storage: deleteRetentionPolicy.enabled must be explicitly false (retains past 30 days)',
    );
  });

  it('T-INFRA-002f: catches container soft delete being enabled', () => {
    const bad = mutate((t) => {
      blobService(t).properties.containerDeleteRetentionPolicy = { enabled: true, days: 7 };
    });
    expect(storagePolicyViolations(bad)).toContain(
      'storage: containerDeleteRetentionPolicy.enabled must be explicitly false (retains past 30 days)',
    );
  });

  it('T-INFRA-002g: catches versioning being enabled', () => {
    const bad = mutate((t) => {
      blobService(t).properties.isVersioningEnabled = true;
    });
    expect(storagePolicyViolations(bad)).toContain(
      'storage: isVersioningEnabled must be explicitly false (retains past 30 days)',
    );
  });

  it('T-INFRA-002h: catches point-in-time restore being enabled', () => {
    const bad = mutate((t) => {
      blobService(t).properties.restorePolicy = { enabled: true, days: 6 };
    });
    expect(storagePolicyViolations(bad)).toContain(
      'storage: restorePolicy.enabled must be explicitly false (retains past 30 days)',
    );
  });

  // Omission must fail as loudly as an explicit `true`. A property that is
  // simply absent inherits the service default, which for versioning and soft
  // delete is exactly the retention we are trying to prevent.
  it('T-INFRA-002i: catches a retention property being DELETED rather than set false', () => {
    const bad = mutate((t) => {
      delete blobService(t).properties.isVersioningEnabled;
    });
    expect(storagePolicyViolations(bad)).toContain(
      'storage: isVersioningEnabled must be explicitly false (retains past 30 days)',
    );
  });

  it('T-INFRA-002j: every blob container is private', () => {
    const containers = resourcesOfType(
      template,
      'Microsoft.Storage/storageAccounts/blobServices/containers',
    );
    expect(containers.length).toBeGreaterThan(0);
    for (const container of containers) {
      expect(container.properties.publicAccess).toBe('None');
    }
  });

  it('T-INFRA-002k: catches a container being made public', () => {
    const bad = mutate((t) => {
      resourcesOfType(
        t,
        'Microsoft.Storage/storageAccounts/blobServices/containers',
      )[0].properties.publicAccess = 'Blob';
    });
    expect(storagePolicyViolations(bad).join('\n')).toMatch(/publicAccess None/);
  });
});

describe('T-INFRA-004 the 30-day blob-lifecycle purge (US-035, NFR-019)', () => {
  // ⚠ THIS RULE IS THE ONLY THING IN THE ENTIRE SYSTEM THAT DELETES A
  // SCREENSHOT. No application code participates (US-035 AC-3): the API stops
  // SERVING at `retainUntil`, which `T-IMG-004` asserts, but the bytes go away
  // because of this and nothing else. That makes both failure directions
  // invisible everywhere else — a missing or misfiltered rule retains the
  // owner's screenshots forever while every 410 test still passes, and a
  // smaller day count destroys uploads the owner may not have reviewed yet.
  //
  // Pairs with `T-INFRA-002`, which asserts soft delete, versioning and PITR
  // are OFF: a perfectly correct rule PLUS soft delete still retains the bytes
  // past 30 days, so neither half is sufficient alone.

  function lifecycleRule(t) {
    return resourceOfType(t, 'Microsoft.Storage/storageAccounts/managementPolicies').properties
      .policy.rules[0];
  }

  it('T-INFRA-004a: the committed template has no lifecycle violation', () => {
    const violations = lifecyclePolicyViolations(template);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('T-INFRA-004b: exactly one enabled rule deletes block blobs at 30 days', () => {
    const rule = lifecycleRule(template);
    expect(rule.enabled).toBe(true);
    expect(rule.type).toBe('Lifecycle');
    expect(rule.definition.filters.blobTypes).toContain('blockBlob');
    expect(rule.definition.actions.baseBlob.delete.daysAfterModificationGreaterThan).toBe(
      IMAGE_RETENTION_DAYS,
    );
    // Asserted positively rather than "is a number": a defaulted or absent day
    // count reads as a passing rule and purges nothing.
    expect(IMAGE_RETENTION_DAYS).toBe(30);
  });

  it('T-INFRA-004c: the rule covers BOTH screenshot containers and nothing else', () => {
    // Both are declared unconditionally, so a rule that named only
    // `screenshots/` would retain every staging capture forever — and staging
    // holds the owner's real screenshots during any trial of a change.
    const prefixes = lifecycleRule(template).definition.filters.prefixMatch;
    expect([...prefixes].sort()).toEqual(['screenshots-staging/', 'screenshots/']);
  });

  it('T-INFRA-004d: catches the rule being disabled', () => {
    const bad = mutate((t) => {
      lifecycleRule(t).enabled = false;
    });
    expect(lifecyclePolicyViolations(bad).join('\n')).toMatch(/must be enabled/);
  });

  it('T-INFRA-004e: catches the rule being removed entirely', () => {
    // ⚠ Removed by walking NESTED module templates, not by filtering
    // `t.resources`. Storage is deployed through a module, so the top-level
    // filter removes nothing and the mutant survives reporting no violations —
    // which is exactly how this assertion first passed vacuously.
    const bad = mutate((t) => {
      const visit = (tpl) => {
        if (Array.isArray(tpl?.resources)) {
          tpl.resources = tpl.resources.filter(
            (r) => r.type !== 'Microsoft.Storage/storageAccounts/managementPolicies',
          );
          for (const r of tpl.resources) if (r?.properties?.template) visit(r.properties.template);
        }
      };
      visit(t);
    });
    expect(lifecyclePolicyViolations(bad).join('\n')).toMatch(/exactly one managementPolicies/);
  });

  it('T-INFRA-004f: catches the retention window being changed in EITHER direction', () => {
    // Both directions matter and they fail differently. 365 quietly breaks the
    // privacy commitment; 7 destroys screenshots the owner has not reviewed,
    // and REQ-028 makes that unrecoverable.
    for (const days of [7, 365]) {
      const bad = mutate((t) => {
        lifecycleRule(t).definition.actions.baseBlob.delete.daysAfterModificationGreaterThan = days;
      });
      expect(lifecyclePolicyViolations(bad).join('\n')).toMatch(/daysAfterModificationGreaterThan/);
    }
  });

  it('T-INFRA-004g: catches a container being dropped from prefixMatch', () => {
    const bad = mutate((t) => {
      lifecycleRule(t).definition.filters.prefixMatch = ['screenshots/'];
    });
    expect(lifecyclePolicyViolations(bad).join('\n')).toMatch(/screenshots-staging\//);
  });

  it('T-INFRA-004h: catches delete being swapped for a TIERING action', () => {
    // The mutation that would pass review: it costs less, the rule stays
    // "enabled", and the screenshots are retained indefinitely in cool
    // storage. NFR-019 is a privacy commitment, not a storage-cost decision.
    const bad = mutate((t) => {
      lifecycleRule(t).definition.actions.baseBlob = {
        tierToCool: { daysAfterModificationGreaterThan: 30 },
      };
    });
    const violations = lifecyclePolicyViolations(bad).join('\n');
    expect(violations).toMatch(/tierToCool/);
    expect(violations).toMatch(/retains the bytes/);
  });

  it('T-INFRA-004i: catches a second rule being added', () => {
    const bad = mutate((t) => {
      const rules = resourceOfType(t, 'Microsoft.Storage/storageAccounts/managementPolicies')
        .properties.policy.rules;
      rules.push(structuredClone(rules[0]));
    });
    expect(lifecyclePolicyViolations(bad).join('\n')).toMatch(/exactly one rule/);
  });

  it('T-INFRA-004j: catches the filter being widened past the screenshot containers', () => {
    // An empty or absent prefixMatch matches EVERY blob in the account.
    const bad = mutate((t) => {
      lifecycleRule(t).definition.filters.prefixMatch = [
        'screenshots/',
        'screenshots-staging/',
        '',
      ];
    });
    expect(lifecyclePolicyViolations(bad).join('\n')).toMatch(/only the screenshot containers/);
  });
});

describe('T-INFRA-003 ingress refuses plaintext', () => {
  it('T-INFRA-003a: the committed template has no ingress violation', () => {
    expect(ingressPolicyViolations(template)).toEqual([]);
  });

  it('T-INFRA-003b: allowInsecure is false', () => {
    const app = resourceOfType(template, 'Microsoft.App/containerApps');
    expect(app.properties.configuration.ingress.allowInsecure).toBe(false);
  });

  it('T-INFRA-003c: catches allowInsecure being turned on', () => {
    const bad = mutate((t) => {
      resourceOfType(
        t,
        'Microsoft.App/containerApps',
      ).properties.configuration.ingress.allowInsecure = true;
    });
    expect(ingressPolicyViolations(bad).join('\n')).toMatch(/allowInsecure false/);
  });
});

describe('T-INFRA-001 least-privilege RBAC', () => {
  it('T-INFRA-001a: the committed template has no RBAC violation', () => {
    expect(rbacPolicyViolations(template)).toEqual([]);
  });

  it('T-INFRA-001b: the blob grant is scoped to a container, not the account', () => {
    const assignments = resourcesOfType(template, 'Microsoft.Authorization/roleAssignments');
    const blob = assignments.filter((a) =>
      String(a.scope ?? '').includes('Microsoft.Storage/storageAccounts/blobServices/containers'),
    );
    expect(blob).toHaveLength(1);
    expect(blob[0].scope).toContain('Microsoft.Storage/storageAccounts/blobServices/containers');
  });

  it('T-INFRA-001c: catches a grant widened to the whole storage account', () => {
    // The exact silent-privilege-escalation this rule exists to stop: staging
    // would gain read/write on every production screenshot.
    const bad = mutate((t) => {
      for (const a of resourcesOfType(t, 'Microsoft.Authorization/roleAssignments')) {
        if (String(a.scope ?? '').includes('blobServices/containers')) {
          a.scope =
            "[resourceId('Microsoft.Storage/storageAccounts', parameters('storageAccountName'))]";
        }
      }
    });
    expect(rbacPolicyViolations(bad).join('\n')).toMatch(/scoped to a blob CONTAINER/);
  });

  it('T-INFRA-001e: the Cognitive Services grants are account-scoped and inference-only', () => {
    const assignments = resourcesOfType(template, 'Microsoft.Authorization/roleAssignments');
    const cognitive = assignments.filter((a) =>
      String(a.scope ?? '').includes('Microsoft.CognitiveServices/accounts'),
    );
    // One for Azure OpenAI, one for Azure AI Vision.
    expect(cognitive).toHaveLength(2);
    // Cognitive Services OpenAI User, Cognitive Services User, Storage Blob
    // Data Contributor. NONE is a Contributor/management role, so the app
    // cannot create or delete a model deployment.
    expect([...roleDefinitionIdsInUse(template)].sort()).toEqual([
      '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd',
      'a97b65f3-24c7-4388-baec-2e87135dc908',
      'ba92f5b4-2d11-453d-a403-e96b0029c9fe',
    ]);
  });

  it('T-INFRA-001f: catches an inference grant promoted to a management role', () => {
    // Cognitive Services OpenAI Contributor can create and delete model
    // deployments — enough to swap the pinned model out from under the golden
    // corpus without a commit. It must never appear.
    const bad = mutate((t) => {
      // The guid lives in a template variable, not on the assignment — mutate
      // it where it actually is, or this test passes vacuously.
      for (const [name, value] of Object.entries(t.variables ?? {})) {
        if (value === '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd') {
          t.variables[name] = 'a001fd3d-188f-4b5d-821b-7da978bf7442';
        }
      }
    });
    expect(rbacPolicyViolations(bad).join('\n')).toMatch(/not on the inference\/data-plane/);
  });

  it('T-INFRA-001g: catches a grant escaping to the resource group', () => {
    const bad = mutate((t) => {
      for (const a of resourcesOfType(t, 'Microsoft.Authorization/roleAssignments')) {
        if (String(a.scope ?? '').includes('Microsoft.CognitiveServices/accounts')) {
          a.scope = '[resourceGroup().id]';
        }
      }
    });
    expect(rbacPolicyViolations(bad).join('\n')).toMatch(/not scoped to a supported resource/);
  });

  it('T-INFRA-001d: catches a missing role assignment', () => {
    const bad = mutate((t) => {
      for (const resource of allResources(t)) {
        const nested = resource?.properties?.template;
        if (Array.isArray(nested?.resources)) {
          nested.resources = nested.resources.filter(
            (r) => r.type !== 'Microsoft.Authorization/roleAssignments',
          );
        }
      }
    });
    expect(rbacPolicyViolations(bad)).toContain('rbac: no role assignment found');
  });
});

describe('infra template plumbing', () => {
  // If allResources() failed to descend into the nested deployments Bicep
  // emits for modules, every assertion above would silently check nothing:
  // the storage account, the app and the role assignment all live inside
  // modules. This test is the guard on the guard.
  it('T-INFRA-002l: allResources descends into module deployments', () => {
    const topLevel = Array.isArray(template.resources)
      ? template.resources
      : Object.values(template.resources);
    expect(allResources(template).length).toBeGreaterThan(topLevel.length);
    expect(resourcesOfType(template, 'Microsoft.Storage/storageAccounts')).toHaveLength(1);
    expect(resourcesOfType(template, 'Microsoft.App/containerApps')).toHaveLength(1);
  });

  it('T-INFRA-002m: stripGenerator removes the Bicep version stamp so CI/local skew is not drift', () => {
    const stamped = {
      metadata: { _generator: { name: 'bicep', version: '9.9.9', templateHash: 'abc' } },
      resources: [{ metadata: { _generator: { version: '1' }, other: 'keep' } }],
    };
    const stripped = stripGenerator(stamped);
    expect(stripped.metadata).toBeUndefined();
    expect(stripped.resources[0].metadata).toEqual({ other: 'keep' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-INFRA-009 — the cost guardrail (TASK-142).
//
// The budget is a SEPARATE subscription-scoped template, so it needs its own
// committed artifact and its own mutations. Same discipline as above: showing
// the current template is clean proves nothing, so every rule is fed a
// deliberately broken template and asserted to be caught.
// ─────────────────────────────────────────────────────────────────────────────

const budgetTemplate = readCommittedBudgetArm();

function mutateBudget(fn) {
  const clone = structuredClone(budgetTemplate);
  fn(clone);
  return clone;
}

function budgetResource(t) {
  return resourceOfType(t, 'Microsoft.Consumption/budgets');
}

describe('T-INFRA-009 the budget alerts (TASK-142)', () => {
  it('T-INFRA-009a: the committed budget template has no violation', () => {
    expect(budgetPolicyViolations(budgetTemplate)).toEqual([]);
  });

  it('T-INFRA-009b: both thresholds exist — 1.0x informational and 1.5x action-required', () => {
    const notifications = budgetResource(budgetTemplate).properties.notifications;
    const thresholds = Object.values(notifications)
      .map((n) => n.threshold)
      .sort((a, b) => a - b);
    expect(thresholds).toEqual([100, 150]);
    for (const notification of Object.values(notifications)) {
      expect(notification.enabled).toBe(true);
      expect(notification.thresholdType).toBe('Actual');
    }
  });

  it('T-INFRA-009c: dropping the 1.5x threshold is caught', () => {
    const broken = mutateBudget((t) => {
      delete budgetResource(t).properties.notifications.actionRequired;
    });
    expect(budgetPolicyViolations(broken).join(' ')).toMatch(/expected exactly 2 notifications/);
  });

  it('T-INFRA-009d: a disabled notification is caught', () => {
    const broken = mutateBudget((t) => {
      budgetResource(t).properties.notifications.informational.enabled = false;
    });
    expect(budgetPolicyViolations(broken).join(' ')).toMatch(/must be enabled/);
  });

  // ⚠ THE ONE THAT MATTERS. An action group can run an automation runbook, so
  // wiring one to a billing threshold turns "you have spent $20" into "stop the
  // container app". It deploys fine, it looks responsible, and it would be
  // added by someone being helpful. REQ-028 and TASK-142 both forbid it.
  it('T-INFRA-009e: a notification wired to an action group is caught', () => {
    for (const key of ['actionGroups', 'contactGroups', 'contactRoles', 'webhooks', 'actions']) {
      const broken = mutateBudget((t) => {
        budgetResource(t).properties.notifications.actionRequired[key] = ['/subscriptions/x/ag'];
      });
      expect(budgetPolicyViolations(broken).join(' ')).toMatch(/must NOTIFY, never act/);
    }
  });

  it('T-INFRA-009f: an empty actionable array is NOT reported — absence is the requirement, not noise', () => {
    const benign = mutateBudget((t) => {
      budgetResource(t).properties.notifications.actionRequired.contactGroups = [];
    });
    expect(budgetPolicyViolations(benign)).toEqual([]);
  });

  it('T-INFRA-009g: exactly ONE budget, so 1.0x and 1.5x cannot drift apart', () => {
    // The thresholds are PERCENTAGES of a single amount. A second budget with
    // its own amount would let the pair diverge silently, which is the whole
    // reason this is one resource rather than two.
    expect(resourcesOfType(budgetTemplate, 'Microsoft.Consumption/budgets')).toHaveLength(1);
    const properties = budgetResource(budgetTemplate).properties;
    expect(properties.amount).toBe("[parameters('monthlyTotalUsd')]");
    expect(properties.timeGrain).toBe('Monthly');

    const broken = mutateBudget((t) => {
      t.resources.push(structuredClone(budgetResource(t)));
    });
    expect(budgetPolicyViolations(broken).join(' ')).toMatch(/expected exactly 1 budget/);
  });

  it('T-INFRA-009h: the budget carries no automation resource and no TTL-shaped property', () => {
    expect(ttlViolations(budgetTemplate)).toEqual([]);
    for (const resource of allResources(budgetTemplate)) {
      expect(PROHIBITED_TYPES).not.toContain(resource.type);
    }
  });

  it('T-INFRA-009i: the published total is the parameter default, so the alert tracks the spec', () => {
    // docs/architecture.md §Cost summary publishes ~$11-13/month for Variant A.
    // Anchoring to the TOP of the band is deliberate: a budget set at the
    // optimistic end alerts on ordinary variation, and an alert that cries
    // wolf trains the owner to ignore the one that matters.
    expect(budgetTemplate.parameters.monthlyTotalUsd.defaultValue).toBe(13);
    // No default for the recipient: a budget nobody is told about is not a control.
    expect(budgetTemplate.parameters.ownerEmail.defaultValue).toBeUndefined();
  });
});

describe('T-INFRA-005 the staging auto-pause cost trap (TASK-010, verified 2026-08-17)', () => {
  it('T-INFRA-005t: the serverless staging database declares a positive autoPauseDelay', () => {
    const serverless = resourcesOfType(template, 'Microsoft.Sql/servers/databases').filter((db) =>
      String(db.sku?.name).startsWith('GP_S_'),
    );
    expect(serverless.length).toBeGreaterThan(0);
    for (const db of serverless) {
      expect(db.properties?.autoPauseDelay).toBeGreaterThan(0);
    }
    expect(skuViolations(template)).toEqual([]);
  });

  // The mutation is a ONE-LINE deletion that deploys cleanly, serves staging
  // perfectly, and costs ~$190/month — 16x the whole system. Verified rate:
  // $0.521758/vCore-hour at the 0.5-vCore serverless minimum.
  it('T-INFRA-005u: deleting autoPauseDelay is caught', () => {
    const broken = mutate((t) => {
      for (const db of resourcesOfType(t, 'Microsoft.Sql/servers/databases')) {
        if (String(db.sku?.name).startsWith('GP_S_')) delete db.properties.autoPauseDelay;
      }
    });
    expect(skuViolations(broken).join(' ')).toMatch(/must declare a positive autoPauseDelay/);
  });

  it('T-INFRA-005v: a zero or negative autoPauseDelay is caught, not just an absent one', () => {
    for (const bad of [0, -1]) {
      const broken = mutate((t) => {
        for (const db of resourcesOfType(t, 'Microsoft.Sql/servers/databases')) {
          if (String(db.sku?.name).startsWith('GP_S_')) db.properties.autoPauseDelay = bad;
        }
      });
      expect(skuViolations(broken).join(' ')).toMatch(/positive autoPauseDelay/);
    }
  });

  it('T-INFRA-005w: the rule does not fire on the Basic prod database, which cannot pause', () => {
    // Basic is a flat daily rate with no auto-pause concept. A rule that
    // demanded autoPauseDelay everywhere would be unsatisfiable for prod and
    // would be "fixed" by deleting the rule.
    const basic = resourcesOfType(template, 'Microsoft.Sql/servers/databases').filter(
      (db) => db.sku?.name === 'Basic',
    );
    expect(basic.length).toBeGreaterThan(0);
    for (const db of basic) {
      expect(db.properties?.autoPauseDelay).toBeUndefined();
    }
    expect(skuViolations(template)).toEqual([]);
  });
});

// T-INFRA-010 — the ingress port and the container's listening port.
//
// This rule exists because the mismatch it catches ALREADY SHIPPED, and every
// signal that should have caught it said the deployment was fine: bicep built,
// validate passed, `az deployment group create` reported Succeeded, the
// revision provisioned, and the container logged `listening on :3000`. The
// only evidence was `startup probe failed: connection refused` in the system
// log, and a smoke suite that timed out against an app answering nothing.
describe('T-INFRA-010 the ingress port matches the port the container listens on', () => {
  const dockerfile = readFileSync(path.join(import.meta.dirname, '../..', 'Dockerfile'), 'utf8');

  it('T-INFRA-010a: the committed template and the real Dockerfile agree', () => {
    expect(portViolations(template, dockerfile)).toEqual([]);
  });

  it('T-INFRA-010b: a targetPort that no process listens on is caught', () => {
    // The exact defect: 8080 against a container bound to 3000.
    const broken = mutate((t) => {
      for (const app of resourcesOfType(t, 'Microsoft.App/containerApps')) {
        app.properties.configuration.ingress.targetPort = 8080;
      }
    });
    expect(portViolations(broken, dockerfile).join(' ')).toMatch(
      /does not match the container's PORT/,
    );
  });

  it('T-INFRA-010c: a missing targetPort is caught, not treated as agreement', () => {
    const broken = mutate((t) => {
      for (const app of resourcesOfType(t, 'Microsoft.App/containerApps')) {
        delete app.properties.configuration.ingress.targetPort;
      }
    });
    expect(portViolations(broken, dockerfile).join(' ')).toMatch(/no targetPort/);
  });

  it('T-INFRA-010d: moving the Dockerfile port instead of the template is caught', () => {
    // The rule has to bind BOTH directions. One that only ever read the
    // template would be satisfied by editing the Dockerfile alone, which is
    // the more likely half of the pair to be changed.
    const moved = dockerfile.replace(/^ENV PORT=\d+$/m, 'ENV PORT=4000');
    expect(moved).not.toBe(dockerfile);
    expect(portViolations(template, moved).join(' ')).toMatch(
      /does not match the container's PORT/,
    );
  });

  it('T-INFRA-010e: a Dockerfile that disagrees with itself is caught', () => {
    // EXPOSE is documentation ACA ignores; ENV PORT is what the app reads. If
    // they differ, the Dockerfile has no single answer to "which port?".
    const inconsistent = dockerfile.replace(/^EXPOSE \d+$/m, 'EXPOSE 8080');
    expect(inconsistent).not.toBe(dockerfile);
    expect(portViolations(template, inconsistent).join(' ')).toMatch(/disagrees with EXPOSE/);
  });

  it('T-INFRA-010f: an undeclared port is caught rather than defaulting', () => {
    // Deleting `ENV PORT` makes the app fall back to its own default, which
    // may still happen to work — so the absence must fail loudly instead of
    // the rule silently having nothing to compare against.
    const undeclared = dockerfile.replace(/^ENV PORT=\d+$/m, '');
    expect(portViolations(template, undeclared).join(' ')).toMatch(/listening port is undeclared/);
  });
});

// The traffic/revision configuration. Both of these were absent on the first
// production deployment, and neither absence produced a failing signal: the
// template built, validated and deployed, and the app ran.
describe('T-INFRA-011 the container app can actually hold traffic', () => {
  const aca = readFileSync(path.join(import.meta.dirname, '../..', 'infra/aca.bicep'), 'utf8');

  it('T-INFRA-011a: revision mode is Multiple', () => {
    // Single mode — which is the DEFAULT, so this is what you get by writing
    // nothing at all — permits exactly one revision with a weight. Every
    // blue/green step in deploy.yml then fails with "configured for single
    // revision", but only the last one, after the smoke suite has passed.
    expect(aca).toMatch(/activeRevisionsMode:\s*'Multiple'/);
  });

  it('T-INFRA-011b: traffic is pinned to the held revision when one is named', () => {
    // An unconditional `latestRevision: true` makes ARM promote the new
    // revision to 100% as part of the deployment itself — before
    // `prisma migrate deploy` has run — so the hold, the smoke suite and the
    // shift all operate on a revision that is already live. The template still
    // deploys cleanly, which is why this is asserted rather than reviewed.
    expect(aca).toMatch(/param holdRevisionName string = ''/);
    expect(aca).toMatch(/traffic: empty\(holdRevisionName\)/);
    expect(aca).toMatch(/revisionName: holdRevisionName/);
  });

  it('T-INFRA-011c: the bootstrap branch still routes traffic somewhere', () => {
    // The mirror of 011b. A conditional that pins to a named revision but
    // leaves the empty case with no weighted entry produces an app with no
    // reachable revision on a first deploy — and there is no previous
    // revision to fall back to, so it fails closed and unrecoverably.
    const bootstrap = /empty\(holdRevisionName\)\s*\?([\s\S]*?):\s*\[/.exec(aca)?.[1] ?? '';
    expect(bootstrap).toMatch(/latestRevision: true/);
    expect(bootstrap).toMatch(/weight: 100/);
  });
});

// ── T-INFRA-012 (TASK-157, `A43-M5`) ────────────────────────────────────────
//
// The owner chose 0.25 vCPU / 0.5 GiB on the EXPLICIT basis that an OOM would
// be observed and answered by up-sizing (`A43` / `OQ-028`). These rules are
// what make that trigger real, so their absence is not missing hardening — it
// silently converts a reactive strategy into no strategy.
//
// Every failure below DEPLOYS SUCCESSFULLY. That is why they are asserted
// against the compiled ARM and why each one is also fed a mutated template:
// a gate that cannot fail is decoration.
describe('T-INFRA-012 the memory-observability alerts (TASK-157)', () => {
  const alerts = readCommittedArm(ALERTS_ARM_FILE);

  /** Deep clone so a mutation cannot leak into another case. */
  function mutateAlerts(fn) {
    const clone = structuredClone(alerts);
    fn(clone);
    return clone;
  }

  function actionGroup(t) {
    return resourceOfType(t, 'Microsoft.Insights/actionGroups');
  }

  it('T-INFRA-012a: the committed alert template is clean', () => {
    expect(alertPolicyViolations(alerts, [IMAGE_DECODE_BEGIN, IMAGE_DECODE_END])).toEqual([]);
  });

  it('T-INFRA-012b: the decode-abandoned log-search rule exists and is the primary signal', () => {
    const rules = resourcesOfType(alerts, 'Microsoft.Insights/scheduledQueryRules');
    expect(rules).toHaveLength(1);
    // ⚠ Azure Container Apps publishes NO OOM-distinct metric at all
    // (`specs/testing.md` §31.6, verified read-only against the deployed
    // staging app). The sentinel is therefore the only signal that names WHICH
    // image died, which is why this rule is severity 1 and the metric rules
    // are not.
    expect(rules[0].properties.severity).toBe(1);
    expect(rules[0].properties.enabled).toBe(true);
    // A rule that mitigates itself closes the incident the owner has not read.
    expect(rules[0].properties.autoMitigate).toBe(false);
  });

  it('T-INFRA-012c: both metric backstops exist, and neither alone would suffice', () => {
    const metrics = resourcesOfType(alerts, 'Microsoft.Insights/metricAlerts');
    expect(metrics).toHaveLength(2);
    const names = metrics.map((rule) => rule.properties.criteria.allOf[0].metricName).sort();
    // `RestartCount` sees the KERNEL kill (P2) and never the catchable WASM
    // RangeError (P1) — the likelier of the two, which leaves the container
    // running. `WorkingSetBytes` is the only one that can fire BEFORE either.
    expect(names).toEqual(['RestartCount', 'WorkingSetBytes']);

    const restart = metrics.find(
      (rule) => rule.properties.criteria.allOf[0].metricName === 'RestartCount',
    );
    // ⚠ `Maximum`, NOT `Total`, and that is a deliberate correction to the
    // TASK-157 backlog row. §31.6 found `RestartCount` is a RUNNING PER-POD
    // COUNTER whose primary aggregation is Maximum; a Total-over-window rule
    // sums a rising series and fires on a healthy app, forever.
    expect(restart.properties.criteria.allOf[0].timeAggregation).toBe('Maximum');
  });

  it('T-INFRA-012d: an actionable receiver is refused', () => {
    // THE DANGEROUS ONE. An action group can invoke an automation runbook, so
    // wiring one here turns "memory is high" into "stop the container app". It
    // deploys cleanly, it looks responsible, and it would be added by someone
    // being helpful. REQ-028 says nothing acts on the owner's behalf.
    const mutated = mutateAlerts((t) => {
      actionGroup(t).properties.automationRunbookReceivers = [
        { name: 'restart', runbookName: 'RestartApp', isGlobalRunbook: false },
      ];
    });
    expect(alertPolicyViolations(mutated, []).join('\n')).toMatch(/automationRunbookReceivers/);
  });

  it('T-INFRA-012e: an UNKNOWN receiver collection is refused, not tolerated', () => {
    // The allow-list is explicit rather than "anything that is not email", so
    // a receiver type Azure adds later shows up as unclassified instead of
    // arriving as a permitted default.
    const mutated = mutateAlerts((t) => {
      actionGroup(t).properties.futureThingReceivers = [{ name: 'x' }];
    });
    expect(alertPolicyViolations(mutated, []).join('\n')).toMatch(/unknown receiver/);
  });

  it('T-INFRA-012f: every notification names the runbook', () => {
    for (const rule of [
      ...resourcesOfType(alerts, 'Microsoft.Insights/scheduledQueryRules'),
      ...resourcesOfType(alerts, 'Microsoft.Insights/metricAlerts'),
    ]) {
      // ⚠ A LITERAL, not an ARM `format()` over a variable. Interpolating a
      // Bicep variable compiles the path out of the artifact, and then this
      // assertion can no longer prove that the email the OWNER receives names
      // the remedy — which is the only thing it is here to prove.
      expect(rule.properties.description).toContain(ALERT_RUNBOOK_PATH);
    }

    const mutated = mutateAlerts((t) => {
      resourcesOfType(t, 'Microsoft.Insights/metricAlerts')[0].properties.description =
        'Memory is high.';
    });
    expect(alertPolicyViolations(mutated, []).join('\n')).toMatch(/does not point at/);
  });

  it('T-INFRA-012g: renaming a decode event breaks the gate, not just the alert', () => {
    // ⚠ THE QUIET FAILURE. Rename the constant in the domain, leave the KQL
    // alone: the app still logs, the rule still runs, the deployment is still
    // clean, and the query simply never matches again. Nothing else in the
    // suite would notice, which is the entire reason the literals are compared
    // against the constants the APPLICATION exports.
    expect(JSON.stringify(alerts)).toContain(IMAGE_DECODE_BEGIN);
    expect(JSON.stringify(alerts)).toContain(IMAGE_DECODE_END);
    expect(alertPolicyViolations(alerts, ['image.decode.started']).join('\n')).toMatch(
      /silently disables/,
    );
  });

  it('T-INFRA-012h: an uninterpolated ${...} cannot survive into the query', () => {
    // A Bicep multi-line string is VERBATIM: `'''...${x}...'''` keeps the
    // braces, compiles clean, validates clean, deploys clean — and watches
    // nothing. This shipped once during TASK-157 and produced no signal at all
    // beyond three unused-variable warnings.
    expect(JSON.stringify(alerts)).not.toMatch(/\$\{[A-Za-z]/);

    const mutated = mutateAlerts((t) => {
      t.variables.decodeAbandonedQueryTemplate = "| where App == '${containerAppName}'";
    });
    expect(alertPolicyViolations(mutated, []).join('\n')).toMatch(/uninterpolated/);
  });

  it('T-INFRA-012i: a missing rule is caught, and no automation resource is present', () => {
    expect(ttlViolations(alerts)).toEqual([]);

    const mutated = mutateAlerts((t) => {
      t.resources = t.resources.filter(
        (resource) => resource.type !== 'Microsoft.Insights/scheduledQueryRules',
      );
    });
    expect(alertPolicyViolations(mutated, []).join('\n')).toMatch(/decode-abandoned/);
  });
});
