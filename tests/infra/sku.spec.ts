import { describe, expect, it } from 'vitest';

import {
  ALLOWED_COMPUTE_PAIRS,
  COUPLING_MESSAGE,
  normaliseCpu,
  readCommittedArm,
  resourceOfType,
  resourcesOfType,
  skuViolations,
} from '../../tools/check-infra.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// T-INFRA-005 — SKU pinning AND the compute/decode-guard PAIR (TASK-008,
// A43/R5, specs/testing.md §9 US-039 AC-4).
//
// TASK-008 OWNS THE COUPLING. `cpu`, `memory` and NEXTUP_MAX_DECODE_PIXELS are
// one setting in three places: raising the guard without the memory removes
// the only thing stopping a large image killing the container, and raising the
// memory without the guard buys ~$4/month of nothing. A failing assertion here
// is a FEATURE — it forces the reactive up-size to be taken completely rather
// than half-applied.

const template = readCommittedArm();
const acaSource = readFileSync(join(process.cwd(), 'infra', 'aca.bicep'), 'utf8');

function mutate(fn) {
  const clone = structuredClone(template);
  fn(clone);
  return clone;
}

function containerOf(t) {
  return resourceOfType(t, 'Microsoft.App/containerApps').properties.template.containers[0];
}

function setPixels(container, value) {
  container.env.find((e) => e.name === 'NEXTUP_MAX_DECODE_PIXELS').value = value;
}

describe('T-INFRA-005 SKU pinning and the compute/guard pair', () => {
  it('T-INFRA-005a: the committed template has no SKU or coupling violation', () => {
    const violations = skuViolations(template);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('T-INFRA-005b: the deployed pair is 0.25 vCPU / 0.5 GiB / 25000000', () => {
    const container = containerOf(template);
    expect(normaliseCpu(container.resources.cpu)).toBe('0.25');
    expect(container.resources.memory).toBe('0.5Gi');
    expect(container.env.find((e) => e.name === 'NEXTUP_MAX_DECODE_PIXELS').value).toBe('25000000');
  });

  // The spec requires the SOURCE block to be assertable too, because the
  // up-size runbook (TASK-156) tells the reader to edit this exact text.
  it('T-INFRA-005c: infra/aca.bicep declares the pair as literals, not parameters', () => {
    expect(acaSource).toMatch(/cpu:\s*json\('0\.25'\)/);
    expect(acaSource).toMatch(/memory:\s*'0\.5Gi'/);
    expect(acaSource).toMatch(/value:\s*'25000000'/);
  });

  // ---- the coupling, in both directions -----------------------------------

  it('T-INFRA-005d: raising ONLY memory fails with the coupling message', () => {
    const bad = mutate((t) => {
      containerOf(t).resources.memory = '1.0Gi';
    });
    expect(skuViolations(bad).join('\n')).toContain(COUPLING_MESSAGE);
  });

  it('T-INFRA-005e: raising ONLY the decode guard fails with the coupling message', () => {
    const bad = mutate((t) => {
      setPixels(containerOf(t), '50000000');
    });
    expect(skuViolations(bad).join('\n')).toContain(COUPLING_MESSAGE);
  });

  it('T-INFRA-005f: raising ONLY cpu fails with the coupling message', () => {
    const bad = mutate((t) => {
      containerOf(t).resources.cpu = "[json('0.5')]";
    });
    expect(skuViolations(bad).join('\n')).toContain(COUPLING_MESSAGE);
  });

  // The up-size is PRE-AUTHORISED as a matched set, so the gate must not
  // block it. A test that rejected the sanctioned remedy would be worse than
  // no test: the owner would delete it under pressure during an incident.
  it('T-INFRA-005g: the matched up-size (0.5 / 1.0Gi / 50000000) is ACCEPTED', () => {
    const upsized = mutate((t) => {
      const container = containerOf(t);
      container.resources.cpu = "[json('0.5')]";
      container.resources.memory = '1.0Gi';
      setPixels(container, '50000000');
    });
    expect(skuViolations(upsized)).toEqual([]);
  });

  it('T-INFRA-005h: an unlisted combination is rejected even if internally plausible', () => {
    const bad = mutate((t) => {
      const container = containerOf(t);
      container.resources.cpu = "[json('1.0')]";
      container.resources.memory = '2.0Gi';
      setPixels(container, '100000000');
    });
    expect(skuViolations(bad).join('\n')).toContain(COUPLING_MESSAGE);
  });

  it('T-INFRA-005i: the allowed combinations are a closed set of exactly two', () => {
    expect(ALLOWED_COMPUTE_PAIRS).toHaveLength(2);
  });

  // ---- the rest of the pinning --------------------------------------------

  it('T-INFRA-005j: prod is Azure SQL Basic and staging is serverless GP_S', () => {
    const databases = resourcesOfType(template, 'Microsoft.Sql/servers/databases');
    expect(databases.length).toBeGreaterThan(0);
    for (const db of databases) {
      const isBasic = db.sku.name === 'Basic' && db.sku.tier === 'Basic';
      const isServerless = String(db.sku.name).startsWith('GP_S_');
      expect(isBasic || isServerless).toBe(true);
    }
  });

  it('T-INFRA-005k: catches a silent upgrade to a Standard database', () => {
    const bad = mutate((t) => {
      const db = resourcesOfType(t, 'Microsoft.Sql/servers/databases')[0];
      db.sku = { name: 'S0', tier: 'Standard' };
    });
    expect(skuViolations(bad).join('\n')).toMatch(/unpinned SKU/);
  });

  it('T-INFRA-005l: catches zone redundancy being switched on', () => {
    const bad = mutate((t) => {
      resourcesOfType(t, 'Microsoft.Sql/servers/databases')[0].properties.zoneRedundant = true;
    });
    expect(skuViolations(bad).join('\n')).toMatch(/must not be zone-redundant/);
  });

  it('T-INFRA-005m: the registry is ghcr.io and no ACR resource exists', () => {
    expect(resourcesOfType(template, 'Microsoft.ContainerRegistry/registries')).toHaveLength(0);
    const app = resourceOfType(template, 'Microsoft.App/containerApps');
    expect(app.properties.configuration.registries[0].server).toBe('ghcr.io');
  });

  it('T-INFRA-005n: catches an Azure Container Registry being reintroduced', () => {
    const bad = mutate((t) => {
      t.resources.push({
        type: 'Microsoft.ContainerRegistry/registries',
        name: 'acrnextup',
        sku: { name: 'Basic' },
      });
    });
    expect(skuViolations(bad).join('\n')).toMatch(/no Azure Container Registry may exist/);
  });

  it('T-INFRA-005o: prod is always warm and declares no scale rule', () => {
    const app = resourceOfType(template, 'Microsoft.App/containerApps');
    expect(app.properties.template.scale.rules ?? []).toEqual([]);
  });

  it('T-INFRA-005p: catches a scale rule being added', () => {
    const bad = mutate((t) => {
      resourceOfType(t, 'Microsoft.App/containerApps').properties.template.scale.rules = [
        { name: 'http', http: { metadata: { concurrentRequests: '10' } } },
      ];
    });
    expect(skuViolations(bad).join('\n')).toMatch(/must declare no scale rule/);
  });

  it('T-INFRA-005q: normaliseCpu reads the ARM json() wrapper and bare values alike', () => {
    expect(normaliseCpu("[json('0.25')]")).toBe('0.25');
    expect(normaliseCpu(0.25)).toBe('0.25');
    expect(normaliseCpu('0.25')).toBe('0.25');
  });
});
