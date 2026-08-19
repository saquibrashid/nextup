/**
 * Build an {@link ExtractorConfig} from the process environment (TASK-058 wiring).
 *
 * ⚠ THIS IS THE "STAGING-ONLY" GATE, AND IT IS DELIBERATELY NOT AN
 * ENVIRONMENT-NAME CHECK. Nothing here reads `NEXTUP_ENVIRONMENT` and nothing
 * compares against the string `'staging'`. The condition is *"is a reader
 * actually configured"* — `NEXTUP_AOAI_ENDPOINT` / `NEXTUP_VISION_ENDPOINT`
 * present and non-empty — because that is the property the code genuinely
 * depends on. Today only staging satisfies it (`infra/main.staging.bicepparam`
 * sets `deployAi = true`, prod sets `false`), so the observable behaviour is
 * "staging extracts, prod does not" without a single line of code that knows
 * what an environment is called. When the bake-off reports and prod gets its
 * own AOAI account, prod starts extracting with **no code change** — and, more
 * importantly, an environment that is *named* staging but has lost its
 * endpoint fails honestly instead of pretending.
 *
 * Both readers throw on a missing value rather than returning `undefined`
 * (`readAoaiConfig`, `readVisionEndpoint`). That is the mechanism: the caller
 * (`startExtraction`) turns the throw into a batch marked `extraction-failed`
 * with `EXTRACTOR_UNAVAILABLE`, which the owner can see and retry. The
 * alternative — accepting the submit and quietly doing nothing — leaves the
 * batch in `extracting` for ever while the SPA polls, which is the worst of
 * the available failures because it looks like it is working.
 */

import { DefaultAzureCredential } from '@azure/identity';
import { crossCheck } from '@nextup/domain';

import { readVisionEndpoint } from './azureVisionExtractor.js';
import { readAoaiConfig } from './llmVisionExtractor.js';
import { readExtractorName, type ExtractorConfig } from './factory.js';

/**
 * Memoised: `DefaultAzureCredential` caches its IMDS token internally, and
 * constructing a fresh one per image would re-do the managed-identity probe on
 * every call.
 */
let cachedCredential: DefaultAzureCredential | undefined;

function credential(): DefaultAzureCredential {
  cachedCredential ??= new DefaultAzureCredential();
  return cachedCredential;
}

/** Test seam — forget the memoised credential after the environment changes. */
export function resetExtractorCredentialForTests(): void {
  cachedCredential = undefined;
}

export function extractorConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): ExtractorConfig {
  const name = readExtractorName(env);

  if (name === 'stub') {
    // The stub replays committed recordings and exists for the offline suites,
    // which construct it directly with an injected `RecordingStore`. Selecting
    // it from a deployed environment would mean the owner's real screenshots
    // are answered from fixtures — silently, and looking entirely successful.
    throw new Error(
      'NEXTUP_EXTRACTOR=stub is a test-only extractor and cannot be built from the ' +
        'environment: it replays committed recordings, so a deployed process would ' +
        "answer the owner's real screenshots with fixture data.",
    );
  }

  const cfg: ExtractorConfig = { NEXTUP_EXTRACTOR: name, crossCheck };

  if (name === 'hybrid' || name === 'azure-vision-read') {
    cfg.vision = { endpoint: readVisionEndpoint(env), credential: credential() };
  }
  if (name === 'hybrid' || name === 'llm-vision') {
    const { endpoint, deployment } = readAoaiConfig(env);
    cfg.llm = { endpoint, deployment, credential: credential() };
  }

  return cfg;
}
