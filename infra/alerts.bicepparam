using './alerts.bicep'

// Memory-observability alert parameters (TASK-157, `A43-M5`).
//
// Deployed into the SAME resource group as the container app, after
// `main.bicep`, because two of the three rules scope to the app itself:
//
//   az deployment group create \
//     --name nextup-alerts \
//     --resource-group nextup-rg \
//     --template-file infra/alerts.bicep \
//     --parameters infra/alerts.bicepparam
//
// Preview it first with `az deployment group what-if` (same arguments). The
// what-if creates nothing.
//
// ⚠ THESE RULES ARE NOT OPTIONAL HARDENING. The owner chose 0.5 GiB on the
// explicit basis that an OOM would be OBSERVED and answered by up-sizing
// (`A43` / `OQ-028`). Without them the trigger never fires and the reactive
// choice becomes an unmonitored one.

param environmentName = 'prod'

// Must match `containerAppName` from main.bicep for the same environment
// (`ca-nextup-${environmentName}`). ⚠ A name that does not resolve deploys
// fine and watches nothing.
param containerAppName = 'ca-nextup-prod'

// `log-nextup` in the same resource group, created by main.bicep.
param logAnalyticsWorkspaceId = readEnvironmentVariable('NEXTUP_LOG_ANALYTICS_ID')

// No default anywhere in the chain: an alert nobody is told about is not a
// control, so a missing variable must fail the deployment loudly.
param ownerEmail = readEnvironmentVariable('NEXTUP_OWNER_EMAIL')
