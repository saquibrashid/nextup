# Runbook — deployment identity (GitHub OIDC → Azure)

The `deploy` workflow authenticates to Azure with **workload identity
federation**: no client secret exists for the deploy principal, and no Azure
credential is stored in GitHub. `azure/login` exchanges a short-lived GitHub
OIDC token for an Azure access token.

This runbook exists because the failure mode is a single opaque error string,
and the obvious reading of it is wrong.

## The principals

| Purpose                       | App                     | appId                                  |
| ----------------------------- | ----------------------- | -------------------------------------- |
| Easy Auth (owner sign-in)     | `nextup`                | `b374ba10-f9f9-4c78-ae6e-64e9c8d1cf0a` |
| Deployment (GitHub → Azure)   | `nextup-github-deploy`  | `786463aa-8a33-4437-b8aa-fa6617ce2832` |

The deploy principal holds **Owner scoped to `nextup-rg` only** — not
subscription-wide, and not Contributor. Contributor is insufficient: the
template creates role assignments (`infra/rbac.bicep`, invoked from
`infra/main.bicep`), and creating a role assignment requires
`Microsoft.Authorization/roleAssignments/write`, which Contributor explicitly
denies. A deployment that fails only at the RBAC module, after provisioning
everything else, is this.

## ⚠ The subject claim is NOT `repo:<owner>/<repo>:...`

`AADSTS700213: No matching federated identity record found for presented
assertion subject ...` reads like the credential is missing. It usually is not.
GitHub is emitting **immutable numeric IDs** in the subject:

```
repo:saquibrashid@42775548/nextup@1331377210:environment:staging
```

not the documented, name-based form:

```
repo:saquibrashid/nextup:environment:staging
```

`42775548` is the account id and `1331377210` is the repository id. Both are
immutable, which is the point — a federated credential written against them
survives a rename of either the account or the repository, where the name-based
form silently stops matching.

The authoritative value is served by the API, and it does **not** agree with
the neighbouring boolean:

```powershell
gh api repos/saquibrashid/nextup/actions/oidc/customization/sub
# => { "use_default": true,
#      "use_immutable_subject": false,
#      "sub_claim_prefix": "repo:saquibrashid@42775548/nextup@1331377210" }
```

`use_immutable_subject: false` while `sub_claim_prefix` is the immutable form.
**Trust `sub_claim_prefix`, or better, trust the token** — `azure/login` prints
the exact subject it presented in the job log, immediately above the error. Read
that line rather than deriving what the subject "should" be.

Because GitHub is evidently mid-transition here, **both forms are registered**.
Six credentials exist where three would do, deliberately: if GitHub flips the
prefix back, the deployment keeps working instead of failing at the next push.

| Name                | Subject                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `gh-main`           | `repo:saquibrashid/nextup:ref:refs/heads/main`                    |
| `gh-env-staging`    | `repo:saquibrashid/nextup:environment:staging`                    |
| `gh-env-production` | `repo:saquibrashid/nextup:environment:production`                 |
| `gh-imm-main`       | `repo:saquibrashid@42775548/nextup@1331377210:ref:refs/heads/main` |
| `gh-imm-staging`    | `repo:saquibrashid@42775548/nextup@1331377210:environment:staging` |
| `gh-imm-prod`       | `repo:saquibrashid@42775548/nextup@1331377210:environment:production` |

Do not "tidy" the duplicates away. Removing the pair that happens to be unused
today is a change with no visible effect until GitHub moves.

### Adding a credential

```powershell
$body = @{
  name      = 'gh-imm-staging'
  issuer    = 'https://token.actions.githubusercontent.com'
  subject   = 'repo:saquibrashid@42775548/nextup@1331377210:environment:staging'
  audiences = @('api://AzureADTokenExchange')
} | ConvertTo-Json -Compress
Set-Content .git\fic.json -Value $body -NoNewline
az ad app federated-credential create --id 786463aa-8a33-4437-b8aa-fa6617ce2832 --parameters '@.git\fic.json'
Remove-Item .git\fic.json -Force
```

The subject must match **exactly** — it is compared as an opaque string. There
is no wildcard, and `environment:staging` does not match `ref:refs/heads/main`
even for a job running on `main`, because a job with an `environment:` gets the
environment form.

## Other preconditions the error will not tell you about

- **`permissions: id-token: write`** must be on the job, not just the workflow.
  Without it no OIDC token is minted at all and the error is different
  (`Unable to get ACTIONS_ID_TOKEN_REQUEST_URL`).
- **The GitHub environment must exist.** `staging` and `production` are created
  on first use by the workflow referencing them; a credential naming an
  environment that has never run matches nothing.
- **The ghcr package must be public.** ACA pulls anonymously with no registry
  credential (ADR-0003), so a private package fails at container start —
  *after* a fully successful deployment. Verify the property that actually
  matters, an unauthenticated pull, rather than the visibility field:

  ```powershell
  $t = (curl.exe -s "https://ghcr.io/token?scope=repository:saquibrashid/nextup:pull&service=ghcr.io" | ConvertFrom-Json).token
  curl.exe -s -o NUL -w "%{http_code}" -H "Authorization: Bearer $t" `
    -H "Accept: application/vnd.oci.image.index.v1+json" `
    "https://ghcr.io/v2/saquibrashid/nextup/manifests/<sha>"
  # expect 200
  ```

## Reading the logs

The REST logs endpoint returns **403** for this repository, but the `gh` CLI
reads them:

```powershell
$env:GH_CONFIG_DIR = "C:\Users\srashid\.ghprofiles\gh-personal"
gh run list --limit 5 --json databaseId,name,headSha,conclusion
gh run view <runId> --json jobs        # step-level pass/fail
gh run view --job <jobId> --log-failed # the actual error text
```

## Validating a template change without a CI round-trip

`az deployment group validate` runs read-only against the real resource group
and catches parameter and template errors in about a minute:

```powershell
az deployment group validate --resource-group nextup-rg --template-file infra/main.bicep `
  --parameters environmentName=staging location=eastus2 containerImage=<image> ... `
  --query "{state:properties.provisioningState}" -o json
```
