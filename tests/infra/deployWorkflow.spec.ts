import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const deploy = readFileSync(path.join(repoRoot, '.github/workflows/deploy.yml'), 'utf8');

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
    const hold = deploy.indexOf('Hold new revision at 0% traffic');
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
    // Asserted per deploy job rather than as a total count: passing it in
    // staging only would go green on a count of >= 1 and then fail production,
    // which is the one environment with no stage after it to catch anything.
    const jobs = deployCode
      .split(/^ {2}[a-z]+:$/m)
      .filter((s) => s.includes('az deployment group create'));
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job).toMatch(/sqlLocation="\$SQL_LOCATION"/);
    }
    expect(deployCode).toMatch(/SQL_LOCATION:\s*\S+/);
  });

  it('T-CI-009n: sqlLocation is a distinct value, not an alias of LOCATION', () => {
    // The whole point of the parameter is that the two regions differ. Setting
    // SQL_LOCATION to $LOCATION, or to the same literal, satisfies T-CI-009m
    // while restoring exactly the failure it exists to prevent.
    const loc = /^\s*LOCATION:\s*(\S+)\s*$/m.exec(deployCode)?.[1];
    const sqlLoc = /^\s*SQL_LOCATION:\s*(\S+)\s*$/m.exec(deployCode)?.[1];
    expect(loc).toBeTruthy();
    expect(sqlLoc).toBeTruthy();
    expect(sqlLoc).not.toBe(loc);
    expect(sqlLoc).not.toMatch(/\$/);
  });
});
