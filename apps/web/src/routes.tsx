/**
 * The route table (TASK-025), transcribed from `specs/ui.md` §1.
 *
 * Exported as DATA rather than as JSX so tests, the nav and the future
 * accessibility suites can all enumerate the same routes from one place.
 * `specs/ui.md` §8 and §10.1 both require assertions across every route
 * (`T-ATTR-002`, `T-ATTR-003`, `T-A11Y-001`, `T-A11Y-012`); a hand-maintained
 * second list in each of those suites would drift the moment a route is added,
 * and would drift SILENTLY - the suite would keep passing while no longer
 * covering the new screen.
 *
 * ⚠ TEN ROUTES SINCE EPIC M, not nine. `/rating` (REQ-092) was added, and the
 * enumerate-from-here design is exactly what made that a one-line change
 * rather than a four-suite coverage hole.
 */

import type { ComponentType } from 'react';

import { AboutPage } from './pages/AboutPage';
import { BatchHistoryRoute } from './containers/BatchHistoryRoute';
import { BatchStatusRoute } from './containers/BatchStatusRoute';
import { ListRoute } from './containers/ListRoute';
import { NotFoundPage } from './pages/NotFoundPage';
import { RatingLookupPage } from './pages/RatingLookupPage';
import { RemovedPage } from './pages/RemovedPage';
import { ReviewRoute } from './containers/ReviewRoute';
import { SuppressedRoute } from './containers/SuppressedRoute';
import { UploadRoute } from './containers/UploadRoute';

export interface RouteDefinition {
  /** The `react-router` path pattern. `*` is the catch-all. */
  readonly path: string;
  readonly Component: ComponentType;
  /**
   * A concrete URL the route matches, for suites that must VISIT every screen.
   * Parameterised paths cannot be navigated to as written, and an
   * `:batchId` left literal in a URL produces a 404 that looks like a routing
   * bug rather than a bad test.
   */
  readonly examplePath: string;
  /** The nav label, or `null` for routes that are reached contextually. */
  readonly navLabel: string | null;
}

export const EXAMPLE_BATCH_ID = '01J0000000000000000000BTCH';

export const ROUTES: readonly RouteDefinition[] = [
  { path: '/', Component: ListRoute, examplePath: '/', navLabel: 'List' },
  {
    path: '/upload',
    Component: UploadRoute,
    examplePath: '/upload',
    navLabel: 'Upload',
  },
  {
    path: '/batches',
    Component: BatchHistoryRoute,
    examplePath: '/batches',
    navLabel: 'Batches',
  },
  {
    path: '/batches/:batchId',
    Component: BatchStatusRoute,
    examplePath: `/batches/${EXAMPLE_BATCH_ID}`,
    navLabel: null,
  },
  {
    path: '/batches/:batchId/review',
    Component: ReviewRoute,
    examplePath: `/batches/${EXAMPLE_BATCH_ID}/review`,
    navLabel: null,
  },
  {
    path: '/removed',
    Component: RemovedPage,
    examplePath: '/removed',
    navLabel: 'Removal history',
  },
  {
    path: '/not-interested',
    Component: SuppressedRoute,
    examplePath: '/not-interested',
    navLabel: 'Not interested',
  },
  {
    path: '/about',
    Component: AboutPage,
    examplePath: '/about',
    navLabel: 'About',
  },
  {
    path: '/rating',
    Component: RatingLookupPage,
    examplePath: '/rating',
    navLabel: 'Check a rating',
  },
  {
    path: '*',
    Component: NotFoundPage,
    examplePath: '/no-such-route',
    navLabel: null,
  },
];
