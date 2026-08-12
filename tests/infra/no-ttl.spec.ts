import { describe, expect, it } from 'vitest';

import {
  PROHIBITED_PROPERTY_KEYS,
  PROHIBITED_TYPES,
  readCommittedArm,
  resourceOfType,
  resourcesOfType,
  ttlViolations,
} from '../../tools/check-infra.mjs';

// T-INV-013 — soft delete is FOREVER (TASK-008, REQ-028, US-023 AC-3).
//
// This asserts a NEGATIVE, and the absence of any expiry mechanism IS the
// requirement. That makes it unusually easy for the test to be decoration: a
// tree with no TTL in it passes whether or not the checker works. Every rule
// below is therefore also fed a template that DOES contain the prohibited
// thing, and proven to catch it.
//
// The Bicep/ARM half lives here. The migrations half (no TRUNCATE, no
// destructive DDL) is T-MIG-001 in migrations.spec.ts. The "none on the live
// container" half named by TASK-008 requires a deployed subscription and is
// verified during the TASK-010 sprint, not in CI.

const template = readCommittedArm();

function mutate(fn) {
  const clone = structuredClone(template);
  fn(clone);
  return clone;
}

describe('T-INV-013 no TTL, no scheduled deletion, anywhere', () => {
  it('T-INV-013a: the committed template contains no TTL or scheduled-job resource', () => {
    const violations = ttlViolations(template);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('T-INV-013b: no Azure SQL Agent job or Elastic Job agent exists', () => {
    expect(resourcesOfType(template, 'Microsoft.Sql/servers/jobAgents')).toHaveLength(0);
  });

  it('T-INV-013c: catches an Elastic Job agent being added', () => {
    const bad = mutate((t) => {
      t.resources.push({
        type: 'Microsoft.Sql/servers/jobAgents',
        name: 'nextup-jobs',
        properties: {},
      });
    });
    expect(ttlViolations(bad).join('\n')).toMatch(/Microsoft\.Sql\/servers\/jobAgents/);
  });

  it('T-INV-013d: catches every prohibited scheduling resource type', () => {
    for (const type of PROHIBITED_TYPES) {
      const bad = mutate((t) => {
        t.resources.push({ type, name: 'sneaky', properties: {} });
      });
      expect(ttlViolations(bad).join('\n'), `${type} was not caught`).toContain(type);
    }
  });

  it('T-INV-013e: catches every TTL-shaped property name, at any depth', () => {
    for (const key of PROHIBITED_PROPERTY_KEYS) {
      const bad = mutate((t) => {
        // Deliberately buried, because a real one would be: a TTL added to a
        // nested settings object is exactly what a shallow check misses.
        resourceOfType(t, 'Microsoft.Storage/storageAccounts').properties.deeply = {
          nested: { [key]: 2592000 },
        };
      });
      expect(ttlViolations(bad).join('\n'), `${key} was not caught`).toContain(key);
    }
  });

  // The blob lifecycle purge is the ONE sanctioned expiry (NFR-019) and one of
  // only two permitted non-owner processes. If this test failed, the gate
  // would be flagging the very mechanism the product requires — and the
  // tempting fix would be to weaken the whole checker.
  it('T-INV-013f: the sanctioned 30-day screenshot purge is NOT flagged', () => {
    const policy = resourceOfType(template, 'Microsoft.Storage/storageAccounts/managementPolicies');
    const rules = policy.properties.policy.rules;
    expect(rules).toHaveLength(1);
    expect(rules[0].definition.actions.baseBlob.delete.daysAfterModificationGreaterThan).toBe(30);
    expect(ttlViolations(template)).toEqual([]);
  });

  it('T-INV-013g: the purge targets only the screenshot containers', () => {
    const policy = resourceOfType(template, 'Microsoft.Storage/storageAccounts/managementPolicies');
    const filters = policy.properties.policy.rules[0].definition.filters;
    expect(filters.blobTypes).toEqual(['blockBlob']);
    for (const prefix of filters.prefixMatch) {
      expect(prefix).toMatch(/^screenshots/);
    }
  });

  it('T-INV-013h: no database declares a retention-driven delete', () => {
    for (const db of resourcesOfType(template, 'Microsoft.Sql/servers/databases')) {
      expect(JSON.stringify(db.properties)).not.toMatch(/ttl|timeToLive|expiration/i);
    }
  });
});
