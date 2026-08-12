// @nextup/api — process entrypoint. Bootstrap only: the application itself is
// `app.ts`, and the middleware order and route registry live in `routes/`.
//
// Kept deliberately thin so the app can be constructed in tests without binding
// a port, and so this file holds nothing worth testing — which is why it is the
// one API source file excluded from coverage (see vitest.config.ts).
//
// There is no CORS configuration anywhere and none may be added: with a single
// origin a cross-origin request is not possible, and `T-API-001` asserts no
// `Access-Control-Allow-Origin` header is ever emitted.

import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);

/* c8 ignore start — bootstrap only; exercised by the e2e and smoke suites. */
if (process.env.NEXTUP_NO_LISTEN !== '1') {
  createApp().listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`nextup listening on :${port}`);
  });
}
/* c8 ignore stop */

export { createApp };
