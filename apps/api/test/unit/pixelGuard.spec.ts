/**
 * TASK-145 - the pre-decode pixel guard (`specs/testing.md` §26).
 *
 * `T-IMG-017` unit half (the guard refuses before any decoder is constructed),
 * `T-IMG-022` (`NEXTUP_MAX_DECODE_PIXELS` default and request-time read), and
 * `T-IMG-025` (the header dimension readers).
 *
 * The integration half of `T-IMG-017` - a 413 envelope from
 * `POST /api/batches/:batchId/images` with peak RSS asserted flat - belongs to
 * the upload endpoint (TASK-050) and is not claimed here.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_DECODE_PIXELS,
  MAX_IMAGE_AXIS_PX,
  MIN_IMAGE_AXIS_PX,
  evaluatePixelGuard,
} from '@nextup/domain';

import { maxDecodePixels } from '../../src/config.js';
import { assertDecodable, inspectDecodable } from '../../src/images/decodeGuard.js';
import { readDimensions } from '../../src/images/readDimensions.js';

// ── fixture builders: HEADERS ONLY, never a real raster ─────────────────────

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

function pngHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x89,
    ...ascii('PNG'),
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32(13),
    ...ascii('IHDR'),
    ...u32(width),
    ...u32(height),
    8,
    6,
    0,
    0,
    0,
  ]);
}

function jpegHeader(width: number, height: number, sofMarker = 0xc0): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    // An APP0 segment first, so the walker has to actually skip a segment
    // rather than finding SOF at a fixed offset.
    0xff,
    0xe0,
    ...u16(16),
    ...ascii('JFIF'),
    0x00,
    1,
    1,
    0,
    ...u16(1),
    ...u16(1),
    0,
    0,
    0xff,
    sofMarker,
    ...u16(17),
    8, // precision
    ...u16(height), // ⚠ height precedes width
    ...u16(width),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ]);
}

function box(type: string, payload: readonly number[]): number[] {
  return [...u32(payload.length + 8), ...ascii(type), ...payload];
}

function ispe(width: number, height: number): number[] {
  return box('ispe', [0, 0, 0, 0, ...u32(width), ...u32(height)]);
}

/** A HEIF header carrying one `ispe` per entry, in the order given. */
function heifHeader(sizes: readonly (readonly [number, number])[]): Uint8Array {
  const ipco = box(
    'ipco',
    sizes.flatMap(([w, h]) => ispe(w, h)),
  );
  const iprp = box('iprp', ipco);
  const meta = box('meta', [0, 0, 0, 0, ...iprp]);
  const ftyp = box('ftyp', [...ascii('heic'), 0, 0, 0, 0, ...ascii('mif1')]);
  return Uint8Array.from([...ftyp, ...meta]);
}

// ── T-IMG-025: the header readers ───────────────────────────────────────────

describe('readDimensions', () => {
  it('T-IMG-025a: reads PNG IHDR, and a non-square image is not transposed', () => {
    expect(readDimensions(pngHeader(1179, 2556))).toEqual({ width: 1179, height: 2556 });
  });

  it('T-IMG-025b: reads JPEG SOFn with HEIGHT BEFORE WIDTH, across baseline, extended and progressive', () => {
    // Swapping these is silent for the pixel-budget decision - the product is
    // identical - and only shows up in the axis check and the reported
    // dimensions. The fixture is deliberately non-square so it cannot hide.
    for (const marker of [0xc0, 0xc1, 0xc2]) {
      expect(readDimensions(jpegHeader(4032, 3024, marker))).toEqual({
        width: 4032,
        height: 3024,
      });
    }
  });

  it('T-IMG-025c: skips DHT, JPG and DAC, which sit inside the SOF marker range but are not frames', () => {
    expect(readDimensions(jpegHeader(800, 600, 0xc4))).toBeNull();
    expect(readDimensions(jpegHeader(800, 600, 0xc8))).toBeNull();
    expect(readDimensions(jpegHeader(800, 600, 0xcc))).toBeNull();
  });

  it('T-IMG-025d: takes the LARGEST ispe, never the first - the thumbnail trap', () => {
    // A real iPhone file lists the thumbnail first. A first-match reader
    // reports a few hundred kilopixels and waves the 48 MP master through.
    const dims = readDimensions(
      heifHeader([
        [320, 240],
        [8064, 5952],
        [160, 120],
      ]),
    );
    expect(dims).toEqual({ width: 8064, height: 5952 });
  });

  it('T-IMG-025e: a single-ispe HEIF still reads, so d is not passing by accident', () => {
    expect(readDimensions(heifHeader([[4032, 3024]]))).toEqual({ width: 4032, height: 3024 });
  });

  it('T-IMG-025f: unparseable, truncated, empty and unrecognised headers return null and never throw', () => {
    const cases: Uint8Array[] = [
      new Uint8Array(0),
      Uint8Array.from(ascii('%PDF-1.7')),
      pngHeader(100, 100).subarray(0, 14),
      jpegHeader(100, 100).subarray(0, 6),
      heifHeader([[100, 100]]).subarray(0, 20),
      Uint8Array.from([
        0x89,
        ...ascii('PNG'),
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        ...u32(13),
        ...ascii('XHDR'),
      ]),
    ];
    for (const bytes of cases) {
      expect(() => readDimensions(bytes)).not.toThrow();
      expect(readDimensions(bytes)).toBeNull();
    }
  });

  it('T-IMG-025g: a zero-size or under-length ISO-BMFF box terminates instead of looping', () => {
    // A malformed box whose declared size is smaller than its own header would
    // advance the cursor backwards. The failure mode is a hang, not a wrong
    // answer, so this asserts termination rather than a value.
    const malformed = Uint8Array.from([
      ...u32(0),
      ...ascii('ftyp'),
      ...ascii('heic'),
      ...u32(4),
      ...ascii('meta'),
    ]);
    expect(() => readDimensions(malformed)).not.toThrow();
  });
});

// ── T-IMG-017 (unit half): the decision table ───────────────────────────────

describe('evaluatePixelGuard', () => {
  it('T-IMG-017a: a 48 MP header is refused with IMAGE_TOO_LARGE_TO_DECODE at 25 MP', () => {
    const verdict = evaluatePixelGuard({ width: 8064, height: 5952 }, DEFAULT_MAX_DECODE_PIXELS);
    expect(verdict).toMatchObject({ ok: false, code: 'IMAGE_TOO_LARGE_TO_DECODE' });
  });

  it('T-IMG-017b: the SAME header is ACCEPTED at 50000000 - the guard is the value, not a constant', () => {
    // Without this, a guard hard-coded to reject 8064x5952 would pass T-IMG-017a.
    expect(evaluatePixelGuard({ width: 8064, height: 5952 }, 50_000_000)).toMatchObject({
      ok: true,
      megapixels: 47_996_928,
    });
  });

  it('T-IMG-017c: a 24 MP image passes at the default', () => {
    expect(
      evaluatePixelGuard({ width: 6000, height: 4000 }, DEFAULT_MAX_DECODE_PIXELS),
    ).toMatchObject({ ok: true });
  });

  it('T-IMG-017d: an unparseable header is REJECTED, never decoded to find out', () => {
    expect(evaluatePixelGuard(null, DEFAULT_MAX_DECODE_PIXELS)).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED_IMAGE_FORMAT',
    });
  });

  it('T-IMG-017e: both axis bounds are enforced at both ends, inclusively where the spec says so', () => {
    const max = DEFAULT_MAX_DECODE_PIXELS;
    expect(evaluatePixelGuard({ width: MIN_IMAGE_AXIS_PX - 1, height: 100 }, max)).toMatchObject({
      code: 'IMAGE_DIMENSIONS_UNSUPPORTED',
    });
    expect(evaluatePixelGuard({ width: 100, height: MIN_IMAGE_AXIS_PX - 1 }, max)).toMatchObject({
      code: 'IMAGE_DIMENSIONS_UNSUPPORTED',
    });
    expect(evaluatePixelGuard({ width: MAX_IMAGE_AXIS_PX + 1, height: 100 }, max)).toMatchObject({
      code: 'IMAGE_DIMENSIONS_UNSUPPORTED',
    });
    expect(evaluatePixelGuard({ width: 100, height: MAX_IMAGE_AXIS_PX + 1 }, max)).toMatchObject({
      code: 'IMAGE_DIMENSIONS_UNSUPPORTED',
    });
    expect(
      evaluatePixelGuard({ width: MIN_IMAGE_AXIS_PX, height: MIN_IMAGE_AXIS_PX }, max),
    ).toMatchObject({ ok: true });
  });

  it('T-IMG-017f: axis bounds are reported BEFORE the pixel budget when both are violated', () => {
    // 16001 x 16001 is both out of axis bounds and far over 25 MP. Reporting
    // the budget would tell the owner to up-size the container, which cannot
    // help - Read 4.0 would refuse the image at any container size.
    expect(
      evaluatePixelGuard({ width: 16_001, height: 16_001 }, DEFAULT_MAX_DECODE_PIXELS),
    ).toMatchObject({ code: 'IMAGE_DIMENSIONS_UNSUPPORTED' });
  });

  it('T-IMG-017g: the boundary is strictly greater-than, so exactly the budget is accepted', () => {
    expect(evaluatePixelGuard({ width: 5000, height: 5000 }, 25_000_000)).toMatchObject({
      ok: true,
    });
    expect(evaluatePixelGuard({ width: 5000, height: 5001 }, 25_000_000)).toMatchObject({
      code: 'IMAGE_TOO_LARGE_TO_DECODE',
    });
  });
});

describe('assertDecodable', () => {
  it('T-IMG-017h: NO DECODER IS IMPORTED - the guard reaches its verdict on the header alone', () => {
    // The structural assertion behind the whole task, and the exact trap
    // specs/api.md §5.0.3 names: delegating the HEIC branch to heic-convert
    // "just to get the size" constructs precisely the decoder the guard exists
    // to avoid constructing. It would look like a simplification, every
    // behavioural test here would still pass, and the guard would be defeated.
    //
    // A vi.mock of heic-convert would NOT catch this - a module nothing
    // imports can be mocked and "not called" forever. Reading the source is
    // the assertion that discriminates.
    const guardSources = [
      readFileSync(new URL('../../src/images/decodeGuard.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../../src/images/readDimensions.ts', import.meta.url), 'utf8'),
    ];
    const decoders = ['heic-convert', 'heic-decode', 'libheif-js', 'sharp'];
    for (const source of guardSources) {
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      for (const decoder of decoders) {
        expect(imports).not.toContain(decoder);
      }
    }
    // Non-vacuity: the regex must actually be finding imports, or this passes
    // against an empty list no matter what the modules do.
    const guardImports = [...(guardSources[0] as string).matchAll(/from\s+'([^']+)'/g)];
    expect(guardImports.length).toBeGreaterThan(0);
  });

  it('T-IMG-017i: the thrown AppError carries the spec status per reason', () => {
    const cases: readonly [Uint8Array, number, string][] = [
      [heifHeader([[8064, 5952]]), 413, 'IMAGE_TOO_LARGE_TO_DECODE'],
      [pngHeader(20, 20), 400, 'IMAGE_DIMENSIONS_UNSUPPORTED'],
      [Uint8Array.from(ascii('%PDF-1.7')), 415, 'UNSUPPORTED_IMAGE_FORMAT'],
    ];
    for (const [header, status, code] of cases) {
      try {
        assertDecodable(header);
        expect.unreachable(`${code} should have thrown`);
      } catch (error) {
        expect(error).toMatchObject({ code, httpStatus: status });
      }
    }
  });

  it('T-IMG-017j: the memory refusal names MEMORY and the runbook; the corrupt-file one names NEITHER', () => {
    // A43-M3. Telling the owner to up-size the container because their file is
    // truncated is advice that cannot work, and it is how a real diagnosis
    // gets lost.
    let memoryMessage = '';
    try {
      assertDecodable(heifHeader([[8064, 5952]]));
    } catch (error) {
      memoryMessage = (error as Error).message;
    }
    expect(memoryMessage).toMatch(/memory/i);
    expect(memoryMessage).toContain('scale-up-memory.md');

    let corruptMessage = '';
    try {
      assertDecodable(Uint8Array.from(ascii('%PDF-1.7')));
    } catch (error) {
      corruptMessage = (error as Error).message;
    }
    expect(corruptMessage).not.toMatch(/memory/i);
    expect(corruptMessage).not.toContain('scale-up-memory.md');
  });

  it('T-IMG-017k: a passing header returns its declared dimensions', () => {
    expect(assertDecodable(pngHeader(1179, 2556))).toEqual({
      width: 1179,
      height: 2556,
      megapixels: 1179 * 2556,
    });
  });

  it('T-IMG-017l: inspectDecodable reports the same verdict WITHOUT throwing', () => {
    // The shape a per-file loop needs: one image's refusal must never fail the
    // batch (REQ-080/081).
    const verdict = inspectDecodable(heifHeader([[8064, 5952]]));
    expect(verdict).toMatchObject({ ok: false, code: 'IMAGE_TOO_LARGE_TO_DECODE' });
  });
});

// ── T-IMG-022: the configuration value ──────────────────────────────────────

describe('maxDecodePixels', () => {
  it('T-IMG-022a: defaults to 25000000 when NEXTUP_MAX_DECODE_PIXELS is unset', () => {
    expect(maxDecodePixels({})).toBe(25_000_000);
    expect(DEFAULT_MAX_DECODE_PIXELS).toBe(25_000_000);
  });

  it('T-IMG-022b: is READ AT REQUEST TIME, not captured at import', () => {
    // The discriminating case. A module-level `const` evaluated at import
    // would pin the value to whatever the environment held when the module was
    // first loaded, and every other assertion here would still pass.
    const env: NodeJS.ProcessEnv = {};
    expect(maxDecodePixels(env)).toBe(25_000_000);
    env['NEXTUP_MAX_DECODE_PIXELS'] = '50000000';
    expect(maxDecodePixels(env)).toBe(50_000_000);
    env['NEXTUP_MAX_DECODE_PIXELS'] = '5000000';
    expect(maxDecodePixels(env)).toBe(5_000_000);
  });

  it('T-IMG-022c: the guard honours the configured value end to end', () => {
    const header = heifHeader([[8064, 5952]]);
    expect(inspectDecodable(header, { NEXTUP_MAX_DECODE_PIXELS: '50000000' })).toMatchObject({
      ok: true,
    });
    expect(inspectDecodable(header, { NEXTUP_MAX_DECODE_PIXELS: '25000000' })).toMatchObject({
      ok: false,
      code: 'IMAGE_TOO_LARGE_TO_DECODE',
    });
  });

  it('T-IMG-022d: a malformed value falls back to the default rather than disabling the guard', () => {
    // A mistyped env var must not silently remove the crash protection, and it
    // must not take the process down at startup either.
    for (const raw of ['', '   ', 'lots', '0', '-1', '2.5', 'NaN', 'Infinity']) {
      expect(maxDecodePixels({ NEXTUP_MAX_DECODE_PIXELS: raw })).toBe(25_000_000);
    }
  });
});
