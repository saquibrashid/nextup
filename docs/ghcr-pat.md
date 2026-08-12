# Registry credential runbook (`ghcr.io`)

**Task:** TASK-146 · **Risk:** `RSK-031` (registry give-up) · **Related:**
TASK-007 (`deploy.yml`), ADR-0003 Rev 3

This runbook covers how the nextup container image is published to and pulled
from `ghcr.io`, and what to do when that breaks.

---

## 1. The current design: a PUBLIC package and NO pull credential

**There is no registry PAT in this system.** Both halves of the registry path
are credential-free:

| Direction | Who | Credential |
| --- | --- | --- |
| **Push** (CI publishes the image) | `.github/workflows/deploy.yml` | The built-in **`GITHUB_TOKEN`**. Nothing to mint, nothing to store, nothing to rotate. |
| **Pull** (Azure Container Apps starts a revision) | `ca-nextup-prod` / `ca-nextup-staging` | **None.** The package is public, and GitHub serves public container images anonymously. |

Consequently `infra/aca.bicep` declares **no registry credential** for
`ghcr.io`, and there is no Key Vault secret, no ACA secret, and no expiry date
to track.

### 1.1 Why this is the design (read before "fixing" it)

The backlog originally called for a **fine-grained PAT** scoped `read:packages`.
**That token does not work.** GitHub's Container registry documentation states
it twice, verbatim:

> GitHub Packages only supports authentication using a personal access token
> (classic).

A fine-grained PAT authenticates against `ghcr.io` with a **403**. The failure
has no code cause, which is precisely the symptom this runbook exists to make
diagnosable — so it is recorded here rather than left to be rediscovered.

Once fine-grained is off the table, the only working token is a **classic**
PAT, and classic PAT package scopes are **account-wide**: `read:packages`
grants read to *every* private package on the account, with no way to narrow it
to one repository. Storing an account-wide credential in Azure in order to keep
private an image built entirely from an **already-public repository** is a
worse trade than publishing the package.

Making the package public therefore does not "accept" `RSK-031`'s registry
half — it **removes** it. There is no credential left to expire.

### 1.2 What the public image actually exposes

The final Docker stage copies only `packages/domain/dist`, `apps/api/dist`,
`apps/web/dist` and production `node_modules`. Every one of those is built from
source that is already public at `github.com/saquibrashid/nextup`.
`.dockerignore` excludes `.env`, `.env.*`, `.git` and the whole `infra/` tree.

The disclosure delta over the public repo is therefore **convenience only**: an
attacker can `docker pull` and enumerate dependency versions instead of reading
the already-public `package-lock.json`.

**Runtime secrets are never in the image.** The SQL connection string, the
Azure OpenAI key and the Vision key are Container Apps secrets, injected as
environment variables at start.

### 1.3 The one real risk, and its compensating control

A public image has one genuine downside: if a secret is ever *baked in* by a
future change, registry crawlers cache it within minutes and the exposure is
permanent and unrecoverable. A private image would have contained it.

`.dockerignore` guards this by **filename**, which does not catch a secret
hardcoded into a source file. TASK-007's `deploy.yml` must therefore run a
**secret scan of the built image before the push step**, and fail the deploy on
a finding. That converts the one scenario where a private package would have
helped into a build-time failure.

---

## 2. Making the package public (one-time, after the first push)

A package's visibility can only be set once the package exists, so this runs
**after** the first successful `deploy.yml` run.

1. Go to `https://github.com/users/saquibrashid/packages/container/nextup/settings`.
2. Under **Danger Zone** → **Change package visibility** → select **Public** →
   confirm by typing the package name.
3. Under **Manage Actions access**, confirm the `saquibrashid/nextup`
   repository has at least **Read**. (Set automatically when the workflow
   publishes the package; verify rather than assume.)

**Verify anonymously — do not trust the settings page.** From a shell with no
GitHub credentials in the environment:

```bash
docker logout ghcr.io
docker pull ghcr.io/saquibrashid/nextup:latest
```

If that succeeds, Azure Container Apps can pull it. If it fails with
`denied` or `unauthorized`, the package is still private and the next
revision will fail to start.

---

## 3. When a deployment fails with a registry error

**Symptom:** a new revision never becomes healthy; the container never starts;
Container Apps shows an image-pull failure such as
`UNAUTHORIZED: authentication required` or `denied`. **No application code
changed.** This looks like an app bug and is not one.

Diagnose in this order:

1. **Is the package still public?** Run the anonymous `docker pull` in §2. The
   most likely cause is that visibility was reset — for example by deleting and
   republishing the package, which recreates it as **private** by default.
2. **Did the image tag actually get pushed?** Check the `deploy.yml` run and
   `https://github.com/saquibrashid/nextup/pkgs/container/nextup`.
3. **Did someone add a registry credential to `infra/aca.bicep`?** A
   half-configured credential fails *closed* — an ACA `registries` block with a
   bad or expired secret is worse than no block at all, because the anonymous
   path is no longer attempted.

Only if the package must stay private does §4 apply.

---

## 4. Fallback: the private-package path (classic PAT)

**Not currently in use.** Follow this ONLY if a deliberate decision is made to
make the package private. It reintroduces `RSK-031` in full — a quiet-expiry,
account-wide credential — so record the reason for the change here when it
happens.

### 4.1 Generation

1. Create a **classic** PAT (fine-grained will not work — see §1.1) at
   `https://github.com/settings/tokens/new?scopes=read:packages`.
   Using that exact URL matters: selecting `write:packages` in the UI
   **silently also selects the broad `repo` scope**.
2. Scope: **`read:packages` only.** The CI push does *not* need a PAT — it uses
   `GITHUB_TOKEN` — so `write:packages` must not be granted.
3. Expiry: choose the **longest permitted expiry** (365 days). Do **not**
   choose "No expiration": a non-expiring account-wide token that leaks is
   valid forever.
4. Name it `nextup-ghcr-pull` so it is identifiable in the token list.
5. **Record the expiry date immediately** — see §4.4.

### 4.2 Storage

The token is a secret and **must never be committed**. `.env.example` carries a
placeholder only.

1. Store it in Key Vault as `ghcr-pull-token`.
2. Reference it from `infra/aca.bicep` as a Key Vault-referenced ACA secret
   named `ghcr-token`, and add a `registries` entry with
   `server: 'ghcr.io'`, `username: 'saquibrashid'`,
   `passwordSecretRef: 'ghcr-token'`.
3. Redeploy. A secret change alone does not restart a running revision —
   **create a new revision** or the old one keeps the stale credential.

### 4.3 Rotation

Rotate **before** expiry, not after — after means an outage.

1. Generate a replacement per §4.1.
2. Add it as a **new version** of the Key Vault secret.
3. Create a new ACA revision so the new version is picked up.
4. Verify the revision reaches a healthy state and serves traffic.
5. **Only then** delete the old PAT from GitHub. Deleting first means a
   rollback to the previous revision cannot pull its image.

### 4.4 The dated reminder

The failure mode is a deployment that breaks **weeks later** with an auth error
for no code reason. A calendar entry is the only thing that prevents it.

Create a **recurring annual calendar reminder** titled
`nextup: rotate ghcr.io pull PAT (docs/ghcr-pat.md §4.3)`, set for
**30 days before the token's expiry date**, and record the values here when the
token is minted:

| Field | Value |
| --- | --- |
| Token name | `nextup-ghcr-pull` |
| Created | _(not minted — the package is public; see §1)_ |
| Expires | _(n/a)_ |
| Reminder set for | _(n/a)_ |

---

## 5. Invariants

- The PAT, if one ever exists, is **never** committed to this repository.
- The CI push uses `GITHUB_TOKEN`, never a PAT.
- `write:packages` is never granted to a stored credential.
- `deploy.yml` links to this runbook in a comment (TASK-007).
- `deploy.yml` secret-scans the built image before pushing it (§1.3).
