/**
 * `T-AI-038` — the prompt/recording synchronisation gate.
 *
 * ⚠ THIS GATE WAS CITED FOR MONTHS AND NEVER EXISTED. `specs/ai.md` §2.1a
 * introduces the prompt with "(prompt change requires a golden re-run —
 * `T-AI-038`)", and `apps/api/src/extraction/prompts.ts` repeats the promise in
 * its header. The id was defined nowhere. `check:test-ids` did not catch it
 * because that gate validates ids cited in `docs/backlog.md`, and this one is
 * cited only in a spec and a source comment.
 *
 * ⚠ WHAT THE ABSENCE COSTS, AND WHY IT IS INVISIBLE. Every offline gate in
 * `tests/extraction/` replays COMMITTED RECORDINGS of the model's output. Those
 * recordings were produced by one specific prompt. Edit the prompt and not one
 * of them fails — they cannot, because no live call is made — so the entire
 * quality suite goes on measuring a prompt THAT IS NO LONGER THE ONE THAT
 * SHIPS, while reporting green. The measurements silently stop describing the
 * product. That is strictly worse than having no measurements, because the
 * numbers still look authoritative.
 *
 * ⚠ THIS GATE DELIBERATELY CANNOT BE SATISFIED BY EDITING THE PROMPT ALONE.
 * That is its entire purpose. If you changed the prompt and landed here:
 * re-record with `npm run golden:record` (LIVE, COSTS REAL MONEY, MANUAL — see
 * §9.5) and update the pin below IN THE SAME COMMIT as the prompt change. Do
 * NOT update the pin on its own to get to green; that converts a loud, correct
 * failure back into the silent desync this file exists to end.
 *
 * ⚠ THE SCHEMA IS PINNED TOO, NOT JUST THE PROSE. `TILE_SCHEMA` is sent as a
 * `strict: true` Structured Output, so it constrains the model's answer every
 * bit as much as the instructions do — adding a field or relaxing a `required`
 * changes what comes back. A gate that watched only the prose would miss it.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_USER_PROMPT,
  TILE_SCHEMA,
} from '../../apps/api/src/extraction/prompts.js';

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * The fingerprint of the prompt the committed recordings in
 * `tests/fixtures/golden/llm/` were produced by.
 *
 * ⚠ CHANGING THIS NUMBER IS A CLAIM THAT THE RECORDINGS WERE RE-MADE. Make
 * that claim only when they were.
 */
const RECORDED_PROMPT_SHA = '400c1579b737d5f2668b80e01ce1aee84739b4833493d4efe865f90b1a4995d4';

describe('T-AI-038 the shipped prompt is the prompt the recordings were made with', () => {
  it('T-AI-038a: the prompt and schema fingerprint matches the recordings', () => {
    const fingerprint = sha256(
      [EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_PROMPT, JSON.stringify(TILE_SCHEMA)].join(
        '\u0000',
      ),
    );

    expect(fingerprint).toBe(RECORDED_PROMPT_SHA);
  });

  it('T-AI-038b: the load-bearing instructions are still IN the prompt the pin covers', () => {
    // ⚠ THE PIN ALONE CANNOT TELL A GOOD PROMPT FROM AN EMPTY ONE. A hash
    // matches whatever it was computed from, so deleting the rules and
    // re-pinning reaches green — and 038a, on its own, would applaud it. These
    // four lines are the ones whose removal would not announce itself in any
    // other gate: `T-AI-030`'s fabrication rate is scored against RECORDINGS,
    // so it would keep reporting the old prompt's number indefinitely.
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('Do NOT guess');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('NEVER omit a tile');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('Do NOT name, identify, infer or mention the app');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('copied EXACTLY');
  });

  it('T-AI-038c: the pin is over the SCHEMA too, not just the prose', () => {
    // The schema ships as a `strict: true` Structured Output, so it constrains
    // the answer as hard as the instructions do. Asserted by construction: a
    // fingerprint that ignored the schema would equal the prose-only hash.
    const proseOnly = sha256([EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_PROMPT].join('\u0000'));

    expect(proseOnly).not.toBe(RECORDED_PROMPT_SHA);
  });
});
