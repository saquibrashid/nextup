# ADR-0012 — SPA data access: one typed `fetch` client, no data-fetching library

| | |
|---|---|
| **Status** | **Accepted** — not yet built. Epic N. |
| **Date** | 2026-08-25 |
| **Deciders** | coordinator (the owner's standing direction is to spec before building) |
| **Forced by** | The discovery below, NFR-004, NFR-006, ADR-0002, ADR-0003 |
| **Supersedes** | Nothing. Extends ADR-0004. |

## The discovery that forced this

`apps/web` contained **exactly one `fetch` call in the entire application** —
the one added by Epic M for `/rating`. `apps/web/src/lib/` held
`useHeldImages.ts` and a `.gitkeep`. **There was no API client.**

Every screen was a stub rendering hardcoded state: "Showing 0 of 0", "Nothing
here yet", and a permanently degraded freshness strip. The API underneath was
complete and working. The two halves had simply never been joined.

⚠ **EVERY GATE WAS GREEN THROUGHOUT, AND THIS IS THE PART WORTH REMEMBERING.**
Every web test injects props directly into a component: `TitleList` is asserted
to render correctly *given* titles. Nothing asserted that anything ever
**fetches** them. The suite proved each component is correct in isolation and
was structurally incapable of noticing that nothing composed them against a
server. `T-A11Y-001` (no horizontal scroll at 320 px) and `T-A11Y-012`
(axe-core, zero serious violations) both pass comfortably on an unstyled,
data-less page — an empty document has no overflow and no contrast failures.

The lesson generalises past this ADR: **a suite made entirely of injected-prop
unit tests measures component correctness, never product integration.** §36's
test ids are written to close that specific hole, which is why several of them
assert *that a request was issued at all* rather than what was rendered.

## Requirements defined here

⚠ Same caveat as ADR-0010 and ADR-0011: **there is no authoritative REQ
register above REQ-076.** ADR-0010 owns REQ-082 – REQ-087, ADR-0011 owns
REQ-088 – REQ-095, so this file runs **REQ-096 – REQ-104**. The tree was
grepped for collisions before numbering.

| REQ | Statement |
|---|---|
| **REQ-096** | Every screen that displays owner data **reads it from the API at runtime**. No screen renders placeholder or hardcoded domain content. |
| **REQ-097** | All API access goes through **one typed client module**. No component calls `fetch` directly. |
| **REQ-098** | An expired session (**401**) sends the owner to the Easy Auth sign-in endpoint. It is **never** rendered as an error. |
| **REQ-099** | An allow-list refusal (**403**) renders the refusal screen. It is distinct from 401 and from a transport failure. |
| **REQ-100** | A failed read states that **nothing has changed**, and offers an explicit retry. nextup never retries a request on its own. |
| **REQ-101** | Filter, sort and pagination state lives in the **query string** and nowhere else. The request is derived from the URL. |
| **REQ-102** | A mutation is issued **only** from a user event handler, never from a render effect. |
| **REQ-103** | Extraction status may be **polled while a batch is running**, by an open screen, stopping at a terminal state. This is the only repeating client request. |
| **REQ-104** | Server-supplied error text is rendered **verbatim**. The client never re-words, truncates or substitutes it. |

## Decision

**One module — `apps/web/src/lib/apiClient.ts` — wraps `fetch`. No
data-fetching library is added.**

### D-1 — No TanStack Query, SWR, Axios or equivalent

NFR-004 asks for mainstream, well-documented choices, and every one of those is
mainstream. The reason to decline is **scope**, not quality: their value is
cache coherence, request deduplication, background revalidation and optimistic
updates across many concurrent consumers. nextup is **one owner, on one device,
on about ten screens**, and REQ-041 forbids background revalidation outright.

The dependency allow-list (`tools/check-deps.mjs`) makes every runtime
dependency a reviewable decision. This one buys machinery the product is
specified never to use.

### D-2 — State is a closed union, never a pair of booleans

```ts
type Resource<T> =
  | { kind: 'loading' }
  | { kind: 'ok'; value: T }
  | { kind: 'refused' }
  | { kind: 'failed' };
```

⚠ `isLoading` + `error` + `data` admits states that cannot be rendered
sensibly — loading **and** errored, neither loading nor loaded — and the
component then decides what those mean, differently in each file. A union makes
the impossible states unrepresentable and forces every screen to answer for all
four.

⚠ **`refused` is separate from `failed` on purpose.** They are different facts
about the world: *"nextup will not show you this"* versus *"nextup could not
reach the server"*. Collapsing them tells the owner to retry something that
will never succeed.

### D-3 — 401 is a redirect, 403 is a screen, and they are NOT the same

| Status | Meaning | Behaviour |
|---|---|---|
| **401** | The Easy Auth session expired | `window.location.assign('/.auth/login/aad?post_login_redirect_uri=' + current path)` |
| **403** | Authenticated, but not on the allow-list | Render the refusal screen (`refusal`, `refusal__account`) |

⚠ **A 401 RENDERED AS AN ERROR IS THE FAILURE MODE THIS ROW EXISTS TO PREVENT.**
Easy Auth sessions expire on a timer. Treated as a generic failure, the app
tells a *correctly signed-in owner* that their list could not be loaded, offers
a retry that fails identically forever, and gives no hint that signing in again
is the remedy. The owner's only escape is to guess.

The redirect preserves the current path, so a deep link survives expiry
(US-001 AC-2, mirroring `T-AUTH-002`).

### D-4 — `credentials: 'same-origin'` on every request

Easy Auth is **cookie-based**, and the container serves the SPA and the API
from one origin (ADR-0003). Omitting this sends no cookie and every call
returns 401 — which, given D-3, becomes a *redirect loop* rather than a visible
error. Set it in the client once; no call site should repeat it.

### D-5 — Retry is a user action. There is no automatic retry, anywhere.

Production runs **one replica at 0.25 vCPU / 0.5 GiB** (ADR-0003). An automatic
client retry converts a struggling container into a harder-hit container, and
several screens retrying together is a self-inflicted denial of service against
a single core. `LIST_LOAD_FAILED_BODY` already carries the honest half —
*"Nothing has changed."* — and `RETRY_LABEL` is the affordance.

The one server-side retry that does exist (the OMDb transport retry, ADR-0011)
is a single attempt against a third party, not a client loop.

### D-6 — The query string is the only store of list state

`useSearchParams` is read to build the request. Nothing mirrors it into
component state.

⚠ A mirrored copy is a second source of truth that desynchronises on the back
button, on a shared link and on reload — and it desynchronises *silently*,
showing a list that does not match its own visible filter controls. This is
already the rule for `FilterBar` (TASK-039); D-6 extends it to the fetch.

### D-7 — Mutations live in event handlers. Never in an effect.

⚠ **React 19 StrictMode double-invokes effects in development** — `main.tsx`
mounts inside `<StrictMode>`. A `POST` in a mount effect therefore fires
**twice**, creating two upload batches, two extraction runs, two of whatever it
was. It is invisible in production builds, so it surfaces first in the owner's
real data.

Mutations are caused by the owner doing something, so a handler is also the
honest place for them. Effects are for subscriptions and for D-8's poll.

### D-8 — Polling: permitted, narrow, and NOT a background process

REQ-103 permits `/batches/:batchId` to poll while a batch is running. It
**stops** on a terminal state (`complete`, `failed`), on unmount, and while
`document.hidden`.

⚠ **This does not engage the no-scheduler invariant (REQ-041), and the reason
is precise, not a technicality.** REQ-041 forbids a *non-owner* process that
changes *user-visible list state*. This poll is (1) in the browser of the
signed-in owner, who is looking at the screen, (2) a **read**, and (3) of a
status endpoint that changes nothing. The extraction it observes was started by
the owner. `T-MUT-001f`'s count of three background processes is a count of
**server-side** processes and is unaffected.

⚠ The `document.hidden` stop is not politeness. Without it, a forgotten open
tab polls a single-replica container indefinitely — a background process by
behaviour, whatever the intent.

### D-9 — Server error text is rendered verbatim

Already specified for the memory and decode codes (`specs/ui.md` §3.2a,
`T-UI-013`) because those messages interpolate live configured values. D-9 makes
it the general rule: the envelope's `message` is the string shown.

⚠ A client-side lookup table keyed on error code is a **second source of
truth** that silently goes stale — it keeps displaying yesterday's limit after
the owner up-sizes memory, in the very message whose job is to state the limit.

## Consequences

**Good.** No new runtime dependency. The client is one small file, so what
happens on a 401 is written once. Every state is enumerable, so every screen
is testable without a mock server. The poll rule is written down before anyone
implements one.

**Bad.** Hand-rolling means request deduplication and cross-screen cache
sharing do not exist: navigating away and back re-fetches. For a single owner
on ten screens against a warm container that is a non-issue, and it is
recoverable — adopting a library later is additive, because every call already
goes through one module (D-1's real payoff).

**Cost to reverse.** Low. One module changes; no component does.

## Alternatives rejected

| Option | Why not |
|---|---|
| TanStack Query | D-1. Its core features are cache coherence and background revalidation; REQ-041 forbids the latter and one owner on one device does not need the former. |
| Fetch inline in each component | The 401 rule would be re-implemented ten times and wrong in at least one. REQ-097 exists to prevent this. |
| Server-rendered pages | Discards the SPA in ADR-0004 and the offline-tolerant upload flow. A rewrite, to remove a problem that is one file. |
| A generated client from an OpenAPI document | No OpenAPI document exists, and `specs/api.md` is the authority. Generating one to consume it adds a build step and a second source of truth. |
