/**
 * `T-UX-069` — `specs/ux-states.md` §6.18, a 401 arriving mid-review.
 *
 * ⚠ **WHY THIS STATE NEEDED CODE AND NOT JUST COPY.** A 401 is intercepted
 * globally inside `apps/web/src/lib/apiClient.ts` (`request`), which redirects
 * to Easy Auth before any container sees the `ApiError`. That is the right
 * default nearly everywhere — an Easy Auth session expires on a timer, so an
 * error screen offering a retry would fail identically forever — but on the
 * review it silently bounces the owner away from *uncommitted work*. The
 * dispositions themselves already survive (they are in `sessionStorage`, SD-11e
 * / `T-UI-027`); what was missing was any reason for the owner to believe so.
 *
 * ⚠ **THE HANDLER IS SCREEN-SCOPED, AND THAT SCOPING IS THE RISK.** A handler
 * left registered after the review unmounts disables the 401 redirect for the
 * WHOLE APP, and the symptom — every other screen stranded on an expired
 * session — shows up nowhere near the review. `g` and `i` exist for that, not
 * for completeness.
 *
 * ⚠ `f` is the wiring case and is NOT redundant with `a`. The cases above it
 * build their own client; only `f` drives the module-level `apiClient` the app
 * actually ships with, which is the single path on which `defaultRedirect` —
 * and therefore the scoped handler — is reached at all.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildReviewResponse } from '@nextup/domain';

import { ReviewRoute } from '../src/containers/ReviewRoute';
import {
  REVIEW_APPLY_LABEL,
  SESSION_ENDED_REVIEW_BODY,
  SESSION_ENDED_TITLE,
  SIGN_IN_AGAIN_LABEL,
} from '../src/copy';
import { RefusalPage } from '../src/pages/RefusalPage';
import { createApiClient, setUnauthorizedHandler } from '../src/lib/apiClient';
import { readLocalDispositions, writeLocalDispositions } from '../src/lib/reviewDispositions';

function reviewBody() {
  return buildReviewResponse({
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'append',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [
      {
        candidateId: 'cnd_1',
        rawExtractedText: 'Dune',
        normalisedText: 'dune',
        verdict: 'title' as const,
        confidence: 0.99,
        ocrSupport: 'corroborated' as const,
        cleanupVerdict: null,
        resolvedWorkIdentity: 'tmdb:movie:1',
        match: {
          workIdentity: 'tmdb:movie:1',
          mediaType: 'movie' as const,
          name: 'Dune',
          releaseYear: 2021,
          posterPath: null,
          score: 0.99,
          uncertain: false,
          ambiguous: false,
        },
        alternatives: [],
        sourceImageIds: ['img_1'],
        disposition: 'pending' as const,
        collapsedIntoCandidateId: null,
        classification: 'new' as const,
      },
    ],
    disappearedListings: [],
    imagesWithNoText: [],
  });
}

function response(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A `fetch` that 401s every call — an expired Easy Auth session. */
const alwaysExpired = () => Promise.resolve(response(401, {}));

function renderReview(client?: ReturnType<typeof createApiClient>) {
  return render(
    <MemoryRouter initialEntries={['/batches/bat_1/review']}>
      <Routes>
        <Route
          path="/batches/:batchId/review"
          element={client === undefined ? <ReviewRoute /> : <ReviewRoute client={client} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('T-UX-069 — session expired mid-review (§6.18)', () => {
  beforeEach(() => {
    // ⚠ Not defensive tidying: the handler is module-level state, so one test
    // leaking it makes the NEXT test pass for the wrong reason.
    setUnauthorizedHandler(null);
    window.sessionStorage.clear();
  });

  afterEach(() => {
    setUnauthorizedHandler(null);
    vi.restoreAllMocks();
  });

  it('T-UX-069a: a 401 on the review renders the session-ended state', async () => {
    renderReview(createApiClient({ fetchImpl: alwaysExpired as typeof fetch }));

    expect(await screen.findByText(SESSION_ENDED_TITLE)).toBeTruthy();
  });

  it('T-UX-069b: it says the review is still here', async () => {
    renderReview(createApiClient({ fetchImpl: alwaysExpired as typeof fetch }));

    // ⚠ The LITERAL, not the constant. Asserting `=== SESSION_ENDED_REVIEW_BODY`
    // compares the render to the same symbol it renders, so editing the copy to
    // say the opposite — "Your review is gone." — moves both sides and passes.
    // A mutation run proved exactly that before this line was written.
    expect((await screen.findByTestId('refusal-reassurance')).textContent).toBe(
      'Your review is still here.',
    );
    expect(SESSION_ENDED_REVIEW_BODY).toBe('Your review is still here.');
  });

  it('T-UX-069c: Sign in returns to THIS url, not to the bare endpoint', async () => {
    renderReview(
      createApiClient({
        fetchImpl: alwaysExpired as typeof fetch,
        currentPath: () => '/batches/bat_1/review',
      }),
    );

    const action = await screen.findByTestId('refusal-action');
    expect(action.textContent).toBe(SIGN_IN_AGAIN_LABEL);
    // The whole point of §6.18's "returning to this URL": a bare
    // `/.auth/login/aad` lands the owner on the list with their review
    // apparently gone.
    expect(action.getAttribute('href')).toBe(
      '/.auth/login/aad?post_login_redirect_uri=%2Fbatches%2Fbat_1%2Freview',
    );
  });

  it('T-UX-069d: no review UI is rendered against a dead session', async () => {
    renderReview(createApiClient({ fetchImpl: alwaysExpired as typeof fetch }));

    await screen.findByText(SESSION_ENDED_TITLE);
    expect(screen.queryByText(REVIEW_APPLY_LABEL)).toBeNull();
    expect(screen.queryByText('Dune')).toBeNull();
  });

  it('T-UX-069e: a 401 from a LATER call, not just the load, reaches the state', async () => {
    let calls = 0;
    const client = createApiClient({
      fetchImpl: (() => {
        calls += 1;
        return Promise.resolve(calls === 1 ? response(200, reviewBody()) : response(401, {}));
      }) as typeof fetch,
    });

    renderReview(client);

    // The review loads against a live session…
    expect(await screen.findByText(REVIEW_APPLY_LABEL)).toBeTruthy();

    // …and the session dies under the next call the screen makes. Driving it
    // through the SAME client the route holds is the real arrangement: one
    // client serves every call, so the state must not depend on WHICH call
    // hit the 401.
    await act(async () => {
      await client.discardBatch('bat_1').catch(() => undefined);
    });

    expect(await screen.findByText(SESSION_ENDED_TITLE)).toBeTruthy();
  });

  it('T-UX-069f: the SHIPPED client reaches the state (wiring)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(alwaysExpired as typeof fetch);

    renderReview();

    expect(await screen.findByText(SESSION_ENDED_TITLE)).toBeTruthy();
    expect(screen.getByTestId('refusal-reassurance').textContent).toBe(SESSION_ENDED_REVIEW_BODY);
  });

  it('T-UX-069g: leaving the review restores the app-wide redirect', async () => {
    const { unmount } = renderReview(createApiClient({ fetchImpl: alwaysExpired as typeof fetch }));
    await screen.findByText(SESSION_ENDED_TITLE);

    unmount();

    // ⚠ The assertion that matters: with the review gone, a 401 must go back
    // to redirecting. A handler left installed here would strand every OTHER
    // screen on an expired session, from a screen the owner has left.
    //
    // jsdom refuses to redefine `location.assign` itself ("Cannot redefine
    // property"), so the whole `location` is swapped for the duration — the
    // seam `T-DATA-004` documents, one level up.
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign },
    });

    try {
      const client = createApiClient({ fetchImpl: alwaysExpired as typeof fetch });
      await client.getTitles('').catch(() => undefined);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0]?.[0]).toContain('/.auth/login/aad');
  });

  it('T-UX-069h: the dispositions the copy promises really do survive', async () => {
    writeLocalDispositions('bat_1', { cnd_1: 'confirmed' }, window.sessionStorage);

    renderReview(createApiClient({ fetchImpl: alwaysExpired as typeof fetch }));
    await screen.findByText(SESSION_ENDED_TITLE);

    // If this ever fails, `SESSION_ENDED_REVIEW_BODY` is a lie and must be
    // deleted along with whatever removed the persistence.
    expect(readLocalDispositions('bat_1', window.sessionStorage)).toEqual({ cnd_1: 'confirmed' });
  });

  it('T-UX-069i: the reassurance is opt-in, not baked into every refusal', () => {
    render(<RefusalPage reason="session-expired" />);

    expect(screen.getByText(SESSION_ENDED_TITLE)).toBeTruthy();
    expect(screen.queryByTestId('refusal-reassurance')).toBeNull();
    expect(screen.getByTestId('refusal-action').getAttribute('href')).toBe('/.auth/login/aad');
  });

  it('T-UX-069j: an unmounted review never captures another screen\u2019s 401', async () => {
    const { unmount } = renderReview(createApiClient({ fetchImpl: alwaysExpired as typeof fetch }));
    await screen.findByText(SESSION_ENDED_TITLE);
    unmount();

    const seen: string[] = [];
    const client = createApiClient({
      fetchImpl: alwaysExpired as typeof fetch,
      onUnauthorized: (url) => seen.push(url),
    });
    await client.getTitles('').catch(() => undefined);

    // An explicit per-call handler still wins over both the scoped handler and
    // the redirect — the seam did not change that precedence.
    await waitFor(() => expect(seen).toHaveLength(1));
  });
});
