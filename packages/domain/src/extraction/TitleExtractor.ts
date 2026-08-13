/**
 * The stage-1 extraction contract — `specs/ai.md` §2.3, ADR-0001 Revision 2.
 *
 * TASK-055. This is the widest contract in the product: stages 2–5, the batch
 * runner, the review pass and every golden fixture are written against these
 * shapes. Treat a change here as a change to sixty other tasks.
 *
 * WHAT IS DELIBERATELY ABSENT, AND MUST STAY ABSENT
 * ------------------------------------------------
 * `extract()` takes bytes and a MIME type. It is never told the service
 * (RULE B / REQ-058 — the reader must not know whether it is looking at
 * Netflix or Max, so it cannot be influenced by, or leak, that fact), the
 * batch mode, the owner, the batch id, the image id, or the ingest source
 * (A45 — a pasted PNG and an uploaded, transcoded PNG are byte-equivalent
 * inputs and extraction quality must not depend on how the file arrived).
 * None of these parameters may be added.
 *
 * THE INPUT CONTRACT — WHAT THE CALLER GUARANTEES
 * ----------------------------------------------
 * By the time bytes reach an extractor they have already passed the ingest
 * stage (`specs/api.md` §5.0/§5.1):
 *
 *   - the format is PNG or JPEG. HEIC/HEIF is transcoded to lossless PNG on
 *     ingest, because NEITHER reader accepts it. Do not widen `ImageMimeType`.
 *   - EXIF/XMP metadata, including GPS, has been stripped (REQ-078).
 *   - the header-declared `width * height` is within
 *     `NEXTUP_MAX_DECODE_PIXELS` and both axes are within 50…16,000 px.
 *     ⚠ An extractor must NOT add a second size check. A second,
 *     separately-configured limit is precisely how the two drift apart
 *     (REQ-079).
 */

import type {
  BoxSource,
  CandidateBasis,
  CandidateProvider,
  CrossCheckOutcome,
  OcrSupport,
} from '../enums.js';

/**
 * The only MIME types an extractor ever receives.
 *
 * ⚠ Do NOT widen this to include `image/heic` or `image/heif`. Azure OpenAI
 * vision accepts PNG/JPEG/WEBP/non-animated GIF and Azure AI Vision Read
 * accepts JPEG/PNG/GIF/BMP/WEBP/ICO/TIFF/MPO — neither accepts HEIC, which is
 * why the ingest transcode (ADR-0008) exists upstream of this boundary.
 */
export type ImageMimeType = 'image/png' | 'image/jpeg';

/** Runtime companion to {@link ImageMimeType}, for validation at the boundary. */
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

/**
 * A device-independent box, `0..1`, origin top-left.
 *
 * Distinct from `BoundingBox` in `types.ts`: that one is the *stored* form and
 * carries the `imageId` that ties it to a row. At this layer the extractor does
 * not know the image's id — see the absent-parameters note above.
 */
export interface NormalisedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One tile as reported by the primary reader (`specs/ai.md` §2.1a
 * `TILE_SCHEMA`). This is the recorded wire shape, not a stored one.
 */
export interface LlmTile {
  /** Verbatim glyphs printed on/under the tile, or `null` if none were legible. */
  visibleText: string | null;
  /**
   * The work the reader believes the tile is, or `null`.
   *
   * ⚠ `null` is a first-class, expected, CORRECT answer — the prompt's "do not
   * guess" instruction is the most important line in it. Never coerce this to
   * `visibleText` to "fill in" a value; an invented title is worse than none.
   */
  identifiedTitle: string | null;
  basis: CandidateBasis;
  /** 0..1. */
  confidence: number;
  box: NormalisedBox;
}

/** One line as reported by the cross-check reader (`specs/ai.md` §2.1b). */
export interface OcrLine {
  text: string;
  box: NormalisedBox;
  /** 0..1, or `null` when the provider reported none. */
  confidence: number | null;
}

/**
 * One item of stage-1 output. Consumed by stage 2 (`cleanup.ts`) and, through
 * it, by everything downstream.
 */
export interface ExtractedTextItem {
  /** Verbatim visible text. `''` when the tile had no legible text. */
  rawText: string;
  /**
   * The reader's identification of the work. `null` from OCR, and `null` when
   * the model declined to guess (`basis: 'unknown'`). NEVER a guess.
   */
  inferredTitle: string | null;
  /** How the reader arrived at it. */
  basis: CandidateBasis;
  /**
   * Set by `crossCheck()`, NOT by any provider. `'not-checked'` when the OCR
   * leg was unavailable — which is safety state, not a statistic.
   */
  ocrSupport: OcrSupport;
  /** Which reader produced this item. `'ocr-only'` is a model orphan (§2.1c step 2). */
  provider: CandidateProvider;
  boundingBox: NormalisedBox;
  /** Where the geometry came from. OCR wins wherever it corroborated (§2.1c step 3). */
  boxSource: BoxSource;
  /** Provider confidence 0..1, or `null`. */
  confidence: number | null;
}

/**
 * Free-form provider diagnostics.
 *
 * ⚠ FOR LOGGING ONLY. Nothing downstream may branch on a key in here — that is
 * how a provider-specific quirk silently becomes product behaviour that no
 * other provider can satisfy. It must never carry image content, a prompt, or
 * anything derived from the owner's screenshots (NFR-009/NFR-015).
 */
export type ProviderMeta = Record<string, string | number | boolean | null>;

export interface ExtractionResult {
  items: ExtractedTextItem[];
  /**
   * Whether the two readers could corroborate each other (`specs/ai.md` §2.2).
   *
   * ⚠ Anything other than `'ok'` forces `computeRemovals: false` on the batch.
   * A batch that could not be cross-checked must never conclude that a title
   * was removed — product invariant 2.
   */
  crossCheck: CrossCheckOutcome;
  providerMeta: ProviderMeta;
}

/** The extractor implementations `NEXTUP_EXTRACTOR` may select. */
export const EXTRACTOR_NAMES = ['hybrid', 'llm-vision', 'azure-vision-read', 'stub'] as const;
export type ExtractorName = (typeof EXTRACTOR_NAMES)[number];

export function isExtractorName(value: unknown): value is ExtractorName {
  return typeof value === 'string' && (EXTRACTOR_NAMES as readonly string[]).includes(value);
}

/**
 * Stage 1. Bytes in, `ExtractionResult` out.
 *
 * Stages 2–5 consume only `ExtractionResult` and MUST NOT change when the
 * extractor changes (`T-AI-016`). That property is what makes reverting to
 * ADR-0001 Revision 1 a single configuration value.
 *
 * ⚠ `imageBytes` is `Uint8Array`, not `Buffer`, and this is a DELIBERATE
 * deviation from the type shown in `specs/ai.md` §2.3. That spec places this
 * interface in `apps/api`, where `Buffer` exists; `docs/backlog.md` TASK-055
 * (the work order) places it in `packages/domain`, which is pure TypeScript
 * shared with the browser app (ADR-0004) and therefore has no Node types.
 * `Buffer extends Uint8Array`, so every API-side caller passes a `Buffer`
 * unchanged and nothing at the call sites differs.
 */
export interface TitleExtractor {
  readonly name: ExtractorName;
  extract(imageBytes: Uint8Array, mimeType: ImageMimeType): Promise<ExtractionResult>;
}

/**
 * The shape of a stage-1 failure.
 *
 * A thrown `ExtractorError` fails ONE IMAGE. Whether that becomes a failed
 * batch is the batch runner's decision (`specs/ai.md` §2.2, TASK-058), not the
 * extractor's — the extractor has no idea what else is in the batch.
 *
 * It is deliberately NOT an `AppError`: `AppError` belongs to the HTTP layer
 * and carries a status code, and stage 1 runs inside a job with no response to
 * shape. `ExtractionErrorCode` (the batch-level enum in `enums.ts`) is likewise
 * assigned by the runner when it decides the batch's fate.
 */
export type ExtractorFailureKind =
  /** The provider could not be reached, or refused after retries (429/5xx). */
  | 'unavailable'
  /** The provider answered, but not with something we can use. */
  | 'invalid-response'
  /**
   * `finish_reason: 'length'` — a truncated tile list.
   *
   * ⚠ This is an ERROR, never a complete result. A short list of tiles reads,
   * in full-update mode, as a wave of removals. `T-AI-040`.
   */
  | 'truncated'
  /** A content-filter refusal. Never a silent empty result. */
  | 'refused'
  /** The per-image timeout elapsed. */
  | 'timeout';

export class ExtractorError extends Error {
  readonly kind: ExtractorFailureKind;
  /** The reader that failed, for diagnostics. */
  readonly extractor: ExtractorName;
  /** HTTP status when the failure came from a provider response. */
  readonly httpStatus: number | null;

  constructor(
    kind: ExtractorFailureKind,
    extractor: ExtractorName,
    message: string,
    httpStatus: number | null = null,
  ) {
    super(message);
    this.name = 'ExtractorError';
    this.kind = kind;
    this.extractor = extractor;
    this.httpStatus = httpStatus;
  }
}

export function isExtractorError(value: unknown): value is ExtractorError {
  return value instanceof ExtractorError;
}

/**
 * The deterministic cross-check merge (`specs/ai.md` §2.1c), as a type.
 *
 * Declared here rather than where it is implemented so the stub, the hybrid
 * extractor and the golden suite all depend on the SIGNATURE and not on each
 * other. The implementation is TASK-056c (`crossCheck.ts`); it is a pure
 * function with no I/O and no inference, and `T-AI-034` asserts that.
 */
export type CrossCheckFn = (llm: LlmTile[], ocr: OcrLine[]) => ExtractedTextItem[];
