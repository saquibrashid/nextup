# Runbook — database access (TASK-141)

**Who runs this:** the owner, once per database, after the first deploy that
carries `DATABASE_URL`. Roughly five minutes.

**Symptom if you skip it:** every request that touches data fails. The app
authenticates to Entra successfully and is then refused by SQL with
`Login failed for user '<token-identified principal>'`. The container is
*Healthy* throughout, because Container Apps' probe is TCP and the app starts
fine — nothing is wrong until a query runs.

---

## 0. How the two credentials divide

There are two principals, and this split is deliberate.

| | Principal | Holds a secret? | Used for |
|---|---|---|---|
| **Runtime** | Container App system-assigned managed identity (`ca-nextup-prod`) | **No** | Every application query |
| **Deploy** | SQL admin login (`SQL_ADMIN_LOGIN` / `SQL_ADMIN_PASSWORD` GitHub secrets) | Yes, in GitHub | `prisma migrate deploy` only |

The deploy credential **never reaches the container** — it is injected into a
CI job and discarded. So the running application holds no database credential
at all, which is what `specs/security.md` §7 asks for, while migrations keep
the DDL rights the application must not have.

`DATABASE_URL` in the container is therefore **credential-free** —
`sqlserver://<server>:1433;database=<db>;encrypt=true` and nothing else.
`apps/api/src/db/connection.ts` derives the auth mode from that absence: a URL
with no `user`/`password` has nothing to authenticate with except the managed
identity.

> ⚠ **Adding `user=`/`password=` to `DATABASE_URL` silently switches the
> running app back to SQL-login auth**, and every test still passes. If it ever
> needs a credential, it must become a `secretRef` and the change argued
> against §7.

---

## 1. Grant the identity (once per database)

`CREATE USER … FROM EXTERNAL PROVIDER` requires a **Microsoft Entra** session.
A SQL login cannot run it — see the header of `infra/sql/grant-app-identity.sql`
for why, and why the `WITH SID` workaround is deliberately not used.

You are the server's Entra administrator, so you can run it. Easiest route:

1. Azure Portal → SQL databases → **`nextup`** → **Query editor (preview)**.
2. Sign in with **Microsoft Entra authentication** (not SQL authentication).
   The account must be `saquib.rashid@outlook.com` — the server's Entra admin.
3. Paste the contents of **`infra/sql/grant-app-identity.sql`** and run it.
4. Confirm the final `SELECT` returns **two rows**: `db_datareader` and
   `db_datawriter`.

Then repeat for staging:

- database **`nextup_staging`**, and change the one line at the top to
  `DECLARE @app sysname = N'ca-nextup-staging';`

> ⚠ **Match the identity to the database.** Granting `ca-nextup-staging` on
> `nextup` would hand the staging app the owner's real list.

### If you prefer the command line

```bash
az login   # as the Entra admin account, in tenant d39e0a67-…
sqlcmd -S sql-nextup-hriut4gw7lgg4.database.windows.net -d nextup \
       -G -i infra/sql/grant-app-identity.sql
```

`-G` selects Entra auth. Without it `sqlcmd` attempts a SQL login and the
`CREATE USER` fails with a principal-not-found error that reads like the
identity is missing when in fact the *session type* is wrong.

---

## 2. Verify

⚠ **The two obvious checks both prove nothing, and one of them looks like
proof.** `curl`ing the public URL signed out returns Easy Auth's `401`
identically whether the grant worked or not, and an *absence* of login errors
in the container log is not evidence either — Prisma opens the connection
lazily, so a container that has never served a request has never authenticated.

The only conclusive check runs a real query **from inside the running
container**, past Easy Auth, using the app's own identity and its own
`DATABASE_URL`. This is read-only and writes nothing.

```powershell
$js = @'
const s = (process.env.NEXTUP_ALLOWED_SUBJECTS || '').split(',')[0];
const h = Buffer.from(JSON.stringify({ claims: [ { typ: 'iss', val: 'x' }, { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: s } ] })).toString('base64');
console.log('SUBJECT_PRESENT', Boolean(s), 'DBURL_PRESENT', Boolean(process.env.DATABASE_URL));
fetch('http://127.0.0.1:3000/api/titles', { headers: { 'x-ms-client-principal': h } })
  .then(r => r.text().then(t => console.log('DBPROBE_STATUS', r.status, t.slice(0, 400))))
  .catch(e => console.log('DBPROBE_ERR', e.message));
'@
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($js))
$rev = az containerapp revision list -n ca-nextup-prod -g nextup-rg `
  --query "sort_by([].{n:name,t:properties.createdTime},&t)[-1].n" -o tsv
az containerapp exec -n ca-nextup-prod -g nextup-rg --revision $rev `
  --command "node -e eval(Buffer.from('$b64','base64').toString())"
```

A healthy system answers:

```text
SUBJECT_PRESENT true DBURL_PRESENT true
DBPROBE_STATUS 200 {"items":[],"nextCursor":null,"limit":50}
```

`200` with a JSON page body is the proof: the app obtained a token for its
managed identity, logged in to Azure SQL, and ran a `SELECT`. A missing grant
shows as `DBPROBE_STATUS 500` plus
`Login failed for user '<token-identified principal>'`.

⚠ **Two quoting traps, both of which fail silently by printing nothing.**
`az containerapp exec` splits `--command` on spaces, so `sh -c "a | b"` runs
`sh -c a` and discards the rest — hence the single-token
`node -e eval(Buffer.from(...))` form, which contains no spaces inside the
argument. And the probe must stay asynchronous: the pending `fetch` is what
keeps the event loop alive long enough to print.

~~Superseded, because neither step is conclusive: "`curl -sS
https://ca-nextup-prod.<region>.azurecontainerapps.io/api/titles` — should
return rows, not a login error. Signed out you will get Easy Auth's `401`
regardless; check while signed in, or read the container log with `az
containerapp logs show -n ca-nextup-prod -g nextup-rg --subscription
d2030464-c98d-4d14-acf2-378afb0bd760 --tail 50`."~~

---

## 3. When you have to do this again

- The database is dropped and recreated (the user lives **in** the database,
  not on the server).
- A new environment is added.
- The Container App is deleted and recreated — a **new** system-assigned
  identity gets a new principal, and the old database user no longer matches.
  Renaming or recreating the app therefore needs this run again.

Not needed for: ordinary deploys, revision changes, image updates, or scaling.

---

## 4. What this runbook deliberately does not do

- **No `db_owner`.** The app reads and writes rows; it never changes the
  schema. A defect in request-handling code must not be able to drop a table.
- **No Entra-only enforcement on the server.** `azureADOnlyAuthentication`
  stays off because the SQL login is the *defined fallback* (TASK-006/141) and
  is what applies migrations. Turning it on breaks deploys.
- **No automation of the grant.** It is a one-time, Entra-session-only
  statement; automating it would mean either giving the deploy principal
  directory permissions or hand-computing a SID that fails silently when wrong.
