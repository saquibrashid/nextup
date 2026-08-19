import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const deploy = readFileSync(path.join(repoRoot, '.github/workflows/deploy.yml'), 'utf8');

// ⚠ THE PARAMETER FILES ARE PART OF THE PIPELINE'S CONTRACT, so they are read
// here rather than only in the bicep specs. `deploy.yml` used to pass every
// parameter inline and never open these files, while infra/README.md and
// docs/architecture.md both documented them as the per-environment source of
// truth. The result was a silent trap: `deployAi = true` was set in the
// staging file, `what-if` against that file showed the AI resources being
// created, CI reported a green deploy, and nothing was provisioned. Assertions
// about "what the deployment passes" must therefore look where the deployment
// actually reads.
const bicepparam = {
  staging: readFileSync(path.join(repoRoot, 'infra/main.staging.bicepparam'), 'utf8'),
  prod: readFileSync(path.join(repoRoot, 'infra/main.prod.bicepparam'), 'utf8'),
};

// Comments stripped for the PROHIBITION checks below. A ban on
// `prisma migrate dev` that also fires on the comment explaining why it is
// banned is a false positive, and the cheapest way to make it pass is to
// delete the explanation — leaving the rule in place and its reasoning gone.
const deployCode = deploy
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');

// The deployment pipeline is the one place in this repo where a mistake is not
// caught by a later stage — there is no stage after production. These assert
// the ORDER and the PROHIBITIONS in deploy.yml, because both are invisible in
// review: a reviewer reads a workflow top to bottom and sees plausible steps,
// not that two of them are the wrong way round.

describe('T-CI-009 the deployment pipeline cannot skip its own gates', () => {
  it('T-CI-009a: production is gated on BOTH the build and a real staging deploy', () => {
    // `needs: [build, staging]` is the entire staging-first guarantee. Dropping
    // `staging` from that list leaves a workflow that still looks staged — the
    // job is still there, still runs, still goes green — while production no
    // longer waits for it.
    expect(deploy).toMatch(/needs:\s*\[build,\s*staging\]/);
  });

  it('T-CI-009b: neither `prisma migrate dev` nor `prisma db push` appears anywhere', () => {
    // TASK-007 states this absolutely. `migrate dev` rewrites migration
    // history and `db push` drops whatever does not match the schema; either
    // against a real database is unrecoverable, and REQ-028 forbids silent
    // data loss outright.
    expect(deployCode).not.toMatch(/prisma\s+migrate\s+dev/);
    expect(deployCode).not.toMatch(/prisma\s+db\s+push/);
  });

  it('T-CI-009c: both environments migrate with `migrate deploy`', () => {
    const occurrences = deployCode.match(/npx prisma migrate deploy/g) ?? [];
    expect(occurrences.length).toBe(2);
  });

  it('T-CI-009d: the registry is ghcr.io and nothing reaches for ACR', () => {
    // ADR-0003 Rev 3 and TASK-146: ghcr.io, public package, pulled
    // anonymously, pushed with the built-in GITHUB_TOKEN. An `azurecr.io`
    // login or an AcrPush role would reintroduce the credential this design
    // removed.
    expect(deploy).toMatch(/ghcr\.io/);
    expect(deployCode).not.toMatch(/azurecr\.io/);
    expect(deployCode).not.toMatch(/AcrPush/);
    expect(deploy).toMatch(/password:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  });

  it('T-CI-009e: the image is secret-scanned BEFORE it is pushed, not after', () => {
    // Order is the whole control. Scanning after the push tells you about a
    // leaked credential that is already published — and ghcr retains the layer
    // even once the tag is deleted, so "delete and re-push" does not undo it.
    const scan = deploy.indexOf('Secret-scan the built image');
    const push = deploy.indexOf('Push image');

    expect(scan, 'the image secret-scan step is missing').toBeGreaterThan(-1);
    expect(push, 'the push step is missing').toBeGreaterThan(-1);
    expect(scan).toBeLessThan(push);
  });

  it('T-CI-009f: the build step does not push, so the scan cannot be bypassed', () => {
    // A `push: true` on the build action would publish the image before the
    // scan step is ever reached, leaving the scan in place and passing while
    // controlling nothing.
    expect(deployCode).toMatch(/push:\s*false/);
    expect(deployCode).not.toMatch(/push:\s*true/);
  });

  it('T-CI-009g: production traffic is shifted only AFTER the production smoke suite', () => {
    // The anchor is the step that PINS traffic for the duration of the deploy.
    // It was renamed when the gate was made real (it used to run after the
    // deployment, where it held nothing) — the ordering property it asserts is
    // unchanged, and is now reinforced by T-CI-009o.
    const hold = deploy.indexOf('Read the revision currently serving traffic');
    // ~~const hold = deploy.indexOf('Hold new revision at 0% traffic');~~
    const smoke = deploy.lastIndexOf('Production smoke suite');
    const shift = deploy.indexOf('Shift traffic to 100%');

    expect(hold).toBeGreaterThan(-1);
    expect(smoke).toBeGreaterThan(hold);
    expect(shift, 'traffic must shift last, or the smoke suite gates nothing').toBeGreaterThan(
      smoke,
    );
  });

  it('T-CI-009h: staging smoke runs before the production job is defined', () => {
    const stagingSmoke = deploy.indexOf('Staging smoke suite');
    const prodJob = deploy.indexOf('production:');

    expect(stagingSmoke).toBeGreaterThan(-1);
    expect(stagingSmoke).toBeLessThan(prodJob);
  });

  it('T-CI-009i: every action is pinned to a commit SHA, never a tag (T-CI-006)', () => {
    // A tag is mutable: `@v4` can be repointed at new code by anyone who can
    // push a tag to that action's repository.
    const uses = [...deploy.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) {
      expect(u, `${u} is not pinned to a 40-character commit SHA`).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('T-CI-009j: the migration gate runs in the deploy pipeline, not only in CI', () => {
    // CI green on an earlier commit is not evidence about the commit being
    // deployed, and a destructive migration must be stopped before it reaches
    // either environment.
    expect(deploy).toMatch(/tests\/infra\/migrations\.spec\.ts/);
  });

  it('T-CI-009k: concurrent deployments cannot race, and are not cancelled mid-flight', () => {
    // Cancelling a deployment part-way through a migration or a traffic shift
    // leaves the environment in a state nobody chose.
    expect(deploy).toMatch(/concurrency:/);
    expect(deploy).toMatch(/cancel-in-progress:\s*false/);
  });

  it('T-CI-009l: the ghcr credential note is linked where someone would look for it', () => {
    expect(deploy).toMatch(/docs\/ghcr-pat\.md/);
  });

  it('T-CI-009m: BOTH environments pass an explicit sqlLocation', () => {
    // Azure SQL refuses new logical servers in whole regions, per subscription
    // and without notice (`ProvisioningDisabled`). eastus2 is refused for this
    // subscription today while everything else deploys there, so SQL is pinned
    // separately. If `sqlLocation` is dropped it defaults to `location` and the
    // deployment fails — but only at the sqldb module, after the rest of the
    // stack has already been written, and NOT during `az deployment group
    // validate`, which does not consult regional capacity.
    //
    // Asserted per environment rather than as a total count: setting it in
    // staging only would go green on a count of >= 1 and then fail production,
    // which is the one environment with no stage after it to catch anything.
    //
    // ⚠ Asserted against the .bicepparam files, because that is where the
    // deployment now reads its parameters from. The previous form matched
    // `sqlLocation="$SQL_LOCATION"` in the workflow's inline arguments.
    const jobs = deployCode
      .split(/^ {2}[a-z]+:$/m)
      .filter((s) => s.includes('az deployment group create'));
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job).toMatch(/--parameters infra\/main\.(staging|prod)\.bicepparam/);
    }
    for (const [env, text] of Object.entries(bicepparam)) {
      expect(text, `${env} must pin sqlLocation explicitly`).toMatch(
        /^param sqlLocation = '[a-z0-9]+'$/m,
      );
    }
  });

  it('T-CI-009n: sqlLocation is a distinct value, not an alias of location', () => {
    // The whole point of the parameter is that the two regions differ. Setting
    // it to the same literal satisfies T-CI-009m while restoring exactly the
    // failure it exists to prevent.
    for (const [env, text] of Object.entries(bicepparam)) {
      const loc = /^param location = '([a-z0-9]+)'$/m.exec(text)?.[1];
      const sqlLoc = /^param sqlLocation = '([a-z0-9]+)'$/m.exec(text)?.[1];
      expect(loc, `${env} location`).toBeTruthy();
      expect(sqlLoc, `${env} sqlLocation`).toBeTruthy();
      expect(sqlLoc, `${env} must not collapse the two regions`).not.toBe(loc);
    }
  });
  // ── The blue/green gate (added after the first production deployment) ──────
  //
  // The first prod run failed at the last step: the app was in Single revision
  // mode, where `ingress traffic set` is rejected outright. The steps BEFORE it
  // all reported success — including a "hold at 0%" that had held nothing and a
  // smoke suite that had tested the already-live revision. These assert the
  // three properties that make the gate real, each of which was individually
  // absent while the pipeline looked correct.

  it('T-CI-009o: the held revision is read BEFORE the deployment, not after', () => {
    // Order is the whole mechanism. ARM applies the traffic block as part of
    // `deployment group create`, so a hold computed afterwards is a hold on a
    // revision that is already serving the owner — and it reads identically in
    // a diff. Asserted as an index comparison because both steps exist in
    // either arrangement. Scoped to the production job: an unscoped
    // `indexOf('az deployment group create')` finds STAGING's copy, which
    // precedes the whole production job and makes the assertion unsatisfiable
    // no matter how the steps are ordered.
    const prodJob = deployCode.slice(deployCode.indexOf('  production:'));
    const prev = prodJob.indexOf('az containerapp ingress traffic show');
    const create = prodJob.indexOf('az deployment group create');
    expect(prev).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(-1);
    expect(prev).toBeLessThan(create);

    // ⚠ BOTH HALVES ARE REQUIRED. The workflow must export the discovered
    // revision, AND the parameter file must actually read that variable —
    // exporting it to a file that ignores it, or reading a variable nobody
    // sets, each leaves the hold silently empty while every step still goes
    // green. `holdRevisionName` defaults to '' precisely so the first-ever
    // deploy works, which is what makes a broken wiring invisible.
    expect(prodJob).toMatch(/NEXTUP_HOLD_REVISION:\s*\$\{\{ steps\.prev\.outputs\.revision \}\}/);
    expect(bicepparam.prod).toMatch(
      /param holdRevisionName = readEnvironmentVariable\(\s*'NEXTUP_HOLD_REVISION'/,
    );
  });

  it('T-CI-009p: production smoke targets the new revision, not the app FQDN', () => {
    // The app FQDN is exactly what is still pinned to the OLD revision while
    // the hold is in force, so smoking it exercises the code already known to
    // work and reports green for a revision nobody contacted. Distinguishing
    // the two URLs is the only thing that makes the gate load-bearing.
    const prodJob = deployCode.slice(deployCode.indexOf('  production:'));
    expect(prodJob).toMatch(/SMOKE_BASE_URL:\s*https:\/\/\$\{\{ steps\.target\.outputs\.fqdn \}\}/);
    expect(prodJob).not.toMatch(
      /SMOKE_BASE_URL:\s*https:\/\/\$\{\{ steps\.deploy\.outputs\.fqdn \}\}/,
    );
  });

  it('T-CI-009q: the superseded revision is deactivated, and only after the shift', () => {
    // Prod runs minReplicas = 1, so every revision left Active bills a replica
    // for ever: without this the gate doubles the standing cost of the app on
    // each deploy. But it must NOT run unconditionally — if the traffic shift
    // did not happen, the old revision is still the one serving the owner.
    const deact = deployCode.indexOf('az containerapp revision deactivate');
    const shift = deployCode.indexOf('--revision-weight');
    expect(deact).toBeGreaterThan(-1);
    expect(shift).toBeGreaterThan(-1);
    expect(deact).toBeGreaterThan(shift);
    const step = deployCode.slice(deployCode.lastIndexOf('- name:', deact), deact);
    expect(step).toMatch(/if:\s*steps\.prev\.outputs\.revision != ''/);
    expect(step).not.toMatch(/if:\s*always\(\)/);
  });
  it('T-CI-009r: a traffic entry that names no revision is resolved, not treated as bootstrap', () => {
    // Two different empty results reach this code. The command FAILING means
    // the app does not exist — a real first deployment. A successful read whose
    // weighted entry has a null `revisionName` means something entirely
    // different: the app is live and serving, the entry is just
    // `latestRevision: true`, which is what both Single revision mode and the
    // bicep bootstrap branch produce. Conflating them skips the hold on a
    // RUNNING production app and logs "first deployment" while doing it —
    // observed on the first real prod run, where it also skipped the
    // deactivation and left a second replica billing indefinitely.
    const prodJob = deployCode.slice(deployCode.indexOf('  production:'));
    const step = prodJob.slice(0, prodJob.indexOf('az deployment group create'));
    expect(step).toMatch(/if TRAFFIC=\$\(az containerapp ingress traffic show/);
    expect(step).toMatch(/if \[ -z "\$CUR" \]; then/);
    expect(step).toMatch(/az containerapp revision list/);
  });
});
