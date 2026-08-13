/**
 * `T-API-003` — the error-code enumeration is CLOSED (`specs/api.md` §8).
 *
 * ⚠ This test was MISSING. `packages/domain/src/errorCodes.ts` states in its
 * own header that "`T-API-003` asserts that every code thrown anywhere in
 * `apps/api/src` is one of these", and `docs/backlog.md` named it as a
 * done-when test — but the id was defined nowhere in `specs/testing.md` and
 * implemented nowhere. The invariant the comment claimed was guarded was in
 * fact unguarded: a route could invent a code and nothing would notice until
 * it reached the owner as an untranslated failure with no remedy.
 *
 * The check is a source scan rather than a runtime one on purpose. A runtime
 * assertion only sees codes on paths a test happens to exercise, so the
 * invented code in the rarely-hit branch — precisely the one that escapes
 * review — is the one it would miss.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ERROR_CODES, isErrorCode } from '@nextup/domain';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const API_SRC = path.resolve(here, '..', '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** Every `new AppError('CODE'` literal in the API source, with its file. */
function thrownCodes(): { code: string; file: string }[] {
  const out: { code: string; file: string }[] = [];
  for (const file of sourceFiles(API_SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/new AppError\(\s*'([^']+)'/g)) {
      out.push({ code: match[1] ?? '', file: path.relative(API_SRC, file) });
    }
  }
  return out;
}

describe('T-API-003 the error-code enumeration is closed', () => {
  it('T-API-003a: every code thrown in apps/api/src is a member', () => {
    const offenders = thrownCodes().filter(({ code }) => !isErrorCode(code));
    expect(offenders).toEqual([]);
  });

  it('T-API-003b: the scan actually finds the codes that are thrown', () => {
    // The negative control. Without it a scan that silently matched nothing —
    // a changed constructor name, a moved directory — would pass forever
    // while asserting nothing at all.
    const codes = thrownCodes().map(({ code }) => code);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes).toContain('VALIDATION_FAILED');
    expect(codes).toContain('UNAUTHENTICATED');
    // A MULTI-LINE `new AppError(` call, pinned deliberately: the throw in
    // `routes/batches.ts` puts the code on its own line, and a regex without
    // newline-tolerant whitespace would skip exactly those longer calls —
    // the ones with enough arguments to be worth reviewing.
    expect(codes).toContain('OPEN_BATCH_EXISTS');
  });

  it('T-API-003c: a non-member code would be caught', () => {
    // Proves the filter in T-API-003a discriminates, rather than passing
    // because `isErrorCode` returns true for everything.
    expect(isErrorCode('TOTALLY_MADE_UP')).toBe(false);
    expect(isErrorCode('VALIDATION_FAILED')).toBe(true);
  });

  it('T-API-003d: the enumeration has no duplicate members', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});
