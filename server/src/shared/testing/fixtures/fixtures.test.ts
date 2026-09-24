import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { redactFixture } from '../../../scripts/redact-fixture.js';
import {
  FIXTURE_SECRET_PATTERNS,
  lintAllFixtures,
  lintFixtureText,
  listFixtureFiles,
} from './fixture-lint.js';
import { FIXTURES_ROOT, loadFixture } from './load.js';
import { mockVendor, vendorMockServer } from './mock-vendor.js';

describe('loadFixture', () => {
  it('loads a plain recorded body with a default 200 status', () => {
    const fixture = loadFixture('dataforseo-serp', 'task-get', 'success');
    expect(fixture.timeout).toBe(false);
    expect(fixture.status).toBe(200);
    expect(fixture.body).toMatchObject({ status_code: 20000 });
  });

  it('reads a meta sidecar for non-200 cases', () => {
    const fixture = loadFixture('dataforseo-serp', 'task-get', 'unavailable');
    expect(fixture.status).toBe(503);
    expect(fixture.body).toEqual({ message: 'upstream gateway error' });
  });

  it('treats a meta-only timeout marker as a hang instruction', () => {
    expect(loadFixture('dataforseo-serp', 'task-get', 'timeout')).toEqual({
      timeout: true,
      status: 0,
      body: null,
    });
  });

  it('throws when the fixture case does not exist', () => {
    expect(() => loadFixture('dataforseo-serp', 'task-get', 'no-such-case')).toThrow();
  });
});

describe('mockVendor', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('serves the recorded body for any outbound request', async () => {
    mockVendor('dataforseo-serp', 'task-get', 'success');
    const res = await fetch('https://anything.test/v3/whatever', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status_code: 20000 });
  });

  it('serves the meta status for non-200 cases', async () => {
    mockVendor('dataforseo-serp', 'task-get', 'unavailable');
    const res = await fetch('https://anything.test/v3/whatever');
    expect(res.status).toBe(503);
  });

  it('hangs past the client timeout for the timeout case', async () => {
    mockVendor('dataforseo-serp', 'task-get', 'timeout');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30);
    await expect(
      fetch('https://anything.test/v3/whatever', { signal: controller.signal }),
    ).rejects.toThrow();
    clearTimeout(timer);
  });
});

describe('fixture lint', () => {
  it('every committed fixture is free of credentials, emails, and key patterns', () => {
    expect(listFixtureFiles().length).toBeGreaterThanOrEqual(9);
    expect(lintAllFixtures()).toEqual([]);
  });

  it('detects each banned pattern', () => {
    expect(lintFixtureText('{"authorization":"x"}')).toContain('authorization header');
    expect(lintFixtureText('{"contact":"ops@vendor.example"}')).toContain('email address');
    expect(lintFixtureText('{"h":"Basic dXNlcjpwYXNz"}')).toContain('basic/bearer token');
    expect(lintFixtureText('{"k":"sk-live-abcdef0123456789abcd"}')).toContain(
      'stripe-style api key',
    );
    expect(lintFixtureText('{"k":"AKIAIOSFODNN7EXAMPLE"}')).toContain('aws access key');
    expect(lintFixtureText(`{"k":"AIza${'0'.repeat(35)}"}`)).toContain('google api key');
    expect(lintFixtureText(`{"k":"fc-${'a'.repeat(20)}"}`)).toContain('firecrawl api key');
    expect(lintFixtureText('{"cookie":"session=value"}')).toContain('cookie material');
    expect(lintFixtureText('{"text":"customer prose"}')).toContain('customer prose marker');
    expect(lintFixtureText('{"status_code":20000}')).toEqual([]);
    expect(FIXTURE_SECRET_PATTERNS).toHaveLength(9);
  });

  it('domain-comparison fixtures contain no unredacted DataForSEO task ids', () => {
    const directory = join(
      FIXTURES_ROOT,
      'dataforseo-labs-competitors',
      'domain-comparison',
    );
    const rawTaskId = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
    for (const file of listFixtureFiles(directory)) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(rawTaskId);
      expect(lintFixtureText(text), file).toEqual([]);
    }
  });

  it('fails on a planted credential in a fixture tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixture-lint-'));
    try {
      writeFileSync(join(dir, 'ignored.txt'), 'authorization: Basic dXNlcjpwYXNz');
      writeFileSync(
        join(dir, 'planted.json'),
        '{"authorization":"Basic dXNlcjpwYXNz","contact":"leak@vendor.example"}',
      );
      expect(lintAllFixtures(dir)).toEqual([
        {
          file: join(dir, 'planted.json'),
          violations: ['authorization header', 'email address', 'basic/bearer token'],
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the fixtures root resolves inside the testing tree', () => {
    expect(FIXTURES_ROOT).toContain(join('shared', 'testing', 'fixtures'));
  });
});

describe('redactFixture', () => {
  it('strips seeded secrets, normalizes task ids, and counts redactions', () => {
    const recorded = {
      login: 'dfs-user',
      password: 'hunter2',
      authorization: 'Basic dXNlcjpwYXNz',
      api_key: 'sk-live-abcdef0123456789abcd',
      tasks: [
        {
          id: '01021545-1535-0066-0000-eda45180c467',
          status_code: 20000,
          data: { contact: 'owner@vendor.example writes back', keyword: 'seo audit tool' },
          result: ['plain string', 42, true, null],
        },
      ],
      nested: { refresh_token: 'r-token-value' },
    };
    const { redacted, redactions } = redactFixture(recorded);
    expect(redacted).toEqual({
      tasks: [
        {
          id: 'TASK_ID',
          status_code: 20000,
          data: { contact: 'REDACTED_EMAIL writes back', keyword: 'seo audit tool' },
          result: ['plain string', 42, true, null],
        },
      ],
      nested: {},
    });
    expect(redactions).toBe(7);
    // The redacted output itself passes the committed-fixture lint.
    expect(lintFixtureText(JSON.stringify(redacted))).toEqual([]);
  });

  it('leaves non-task ids and secret-free payloads untouched', () => {
    const { redacted, redactions } = redactFixture({
      id: 'not-a-task-id',
      count: 3,
      note: 'nothing secret here',
    });
    expect(redacted).toEqual({ id: 'not-a-task-id', count: 3, note: 'nothing secret here' });
    expect(redactions).toBe(0);
  });

  it('handles top-level arrays and scalars', () => {
    expect(redactFixture([{ password: 'x' }]).redactions).toBe(1);
    expect(
      redactFixture({
        apiKeys: ['one'],
        fallbackApiKeys: ['two'],
        FIRECRAWL_FALLBACK_API_KEYS: ['three'],
        keywords: ['safe-keyword'],
        keywordList: ['safe-list'],
      }).redacted,
    ).toEqual({ keywords: ['safe-keyword'], keywordList: ['safe-list'] });
    expect(redactFixture('owner@vendor.example').redacted).toBe('REDACTED_EMAIL');
    expect(redactFixture(7).redacted).toBe(7);
  });
});
