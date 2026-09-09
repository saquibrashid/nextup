/**
 * The golden corpus scorer, shared by T1 (`golden.spec.ts`) and the §9.7
 * bake-off (`bakeoffMeasured.spec.ts`).
 *
 * ⚠ IT IS ONE MODULE ON PURPOSE, AND THAT IS THE WHOLE POINT OF §9.7 STAGE 1.
 * A bake-off compares two readers; if each arm were scored by its own copy of
 * this logic, any divergence between the copies would be reported as a
 * difference between the MODELS. The arms must differ only by which
 * `llm/<modelId>/` directory is replayed — so the scoring code, the answer
 * key, the OCR leg, the cleanup clock and the collapse pass are all held
 * literally identical by being the same code executed twice.
 *
 * ⚠ THE ZERO-YIELD TRAP APPLIES TO EVERY CALLER. `readJson` in
 * `recordings.ts` degrades a missing recording to `[]` deliberately — right
 * for production, fatal here, because recall 0 comes with false-title 0,
 * fabrication 0 and a vacuous chrome ratio. Callers must assert non-vacuity
 * before believing any number this module returns.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  cleanup,
  collapseFragments,
  collapseOverlap,
  crossCheck,
  type CleanedCandidate,
  type ExtractionCandidate,
  type ImageMimeType,
  type MediaType,
  type TmdbSearchResult,
} from '@nextup/domain';

import { goldenRecordingStore } from '../../apps/api/src/extraction/recordings.js';
import { StubExtractor } from '../../apps/api/src/extraction/stubExtractor.js';

export const GOLDEN = path.resolve(__dirname, '../fixtures/golden');
export const IMAGES = path.join(GOLDEN, 'images');
export const EXPECTED = path.join(GOLDEN, 'expected');
export const TMDB = path.join(GOLDEN, 'tmdb');

/**
 * ⚠ 
ow` IS PINNED. `cleanup()` judges an extracted year plausible against
 * the current date, so an unpinned clock makes every verdict a function of the
 * day the suite runs — a fixture whose year sits at the future allowance
 * boundary would flip from `title-candidate` to `low-confidence` on its own,
 * months after anyone touched the code.
 */
export const NOW = new Date('2026-09-09T00:00:00.000Z');

/** §9.2 counts a title as found under any of these three verdicts. */
export const RECALL_VERDICTS = new Set([
  'title-candidate',
  'low-confidence',
  'inferred-unverified',
]);

const MIME: Record<string, ImageMimeType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.heic': 'image/heic',
};

export interface ManifestImage {
  readonly id: string;
  readonly file: string;
  readonly sha256: string;
  readonly expectedTitleCount: number;
  readonly expectedArtworkOnly?: boolean;
}

export interface ExpectedCandidate {
  readonly title: string;
  readonly normalisedText: string;
  readonly expectedWorkIdentity: string | null;
}

export interface ExpectedDoc {
  readonly imageId: string;
  readonly expectedCandidates: readonly ExpectedCandidate[];
  readonly expectedChrome: readonly string[];
}

export interface Scored {
  readonly image: ManifestImage;
  readonly expected: ExpectedDoc;
  readonly candidates: readonly ExtractionCandidate[];
  readonly recall: number;
  readonly found: number;
  readonly falseTitles: number;
  readonly fabricated: number;
  readonly chromeRejected: number;
}

export const manifest = JSON.parse(readFileSync(path.join(GOLDEN, 'manifest.json'), 'utf8')) as {
  readonly corpusSize: number;
  readonly images: readonly ManifestImage[];
};

const tmdbFiles = new Set(readdirSync(TMDB));
const slug = (normalised: string): string => `${normalised.replace(/ /g, '-')}.json`;

export function hasTmdbFixture(normalised: string): boolean {
  return tmdbFiles.has(slug(normalised));
}

interface RecordedTmdb {
  readonly results: readonly {
    readonly id: number;
    readonly mediaType: MediaType;
    readonly title: string;
    readonly releaseDate: string | null;
  }[];
}

export function tmdbResultsFor(normalised: string): TmdbSearchResult[] {
  if (!hasTmdbFixture(normalised)) return [];
  const doc = JSON.parse(readFileSync(path.join(TMDB, slug(normalised)), 'utf8')) as RecordedTmdb;
  return doc.results.map((r) => ({
    tmdbId: r.id,
    mediaType: r.mediaType,
    name: r.title,
    releaseYear: r.releaseDate === null ? null : Number(r.releaseDate.slice(0, 4)),
    posterPath: null,
  }));
}

export function expectedFor(imageId: string): ExpectedDoc {
  return JSON.parse(
    readFileSync(path.join(EXPECTED, `${imageId}.expected.json`), 'utf8'),
  ) as ExpectedDoc;
}

/**
 * Promote stage-2 output into the stored shape stage 4 operates on.
 *
 * ⚠ THIS SCORER MUST RUN §7.4's COLLAPSE, AND THE PRODUCTION RUNNER DOES NOT
 * RUN IT YET (`startExtraction.ts` stops after `cleanup()`; stages 3–5 are
 * TASK-060). Measuring raw stage-2 output would score the SAME work twice on
 * every Netflix mobile capture, because stage 1c's consumption is
 * GEOMETRY-scoped: on that layout the caption sits beside the artwork, so the
 * OCR line never overlaps the tile box, is never consumed, and is correctly
 * re-emitted as an orphan. Both readings are right; they are one title.
 */
function asCandidate(cleaned: CleanedCandidate, imageId: string, seq: number): ExtractionCandidate {
  return {
    id: `cand:golden:${imageId}:${String(seq)}`,
    type: 'extractionCandidate',
    ownerId: 'o_golden',
    batchId: 'golden',
    sourceImageIds: [imageId],
    rawText: cleaned.item.rawText,
    inferredTitle: cleaned.item.inferredTitle,
    basis: cleaned.item.basis,
    ocrSupport: cleaned.item.ocrSupport,
    provider: cleaned.item.provider,
    normalisedText: cleaned.normalisedText,
    extractedYear: cleaned.extractedYear,
    boundingBoxes: [cleaned.item.boundingBox],
    boxSource: cleaned.item.boxSource,
    ocrConfidence: cleaned.item.confidence,
    cleanupVerdict: cleaned.cleanupVerdict,
    resolvedWorkIdentity: null,
    matchCandidates: [],
    classification: null,
    reviewDisposition: 'pending',
    correctedToTmdbId: null,
    collapsedIntoCandidateId: null,
    createdAt: NOW.toISOString(),
  };
}

/**
 * Replay one arm of the corpus.
 *
 * `modelId` selects the `llm/<modelId>/` directory and NOTHING else — the OCR
 * leg is not model-scoped, by §9.7 Stage 1, because it is the constant the
 * comparison is measured against.
 */
export async function scoreAll(modelId: string): Promise<Scored[]> {
  const store = goldenRecordingStore(GOLDEN, modelId);
  const extractor = new StubExtractor({ recordings: store, crossCheck });
  const out: Scored[] = [];

  for (const image of manifest.images) {
    const expected = expectedFor(image.id);
    const bytes = readFileSync(path.join(IMAGES, image.file));
    const mime = MIME[path.extname(image.file).toLowerCase()];
    if (mime === undefined) throw new Error(`${image.file} has an unmapped extension`);

    const result = await extractor.extract(bytes, mime);
    const cleaned = cleanup(result.items, { now: NOW });

    // Stage 4, the REAL one. Losers are retained by design (REQ-012), so the
    // survivors are the works — `collapsedIntoCandidateId === null`.
    const collapsed = collapseOverlap(
      cleaned.map((c, i) => asCandidate(c, image.id, i)),
      { pass: 'pre-match', imageOrder: [image.id] },
    );
    // Stage 4's second half — the fragment collapse (§7.4a). Measured here for
    // the same reason pass A is: the scorer must run the pipeline the product
    // runs, or the metrics describe a product that does not exist.
    const fragments = collapseFragments(collapsed.candidates, {
      pass: 'pre-match',
      imageOrder: [image.id],
    });
    const candidates = fragments.candidates.filter((c) => c.collapsedIntoCandidateId === null);

    const expectedTexts = new Set(expected.expectedCandidates.map((c) => c.normalisedText));
    const chromeTexts = new Set(expected.expectedChrome);

    const foundTexts = new Set(
      candidates.filter((c) => RECALL_VERDICTS.has(c.cleanupVerdict)).map((c) => c.normalisedText),
    );
    const found = [...expectedTexts].filter((t) => foundTexts.has(t)).length;

    // ⚠ Recall over an EMPTY expected set is 1.0, not 0. `blank-no-content-01`
    // has no titles at all; scoring 0/0 as a failure would make the one image
    // that exists to test fabrication fail permanently on recall instead.
    const recall = expectedTexts.size === 0 ? 1 : found / expectedTexts.size;

    // ⚠ Chrome is EXCLUDED from the false-title count, deliberately: chrome
    // that leaked through as a title is measured by the chrome rejection
    // metric, and counting it twice would let one defect blow two unrelated
    // gates and obscure which one actually moved.
    const falseTitles = candidates.filter(
      (c) =>
        c.cleanupVerdict === 'title-candidate' &&
        !expectedTexts.has(c.normalisedText) &&
        !chromeTexts.has(c.normalisedText),
    ).length;

    // §9.2 fabrication: `ocrSupport === 'none'` AND neither an expected title
    // nor a TMDB match. An artwork read is uncorroborated BY DESIGN, so
    // "uncorroborated" alone is not fabrication — §9.4.
    const fabricated = candidates.filter(
      (c) =>
        c.ocrSupport === 'none' &&
        !expectedTexts.has(c.normalisedText) &&
        !hasTmdbFixture(c.normalisedText),
    ).length;

    const chromeRejected = [...chromeTexts].filter((t) =>
      candidates.some((c) => c.normalisedText === t && c.cleanupVerdict === 'chrome-suspected'),
    ).length;

    out.push({
      image,
      expected,
      candidates,
      recall,
      found,
      falseTitles,
      fabricated,
      chromeRejected,
    });
  }

  return out;
}

export interface Aggregate {
  readonly recall: number;
  readonly falseTitleRate: number;
  readonly fabricationRate: number;
  readonly chromeRejectionRate: number;
  readonly candidateCount: number;
}

export function aggregate(scored: readonly Scored[]): Aggregate {
  const expectedTotal = scored.reduce((n, s) => n + s.expected.expectedCandidates.length, 0);
  const foundTotal = scored.reduce((n, s) => n + s.found, 0);
  const titleCandidates = scored.reduce(
    (n, s) => n + s.candidates.filter((c) => c.cleanupVerdict === 'title-candidate').length,
    0,
  );
  const candidateCount = scored.reduce((n, s) => n + s.candidates.length, 0);
  const chromeTotal = scored.reduce((n, s) => n + s.expected.expectedChrome.length, 0);

  return {
    recall: foundTotal / expectedTotal,
    falseTitleRate: scored.reduce((n, s) => n + s.falseTitles, 0) / titleCandidates,
    fabricationRate: scored.reduce((n, s) => n + s.fabricated, 0) / candidateCount,
    chromeRejectionRate: scored.reduce((n, s) => n + s.chromeRejected, 0) / chromeTotal,
    candidateCount,
  };
}
