/**
 * Local development entrypoint. NOT part of the production build — see
 * `devPrincipal.ts` for why the boundary is a directory rather than a flag.
 *
 * Run with `npm run dev --workspace @nextup/api`. Set `NEXTUP_DEV_SUBJECT` to
 * any string to sign in as that subject, and put the SAME value in
 * `NEXTUP_ALLOWED_SUBJECTS` — the allow-list is not bypassed here, because a
 * dev server that skipped it would be the one configuration nobody ever tests
 * the refusal path against.
 */

import { createApp } from '../src/app.js';
import { readDevPrincipal } from './devPrincipal.js';

const port = Number(process.env.PORT ?? 3000);

if (process.env['NEXTUP_DEV_SUBJECT'] === undefined) {
  console.warn(
    'NEXTUP_DEV_SUBJECT is not set — every /api request will return 401. ' +
      'Set it, and add the same value to NEXTUP_ALLOWED_SUBJECTS.',
  );
}

createApp({ readPrincipal: readDevPrincipal }).listen(port, () => {
  console.warn(`nextup dev listening on :${port}`);
});
