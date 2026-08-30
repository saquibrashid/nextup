/**
 * The primary-reader bake-off decision rule — `specs/ai.md` §9.7, TASK-168.
 *
 * ⚠ THIS RULE IS PRE-COMMITTED. IT MUST BE MERGED BEFORE ANY CANDIDATE'S
 * NUMBERS ARE KNOWN. §9.7 says so in as many words, and the reason is not
 * ceremony: a threshold written after the results is not a rule, it is a
 * selection of the answer the author already preferred — and it is always the
 * cheaper model that benefits. If this file needs to change, change it in a
 * separate commit that states why, BEFORE the run.
 *
 * ⚠ IT IS PURE AND TOTAL. No I/O, no clock, no randomness, and it never
 * throws — every input, including a malformed or hostile one, yields a
 * decision. Totality is a safety property here: a bake-off harness that
 * crashed on a NaN would invite someone to "fix" the input, and the failure
 * direction of an exception is whatever the caller's catch block happens to
 * do. Invalid input resolves to INCUMBENT STAYS, explicitly.
 *
 * ⚠ THE DEFAULT IS ALWAYS THE INCUMBENT. Every uncertainty — a failed row, a
 * missing capability, an unreadable number, a difference too small to
 * distinguish from noise — resolves the same way. That is what stops
 * `NFR-012a` being eroded one small regression at a time, and it is why there
 * is no code path that reaches `challenger-adopted` by default.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not run the bake-off, score anything,
 * or read a recording. It decides, given two already-computed metric sets,
 * which reader the product should use. Producing those metric sets needs the
 * 12-image corpus (TASK-078) and the scorer (TASK-079), neither of which
 * exists yet — see the deferred claims in `packages/domain/test/bakeoff.spec.ts`.
 *
 * ⚠ THAT PATH IS LOAD-BEARING AND WAS CORRECTED IN PLACE (`A48`). This comment
 * used to name ~~`tests/extraction/bakeoff.spec.ts`~~, which is where the suite
 * was first written and where CI proved it must not live: `tests/extraction/**`
 * is collected by the **`golden`** Vitest project, but the coverage gate runs
 * the **`unit`** project only — so the cases executed, went green, and
 * contributed **zero** coverage to the file they test, dropping
 * `packages/domain/src/**` below its threshold. Pure domain logic is tested in
 * `packages/domain/test/**`. Do not "restore" the old path.
 */

/**
 * The corpus is 12 images (§9.1, §9.7 Stage 4). Recorded so a run against a
 * different corpus size is visible in the report rather than silent.
 */
export const BAKEOFF_CORPUS_IMAGES = 12;

/**
 * A metric difference worth fewer than this many titles is NOT evidence.
 *
 * ⚠ §9.7 Stage 4. On a 12-image corpus one title found or missed moves
 * aggregate recall by roughly 1/N of a surface's titles, so a single-title
 * delta is indistinguishable from run-to-run noise. Reporting it as a win is
 * how a model gets adopted on the strength of one lucky tile.
 */
export const MIN_MEANINGFUL_TITLE_DELTA = 2;

/**
 * Float dust guard. Two IEEE-754 doubles that represent the same measurement
 * can differ in the last bits; without this, `0.95` computed two ways can
 * register as "the challenger is worse" and silently fail a row.
 */
const EPSILON = 1e-9;

/**
 * Stage 0 — the contract a candidate must satisfy before a single image is
 * spent (§9.7).
 *
 * ⚠ THESE ARE CONTRACT PROPERTIES, NOT QUALITY PROPERTIES. Missing any one of
 * them changes what the extractor can promise — §2.1a's strict-schema
 * guarantees stop holding — so the candidate is rejected outright with **zero
 * images spent**. A model that cannot do strict Structured Outputs is not a
 * worse reader; it is a different contract, and no quality score could
 * redeem it.
 */
export interface ReaderCapabilities {
  readonly vision: boolean;
  /** `additionalProperties: false` actually honoured, per §2.1a. */
  readonly strictStructuredOutputs: boolean;
  readonly temperatureZero: boolean;
  readonly seed: boolean;
  readonly availableInRegion: boolean;
}

/** The Stage 0 capability keys, in the order §9.7 lists them. */
export const REQUIRED_CAPABILITIES = [
  'vision',
  'strictStructuredOutputs',
  'temperatureZero',
  'seed',
  'availableInRegion',
] as const satisfies readonly (keyof ReaderCapabilities)[];

/** One arm's scores. Every rate is a fraction in [0, 1]. */
export interface ReaderMetrics {
  readonly modelId: string;
  /** REQ-012. Must be exactly 1.0 — no trade, no exception. */
  readonly omissionRecovery: number;
  readonly fabricationRate: number;
  readonly titleRecall: number;
  readonly artworkOnlyRecall: number;
  readonly falseTitleRate: number;
  readonly chromeRejection: number;
  /** Run-to-run Jaccard across the three runs of §9.7 Stage 2. */
  readonly stabilityJaccard: number;
  /** Recorded for the report. ⚠ Never decisive — see `costIsNeverDecisive`. */
  readonly costUsdPerImage: number;
}

export interface BakeoffInput {
  readonly incumbent: ReaderMetrics;
  readonly challenger: ReaderMetrics;
  readonly challengerCapabilities: ReaderCapabilities;
  /**
   * Total expected titles across the corpus. Converts a rate delta into a
   * count of titles, which is the unit Stage 4's noise band is expressed in.
   */
  readonly expectedTitleTotal: number;
  readonly corpusImages: number;
}

/** Which way is better for a given metric. */
type Direction = 'higher-is-better' | 'lower-is-better';

export type RowStatus =
  /** Challenger is below an absolute floor. Fatal, regardless of the incumbent. */
  | 'floor-breach'
  /** Challenger is worse than the incumbent on a comparative row. Fatal. */
  | 'worse-than-incumbent'
  /** Challenger is better, but by less than the noise band. Not evidence. */
  | 'better-within-noise'
  /** Challenger is better by a margin worth at least `MIN_MEANINGFUL_TITLE_DELTA`. */
  | 'better-measurably'
  /** Indistinguishable. */
  | 'tied';

export interface RowVerdict {
  readonly metric: string;
  readonly incumbent: number;
  readonly challenger: number;
  readonly status: RowStatus;
  /** The delta expressed in titles, which is how Stage 4 defines evidence. */
  readonly deltaTitles: number;
  readonly note: string;
}

export type BakeoffOutcome =
  /** Stage 0 rejected it. No images were spent. */
  | 'challenger-disqualified'
  /** Input was unusable. Nothing was decided from it. */
  | 'invalid-input'
  /** A row failed. */
  | 'incumbent-stays'
  /** Every difference fell inside the noise band (§9.7 Stage 4). */
  | 'no-measured-difference'
  | 'challenger-adopted';

export interface BakeoffDecision {
  readonly outcome: BakeoffOutcome;
  /** The model the product should use. Directly consumable. */
  readonly primaryReader: string;
  readonly rows: readonly RowVerdict[];
  /** Stage 0 capabilities the challenger lacked, in `REQUIRED_CAPABILITIES` order. */
  readonly missingCapabilities: readonly string[];
  /** Human-readable reasons, suitable for pasting into the §9.7 report. */
  readonly reasons: readonly string[];
  /**
   * Always `true`.
   *
   * ⚠ A DELIBERATE, ASSERTED CONSTANT, NOT A PLACEHOLDER — and it records a
   * real finding about §9.7. Cost is specified as a tie-breaker only. But the
   * only state in which it could break a tie is a full tie, and Stage 4 says a
   * full tie is "no measured difference", which by Stage 3 means the incumbent
   * stays. So under the rule as written, cost CANNOT change the outcome. It is
   * carried into the report for transparency and is never read by the
   * decision. `T-AI-045d` mutation-proves this with a challenger that is
   * cheaper and worse.
   */
  readonly costIsNeverDecisive: true;
}

interface RowSpec {
  readonly metric: keyof ReaderMetrics & string;
  readonly label: string;
  readonly direction: Direction;
  /** Absolute floor from §9.7 Stage 3, or `null` where the row has none. */
  readonly floor: number | null;
  /** Whether the row must also win or tie against the incumbent. */
  readonly comparedToIncumbent: boolean;
  /**
   * `true` for rows measured in titles, where Stage 4's two-title noise band
   * applies. `chromeRejection` is measured over chrome strings, not titles,
   * and has no incumbent comparison anyway.
   */
  readonly titleDenominated: boolean;
}

/**
 * §9.7 Stage 3, transcribed row for row.
 *
 * ⚠ `chromeRejection` carries a floor but NO incumbent comparison, and that
 * asymmetry is in the spec on purpose (§3.1: over-rejecting chrome is worse
 * than under-rejecting, so a challenger that rejects MORE chrome than the
 * incumbent is not thereby better). Do not "tidy" it into the comparative set.
 *
 * ⚠ `omissionRecovery` is an equality, not a floor: exactly 1.0. REQ-012
 * allows no trade, so it is handled separately below rather than as a `>=`.
 */
const ROWS: readonly RowSpec[] = [
  {
    metric: 'fabricationRate',
    label: 'Fabrication rate',
    direction: 'lower-is-better',
    floor: 0.05,
    comparedToIncumbent: true,
    titleDenominated: true,
  },
  {
    metric: 'titleRecall',
    label: 'Title recall (aggregate)',
    direction: 'higher-is-better',
    floor: 0.95,
    comparedToIncumbent: true,
    titleDenominated: true,
  },
  {
    metric: 'artworkOnlyRecall',
    label: 'Artwork-only recall',
    direction: 'higher-is-better',
    floor: 0.8,
    comparedToIncumbent: true,
    titleDenominated: true,
  },
  {
    metric: 'falseTitleRate',
    label: 'False-title rate',
    direction: 'lower-is-better',
    floor: 0.1,
    comparedToIncumbent: true,
    titleDenominated: true,
  },
  {
    metric: 'chromeRejection',
    label: 'Chrome rejection',
    direction: 'higher-is-better',
    floor: 0.8,
    comparedToIncumbent: false,
    titleDenominated: false,
  },
  {
    metric: 'stabilityJaccard',
    label: 'Run-to-run stability (Jaccard)',
    direction: 'higher-is-better',
    floor: 0.95,
    comparedToIncumbent: true,
    titleDenominated: true,
  },
];

const isRate = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

function invalidMetricFields(m: ReaderMetrics | undefined, arm: string): string[] {
  const bad: string[] = [];
  if (m === undefined || m === null || typeof m !== 'object') return [`${arm}: metrics missing`];
  if (typeof m.modelId !== 'string' || m.modelId.trim() === '') {
    bad.push(`${arm}: modelId is missing`);
  }
  const rateFields = [
    'omissionRecovery',
    'fabricationRate',
    'titleRecall',
    'artworkOnlyRecall',
    'falseTitleRate',
    'chromeRejection',
    'stabilityJaccard',
  ] as const;
  for (const f of rateFields) {
    if (!isRate(m[f])) bad.push(`${arm}: ${f} is not a fraction in [0, 1]`);
  }
  if (typeof m.costUsdPerImage !== 'number' || !Number.isFinite(m.costUsdPerImage)) {
    bad.push(`${arm}: costUsdPerImage is not a finite number`);
  }
  return bad;
}

/** How much better the challenger is on this row, in the row's good direction. */
function advantage(row: RowSpec, incumbent: number, challenger: number): number {
  return row.direction === 'higher-is-better' ? challenger - incumbent : incumbent - challenger;
}

function judgeRow(row: RowSpec, input: BakeoffInput): RowVerdict {
  const inc = input.incumbent[row.metric] as number;
  const chal = input.challenger[row.metric] as number;
  const adv = advantage(row, inc, chal);
  const deltaTitles = row.titleDenominated ? Math.abs(adv) * input.expectedTitleTotal : 0;

  const breachesFloor =
    row.floor !== null &&
    (row.direction === 'higher-is-better'
      ? chal < row.floor - EPSILON
      : chal > row.floor + EPSILON);

  // ⚠ THE FLOOR IS CHECKED FIRST AND THE NOISE BAND DOES NOT APPLY TO IT.
  // A floor is an absolute product requirement, not a comparison, so "only
  // just below it" is still below it. Applying Stage 4's band here would let a
  // challenger under the recall floor be adopted because its shortfall was
  // small — which is precisely the erosion §9.7 exists to prevent.
  if (breachesFloor) {
    return {
      metric: row.label,
      incumbent: inc,
      challenger: chal,
      status: 'floor-breach',
      deltaTitles,
      note: `${row.label} ${chal} breaches the absolute floor of ${row.floor} (§9.7 Stage 3).`,
    };
  }

  if (!row.comparedToIncumbent) {
    return {
      metric: row.label,
      incumbent: inc,
      challenger: chal,
      status: 'tied',
      deltaTitles: 0,
      note: `${row.label} meets its floor. §9.7 sets no incumbent comparison for this row.`,
    };
  }

  // ⚠ ANY deficit fails the row, however small. Stage 3 requires the
  // challenger to "win or tie on every row", and Stage 4's noise band exists
  // to stop a small difference being read as a WIN — not to launder a small
  // regression into a tie. Under uncertainty the incumbent stays; that is the
  // one direction this rule is allowed to be wrong in.
  if (adv < -EPSILON) {
    return {
      metric: row.label,
      incumbent: inc,
      challenger: chal,
      status: 'worse-than-incumbent',
      deltaTitles,
      note: `${row.label} is worse than the incumbent (${chal} vs ${inc}). A mixed result means the incumbent stays.`,
    };
  }

  if (adv <= EPSILON) {
    return {
      metric: row.label,
      incumbent: inc,
      challenger: chal,
      status: 'tied',
      deltaTitles: 0,
      note: `${row.label} is level with the incumbent.`,
    };
  }

  if (row.titleDenominated && deltaTitles < MIN_MEANINGFUL_TITLE_DELTA) {
    return {
      metric: row.label,
      incumbent: inc,
      challenger: chal,
      status: 'better-within-noise',
      deltaTitles,
      note:
        `${row.label} is better by ${deltaTitles.toFixed(2)} titles, which is below the ` +
        `${MIN_MEANINGFUL_TITLE_DELTA}-title band (§9.7 Stage 4). Reported as no measured difference, not a win.`,
    };
  }

  return {
    metric: row.label,
    incumbent: inc,
    challenger: chal,
    status: 'better-measurably',
    deltaTitles,
    note: `${row.label} is better by ${row.titleDenominated ? `${deltaTitles.toFixed(2)} titles` : 'a measurable margin'}.`,
  };
}

function stayWithIncumbent(
  outcome: Exclude<BakeoffOutcome, 'challenger-adopted'>,
  incumbentId: string,
  reasons: string[],
  rows: readonly RowVerdict[] = [],
  missingCapabilities: readonly string[] = [],
): BakeoffDecision {
  return {
    outcome,
    primaryReader: incumbentId,
    rows,
    missingCapabilities,
    reasons,
    costIsNeverDecisive: true,
  };
}

/**
 * Decide which model is the primary reader.
 *
 * Total: returns a decision for every input, including malformed ones, and
 * never throws. Pure: the same input always yields the same decision.
 */
export function chooseReader(input: BakeoffInput): BakeoffDecision {
  // ── Totality guard ────────────────────────────────────────────────────────
  // Reached before anything is compared, so a bad number can never reach a
  // comparison and produce a confident-looking wrong answer.
  const incumbentId =
    typeof input?.incumbent?.modelId === 'string' && input.incumbent.modelId.trim() !== ''
      ? input.incumbent.modelId
      : 'incumbent';

  if (input === undefined || input === null || typeof input !== 'object') {
    return stayWithIncumbent('invalid-input', incumbentId, [
      'No bake-off input was supplied. Nothing was measured, so the incumbent stays.',
    ]);
  }

  const problems = [
    ...invalidMetricFields(input.incumbent, 'incumbent'),
    ...invalidMetricFields(input.challenger, 'challenger'),
  ];
  if (!Number.isFinite(input.expectedTitleTotal) || input.expectedTitleTotal <= 0) {
    problems.push(
      'expectedTitleTotal must be a positive number — without it a rate delta cannot be expressed in titles, ' +
        "and §9.7 Stage 4's noise band is defined in titles.",
    );
  }
  if (problems.length > 0) {
    return stayWithIncumbent('invalid-input', incumbentId, [
      'The bake-off input could not be read, so no comparison was made and the incumbent stays.',
      ...problems,
    ]);
  }

  // ── Stage 0 — disqualifiers, before a single image is spent ───────────────
  const caps = input.challengerCapabilities;
  const missing = REQUIRED_CAPABILITIES.filter((c) => caps?.[c] !== true);
  if (missing.length > 0) {
    return stayWithIncumbent(
      'challenger-disqualified',
      incumbentId,
      [
        `${input.challenger.modelId} is disqualified at Stage 0 with zero images spent: it does not support ${missing.join(', ')}.`,
        'This is a contract mismatch, not a quality result — §2.1a\u2019s strict-schema guarantees stop holding, so no score could redeem it.',
      ],
      [],
      missing,
    );
  }

  // ── Stage 3 — the pre-committed decision table ────────────────────────────
  const reasons: string[] = [];

  // REQ-012: an equality, not a floor. Handled apart from ROWS because "≥ 1.0"
  // and "= 1.0" differ for any value above 1, and a metric above 1.0 is a
  // scorer bug that must not read as an exceptional pass.
  const omissionOk = Math.abs(input.challenger.omissionRecovery - 1) <= EPSILON;
  const omissionRow: RowVerdict = {
    metric: 'Omission recovery',
    incumbent: input.incumbent.omissionRecovery,
    challenger: input.challenger.omissionRecovery,
    status: omissionOk ? 'tied' : 'floor-breach',
    deltaTitles: 0,
    note: omissionOk
      ? 'Omission recovery is exactly 1.0, as REQ-012 requires.'
      : `Omission recovery is ${input.challenger.omissionRecovery}, not exactly 1.0. REQ-012 allows no trade and no exception.`,
  };

  const rows: RowVerdict[] = [omissionRow, ...ROWS.map((r) => judgeRow(r, input))];

  if (input.corpusImages !== BAKEOFF_CORPUS_IMAGES) {
    reasons.push(
      `⚠ The corpus was ${String(input.corpusImages)} images, not the ${BAKEOFF_CORPUS_IMAGES} §9.7 Stage 4 sizes its noise band against.`,
    );
  }

  const failed = rows.filter(
    (r) => r.status === 'floor-breach' || r.status === 'worse-than-incumbent',
  );
  if (failed.length > 0) {
    return stayWithIncumbent(
      'incumbent-stays',
      incumbentId,
      [
        `${input.challenger.modelId} does not win or tie on every row, so the incumbent stays (§9.7 Stage 3).`,
        ...failed.map((r) => r.note),
        ...reasons,
      ],
      rows,
    );
  }

  // ── Stage 4 — is any advantage big enough to be evidence? ─────────────────
  const measurable = rows.filter((r) => r.status === 'better-measurably');
  if (measurable.length === 0) {
    return stayWithIncumbent(
      'no-measured-difference',
      incumbentId,
      [
        `${input.challenger.modelId} failed no row, but no metric differs by ${MIN_MEANINGFUL_TITLE_DELTA} titles or more on a ${String(input.corpusImages)}-image corpus.`,
        'The honest finding is "no measured difference", which by §9.7 Stage 3 means the incumbent stays.',
        ...rows.filter((r) => r.status === 'better-within-noise').map((r) => r.note),
        ...reasons,
      ],
      rows,
    );
  }

  return {
    outcome: 'challenger-adopted',
    primaryReader: input.challenger.modelId,
    rows,
    missingCapabilities: [],
    reasons: [
      `${input.challenger.modelId} wins or ties on every row of §9.7 Stage 3 and is measurably better on: ${measurable.map((r) => r.metric).join(', ')}.`,
      'Adopting it additionally requires an ADR-0001 revision and edits to §9.7, §10\u2019s cost model and .env.example (TASK-168).',
      ...reasons,
    ],
    costIsNeverDecisive: true,
  };
}
