import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  allResources,
  budgetPolicyViolations,
  ingressPolicyViolations,
  portViolations,
  rbacPolicyViolations,
  readCommittedArm,
  readCommittedBudgetArm,
  resourceOfType,
  resourcesOfType,
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
    const assignment = resourceOfType(template, 'Microsoft.Authorization/roleAssignments');
    expect(assignment.scope).toContain('Microsoft.Storage/storageAccounts/blobServices/containers');
  });

  it('T-INFRA-001c: catches a grant widened to the whole storage account', () => {
    // The exact silent-privilege-escalation this rule exists to stop: staging
    // would gain read/write on every production screenshot.
    const bad = mutate((t) => {
      resourceOfType(t, 'Microsoft.Authorization/roleAssignments').scope =
        "[resourceId('Microsoft.Storage/storageAccounts', parameters('storageAccountName'))]";
    });
    expect(rbacPolicyViolations(bad).join('\n')).toMatch(/scoped to a blob CONTAINER/);
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
