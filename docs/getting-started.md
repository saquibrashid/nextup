# Getting started

Clone, install, start the local test stack, run the whole suite — **offline**.
That last word is the point: `NFR-003` makes CI the implementer's only feedback
loop, so the loop must not depend on a network that might be down or a service
that might rate-limit you.

---

## 1. Prerequisites

| Tool       | Version                        | Why                                                                                                 |
| ---------- | ------------------------------ | --------------------------------------------------------------------------------------------------- |
| **Node**   | 20.x — see [`.nvmrc`](../.nvmrc) | The engine the container runs. `nvm use` picks it up.                                               |
| **npm**    | 10+ (ships with Node 20)       | Workspaces.                                                                                          |
| **Docker** | any current version            | The SQL Server 2022 and Azurite containers the integration suite runs against.                       |

You do **not** need an Azure subscription to develop or to run the suite. Azure
is needed only to deploy.

---

## 2. Install

```bash
git clone https://github.com/saquibrashid/nextup.git
cd nextup
npm ci
cp .env.example .env      # then fill in the placeholders
```

`npm ci` — not `npm install`. The lockfile is the source of truth; an install
that can silently resolve a different tree is not reproducible.

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

When you are done:

```bash
docker compose -f docker-compose.test.yml down -v
```

---

## 4. Run the suite

```bash
npm run test:unit      # pure domain logic, no containers needed
npm run test:int       # API + store, against the containers above
npm run test:web       # component and screen states (jsdom)
npm run test:e2e       # Playwright: Chromium + Mobile Safari
npm run test:a11y      # axe; zero serious/critical
npm run golden         # the extractor golden suite, replayed recordings only
npm run test:infra     # SKU pins, no-TTL, T-MIG-001
npm run test:meta      # AC to named-test mapping completeness
```

Or the gates CI runs, in one go:

```bash
npm run lint && npm run format:check && npm run typecheck && npm run coverage
```

The exit criterion for this document is that a **clean machine with no network**
(after the one-time `npm ci` and image pull) can run:

```bash
npm run test:unit && npm run test:int
```

The golden extractor suite is offline by construction: it replays recorded
responses and never calls Azure OpenAI or Azure AI Vision.

---

## 5. Run the app locally

```bash
npm run dev            # Vite dev server on :5173, proxying /api to :3000
```

In production there is **one image, one process, one port**: the Express API
also serves the built SPA. To run exactly what ships:

```bash
npm run build
docker build -t nextup:local .
docker run --rm -p 3000:3000 nextup:local
# http://localhost:3000/        → the SPA
# http://localhost:3000/api/me  → 401 until the auth middleware lands
```

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
