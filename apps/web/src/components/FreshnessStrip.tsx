// The freshness strip (`specs/ui.md` §2.1, REQ-039, US-022, TASK-042).
//
// ⚠ THIS STATES A FACT AND NEVER NAGS (`A46`). The owner dropped the staleness
// concept outright: no threshold, no derived `stale` state, no "you haven't
// updated in N days", no re-capture reminder. What stayed - and stayed `must` -
// is the factual per-service date, because it is the mandatory mitigation for
// RSK-007: the list quietly going out of date without the owner noticing. Show
// the fact; never nag about it. `T-FRESH-015` guards the wording in the domain.
//
// ⚠ "Stale" is overloaded here. The TMDB `metadataStale` flag and its 183-day
// lazy refresh (NFR-014) are a different, still-required feature and nothing on
// this component relates to them.
//
// ⚠ THE STRIP NEVER BLOCKS THE LIST (§2.1). It is informational, so every
// failure mode it has degrades to "less strip", never to "no list" - see
// `T-FRESH-014`.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { SERVICES, SERVICE_LABELS, serviceFreshnessLabel, type Service } from '@nextup/domain';

import { FRESHNESS_UNAVAILABLE } from '../copy';

/** One entry of `GET /api/service-state` (`specs/api.md` §6.28). */
export interface ServiceFreshness {
  readonly service: Service;
  readonly lastCompletedBatchAt: string | null;
  readonly lastCompletedBatchId: string | null;
  readonly ageDays: number | null;
  readonly label: string;
}

export interface FreshnessStripProps {
  /** `null` when `GET /api/service-state` could not be read at all. */
  readonly services: readonly ServiceFreshness[] | null;
}

/**
 * `/upload` with this service pre-selected (REQ-039, US-022).
 *
 * Unconditional navigation, offered on every chip whatever the date says -
 * making it conditional on an age would turn the strip back into the nudge
 * `A46` deleted.
 */
export function uploadPathFor(service: Service): string {
  return `/upload?service=${service}`;
}

function chipLabel(entry: ServiceFreshness | undefined, service: Service): string {
  if (entry === undefined) return FRESHNESS_UNAVAILABLE;
  // Rendered verbatim: the API computes it from `serviceFreshnessLabel` so the
  // §2.1 wording has one implementation. The fallback calls that SAME domain
  // function rather than formatting a second sentence here - a locally worded
  // near-copy is how two subtly different labels start.
  if (entry.label !== '') return entry.label;
  return serviceFreshnessLabel(service, entry.ageDays);
}

export function FreshnessStrip({ services }: FreshnessStripProps): JSX.Element {
  // A missing payload degrades VISIBLY. Rendering nothing would be the worst
  // outcome available: the owner cannot tell "both services are up to date"
  // from "nextup has no idea", and RSK-007 is precisely not noticing.
  const byService = new Map((services ?? []).map((entry) => [entry.service, entry]));
  const labels = SERVICES.map((service) => ({
    service,
    // With no payload at all every chip is unknown; with a partial payload only
    // the services actually missing from it are. A service absent from the
    // response is NOT "never updated" - that is a fact about the owner's
    // history, and asserting it from missing data would be a fabrication.
    text: services === null ? FRESHNESS_UNAVAILABLE : chipLabel(byService.get(service), service),
  }));
  const degraded = labels.some(({ text }) => text === FRESHNESS_UNAVAILABLE);

  return (
    <div
      className="freshness-strip"
      data-testid="freshness-strip"
      data-degraded={degraded ? 'true' : undefined}
    >
      {degraded && (
        <p className="freshness-strip__notice" data-testid="freshness-degraded" role="status">
          {FRESHNESS_UNAVAILABLE}
        </p>
      )}
      <ul>
        {labels.map(({ service, text }) => (
          <li key={service}>
            <Link
              className="freshness-strip__chip tap-target"
              data-testid={`freshness-chip-${service}`}
              to={uploadPathFor(service)}
            >
              {/*
                The healthy label already names its service ("Netflix updated
                today"), so the name is added only in the degraded case - where
                it keeps the navigation affordance, the whole point of the
                strip, intact and identifiable.
              */}
              {text === FRESHNESS_UNAVAILABLE && (
                <span data-testid={`freshness-service-${service}`}>{SERVICE_LABELS[service]}</span>
              )}
              <span data-testid={`freshness-label-${service}`}>{text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
