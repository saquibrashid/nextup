/**
 * `*` - unknown route (specs/ui.md §1).
 *
 * The screen index states this route optimises for **"getting back to `/`"**,
 * so the link home is the feature, not decoration - a dead end here strands
 * the owner on a mistyped or stale URL with no in-product way out.
 */

import type { JSX } from 'react';
import { Link } from 'react-router-dom';

export function NotFoundPage(): JSX.Element {
  return (
    <>
      <h1>Page not found</h1>
      <p>That page doesn&rsquo;t exist. Nothing on your list has changed.</p>
      <Link to="/" className="tap-target">
        Back to your list
      </Link>
    </>
  );
}
