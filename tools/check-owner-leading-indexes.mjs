/**
 * `T-INV-014` — every table has an `owner_id` column, and every index that
 * serves an **owner-scoped query** leads with it (`specs/data-model.md` §16.2).
 *
 * WHY THE RULE EXISTS
 * -------------------
 * This is the product's tenancy-isolation shape. Every read is scoped to one
 * owner, so an index that does not lead with `owner_id` cannot be used to
 * satisfy the owner predicate by seek; SQL Server scans and then filters. On a
 * Basic-tier database (5 DTU) that is the difference between a list that
 * renders and a list that times out. It is also the structural reason a
 * missing `WHERE owner_id = ?` shows up as a performance cliff rather than as
 * a silent cross-owner read.
 *
 * WHY IT IS NARROWED, AND WHY THE NARROWING IS AN ALLOW-LIST
 * ---------------------------------------------------------
 * ⚠ The rule's original form — "every index leads with it" — was simply not
 * true of the schema, and never had been: 12 indexes did not, all of them
 * correctly. It was also unimplementable as a remedy, because `T-MIG-001`
 * forbids `DROP INDEX`; the 12 could not have been rewritten even if the rule
 * had been right. A rule that can only be satisfied by a forbidden migration
 * is a rule that gets suppressed.
 *
 * Two kinds of index are genuinely exempt:
 *
 *   - **Single-column foreign-key indexes.** These exist to serve joins and
 *     the referential-integrity checks SQL Server runs on delete/update. A
 *     leading `owner_id` makes them WORSE at that job, because the engine
 *     arrives holding the FK value and not the owner.
 *   - **`uploaded_image_retain_until`**, which serves the 30-day blob purge —
 *     one of the exactly two permitted non-owner processes. It sweeps ACROSS
 *     owners by design, so owner-leading would defeat its only purpose.
 *
 * ⚠ THE EXEMPTION IS AN ALLOW-LIST, NOT A PREDICATE. Each exempt index is
 * named. A new index is a violation until someone adds it here deliberately,
 * so the narrowing cannot be used to wave through tomorrow's genuinely
 * owner-scoped index by having it happen to look like a foreign key.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SCHEMA_PATH = 'prisma/schema.prisma';

/**
 * Indexes that deliberately do not lead with `owner_id`, each with the reason
 * it is exempt. Adding an entry here is a schema decision, not a lint fix.
 */
export const EXEMPT_INDEXES = new Map([
  ['upload_batch_derived_from', 'FK index: upload_batch.derived_from_batch_id'],
  ['title_created_by_batch', 'FK index: title.created_by_batch_id'],
  ['service_listing_title', 'FK index: service_listing.title_id'],
  ['service_listing_removed_by_batch', 'FK index: service_listing.removed_by_batch_id'],
  ['service_listing_removed_by_group', 'FK index: service_listing.removed_by_group_id'],
  ['service_listing_created_by_batch', 'FK index: service_listing.created_by_batch_id'],
  ['batch_change_title', 'FK index: batch_change.title_id'],
  ['batch_change_listing', 'FK index: batch_change.listing_id'],
  ['extraction_candidate_resolved_title', 'FK index: extraction_candidate.resolved_title_id'],
  ['candidate_source_image_candidate', 'FK index: candidate_source_image.candidate_id'],
  ['service_state_last_batch', 'FK index: service_state.last_completed_batch_id'],
  [
    'uploaded_image_retain_until',
    'cross-owner sweep: the 30-day blob purge, one of the two permitted non-owner processes',
  ],
]);

/** The owner column, as Prisma spells it in the schema. */
export const OWNER_FIELD = 'ownerId';

const MODEL_RE = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
const INDEX_RE = /@@(index|unique)\(\s*\[([^\]]*)\][^)]*?map:\s*"([^"]+)"/g;

/** The first column of an index, with any `(sort: Desc)` modifier removed. */
function leadingColumn(columns) {
  const first = columns.split(',')[0] ?? '';
  return first.replace(/\(.*$/, '').trim();
}

/**
 * Every place the schema breaks owner-leading isolation. Returns
 * human-readable strings; `[]` means clean.
 *
 * `root` is a parameter so the spec can point it at a scratch schema and prove
 * each rule catches what it claims — a checker for a negative that is only
 * ever run against a clean tree is indistinguishable from a no-op.
 */
export function ownerLeadingIndexViolations(root = process.cwd()) {
  const schema = readFileSync(join(root, SCHEMA_PATH), 'utf8');
  const violations = [];

  for (const [, model, body] of schema.matchAll(MODEL_RE)) {
    if (!new RegExp(`^\\s+${OWNER_FIELD}\\s+String`, 'm').test(body)) {
      violations.push(`model ${model} has no ${OWNER_FIELD} column`);
    }

    for (const [, kind, columns, name] of body.matchAll(INDEX_RE)) {
      if (EXEMPT_INDEXES.has(name)) continue;
      const lead = leadingColumn(columns);
      if (lead !== OWNER_FIELD) {
        violations.push(
          `${model}.@@${kind} "${name}" leads with ${lead || '(nothing)'}, not ${OWNER_FIELD}`,
        );
      }
    }
  }

  return violations.sort();
}

/**
 * Exempt names that no longer match any index in the schema. Non-vacuity: an
 * exemption pointing at a deleted index is dead weight that makes the
 * allow-list look better justified than it is.
 */
export function staleExemptions(root = process.cwd()) {
  const schema = readFileSync(join(root, SCHEMA_PATH), 'utf8');
  return [...EXEMPT_INDEXES.keys()].filter((name) => !schema.includes(`map: "${name}"`)).sort();
}

if (process.argv[1] && process.argv[1].endsWith('check-owner-leading-indexes.mjs')) {
  const found = [
    ...ownerLeadingIndexViolations(),
    ...staleExemptions().map((n) => `stale exemption: ${n}`),
  ];
  if (found.length > 0) {
    console.error('Owner-scoped indexes must lead with ownerId (T-INV-014).');
    for (const v of found) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log(`owner-leading index gate: clean (${EXEMPT_INDEXES.size} named exemptions).`);
}
