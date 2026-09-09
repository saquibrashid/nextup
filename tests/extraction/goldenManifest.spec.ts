/**
 * `T-AI-046` — the golden fixture manifest agrees with the golden corpus.
 *
 * TASK-078 commits two artefacts that describe the same thing: the image files
 * under `tests/fixtures/golden/images/`, and `manifest.json`, which records
 * per-image ground truth (`specs/ai.md` §9.1). Nothing connected them. A
 * fixture could be added, renamed or deleted and the manifest would keep
 * describing a corpus that no longer exists — which is this repository's
 * dominant defect class (an instruction pointing at a file that is not there,
 * see `T-INFRA-014`), reproduced inside the evidence base that TASK-079's
 * metric gates are scored against.
 *
 * The consequence is not cosmetic. `expectedTitleCount` is the denominator of
 * recall. An orphaned entry silently drops out of the score, and a fixture with
 * no entry is silently never scored at all — in both directions the suite gets
 * *greener*, so there is no failing test to investigate.
 *
 * `c` is the case worth reading. `BAKEOFF_CORPUS_IMAGES` is a merged,
 * mutation-proven constant that the §9.7 bake-off uses to decide whether a
 * measured delta is signal or noise, and until now it was only ever compared
 * against a **literal** in `bakeoff.spec.ts`. Both could be edited together and
 * agree perfectly while neither matched the corpus on disk. `c` binds the
 * constant to the actual file count, so adding a twelfth fixture fails the
 * build rather than quietly widening the noise band.
 *
 * `f` is the GPS case, and it is not hypothetical: TASK-151 shipped real
 * latitude and longitude into this public repository. It asserts the property
 * that matters (no coordinates) rather than "no metadata", because several
 * owner captures legitimately carry benign EXIF — an iOS screenshot records
 * `ImageDescription: "Screenshot"` and a timestamp — and a blanket ban would
 * be red on arrival and promptly loosened.
 *
 * `g` is the positive control. `b` and `e` are set differences: a detector that
 * finds nothing at all satisfies both, perfectly and vacuously. `g` drives the
 * same comparison over synthetic inputs and asserts it fires on a corpus that
 * disagrees AND stays quiet on one that agrees, because "reports everything" is
 * as useless as "reports nothing".
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BAKEOFF_CORPUS_IMAGES } from '@nextup/domain';
import { describe, expect, it } from 'vitest';

import { goldenRecordingStore, sha256OfBytes } from '../../apps/api/src/extraction/recordings.js';
import { hasGpsCoordinates } from '../fixtures/golden/ingest/exifProbe.js';

const GOLDEN_DIR = fileURLToPath(new URL('../fixtures/golden/', import.meta.url));
const IMAGES_DIR = join(GOLDEN_DIR, 'images');

/** Extensions that make a file part of the corpus. `specs/ai.md` §9.1. */
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic']);

interface ManifestEntry {
  id: string;
  file: string;
  service: string;
  surface: string;
  deviceClass: string;
  expectedTitleCount: number;
  expectedArtworkOnly: boolean;
  captureNotes: string;
  provenance: string;
  /** Added by TASK-079's recorder; asserted by `T-AI-047a`. */
  sha256?: string;
}

interface Manifest {
  corpusSize: number;
  images: ManifestEntry[];
}

const manifest = JSON.parse(readFileSync(join(GOLDEN_DIR, 'manifest.json'), 'utf8')) as Manifest;

const imageFiles = readdirSync(IMAGES_DIR)
  .filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()))
  .sort();

/**
 * The pure detector `b`, `e` and `g` all share: which files lack an entry, and
 * which entries name a file that is not on disk. Kept separate from the corpus
 * read so `g` can drive it over inputs it controls.
 */
function reconcile(
  files: readonly string[],
  entries: readonly { file: string }[],
): { unlisted: string[]; missing: string[] } {
  const listed = new Set(entries.map((entry) => entry.file));
  const present = new Set(files);
  return {
    unlisted: files.filter((file) => !listed.has(file)).sort(),
    missing: entries
      .map((entry) => entry.file)
      .filter((file) => !present.has(file))
      .sort(),
  };
}

describe('T-AI-046 — golden fixture manifest integrity', () => {
  it('T-AI-046a — the corpus and the manifest are both non-empty (non-vacuity floor)', () => {
    // Every other case is a comparison between these two collections. If
    // either is empty the comparisons all pass while measuring nothing.
    expect(imageFiles.length).toBeGreaterThanOrEqual(11);
    expect(manifest.images.length).toBeGreaterThanOrEqual(11);
    expect(manifest.corpusSize).toBeGreaterThanOrEqual(11);
  });

  it('T-AI-046b — every image has exactly one entry and every entry has its image', () => {
    const { unlisted, missing } = reconcile(imageFiles, manifest.images);
    expect(unlisted, 'image files with no manifest entry — these are never scored').toEqual([]);
    expect(missing, 'manifest entries whose image is absent — these score against nothing').toEqual(
      [],
    );

    const files = manifest.images.map((entry) => entry.file);
    expect(new Set(files).size, 'two entries claim the same file').toBe(files.length);
  });

  it('T-AI-046c — corpusSize and BAKEOFF_CORPUS_IMAGES both match the real corpus', () => {
    // The bake-off's noise band is expressed per-corpus-size. Comparing the
    // constant against a literal in another test proves only that two hand-
    // written numbers agree; this compares it against the files themselves.
    expect(manifest.corpusSize).toBe(imageFiles.length);
    expect(manifest.images.length).toBe(imageFiles.length);
    expect(BAKEOFF_CORPUS_IMAGES).toBe(imageFiles.length);
  });

  it('T-AI-046d — every entry carries usable ground truth', () => {
    for (const entry of manifest.images) {
      expect(entry.id, `${entry.file}: id must be the basename`).toBe(
        basename(entry.file, extname(entry.file)),
      );
      expect(
        Number.isInteger(entry.expectedTitleCount),
        `${entry.id}: count must be an integer`,
      ).toBe(true);
      expect(
        entry.expectedTitleCount,
        `${entry.id}: count must not be negative`,
      ).toBeGreaterThanOrEqual(0);
      expect(typeof entry.expectedArtworkOnly, `${entry.id}: artwork flag`).toBe('boolean');
      expect(entry.service, `${entry.id}: service`).toMatch(/^(netflix|max)$/);
      expect(entry.deviceClass, `${entry.id}: deviceClass`).toMatch(/^(mobile|desktop)$/);
      // A stub note is worse than none: it looks like a considered decision.
      expect(
        entry.captureNotes.length,
        `${entry.id}: captureNotes must say something`,
      ).toBeGreaterThan(40);
    }
  });

  it('T-AI-046e — provenance is one of the three real shapes and derivation resolves', () => {
    const ids = new Set(manifest.images.map((entry) => entry.id));
    for (const entry of manifest.images) {
      expect(entry.provenance, `${entry.id}: provenance`).toMatch(
        /^(owner-capture|synthetic|derived:[a-z0-9-]+)$/,
      );
      if (entry.provenance.startsWith('derived:')) {
        const source = entry.provenance.slice('derived:'.length);
        expect(ids.has(source), `${entry.id}: derived from unknown ${source}`).toBe(true);
        expect(source, `${entry.id}: cannot be derived from itself`).not.toBe(entry.id);
      }
    }
  });

  it('T-AI-046f — no fixture carries GPS coordinates', () => {
    // TASK-151 shipped real coordinates into this public repo. Asserted as
    // "no GPS" rather than "no metadata" on purpose: benign EXIF (an iOS
    // screenshot's ImageDescription and timestamp) is present and harmless,
    // and a rule that is red on arrival gets loosened rather than obeyed.
    const leaking = imageFiles.filter((file) =>
      hasGpsCoordinates(new Uint8Array(readFileSync(join(IMAGES_DIR, file)))),
    );
    expect(leaking, 'fixtures leaking location data').toEqual([]);
  });

  it('T-AI-046g — the reconciliation detector fires on disagreement and not on agreement', () => {
    // Positive control. `b` and `e` are set differences and pass vacuously on
    // a detector that returns nothing; only driving it over a corpus that is
    // KNOWN to disagree proves it still has teeth.
    const agreeing = reconcile(['a.png', 'b.jpg'], [{ file: 'a.png' }, { file: 'b.jpg' }]);
    expect(agreeing).toEqual({ unlisted: [], missing: [] });

    const orphanFile = reconcile(['a.png', 'b.jpg'], [{ file: 'a.png' }]);
    expect(orphanFile.unlisted).toEqual(['b.jpg']);

    const orphanEntry = reconcile(['a.png'], [{ file: 'a.png' }, { file: 'ghost.png' }]);
    expect(orphanEntry.missing).toEqual(['ghost.png']);
  });

  it('T-AI-046h — the documented strip tool produces output this gate accepts', () => {
    // Binds tool to gate. `tools/scan-exif.mjs --strip` is the remediation this
    // repo documents, and it originally blanked GPS *values* while leaving the
    // entries in place — so a file "stripped" with the documented tool still
    // failed `f`. Two disagreeing definitions of "stripped", discoverable only
    // at the moment someone needed it to work.
    //
    // Driven over a COPY: `heic-with-gps.heic` must KEEP its GPS IFD, because
    // proving the production stripper copes with a real, fully-populated Apple
    // layout is the entire reason that fixture exists.
    const source = fileURLToPath(
      new URL('../fixtures/golden/ingest/heic-with-gps.heic', import.meta.url),
    );
    const scratch = join(mkdtempSync(join(tmpdir(), 'nextup-exif-')), 'copy.heic');
    copyFileSync(source, scratch);

    const before = readFileSync(scratch);
    expect(hasGpsCoordinates(new Uint8Array(before)), 'control: the copy starts dirty').toBe(true);

    execFileSync(process.execPath, [
      fileURLToPath(new URL('../../tools/scan-exif.mjs', import.meta.url)),
      '--strip',
      scratch,
    ]);

    const after = readFileSync(scratch);
    expect(hasGpsCoordinates(new Uint8Array(after)), 'the tool must satisfy T-AI-046f').toBe(false);
    // Length is the property the tool promises; a shorter file would mean it
    // rewrote the container rather than overwriting values in place.
    expect(after.length).toBe(before.length);
  });
});

/**
 * `T-AI-047` — the committed recordings are PAIRED with the images they were
 * taken from, and the pairing is the thing the offline suite depends on.
 *
 * `goldenRecordingStore` keys on the sha256 of the bytes `extract()` is handed.
 * If that key is absent or wrong, the store returns `undefined`, the stub
 * reports the ZERO-YIELD path, and every metric in `specs/ai.md` §9.2 is
 * computed over an empty reader response — recall 0, false-title rate 0,
 * fabrication rate 0. Two of those three look like a *pass*.
 *
 * That is not hypothetical: `GoldenManifest` was declared as
 * `Record<sha256, name>` while the committed manifest is §9.1's
 * `{ corpusSize, images: [...] }`, so the lookup missed for all eleven images
 * and nothing said so. `b` is the case that would have caught it — it asserts
 * a recording comes back, not merely that a file exists somewhere.
 */
describe('T-AI-047 · recordings are paired with their images', () => {
  it('T-AI-047a: every manifest entry carries the sha256 of its own image bytes', () => {
    for (const entry of manifest.images) {
      const bytes = readFileSync(join(IMAGES_DIR, entry.file));
      const actual = createHash('sha256').update(bytes).digest('hex');
      expect(
        entry.sha256,
        `${entry.id}: manifest sha256 must be the hash of ${entry.file}. ` +
          'Re-run `npm run golden:record --  --dry-run` to repopulate it.',
      ).toBe(actual);
    }
  });

  it('T-AI-047b: the store resolves every image to its recorded pair', () => {
    const store = goldenRecordingStore(GOLDEN_DIR);
    for (const entry of manifest.images) {
      const bytes = new Uint8Array(readFileSync(join(IMAGES_DIR, entry.file)));
      const recording = store.get(sha256OfBytes(bytes));
      expect(recording, `${entry.id}: no recording resolved from the image bytes`).toBeDefined();
      // Every image in the corpus carries chrome text, so the OCR leg is
      // non-empty for all eleven — including the blank one.
      expect(recording?.ocr.length, `${entry.id}: OCR recording is empty`).toBeGreaterThan(0);

      // ⚠ THE LLM LEG MUST BE ASSERTED SEPARATELY, AND THIS IS NOT BELT AND
      // BRACES. `ocr/` is deliberately not model-scoped, so an OCR-only
      // assertion passes unchanged when the model directory is wrong — proven:
      // mutating `DEFAULT_RECORDING_MODEL_ID` to a non-existent deployment left
      // all 31 cases green, because `readJson` degrades a missing recording to
      // `[]` on purpose (a forgotten fixture must surface as the low-yield
      // banner, not as a crash). That degradation is right for production and
      // fatal for a metric suite, so the pairing is proven here instead.
      if (entry.expectedTitleCount > 0) {
        expect(
          recording?.llm.length,
          `${entry.id}: no primary-reader tiles — is the llm/<modelId>/ directory right?`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('T-AI-047c: an unrecorded image resolves to nothing rather than to a neighbour', () => {
    // The negative control for `b`. A store that returned the first recording
    // it found, or that ignored the key, would satisfy `b` perfectly.
    const store = goldenRecordingStore(GOLDEN_DIR);
    expect(store.get('0'.repeat(64))).toBeUndefined();
  });
});
