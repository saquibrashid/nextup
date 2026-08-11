// @nextup/api — Node + Express API. In production this same process also serves
// the built SPA from apps/web (single image, single port — TASK-005).
//
// PLACEHOLDER entry point (baseline scaffold). Routes, middleware order, owner
// scoping, batch atomicity and the error envelope are specified in
// specs/api.md and built by the backlog tasks. Do not wire real routes here
// without their named tests (specs/testing.md).

/* eslint-disable no-console */
const port = Number(process.env.PORT ?? 3000);

function main(): void {
  console.log(`nextup api placeholder — not yet implemented. Would listen on :${port}`);
}

main();
