// infra/aca.bicep — Azure Container Apps (TASK-006, Variant A / A40).
//
// One Container Apps environment (shared) and one Container App per
// deployment environment. Prod is always warm.

metadata description = 'Container Apps environment and the per-environment app, pulling from ghcr.io.'

@description('Deployment environment: prod or staging.')
@allowed(['prod', 'staging'])
param environmentName string

@description('Azure region for all resources.')
param location string

@description('Container Apps managed environment name.')
param managedEnvironmentName string

@description('Container App name for this environment.')
param containerAppName string

@description('Log Analytics workspace customer id.')
param logAnalyticsCustomerId string

@secure()
@description('Log Analytics workspace shared key.')
param logAnalyticsSharedKey string

// The image lives in ghcr.io. There is NO Azure Container Registry and NO
// AcrPull grant anywhere (ADR-0003 Rev 3), and — since TASK-146 / R8 — no
// registry credential of any kind: the package is public and Container Apps
// pulls it anonymously. See docs/ghcr-pat.md before adding one back.
@description('Fully-qualified container image, e.g. ghcr.io/saquibrashid/nextup:sha-abc123.')
param containerImage string

// ---------------------------------------------------------------------------
// EASY AUTH (TASK-027, ADR-0002, specs/security.md §2.1).
//
// ⚠ THE ISSUER IS `/common` ON PURPOSE, AND IT ACCEPTS *EVERY* MICROSOFT
// ACCOUNT IN THE WORLD. ADR-0002 requires both organisational and personal
// Microsoft accounts, and there is no issuer that admits both while admitting
// only one person. Easy Auth is AUTHENTICATION; the only thing standing
// between "signed in" and the owner's data is the NFR-017 allow-list in
// apps/api/src/middleware/allowList.ts (TASK-019), which fails CLOSED.
//
// ADR-0002 names this as the one part of the auth story that can fail
// SILENTLY: if the allow-list is missing or misconfigured everything still
// works perfectly for the owner, and the app is open to the internet. Do not
// "simplify" this to a tenant-scoped issuer and conclude the allow-list is
// now redundant — a tenant issuer would lock the owner's personal Microsoft
// account out instead, and the allow-list is still the only per-person check.
// ---------------------------------------------------------------------------
// ⚠ THE ISSUER IS A LITERAL in the authConfig below, not a parameter, for the
// same reason the compute triple is: a parameterised default can be overridden
// at the call site while this file still reads correctly. Changing WHO MAY
// SIGN IN should require a visible, reviewable Bicep diff — and T-INFRA-008
// asserts on the compiled value, which it cannot do through a `parameters()`
// reference.
@description('Application (client) id of the Entra app registration used by Easy Auth.')
param entraClientId string

@description('Client secret of the Entra app registration. Supplied at deploy time; never committed.')
@secure()
param entraClientSecret string

// ---------------------------------------------------------------------------
// THE COMPUTE / DECODE-GUARD PAIR (REQ-079, A43, invariant 14).
//
// cpu / memory and NEXTUP_MAX_DECODE_PIXELS are ONE SETTING IN TWO PLACES and
// must never be changed independently:
//   - raising the guard without the memory removes the only thing stopping a
//     large image from killing the container;
//   - raising the memory without the guard buys ~$4/month of nothing.
//
// The allowed combinations are a CLOSED SET:
//   (0.25, '0.5Gi', '25000000')   <- current
//   (0.5,  '1.0Gi', '50000000')
//
// T-INFRA-005 (TASK-008) fails CI on any other combination. The sanctioned way
// to change both together is docs/runbooks/scale-up-memory.md (TASK-156).
// Do NOT pre-emptively raise the memory "to be safe" — the owner chose to
// start small and up-size reactively.
//
// The guard is a PIXEL guard read from the image header. A byte-size ceiling
// is NOT a substitute: HEIC compression varies wildly and a 6 MiB file can
// decode to 48 MP.
// ---------------------------------------------------------------------------
// The three values below are LITERALS on purpose, not parameters: the
// up-size runbook (docs/runbooks/scale-up-memory.md, TASK-156) tells the
// reader to edit this exact block, and T-INFRA-005 asserts on it. A
// parameterised default would let an override at the call site silently
// break the pair while this file still looked correct.

var isProd = environmentName == 'prod'

// The secret NAME is referenced from two places that must agree: the
// `secrets` entry below and `clientSecretSettingName` in the authConfig. If
// they drift, Easy Auth starts with no secret — and a misconfigured provider
// fails CLOSED (nobody, including the owner, can sign in), which is loud.
var entraClientSecretName = 'entra-client-secret'

// Shared across both environments — one managed environment, one Log Analytics
// workspace (ADR-0003 R2.4: "no separate Log Analytics workspace").
resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: managedEnvironmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsSharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  // System-assigned managed identity. RBAC is granted least-privilege in
  // main.bicep, scoped to THIS environment's blob container only — the staging
  // identity gets no grant on the production database or blob container.
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      ingress: {
        external: true
        // ⚠ MUST equal the port the container actually listens on, which is
        // set by `ENV PORT` / `EXPOSE` in the Dockerfile. These live in two
        // files that are never read together, and a mismatch does NOT fail the
        // deployment: ARM reports Succeeded, the revision provisions, the app
        // logs "listening on :3000" — and every request is refused, because
        // the startup probe dials a port nothing is bound to. That is exactly
        // how this shipped once (targetPort 8080 vs PORT 3000). Tied together
        // by `portViolations()` in tools/check-infra.mjs (T-INFRA-010).
        targetPort: 3000
        transport: 'auto'
        // T-INFRA-003. HTTPS is also a FUNCTIONAL dependency, not merely a
        // security one: navigator.clipboard is absent on http://, so the
        // paste ingest affordance (REQ-001/REQ-004) simply would not exist.
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      // NO `registries` block, deliberately. The ghcr.io package is PUBLIC and
      // Container Apps pulls it anonymously, so there is no registry credential
      // anywhere in this system (TASK-146, docs/ghcr-pat.md).
      //
      // Do not "restore" one. A fine-grained PAT CANNOT authenticate to ghcr.io
      // (GitHub Packages supports classic PATs only, and returns 403), and a
      // classic PAT's `read:packages` scope is account-wide with no way to
      // narrow it to one repository. Adding a half-configured `registries`
      // entry is also strictly worse than none: it fails CLOSED, because the
      // anonymous pull path is no longer attempted.
      // The ONLY secret in this system. It is the Entra app registration's
      // client secret, supplied at deploy time from a GitHub secret via
      // `readEnvironmentVariable` in the .bicepparam — never a literal, never
      // committed. Everything else authenticates with the system-assigned
      // managed identity, and there is deliberately no registry credential.
      secrets: [
        {
          name: entraClientSecretName
          value: entraClientSecret
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'nextup'
          image: containerImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'NEXTUP_MAX_DECODE_PIXELS'
              value: '25000000'
            }
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'NEXTUP_ENVIRONMENT'
              value: environmentName
            }
          ]
        }
      ]
      scale: {
        // prod is ALWAYS WARM (minReplicas = 1). maxReplicas = 2 exists only
        // so a revision transition can overlap; there is deliberately NO
        // scale rule. staging scales to zero — nobody judges its cold start.
        minReplicas: isProd ? 1 : 0
        maxReplicas: isProd ? 2 : 1
      }
    }
  }
}

// ---------------------------------------------------------------------------
// EASY AUTH — TASK-027, ADR-0002, specs/security.md §2.1.
//
// This resource is the WHOLE of nextup's authentication. There is no OIDC
// client, no JWT library, no session store and no cookie signing anywhere in
// the application (T-SEC-011 asserts the packages are absent). US-001 AC-1
// ("no nextup content is rendered before authentication completes") is a
// platform property enforced ahead of application code, not an application
// invariant that has to be tested.
//
// The name MUST be `current` — Easy Auth reads exactly one auth config per
// container app and ignores any other name, silently and while deploying
// successfully.
// ---------------------------------------------------------------------------
resource authConfig 'Microsoft.App/containerApps/authConfigs@2024-03-01' = {
  parent: app
  name: 'current'
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      // Unauthenticated requests are redirected to sign-in rather than served
      // anything (US-001 AC-1, T-AUTH-001). `redirectToProvider` skips the
      // provider-chooser page, which would otherwise offer a single choice.
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
      // ⚠ NO `excludedPaths`, deliberately. Every entry here is an
      // authentication BYPASS by path prefix, evaluated before any
      // application code runs, and `/api/*` in this list would expose the
      // owner's entire list to the internet while every application-level
      // test still passed. There is no health endpoint that needs one: the
      // Container Apps default probe is TCP, not HTTP.
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          openIdIssuer: 'https://login.microsoftonline.com/common/v2.0'
          clientId: entraClientId
          clientSecretSettingName: entraClientSecretName
        }
        validation: {
          allowedAudiences: [
            entraClientId
          ]
          // NO `defaultAuthorizationPolicy`. Per-person authorisation is
          // NFR-017's allow-list in application middleware (TASK-019), and
          // splitting it across two places would leave two half-checks that
          // each look complete.
        }
      }
    }
    login: {
      // US-001 AC-2 / T-AUTH-002: the requested deep link survives the
      // round trip through Entra. The path is preserved by Easy Auth's
      // `post_login_redirect_uri`; this flag is what additionally preserves
      // the URL FRAGMENT, which that redirect parameter cannot carry because
      // a fragment is never sent to a server.
      preserveUrlFragmentsForLogins: true
      tokenStore: {
        // Explicitly OFF. nextup calls no downstream API on the owner's
        // behalf, so it needs no access token — and a token store would
        // persist C3 identity material (specs/security.md §5 says `email` is
        // display-only and lives in memory only). It also requires a
        // configured blob store, so enabling it without one breaks sign-in.
        enabled: false
      }
      // NO sign-out configuration. `/.auth/logout` is a PLATFORM route that
      // exists as soon as `platform.enabled` is true (specs/security.md §2.1);
      // the header links to it. Declaring a custom logout endpoint here would
      // shadow it.
    }
  }
}

@description('The Container App name.')
output appName string = app.name

@description('System-assigned managed identity principal id, for RBAC in main.bicep.')
output principalId string = app.identity.principalId

@description('The public FQDN of the app.')
output appFqdn string = app.properties.configuration.ingress.fqdn
