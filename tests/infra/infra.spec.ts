import { describe, expect, it } from 'vitest';

import {
  allResources,
  ingressPolicyViolations,
  rbacPolicyViolations,
  readCommittedArm,
  resourceOfType,
  resourcesOfType,
  storagePolicyViolations,
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
