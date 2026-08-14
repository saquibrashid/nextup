/**
 * TASK-158 — `T-PASTE-005` unit half (`specs/testing.md` §11 names this file).
 *
 * `specs/data-model.md` §3.8.1 is normative. The three properties this file
 * exists to make undeniable, because each fails silently otherwise:
 *
 *  1. The stamp is SERVER UTC. A local-time accessor passes every test run in
 *     a UTC container and produces a different name in a UK summer.
 *  2. Uniqueness comes from `<NN>`, so two images pasted in the SAME SECOND
 *     get different names. A timestamp-only scheme passes any test that uses
 *     two different instants.
 *  3. `paste` ignores the client-supplied name ENTIRELY. Honouring it looks
 *     harmless — every real browser sends `image.png` — and silently
 *     reintroduces the collision the rule exists to prevent.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MAX_FILE_NAME_LENGTH,
  resolveFileName,
  synthesiseFileName,
  synthesisePastedFileName,
} from '../src/pastedFileName.js';
import { INGEST_SOURCES, UPLOAD_FORMATS } from '../src/enums.js';
import { uploadedImageSchema } from '../src/schemas.js';

// 2026-08-11T15:42:33.512Z — deliberately NOT midnight and NOT on a second
// boundary, so a truncation or rounding bug cannot hide.
const AT = new Date(Date.UTC(2026, 7, 11, 15, 42, 33, 512));

const PASTED_NAME = /^pasted-\d{8}-\d{6}-\d{2}\.(png|jpg|heic|heif)$/;

describe('T-PASTE-005 synthesised pasted file name', () => {
  it('T-PASTE-005a produces exactly pasted-YYYYMMDD-HHMMSS-NN.ext', () => {
    expect(synthesisePastedFileName(3, 'png', AT)).toBe('pasted-20260811-154233-03.png');
    expect(synthesisePastedFileName(3, 'png', AT)).toMatch(PASTED_NAME);
  });

  it('T-PASTE-005b pads the ordinal to two digits across the 1..40 range', () => {
    expect(synthesisePastedFileName(1, 'png', AT)).toContain('-01.');
    expect(synthesisePastedFileName(9, 'png', AT)).toContain('-09.');
    expect(synthesisePastedFileName(10, 'png', AT)).toContain('-10.');
    expect(synthesisePastedFileName(40, 'png', AT)).toContain('-40.');
  });

  it('T-PASTE-005c gives two images pasted in the SAME SECOND different names', () => {
    // The discriminating case for the whole scheme: identical instant, so the
    // timestamp cannot be doing the work. A design that dropped `<NN>` would
    // pass every other case in this file and fail only here.
    const first = synthesisePastedFileName(1, 'png', AT);
    const second = synthesisePastedFileName(2, 'png', new Date(AT.getTime()));
    expect(first).not.toBe(second);
    expect(first).toBe('pasted-20260811-154233-01.png');
    expect(second).toBe('pasted-20260811-154233-02.png');
  });

  it('T-PASTE-005d derives the extension from the SNIFFED format, jpeg to .jpg', () => {
    expect(synthesisePastedFileName(1, 'png', AT).endsWith('.png')).toBe(true);
    expect(synthesisePastedFileName(1, 'jpeg', AT).endsWith('.jpg')).toBe(true);
    expect(synthesisePastedFileName(1, 'heic', AT).endsWith('.heic')).toBe(true);
    expect(synthesisePastedFileName(1, 'heif', AT).endsWith('.heif')).toBe(true);
    // `.jpeg` would be the natural "tidy" spelling and is wrong.
    expect(synthesisePastedFileName(1, 'jpeg', AT).endsWith('.jpeg')).toBe(false);
  });

  it('T-PASTE-005e covers every UPLOAD_FORMAT, so a new format cannot be forgotten', () => {
    for (const format of UPLOAD_FORMATS) {
      expect(synthesisePastedFileName(1, format, AT)).toMatch(PASTED_NAME);
    }
    expect(UPLOAD_FORMATS.length).toBe(4);
  });

  it('T-PASTE-005f stamps SERVER UTC, never host local time', () => {
    // 23:30 UTC on the 31st. In any timezone east of UTC the local date is the
    // 1st of the next month; west of UTC the local hour is not 23. A `getHours`
    // implementation therefore produces a different string in almost every
    // timezone, while passing in a UTC CI container.
    const late = new Date(Date.UTC(2026, 11, 31, 23, 30, 5, 0));
    expect(synthesisePastedFileName(7, 'png', late)).toBe('pasted-20261231-233005-07.png');
  });

  it('T-PASTE-005s uses ONLY getUTC* accessors, independently of the host timezone', () => {
    // `T-PASTE-005f` catches a local-time accessor only on a host that is not
    // UTC. CI containers ARE UTC, where `getHours() === getUTCHours()` and
    // that case passes vacuously — so the property it guards would be
    // asserted on my laptop and nowhere that matters. This form holds
    // everywhere because it reads the source rather than the clock.
    const source = readFileSync(
      fileURLToPath(new URL('../src/pastedFileName.ts', import.meta.url)),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const localAccessors = code.match(
      /\.get(?!UTC)(FullYear|Month|Date|Hours|Minutes|Seconds|Day)\b/g,
    );
    expect(localAccessors).toBeNull();
    // Non-vacuity: the UTC forms must actually be there, or an implementation
    // that read no date at all would pass the assertion above.
    expect(code.match(/\.getUTC(FullYear|Month|Date|Hours|Minutes|Seconds)\b/g)?.length ?? 0).toBe(
      6,
    );
  });

  it('T-PASTE-005g zero-pads month, day, hour, minute and second', () => {
    const early = new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 0));
    expect(synthesisePastedFileName(1, 'png', early)).toBe('pasted-20260102-030405-01.png');
  });

  it('T-PASTE-005h rejects a non-positive or non-integer ordinal rather than emitting a bad name', () => {
    expect(() => synthesisePastedFileName(0, 'png', AT)).toThrow(RangeError);
    expect(() => synthesisePastedFileName(-1, 'png', AT)).toThrow(RangeError);
    expect(() => synthesisePastedFileName(1.5, 'png', AT)).toThrow(RangeError);
    expect(() => synthesisePastedFileName(1, 'png', new Date(Number.NaN))).toThrow(RangeError);
  });

  it('T-PASTE-005i uses the per-source prefix for drop and upload', () => {
    expect(synthesiseFileName(2, 'png', AT, 'drop')).toBe('dropped-20260811-154233-02.png');
    expect(synthesiseFileName(2, 'png', AT, 'upload')).toBe('uploaded-20260811-154233-02.png');
    expect(synthesiseFileName(2, 'png', AT, 'paste')).toBe('pasted-20260811-154233-02.png');
  });

  it('T-PASTE-005j covers every INGEST_SOURCE with a distinct prefix', () => {
    const names = INGEST_SOURCES.map((source) => synthesiseFileName(1, 'png', AT, source));
    expect(new Set(names).size).toBe(INGEST_SOURCES.length);
    expect(INGEST_SOURCES.length).toBe(3);
  });

  it('T-PASTE-005k is pure: the same inputs give the same name, and no wall clock leaks in', () => {
    const once = synthesisePastedFileName(5, 'heic', AT);
    // Force the wall clock past a millisecond boundary. A `Date.now()` inside
    // the function would change the output here and nowhere else.
    const spin = Date.now();
    while (Date.now() === spin) {
      /* deliberately empty */
    }
    expect(synthesisePastedFileName(5, 'heic', AT)).toBe(once);
  });
});

describe('T-PASTE-005 resolveFileName', () => {
  it('T-PASTE-005l IGNORES the client name entirely for a paste', () => {
    // Every real browser sends this, and honouring it collides three pastes.
    expect(resolveFileName('image.png', 1, 'png', AT, 'paste')).toBe(
      'pasted-20260811-154233-01.png',
    );
    expect(resolveFileName('holiday.png', 2, 'png', AT, 'paste')).toBe(
      'pasted-20260811-154233-02.png',
    );
  });

  it('T-PASTE-005m keeps the device name for upload and drop', () => {
    expect(resolveFileName('IMG_4021.HEIC', 1, 'heic', AT, 'upload')).toBe('IMG_4021.HEIC');
    expect(resolveFileName('Screenshot 2026-08-11.png', 1, 'png', AT, 'drop')).toBe(
      'Screenshot 2026-08-11.png',
    );
  });

  it('T-PASTE-005n falls back to the synthesiser when the device name is empty or blank', () => {
    expect(resolveFileName('', 4, 'png', AT, 'upload')).toBe('uploaded-20260811-154233-04.png');
    expect(resolveFileName('   \t ', 4, 'png', AT, 'drop')).toBe('dropped-20260811-154233-04.png');
    expect(resolveFileName(undefined, 4, 'png', AT, 'upload')).toBe(
      'uploaded-20260811-154233-04.png',
    );
  });

  it('T-PASTE-005o never returns an empty name for any source or any input', () => {
    for (const source of INGEST_SOURCES) {
      for (const candidate of ['', '   ', undefined, 'real.png']) {
        const name = resolveFileName(candidate, 1, 'png', AT, source);
        expect(name.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('T-PASTE-005p keeps every produced name inside the NVARCHAR(255) column', () => {
    // A 400-character device name is accepted by the browser and would fail
    // the insert, rejecting a real file for a reason the owner cannot act on.
    const long = `${'a'.repeat(400)}.png`;
    const resolved = resolveFileName(long, 1, 'png', AT, 'upload');
    expect(resolved.length).toBe(MAX_FILE_NAME_LENGTH);
    expect(resolved.endsWith('.png')).toBe(true);
    // And the schema that guards the column agrees.
    expect(uploadedImageSchema.shape.fileName.safeParse(resolved).success).toBe(true);
  });

  it('T-PASTE-005q produces names the persisted schema accepts, for every source and format', () => {
    for (const source of INGEST_SOURCES) {
      for (const format of UPLOAD_FORMATS) {
        const name = synthesiseFileName(1, format, AT, source);
        expect(uploadedImageSchema.shape.fileName.safeParse(name).success).toBe(true);
      }
    }
  });

  it('T-PASTE-005r composes no blobPath — the name and the storage path are separate concerns', () => {
    // Structural, not behavioural: this module must not know what a blobPath
    // is. A traversal name cannot reach a path from a function that never
    // mentions one. `T-SEC-*` asserts the path composition itself.
    const traversal = '../../etc/passwd.png';
    expect(resolveFileName(traversal, 1, 'png', AT, 'paste')).toBe('pasted-20260811-154233-01.png');
    // For upload the name IS kept — that is the rule — which is exactly why
    // `blobPath` must be composed from ULIDs elsewhere and never from this.
    expect(resolveFileName(traversal, 1, 'png', AT, 'upload')).toBe(traversal);
  });
});
