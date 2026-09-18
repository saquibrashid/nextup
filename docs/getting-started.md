# Getting started

Clone, install, start the local test stack, run the whole suite — **offline**.
That last word is the point: `NFR-003` makes CI the implementer's only feedback
loop, so the loop must not depend on a network that might be down or a service
that might rate-limit you.

---

## 1. Prerequisites

| Tool       | Version                        | Why                                                                                                 |
| ---------- | ------------------------------ | --------------------------------------------------------------------------------------------------- |
| **Node**   | 22.x — see [`.nvmrc`](../.nvmrc) | The engine the container runs. `nvm use` picks it up.                                               |
| **npm**    | 10+ (use the version supplied with Node 22) | Workspaces. |
| **Docker** | any current version            | The SQL Server 2022 and Azurite containers the integration suite runs against.                       |

You do **not** need an Azure subscription to develop or to run the suite. Azure
is needed only to deploy.

---

## 2. Install

```bash
git clone https://github.com/saquibrashid/nextup.git
cd nextup
npm ci
npx prisma generate --schema prisma/schema.prisma
npx playwright install chromium webkit
cp .env.example .env      # then fill in the placeholders
```

`npm ci` — not `npm install`. The lockfile is the source of truth; an install
that can silently resolve a different tree is not reproducible.

Prisma generation and the browser installation are separate setup steps.
On Linux, install Playwright's system dependencies as well
(`npx playwright install --with-deps chromium webkit`). Complete these downloads
while online; the offline claim applies to the deterministic suites afterwards,
not to installation, deployed smoke tests or `golden:live`.

> **Behind a proxy?** If the public npm registry is unreachable on your network,
> set your registry in your **user** npm config (`npm config set registry <url>`)
> rather than committing an `.npmrc` to the repo — GitHub-hosted runners cannot
> resolve an internal proxy, and committing one breaks CI for everyone. For
> container builds, pass it per build instead:
>
> ```bash
> docker build --build-arg NPM_REGISTRY=<url> -t nextup:local .
> ```

---

## 3. Start the local test stack

```bash
docker compose -f docker-compose.test.yml up -d
```

This starts two containers that mirror the CI service containers exactly:

- **`mcr.microsoft.com/mssql/server:2022-latest`** — the same engine Azure SQL
  Database runs. Three of the data-model invariants are database constraints, so
  the integration tests assert the **store** refuses the bad write. A mock could
  not make that assertion.
- **`mcr.microsoft.com/azure-storage/azurite:latest`** — the blob emulator for
  the screenshot store.

Both images are pulled **once**. Everything after that runs offline.

Wait for SQL Server to report healthy before running the integration suite — it
is not ready the instant the port opens (typically 10–30 s):

```bash
docker compose -f docker-compose.test.yml ps
```

Set the database environment **in the terminal that runs migrations and tests**.
For the disposable local container only (PowerShell):

```powershell
$env:DATABASE_URL = 'sqlserver://localhost:1433;database=nextup_test;user=sa;password=Str0ng!Passw0rd_ci;encrypt=true;trustServerCertificate=true;connectionLimit=5'
$env:AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true'
Remove-Item Env:AZURE_STORAGE_BLOB_ENDPOINT -ErrorAction SilentlyContinue
npm run db:test
```

The password above is the public local-test credential in
`docker-compose.test.yml`, never a production credential. `db:test` creates
`nextup_test` with `Latin1_General_100_BIN2` before migrating it. Do not point
tests at a database holding data you want to keep.

To stop without deleting the local database, use `docker compose -f
docker-compose.test.yml stop`. `down -v` **deletes the volumes**; use it only
when intentionally resetting your own disposable stack. On a shared machine,
coordinate ports and container ownership before starting or stopping services.

---

## 4. Run the suite

```bash
npm run test:unit      # pure domain logic, no containers needed
npm run test:int       # API + store, against the containers above
npm run test:web       # component and screen states (jsdom)
npm run build --workspace apps/web  # Playwright serves the prebuilt SPA
npm run test:e2e       # Playwright: Chromium + Mobile Safari
npm run test:a11y      # axe; zero serious/critical
npm run golden         # the extractor golden suite, replayed recordings only
npm run test:infra     # SKU pins, no-TTL, T-MIG-001
npm run test:meta      # AC to named-test mapping completeness
```

A subset of the checks CI runs (not the complete CI gate):

```bash
npm run lint && npm run format:check && npm run typecheck && npm run coverage
```

The exit criterion for this document is that a **clean machine with no network**
(after the downloads, Prisma generation, container health wait and database
preparation above) can run:

```bash
npm run test:unit && npm run test:int
```

The golden extractor suite is offline by construction: it replays recorded
responses and never calls Azure OpenAI or Azure AI Vision.

---

## 5. Run the app locally

There are **two development processes**. Copying `.env` does not by itself load
variables into the API's Node process. Edit the local `.env` for local services:

- Set `DATABASE_URL` to the disposable local database prepared in section 3,
  not the example's unmigrated `nextup` database. Integration tests may mutate
  this database; do not use it as your personal watchlist.
- Remove the `AZURE_STORAGE_BLOB_ENDPOINT` placeholder entirely; if present it
  takes precedence over the Azurite connection string. Keep
  `AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true`.
- Set `NEXTUP_DEV_SUBJECT=local-owner` and
  `NEXTUP_ALLOWED_SUBJECTS=local-owner`. The development principal is not part
  of the production build and does not bypass the allow-list.
- Leave real provider configuration absent unless intentionally exercising live
  services. The deterministic tests inject their own fakes; `NEXTUP_EXTRACTOR=stub`
  is test-only and is **rejected** by the environment-built API extractor.

Terminal 1, from the repository root (PowerShell):

```powershell
npm run build --workspace packages/domain
npx tsc -p apps\api\tsconfig.dev.json
node --env-file=.env --watch apps\api\dist-dev\dev\server.js
```

Re-run the TypeScript compile after API source edits; Node watches the compiled
JavaScript, not the TypeScript sources. Alternatively, with variables already
exported into the shell, `npm run dev --workspace @nextup/api` performs that
compile and starts the watcher.

Terminal 2, from the same repository root:

```powershell
npm run dev            # Vite on :5173, proxying /api to the API on :3000
```

Open `http://localhost:5173`. Real extraction and metadata lookup need their
configured providers and may incur cost; running the deterministic suite offline
is not the same as running a fully functional offline application.

In production there is **one image, one process, one port**: the Express API
also serves the built SPA. To run exactly what ships:

```bash
npm run build
docker build -t nextup:local .
docker run --rm -p 3000:3000 nextup:local
# http://localhost:3000/        → the SPA
# http://localhost:3000/api/me  → 401 without an Easy Auth principal
```

The standalone production container has no development sign-in shim. Configure
its database, blob and provider environment for a real deployment; merely
starting this image does not establish a signed-in local development session.

---

## 6. ⚠ HTTPS is a **functional** dependency, not just a security control

**`navigator.clipboard` does not exist on `http://`.** It is gated behind a
[secure context], so running the dev server and opening it from your phone at
`http://<LAN-IP>:5173` shows **no "Paste screenshot" button at all** — and the
failure looks exactly like a missing feature rather than a missing certificate.
Do not debug that from scratch.

Paste is the **primary** ingest affordance (REQ-001, ADR-0009), so this is not a
corner you can skip while developing.

Two supported ways to exercise the paste path:

1. **Staging over HTTPS** — Container Apps ingress is HTTPS-only, so the deployed
   staging environment just works.
2. **A trusted HTTPS tunnel** to your dev server, so the origin is `https://` and
   the certificate is trusted by the device.

**The desktop `Ctrl`/`Cmd`+`V` listener is unaffected** — the `paste` event needs
no secure context, so it works over plain `http://` on a laptop. Only the
explicit "Paste screenshot" button, which calls `navigator.clipboard.read()`,
requires HTTPS.

Production is HTTPS-only, so this is a **local-development hazard only**.

[secure context]: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts

---

## 7. Where to go next

- [`docs/backlog.md`](backlog.md) — the work order. Start at the top.
- [`specs/testing.md`](../specs/testing.md) — the AC → named-test mapping. That
  mapping is the definition of done.
- [`.github/copilot-instructions.md`](../.github/copilot-instructions.md) — the
  load-bearing invariants. Read before writing feature code.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — branching, commits, what CI enforces.
