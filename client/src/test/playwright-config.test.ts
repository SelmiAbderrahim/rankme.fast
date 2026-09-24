import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const configPath = resolve(__dirname, '../../playwright.config.ts');

describe('Playwright release policy', () => {
  it('uses zero retries in every environment and retains failure artifacts', () => {
    const config = readFileSync(configPath, 'utf8');
    expect(config).toMatch(/retries:\s*0/);
    expect(config).not.toContain('process.env.CI ? 2 : 0');
    expect(config).not.toContain('on-first-retry');
    expect(config).toContain("trace: 'retain-on-failure'");
    expect(config).toContain("video: 'retain-on-failure'");
    expect(config).toContain("screenshot: 'only-on-failure'");
  });

  it('keeps CI forbidOnly and every configured project', () => {
    const config = readFileSync(configPath, 'utf8');
    expect(config).toContain('forbidOnly: !!process.env.CI');
    for (const project of [
      'smoke',
      'locale-ar',
      'row-menu',
      'a11y',
      'cwv',
      'ssr-hardening',
      'competitors-gap-smoke',
      'security-smoke',
    ]) {
      expect(config).toContain(`name: '${project}'`);
    }
  });

  it('enrolls every spec file under e2e/ in exactly one project', () => {
    const config = readFileSync(configPath, 'utf8');
    // Extract `testMatch: /<base>\.spec\.ts/` regex sources; each project
    // block declares exactly one file base. If this misses a project the
    // orphan-spec assertion below will fail with the missing base name.
    // Each project block declares one testMatch of the form
    // `testMatch: /(?:^|\/)<base>\.spec\.ts$/` (or the older
    // `testMatch: /<base>\.spec\.ts/`). Non-greedy match up to the
    // `\.spec\.ts` literal so both shapes surface the same `<base>`.
    const matches = [...config.matchAll(/testMatch:.*?([\w-]+)\\\.spec\\\.ts/g)];
    const specMatchers = matches.map((m) => m[1]);
    // Every spec on disk MUST match one testMatch — no orphan specs
    // silently skipped in CI. If this fails after adding a new spec, add
    // a corresponding project block in playwright.config.ts.
    const specs = readdirSync(resolve(__dirname, '../../e2e'))
      .filter((file) => file.endsWith('.spec.ts'))
      .map((file) => file.replace(/\.spec\.ts$/, ''));
    for (const specBase of specs) {
      expect(specMatchers, `orphan spec ${specBase}.spec.ts`).toContain(specBase);
    }
  });
});
