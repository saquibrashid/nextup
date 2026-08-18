/**
 * TASK-056b — the committed prompt and response schema for the primary reader
 * (`specs/ai.md` §2.1a).
 *
 * WHY THESE ARE CONSTANTS IN A COMMITTED FILE, AND NOT CONFIGURATION
 * -----------------------------------------------------------------
 * The prompt IS the extractor's behaviour. A prompt read from an environment
 * variable is an untested code path that changes what the product does without
 * appearing in any diff, and the golden metrics in `specs/ai.md` §9 would be
 * measuring a different program from the one running. Changing anything in
 * this file requires a golden re-run (`T-AI-038`).
 *
 * RULE B / REQ-058 IS ENFORCED STRUCTURALLY HERE
 * ----------------------------------------------
 * The reader must never know, infer, name or leak which streaming service a
 * screenshot came from. `TILE_SCHEMA` is `strict: true` with
 * `additionalProperties: false` at every level, so the provider *cannot*
 * return a service field even if it wanted to — there is no property to put it
 * in and no free-text field to hide it in. The system prompt's negative
 * instruction is belt-and-braces on top of that, not the primary control.
 * `T-AI-011b` walks this schema and asserts no property name and no enum value
 * contains a service name.
 */

/**
 * The JSON Schema for Structured Outputs.
 *
 * ⚠ `strict: true` (set at the call site) imposes rules that are easy to break
 * by accident:
 *   - EVERY property must be listed in `required`. Optionality is expressed as
 *     a nullable type, never by omission from `required`.
 *   - `additionalProperties: false` is mandatory on every object.
 * Violating either is rejected by the service at request time, not at response
 * time — so it fails every call, loudly, which is the good failure mode.
 */
export const TILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tiles'],
  properties: {
    tiles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['visibleText', 'identifiedTitle', 'basis', 'confidence', 'box'],
        properties: {
          // VERBATIM glyphs, or null if none legible.
          visibleText: { type: ['string', 'null'] },
          // The work, or null if not identifiable. NEVER a guess.
          identifiedTitle: { type: ['string', 'null'] },
          basis: { enum: ['text', 'artwork', 'both', 'unknown'] },
          confidence: { type: 'number' },
          box: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y', 'w', 'h'],
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              w: { type: 'number' },
              h: { type: 'number' },
            },
          },
        },
      },
    },
  },
} as const;

/** The `json_schema` name sent alongside {@link TILE_SCHEMA}. */
export const TILE_SCHEMA_NAME = 'tiles';

/**
 * ⚠ "Do NOT guess" is the single most important line in this prompt.
 *
 * It converts the model's default behaviour — produce something plausible —
 * into the behaviour the review pass needs: produce nothing rather than
 * something wrong. A fabricated title survives every downstream stage, because
 * every downstream stage is deterministic and has no way to know the string
 * was invented (RSK-028). `basis: "unknown"` with `visibleText` populated is a
 * first-class, expected, CORRECT answer.
 *
 * Copied from `specs/ai.md` §2.1a. Do not paraphrase it while "tidying".
 */
export const EXTRACTION_SYSTEM_PROMPT = `You read a screenshot of a saved/watch list from a video app and report
the tiles you can see. For each distinct tile, report:
  visibleText     - the text printed on or under the tile, copied EXACTLY,
                    character for character, including truncation such as a
                    trailing ellipsis. null if no text is legible.
  identifiedTitle - the film or series you believe the tile represents,
                    as its commonly used title. You may use the artwork.
                    If the text is truncated, give the complete title.
                    null if you are not confident which work it is.
  basis           - "text" if you read it from printed text only,
                    "artwork" if from the artwork only,
                    "both" if both agreed,
                    "unknown" if you could not identify the work.
  confidence      - 0..1, your confidence in identifiedTitle.
  box             - the tile's bounding box, normalised 0..1, origin top-left.

Rules:
- Report EVERY tile you can see, including ones you cannot identify.
  A tile with identifiedTitle=null and basis="unknown" is a correct and
  useful answer. NEVER omit a tile.
- Do NOT guess. If you are unsure which work a tile is, set
  identifiedTitle to null rather than offering a likely-sounding title.
- Do NOT report navigation, headings, buttons, row labels, badges,
  durations or progress indicators as tiles.
- Do NOT name, identify, infer or mention the app, service, platform or
  brand the screenshot came from, anywhere, for any reason.
- Return only the JSON object required by the schema.`;

export const EXTRACTION_USER_PROMPT = 'Report the tiles in this screenshot.';
