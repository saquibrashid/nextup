/**
 * `GET /api/service-state` — per-service last-updated dates (`specs/api.md`
 * §6.28, US-022, REQ-039, TASK-041).
 *
 * ⚠ **Every service is always present in the response**, including one the
 * owner has never captured. The SPA renders one chip per service from this
 * array (`specs/ui.md` §2.1); omitting a service with no state would make the
 * chip vanish, and a missing chip reads as "nothing to report" rather than
 * "never updated" — the exact misreading US-022 AC-3 exists to prevent. So the
 * enumeration drives the response and the store only fills it in.
 *
 * ⚠ **No staleness, at all** (`A46`). No threshold, no `stale` flag, no nudge,
 * no re-capture prompt. `ageDays` is the number the label is built from, not a
 * trigger — REQ-040 and ASM-038 are retired and `LIST_STALENESS_DAYS` does not
 * exist. Show the fact; never nag about it.
 *
 * Only `applied` batches ever reach `serviceState` (US-022 AC-4): the write
 * happens at batch close, so an abandoned or failed batch leaves the date
 * exactly as it was. That property belongs to the batch-close path and is
 * asserted there — this route reads what it finds.
 */

import { SERVICES, type Service, ageInDays, serviceFreshnessLabel } from '@nextup/domain';
import { type Router } from 'express';

import { listServiceStates } from '../repository/ownerData.js';
import { requireOwnerId } from '../middleware/requestContext.js';

export interface ServiceStateRow {
  service: string;
  lastCompletedBatchAt: Date | null;
  lastCompletedBatchId: string | null;
}

export interface ServiceStateItem {
  service: Service;
  lastCompletedBatchAt: string | null;
  lastCompletedBatchId: string | null;
  ageDays: number | null;
  label: string;
}

/**
 * Shapes the full per-service array from whatever rows exist.
 *
 * `now` is injected rather than read from the clock so `ageDays` is testable
 * without freezing time globally — and so a future caller can render "as at"
 * a batch's own timestamp without this function changing.
 */
export function toServiceStateItems(
  rows: readonly ServiceStateRow[],
  now: Date,
): ServiceStateItem[] {
  const byService = new Map(rows.map((row) => [row.service, row]));

  return SERVICES.map((service) => {
    const row = byService.get(service);
    const at = row?.lastCompletedBatchAt ?? null;
    // `null` propagates all the way to the label: never captured is a distinct
    // state from captured-today, and collapsing them would tell the owner
    // their empty Max list is up to date.
    const ageDays = at === null ? null : ageInDays(at, now);

    return {
      service,
      lastCompletedBatchAt: at === null ? null : at.toISOString(),
      lastCompletedBatchId: row?.lastCompletedBatchId ?? null,
      ageDays,
      label: serviceFreshnessLabel(service, ageDays),
    };
  });
}

export function registerServiceStateRoutes(router: Router): void {
  router.get('/service-state', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const rows = await listServiceStates(ownerId);
    res.status(200).json({ services: toServiceStateItems(rows, new Date()) });
  });
}
