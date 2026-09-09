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
// ⚠ THE §9.7 BAKE-OFF HAS REPORTED, AND THE INCUMBENT STAYS.
// `tests/extraction/bakeoffMeasured.spec.ts` (`T-AI-045a`/`b`/`c`) scores both
// arms offline on every PR and feeds the PRE-COMMITTED rule in
// `chooseReader.ts`. `gpt-5-4-mini` was rejected on evidence, not on price: it
// bought roughly ONE extra title of recall across the whole corpus — inside
// the noise band the rule was written to discount — while fabricating three
// times as often, including two invented tiles on a page with no works on it
// at all. Production therefore deploys the reader it was always configured
// for, `gpt-4.1` (ADR-0001), and the decision is re-checked in CI rather than
// recorded in a document that can drift.
//
// ⚠ THE GATE IS NOT REMOVED, IT IS SATISFIED. If a future challenger wins,
// promotion is an ADR-0001 revision AND a `max_tokens` →
// `max_completion_tokens` change in `config.ts` (§9.7). Do not flip this back
// to `false` to "save money": NFR-012a makes extraction quality-first, and a
// cost-motivated downgrade is non-compliance rather than an optimisation.
//
// ~~`param deployAi = false` — "left off until the §9.7 bake-off reports".~~
// *(superseded 2026-09-09: it reported.)*
param deployAi = true

// ⚠ VISION IS RE-USED, NOT PROVISIONED, AND THIS PAIR IS NOT OPTIONAL.
// Azure AI Vision **F0 is limited to ONE ComputerVision account per
// SUBSCRIPTION**, and this subscription already holds
// `vision-f4n7ptoeq44pk`. Setting `deployAi = true` without these two lines
// leaves `deployVision` at its `true` default and the production deployment
// FAILS on a quota conflict — after the Azure OpenAI account has already been
// created, so the failure is both confusing and half-applied.
//
// The role assignment on that account is issued OUT-OF-BAND (it lives in a
// different resource group), per `docs/runbooks/vision-account-reuse.md`.
// Its F0 quota — 5,000 tx/month, 20/min — is now shared three ways. §2.2
// degrades gracefully when OCR is unavailable, so throttling costs a batch its
// cross-check rather than costing it the batch.
param deployVision = false
param existingVisionEndpoint = 'https://vision-f4n7ptoeq44pk.cognitiveservices.azure.com/'
