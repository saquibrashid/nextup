using './main.bicep'

// Staging parameters (TASK-006, Variant A / A40).
//
// Staging deploys into the SAME resource group as prod (ADR-0003 R2.4).
// It differs only in: minReplicas = 0, the serverless auto-paused
// nextup_staging database, and the screenshots-staging blob container.
// Its managed identity gets NO grant on the production database or container.
//
// Secrets are read from the environment and have NO default: a missing
// variable must fail loudly rather than silently deploy a weak credential.

param environmentName = 'staging'
param location = 'eastus2'
// SQL is pinned to a DIFFERENT region than everything else, deliberately.
// Azure SQL refuses new logical servers in whole regions per subscription
// (ProvisioningDisabled); on 2026-08-18 eastus2, eastus and westus2 all
// refused this subscription while centralus and westus3 accepted. Do not
// collapse this into location - see infra/main.bicep and
// docs/runbooks/deployment-identity.md.
param sqlLocation = 'centralus'

param containerImage = readEnvironmentVariable(
  'NEXTUP_IMAGE',
  'mcr.microsoft.com/k8se/quickstart:latest'
)

param sqlAdminLogin = readEnvironmentVariable('NEXTUP_SQL_ADMIN_LOGIN', 'nextupadmin')
param sqlAdminPassword = readEnvironmentVariable('NEXTUP_SQL_ADMIN_PASSWORD')

param entraAdminLogin = readEnvironmentVariable('NEXTUP_ENTRA_ADMIN_LOGIN')
param entraAdminObjectId = readEnvironmentVariable('NEXTUP_ENTRA_ADMIN_OBJECT_ID')

// Easy Auth (TASK-027). Same app registration as prod — its redirect-URI list
// must include the staging FQDN's /.auth/login/aad/callback as well, or
// staging sign-in fails with AADSTS50011 while prod is fine.
param entraClientId = readEnvironmentVariable('NEXTUP_ENTRA_CLIENT_ID')
param entraClientSecret = readEnvironmentVariable('NEXTUP_ENTRA_CLIENT_SECRET')

// ── AI provisioning (TASK-010), owner-approved 2026-08-19, STAGING FIRST ────
//
// Approved here and NOT in main.prod.bicepparam on purpose: the TASK-168
// bake-off needs live model calls, and running it against staging keeps a
// quality experiment off the environment holding the owner's real list.
// Production stays `deployAi = false` until §9.7 reports.
param deployAi = true

// FALSE, and the app still gets an OCR leg. The subscription's single free F0
// ComputerVision slot is held by `vision-f4n7ptoeq44pk` in `rg-coffee-dev`
// (another project). Rather than delete that account or pay for S1, the owner
// chose to re-use it. Verified 2026-08-19: ComputerVision / F0 / eastus2, and
// it has a custom subdomain, so Entra token auth works and no key is needed.
//
// ⚠ Its F0 quota (5,000 tx/month, 20/min) is now SHARED with that project.
// `specs/ai.md` §2.2 already degrades gracefully when OCR is unavailable, so
// throttling costs the cross-check for that batch rather than the batch.
param deployVision = false
param existingVisionEndpoint = 'https://vision-f4n7ptoeq44pk.cognitiveservices.azure.com/'

// The §9.7 challenger. Deployed only in staging — the bake-off runs here, and
// production has no reason to carry a model the app does not address.
param deployBakeOffModel = true

