/**
 * TASK-044 — the no-scheduler static gate (`T-CI-005`).
 *
 * US-010 AC-5 and US-036 AC-2/AC-5: **no timer, cron, `setInterval`, queue
 * trigger or scheduled workflow touches list state**, and exactly **three**
 * non-owner-initiated processes exist — the lazy TMDB metadata refresh, the
 * lazy IMDb rating refresh, and the 30-day blob purge.
 *
 * ⚠ **THIS GATE DID NOT EXIST UNTIL NOW, AND ITS ID WAS BEING CITED AS THOUGH
 * IT DID.** `specs/testing.md` defines `T-CI-005` in three places and several
 * backlog rows cite it as their evidence, but nothing in the suite implemented
 * it — the assertion "no scheduler exists" was passing by never running
 * (`T-CI-008`'s failure mode, one level up). `docs/backlog.md` TASK-171 already
 * records the discovery; this file closes it.
 *
 * ⚠ **THE COUNT IS THE TRIPWIRE, NOT THE RULE.** What invariant 5 forbids is a
 * background process changing membership, ordering or service badges. All three
 * permitted entries are metadata-only or bytes-only and can do none of those.
 * A gate that permitted "some" background processes would assert nothing, so
 * the number is exact and small — and a fourth is an amendment to PRD §7.4,
 * `specs/testing.md` US-036 AC-2 and product invariant 5 in the same change,
 * never an implementation decision.
 *
 * ⚠ **`setTimeout` IS DELIBERATELY NOT BANNED.** Retry backoff and the TMDB
 * rate gate both need it, and a blanket ban on a construct the codebase
 * legitimately requires is a gate that gets disabled rather than obeyed —
 * which is strictly worse than no gate. What makes something a scheduler is
 * that it *recurs on its own*: `setInterval`, a cron expression, a scheduler
 * package, a timer trigger, a SQL Agent job, or a `schedule:` workflow. That
 * precision is asserted by `T-CI-005i`, so nobody "tightens" it back into
 * uselessness.
 *
 * ⚠ **SCOPED TO `apps/api/src`, NOT `apps/web/src`, ON PURPOSE.** Invariant 5
 * is about processes the *server* runs without the owner. A browser poll only
 * runs while the owner is looking at the page, so it is owner-initiated by
 * construction; banning it here would block legitimate progress polling while
 * catching nothing the invariant cares about.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PERMITTED_BACKGROUND_PROCESSES } from '../../tools/check-mutating-routes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Source {
  file: string;
  text: string;
}

/**
 * A scheduler-shaped construct in application source.
 *
 * Each entry is a pattern plus the reason it is a scheduler, so a finding
 * explains itself rather than pointing at a regex.
 */
const SOURCE_SCHEDULERS: readonly { readonly re: RegExp; readonly why: string }[] = [
  {
    re: /\bsetInterval\s*\(/,
    why: '`setInterval` recurs on its own — that is a timer, whatever it does',
  },
  {
    re: /\bsetTimeout\s*\([^)]*\)\s*;?\s*\}\s*\)\s*;?\s*\}\s*setTimeout/,
    why: 'a self-rescheduling `setTimeout` is a timer wearing a different name',
  },
  {
    re: /from\s+['"](?:node-)?cron['"]|from\s+['"]node-schedule['"]|from\s+['"](?:bull|bullmq|agenda|bree|toad-scheduler)['"]/,
    why: 'a scheduler or job-queue package',
  },
  {
    re: /require\s*\(\s*['"](?:node-)?cron['"]|require\s*\(\s*['"]node-schedule['"]/,
    why: 'a scheduler package via `require`',
  },
  {
    re: /['"](?:[\d*/,-]+\s+){4}[\d*/,-]+['"]/,
    why: 'a five-field cron expression',
  },
  {
    re: /timerTrigger|"type"\s*:\s*"timerTrigger"/,
    why: 'an Azure Functions timer trigger',
  },
  {
    re: /queueTrigger|serviceBusTrigger|eventGridTrigger/,
    why: 'a queue/event trigger runs without the owner',
  },
];

/** Infrastructure that would schedule something outside the application. */
const INFRA_SCHEDULERS: readonly { readonly re: RegExp; readonly why: string }[] = [
  {
    re: /Microsoft\.Sql\/servers\/jobAgents/i,
    why: 'an Azure SQL Elastic Job agent — prohibited outright by invariant 4',
  },
  {
    re: /Microsoft\.Scheduler|Microsoft\.Logic\/workflows/i,
    why: 'a scheduler or Logic App',
  },
  { re: /\bRecurrence\b/, why: 'a recurrence trigger' },
  {
    re: /Microsoft\.Web\/sites\/config[\s\S]{0,200}?WEBSITE_TIME_ZONE/i,
    why: 'a WebJob timer',
  },
];

/** SQL that would install a job inside the database engine. */
const SQL_SCHEDULERS: readonly { readonly re: RegExp; readonly why: string }[] = [
  { re: /sp_add_job\b/i, why: 'a SQL Agent job' },
  { re: /sp_add_jobschedule\b/i, why: 'a SQL Agent schedule' },
  { re: /jobs\.sp_add_job\b/i, why: 'an Elastic Job' },
  { re: /\bWAITFOR\s+DELAY\b/i, why: 'a delay loop is a scheduler with extra steps' },
];

/**
 * The gate itself: pure over (file, text) pairs so it can be aimed at the real
 * tree AND at synthetic sources. A checker that can only be pointed at a clean
 * tree proves nothing about what it would catch.
 */
export function findSchedulers(
  sources: readonly Source[],
  patterns: readonly { readonly re: RegExp; readonly why: string }[],
): string[] {
  const findings: string[] = [];
  for (const { file, text } of sources) {
    // Comments discuss the ban (`runExtraction.ts` says so in as many words),
    // and a gate that fired on its own documentation would be deleted within
    // the week. Strip comments before matching, never suppress by filename.
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    for (const { re, why } of patterns) {
      if (re.test(code)) findings.push(`${file}: ${why}`);
    }
  }
  return findings;
}

/**
 * Walk `dir` and read every file whose extension is listed.
 *
 * Deliberately hand-rolled rather than reaching for a glob dependency: every
 * new package has to be justified against NFR-004 and cleared by the
 * allow-list, and twelve lines of `readdirSync` is a poor trade against that.
 */
function read(dir: string, extensions: readonly string[]): Source[] {
  const root = path.join(ROOT, dir);
  const out: Source[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!extensions.some((ext) => entry.endsWith(ext))) continue;
      out.push({
        file: path.relative(ROOT, full).split(path.sep).join('/'),
        text: readFileSync(full, 'utf8'),
      });
    }
  };
  walk(root);
  return out;
}

describe('T-CI-005 · no scheduler anywhere (US-010 AC-5, US-036 AC-2/AC-5)', () => {
  it('T-CI-005a: no timer, cron or queue trigger exists in the API source', () => {
    const sources = read('apps/api/src', ['.ts']);
    expect(sources.length).toBeGreaterThan(20);
    expect(findSchedulers(sources, SOURCE_SCHEDULERS)).toEqual([]);
  });

  it('T-CI-005b: a planted setInterval IS caught', () => {
    // The mutation that matters. A gate only ever aimed at a clean tree has
    // asserted that the tree is clean, not that the gate works.
    const findings = findSchedulers(
      [{ file: 'x.ts', text: 'setInterval(() => refreshEverything(), 60_000);' }],
      SOURCE_SCHEDULERS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('recurs on its own');
  });

  it('T-CI-005c: a planted scheduler package and cron expression ARE caught', () => {
    expect(
      findSchedulers([{ file: 'x.ts', text: "import cron from 'node-cron';" }], SOURCE_SCHEDULERS),
    ).toHaveLength(1);
    expect(
      findSchedulers([{ file: 'x.ts', text: "schedule('*/5 * * * *', run);" }], SOURCE_SCHEDULERS),
    ).toHaveLength(1);
    expect(
      findSchedulers(
        [
          {
            file: 'x.ts',
            text: 'export async function run(context: TimerContext) { timerTrigger }',
          },
        ],
        SOURCE_SCHEDULERS,
      ),
    ).toHaveLength(1);
  });

  it('T-CI-005d: no workflow runs on a schedule, and a planted one IS caught', () => {
    const workflows = read('.github/workflows', ['.yml', '.yaml']);
    expect(workflows.length).toBeGreaterThan(0);
    const scheduled = workflows.filter(({ text }) => /^\s*schedule:\s*$/m.test(text));
    expect(scheduled.map((w) => w.file)).toEqual([]);

    // …and the detector is not vacuous.
    const planted = 'on:\n  schedule:\n    - cron: "0 3 * * *"\n';
    expect(/^\s*schedule:\s*$/m.test(planted)).toBe(true);
  });

  it('T-CI-005e: no infrastructure template schedules anything', () => {
    const templates = read('infra', ['.bicep', '.json']);
    expect(templates.length).toBeGreaterThan(0);
    expect(findSchedulers(templates, INFRA_SCHEDULERS)).toEqual([]);

    expect(
      findSchedulers(
        [{ file: 'x.bicep', text: "resource a 'Microsoft.Sql/servers/jobAgents@2021-11-01' = {}" }],
        INFRA_SCHEDULERS,
      ),
    ).toHaveLength(1);
  });

  it('T-CI-005f: no migration installs a job in the engine', () => {
    const migrations = read('prisma/migrations', ['.sql']);
    expect(migrations.length).toBeGreaterThan(0);
    expect(findSchedulers(migrations, SQL_SCHEDULERS)).toEqual([]);

    expect(
      findSchedulers(
        [{ file: 'x.sql', text: "EXEC msdb.dbo.sp_add_job @job_name = N'purge';" }],
        SQL_SCHEDULERS,
      ),
    ).toHaveLength(1);
  });

  it('T-CI-005g: exactly three non-owner processes exist, and they are named', () => {
    expect(PERMITTED_BACKGROUND_PROCESSES).toHaveLength(3);
    expect((PERMITTED_BACKGROUND_PROCESSES as { op: string }[]).map((p) => p.op).sort()).toEqual([
      'imdb-rating-refresh',
      'screenshot-purge',
      'tmdb-metadata-refresh',
    ]);
    // Each one states WHY it is admissible. An unexplained entry is how a
    // fourth arrives without anyone amending PRD §7.4.
    for (const p of PERMITTED_BACKGROUND_PROCESSES as { why: string }[]) {
      expect(p.why.length).toBeGreaterThan(20);
    }
  });

  it('T-CI-005h: the two lazy refreshes are triggered by a READ, never by a timer', () => {
    // The exemption in `specs/api.md` §6.4 is conditional on the trigger. Both
    // refresh modules must be reachable only from a read handler — if either
    // ever grew a timer it would stop being an exemption and start being the
    // thing invariant 5 forbids.
    const refresh = read('apps/api/src/services', ['.ts']).filter(({ file }) =>
      /(tmdbRefresh|imdbRatings)\.ts$/.test(file),
    );
    expect(refresh.map((s) => s.file)).toEqual([
      'apps/api/src/services/imdbRatings.ts',
      'apps/api/src/services/tmdbRefresh.ts',
    ]);
    expect(findSchedulers(refresh, SOURCE_SCHEDULERS)).toEqual([]);

    const titles = readFileSync(path.join(ROOT, 'apps/api/src/routes/titles.ts'), 'utf8');
    expect(titles).toContain('refreshStaleMetadata');
    expect(titles).toContain('beginRatingRefresh');
  });

  it('T-CI-005i: `setTimeout` alone is NOT a finding — the gate stays precise', () => {
    // Backoff and the TMDB rate gate both need it. A gate that banned it would
    // be switched off rather than obeyed, which is worse than no gate at all.
    expect(
      findSchedulers(
        [{ file: 'x.ts', text: 'await new Promise((r) => setTimeout(r, backoffMs));' }],
        SOURCE_SCHEDULERS,
      ),
    ).toEqual([]);
  });
});
