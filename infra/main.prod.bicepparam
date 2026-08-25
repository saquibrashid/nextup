using './main.bicep'

// Production parameters (TASK-006, Variant A / A40).
//
// Secrets are read from the environment and have NO default: a missing
// variable must fail loudly rather than silently deploy a weak credential.
// CI supplies them from GitHub secrets; locally, export them before running
// `az deployment group what-if`.

param environmentName = 'prod'
param location = 'eastus2'
// SQL is pinned to a DIFFERENT region than everything else, deliberately.
// Azure SQL refuses new logical servers in whole regions per subscription
// (ProvisioningDisabled); on 2026-08-18 eastus2, eastus and westus2 all
// refused this subscription while centralus and westus3 accepted. Do not
// collapse this into location - see infra/main.bicep and
// docs/runbooks/deployment-identity.md.
param sqlLocation = 'centralus'

// TASK-007's deploy workflow overrides this with the immutable sha- tag it
// just pushed. The default is a public bootstrap image so the very first
// deployment succeeds before anything exists in ghcr.io.
param containerImage = readEnvironmentVariable(
  'NEXTUP_IMAGE',
  'mcr.microsoft.com/k8se/quickstart:latest'
)

param sqlAdminLogin = readEnvironmentVariable('NEXTUP_SQL_ADMIN_LOGIN', 'nextupadmin')
param sqlAdminPassword = readEnvironmentVariable('NEXTUP_SQL_ADMIN_PASSWORD')

param entraAdminLogin = readEnvironmentVariable('NEXTUP_ENTRA_ADMIN_LOGIN')
param entraAdminObjectId = readEnvironmentVariable('NEXTUP_ENTRA_ADMIN_OBJECT_ID')

// Easy Auth (TASK-027). The app registration must list BOTH environments'
// callback URLs — https://<fqdn>/.auth/login/aad/callback — because prod and
// staging share one client id. No default: a missing secret must fail the
// deployment, not silently produce an auth config nobody can sign in through.
param entraClientId = readEnvironmentVariable('NEXTUP_ENTRA_CLIENT_ID')
param entraClientSecret = readEnvironmentVariable('NEXTUP_ENTRA_CLIENT_SECRET')

// ⚠ LOAD-BEARING, AND EASY TO LOSE. The prod deploy creates the new revision
// with 100% of traffic still pinned HERE, to the revision that is currently
// serving, so the new one takes no user traffic until its smoke suite passes.
// The workflow discovers the value at run time and exports it as
// NEXTUP_HOLD_REVISION.
//
// The default is '' for the FIRST deploy only, when no previous revision
// exists. If this is ever empty on a subsequent deploy, the new revision
// takes traffic immediately and the staged rollout silently becomes a
// deploy-straight-to-prod — so `deploy.yml` fails the job rather than
// defaulting when it cannot read the current revision.
param holdRevisionName = readEnvironmentVariable('NEXTUP_HOLD_REVISION', '')

// ── Application configuration (A48) ────────────────────────────────────────
// ⚠ NO DEFAULT ON THE TMDB KEY, AND THAT IS THE POINT. Container Apps rejects
// an empty secret value, so there is no "deploy now, configure later" state
// available for it. Failing the deployment when the GitHub secret is missing
// is strictly better than the alternative it replaces: a green deploy whose
// app reports every metadata lookup as a transient TMDB outage, forever, with
// no 401 in any log to say otherwise (docs/runbooks/config-checklist.md §1.4).
//
// ⚠ IT MUST BE THE 32-HEX v3 API KEY, NOT THE v4 READ ACCESS TOKEN. Both
// strings sit on the same TMDB settings page; only the v3 key authenticates
// this app's query-parameter scheme.
param tmdbApiKey = readEnvironmentVariable('NEXTUP_TMDB_API_KEY')

// Epic M (REQ-092, ADR-0011). Also no default, for the identical reason: an
// empty secret value is rejected outright, so "configure it later" is not a
// state this parameter can occupy.
param omdbApiKey = readEnvironmentVariable('NEXTUP_OMDB_API_KEY')

// May be empty — the allow-list fails closed, so an empty value denies
// everyone rather than admitting them. Empty is a locked door, not an open one.
param allowedSubjects = readEnvironmentVariable('NEXTUP_ALLOWED_SUBJECTS', '')

// ── AI provisioning (TASK-010) ─────────────────────────────────────────────
// Production is deliberately LEFT OFF until the §9.7 bake-off reports. See
// main.staging.bicepparam and docs/runbooks/vision-account-reuse.md.
param deployAi = false
