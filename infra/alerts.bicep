// infra/alerts.bicep — the three rules that make an OOM OBSERVED, not inferred.
//
// TASK-157 (`A43-M5`). The owner chose to run at 0.25 vCPU / 0.5 GiB and
// up-size REACTIVELY (`A43` / `OQ-028`: "Start at 0.5 GiB, up-size only if it
// OOMs"). That trigger only exists if an OOM is DETECTABLE. Without these
// rules the owner does not observe an out-of-memory kill — they experience a
// flaky app, and the reactive strategy silently becomes no strategy.
//
// WHY THIS IS A SEPARATE TEMPLATE, LIKE budget.bicep
// It carries the owner's email address, which is not in the repo and not in
// `main.*.bicepparam`. It follows the budget's established shape exactly: its
// own `az deployment group create`, its own committed ARM artifact, its
// address supplied at deploy time from `NEXTUP_OWNER_EMAIL`. Folding it into
// `main.bicep` would put a required, un-defaulted, personal parameter on the
// path of every application deploy.
//
// ⚠ NO AUTOMATED REMEDIATION, EVER (REQ-028, `T-CI-005`). The action group
// carries EMAIL RECEIVERS ONLY. An action group can also invoke an automation
// runbook, a webhook, a logic app or a function; any of those would turn an
// alert into an actuator that could stop or delete something on the owner's
// behalf. `T-INFRA-012` fails if a non-email receiver is ever added. The alert
// TELLS THE OWNER. The owner decides.
//
// ⚠ THE PRIMARY SIGNAL IS THE ONE WE EMIT, NOT A PLATFORM METRIC.
// Verified read-only against the deployed `ca-nextup-staging` and written up
// as `specs/testing.md` §31.6: Azure Container Apps publishes 31 metrics and
// NONE of them is OOM-distinct. `RestartCount` counts an OOM kill, a crash, a
// failed probe, a deploy and a scale event identically. So the decode sentinel
// (`specs/api.md` §9.1) is the primary signal — a `image.decode.begin` with no
// `image.decode.end` names the exact image that killed the container — and the
// two metric rules are backstops.
//
// ⚠ BOTH FAILURE PATHS ARE COVERED AND NEITHER RULE ALONE SUFFICES.
// P1, the common case: a WASM allocation failure inside `libheif-js` raises a
// catchable `RangeError`, one image fails, the container NEVER RESTARTS — so a
// design resting on `RestartCount` misses it entirely, and only the sentinel's
// `outcome: 'oom'` sees it. P2, the fatal case: the kernel kills the process,
// no error is ever raised and no `finally` runs — so the `end` line is simply
// absent, which is exactly what `nextup-prod-decode-abandoned` matches.

metadata description = 'nextup memory observability — one log-search rule, two metric backstops, zero automation.'

@description('Deployment region for the log-search rule. Metric alerts are always global.')
param location string = resourceGroup().location

@description('Names the rules. Prod is the default because the A43 trigger is a production decision.')
@allowed(['prod', 'staging'])
param environmentName string = 'prod'

@description('The container app these rules watch.')
param containerAppName string

@description('Resource id of the Log Analytics workspace the container app ships stdout to.')
param logAnalyticsWorkspaceId string

@description('Where every notification is emailed. No default: an alert nobody is told about is not a control.')
param ownerEmail string

@description('''
Average working-set bytes that counts as memory pressure.

400 MiB of the 512 MiB the container has. ⚠ RAISE THIS TO 800 MiB IF THE
UP-SIZE IS TAKEN — `docs/runbooks/scale-up-memory.md` owns that step. Left at
400 MiB after up-sizing to 1.0 GiB, this rule fires on ordinary operation and
trains the owner to ignore it, which is worse than not having it.
''')
@minValue(1)
param memoryPressureBytes int = 419430400

// ⚠ THE RUNBOOK PATH IS SPELLED OUT IN FULL IN EVERY DESCRIPTION BELOW, and
// is deliberately NOT held in a variable. Bicep compiles an interpolated
// variable into an ARM `format()` call, so the path would stop being a literal
// in the compiled artifact — and `T-INFRA-012` could no longer prove that the
// notification the OWNER actually receives names the remedy.

// ⚠ THE EVENT NAMES BELOW ARE MATCHED VERBATIM AGAINST
// `packages/domain/src/logEvents.ts` BY `T-INFRA-012`. Renaming one there and
// not here does not break the build, does not break the app and does not break
// the alert's deployment — it simply stops the query ever matching again, and
// nothing tells anybody. That silent-disable is the whole reason the constants
// live in the domain and the reason this comment exists.
var decodeBeginEvent = 'image.decode.begin'
var decodeEndEvent = 'image.decode.end'

// The V8 text for a JS-heap exhaustion, matched as a second arm of the union.
// It is a DIFFERENT observation from the abandoned decode: the heap can die
// outside the sentinel's window, in which case there is no unmatched `begin`.
var heapOomText = 'JavaScript heap out of memory'

// ⚠ THE 5-MINUTE GRACE (`BeganAt < ago(5m)`) IS LOAD-BEARING, NOT PADDING.
// A decode that is legitimately still running when the window closes has a
// `begin` and no `end` yet, and is indistinguishable from one that died. The
// grace is what separates "in flight" from "abandoned"; removing it makes the
// rule fire on every slow HEIC and the owner learns to ignore it.
//
// ⚠ A BICEP MULTI-LINE STRING DOES NOT INTERPOLATE. `'''...${x}...'''` is
// VERBATIM: the braces survive into the deployed KQL, the template compiles
// clean, the rule deploys successfully and then matches nothing, forever —
// the exact silent-disable failure this whole file is built to prevent. The
// placeholders below are substituted explicitly for that reason. Do not
// "simplify" them back into `${}`.
var decodeAbandonedQueryTemplate = '''
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(15m)
| where ContainerAppName_s == '__APP__'
| extend Payload = parse_json(Log_s)
| extend Event = tostring(Payload.event), ImageId = tostring(Payload.imageId)
| where Event in ('__BEGIN__', '__END__') and isnotempty(ImageId)
| summarize BeganAt = minif(TimeGenerated, Event == '__BEGIN__'), Ended = countif(Event == '__END__') by ImageId
| where Ended == 0 and isnotnull(BeganAt) and BeganAt < ago(5m)
| project ImageId, BeganAt
| union (
    ContainerAppConsoleLogs_CL
    | where TimeGenerated > ago(15m)
    | where ContainerAppName_s == '__APP__'
    | where Log_s has '__HEAP__'
    | project ImageId = 'javascript-heap-oom', BeganAt = TimeGenerated
  )
'''

var decodeAbandonedQuery = replace(
  replace(
    replace(
      replace(
        // ⚠ CRLF IS NORMALISED AWAY DELIBERATELY. A multi-line Bicep string
        // keeps the SOURCE FILE's line endings, so the same template compiles
        // to a different ARM artifact on a CRLF checkout than on an LF one —
        // and `T-INFRA-010`'s compile-vs-committed drift check then fails on
        // one machine and passes on the other, for a template nobody changed.
        replace(decodeAbandonedQueryTemplate, '\r\n', '\n'),
        '__APP__',
        containerAppName
      ),
      '__BEGIN__',
      decodeBeginEvent
    ),
    '__END__',
    decodeEndEvent
  ),
  '__HEAP__',
  heapOomText
)

resource containerApp 'Microsoft.App/containerApps@2024-03-01' existing = {
  name: containerAppName
}

// EMAIL ONLY. See the header. `T-INFRA-012` asserts that every receiver
// collection except `emailReceivers` is empty.
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-nextup-${environmentName}-owner'
  location: 'global'
  properties: {
    groupShortName: 'nextupOwner'
    enabled: true
    emailReceivers: [
      {
        name: 'owner'
        emailAddress: ownerEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

// ── S1 — THE PRIMARY SIGNAL ───────────────────────────────────────────────
// A `begin` with no `end` is the only record that names WHICH image killed the
// container, because a kernel OOM kill raises nothing to catch.
resource decodeAbandoned 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'nextup-${environmentName}-decode-abandoned'
  location: location
  properties: {
    displayName: 'nextup — image decode abandoned (probable OOM)'
    description: 'An image decode started and never finished, or the V8 heap died. This is the up-size trigger from docs/runbooks/scale-up-memory.md. Do not automate a response; read the runbook and decide.'
    severity: 1
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [logAnalyticsWorkspaceId]
    criteria: {
      allOf: [
        {
          query: decodeAbandonedQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: false
    actions: {
      actionGroups: [actionGroup.id]
    }
  }
}

// ── S2 — BACKSTOP: THE REPLICA RESTARTED ──────────────────────────────────
// ⚠ AGGREGATION IS `Maximum`, NOT `Total`, AND THAT IS A CORRECTION.
// The TASK-157 backlog row specifies `Total > 0`. The metric-existence check
// that the same row demands (TASK-010 item (h), answered in
// `specs/testing.md` §31.6) found that `RestartCount`'s primary aggregation is
// `Maximum` because it is a RUNNING PER-POD COUNTER, not an event count. A
// `Total`-over-window rule sums a rising series and therefore fires on a
// perfectly healthy app, forever. Splitting by `podName` is what makes an
// increase meaningful: a fresh replica starts at zero.
resource replicaRestart 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'nextup-${environmentName}-replica-restart'
  location: 'global'
  properties: {
    description: 'A replica restarted. A kernel OOM kill looks exactly like this, and so does a deploy. Correlate with the decode sentinel before acting; remedy in docs/runbooks/scale-up-memory.md.'
    severity: 2
    enabled: true
    scopes: [containerApp.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    targetResourceType: 'Microsoft.App/containerApps'
    targetResourceRegion: location
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'restarts'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'RestartCount'
          operator: 'GreaterThan'
          threshold: 0
          timeAggregation: 'Maximum'
          criterionType: 'StaticThresholdCriterion'
          dimensions: [
            {
              name: 'podName'
              operator: 'Include'
              values: ['*']
            }
          ]
        }
      ]
    }
    autoMitigate: true
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}

// ── S3 — BACKSTOP: MEMORY PRESSURE BEFORE THE KILL ────────────────────────
// The only rule that can fire BEFORE an incident rather than after it.
resource memoryPressure 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'nextup-${environmentName}-memory-pressure'
  location: 'global'
  properties: {
    description: 'Working set is close to the container limit. Nothing has failed yet. If this recurs, up-size per docs/runbooks/scale-up-memory.md — and move NEXTUP_MAX_DECODE_PIXELS with it.'
    severity: 3
    enabled: true
    scopes: [containerApp.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    targetResourceType: 'Microsoft.App/containerApps'
    targetResourceRegion: location
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'workingSet'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'WorkingSetBytes'
          operator: 'GreaterThan'
          threshold: memoryPressureBytes
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    autoMitigate: true
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}

@description('The three rule ids, so a deployment can be verified without a portal visit.')
output alertRuleIds array = [
  decodeAbandoned.id
  replicaRestart.id
  memoryPressure.id
]

@description('The runbook every notification points at. Asserted by T-INFRA-012.')
output runbookPath string = 'docs/runbooks/scale-up-memory.md'
