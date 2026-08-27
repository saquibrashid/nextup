/**
 * `specs/ai.md` §8.1 — the low-yield detector (`T-AI-021`, TASK-084).
 *
 * ⚠ WHY THIS FILE EXISTS AT ALL. `T-AI-021` a–m already asserted, thoroughly,
 * what the app DOES when `lowYield` is true. Nothing asserted — and nothing in
 * the source did — how it ever BECOMES true. The flag was written into the
 * schema, persisted, read at review and never raised, so every one of those
 * tests passed against a condition production could not reach. These cases
 * cover the missing half: the decision itself.
 */

import { describe, expect, it } from 'vitest';

import { ZERO_YIELD_IMAGE_RATIO, isLowYield } from '../src/extraction/lowYield.js';

describe('T-AI-021 — deciding that a batch is low yield (specs/ai.md §8.1)', () => {
  it('T-AI-021n · a healthy read is not low yield', () => {
    expect(
      isLowYield({ candidatesAfterCleanup: 30, imagesProcessed: 4, imagesWithZeroCandidates: 0 }),
    ).toBe(false);
  });

  it('T-AI-021o · zero candidates after cleanup is low yield whatever the image count', () => {
    // The blank-screenshot case. Four images read cleanly, nothing on any of
    // them — the ratio arm also fires here, which is why the next case
    // separates them.
    expect(
      isLowYield({ candidatesAfterCleanup: 0, imagesProcessed: 4, imagesWithZeroCandidates: 4 }),
    ).toBe(true);
  });

  it('T-AI-021p · zero candidates fires even when EVERY image yielded something', () => {
    // ⚠ Discriminates the two arms. `imagesWithZeroCandidates: 0` makes the
    // ratio arm answer false, so only the candidate arm can carry this. An
    // implementation that kept just the ratio would pass every other case here
    // and silently let a zero-candidate full-update propose removing the
    // entire list.
    expect(
      isLowYield({ candidatesAfterCleanup: 0, imagesProcessed: 4, imagesWithZeroCandidates: 0 }),
    ).toBe(true);
  });

  it('T-AI-021q · exactly half the images yielding nothing IS low yield', () => {
    // ⚠ The boundary, and it is `>=` not `>`. Two of four blank is already the
    // condition specs/ai.md §8.1 names; an off-by-one here withholds nothing
    // on precisely the batch the threshold was chosen for.
    expect(
      isLowYield({ candidatesAfterCleanup: 12, imagesProcessed: 4, imagesWithZeroCandidates: 2 }),
    ).toBe(true);
  });

  it('T-AI-021r · one blank image in four is not low yield', () => {
    // The other side of the same boundary, so the case above cannot be
    // satisfied by a function that returns true for any blank image at all.
    expect(
      isLowYield({ candidatesAfterCleanup: 12, imagesProcessed: 4, imagesWithZeroCandidates: 1 }),
    ).toBe(false);
  });

  it('T-AI-021s · no images processed is low yield, not NaN', () => {
    // ⚠ THE TRAP. `0 / 0` is `NaN` and `NaN >= 0.5` is `false`, so a literal
    // transcription of §8.1 declares a batch that read nothing at all to be
    // healthy — and in full-update that batch proposes removing everything.
    expect(
      isLowYield({ candidatesAfterCleanup: 0, imagesProcessed: 0, imagesWithZeroCandidates: 0 }),
    ).toBe(true);
    // And the same with a candidate count that somehow survived, so the guard
    // cannot be satisfied by the zero-candidate arm standing in for it.
    expect(
      isLowYield({ candidatesAfterCleanup: 5, imagesProcessed: 0, imagesWithZeroCandidates: 0 }),
    ).toBe(true);
  });

  it('T-AI-021t · every image blank is low yield', () => {
    expect(
      isLowYield({ candidatesAfterCleanup: 0, imagesProcessed: 3, imagesWithZeroCandidates: 3 }),
    ).toBe(true);
  });

  it('T-AI-021u · the threshold is the spec constant, and it is a half', () => {
    expect(ZERO_YIELD_IMAGE_RATIO).toBe(0.5);
  });
});
