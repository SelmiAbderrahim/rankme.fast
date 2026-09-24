import { afterEach, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import { accessLogRequestSerializer, redactAccessLogUrl } from './access-log.js';
import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { env } from './env.js';
import {
  BATCH_CONTENT_FIELDS,
  BATCH_SECRET_NAMES,
  REDACTION_PATHS,
  BRAND_RADAR_CONTENT_FIELDS,
  REVIEW_CONTENT_FIELDS,
} from './logger.js';

/**
 * Security regression: every credential, session token, API key, and vendor
 * secret that can appear in a structured log line MUST be redacted to
 * `[redacted]`. This test is the machine-checked guard for the redaction
 * list in `config/logger.ts` — adding a new secret without adding it to
 * REDACTION_PATHS fails loudly.
 */

function captureLogger() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const log = pino(
    { level: 'info', redact: { paths: [...REDACTION_PATHS], censor: '[redacted]' } },
    stream,
  );
  return {
    log,
    output: () => chunks.join(''),
  };
}

describe('pino redaction — security-critical secrets', () => {
  it('censors OAuth token columns in camelCase and database snake_case', () => {
    const cap = captureLogger();
    const sentinels = {
      accessToken: 'oauth-access-camel',
      refreshToken: 'oauth-refresh-camel',
      idToken: 'oauth-id-camel',
      access_token: 'oauth-access-snake',
      refresh_token: 'oauth-refresh-snake',
      id_token: 'oauth-id-snake',
      encryptedRefreshToken: 'oauth-encrypted-refresh-camel',
      encrypted_refresh_token: 'oauth-encrypted-refresh-snake',
    };
    cap.log.info({ ...sentinels, row: sentinels }, 'oauth-token-redaction');
    const output = cap.output();
    for (const [name, sentinel] of Object.entries(sentinels)) {
      expect(REDACTION_PATHS).toContain(name);
      expect(REDACTION_PATHS).toContain(`*.${name}`);
      expect(output).not.toContain(sentinel);
    }
    expect(output).toContain('[redacted]');
  });

  it('enumerates both path forms and censors every intelligence-batch secret', () => {
    const cap = captureLogger();
    const topLevel = Object.fromEntries(BATCH_SECRET_NAMES.map((name) => [name, `${name}-value`]));
    const nested = Object.fromEntries(BATCH_SECRET_NAMES.map((name) => [name, `${name}-nested`]));
    cap.log.info({ ...topLevel, nested }, 'batch-secrets');
    const output = cap.output();
    for (const name of BATCH_SECRET_NAMES) {
      expect(REDACTION_PATHS).toContain(name);
      expect(REDACTION_PATHS).toContain(`*.${name}`);
      expect(output).not.toContain(`${name}-value`);
      expect(output).not.toContain(`${name}-nested`);
    }
    expect(output).toContain('[redacted]');
  });

  it('censors every intelligence-batch user-content field', () => {
    const cap = captureLogger();
    cap.log.info(
      { nested: Object.fromEntries(BATCH_CONTENT_FIELDS.map((name) => [name, `${name}-content`])) },
      'content',
    );
    const output = cap.output();
    for (const name of BATCH_CONTENT_FIELDS) {
      expect(REDACTION_PATHS).toContain(name);
      expect(REDACTION_PATHS).toContain(`*.${name}`);
      expect(output).not.toContain(`${name}-content`);
    }
  });

  it('censors Firecrawl credential arrays and derived affinity references', () => {
    const cap = captureLogger();
    cap.log.info(
      {
        apiKeys: ['primary-array-sentinel'],
        pool: {
          credentials: [
            {
              apiKey: 'deep-api-key-sentinel',
              credentialRef: 'deep-credential-ref-sentinel',
              providerCredentialRef: 'deep-provider-ref-sentinel',
            },
          ],
        },
        config: { firecrawl: { fallbackApiKeys: ['fallback-array-sentinel'] } },
        result: {
          credential: {
            credentialRef: 'wrapped-credential-ref-sentinel',
            providerCredentialRef: 'wrapped-provider-ref-sentinel',
          },
        },
        opts: {
          firecrawl: {
            apiKey: 'wrapped-api-key-sentinel',
            fallbackApiKeys: ['wrapped-fallback-array-sentinel'],
          },
        },
        batch: [
          {
            apiKey: 'arbitrary-array-api-key-sentinel',
            credentialRef: 'arbitrary-array-credential-ref-sentinel',
            providerCredentialRef: 'arbitrary-array-provider-ref-sentinel',
          },
        ],
      },
      'firecrawl-pool',
    );
    const output = cap.output();
    expect(output).not.toContain('primary-array-sentinel');
    expect(output).not.toContain('fallback-array-sentinel');
    expect(output).not.toContain('deep-api-key-sentinel');
    expect(output).not.toContain('deep-credential-ref-sentinel');
    expect(output).not.toContain('deep-provider-ref-sentinel');
    expect(output).not.toContain('wrapped-credential-ref-sentinel');
    expect(output).not.toContain('wrapped-provider-ref-sentinel');
    expect(output).not.toContain('wrapped-api-key-sentinel');
    expect(output).not.toContain('wrapped-fallback-array-sentinel');
    expect(output).not.toContain('arbitrary-array-api-key-sentinel');
    expect(output).not.toContain('arbitrary-array-credential-ref-sentinel');
    expect(output).not.toContain('arbitrary-array-provider-ref-sentinel');
    expect(output.match(/\[redacted\]/g)?.length).toBeGreaterThanOrEqual(11);
  });

  it('censors scalar and parsed-array webhook secrets, including credential bindings', () => {
    const cap = captureLogger();
    const sentinels = [
      'firecrawl-scalar-sentinel',
      'firecrawl-array-sentinel',
      'firecrawl-binding-sentinel',
      'detached-binding-sentinel',
    ];
    cap.log.info(
      {
        env: {
          FIRECRAWL_WEBHOOK_SECRET: sentinels[0],
          FIRECRAWL_WEBHOOK_SECRETS: [sentinels[1]],
          FIRECRAWL_WEBHOOK_SECRET_BINDINGS: [
            { credential: 'primary', secrets: [sentinels[2]] },
          ],
        },
        bindings: [{ credentialRef: 'safe-ref', secrets: [sentinels[3]] }],
      },
      'webhook-config',
    );
    const output = cap.output();
    for (const sentinel of sentinels) expect(output).not.toContain(sentinel);
    expect(output).toContain('[redacted]');
  });

  it('censors client-portal credentials and re-encoded branding payloads', () => {
    const cap = captureLogger();
    const sentinels = [
      'raw-portal-token',
      'portal-token-alias',
      'stored-token-hash',
      'request-path-token',
      'logo-data-url',
      'logo-png-base64',
      'attachment-base64',
    ];
    cap.log.info(
      {
        token: sentinels[0],
        portalToken: sentinels[1],
        tokenHash: sentinels[2],
        req: { params: { token: sentinels[3] } },
        branding: {
          logoDataUrl: sentinels[4],
          logoPngBase64: sentinels[5],
        },
        attachment: { contentBase64: sentinels[6] },
        accountId: 'safe-account-id',
      },
      'client-report-secrets',
    );
    const output = cap.output();
    for (const sentinel of sentinels) expect(output).not.toContain(sentinel);
    expect(output).toContain('safe-account-id');
    expect(output.match(/\[redacted\]/g)?.length).toBeGreaterThanOrEqual(sentinels.length);
  });

  it('censors every Review Intelligence content field at BOTH positions (spec 06e)', () => {
    const cap = captureLogger();
    const topLevel = Object.fromEntries(
      REVIEW_CONTENT_FIELDS.map((name) => [name, `${name}-top-value`]),
    );
    const nested = Object.fromEntries(
      REVIEW_CONTENT_FIELDS.map((name) => [name, `${name}-nested-value`]),
    );
    cap.log.info({ ...topLevel, row: nested }, 'review-content');
    const output = cap.output();
    for (const name of REVIEW_CONTENT_FIELDS) {
      expect(REDACTION_PATHS).toContain(name);
      expect(REDACTION_PATHS).toContain(`*.${name}`);
      expect(output).not.toContain(`${name}-top-value`);
      expect(output).not.toContain(`${name}-nested-value`);
    }
    expect(output).toContain('[redacted]');
  });

  it('censors persisted review rows and nested AI citation envelopes', () => {
    const cap = captureLogger();
    const sentinels = [
      'reviews-text',
      'reviews-title',
      'reviews-author',
      'rows-text',
      'input-review-text',
      'payload-row-title',
      'direct-citation-excerpt',
      'theme-citation-excerpt',
    ];
    cap.log.info(
      {
        accountId: 'account-safe',
        reviews: [
          {
            text: sentinels[0],
            title: sentinels[1],
            authorDisplayName: sentinels[2],
          },
        ],
        rows: [{ text: sentinels[3] }],
        input: { reviews: [{ text: sentinels[4] }] },
        payload: { rows: [{ title: sentinels[5] }] },
        citations: [{ excerpt: sentinels[6] }],
        themes: [{ citations: [{ excerpt: sentinels[7] }] }],
      },
      'structured-review-content',
    );
    const output = cap.output();
    for (const sentinel of sentinels) expect(output).not.toContain(sentinel);
    expect(output).toContain('account-safe');
    expect(output.match(/\[redacted\]/g)?.length).toBeGreaterThanOrEqual(sentinels.length);
  });

  it('censors every Brand Radar content field at BOTH positions (spec 07a-1)', () => {
    const cap = captureLogger();
    const topLevel = Object.fromEntries(
      BRAND_RADAR_CONTENT_FIELDS.map((name) => [name, `${name}-top-value`]),
    );
    const nested = Object.fromEntries(
      BRAND_RADAR_CONTENT_FIELDS.map((name) => [name, `${name}-nested-value`]),
    );
    cap.log.info({ ...topLevel, scan: nested }, 'brand-radar-content');
    const output = cap.output();
    for (const name of BRAND_RADAR_CONTENT_FIELDS) {
      expect(REDACTION_PATHS).toContain(name);
      expect(REDACTION_PATHS).toContain(`*.${name}`);
      expect(output).not.toContain(`${name}-top-value`);
      expect(output).not.toContain(`${name}-nested-value`);
    }
    expect(output).toContain('[redacted]');
  });

  it('redacts a top-level authorization header', () => {
    const cap = captureLogger();
    cap.log.info({ authorization: 'Bearer rmf_secret123' }, 'req');
    expect(cap.output()).toContain('[redacted]');
    expect(cap.output()).not.toContain('rmf_secret123');
  });

  it('redacts nested req.headers.authorization', () => {
    const cap = captureLogger();
    cap.log.info({ req: { headers: { authorization: 'Bearer rmf_xyz' } } }, 'req');
    expect(cap.output()).toContain('[redacted]');
    expect(cap.output()).not.toContain('rmf_xyz');
  });

  it('redacts cookies / session tokens', () => {
    const cap = captureLogger();
    cap.log.info({ cookie: 'better-auth.session_token=abc123' }, 'req');
    expect(cap.output()).toContain('[redacted]');
    expect(cap.output()).not.toContain('abc123');
  });

  it('redacts refresh tokens', () => {
    const cap = captureLogger();
    cap.log.info({ refreshToken: '1//secret-refresh-token' }, 'gsc');
    expect(cap.output()).toContain('[redacted]');
    expect(cap.output()).not.toContain('secret-refresh-token');
  });

  it('redacts env-carried vendor secrets at the top level', () => {
    const cap = captureLogger();
    cap.log.info(
      {
        ANTHROPIC_API_KEY: 'sk-ant-key',
        DATAFORSEO_PASSWORD: 'dfs_pass',
        MASTER_ENCRYPTION_KEY: 'hexkey',
      },
      'boot',
    );
    const out = cap.output();
    expect(out).not.toContain('sk-ant-key');
    expect(out).not.toContain('dfs_pass');
    expect(out).not.toContain('hexkey');
  });

  it('redacts nested env secrets (e.g. { env: { ... } })', () => {
    const cap = captureLogger();
    cap.log.info(
      { env: { ANTHROPIC_API_KEY: 'sk-nested', FIRECRAWL_WEBHOOK_SECRET: 'whsec_nest' } },
      'boot',
    );
    const out = cap.output();
    expect(out).not.toContain('sk-nested');
    expect(out).not.toContain('whsec_nest');
  });

  it('redacts BETTER_AUTH_SECRET, DB connection strings, and Google API keys', () => {
    const cap = captureLogger();
    cap.log.info(
      {
        env: {
          BETTER_AUTH_SECRET: 'ba-signing-secret',
          MONGODB_URI: 'mongodb://user:mongopass@mongo:27017/rankme',
          DATABASE_URL: 'postgres://rankme:pgpass@postgres:5432/rankme',
          GOOGLE_API_KEY: 'AIza-google-key',
        },
      },
      'boot',
    );
    const out = cap.output();
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('ba-signing-secret');
    // DB credentials embedded in the URI must not leak.
    expect(out).not.toContain('mongopass');
    expect(out).not.toContain('pgpass');
    expect(out).not.toContain('AIza-google-key');
  });

  it('redacts BETTER_AUTH_SECRET at the top level', () => {
    const cap = captureLogger();
    cap.log.info({ BETTER_AUTH_SECRET: 'top-level-signing-secret' }, 'boot');
    const out = cap.output();
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('top-level-signing-secret');
  });

  it('redacts SUPERADMIN_PASSWORD', () => {
    const cap = captureLogger();
    cap.log.info({ SUPERADMIN_PASSWORD: 'super-secret-pass' }, 'seed');
    expect(cap.output()).toContain('[redacted]');
    expect(cap.output()).not.toContain('super-secret-pass');
  });

  it('still emits non-secret fields alongside redacted ones', () => {
    const cap = captureLogger();
    cap.log.info({ authorization: 'Bearer secret', accountId: 'acc-123' }, 'req');
    const out = cap.output();
    expect(out).toContain('[redacted]');
    expect(out).toContain('acc-123');
    expect(out).not.toContain('secret');
  });

  it('redacts nested req.headers["x-csrf-token"]', () => {
    const cap = captureLogger();
    cap.log.info({ req: { headers: { 'x-csrf-token': 'CSRFSECRET' } } }, 'req');
    const out = cap.output();
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('CSRFSECRET');
  });

  it('redacts nested req.headers["x-firecrawl-signature"]', () => {
    const cap = captureLogger();
    cap.log.info(
      { req: { headers: { 'x-firecrawl-signature': 'sha256=DEADBEEFSIG' } } },
      'req',
    );
    const out = cap.output();
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('DEADBEEFSIG');
  });

  it('redacts nested res.headers["set-cookie"] as a string', () => {
    const cap = captureLogger();
    cap.log.info(
      { res: { headers: { 'set-cookie': 'better-auth.session_token=SETSECRET; HttpOnly' } } },
      'res',
    );
    const out = cap.output();
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('SETSECRET');
  });

  it('redacts nested res.headers["set-cookie"] as an array', () => {
    const cap = captureLogger();
    cap.log.info(
      { res: { headers: { 'set-cookie': ['a=SETA', 'b=SETB'] } } },
      'res',
    );
    const out = cap.output();
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('SETA');
    expect(out).not.toContain('SETB');
  });
});

describe('pino-http integration — real request/response header shapes', () => {
  function build() {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const log = pino(
      { level: 'info', redact: { paths: [...REDACTION_PATHS], censor: '[redacted]' } },
      stream,
    );
    const app = express();
    app.use(pinoHttp({ logger: log, serializers: { req: accessLogRequestSerializer } }));
    app.get('/probe', (_req, res) => {
      res.setHeader('set-cookie', 'better-auth.session_token=SETSECRET; HttpOnly');
      res.json({ ok: true });
    });
    app.get('/probe-multi', (_req, res) => {
      res.setHeader('set-cookie', ['a=SETA; HttpOnly', 'b=SETB; HttpOnly']);
      res.json({ ok: true });
    });
    return { app, output: () => chunks.join('') };
  }

  it('redacts req.headers.cookie and authorization end-to-end through pino-http', async () => {
    const { app, output } = build();
    await request(app)
      .get('/probe')
      .set('Cookie', 'better-auth.session_token=SECRETCOOKIE')
      .set('Authorization', 'Bearer rmf_SECRETKEY');
    const out = output();
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('SECRETCOOKIE');
    expect(out).not.toContain('rmf_SECRETKEY');
  });

  it('redacts the x-csrf-token request header', async () => {
    const { app, output } = build();
    await request(app).get('/probe').set('x-csrf-token', 'CSRFSECRET');
    const out = output();
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('CSRFSECRET');
  });

  it('redacts res.headers["set-cookie"] on responses (single value)', async () => {
    const { app, output } = build();
    await request(app).get('/probe');
    const out = output();
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('SETSECRET');
  });

  it('redacts res.headers["set-cookie"] on responses (array value)', async () => {
    const { app, output } = build();
    await request(app).get('/probe-multi');
    const out = output();
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('SETA');
    expect(out).not.toContain('SETB');
  });

  it('still logs non-sensitive headers verbatim (user-agent survives)', async () => {
    const { app, output } = build();
    await request(app).get('/probe').set('user-agent', 'rankme-audit-probe/9.9');
    const out = output();
    expect(out).toContain('rankme-audit-probe/9.9');
  });

  it('redacts reusable client-portal credentials embedded in req.url', async () => {
    const { app, output } = build();
    const sentinel = 'PORTAL_BEARER_SENTINEL';
    await request(app).get(`/api/client-portal/${sentinel}?locale=en`);
    const out = output();
    expect(out).not.toContain(sentinel);
    expect(out).toContain('/api/client-portal/[redacted]?locale=en');
  });

  it('redacts token-bearing auth query parameters while retaining safe query data', async () => {
    const { app, output } = build();
    await request(app).get('/api/auth/verify-email?token=VERIFY_SENTINEL&locale=de');
    const out = output();
    expect(out).not.toContain('VERIFY_SENTINEL');
    expect(out).toContain('token=[redacted]');
    expect(out).toContain('locale=de');
  });
});

describe('access-log URL sanitizer', () => {
  it.each([
    ['/api/client-portal/PORTAL_SECRET?locale=en', '/api/client-portal/[redacted]?locale=en'],
    ['/api/team/invitations/preview/PREVIEW_SECRET', '/api/team/invitations/preview/[redacted]'],
    ['/api/team/accept/INVITE_SECRET', '/api/team/accept/[redacted]'],
    ['/api/team/reject/REJECT_SECRET', '/api/team/reject/[redacted]'],
    ['/api/auth/callback/google?code=CODE_SECRET&state=STATE_SECRET', '/api/auth/callback/google?code=[redacted]&state=[redacted]'],
    ['/api/auth/verify-email?to%6ben=ENCODED_SECRET&locale=fr', '/api/auth/verify-email?to%6ben=[redacted]&locale=fr'],
    ['/api/auth/verify-email?token%5B%5D=ARRAY_SECRET', '/api/auth/verify-email?token%5B%5D=[redacted]'],
  ])('sanitizes %s', (raw, expected) => {
    expect(redactAccessLogUrl(raw)).toBe(expected);
  });

  it('preserves non-string values and query fields that cannot name credentials', () => {
    const marker = { request: true };

    expect(redactAccessLogUrl(marker)).toBe(marker);
    expect(redactAccessLogUrl('/probe')).toBe('/probe');
    expect(
      redactAccessLogUrl('/probe?%E0%A4%A=secret&flag&locale=en#details'),
    ).toBe('/probe?%E0%A4%A=secret&flag&locale=en#details');
  });

  it('redacts both supported request URL fields without adding absent fields', () => {
    expect(accessLogRequestSerializer({ method: 'GET' })).toEqual({
      method: 'GET',
    });
    expect(
      accessLogRequestSerializer({
        method: 'POST',
        originalUrl: '/api/auth/callback/google?code=CODE_SECRET',
        url: '/api/client-portal/PORTAL_SECRET',
      }),
    ).toEqual({
      method: 'POST',
      originalUrl: '/api/auth/callback/google?code=[redacted]',
      url: '/api/client-portal/[redacted]',
    });
  });
});

describe('logger module — dev transport branch', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('./env.js');
  });

  it('loads a pino instance in development mode with the pretty transport branch', async () => {
    vi.resetModules();
    vi.doMock('./env.js', () => ({
      env: { NODE_ENV: 'development', LOG_LEVEL: 'info' },
    }));
    const mod = await import('./logger.js');
    expect(typeof mod.logger.info).toBe('function');
    expect(mod.REDACTION_PATHS).toContain('res.headers["set-cookie"]');
    expect(mod.REDACTION_PATHS).toContain('req.headers["x-csrf-token"]');
  });
});

describe('env smoke', () => {
  it('env loads with expected shape', () => {
    expect(typeof env.LOG_LEVEL).toBe('string');
  });
});
