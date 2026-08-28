# Lane H — Blocked items

This file documents changes Lane H needs to shared/hard-stop files, in the
format required by `.github/copilot-instructions.md` §20.

---

## 1. `apps/web/src/lib/apiClient.ts` — needs review-related methods

**Task:** TASK-069, TASK-070  
**Why blocked:** `apps/web/src/lib/apiClient.ts` is a HARD STOP (shared, recently
modified by another lane).

**Changes needed:**

Add the following methods to the `ApiClient` class (or equivalent export):

```typescript
/** Fetch the review payload for an in-review batch. */
getBatchReview(batchId: string): Promise<ReviewResponse>

/** Patch a single candidate's disposition. */
patchCandidate(
  batchId: string,
  candidateId: string,
  body: { disposition: 'confirmed' | 'discarded' },
): Promise<void>

/** Confirm all candidates in a named section. */
confirmAllCandidates(
  batchId: string,
  section: 'additions' | 'unmatched' | 'alreadyOnYourList',
): Promise<void>

/** Close the batch (apply changes). */
closeBatch(
  batchId: string,
  body: { confirmRemovals: readonly string[] },
): Promise<void>

/** Undo the last close of a batch. */
undoBatch(batchId: string): Promise<void>
```

These are required to wire `ReviewPage` (currently props-driven / unconnected to
real data) to the live API. The page renders correctly from props; only the
container layer that fetches and dispatches is missing.

---

## 2. `apps/web/test/imageDropzone.spec.tsx` — needs `T-UI-013`

**Task:** TASK-070  
**Why blocked:** `apps/web/test/imageDropzone.spec.tsx` is outside Lane H's owned
paths (`apps/web/test/` files that already exist).

**Change needed:**

Add to `imageDropzone.spec.tsx`:

```typescript
it('T-UI-013 a decode RangeError renders the ImageDropzone error verbatim', () => {
  // ... test that ImageDropzone surfaces decode errors with exact message text
  // so the owner knows whether failure was caused by file corruption or OOM
});
```

This is the "Done when" criterion for TASK-070. The test belongs in the
`imageDropzone.spec.tsx` file owned by whichever lane owns ImageDropzone.

---

## 3. `tests/e2e/` — needs `T-PERF-002`

**Task:** TASK-070 (also TASK-129)  
**Why blocked:** `T-PERF-002` is level E (Playwright e2e). It belongs in
`tests/e2e/` which is not a path Lane H owns.

**Change needed:**

Add a Playwright test in `tests/e2e/` that:
- Renders the review page with 200+ candidates
- Asserts the page remains interactive (no jank / no full DOM materialization)
- Verifies virtual scroll renders only a subset of items

This requires `@tanstack/react-virtual` to be installed (see item 4).

---

## 4. `apps/web/package.json` — needs `@tanstack/react-virtual`

**Task:** TASK-070  
**Why blocked:** `apps/web/package.json` is a workspace manifest (HARD STOP).

**Change needed:**

Add to `apps/web/package.json` dependencies:
```json
"@tanstack/react-virtual": "^3.x"
```

This is the virtualisation library for the list view in `T-PERF-002`.

---

## Finding: `T-UI-014` double-definition in `docs/backlog.md`

**Not a blocked change — a spec finding.**

`T-UI-014` in `specs/testing.md` §9 is about the upload page's three ingest
affordances (paste button, file input, drop target). TASK-162 already
implemented it fully in `pasteCapture.spec.tsx`.

TASK-082 also claims `T-UI-014` but describes the review page's "Already on your
list" section (US-013 AC-2). The correct test ID for that behaviour is `T-REV-016`.

Resolution: Lane H delivered `T-REV-016` (US-013 AC-2) and noted the
double-definition in `docs/backlog.md` §1.2 for TASK-082. The backlog should be
corrected to replace `T-UI-014` with `T-REV-016` in the TASK-082 "Done when"
column in the Epic E table (`docs/backlog.md` §2 Epic E table).

**Action required (not Lane H's file to edit — this is the epic table, not §1.2):**
In the TASK-082 row in the Epic E table, change the "Done when" cell from
`T-UI-014` to `T-REV-016`.
