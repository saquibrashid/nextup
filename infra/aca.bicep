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
// THE 0%-TRAFFIC HOLD (TASK-007). This parameter is the whole mechanism, and
// it is not optional decoration.
//
// The workflow reads the revision currently serving 100% and passes it here
// BEFORE deploying. ARM then creates the new revision while traffic stays
// pinned to the named old one, so the new code is reachable only on its own
// per-revision FQDN and the owner keeps hitting the known-good revision until
// the smoke suite has passed against the new one.
//
// ⚠ Do NOT "simplify" this back to an unconditional `latestRevision: true`.
// That is what shipped first, and it silently made the gate a no-op in two
// separate ways at once: the app defaulted to Single revision mode (so
// `az containerapp ingress traffic set` errored outright), and — had the mode
// been fixed alone — ARM would have promoted the new revision to 100% as part
// of the deployment itself, BEFORE `prisma migrate deploy` ran. The workflow
// then "held" traffic on a revision that was already live and smoked a URL
// that was already serving the new code. Every step reported success.
//
// Empty means bootstrap: there is no previous revision, so the latest one must
// take the traffic or the app has no route at all.
@description('Revision to pin 100% of traffic to during a deployment. Empty on first deploy.')
param holdRevisionName string = ''

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

// Endpoints only — NOT keys. Both accounts run with `disableLocalAuth: true`,
// so there is no key to pass and the app authenticates with this container
// app's managed identity (specs/security.md §6, `T-INFRA-001`).
@description('Azure OpenAI endpoint. Config, not a secret.')
param openAiEndpoint string

@description('Azure OpenAI deployment name the app addresses.')
param openAiDeployment string

@description('Azure AI Vision endpoint. Config, not a secret.')
param visionEndpoint string

// ---------------------------------------------------------------------------
// THE SETTINGS THAT MADE A DEPLOYED APP A NON-WORKING ONE (A48).
//
// Until now this template set six environment variables and no more, so a
// deployment that ARM reported as Succeeded had no allow-list, no metadata key
// and nowhere to put screenshots. That was invisible from outside: Easy Auth
// answers before any application code runs, so a fully configured app and an
// entirely unconfigured one both return an identical, correct-looking 401 —
// which is why a green T-SMOKE-* run is not evidence that the app works.
//
// ⚠ `secrets` AND `env` MUST STAY LITERAL ARRAYS. The obvious implementation
// here is conditional array concatenation, so an unsupplied value emits no
// entry. It compiles, and it silently disarms the infra gates: `concat()`
// becomes a single ARM expression STRING, so `tests/infra/**` — which reads
// the committed main.json statically — can no longer see any element. That
// took T-INFRA-005's compute/decode-guard pair (invariant 14) and
// T-INFRA-008's secret-name agreement down together, 21 tests, while the
// template itself still deployed. A dynamic template is an unguarded one.
//
// ⚠ AND AN EMPTY SECRET VALUE IS NOT A FALLBACK. Container Apps rejects
// `value: ''` outright (azure-container-apps#660, #1291), so a secret-backed
// setting has no "absent" state available to it at all: it is supplied, or the
// deployment fails. Hence tmdbApiKey has NO default — a missing GitHub secret
// must fail the deploy loudly rather than produce a running app that reports
// every metadata lookup as a transient TMDB outage forever.
// ---------------------------------------------------------------------------

@description('TMDB v3 API key (32 hex chars) — NOT the v4 read access token, which cannot authenticate this app\'s query-parameter scheme. Required: see the empty-secret note above.')
@secure()
param tmdbApiKey string

@description('Comma-separated Entra subject ids permitted by the NFR-017 allow-list. NOT a secret: knowing a subject id grants nothing. Plain config, so unlike the secret above it may legitimately be empty — the allow-list fails CLOSED.')
param allowedSubjects string = ''

@description('Blob service endpoint for this environment. Config, not a secret — auth is managed identity (ADR-0006), so there is no account key or SAS to hold.')
param storageBlobEndpoint string

@description('Blob container this environment writes to: screenshots for prod, screenshots-staging for staging.')
param storageContainerName string

@description('Fully-qualified Azure SQL server hostname for this environment.')
param sqlServerFqdn string

@description('Database this environment uses: nextup for prod, nextup_staging for staging.')
param sqlDatabaseName string

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

// Same drift risk as the Easy Auth name above, and the same mitigation: named
// once, referenced from both the `secrets` array and the matching `secretRef`.
var tmdbApiKeySecretName = 'tmdb-api-key'

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
        traffic: empty(holdRevisionName)
          ? [
              {
                latestRevision: true
                weight: 100
              }
            ]
          : [
              {
                revisionName: holdRevisionName
                weight: 100
              }
            ]
      }
      // Multiple revision mode is REQUIRED, not a preference: it is the only
      // mode in which more than one revision can exist with a traffic weight,
      // and therefore the only mode in which the new revision can be held at
      // 0% and smoke-tested before the owner is exposed to it. In Single mode
      // `az containerapp ingress traffic set` fails outright with
      // "configured for single revision" — which is exactly how the first
      // production deployment failed, at the last step, after the smoke suite
      // had already reported green against the live revision.
      //
      // The cost consequence is real and is handled in deploy.yml: prod runs
      // minReplicas = 1, so every revision left Active bills a replica for
      // ever. The workflow deactivates the superseded revision after the
      // traffic shift. A deactivated revision is still restorable, which is
      // what makes rollback a revision switch (docs/runbooks/rollback.md).
      activeRevisionsMode: 'Multiple'
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
      // Two secrets, and no more. The Entra app registration's client secret
      // and the TMDB key are both supplied at deploy time from GitHub secrets
      // via `readEnvironmentVariable` in the .bicepparam — never literals,
      // never committed.
      //
      // Everything else authenticates with the system-assigned managed
      // identity: Azure OpenAI, Azure AI Vision and — since A48 — Blob
      // Storage, which is why the storage settings below are plain config and
      // NOT secrets. There is deliberately no registry credential.
      //
      // ⚠ DATABASE_URL IS DELIBERATELY NOT A SECRET (TASK-141, A48).
      //
      // It carries NO credential. The app authenticates to Azure SQL with the
      // system-assigned managed identity, so the URL is server + database and
      // nothing else — and `apps/api/src/db/connection.ts` DERIVES the
      // auth mode from exactly that absence: a URL with no `user`/`password`
      // has nothing to authenticate with except the managed identity.
      // (`apps/api/src/db/connection.ts`.)
      //
      // Adding a `user=`/`password=` here would silently switch the running
      // app back to SQL-login auth while every test still passed. If this ever
      // needs a credential, it must become a `secretRef` AND the change must be
      // argued against specs/security.md §7.
      secrets: [
        {
          name: entraClientSecretName
          value: entraClientSecret
        }
        {
          name: tmdbApiKeySecretName
          value: tmdbApiKey
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
            {
              name: 'NEXTUP_AOAI_ENDPOINT'
              value: openAiEndpoint
            }
            {
              name: 'NEXTUP_AOAI_DEPLOYMENT'
              value: openAiDeployment
            }
            {
              name: 'NEXTUP_VISION_ENDPOINT'
              value: visionEndpoint
            }
            {
              name: 'TMDB_API_KEY'
              secretRef: tmdbApiKeySecretName
            }
            // May be empty, and empty DENIES everyone — `allowList.ts` fails
            // closed. That is the safe direction for a control whose failure
            // mode would otherwise be an open door.
            {
              name: 'NEXTUP_ALLOWED_SUBJECTS'
              value: allowedSubjects
            }
            // Config, not secrets: auth is the managed identity, so there is
            // no account key and no SAS to hold (ADR-0006).
            //
            // ⚠ THE CONTAINER NAME MUST BE PASSED PER ENVIRONMENT. It used to
            // be hard-coded in apps/api/src/storage/blobStore.ts, which made
            // rbac.bicep's per-container scoping pointless: staging asked for
            // the production container by name every time, so the isolation
            // guaranteed only that staging would be REFUSED — and had the two
            // ever shared a credential, staging would have written the owner's
            // test screenshots into production's container instead.
            {
              name: 'AZURE_STORAGE_BLOB_ENDPOINT'
              value: storageBlobEndpoint
            }
            {
              name: 'AZURE_STORAGE_CONTAINER'
              value: storageContainerName
            }
            // TASK-141. Credential-free by construction — see the note on the
            // `secrets` array above. `encrypt=true` is explicit rather than
            // relying on a client default, because this is the one setting
            // whose silent downgrade would not fail anything.
            {
              name: 'DATABASE_URL'
              value: 'sqlserver://${sqlServerFqdn}:1433;database=${sqlDatabaseName};encrypt=true;trustServerCertificate=false'
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
