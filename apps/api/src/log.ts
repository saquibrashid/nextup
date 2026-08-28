/**
 * `apps/api/src/log.ts` — the stdout log sink (`specs/api.md` §9).
 *
 * ⚠ ONE JSON OBJECT PER LINE ON STDOUT, AND NOTHING ELSE. Container Apps ships
 * stdout to `ContainerAppConsoleLogs`, which is what the
 * `nextup-prod-decode-abandoned` log-search alert queries. A pretty-printed or
 * multi-line object would split one event across several log rows and the
 * alert's `imageId` correlation would stop pairing.
 *
 * ⚠ NO LOGGING LIBRARY, NO TRANSPORT, NO APPLICATION INSIGHTS (`NFR-005`,
 * `T-SEC-009`). A dependency here would be a telemetry SDK by another name.
 *
 * The sink is swappable ONLY so a test can read what was written without
 * capturing the process's stdout. It is not a plugin point: nothing in the
 * product may install a second sink, and nothing may send these lines
 * anywhere but stdout.
 */

export type LogSink = (line: string) => void;

const stdoutSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/**
 * Write one structured line.
 *
 * `JSON.stringify` drops `undefined` members, which is exactly the contract
 * §9.1 wants for the optional `errorName`: absent, not `null`.
 */
export function logLine(event: object, sink: LogSink = stdoutSink): void {
  sink(JSON.stringify(event));
}

/** ISO-8601 UTC with millisecond precision, as §9 fixes it. */
export function logTimestamp(at: Date = new Date()): string {
  return at.toISOString();
}
