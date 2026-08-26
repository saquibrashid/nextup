---
createdAt: 2026-08-20T14:40:00-04:00
createdBy: solution-architect
phase: 8
revision: 1
status: active
appliesTo: nextup production Container App (ca-nextup-prod, resource group nextup-rg)
forcedBy: TASK-133 (R6, R7) — production readiness
verifiedAgainst: live Azure, eastus2, 2026-08-20 (read-only against serving revision ca-nextup-prod--0000031)
---

# CHECKLIST — nextup production configuration

> **Read this if:** you are standing up an environment, changing a
> setting, or trying to work out why a *deployed and apparently healthy*
> nextup does not actually work.
>
> ⚠ **Green CI and a green smoke suite do NOT mean this app is
> configured.** The smoke suite (`T-SMOKE-001`–`004`) asserts the **Easy
> Auth platform boundary** and deliberately nothing behind it — it has no
> owner credentials, by design (ADR-0002). Every check below is invisible
> to it.

---

## 0. The state of production, measured

Verified read-only against the **serving** revision on 2026-08-20 (see
`docs/runbooks/scale-up-memory.md` §3a for why you must query the serving
revision and not the app-level template).

**A48 closed most of this gap, and it is now DEPLOYED.** Re-verified
read-only against serving revision `ca-nextup-prod--0000038` on
2026-08-21: `infra/aca.bicep` sets **ten** environment variables and
declares **two** secrets, and the serving revision matches exactly.

| Set in production | Value source |
| --- | --- |
| `NEXTUP_MAX_DECODE_PIXELS` | `infra/aca.bicep` (paired — §2) |
| `NODE_ENV` | `infra/aca.bicep` |
| `NEXTUP_ENVIRONMENT` | `infra/aca.bicep` |
| `NEXTUP_AOAI_ENDPOINT` | `infra/aca.bicep` |
| `NEXTUP_AOAI_DEPLOYMENT` | `infra/aca.bicep` |
| `NEXTUP_VISION_ENDPOINT` | `infra/aca.bicep` |
| `TMDB_API_KEY` *(A48)* | secret `tmdb-api-key` ← GitHub secret `TMDB_API_KEY` |
| `NEXTUP_ALLOWED_SUBJECTS` *(A48)* | GitHub secret `ALLOWED_SUBJECTS` (may be empty) |
| `AZURE_STORAGE_BLOB_ENDPOINT` *(A48)* | `storage.bicep` output — no key, managed identity |
| `AZURE_STORAGE_CONTAINER` *(A48)* | `storage.bicep` output — per environment |

Container Apps **secrets**: `entra-client-secret` and `tmdb-api-key`.
That inventory is a **closed set** asserted by `T-INFRA-005m`; a third
needs a reviewable diff.

🛑 **THE REQUIRED ACTION BEFORE THE NEXT DEPLOY.** `TMDB_API_KEY` has
**no default**, because Container Apps rejects an empty secret value
outright — so a secret-backed setting has no "absent" state available to
it. If the GitHub secret is missing, **the deployment fails**. That is
deliberate: the alternative was never "deploy unconfigured", it was
"deploy something that looks fine and reports every metadata lookup as a
transient TMDB outage forever" (§1.4).

| GitHub secret | Required? | Value | Status |
| --- | --- | --- | --- |
| `TMDB_API_KEY` | **yes — deploy fails without it** | the **32-hex v3 key**, not the v4 token (§1.4) | ✅ set 2026-08-21 |
| `ALLOWED_SUBJECTS` | no, but nobody can sign in without it | **exactly one** Entra **user** `oid` — never the app `clientId`, and never two accounts belonging to the same human (each is a separate owner) | ✅ set 2026-08-26 to the owner's personal-account `oid` |

**To find your subject id.** It is the Entra **object id** (`oid`), not a
sign-in address — `apps/api/src/auth/principal.ts` reads the
`objectidentifier` claim and falls back to `sub`, and `T-SEC-015` fails
on the word "email" appearing in the allow-list path at all.

🛑 **`/.auth/me` DOES NOT WORK ON THIS DEPLOYMENT. Do not send anyone to
it.** That endpoint reads the Easy Auth **token store**, and
`aca.bicep`'s `login.tokenStore.enabled` is deliberately **`false`** (it
would persist C3 identity material, and enabling it without a configured
blob store breaks sign-in outright). With the store off, `/.auth/me`
returns nothing and the request falls through to the SPA catch-all — so
you get the **application's own refusal page**, which looks exactly like
a failed sign-in and tells you nothing. Observed 2026-08-26; cost a
round trip to diagnose.

**Use bootstrap mode instead — it is the only supported way to read your
own `oid` here.** It logs the refused subject id and **grants nothing**
(`T-SEC-016`); the request is still refused.

```powershell
# 1. Turn it on (creates one extra revision).
az containerapp update --name ca-nextup-staging --resource-group nextup-rg `
  --set-env-vars NEXTUP_BOOTSTRAP_ALLOW_FIRST=true

# 2. Sign in to the site once, with the account you actually intend to use.
# 3. Read the id back out.
az containerapp logs show --name ca-nextup-staging --resource-group nextup-rg `
  --tail 200 | Select-String "Refused subject id"
```

You do **not** need to turn it off by hand: `NEXTUP_BOOTSTRAP_ALLOW_FIRST`
is set nowhere in `infra/`, and `template.containers[].env` is declarative,
so the next `deploy` run removes it automatically.

⚠ **ONE HUMAN CAN HAVE TWO OBJECT IDS, AND THEY ARE TWO DIFFERENT
OWNERS. Allow-list exactly one.** This is the failure that followed the
one above, on 2026-08-26, and it is far more dangerous than a lockout.

Because `aca.bicep` pins the issuer to `/common`, the owner's **personal
Microsoft account** and their **work/AAD account** are separate directory
objects with separate `oid`s. Both are "him". Neither is wrong. But
`auth/ownerId.ts` derives

    ownerId = 'o_' + sha256(issuer + '|' + subject).slice(0, 16)

so **each account is a completely separate owner with its own isolated
data**. Measured directly against the real middleware: the same person
signing in with his two accounts produced `o_3b62f52aebafd6ab` and
`o_8a73340be951b1e3`.

Putting both in `ALLOWED_SUBJECTS` therefore does **not** give one owner
two ways in. It creates **two owners with two empty lists**, and lets a
browser silently pick either. `ownerId.ts` names this exact outcome as
the worst possible failure mode: the owner "would silently see an empty
list rather than an error… indistinguishable from data loss, and
invisible to every test that uses one identity." Uploads filed under the
wrong owner cannot be merged back afterwards.

**Telling the two apart from the id alone:**

| Shape | Account type |
| --- | --- |
| `00000000-0000-0000-xxxx-xxxxxxxxxxxx` (zero-padded) | personal Microsoft account |
| a fully random GUID | work / school (AAD) |

⚠ **A browser will silently reuse whichever account it is already signed
into**, so "I signed in and got refused" does not tell you *which*
identity was presented — the two sign-ins during this incident produced
two different ids without the owner choosing either. **An InPrivate /
incognito window is the reliable way to get a clean, deliberate signal**;
that is how the correct id was finally captured.

nextup is a single-owner product and its data is personal media history,
so the personal account is the correct owner and the work account is
deliberately **not** on the list. Signing in from a browser defaulted to
the work account will be refused — that is working as intended; use
**Sign out** on the refusal page and pick the personal account.

⚠ **Never take the value from the Azure portal.** `aca.bicep` pins the
issuer to the `/common` endpoint, so the account you actually sign in
with decides which `oid` you get — a personal Microsoft account and a
work account are different objects with different ids. The portal shows
the id of the user you searched for; bootstrap mode shows the id of
whoever actually signed in. When they differ, the portal value locks you
out of your own deployment.

⚠ **The subject id is NOT the `clientId`, and confusing the two is the
failure this checklist has already seen.** From 2026-08-21 to 2026-08-26
`ALLOWED_SUBJECTS` held `b374ba10-…`, the Entra **application** id — a
plausible-looking GUID that is already in `ENTRA_CLIENT_ID` and in the
`authConfig`. No human being will ever present it as a subject, so
sign-in succeeded and authorisation refused **every** request, with the
same 403 an empty list produces. A deploy-time guard now rejects the
equality (`deploy.yml`, "Guard: allow-list is not the client id").

~~Superseded: "Sign in and read
`https://ca-nextup-prod…/.auth/me`. Easy Auth serves that itself, ahead
of application code, so it works while the allow-list is empty."
Falsified — the token store is off, so that URL renders the SPA.~~

🛑 **Still not wired: `DATABASE_URL`.** Its shape is `TASK-141`'s open
decision — managed identity (preferred) versus a Key Vault SQL login —
and the same empty-secret rejection means the slot **cannot** be added
now and filled later. Adding it means choosing. Until then **no request
that touches data can succeed**, and the app's own startup failure keeps
naming the real cause.

⚠ **None of this is visible from the outside.** Easy Auth answers first,
so an unauthenticated caller — including the smoke suite — gets an
identical, correct-looking `401` whether the app behind it is fully
configured or entirely unconfigured. A green `T-SMOKE-*` run is not
evidence that the app works.

⚠ **`AZURE_STORAGE_ACCOUNT` is read by no code**, in either environment.
It is a convenient handle for `az storage` commands and nothing more; do
not write code that depends on it without first adding it to
`infra/aca.bicep`, where it is deliberately absent.

**Storage isolation, verified 2026-08-21.** Both environments share one
storage account and are separated by container:

| Environment | `AZURE_STORAGE_CONTAINER` |
| --- | --- |
| prod | `screenshots` |
| staging | `screenshots-staging` |

`rbac.bicep` grants each environment's identity access to **its own
container only**, so this separation is now enforced rather than merely
intended. Before A48 the name was hard-coded in `blobStore.ts`, which
meant staging asked for the production container by name every time — the
grant guaranteed only that staging would be **refused**, and had the two
ever shared a credential, staging would have written into production's
container instead.

---

## 1. Every setting, and what breaks if it is wrong

Names below are the **real** ones, taken from `apps/api/src/**`,
`infra/aca.bicep` and `.env.example`. Auth to Azure services is **managed
identity everywhere**; key-based auth to Azure OpenAI is *prohibited*
(`T-INFRA-001`, `specs/security.md` §6).

### 1.1 Access

| Setting | Notes |
| --- | --- |
| `NEXTUP_ALLOWED_SUBJECTS` | Comma-separated Entra **subject ids** allowed to use the app. **Fails closed** — empty admits nobody. Not a secret, but it is the whole access-control list. |
| `NEXTUP_BOOTSTRAP_ALLOW_FIRST` | Default `false`. Logs the first rejected subject id and **still refuses** (403). 🛑 **Never `true` in production.** Its name reads like "allow the first user in"; it does not, and must not be made to. |
| `entra-client-secret` (secret) | Easy Auth's Entra app credential. Platform-level; the application never reads it (ADR-0002, zero application auth code). |

#### 1.1a The Entra app registration itself — three settings, none of them in Bicep

⚠ **These live in Entra, not in `infra/`, so no deploy sets them and no gate
reads them.** All three were wrong on first sign-in and the failure surfaced
only as a Microsoft-branded error page, after the redirect, with nothing
logged on the nextup side.

| Setting | Required value | What a wrong value looks like |
| --- | --- | --- |
| `signInAudience` | **`AzureADandPersonalMicrosoftAccount`** | `AADSTS700016: Application with identifier '…' was not found in the directory '…'`. The single-tenant default (`AzureADMyOrg`) **contradicts the `/common` issuer that ADR-0002 mandates**: `/common` routes to whatever tenant the browser session is in, and a single-tenant app exists in exactly one. Signing in from any other tenant fails. |
| `api.requestedAccessTokenVersion` | **`2`** | Entra refuses the audience change with `Application must accept Access Token Version 2`. It must be set **first**; `az ad app update --sign-in-audience` cannot set both. |
| `web.redirectUris` | The `/.auth/login/aad/callback` URL of **each** environment | `AADSTS50011: redirect URI … does not match`. Both must be listed — prod **and** staging. |

⚠ **`T-SMOKE-004` CANNOT CATCH ANY OF THIS, BY CONSTRUCTION.** It asserts that
`/.auth/login/aad` returns a 302 to `login.microsoftonline.com` carrying a
`redirect_uri` belonging to this deployment — and that was true throughout.
Every one of these three faults is evaluated by **Entra, after the redirect**,
so from the container's side a completely unusable sign-in is indistinguishable
from a working one. The smoke suite proves the request is *well-formed*, never
that it is *accepted*. Verify the last step in a browser after any change here.

To read the current state:

```powershell
az ad app show --id <client-id> --query "{audience:signInAudience, tokenVersion:api.requestedAccessTokenVersion, uris:web.redirectUris}" -o json
```

⚠ **Widening the audience does NOT widen access.** That is the whole point of
ADR-0002: `/common` already accepts every Microsoft account in the world, and
the only per-person check is the fail-closed `NEXTUP_ALLOWED_SUBJECTS`
allow-list above. A narrower audience would have locked the owner's *personal*
Microsoft account out while protecting nothing.

### 1.2 Data and storage

| Setting | Notes |
| --- | --- |
| `DATABASE_URL` | Prisma, provider `sqlserver`. Form is fixed — `specs/data-model.md` §16.1.1. Preferred auth is **managed identity (secretless)**; the fallback is a Key-Vault SQL login. ⚠ The database collation must be `Latin1_General_100_BIN2` (§16). |
| `AZURE_STORAGE_ACCOUNT` / `AZURE_STORAGE_BLOB_ENDPOINT` | Private `screenshots` container, managed identity (**Storage Blob Data Contributor on that container only**). **No account key, no SAS** (ADR-0006). |

### 1.3 Extraction — see §3, this is the quality-critical one

| Setting | Notes |
| --- | --- |
| `NEXTUP_EXTRACTOR` | `hybrid` (**default**, ADR-0001 Rev 2), `llm-vision`, `azure-vision-read`, `stub`. See §3. |
| `NEXTUP_AOAI_ENDPOINT` | Azure OpenAI endpoint. Config, not a secret. |
| `NEXTUP_AOAI_DEPLOYMENT` | Deployment name — `gpt-4.1`. **This is what pins the model.** |
| `NEXTUP_VISION_ENDPOINT` | Azure AI Vision **Read F0**, the deterministic OCR cross-check. Endpoint only; managed identity. |

⚠ **`NEXTUP_AOAI_MODEL` does not exist.** It is named in `docs/backlog.md`
(TASK-133) and in `specs/ai.md` §180, but no such variable is read by any
code and none is set anywhere. The model is selected **by
`NEXTUP_AOAI_DEPLOYMENT`**. Setting `NEXTUP_AOAI_MODEL` will do nothing
at all, silently — which is the worst outcome for a variable whose
purpose would be to control extraction quality.

### 1.4 Metadata

| Setting | Notes |
| --- | --- |
| `TMDB_API_KEY` | Container Apps **secret**. Never logged; **never sent to any AI service** (`specs/ai.md`, `specs/security.md` §6). |

⚠ **TMDB issues TWO credentials and only one of them works here.** Use the
**"API Key (v3 auth)"** — a 32-character hex string. Do **not** use the
**"API Read Access Token (v4 auth)"**, the long JWT beginning `eyJ`, even
though it is the more modern-looking of the two: `tmdbClient.ts` uses TMDB's
**v3 scheme**, sending the credential as the `api_key` **query parameter**,
and v4 tokens are only accepted in an `Authorization: Bearer` header. Both
strings are copied from the same TMDB settings page, so picking the wrong one
is a one-click mistake.

🛑 **And the wrong one fails as though TMDB were merely down.** TMDB answers a
bad credential with **401**, `tmdbClient.ts` correctly treats it as
non-retryable — but `apps/api/src/routes/tmdb.ts` converts every
`TmdbUnavailableError` into the same `TMDB_UNAVAILABLE` envelope, discarding
the status. The owner sees *"Couldn't reach TMDB. Try again in a moment."*,
**no 401 is written to any log**, and the invitation to retry is wrong: no
amount of waiting fixes a wrong key. If metadata never enriches and the logs
show only `TMDB_UNAVAILABLE`, **suspect the credential before suspecting
TMDB** — and confirm it outside the app with the one-line check below, which
is the fastest way to tell the two apart.

```bash
# 200 => the v3 key is good. 401 => wrong credential (most likely the v4 token).
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://api.themoviedb.org/3/configuration?api_key=$TMDB_API_KEY"
```

⚠ Run that against a **shell variable**, never a literal pasted into a
terminal you keep — the key is inside the URL, so it lands in shell history
and in any proxy log that records URLs. That is the same property that stops
this codebase logging TMDB URLs at all.

### 1.5 Image and memory

| Setting | Notes |
| --- | --- |
| `NEXTUP_MAX_DECODE_PIXELS` | **PAIRED with container memory — see §2. Never edit alone.** |

### 1.6 Registry

🛑 **There is deliberately NO registry credential, and you must not add
one.** The `ghcr.io` package is **public**; CI pushes with the built-in
`GITHUB_TOKEN` and Container Apps pulls **anonymously**. `infra/aca.bicep`
has no `registries` block on purpose (TASK-146, `docs/ghcr-pat.md`).

⚠ **A fine-grained PAT cannot authenticate to `ghcr.io` at all** — that is
the whole reason `docs/ghcr-pat.md` exists. Adding a half-configured
`registries` block converts anonymous pulls that work into authenticated
pulls that fail.

⚠ **`.env.example` contradicts this** as of 2026-08-20: it still carries
`GHCR_PULL_TOKEN=__REPLACE_ME__` with a comment describing a fine-grained
PAT. That block is **stale** and instructs the reader to create a
credential the architecture forbids. Reported under TASK-133; this
checklist is authoritative.

---

## 2. `NEXTUP_MAX_DECODE_PIXELS` is one setting in two places

🛑 **This value and the container's memory size are a PAIR. Changing
either one alone is a defect, and `T-INFRA-005` fails CI on it.**

The only two permitted combinations (`REQ-079`):

| vCPU | Memory | `NEXTUP_MAX_DECODE_PIXELS` |
| --- | --- | --- |
| `0.25` | `0.5Gi` | `25000000` ← **current, as-designed** |
| `0.5` | `1.0Gi` | `50000000` |

They must move **together, in one commit**.

- **Raising the pixel budget without the memory** removes the guard that
  prevents an OOM, so a large HEIC decodes until the kernel kills the
  container.
- **Raising the memory without the pixel budget** pays for headroom the
  guard will never let the process use.

⚠ **A byte-size ceiling is not a substitute for the pixel guard and must
not be implemented as one.** HEIC compression varies wildly — a 6 MiB
file can decode to 48 MP. The guard reads **pixel dimensions from the
image header**, before any decode buffer is allocated.

The owner chose deliberately to **start small and up-size reactively**
(`A43`). Do **not** pre-emptively raise the memory "to be safe". The
procedure, when it is genuinely needed, is
**`docs/runbooks/scale-up-memory.md`** — do not improvise it here.

---

## 3. `NEXTUP_EXTRACTOR` — the revert, and the downgrade that is not allowed

**The revert is one value and no code change.** Setting
`NEXTUP_EXTRACTOR=azure-vision-read` restores **ADR-0001 Revision 1**
behaviour (Azure AI Vision Read only). That path is kept live and
buildable precisely so that an Azure OpenAI outage, a quota exhaustion or
a failed abuse-monitoring approval (`TASK-134`) is a **configuration
change**, not an incident requiring a release.

🛑 **But it is not a cost lever.** `NFR-012a` makes extraction
**quality-first**. `hybrid` is the default because ADR-0001 Rev 2 made the
deterministic OCR cross-check part of the pipeline; `azure-vision-read`
alone is cheaper and *materially worse*.

**Changing the extractor or the deployed model for cost reasons is
non-compliance with `NFR-012a`, not an optimisation.** It is an
ADR-level decision. The same applies to swapping
`NEXTUP_AOAI_DEPLOYMENT` for a cheaper model.

⚠ `llm-vision` drops the cross-check too. It is a **diagnostics-only**
mode. `.env.example` shipped `llm-vision` as its default once and it was
corrected at `A48`; if you find it as a default again, that is a
regression, not a preference.

⚠ `stub` is the deterministic **test** extractor and
`apps/api/src/extraction/configFromEnv.ts` refuses to build it outside
tests. If production ever reports `stub`, stop — you are not running what
you think you are running.

---

## 4. HTTPS is a FUNCTIONAL dependency, not just a transport control

🛑 **If ingress ever serves this app over plain HTTP, the primary way the
owner gets screenshots into it silently disappears.**

`navigator.clipboard` is only defined in a **secure context**. Over
`http://` — including a plain LAN IP during local testing — the API is
simply absent, so the visible **"Paste screenshot" button** does not
render at all (`REQ-001`/`REQ-004`, ADR-0009, `A45`).

**The symptom, stated so it is diagnosable:**

> The "Paste screenshot" button is **missing**. Not disabled, not
> erroring — absent. There is no console error and no failed request. It
> looks like a UI regression or a bad deploy of the SPA.

**Why the failure is quiet — this is the part that wastes the afternoon:**
the other two ingest affordances **keep working perfectly**.

- **File selection** works (a file input needs no secure context).
- **Drag-and-drop** works.
- **Desktop Ctrl/Cmd+V works too**, because the `paste` *event* exposes
  `ClipboardEvent.clipboardData`, which is **not** gated on a secure
  context. Only the **button**, which calls `navigator.clipboard.read()`
  inside its click handler, is lost.

So a desktop user testing with Ctrl+V sees nothing wrong, and the loss
lands entirely on **iOS**, where the button is the only paste route — the
one platform the owner actually captures screenshots on.

**Verify, don't assume:**

```bash
az containerapp show -n ca-nextup-prod -g nextup-rg \
  --query "properties.configuration.ingress.{allowInsecure:allowInsecure,external:external,transport:transport}" -o json
```

`allowInsecure` **must** be `false`. Measured 2026-08-20: `false`,
`external: true`, `transport: Auto`, `targetPort: 3000` — correct.

---

## 5. What must never appear in configuration

| Never | Why |
| --- | --- |
| Any streaming-service credential | There are none, ever. No credentials, no scraping, no automated requests to any streaming service. |
| Any telemetry or analytics endpoint | Prohibited; `tools/check-deps.mjs` fails CI on the packages. |
| `AZURE_OPENAI_API_KEY` or any AOAI key | Key-based auth is prohibited — managed identity only (`T-INFRA-001`). |
| A storage account key or SAS | Managed identity only (ADR-0006). |
| A `ghcr.io` pull token | §1.6. The package is public. |
| Any TTL, retention or scheduled-deletion setting | The **absence** of such a mechanism *is* `REQ-028`. Azure SQL Agent jobs and Elastic Jobs are prohibited (`T-INV-013`, `T-MIG-001`). |
| A second ~30-day constant | `IMAGE_RETENTION_DAYS = 30` (screenshots, `NFR-019`) and `TMDB_METADATA_MAX_AGE_DAYS = 183` (metadata refresh, `NFR-014`) are **separate** and must never be merged (`T-INV-008`). There is **no** list-staleness constant. |

---

## 6. Related

- **`docs/runbooks/scale-up-memory.md`** — the memory/pixel up-size (§2).
- **`docs/runbooks/rollback.md`** — reverting a bad deploy. ⚠ Its two
  silent traps (`--all`, and traffic-to-a-deactivated-revision) apply to
  any revision switch, including one caused by a config change.
- **`docs/runbooks/incident-playbook.md`** — what to do when something is
  actually wrong.
- **`docs/runbooks/deployment-identity.md`**, **`vision-account-reuse.md`**.
- **`.env.example`** — local development. Placeholders only; real values
  are Container Apps secrets / Key Vault references.
