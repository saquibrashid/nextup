/**
 * The `golden/ingest/` fixture loader (TASK-151).
 *
 * WHY A LOADER AND NOT `readFileSync` AT EACH CALL SITE. One fixture in this
 * set — `heic-with-gps.heic` — CANNOT BE GENERATED and is not yet supplied.
 * The honest handling of that is neither a fabricated file nor a skipped test:
 *
 *   - A fabricated HEIC proves only that our writer and our reader agree. It
 *     cannot prove the EXIF stripper survives what an actual iPhone produces,
 *     which is the entire point of REQ-078. `T-DEP-002` forbids a HEIC
 *     ENCODER anywhere in the dependency tree, so nothing here can even try.
 *   - A `skip` is indistinguishable from a pass in a green run, and this is a
 *     privacy control.
 *
 * So the loader THROWS a named, explicit error naming the missing file and
 * what it must contain, and the tests that need it fail LOUDLY. A red test
 * that says exactly what is missing is the correct state of the world.
 *
 * ⚠ `declaredContentType` IS RECORDED HERE AND IS NEVER AN INPUT TO A
 * DECISION. It is carried so a test can HAND A LIE to the pipeline and assert
 * the pipeline ignored it (`T-PASTE-006`, `T-IMG-024`): iOS Safari sends
 * `application/octet-stream` for a `.heic`, and a pasted `Blob.type` is
 * supplied by whatever application performed the copy. Any test that lets this
 * field decide anything is testing the wrong thing.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INGEST_FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Repo-relative, for error messages that a human has to act on. */
const REPO_RELATIVE = 'tests/fixtures/golden/ingest';

export interface IngestFixture {
  /** The file on disk, inside `tests/fixtures/golden/ingest/`. */
  readonly file: string;
  /**
   * What a CLIENT would claim this is. Deliberately wrong for several
   * fixtures; never consulted by the code under test.
   */
  readonly declaredContentType: string;
  /** What the magic-byte sniff must return, or `null` for "unsupported". */
  readonly sniffsAs: 'png' | 'jpeg' | 'heic' | 'heif' | null;
  readonly description: string;
  /**
   * Set when the fixture cannot be produced by this repository and must be
   * supplied by the owner. Loading it throws `MissingIngestFixtureError`.
   */
  readonly ownerSupplied?: {
    readonly requirement: string;
  };
}

/**
 * Raised when an owner-supplied fixture is absent.
 *
 * Named, and exported, so a test can assert it is THIS failure rather than an
 * incidental `ENOENT` from a renamed file — the two mean very different things
 * and only one of them is waiting on a person.
 */
export class MissingIngestFixtureError extends Error {
  public readonly fixture: string;

  public constructor(fixture: string, message: string) {
    super(message);
    this.name = 'MissingIngestFixtureError';
    this.fixture = fixture;
  }
}

/**
 * ⚠ THE THREE HEIC STUBS ARE CONTAINER-ACCURATE HEADERS, NOT PHOTOGRAPHS.
 * They carry a real `ftyp` and a real `meta/iprp/ipco/ispe` tree, so the
 * sniff, the header dimension read and the pre-decode pixel guard are all
 * exercised for real. They carry no decodable HEVC item, because this
 * repository cannot encode one. That is a stated limit, not an oversight —
 * `README.md` in this directory records what it costs.
 */
export const INGEST_FIXTURES = {
  /** iPhone screenshot shape. The laptop/web capture path's output. */
  controlPng: {
    file: 'control-screenshot.png',
    declaredContentType: 'image/png',
    sniffsAs: 'png',
    description: 'A valid 1179x2556 8-bit RGB PNG carrying no metadata chunks.',
  },
  /** PNG carrying every ancillary chunk the strip is required to remove. */
  pngWithMetadata: {
    file: 'control-screenshot-with-metadata.png',
    declaredContentType: 'image/png',
    sniffsAs: 'png',
    description:
      'A 640x480 PNG carrying eXIf (a real TIFF block with a GPS IFD), tEXt, zTXt, iTXt and tIME.',
  },
  /**
   * The pasted-bytes input. Bytes are all a paste delivers — there is no
   * filename and the `Blob.type` is whatever the copying application said.
   */
  clipboardBlob: {
    file: 'clipboard-blob.png',
    declaredContentType: 'image/png',
    sniffsAs: 'png',
    description: 'A 1170x2532 PNG standing in for the bytes a clipboard paste delivers.',
  },
  controlJpeg: {
    file: 'control-photo.jpeg',
    declaredContentType: 'image/jpeg',
    sniffsAs: 'jpeg',
    description: 'A structurally complete 2048x1536 JPEG with no EXIF, XMP, IPTC or comment.',
  },
  jpegWithGps: {
    file: 'control-photo-with-gps.jpeg',
    declaredContentType: 'image/jpeg',
    sniffsAs: 'jpeg',
    description:
      'The same JPEG carrying APP1 (EXIF with a GPS IFD), APP13 (IPTC) and COM — plus an APP2 ICC profile that must SURVIVE.',
  },
  /** A well-formed HEIC header at an ordinary screenshot size. */
  heicHeader: {
    file: 'heic-header.heic',
    declaredContentType: 'image/heic',
    sniffsAs: 'heic',
    description:
      'ISO-BMFF ftyp(heic, [mif1 heic]) + meta/iprp/ipco with a 320x240 thumbnail ispe and a 1179x2556 master ispe.',
  },
  /**
   * ⚠ THE SAME BYTES AS `heicHeader`, WITH A LYING DECLARED TYPE. iOS Safari
   * routinely sends `application/octet-stream` for a `.heic`, so this is not
   * a hypothetical: trusting the declared type rejects the owner's own phone
   * images on first use (ASM-058).
   */
  heicAsOctetStream: {
    file: 'heic-header.heic',
    declaredContentType: 'application/octet-stream',
    sniffsAs: 'heic',
    description:
      'The heic-header.heic bytes, declared as application/octet-stream the way iOS Safari sends them.',
  },
  /** Truncated mid-`mdat`: a real header, no readable image item. */
  heicTruncated: {
    file: 'heic-truncated.heic',
    declaredContentType: 'image/heic',
    sniffsAs: 'heic',
    description:
      'The first 200 bytes of heic-header.heic — header intact, image data cut off. Sniffs and measures; cannot decode.',
  },
  /** 48.0 MP declared in the header. Refused before a decoder is constructed. */
  heicOversize: {
    file: 'heic-oversize.heic',
    declaredContentType: 'image/heic',
    sniffsAs: 'heic',
    description:
      'A HEIC header declaring 8000x6000 (48.0 MP) behind a 320x240 thumbnail ispe — over the 25 MP decode budget.',
  },
  /**
   * ⚠ A PDF WHOSE DECLARED TYPE CLAIMS `image/png`. A `Blob.type` is supplied
   * by the copying application and is never validated by the page.
   */
  lyingBlob: {
    file: 'lying-blob.pdf',
    declaredContentType: 'image/png',
    sniffsAs: null,
    description: 'A minimal but genuine PDF whose declared Blob.type claims image/png.',
  },
  /**
   * ⚠ BLOCKED — OWNER-SUPPLIED, NOT YET DELIVERED. This single file backs both
   * blocked legs of TASK-151: the real HEIC with EXIF/GPS, and that same file
   * driven through the FILE-UPLOAD path for `T-SEC-033`.
   */
  heicWithGps: {
    file: 'heic-with-gps.heic',
    declaredContentType: 'application/octet-stream',
    sniffsAs: 'heic',
    description:
      'A real iPhone HEIC photograph still carrying its original EXIF, including a GPS IFD and the device model.',
    ownerSupplied: {
      requirement:
        "a REAL HEIC photograph taken on the owner's phone, delivered UNEDITED — not re-exported, not opened in a photo editor, not stripped — still carrying its original EXIF including a GPS IFD (GPSLatitude/GPSLongitude) and the device model",
    },
  },
} as const satisfies Record<string, IngestFixture>;

export type IngestFixtureName = keyof typeof INGEST_FIXTURES;

/**
 * The message a blocked fixture fails with.
 *
 * ⚠ IT NAMES THE FILE, WHAT THE FILE MUST CONTAIN, AND WHY NOTHING ELSE WILL
 * DO. A failure that only says "fixture missing" invites the two wrong fixes
 * this project has already ruled out — fabricate it, or skip the test — so the
 * message rules both out explicitly, at the point of failure, where whoever
 * hits it is actually reading.
 */
export function missingFixtureMessage(fixture: IngestFixture): string {
  return [
    `MISSING FIXTURE ${REPO_RELATIVE}/${fixture.file} — REQ-078 cannot be asserted without it.`,
    '',
    `REQUIRED: ${fixture.ownerSupplied?.requirement ?? 'an owner-supplied file'}.`,
    '',
    'WHY NOTHING IN THIS REPOSITORY CAN SUBSTITUTE FOR IT:',
    '  1. A synthetic HEIC is not evidence. T-DEP-002 forbids a HEIC ENCODER anywhere',
    '     in the dependency tree, so nothing here can produce HEIC bytes; a hand-built',
    '     container would prove only that our writer and our reader agree, not that the',
    '     stripper survives what an actual iPhone writes.',
    '  2. A JPEG or PNG carrying GPS is not a substitute. HEIC is the format that carries',
    '     location in through the iOS camera-roll FILE-UPLOAD path; screenshots do not.',
    '  3. The paste path cannot exercise it. WebKit strips EXIF on navigator.clipboard.read()',
    '     but NOT on file upload, so a pasted fixture would pass VACUOUSLY whatever our',
    '     code does. This fixture must be driven through the UPLOAD path.',
    '',
    'THIS TEST IS RED ON PURPOSE. Do not skip it and do not fabricate the file: a skipped',
    'test is indistinguishable from a passing one in a green run, and this is a privacy',
    'control (REQ-078, specs/security.md §4.2).',
    '',
    `TO FIX: commit the file at ${REPO_RELATIVE}/${fixture.file}. Nothing else changes.`,
  ].join('\n');
}

export function fixturePath(name: IngestFixtureName): string {
  return path.join(INGEST_FIXTURE_DIR, INGEST_FIXTURES[name].file);
}

/**
 * Read a fixture's bytes.
 *
 * Throws `MissingIngestFixtureError` — never returns a placeholder, never
 * returns an empty buffer. A loader that degraded quietly would turn the
 * blocked assertions into vacuous passes, which is the failure this whole
 * arrangement exists to avoid.
 */
export function loadIngestFixture(name: IngestFixtureName): Uint8Array {
  const fixture: IngestFixture = INGEST_FIXTURES[name];
  const full = fixturePath(name);
  if (!existsSync(full)) {
    throw new MissingIngestFixtureError(fixture.file, missingFixtureMessage(fixture));
  }
  return new Uint8Array(readFileSync(full));
}

/** `true` when a fixture is present on disk. For reporting, never for skipping. */
export function isFixturePresent(name: IngestFixtureName): boolean {
  return existsSync(fixturePath(name));
}
