/**
 * `/about` - attribution and retention statements (`specs/ui.md` §1, §8).
 *
 * §8 requires this page to state, in plain language: what TMDB is used for, the
 * 30-day screenshot retention (US-035 AC-6), that removed titles are kept
 * forever (US-023 AC-2), and that no analytics are collected (NFR-005).
 *
 * ⚠ The TMDB disclaimer itself is NOT here, and adding it here would be a
 * regression rather than a reinforcement. US-011 AC-3 requires it in the global
 * footer on every screen and explicitly forbids it being reachable only via an
 * "about" link - it already renders below this page's content, from `AppShell`.
 * This page adds context; it is not where the obligation is discharged.
 *
 * ⚠ The retention sentence is the 30-day IMAGE retention (NFR-019). It is not,
 * and must never be derived from, the 183-day TMDB metadata refresh age
 * (NFR-014) - invariant 8.
 */

import type { JSX } from 'react';

import {
  ABOUT_NO_ANALYTICS,
  ABOUT_REMOVED_KEPT_FOREVER,
  ABOUT_TMDB_USE,
  IMAGE_RETENTION_STATEMENT,
} from '../copy';

export function AboutPage(): JSX.Element {
  return (
    <>
      <h1>About nextup</h1>

      <section aria-labelledby="about-tmdb">
        <h2 id="about-tmdb">Where the title details come from</h2>
        <p>{ABOUT_TMDB_USE}</p>
      </section>

      <section aria-labelledby="about-screenshots">
        <h2 id="about-screenshots">Your screenshots</h2>
        <p>{IMAGE_RETENTION_STATEMENT}</p>
      </section>

      <section aria-labelledby="about-removals">
        <h2 id="about-removals">Nothing is deleted behind your back</h2>
        <p>{ABOUT_REMOVED_KEPT_FOREVER}</p>
      </section>

      <section aria-labelledby="about-analytics">
        <h2 id="about-analytics">What nextup collects</h2>
        <p>{ABOUT_NO_ANALYTICS}</p>
      </section>
    </>
  );
}
