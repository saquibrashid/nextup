// `/waiting` — works the owner is waiting to stream (TASK-188/189, ADR-0010).
//
// ⚠ **THIS SCREEN NEVER ADDS ANYTHING TO THE COMBINED LIST** (US-042 AC-3,
// product invariant 5). A work TMDB reports as `flatrate` on a supported service is
// FLAGGED, with an invitation to go and add it — the owner adds it to their
// real saved list on the service, captures a screenshot, and it enters the
// combined list by the ordinary path. Anything else would put a row in the
// list that no capture ever saw.
//
// ⚠ **"NOT STREAMING ANYWHERE" IS A SENTENCE THIS DATA CANNOT SUPPORT**
// (ADR-0010 Trap 4). `availableOn === null` means the question has not been
// answered; `[]` means it was answered and no subscription provider carries
// it. Both render as a bounded claim about the owner's OWN services, with the
// as-of date attached. Do not "simplify" the two into one stronger sentence.
//
// ⚠ **THE JUSTWATCH ATTRIBUTION IS A CONDITION OF USE** (REQ-087, US-042
// AC-9), and is stricter than the general TMDB attribution in `AppShell`. It
// belongs on every surface that renders availability, so it is rendered here
// unconditionally rather than beside the rows that happen to have data.

import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  SERVICES,
  SERVICE_LABELS,
  WATCHMODE_ATTRIBUTION,
  WATCHMODE_ATTRIBUTION_URL,
  intentSourceLabel,
  releaseYearText,
  type Service,
} from '@nextup/domain';
import { EditionLabels } from '../components/EditionLabels';
import { ServiceMark } from '../components/ServiceMark';
import { WaitingSearchAdd } from '../components/WaitingSearchAdd';
import { SuppressedIcon } from '../components/icons';

import {
  JUSTWATCH_ATTRIBUTION,
  OFFLINE_DISABLED_REASON,
  RETRY_LABEL,
  WAITING_EMPTY_ACTION,
  WAITING_EMPTY_BODY,
  WAITING_EMPTY_TITLE,
  WAITING_FORECAST_ANNOUNCED_FROM,
  WAITING_FORECAST_ANNOUNCED_PAST,
  WAITING_FORECAST_ANNOUNCED_PREFIX,
  WAITING_FORECAST_ESTIMATE_AROUND,
  WAITING_FORECAST_ESTIMATE_PREFIX,
  WAITING_FORECAST_ESTIMATE_SOON,
  WAITING_FORECAST_SOON,
  WAITING_FORECAST_TAG_ANNOUNCED,
  WAITING_FORECAST_TAG_ESTIMATE,
  WAITING_LOADING,
  WAITING_NOT_CHECKED,
  WAITING_NOT_INTERESTED,
  WAITING_NOT_ON_YOUR_SERVICES,
  WAITING_NOW_ON_INVITATION,
  WAITING_NOW_ON_PREFIX,
  WAITING_NOW_STREAMING_BADGE,
  WAITING_OTHER_SERVICES_PREFIX,
  WAITING_OTHER_SERVICES_SUFFIX,
  WAITING_REFRESH_FAILED,
  WAITING_RENT_ONLY_LIST_LABEL,
  WAITING_RENT_ONLY_SUFFIX,
  WAITING_RENT_ONLY_TAG,
  WAITING_STREAMING_SINCE,
  WAITING_SUBTITLE,
  WAITING_SUPPRESS_FAILED,
  WATCHMODE_ATTRIBUTION_LINK,
} from '../copy';
import type { TmdbSearchResult, WaitingItem } from '../lib/apiClient';
import { TMDB_IMAGE_BASE, TMDB_IMAGE_BASE_2X } from '../components/TitleRow';
import { formatDateShort } from './RemovedPage';
import { useOnline } from '../lib/useOnline';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

export interface WaitingPageProps {
  readonly items?: readonly WaitingItem[];
  readonly loading?: boolean;
  readonly loadFailed?: boolean;
  /** US-042 AC-7 — at least one lookup failed on this render. */
  readonly refreshFailed?: boolean;
  readonly onRetry?: () => void;
  readonly onSuppress?: (titleId: string) => Promise<unknown>;
  /** #378 — search-to-add. The box renders only when both are supplied. */
  readonly onSearch?: (query: string) => Promise<readonly TmdbSearchResult[]>;
  readonly onSearchAdd?: (result: TmdbSearchResult) => Promise<unknown>;
}

function knownService(service: string): Service | undefined {
  return SERVICES.find((candidate) => candidate === service);
}

function serviceLabel(service: string): string {
  const known = knownService(service);
  return known === undefined ? service : SERVICE_LABELS[known];
}

/**
 * #382 — the Library's date style (`4 Jan 2026`) for every as-of and
 * discovery date on the row, rather than a raw ISO `2026-01-04`.
 */
function friendlyDate(iso: string): string {
  return formatDateShort(iso.slice(0, 10));
}

/**
 * The availability sentence for one row (US-042 AC-3/AC-6).
 *
 * Exported so `T-AVAIL-006` can assert the rule directly rather than through a
 * rendered tree — the claim being tested is about which sentence is chosen,
 * and a DOM query would pass just as happily against the forbidden one.
 */
export function availabilityLine(item: WaitingItem): string {
  if (item.availabilityCheckedAt === null) return WAITING_NOT_CHECKED;
  return `${WAITING_NOT_ON_YOUR_SERVICES} ${friendlyDate(item.availabilityCheckedAt)}.`;
}

/**
 * #378/#382 — the storefronts a rent-only row can be rented or bought on, or
 * `null` when the row is not rent-only.
 *
 * ⚠ The row renders BOTH halves: where it can be rented or bought, and that
 * it is not streaming on the owner's services. A rental offer alone must
 * never read as the answer the waiting view exists to give — which is why a
 * rent-only row with no as-of date falls back to the bounded sentence.
 */
export function rentOnlyStores(item: WaitingItem): readonly string[] | null {
  if (item.accessState !== 'rent-only') return null;
  const rentOn = item.rentOn ?? [];
  if (rentOn.length === 0 || item.availabilityCheckedAt === null) return null;
  return rentOn;
}

/**
 * #378, owner decision 3 — streaming somewhere the owner does not subscribe,
 * or `null`. Services nextup knows are drawn as their marks; providers it
 * does not know are named as chips. To the owner both are simply "not mine".
 */
export function otherStreaming(
  item: WaitingItem,
): { services: readonly Service[]; providers: readonly string[] } | null {
  const services = (item.otherServicesOn ?? []).flatMap((service) => {
    const known = knownService(service);
    return known === undefined ? [] : [known];
  });
  const providers = [
    ...(item.otherServicesOn ?? []).filter((service) => knownService(service) === undefined),
    ...(item.otherProvidersOn ?? []),
  ];
  if (services.length === 0 && providers.length === 0) return null;
  return { services, providers };
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `2027-01` → `Jan 2027`. Deterministic: no locale, no time zone. */
function monthText(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${MONTHS[Number(month) - 1] ?? ''} ${year ?? ''}`.trim();
}

/** `2026-10-03` → `Oct 3, 2026`. */
function dayText(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${MONTHS[Number(month) - 1] ?? ''} ${Number(day)}, ${year ?? ''}`;
}

/**
 * #380 — when and where it is expected to stream, or `null` for no forecast.
 *
 * ⚠ An estimate LEADS with "Estimate:" — it is a guess from the studio's
 * usual window and must never read like a published date. Exported so the
 * sentence rule is asserted directly, as for {@link availabilityLine}.
 */
export function forecastLine(
  item: WaitingItem,
  today: string = new Date().toISOString().slice(0, 10),
): { text: string; estimate: boolean } | null {
  const forecast = item.forecast;
  if (forecast == null) return null;
  const service = serviceLabel(forecast.service);
  const notYours = forecast.yours ? '' : ` ${WAITING_OTHER_SERVICES_SUFFIX}`;
  switch (forecast.kind) {
    case 'announced':
      return {
        estimate: false,
        text:
          forecast.on >= today
            ? `${WAITING_FORECAST_ANNOUNCED_PREFIX} ${service}${notYours} ${WAITING_FORECAST_ANNOUNCED_FROM} ${dayText(forecast.on)}`
            : `${WAITING_FORECAST_ANNOUNCED_PAST} ${service}${notYours} on ${dayText(forecast.on)}`,
      };
    case 'estimate':
      return {
        estimate: true,
        text: `${WAITING_FORECAST_ESTIMATE_PREFIX} ${service}${notYours} ${WAITING_FORECAST_ESTIMATE_AROUND} ${monthText(forecast.month)}`,
      };
    case 'estimate-range':
      return {
        estimate: true,
        text: `${WAITING_FORECAST_ESTIMATE_PREFIX} ${service}${notYours}, ${monthText(forecast.from)} – ${monthText(forecast.to)}`,
      };
    case 'estimate-soon':
      return {
        estimate: true,
        text: `${WAITING_FORECAST_ESTIMATE_PREFIX} ${service}${notYours} ${WAITING_FORECAST_ESTIMATE_SOON}`,
      };
  }
}

/**
 * #382 — the forecast headline's "when": `Jan 2027`, `Nov 2026 – Feb 2027`,
 * `Oct 3, 2026` or `Soon`. The same date wording as the sentence under it, so
 * the two can never disagree.
 */
export function forecastWhen(forecast: NonNullable<WaitingItem['forecast']>): string {
  switch (forecast.kind) {
    case 'announced':
      return dayText(forecast.on);
    case 'estimate':
      return monthText(forecast.month);
    case 'estimate-range':
      return `${monthText(forecast.from)} – ${monthText(forecast.to)}`;
    case 'estimate-soon':
      return WAITING_FORECAST_SOON;
  }
}

/** `tmdb:movie:…` / `tmdb:tv:…` → the Library's type word, or `null`. */
function mediaTypeText(workIdentity: string): string | null {
  const kind = /^tmdb:(movie|tv):/.exec(workIdentity)?.[1];
  return kind === 'movie' ? 'Movie' : kind === 'tv' ? 'TV' : null;
}

/** Literal maps, so the class vocabulary stays scannable (`T-CSS-001c`). */
const FORECAST_CLASS = {
  announced: 'waiting-row__forecast',
  estimate: 'waiting-row__forecast waiting-row__forecast--estimate',
} as const;

const OUTLOOK_CLASS = {
  announced: 'waiting-row__outlook',
  estimate: 'waiting-row__outlook waiting-row__outlook--estimate',
} as const;

const TAG_CLASS = {
  announced: 'waiting-row__tag waiting-row__tag--announced',
  estimate: 'waiting-row__tag waiting-row__tag--estimate',
} as const;

const FORECAST_TAG = {
  announced: WAITING_FORECAST_TAG_ANNOUNCED,
  estimate: WAITING_FORECAST_TAG_ESTIMATE,
} as const;

/**
 * Rows that have reached one of the owner's services lead the list (#378):
 * noticing that moment is what the view is for. Stable within each group, so
 * the server's order is otherwise kept.
 */
export function orderWaiting(items: readonly WaitingItem[]): WaitingItem[] {
  const streaming = items.filter((item) => (item.flaggedOn ?? []).length > 0);
  const rest = items.filter((item) => (item.flaggedOn ?? []).length === 0);
  return [...streaming, ...rest];
}

/** A literal map, so the class vocabulary stays scannable (`T-CSS-001c`). */
const ROW_CLASS = {
  streaming: 'waiting-row waiting-row--streaming',
  waiting: 'waiting-row',
} as const;

/** Service marks as Library draws them. Decorative where words say the same. */
function ServiceBadges({
  services,
  decorative = false,
}: {
  services: readonly Service[];
  decorative?: boolean;
}): JSX.Element | null {
  if (services.length === 0) return null;
  return (
    <ul className="waiting-row__services" aria-hidden={decorative ? true : undefined}>
      {services.map((service) => (
        <li key={service}>
          <Badge>
            <ServiceMark service={service} nameHidden />
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function WaitingRow({
  item,
  onSuppress,
  onDone,
  offline,
}: {
  item: WaitingItem;
  onSuppress: (titleId: string) => Promise<unknown>;
  onDone: (intentId: string) => void;
  offline: boolean;
}): JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const flagged = item.flaggedOn ?? [];
  const flaggedServices = flagged.flatMap((service) => {
    const known = knownService(service);
    return known === undefined ? [] : [known];
  });
  const rentStores = rentOnlyStores(item);
  const others = otherStreaming(item);
  const forecast = flagged.length > 0 ? null : forecastLine(item);
  const forecastKind = forecast?.estimate === true ? 'estimate' : 'announced';
  const rowKind = flagged.length > 0 ? 'streaming' : 'waiting';
  const mediaType = mediaTypeText(item.workIdentity);

  function suppress(): void {
    setPhase('submitting');
    onSuppress(item.titleId).then(
      () => onDone(item.intentId),
      () => setPhase('error'),
    );
  }

  return (
    <li className={ROW_CLASS[rowKind]} data-testid="waiting-row" aria-busy={phase === 'submitting'}>
      {item.posterPath !== null ? (
        <img
          className="waiting-row__poster"
          src={`${TMDB_IMAGE_BASE}${item.posterPath}`}
          srcSet={`${TMDB_IMAGE_BASE}${item.posterPath} 1x, ${TMDB_IMAGE_BASE_2X}${item.posterPath} 2x`}
          alt=""
          data-testid="waiting-poster"
        />
      ) : (
        <div
          className="waiting-row__poster waiting-row__poster--empty"
          data-testid="waiting-poster-placeholder"
        />
      )}

      <div className="waiting-row__body">
        <div className="waiting-row__heading">
          {flagged.length > 0 && (
            <span className="waiting-row__badge" data-testid="waiting-streaming-badge">
              {WAITING_NOW_STREAMING_BADGE}
            </span>
          )}
          <h2 className="waiting-row__name" data-testid="waiting-name">
            {item.name}
          </h2>
          <EditionLabels labels={item.editionLabels} />
        </div>

        {/* Library's `title-row__facts`: the `·` separators are CSS-generated. */}
        {(item.releaseYear !== null || mediaType !== null) && (
          <p className="waiting-row__meta" data-testid="waiting-meta">
            {item.releaseYear !== null && (
              <span data-testid="waiting-year">
                {releaseYearText(item.releaseYear, (item.editionLabels?.length ?? 0) > 0)}
              </span>
            )}
            {mediaType !== null && <span data-testid="waiting-media-type">{mediaType}</span>}
          </p>
        )}

        {flagged.length > 0 ? (
          <div className="waiting-row__status">
            <ServiceBadges services={flaggedServices} decorative />
            <p className="waiting-row__flag" data-testid="waiting-flag">
              {`${WAITING_NOW_ON_PREFIX} ${flagged.map(serviceLabel).join(' and ')} — `}
              {/* Straight to the import for that service, never an auto-add. */}
              <Link
                to={`/upload?service=${encodeURIComponent(flagged[0] ?? '')}`}
                data-testid="waiting-flag-link"
              >
                {WAITING_NOW_ON_INVITATION}
              </Link>
              {item.streamingSince != null && (
                <span className="waiting-row__since" data-testid="waiting-streaming-since">
                  {` (${WAITING_STREAMING_SINCE} ${friendlyDate(item.streamingSince)})`}
                </span>
              )}
            </p>
          </div>
        ) : rentStores !== null ? (
          /*
            #382 — the storefronts as compact chips under a "Rent or buy only"
            tag, rather than one long sentence. ⚠ The second half — not
            streaming on the owner's services, as of when — is still said in
            words: a rental offer is never the answer this view exists for.
          */
          <div className="waiting-row__rent" data-testid="waiting-rent-only">
            <span className="waiting-row__tag waiting-row__tag--rent">{WAITING_RENT_ONLY_TAG}</span>
            <ul className="waiting-row__chips" aria-label={WAITING_RENT_ONLY_LIST_LABEL}>
              {rentStores.map((store) => (
                <li key={store} className="chip" data-testid="waiting-rent-store">
                  {store}
                </li>
              ))}
            </ul>
            <p className="waiting-row__note">
              {`${WAITING_RENT_ONLY_SUFFIX} ${friendlyDate(item.availabilityCheckedAt ?? '')}.`}
            </p>
          </div>
        ) : (
          <p className="waiting-row__note" data-testid="waiting-availability">
            {availabilityLine(item)}
          </p>
        )}

        {others !== null && (
          <div className="waiting-row__other" data-testid="waiting-other-services">
            <span>{WAITING_OTHER_SERVICES_PREFIX}</span>
            <ServiceBadges services={others.services} />
            {others.providers.length > 0 && (
              <ul className="waiting-row__chips">
                {others.providers.map((provider) => (
                  <li key={provider} className="chip" data-testid="waiting-other-provider">
                    {provider}
                  </li>
                ))}
              </ul>
            )}
            <span>{WAITING_OTHER_SERVICES_SUFFIX}</span>
          </div>
        )}

        {forecast !== null && item.forecast != null && (
          /*
            #382 — the most useful fact on the row, as a headline: a tag that
            says Estimate or Announced, the service's mark and the "when".
            ⚠ The headline is decorative (`aria-hidden`); the sentence under
            it is the accessible truth and still LEADS with "Estimate:" for a
            guess (#380), so an estimate never reads as an announcement.
          */
          <div className={OUTLOOK_CLASS[forecastKind]}>
            <p className="waiting-row__outlook-head" aria-hidden="true">
              <span className={TAG_CLASS[forecastKind]}>{FORECAST_TAG[forecastKind]}</span>
              <Badge>
                <ServiceMark service={item.forecast.service} nameHidden />
              </Badge>
              <span className="waiting-row__when">{forecastWhen(item.forecast)}</span>
            </p>
            <p className={FORECAST_CLASS[forecastKind]} data-testid="waiting-forecast">
              {forecast.text}
            </p>
          </div>
        )}

        <div className="waiting-row__footer">
          {/*
            US-043 AC-1 — the discovery date and where it came from. The label
            carries "(rent/buy)" for a storefront (#378), and a search add says
            so rather than naming a storefront it never came from.
          */}
          <p className="waiting-row__date" data-testid="waiting-discovery">
            {item.discoverySource === 'search'
              ? `${intentSourceLabel(item.discoverySource)} on ${friendlyDate(item.discoveredAt)}`
              : `Seen on ${intentSourceLabel(item.discoverySource)} on ${friendlyDate(item.discoveredAt)}`}
          </p>

          <div className="waiting-row__actions">
            {phase === 'idle' && (
              <Button
                variant="ghost"
                data-testid="waiting-not-interested"
                aria-label={`${WAITING_NOT_INTERESTED}: ${item.name}`}
                disabled={offline}
                onClick={suppress}
              >
                <SuppressedIcon />
                {WAITING_NOT_INTERESTED}
              </Button>
            )}
            {phase === 'submitting' && (
              <Button variant="ghost" data-testid="waiting-suppressing" disabled>
                {'Working…'}
              </Button>
            )}
            {phase === 'error' && (
              <Button variant="ghost" data-testid="waiting-not-interested" onClick={suppress}>
                {RETRY_LABEL}
              </Button>
            )}
          </div>
        </div>
        {offline && phase === 'idle' && (
          <span className="offline-reason">{OFFLINE_DISABLED_REASON}</span>
        )}
        {phase === 'error' && (
          <p role="alert" data-testid="waiting-suppress-error">
            {WAITING_SUPPRESS_FAILED}
          </p>
        )}
      </div>
    </li>
  );
}

export function WaitingPage({
  items = [],
  loading = false,
  loadFailed = false,
  refreshFailed = false,
  onRetry,
  onSuppress = () => Promise.resolve(),
  onSearch,
  onSearchAdd,
}: WaitingPageProps = {}): JSX.Element {
  const offline = !useOnline();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const visible = orderWaiting(items.filter((item) => !dismissed.has(item.intentId)));

  return (
    <>
      {/* #382 — one page heading, Library's type, with the helper as its subtitle. */}
      <div className="waiting-heading">
        <h1>Waiting to stream</h1>
        <p className="waiting-heading__subtitle" data-testid="waiting-subtitle">
          {WAITING_SUBTITLE}
        </p>
      </div>

      {onSearch !== undefined && onSearchAdd !== undefined && (
        <WaitingSearchAdd onSearch={onSearch} onAdd={onSearchAdd} offline={offline} />
      )}

      {refreshFailed && (
        <p role="status" data-testid="waiting-refresh-failed">
          {WAITING_REFRESH_FAILED}
        </p>
      )}

      {loadFailed ? (
        <div role="alert" data-testid="waiting-load-error">
          <p>{'Couldn\u2019t load your waiting list. Nothing has changed.'}</p>
          {onRetry !== undefined && (
            <Button variant="secondary" onClick={onRetry}>
              {RETRY_LABEL}
            </Button>
          )}
        </div>
      ) : loading ? (
        <div role="status" data-testid="waiting-loading" aria-label={WAITING_LOADING}>
          <ul className="waiting-list waiting-list--loading">
            {[0, 1, 2].map((index) => (
              <li
                key={index}
                className="waiting-row waiting-row--skeleton"
                data-testid="waiting-row-skeleton"
                aria-hidden="true"
              />
            ))}
          </ul>
        </div>
      ) : visible.length === 0 ? (
        <div data-testid="waiting-empty">
          <p>{WAITING_EMPTY_TITLE}</p>
          <p>{WAITING_EMPTY_BODY}</p>
          <Link className="tap-target" to="/upload?source=fandango-at-home">
            {WAITING_EMPTY_ACTION}
          </Link>
        </div>
      ) : (
        <ul className="waiting-list" data-testid="waiting-list">
          {visible.map((item) => (
            <WaitingRow
              key={item.intentId}
              item={item}
              offline={offline}
              onSuppress={onSuppress}
              onDone={(intentId) => setDismissed((previous) => new Set([...previous, intentId]))}
            />
          ))}
        </ul>
      )}

      {/* Unconditional: the attribution is a condition of use, not a caption
          for whichever rows happen to have provider data today. */}
      <p className="justwatch-attribution" data-testid="justwatch-attribution">
        {JUSTWATCH_ATTRIBUTION}
      </p>
      {/* #380 — also unconditional: a condition of Watchmode's free plan. */}
      <p className="watchmode-attribution" data-testid="watchmode-attribution">
        {WATCHMODE_ATTRIBUTION}{' '}
        <a href={WATCHMODE_ATTRIBUTION_URL} target="_blank" rel="noopener noreferrer">
          {WATCHMODE_ATTRIBUTION_LINK}
        </a>
      </p>
    </>
  );
}
