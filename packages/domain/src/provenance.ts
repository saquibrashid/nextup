/**
 * TASK-074 — provenance (`REQ-068`, US-031, `specs/data-model.md` §3.7, §8.1).
 *
 * ⚠ WHY THIS EXISTS AT ALL, GIVEN v1 UNDO IS CREATES-ONLY. `provenance
 * .modified` records the pre-batch value of every modified attribute even
 * though nothing in v1 undoes a modification, because REQ-075's refusal
 * enumeration reads straight out of these three arrays: undo refuses a batch
 * that modified or removed anything, and it can only know that if the record
 * was written at the time. A batch closed today with no provenance can never
 * be undone correctly tomorrow — the information is gone.
 *
 * ⚠ CHANGES MADE OUTSIDE A BATCH APPEAR IN NO ARRAY (US-031 AC-5). Fix-match,
 * suppress, un-suppress and restore carry `batchId: null` on the affected
 * record and are deliberately invisible here, so a batch undo never reverses
 * an owner decision the owner made afterwards.
 *
 * The store keeps one `batch_change` ROW per event rather than three JSON
 * arrays (`specs/data-model.md` §15.3). This module is the only place that
 * knows how those rows fold back into the §3.7 shape, so a reader and a writer
 * cannot disagree about it.
 */

import type { BatchProvenance } from './types.js';

/** The closed set the `ck_change_kind` CHECK constraint enforces. */
export const CHANGE_KINDS = [
  'title_created',
  'listing_added',
  'listing_removed',
  'attr_modified',
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/**
 * One `batch_change` row as stored.
 *
 * `prevValue`/`nextValue` hold JSON *scalars* (finding E-3), so they arrive as
 * JSON text and are parsed here rather than trusted as plain strings.
 */
export interface BatchChangeRow {
  kind: string;
  titleId: string | null;
  listingId: string | null;
  attr: string | null;
  prevValue: string | null;
  nextValue: string | null;
}

/**
 * ⚠ `prev_value`/`next_value` hold JSON *scalars*, and their CHECK is
 * `ISJSON(x, VALUE)` — plain `ISJSON` returns 0 for a scalar (finding E-3).
 * Every write of those two columns MUST go through this, because close is one
 * transaction: a rejected provenance insert takes the whole close down with
 * it, and it does so only for the values that happen to be scalars.
 */
export function jsonScalar(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function parseScalar(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // A value that is not valid JSON is returned as-is rather than dropped.
    // Provenance is evidence; silently discarding a row because its payload
    // cannot be parsed would make an undo refusal look like a permission.
    return value;
  }
}

/**
 * Fold stored rows into the §3.7 three-array shape.
 *
 * ⚠ `title_created` and `listing_added` BOTH land in `created`, distinguished
 * only by `titleWasCreated`. §8.1 defines them as one event class with two
 * flavours: a work new to the library, and a work that gained a service. Undo
 * has to reverse both, and splitting them here would give it two lists to
 * remember to walk instead of one.
 *
 * ⚠ A `title_created` row is folded INTO the `listing_added` row for the same
 * title where one exists, because §3.7 models a creation as a single entry
 * carrying both ids. Emitting two entries would double-count every new title
 * in `created.length`, which SD-03's creates-only test reads.
 *
 * Rows with no `titleId` are skipped: every §3.7 entry is keyed on a title, so
 * a row without one describes nothing that can be undone.
 */
export function toBatchProvenance(rows: readonly BatchChangeRow[]): BatchProvenance {
  const provenance: BatchProvenance = { created: [], modified: [], removed: [] };
  const titlesCreated = new Set<string>();

  for (const row of rows) {
    if (row.kind === 'title_created' && row.titleId !== null) titlesCreated.add(row.titleId);
  }

  const foldedInto = new Set<string>();

  for (const row of rows) {
    if (row.titleId === null) continue;

    switch (row.kind) {
      case 'title_created': {
        // Emitted only when no listing row folds it in. A title created
        // without a listing is an integrity problem (I-3), not something to
        // hide, so it is still reported.
        const hasListing = rows.some(
          (other) => other.kind === 'listing_added' && other.titleId === row.titleId,
        );
        if (!hasListing) {
          provenance.created.push({
            titleId: row.titleId,
            listingId: null,
            titleWasCreated: true,
          });
        }
        break;
      }
      case 'listing_added': {
        const titleWasCreated = titlesCreated.has(row.titleId) && !foldedInto.has(row.titleId);
        if (titleWasCreated) foldedInto.add(row.titleId);
        provenance.created.push({
          titleId: row.titleId,
          listingId: row.listingId,
          titleWasCreated,
        });
        break;
      }
      case 'listing_removed': {
        if (row.listingId === null) break;
        provenance.removed.push({
          titleId: row.titleId,
          listingId: row.listingId,
          beforeState: 'active',
          // The removal group id travels in `nextValue`; §3.7 requires it on
          // every removed entry because US-017 undoes a GROUP, not a listing.
          groupId: String(parseScalar(row.nextValue) ?? ''),
        });
        break;
      }
      case 'attr_modified': {
        if (row.attr === null) break;
        provenance.modified.push({
          titleId: row.titleId,
          attr: row.attr,
          before: parseScalar(row.prevValue),
          after: parseScalar(row.nextValue),
        });
        break;
      }
      default:
        // An unknown kind is ignored rather than thrown on: the CHECK
        // constraint already refuses one at write time, so reaching here means
        // reading rows written by a newer schema, and a read that throws would
        // take out the whole batch view.
        break;
    }
  }

  return provenance;
}
