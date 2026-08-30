/**
 * `T-AI-041` — the persisted `bounding_boxes` column, parsed defensively
 * (`specs/ui.md` §5.3a, TASK-059b).
 *
 * ⚠ WHY A UNIT FILE WHEN `T-AI-041y` ALREADY COVERS THIS THROUGH THE ROUTE.
 * The integration case proves the ONE outcome that matters end to end — a
 * malformed column yields no crop and a 200, never a 500. It cannot
 * economically enumerate the shapes, because each case costs a database
 * round trip, and `npm run coverage` runs `--project unit --project web`
 * only, so a branch reached exclusively from the integration project reads as
 * uncovered and eats the `apps/api/src/**` floor. Both are real reasons; this
 * file is the cheap enumeration and `T-AI-041y` is the wiring proof.
 *
 * ⚠ EVERY FIELD IS CHECKED, NOT CAST, AND THAT IS THE POINT OF THE FILE. The
 * column is `NVarChar(Max)` written from provider output. A box with a string
 * `x` flows into an inline CSS percentage and positions the crop somewhere
 * arbitrary — which renders as a *confident thumbnail of the wrong part of
 * the screenshot*, i.e. fabricated evidence in the one place §5.3a exists to
 * prevent fabrication. Dropping the box shows the whole image instead, which
 * is merely unhelpful, and honest.
 */

import { describe, expect, it } from 'vitest';

import { parseBoundingBoxes } from '../../src/routes/batchReview.js';

const box = { imageId: 'img_1', x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

describe('T-AI-041 · parseBoundingBoxes tolerates anything the column can hold', () => {
  it('T-AI-041aa: a well-formed array survives intact', () => {
    expect(parseBoundingBoxes(JSON.stringify([box]))).toEqual([box]);
  });

  it('T-AI-041ab: a null or empty column is no boxes, not a throw', () => {
    expect(parseBoundingBoxes(null)).toEqual([]);
    expect(parseBoundingBoxes('')).toEqual([]);
  });

  it('T-AI-041ac: unparseable JSON degrades to no boxes', () => {
    expect(parseBoundingBoxes('{not json')).toEqual([]);
  });

  it('T-AI-041ad: valid JSON that is not an array degrades to no boxes', () => {
    expect(parseBoundingBoxes('{"imageId":"img_1"}')).toEqual([]);
    expect(parseBoundingBoxes('null')).toEqual([]);
    expect(parseBoundingBoxes('7')).toEqual([]);
  });

  // ⚠ FILTERED, NOT REJECTED WHOLESALE. One bad box among several must not
  // discard the good ones: the crop is drawn from their union, and losing a
  // valid box silently narrows the region rather than falling back to the
  // whole image, which is the failure mode that looks like it worked.
  it('T-AI-041ae: a malformed entry is dropped and its valid siblings are kept', () => {
    const raw = JSON.stringify([box, { imageId: 'img_1', x: '0.5', y: 0.1, w: 0.1, h: 0.1 }]);
    expect(parseBoundingBoxes(raw)).toEqual([box]);
  });

  it('T-AI-041af: every coordinate must be a number, and imageId a string', () => {
    const bad = [
      { ...box, x: '0.1' },
      { ...box, y: null },
      { ...box, w: undefined },
      { ...box, h: {} },
      { ...box, imageId: 42 },
      { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      null,
      'img_1',
      [],
    ];

    for (const entry of bad) {
      expect(parseBoundingBoxes(JSON.stringify([entry]))).toEqual([]);
    }
  });
});
