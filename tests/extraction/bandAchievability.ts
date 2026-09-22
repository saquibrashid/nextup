/**
 * Parse a committed live quality report, so a BAND can be checked against what
 * the incumbent actually measured — offline, for free, in CI.
 *
 * ⚠ THIS EXISTS BECAUSE THE ONLY GUARD OF THIS KIND LIVED WHERE NOTHING RUNS
 * IT. `T-AI-051k` already states the rule for L2 — *"the floor must not exceed
 * the incumbent's measured worst pair"* — and it is written inside
 * `goldenLive.spec.ts`, which is excluded from every Vitest project because it
 * spends real money. So the check that would catch an unachievable band only
 * executes during the billed run whose bands it is meant to protect, and
 * `T-CI-008` names the consequence: a spec no runner collects passes by never
 * running. The rule was sound and unenforced.
 *
 * ⚠ AND IT WAS NEVER GENERALISED. L1 has `T-AI-051j`, which pins each floor at
 * or below what the OFFLINE recordings achieve. That is a different and weaker
 * claim, and the difference is the entire defect: replay is deterministic, live
 * resamples, and a floor calibrated against replay can be unreachable live
 * while `j` reports it honest. L2 reached 0.95 that way — a value no arm has
 * ever cleared, production included — and sat red run after run while blocking
 * every model change through §9.7 Stage 3. The same derivation is still
 * visible in the L1 table (`netflix-mylist-desktop-01`, floor 0.900 from an
 * offline 10/10, measured 0.800 in all three live runs).
 *
 * A band no arm has ever cleared is not a band: it cannot separate a healthy
 * run from a regression, it teaches the owner to skip the failure, and through
 * Stage 3 it pins the product to the incumbent by a threshold the incumbent
 * itself fails.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { GOLDEN } from './goldenScorer.js';

/** `docs/evaluation/` — where the committed baselines live. */
export const EVALUATION_DIR = path.resolve(GOLDEN, '../../../docs/evaluation');

export interface ReportRunAggregate {
  readonly run: number;
  readonly recall: number;
  readonly falseTitleRate: number;
  readonly fabricationRate: number;
  readonly chromeRejection: number;
}

export interface ReportImageRecall {
  readonly imageId: string;
  readonly floor: number;
  readonly runs: readonly number[];
}

export interface LiveReport {
  readonly file: string;
  readonly aggregates: readonly ReportRunAggregate[];
  readonly perImage: readonly ReportImageRecall[];
  readonly costUsd: number;
}

/**
 * The most recent committed INCUMBENT baseline.
 *
 * ⚠ ARM-SLUGGED REPORTS ARE EXCLUDED BY THE PATTERN, not by filtering after
 * the fact. `golden-<date>-<slug>.md` is a probe of a challenger; a band is
 * achievable only if the model actually in production reaches it, and reading
 * a probe would let a band be justified by a reader nobody ships.
 */
export function latestIncumbentReport(dir: string = EVALUATION_DIR): string {
  const baselines = readdirSync(dir)
    .filter((f) => /^golden-\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort();
  const latest = baselines.at(-1);
  if (latest === undefined) {
    throw new Error(
      `no committed incumbent baseline in ${dir}: a band cannot be checked for achievability ` +
        'without a live measurement. Run `npm run golden:live` (manual, billed).',
    );
  }
  return latest;
}

const num = (s: string | undefined): number => {
  const v = Number(s);
  if (!Number.isFinite(v)) throw new Error(`report carries a non-numeric value: ${String(s)}`);
  return v;
};

export function parseLiveReport(file: string, dir: string = EVALUATION_DIR): LiveReport {
  const text = readFileSync(path.join(dir, file), 'utf8');

  const aggregates: ReportRunAggregate[] = [
    ...text.matchAll(
      /^\|\s*(\d+)\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|/gm,
    ),
  ].map((m) => ({
    run: num(m[1]),
    recall: num(m[2]),
    falseTitleRate: num(m[3]),
    fabricationRate: num(m[4]),
    chromeRejection: num(m[5]),
  }));

  const perImage: ReportImageRecall[] = [
    ...text.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|\s*([0-9.]+)\s*\|((?:\s*[0-9.]+\s*\|)+)/gm),
  ].map((m) => ({
    imageId: String(m[1]),
    floor: num(m[2]),
    runs: String(m[3])
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .map((s) => num(s)),
  }));

  // ⚠ The cost line names its price card (`T-AI-056`), so the number is only
  // meaningful beside that text — but L7 is a ceiling on token GROWTH, and the
  // card is held fixed across arms precisely so the figure stays comparable.
  const cost = /Estimated cost: \*\*\$([0-9.]+)\*\*/.exec(text);
  if (cost === null) {
    throw new Error(`${file} has no L7 cost line`);
  }

  if (aggregates.length === 0) throw new Error(`${file} has no per-run aggregate table`);
  if (perImage.length === 0) throw new Error(`${file} has no per-image L1 table`);

  return { file, aggregates, perImage, costUsd: num(cost[1]) };
}

export interface BandBreach {
  readonly band: string;
  readonly detail: string;
  readonly measured: number;
  readonly band_: number;
}

/**
 * Every band in `report` that the incumbent did NOT clear.
 *
 * ⚠ A FLOOR AND A CEILING FAIL IN OPPOSITE DIRECTIONS and the caller must not
 * be asked to remember which is which — `direction` is carried per band, so a
 * new band cannot be added with the comparison silently inverted. An inverted
 * comparison here reports every healthy band as a breach and every real breach
 * as healthy, and the list still looks plausible.
 */
export function unachievableBands(
  report: LiveReport,
  bands: {
    readonly falseTitleCeiling: number;
    readonly fabricationCeiling: number;
    readonly costCeilingUsd: number;
    readonly minRecall: Readonly<Record<string, number>>;
  },
): BandBreach[] {
  const out: BandBreach[] = [];

  for (const a of report.aggregates) {
    if (a.falseTitleRate > bands.falseTitleCeiling) {
      out.push({
        band: 'L5',
        detail: `run ${String(a.run)} false-title rate`,
        measured: a.falseTitleRate,
        band_: bands.falseTitleCeiling,
      });
    }
    if (a.fabricationRate > bands.fabricationCeiling) {
      out.push({
        band: 'L4',
        detail: `run ${String(a.run)} fabrication rate`,
        measured: a.fabricationRate,
        band_: bands.fabricationCeiling,
      });
    }
  }

  for (const img of report.perImage) {
    // ⚠ EVERY run, not the best one. A floor cleared by one run of three is
    // cleared by luck; §9.7 Stage 2 runs three times because one is not a
    // measurement, and `T-AI-051a` asserts the floor per run.
    const worst = Math.min(...img.runs);
    const floor = bands.minRecall[img.imageId];
    if (floor !== undefined && worst < floor) {
      out.push({
        band: 'L1',
        detail: `${img.imageId} worst-run recall`,
        measured: worst,
        band_: floor,
      });
    }
  }

  if (report.costUsd > bands.costCeilingUsd) {
    out.push({
      band: 'L7',
      detail: 'run cost',
      measured: report.costUsd,
      band_: bands.costCeilingUsd,
    });
  }

  return out;
}

export const describeBreach = (b: BandBreach): string =>
  `${b.band} · ${b.detail} ${b.measured.toFixed(4)} vs band ${b.band_.toFixed(4)}`;
