# ADR-0004 — Application stack: TypeScript end to end (React + Vite front, Node + Express back)

| | |
|---|---|
| **Status** | Accepted — **Revision 2 (2026-08-25)**: styling is hand-authored CSS, not Tailwind; client data access is ADR-0012's typed `fetch` client, not TanStack Query. Two stale entries (`@azure/cosmos`, React 18) corrected in place. |
| **Date** | 2026-08-10 |
| **Deciders** | solution-architect (phase 7), autonomous |
| **Forced by** | **NFR-002, NFR-003, NFR-004** (and ASM-028/ASM-029), NFR-006, NFR-007, NFR-012 |

## Context

`ASM-028`/`ASM-029` and `NFR-002` establish something that is normally a
soft preference and is here a hard architectural input: **nextup will be
implemented by GitHub Copilot in autopilot mode, and the human
implementation budget is approximately zero.** No one will be available
to unpick a subtle framework interaction, debug a build-tool edge case,
or exercise judgement over an ambiguous API. `NFR-004` states the
consequence directly — "technology selection SHOULD favour mainstream,
well-documented, widely-used stacks … because agent code-generation
quality correlates with how well-represented a technology is in training
data and public documentation. Any deviation MUST be justified in an ADR
against this constraint."

**This ADR states that reasoning explicitly, because it is a legitimate
technical criterion in this project and not a cop-out.** In a normal
project, "how much of this framework is in the model's training data"
would be an odd selection criterion. Here it is a direct predictor of
whether the software gets built at all — it is the same class of
criterion as "can the team operate it", which is the first design
principle in any architecture, applied to a team of one non-human
implementer. Choosing a technically superior but sparsely-documented
framework transfers cost onto the one resource this project does not
have.

The functional demands on the stack are modest and non-exotic:

- Mobile-first responsive UI at 320px and 1024px (NFR-006, NFR-007).
- A list of a few hundred rows with client-side filter and sort
  (REQ-031…REQ-038) — no virtualisation strategy required, no charts,
  no real-time, no offline, no collaboration.
- A review pass with rich per-item interaction (Epics D and E) — this is
  the most complex UI in the product and it is still a form.
- A JSON API, an image upload path, an OCR call, TMDB calls, and a
  document store.
- **Every acceptance criterion must map to an executable test**
  (NFR-003), so the test toolchain matters as much as the framework.

## Options considered

### Option A — TypeScript everywhere: React + Vite (front), Node + Express (back)

| | |
|---|---|
| Summary | React 18 + TypeScript + Vite + Tailwind CSS for the SPA; Node 20 + TypeScript + Express for the API; Vitest for unit/integration, Playwright for end-to-end. Both halves build into one container image (ADR-0003). |
| Pros | **The single most-represented combination in public code and documentation** — which under NFR-004 is the primary criterion. One language, one package manager, one type system, one test runner across the whole repository: an agent never context-switches idiom mid-task, and shared domain types (`Title`, `ServiceListing`, `UploadBatch`) are literally the same TypeScript declarations on both sides, so an API contract drift becomes a compile error rather than a runtime surprise. Express is the most boring HTTP server in existence — enormous documentation surface, no magic, no conventions to learn. Vite's dev server and build are fast and unopinionated. Playwright is first-class for the responsive-viewport assertions NFR-006/NFR-007 need (US-037). |
| Cons | Express is unopinionated to a fault: routing, validation and error handling are all conventions the implementer must impose consistently, and an autonomous agent will drift without a stated pattern. Node's ecosystem churn means dependency choices age. Two build steps (SPA and server) in one image. |
| Cost | $0 — all open source. |
| Reversal cost | Front and back are independently replaceable; the shared-types benefit is what would be lost. |

### Option B — Next.js (React, full-stack, one framework)

| | |
|---|---|
| Summary | One Next.js application providing both UI and API routes. |
| Pros | Very mainstream and very well documented. One framework, one build, file-system routing, excellent developer ergonomics. |
| Cons | **The App Router / Pages Router split is exactly the wrong shape for an agent-implemented build**: public documentation and training data are heavily divided between two incompatible paradigms with overlapping vocabulary, and server components, server actions, caching semantics and "use client" boundaries are the highest-frequency source of subtly-wrong generated code in the entire React ecosystem. Server-side rendering also adds weight to the container and to cold start (ADR-0003) for a single-user app that needs no SEO and no first-paint SSR benefit. It is more framework than the problem requires. |
| Cost | $0. |
| Reversal cost | High — Next.js is not a library you remove, it is the application. |

### Option C — .NET 8 / ASP.NET Core API + React SPA

| | |
|---|---|
| Summary | ASP.NET Core minimal API with a separate React front end. |
| Pros | Best-in-class Azure integration (managed identity, Cosmos SDK, configuration, health checks all first-party). Strong static typing, excellent tooling, mature testing story, and a strongly conventional project layout — an agent has less room to invent. Exceptionally stable APIs across versions. |
| Cons | **Two languages, two toolchains, two package managers, two test runners, and hand-maintained type parity across the API boundary** — every one of which is a place for an autonomous implementer to lose the thread. The multi-stage container build (SDK + Node for the SPA) is meaningfully more complex than Option A's. There is no functional requirement that .NET satisfies better. |
| Cost | $0. |
| Reversal cost | High — a full rewrite of one half. |

### Option D — Python (FastAPI) + React

| | |
|---|---|
| Summary | FastAPI backend, React front end. |
| Pros | FastAPI is excellent and extremely well documented; Python is the natural home if self-hosted OCR (PaddleOCR) were ever adopted. |
| Cons | Same two-language penalty as Option C without .NET's Azure integration depth. Python's dynamic typing gives an agent fewer compile-time guardrails, which matters more than usual when nobody reviews the code. Its principal advantage — the ML/OCR ecosystem — was eliminated by ADR-0001's choice of a managed OCR service. |
| Cost | $0. |
| Reversal cost | High. |

## Decision

**We will use TypeScript end to end: React 18 + Vite + Tailwind CSS for
the SPA, Node 20 + Express for the API and extraction worker, Vitest for
unit and integration tests, and Playwright for end-to-end and
responsive-viewport tests. Both halves build into the single container
image of ADR-0003.**

Selected components:

| Concern | Selection | Note |
|---|---|---|
| UI framework | **React 19** + TypeScript | Most-represented UI framework in training data (NFR-004). ~~React 18~~ — R2: 19 is what is installed and what `StrictMode` double-invoke behaviour (ADR-0012 D-7) is reasoned against |
| Build / dev server | Vite | Fast, minimal configuration, no framework opinions |
| Styling | **Hand-authored CSS over a semantic class vocabulary** | **R2 — see Revision 2 below.** ~~Tailwind CSS — utility classes make the 320px/1024px responsive work (NFR-006/007) explicit and reviewable in the markup rather than hidden in a stylesheet~~ |
| Client state / data | **One typed `fetch` client — no library** | **R2 — ADR-0012.** ~~TanStack Query — standard, well documented; gives caching and request de-duplication on the value loop for free~~ |
| HTTP server | Express 4 | Maximum documentation surface, minimum magic |
| Validation | Zod | One schema per boundary, shared between client and server; runtime validation of the OCR/TMDB responses that cross a trust boundary |
| Data access | **Prisma, provider `sqlserver`** | **R2 — ADR-0005 Rev 3.** ~~`@azure/cosmos` — first-party SDK~~ |
| Blob access | `@azure/storage-blob` + `@azure/identity` | Managed identity (ADR-0006) |
| OCR | `@azure-rest/ai-vision-image-analysis` | Behind the `TitleExtractor` interface (ADR-0001) |
| Unit / integration tests | Vitest | Same runner both halves |
| End-to-end tests | Playwright | Also carries the NFR-006/NFR-007 viewport assertions |
| CI/CD | GitHub Actions | Free for this repository; deploys the container to ACA |
| IaC | Bicep | First-party, declarative, in-repo |

**The deciding argument is `NFR-004`, applied honestly:** one language,
one type system and one test runner across the whole repository removes
an entire class of failure that an autonomous implementer cannot recover
from — a contract that is correct on one side of a language boundary and
wrong on the other. Sharing the domain types verbatim between client and
server converts API drift from a runtime bug into a build failure, which
is precisely the machine-checkable success signal `NFR-003` demands.

Option B was rejected on the same criterion that recommends React: the
*framework* is well represented, but its training data is split across
two incompatible routing paradigms, so representation does not translate
into correct generated code. Option C was rejected because its real
strengths — Azure integration and static typing — are worth less here
than eliminating the second language.

## Consequences

### Positive
- One language, one toolchain, one test command. `NFR-003`'s "an agent
  can determine whether a change succeeded" is achievable with
  `npm test` and `npx playwright test`.
- Domain types (`Title`, `ServiceListing`, `Suppression`, `UploadBatch`,
  `UploadedImage`, `ExtractionCandidate`) are declared once and imported
  by both halves — no hand-maintained parity, no drift.
- Every choice in the table is a first-page, heavily-documented default
  in its category, which is the property NFR-004 actually asks for.
- ~~Tailwind puts responsive breakpoints in the markup, so the NFR-006 /
  NFR-007 obligations are visible at the point of use and reviewable in
  a diff.~~ *(R2: this benefit was never realised — see Revision 2.)*
- Zod at the OCR and TMDB boundaries means both untrusted external
  payloads are validated before they reach domain logic — a security
  benefit as well as a correctness one.

### Negative
- **Express supplies no structure.** Without a stated convention, an
  autonomous implementer will produce inconsistent routing, validation
  and error handling across 39 stories. Mitigation is mandatory, not
  optional: `specs/api.md` must fix the route layout, the error envelope,
  the validation placement and the owner-scoping middleware **before**
  implementation begins, and a lint rule or architecture test should
  assert that no route handler reads the data store without passing
  through the owner-scoping middleware (NFR-008).
- **JavaScript ecosystem churn.** Dependency versions age faster than
  .NET's, and with no human maintainer the repository will drift toward
  stale, eventually-vulnerable packages. Mitigation: Dependabot with
  automerge for patch and minor updates, gated on the CI suite — which
  only works because `NFR-003` is taken seriously.
- **TypeScript's guarantees stop at the runtime boundary.** Cosmos DB
  returns `any`-shaped documents; without Zod parsing at the repository
  layer, the type system provides false confidence. Parsing at that
  boundary is therefore a requirement of this ADR, not a suggestion.
- **No server-side rendering** means the first paint is an empty shell
  plus a data fetch. Combined with ADR-0003's cold start, the worst-case
  first impression of the value loop is slower than an SSR stack would
  give. Accepted: SSR would have cost a heavier container and a more
  error-prone framework, and the mitigation (a skeleton list state,
  required by PRD §9.2) is cheap.
- **Node is a weaker host for future self-hosted ML** than Python. This
  closes a door that ADR-0001 had already chosen not to walk through,
  but the coupling is real and both ADRs should be revisited together.

### Neutral / follow-on work required
- Repository layout: a single npm workspace with `apps/web`,
  `apps/api`, `packages/domain` (shared types + Zod schemas), `infra`
  (Bicep), `tests/e2e`. Fixed in `repo-scaffolder`'s phase.
- `specs/testing.md` is elevated to a primary deliverable by `NFR-003`
  and must map every PRD acceptance criterion to a named executable
  test. The load-bearing ones already identified by the PRD —
  US-013 AC-6 (full-update review must show already-known titles),
  US-024 AC-6 (do not de-duplicate the removed view), US-028 AC-3
  (suppress → remove → re-upload), US-011 AC-5 (TMDB attribution),
  US-001 AC-4 (allow-list refusal) — are the non-negotiable core.
- Node 20 LTS is pinned in `.nvmrc`, `package.json` engines, the
  Dockerfile and the GitHub Actions workflow, so all four agree.

## Revision 2 — 2026-08-25 — **styling and the data layer, corrected to reality**

⚠ **The table above is corrected IN PLACE; the superseded selections are struck
through beside their replacements.** Read the current values.

### R2-A — Styling: hand-authored CSS, not Tailwind

**What was found.** When the deployed app was first opened in a browser it
rendered entirely unstyled. The project contained **no CSS file of any kind**,
no stylesheet import in `main.tsx`, and **no Tailwind dependency** — while the
components had already been built with **43 `className` attributes drawn from a
consistent semantic BEM vocabulary** (`title-row__poster`,
`freshness-strip__chip`, `tap-target`) and **zero utility classes**.

**Why the original rationale no longer holds.** Tailwind was chosen so that
"utility classes make the responsive work explicit and reviewable in the
markup". The markup was written the opposite way. That benefit is not
available to collect — it can only be *bought*, by rewriting 43 attributes
across working, tested components. Adopting Tailwind now would pay a
migration cost to reach a state the code has already declined.

**The decision.** Keep the semantic vocabulary and hand-author a stylesheet
against it. No new dependency (NFR-004 favours the smaller tree), no churn on
tested call sites, and the class names already read as documentation.

**The cost, stated honestly.** Responsive breakpoints now live in a stylesheet
rather than in the markup, so NFR-006/NFR-007 obligations are one file away
from their point of use. That is a real loss and it is why `specs/ui.md` §13
pins the breakpoints and the 44 px tap target in **one** token block, and why
§36 asserts them from the rendered page rather than from the source.

⚠ **`@apply` was considered and rejected.** It would install Tailwind to
generate the same semantic classes, paying the dependency without gaining the
in-markup visibility that was the entire argument for it.

### R2-B — Client state: no data-fetching library

Superseded by **ADR-0012**, which also records that the SPA had no API client
at all. The short reason: TanStack Query's core value is cache coherence and
background revalidation, and **REQ-041 forbids background revalidation
outright**.

### R2-C — Two entries had simply gone stale

`@azure/cosmos` was superseded by ADR-0005 Revision 3 (Prisma on Azure SQL)
and had never been corrected here; React 18 has been React 19 in
`apps/web/package.json` since the scaffold. Both are corrected in place.

⚠ **Neither was load-bearing on its own, but both were readable as current
instructions** — which is the F-001 defect this project has already been bitten
by once. An ADR table is executed, not narrated.

---

## Reversal

| | |
|---|---|
| **Is this a one-way door?** | **Partially.** Individual libraries are cheap to swap; the language choice is not. |
| **Cost to reverse** | Swapping Express for Fastify, or Tailwind for another styling approach: hours to a day. Changing language: a rewrite. The data model (ADR-0005) and the Azure resources (ADR-0003) are language-agnostic and survive either way. |
| **Trigger to revisit** | (a) ADR-0001 is reversed toward self-hosted OCR, which would make Python attractive; (b) the implementing agent demonstrably produces better output in another mainstream stack; (c) the product grows a requirement React is a poor fit for — none is foreseeable in the locked scope. |

## Compliance and security implications

- Zod validation at the OCR and TMDB boundaries treats both as untrusted
  input, per `.github/instructions/untrusted-content.instructions.md`.
- Owner-scoping (NFR-008) is enforced in one middleware and one
  repository layer, so it can be asserted by a single architecture test
  rather than reviewed across 39 stories.
- No authentication code is written in this stack at all (ADR-0002).
- No client-side analytics or telemetry package is installed anywhere in
  the dependency tree (NFR-005); this should be asserted by a
  dependency-allow-list check in CI.
- TMDB attribution (NFR-013) is implemented as a single component
  rendered by the application shell, with an automated test (US-011
  AC-5), because its failure is invisible from inside the app.

## References

- `Context/requirements.md` — NFR-002, NFR-003, NFR-004, NFR-006,
  NFR-007, NFR-008, NFR-013; ASM-028, ASM-029
- `docs/PRD.md` §3 P-2 ("the implementing agent" as a persona),
  US-037, US-039
- ADR-0001 (extraction), ADR-0003 (hosting), ADR-0005 (datastore)

---

## ⚠ A41 / CC-002 re-examination — 2026-08-10T21:45 — **DECISION STANDS, with one addition**

Re-read after the system-wide relaxation of `NFR-012`. The stack choice
(TypeScript end to end, React + Vite, Node + Express, Vitest +
Playwright) was argued entirely on `NFR-002`/`NFR-003`/`NFR-004` — one
language, one type system, one test runner, shared domain types making
contract drift a build failure. **No part of it was decided on price**;
every option considered (Next.js, .NET 8, Python FastAPI) is free.

Nothing money can buy improves it. Paid alternatives at this layer are
commercial component libraries and hosted test grids, neither of which
addresses a stated requirement.

**One addition, forced by ADR-0005 Revision 2:** the datastore is now
PostgreSQL, so the data-access layer is **Prisma** (`@prisma/client`),
replacing `@azure/cosmos`. This *reinforces* this ADR's `NFR-004`
argument rather than straining it — Prisma with PostgreSQL is the
most-represented data layer in the TypeScript ecosystem, and Prisma's
generated types compose with `packages/domain` in the same way the
hand-written ones did. Zod remains the validation boundary for
**external** payloads (HTTP, TMDB, model output); it is no longer the
schema of record for stored data, because the database now is.
