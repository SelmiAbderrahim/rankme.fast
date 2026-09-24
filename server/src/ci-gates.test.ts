import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  SERVER_COVERAGE_EXCLUDE,
  SERVER_COVERAGE_INCLUDE,
  SERVER_COVERAGE_THRESHOLDS,
} from './shared/testing/owned-source-policy.js';

// Prompt 11: the coverage + audit gates are declared exactly once. A stray
// duplicate or a downgrade to below 100% must fail CI locally BEFORE the
// GitHub run — so we assert the declarations directly.

describe('CI gate declarations', () => {
  it('server vitest collects every owned executable source file at 100%', () => {
    const cfg = readFileSync(resolve(__dirname, '../vitest.config.ts'), 'utf8');
    expect(cfg).toContain("provider: 'v8'");
    expect(SERVER_COVERAGE_INCLUDE).toEqual(['src/**/*.ts']);
    expect(cfg).toMatch(/all:\s*true/);
    expect(SERVER_COVERAGE_THRESHOLDS).toEqual({
      lines: 100,
      branches: 100,
      functions: 100,
      statements: 100,
    });
  });

  it('freezes the justified server coverage exclusions', () => {
    expect(SERVER_COVERAGE_EXCLUDE).toEqual([
      'src/**/*.d.ts',
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
      'src/server.ts',
      'src/worker.ts',
      'src/scripts/run-user-migration.ts',
      'src/scripts/run-redact-fixture.ts',
      'src/scripts/run-skip-policy.ts',
      'src/scripts/run-rename-audit-log-actions.ts',
      'src/config/logger.ts',
      'src/config/db.ts',
      'tsup.config.ts',
      'drizzle.config.ts',
      'drizzle/**',
      'src/db/schema/auth.ts',
      'better-auth-cli.config.ts',
      'vitest.config.ts',
      'vitest.global-setup.ts',
      'eslint.config.js',
      '**/coverage/**',
      '**/types.ts',
      'src/modules/**/index.ts',
      'src/db/schema/index.ts',
      'src/shared/cooldown/index.ts',
      'src/shared/providers/**/index.ts',
      'src/shared/queue/index.ts',
      'src/shared/vendor-cache/index.ts',
      'src/modules/communication/mailers/mailgun.ts',
    ]);
  });

  it('pins every pre-existing coverage-ignore pragma so the set cannot grow', () => {
    const sourceRoot = resolve(__dirname);
    const findings: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(entry.name)) {
          for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
            const ignoreToken = new RegExp('(?:istanbul|c8|v8)' + ' ignore');
            if (ignoreToken.test(line)) {
              findings.push(`${relative(resolve(__dirname, '..'), path)}:${line.trim()}`);
            }
          }
        }
      }
    };
    walk(sourceRoot);
    const digest = createHash('sha256').update(findings.sort().join('\n')).digest('hex');
    // The COUNT is the anti-growth invariant and must never rise. The digest
    // moves only when an existing pragma's text changes. Ratcheting the pin
    // down is the point of the invariant — it may never rise again.
    expect(findings).toHaveLength(107);
    expect(digest).toBe('de96e00d7795042684fb8d9d7eec26f7d58a917f0292e1a8d5fc081bf6d70172');
  });

  it('client vitest declares 100% v8 coverage thresholds', () => {
    const cfg = readFileSync(resolve(__dirname, '../../client/vitest.config.ts'), 'utf8');
    expect(cfg).toContain("provider: 'v8'");
    expect(cfg).toMatch(/lines:\s*100/);
    expect(cfg).toMatch(/branches:\s*100/);
    expect(cfg).toMatch(/functions:\s*100/);
    expect(cfg).toMatch(/statements:\s*100/);
  });

  it('.github/workflows/ci.yml pipes through the required stages', () => {
    const wf = readFileSync(resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8');
    // Stages: typecheck / lint / test+coverage / npm audit
    expect(wf).toMatch(/npm run typecheck/);
    expect(wf).toMatch(/npm run lint/);
    expect(wf).toMatch(/vitest run --coverage/);
    // Zero-high advisories on both client and server.
    expect(wf).toMatch(/npm audit --audit-level=high/);
    // Runs inside a Docker container image for prod parity.
    expect(wf).toMatch(/image:\s*node:20/);
  });

  it('runs one static policy over server, client, and Playwright roots', () => {
    const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8');
    expect(workflow.match(/run-skip-policy\.ts/g)).toHaveLength(1);
    expect(workflow).toContain(
      'npx tsx src/scripts/run-skip-policy.ts src ../client/src ../client/e2e',
    );
  });

  it('keeps Firecrawl credentials out of every committable project file', () => {
    const root = resolve(__dirname, '../..');
    const example = readFileSync(resolve(root, '.env.example'), 'utf8');
    const compose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');
    expect(example).toMatch(/^FIRECRAWL_FALLBACK_API_KEYS=$/m);
    expect(example).toMatch(/^FIRECRAWL_WEBHOOK_SECRET_BINDINGS=$/m);
    expect(
      compose.match(/^\s+FIRECRAWL_WEBHOOK_SECRET_BINDINGS:/gm),
      'api and worker must receive the same explicit webhook bindings',
    ).toHaveLength(2);

    // Include tracked files and new files that would be picked up by a normal
    // commit, while letting .gitignore exclude the local root .env and build
    // artifacts. Splitting the token prefix keeps this guard from matching
    // its own source.
    const files = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: root, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
    const firecrawlToken = new RegExp('\\b' + 'fc-' + '[0-9a-fA-F]{24,}\\b');
    for (const file of files) {
      const path = resolve(root, file);
      // `git ls-files --cached` includes a tracked path deleted by the current
      // worktree diff. A path that no longer exists has no bytes to scan; new
      // replacement files are still included by `--others` above.
      if (existsSync(path) && lstatSync(path).isFile()) {
        expect(readFileSync(path, 'utf8'), file).not.toMatch(firecrawlToken);
      }
    }
  });

  it('compose declares healthchecks for all six required services', () => {
    const compose = readFileSync(resolve(__dirname, '../../docker-compose.yml'), 'utf8');
    for (const service of ['mongo', 'redis', 'postgres', 'api', 'worker', 'web']) {
      const serviceBlock = new RegExp(`^  ${service}:\\n(?:(?!^  [a-z]).)*?^    healthcheck:`, 'ms');
      expect(compose, `${service} must declare a healthcheck`).toMatch(serviceBlock);
    }
  });
});
