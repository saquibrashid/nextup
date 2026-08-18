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
