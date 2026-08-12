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

param containerImage = readEnvironmentVariable(
  'NEXTUP_IMAGE',
  'mcr.microsoft.com/k8se/quickstart:latest'
)

param ghcrUsername = readEnvironmentVariable('NEXTUP_GHCR_USERNAME', 'saquibrashid')
param ghcrToken = readEnvironmentVariable('NEXTUP_GHCR_TOKEN')

param sqlAdminLogin = readEnvironmentVariable('NEXTUP_SQL_ADMIN_LOGIN', 'nextupadmin')
param sqlAdminPassword = readEnvironmentVariable('NEXTUP_SQL_ADMIN_PASSWORD')

param entraAdminLogin = readEnvironmentVariable('NEXTUP_ENTRA_ADMIN_LOGIN')
param entraAdminObjectId = readEnvironmentVariable('NEXTUP_ENTRA_ADMIN_OBJECT_ID')
