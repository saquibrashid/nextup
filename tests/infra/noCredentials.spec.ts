/**
 * Credential, auth-library and automation gates (TASK-030).
 *
 * `T-SEC-011` — US-002 AC-3 — no auth library, no password field, no
 * credential column anywhere. `T-SEC-001` — US-038 AC-1/AC-4 — no credential
 * field, cookie jar or secret named for a streaming service in code, schema or
 * config, and no automation dependency in the tree.
 *
 * Every case here asserts the CHECKER WORKS, not merely that the repository is
 * currently clean. A clean tree passes a check that does nothing: each ban is
 * fed a deliberate violation in a scratch directory inside the repository —
 * inside, so the walker actually reaches it — and required to catch it.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AUTOMATION_PACKAGES,
  FORBIDDEN_AUTH_PACKAGES,
  SELF_REFERENTIAL,
  STREAMING_HOSTS,
  checkNoCredentials,
  checkSchemaFile,
  checkSourceFile,
} from '../../tools/check-no-credentials.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'tools', 'check-no-credentials.mjs');

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A scratch REPOSITORY ROOT, created OUTSIDE the repository.
 *
 * ⚠ Not a detail. The `infra` Vitest project runs its spec files in parallel,
 * and several of them walk the whole repository. A scratch directory planted
 * inside the repo is therefore visible to every other file's checker, which
 * fails on a violation someone else deliberately planted. That is a real
 * cross-file failure this suite hit, and the fix is to keep planted violations
 * out of the shared tree entirely — `checkNoCredentials` takes a root for
 * exactly this reason.
 */
function scratchRoot(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `nextup-${prefix}-`));
  created.push(dir);
  return dir;
}

/** Write a package.json into a scratch root and return that root. */
function scratchPackage(prefix: string, pkg: Record<string, unknown>): string {
  const root = scratchRoot(prefix);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  return root;
}

describe('T-SEC-011 · US-002 AC-3 · no auth library, no password handling (ADR-0002)', () => {
  it('T-SEC-011a · the repository as committed holds no auth library or credential', async () => {
    const findings = await checkNoCredentials();
    expect(findings).toEqual([]);
  });

  it('T-SEC-011b · adding passport is caught', async () => {
    const root = scratchPackage('passport', { name: 'v', dependencies: { passport: '^0.7.0' } });
    const findings = await checkNoCredentials(root);
    expect(findings.some((f: string) => f.includes('passport'))).toBe(true);
  });

  it('T-SEC-011c · every auth package pattern catches a realistic install name', async () => {
    // A pattern that matches nothing real is a pattern that protects nothing.
    // These are the names npm would actually write into package.json.
    const realNames = [
      'passport',
      'passport-azure-ad',
      'jsonwebtoken',
      'jose',
      'next-auth',
      '@auth/core',
      'oidc-client-ts',
      'openid-client',
      '@azure/msal-node',
      'express-session',
      'cookie-session',
      'connect-mongodb-session',
      'bcrypt',
      'bcryptjs',
      'argon2',
      'scrypt-kdf',
      'pbkdf2',
      'lucia',
      '@clerk/backend',
      '@supabase/auth-helpers-react',
      'firebase-admin',
      'auth0',
      'express-jwt',
      'passport-jwt',
    ];
    const unmatched = realNames.filter(
      (name) => !FORBIDDEN_AUTH_PACKAGES.some((re) => re.test(name)),
    );
    expect(unmatched, 'these auth packages would install unnoticed').toEqual([]);
  });

  it('T-SEC-011d · a devDependency auth library is caught too, not just a runtime one', async () => {
    // A session library in devDependencies is still importable, and "it's only
    // dev" is exactly how it would arrive.
    const root = scratchPackage('devauth', {
      name: 'v',
      devDependencies: { 'express-session': '^1.0.0' },
    });
    const findings = await checkNoCredentials(root);
    expect(findings.some((f: string) => f.includes('express-session'))).toBe(true);
  });

  it('T-SEC-011e · a password field on a schema is caught', () => {
    const findings = checkSourceFile(
      'export const userSchema = z.object({ email: z.string(), password: z.string() });',
      'fake.ts',
    );
    expect(findings.some((f) => f.includes('password'))).toBe(true);
  });

  it('T-SEC-011f · password hashing and session minting are caught', () => {
    const cases = [
      'const passwordHash = await hashPassword(input);',
      'if (await comparePassword(a, b)) { }',
      'const token = jwt.sign(payload, secretKey);',
      'res.cookie("sid", sessionId);',
      'export function createSession(userId: string) {}',
    ];
    const missed = cases.filter((src) => checkSourceFile(src, 'fake.ts').length === 0);
    expect(missed, 'these auth implementations would pass unnoticed').toEqual([]);
  });

  it('T-SEC-011g · a credential column in the schema is caught', () => {
    const findings = checkSchemaFile(
      'model Owner {\n  id String @id\n  refreshToken String\n}',
      'fake.prisma',
    );
    expect(findings.length).toBeGreaterThan(0);
  });

  it('T-SEC-011h · a credential column in a migration is caught', () => {
    const findings = checkSchemaFile(
      'ALTER TABLE [owner] ADD [api_key] NVARCHAR(200) NOT NULL;',
      'fake.sql',
    );
    expect(findings.length).toBeGreaterThan(0);
  });

  it('T-SEC-011i · the SQL connection string is NOT a false positive', () => {
    // `password=` is unavoidable in a SQL Server connection string and is not
    // the application handling a password. If this fired, the whole check
    // would be suppressed within a week and would then protect nothing.
    const findings = checkSourceFile(
      'DATABASE_URL="sqlserver://localhost:1433;database=nextup;user=sa;password=hunter2;encrypt=true"',
      'fake.env',
    );
    expect(findings).toEqual([]);
  });

  it('T-SEC-011j · the word passwordless is NOT a false positive', () => {
    const findings = checkSourceFile('// identity is passwordless by design', 'fake.ts');
    expect(findings).toEqual([]);
  });

  it('T-SEC-011k · a commented-out credential column is not reported as schema', () => {
    const findings = checkSchemaFile('-- password column deliberately absent', 'fake.sql');
    expect(findings).toEqual([]);
  });
});

describe('T-SEC-001 · US-038 AC-1/AC-4 · no streaming credential, no automation (NFR-009/010)', () => {
  it('T-SEC-001a · the repository as committed holds no streaming credential', async () => {
    const findings = await checkNoCredentials();
    expect(findings).toEqual([]);
  });

  it('T-SEC-001b · a streaming-service credential env name is caught', () => {
    const findings = checkSourceFile('const pw = process.env.NETFLIX_PASSWORD;', 'fake.ts');
    expect(findings.some((f) => f.includes('NFR-009'))).toBe(true);
  });

  it('T-SEC-001c · a cookie jar is caught', () => {
    const findings = checkSourceFile('const cookieJar = new CookieJar();', 'fake.ts');
    expect(findings.length).toBeGreaterThan(0);
  });

  it('T-SEC-001d · an HTTP client targeting a streaming domain is caught', () => {
    const findings = checkSourceFile(
      "await fetch('https://www.netflix.com/api/shakti/mylist');",
      'fake.ts',
    );
    expect(findings.some((f) => f.includes('NFR-010'))).toBe(true);
  });

  it('T-SEC-001e · every streaming host in the list is actually detected', () => {
    const missed = STREAMING_HOSTS.filter(
      (host) => checkSourceFile(`await fetch('https://${host}/x');`, 'fake.ts').length === 0,
    );
    expect(missed, 'these hosts are listed but not detected').toEqual([]);
  });

  it('T-SEC-001f · the service ENUM values netflix and max are NOT false positives', () => {
    // `'netflix'` and `'max'` are first-class domain values (REQ-053). Banning
    // the words rather than the hosts would make the whole domain model
    // unwritable, and the ban would be deleted rather than narrowed.
    const findings = checkSourceFile(
      "export type Service = 'netflix' | 'max';\nconst s: Service = 'netflix';",
      'fake.ts',
    );
    expect(findings).toEqual([]);
  });

  it('T-SEC-001g · puppeteer in runtime dependencies is caught', async () => {
    const root = scratchPackage('puppeteer', { name: 'v', dependencies: { puppeteer: '^22.0.0' } });
    const findings = await checkNoCredentials(root);
    expect(findings.some((f: string) => f.includes('puppeteer'))).toBe(true);
  });

  it('T-SEC-001h · playwright in runtime dependencies is caught', async () => {
    const root = scratchPackage('pw-runtime', {
      name: 'v',
      dependencies: { playwright: '^1.0.0' },
    });
    const findings = await checkNoCredentials(root);
    expect(findings.some((f: string) => f.includes('playwright'))).toBe(true);
  });

  it('T-SEC-001i · playwright in devDependencies is ALLOWED — it is the e2e suite', async () => {
    // The distinction is the entire check. A blanket ban deletes the e2e
    // suite; a blanket allow lets a headless browser ship. `@playwright/test`
    // is already a devDependency of this repository.
    const root = scratchPackage('pw-dev', {
      name: 'v',
      devDependencies: { '@playwright/test': '^1.0.0' },
    });
    const findings = await checkNoCredentials(root);
    expect(findings.filter((f: string) => f.includes('playwright'))).toEqual([]);
  });

  it('T-SEC-001j · every automation package pattern catches a realistic install name', () => {
    const realNames = [
      'puppeteer',
      'puppeteer-core',
      'playwright',
      'playwright-core',
      '@playwright/test',
      'selenium-webdriver',
      'webdriverio',
      'chrome-remote-interface',
      'cheerio',
      'jsdom',
      'tough-cookie',
      'fetch-cookie',
      'http-cookie-agent',
    ];
    const unmatched = realNames.filter((n) => !AUTOMATION_PACKAGES.some((re) => re.test(n)));
    expect(unmatched, 'these scraping tools would ship unnoticed').toEqual([]);
  });

  it('T-SEC-001k · the exemption list is exactly the checker and its own test', () => {
    // A suppression list that grows by one convenient entry at a time is how
    // an allow-list dies. These two files necessarily contain the forbidden
    // strings; nothing else may.
    expect([...SELF_REFERENTIAL].sort()).toEqual([
      'tests/infra/noCredentials.spec.ts',
      'tools/check-no-credentials.mjs',
    ]);
  });

  it('T-SEC-001l · the script exits non-zero on a violation, so CI actually blocks', () => {
    // A checker that finds violations and exits 0 blocks nothing. Run against
    // a scratch root so the planted violation is invisible to the other spec
    // files walking the real tree in parallel.
    const root = scratchPackage('exitcode', { name: 'v', dependencies: { puppeteer: '^22.0.0' } });
    let exitCode = 0;
    try {
      execFileSync(
        process.execPath,
        [
          '-e',
          `const m = await import(${JSON.stringify(SCRIPT.split(path.sep).join('/'))});` +
            `if ((await m.checkNoCredentials(${JSON.stringify(root)})).length > 0) process.exit(1);`,
        ],
        { cwd: ROOT, stdio: 'pipe' },
      );
    } catch (err) {
      exitCode = (err as { status?: number }).status ?? -1;
    }
    expect(exitCode).toBe(1);
  });

  it('T-SEC-001m · the script exits zero on the clean tree', () => {
    const out = execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, stdio: 'pipe' });
    expect(out.toString()).toContain('Credential check passed');
  });
});
