import { describe, expect, it } from 'vitest';

import {
  allResources,
  authPolicyViolations,
  readCommittedArm,
  resourceOfType,
  resourcesOfType,
} from '../../tools/check-infra.mjs';

// T-INFRA-008 (TASK-027, ADR-0002, specs/security.md §2.1).
//
// TASK-027's own "Done when" column names `T-AUTH-001/002/003`, which are
// level `E`: Playwright against a DEPLOYED revision. They cannot run in CI,
// so citing them would leave this task with no CI-verifiable definition of
// done at all — and, per specs/testing.md §16.2a, an id with no failing code
// path is worse than an obviously wrong one because it goes green and stays
// green. This suite is what CI can honestly assert: that the configuration
// which makes those three tests possible exists and is shaped closed.
//
// It asserts against the COMPILED ARM (infra/main.json), matching
// infra.spec.ts: a regex over .bicep could pass while the emitted template
// said something else.
//
// Every rule is fed a deliberately mutated template and asserted to be
// CAUGHT. Each mutation below DEPLOYS SUCCESSFULLY and leaves an app that
// looks completely normal to its owner — that is the entire reason this file
// exists rather than a manual check.

const template = readCommittedArm();

function mutate(fn: (t: Record<string, unknown>) => void) {
  const clone = structuredClone(template);
  fn(clone);
  return clone;
}

function authConfig(t = template) {
  return resourceOfType(t, 'Microsoft.App/containerApps/authConfigs');
}

describe('T-INFRA-008 Easy Auth is configured, and configured closed', () => {
  it('T-INFRA-008a: the committed template has no auth violation', () => {
    const violations = authPolicyViolations(template);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('T-INFRA-008b: exactly one authConfig exists, named `current`', () => {
    const configs = resourcesOfType(template, 'Microsoft.App/containerApps/authConfigs');
    expect(configs).toHaveLength(1);
    // Easy Auth reads ONE config per app and ignores any other name — without
    // an error, and after a successful deployment.
    expect(String(configs[0].name)).toMatch(/'current'/);
  });

  it('T-INFRA-008c: catches the authConfig being removed entirely', () => {
    // The failure this guards is the app quietly serving every page and every
    // API route anonymously, which no application test can see.
    const bad = mutate((t) => {
      for (const resource of allResources(t)) {
        const nested = (resource as { properties?: { template?: { resources?: unknown[] } } })
          ?.properties?.template;
        if (Array.isArray(nested?.resources)) {
          nested.resources = nested.resources.filter(
            (r) => (r as { type?: string }).type !== 'Microsoft.App/containerApps/authConfigs',
          );
        }
      }
    });
    expect(authPolicyViolations(bad)).toContain(
      'auth: no authConfig — the app would serve anonymously (ADR-0002)',
    );
  });

  it('T-INFRA-008d: catches a name other than `current`', () => {
    const bad = mutate((t) => {
      authConfig(t).name = "[format('{0}/{1}', parameters('containerAppName'), 'nextup-auth')]";
    });
    expect(authPolicyViolations(bad).join('\n')).toMatch(/must be named "current"/);
  });

  it('T-INFRA-008e: `currentish` does not pass as `current`', () => {
    // The discriminating case for the name check. A substring test on
    // `current` — the obvious implementation — waves this through.
    const bad = mutate((t) => {
      authConfig(t).name = "[format('{0}/{1}', parameters('containerAppName'), 'currentish')]";
    });
    expect(authPolicyViolations(bad).join('\n')).toMatch(/must be named "current"/);
  });

  it('T-INFRA-008f: catches platform.enabled being turned off', () => {
    const bad = mutate((t) => {
      authConfig(t).properties.platform.enabled = false;
    });
    expect(authPolicyViolations(bad)).toContain('auth: platform.enabled must be true');
  });

  it('T-INFRA-008g: catches unauthenticatedClientAction being relaxed', () => {
    const bad = mutate((t) => {
      authConfig(t).properties.globalValidation.unauthenticatedClientAction = 'AllowAnonymous';
    });
    expect(authPolicyViolations(bad).join('\n')).toMatch(/must be RedirectToLoginPage/);
  });

  it('T-INFRA-008h: catches an excludedPaths bypass', () => {
    // `excludedPaths` is evaluated at the platform edge, before any
    // application code, so `/api/*` here exposes the owner's entire list
    // while the allow-list middleware and every one of its tests still pass.
    const bad = mutate((t) => {
      authConfig(t).properties.globalValidation.excludedPaths = ['/api/*'];
    });
    expect(authPolicyViolations(bad).join('\n')).toMatch(/authentication bypass by path prefix/);
  });

  it('T-INFRA-008i: catches the Entra provider being disabled', () => {
    const bad = mutate((t) => {
      authConfig(t).properties.identityProviders.azureActiveDirectory.enabled = false;
    });
    expect(authPolicyViolations(bad).join('\n')).toMatch(/azureActiveDirectory provider must be/);
  });

  it('T-INFRA-008j: catches a literal client secret replacing the reference', () => {
    const bad = mutate((t) => {
      const registration =
        authConfig(t).properties.identityProviders.azureActiveDirectory.registration;
      delete registration.clientSecretSettingName;
      registration.clientSecret = 'not-a-real-secret';
    });
    const violations = authPolicyViolations(bad).join('\n');
    expect(violations).toMatch(/must never be set/);
    expect(violations).toMatch(/reference a secret by name/);
  });

  it('T-INFRA-008k: catches the issuer being pointed at another identity provider', () => {
    const bad = mutate((t) => {
      authConfig(t).properties.identityProviders.azureActiveDirectory.registration.openIdIssuer =
        'https://accounts.google.com';
    });
    expect(authPolicyViolations(bad).join('\n')).toMatch(/Microsoft identity platform issuer/);
  });
});

describe('T-INFRA-008 the secret is a reference, and the two names agree', () => {
  it('T-INFRA-008l: the client secret is a parameter reference, never a literal', () => {
    const app = resourceOfType(template, 'Microsoft.App/containerApps');
    const secrets = app.properties.configuration.secrets as { name: string; value: unknown }[];
    // ⚠ This used to assert `toHaveLength(1)` and read `secrets[0]`, which
    // encoded "there is one secret" into a test about what a secret's VALUE
    // may be. A48 added the TMDB key and the count changed, so the assertion
    // failed while the property it names was still perfectly true. Checking
    // EVERY secret is both the stated intent and strictly stronger: a second
    // secret can no longer be added as a committed literal.
    expect(secrets.length).toBeGreaterThan(0);
    for (const secret of secrets) {
      // `[parameters('…')]` — supplied at deploy time from a GitHub secret. A
      // literal here would be a credential committed to a PUBLIC repository.
      expect(String(secret.value)).toMatch(/^\[parameters\('/);
    }
  });

  it('T-INFRA-008m: clientSecretSettingName names a secret that actually exists', () => {
    // The drift trap. These two are written in different halves of
    // aca.bicep; if they disagree Easy Auth starts with no secret and NOBODY
    // can sign in — including the owner, on a deployment that succeeded.
    const app = resourceOfType(template, 'Microsoft.App/containerApps');
    const declared = app.properties.configuration.secrets.map((s: { name: string }) =>
      String(s.name),
    );
    const referenced = String(
      authConfig().properties.identityProviders.azureActiveDirectory.registration
        .clientSecretSettingName,
    );
    expect(declared).toContain(referenced);
  });

  it('T-INFRA-008n: the deep-link and token-store settings are explicit', () => {
    const login = authConfig().properties.login;
    // US-001 AC-2 / T-AUTH-002 — the fragment survives the Entra round trip,
    // which `post_login_redirect_uri` alone cannot do (a fragment is never
    // sent to a server).
    expect(login.preserveUrlFragmentsForLogins).toBe(true);
    // Explicitly OFF: nextup calls no downstream API for the owner, and a
    // token store would persist C3 identity material that specs/security.md
    // §5 says lives in memory only.
    expect(login.tokenStore.enabled).toBe(false);
  });
});
