import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function waitForSmoke(baseUrl, { timeoutMs = 120_000, intervalMs = 2_000 } = {}) {
  const url = new URL('/', baseUrl);
  const deadline = Date.now() + timeoutMs;
  let lastFailure = 'No response';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.max(1, Math.min(5_000, deadline - Date.now()))),
        headers: { 'user-agent': 'nextup-smoke-readiness' },
      });
      await response.body?.cancel();
      // Any non-5xx answer is ready for the smoke assertions, including an
      // insecure 200: readiness must not retry away an Easy Auth regression.
      if (response.status < 500) {
        console.log(`Smoke target is responding (HTTP ${response.status}).`);
        return;
      }
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    console.warn(`Smoke target not ready: ${lastFailure}`);
    const remaining = deadline - Date.now();
    if (remaining > 0) await setTimeout(Math.min(intervalMs, remaining));
  }

  throw new Error(`Smoke target did not become ready within ${timeoutMs}ms: ${lastFailure}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.SMOKE_BASE_URL;
  if (!url) throw new Error('SMOKE_BASE_URL is not set.');
  await waitForSmoke(url);
}
