/**
 * Recorded provider responses for the `StubExtractor` (`specs/testing.md`
 * §3.1). TASK-055.
 *
 * The entire test suite runs offline, with no Azure subscription and no cost.
 * That is not a convenience: an agent that cannot run the suite locally has no
 * feedback signal at all. So the stub replays committed recordings of what the
 * two readers said, keyed on the **sha256 of the image bytes** — the only
 * identifier `extract()` is given (it receives bytes and a MIME type and
 * nothing else, by design).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LlmTile, OcrLine } from '@nextup/domain';

/** What both readers said about one image. */
export interface Recording {
  llm: LlmTile[];
  ocr: OcrLine[];
}

export interface RecordingStore {
  /** @returns the recording for these bytes, or `undefined` if none is committed. */
  get(sha256: string): Recording | undefined;
}

export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** An in-memory store — what unit tests construct. */
export function inMemoryRecordingStore(
  entries: ReadonlyMap<string, Recording> | Record<string, Recording>,
): RecordingStore {
  const map =
    entries instanceof Map ? entries : new Map<string, Recording>(Object.entries(entries));
  return { get: (sha256) => map.get(sha256) };
}

/**
 * The manifest that ties an image's sha256 to its fixture pair. Committed by
 * the fixture lane (TASK-032 / TASK-078 / TASK-079) at
 * `tests/fixtures/golden/manifest.json`.
 *
 * A manifest, rather than hashing the image files at load time, because the
 * hash must be recorded ALONGSIDE the recording it belongs to: if the image is
 * ever re-exported and its bytes change, the pairing must break loudly rather
 * than silently continuing to replay a recording of a different picture.
 */
export type GoldenManifest = Record<string, string>;

/**
 * A store backed by the committed golden fixtures.
 *
 * ⚠ Every read failure — absent directory, absent manifest, absent or
 * unparseable fixture — degrades to "no recording", which the stub reports as
 * the ZERO-YIELD path. That is deliberate: a forgotten fixture surfaces as the
 * low-yield banner the product already has to handle (`specs/ai.md` §8) rather
 * than as a crash inside a job, which is much harder to attribute.
 */
export function goldenRecordingStore(goldenDir: string): RecordingStore {
  const manifest = readJson<GoldenManifest>(join(goldenDir, 'manifest.json')) ?? {};
  const cache = new Map<string, Recording | undefined>();

  return {
    get(sha256) {
      if (cache.has(sha256)) return cache.get(sha256);

      const name = manifest[sha256];
      const recording =
        name === undefined
          ? undefined
          : {
              llm: readJson<LlmTile[]>(join(goldenDir, 'llm', `${name}.llm.json`)) ?? [],
              ocr: readJson<OcrLine[]>(join(goldenDir, 'ocr', `${name}.ocr.json`)) ?? [],
            };

      cache.set(sha256, recording);
      return recording;
    },
  };
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}
