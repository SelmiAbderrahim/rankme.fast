import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { issueCsrfToken, requireCsrf } from './csrf.js';
import { errorHandler } from './error-handler.js';

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.get('/csrf', issueCsrfToken);
  app.post('/mutate', requireCsrf, (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe('requireCsrf', () => {
  it('allows safe methods without a token', async () => {
    const app = buildApp();
    app.get('/read', requireCsrf, (_req, res) => {
      res.json({ ok: true });
    });
    const res = await request(app).get('/read');
    expect(res.status).toBe(200);
  });

  it('rejects a mutating request without a token', async () => {
    const res = await request(buildApp()).post('/mutate').send({});
    expect(res.status).toBe(403);
  });

  it('rejects a mutating request with mismatched cookie / header', async () => {
    const res = await request(buildApp())
      .post('/mutate')
      .set('Cookie', 'x-csrf-token=aaa')
      .set('x-csrf-token', 'bbb')
      .send({});
    expect(res.status).toBe(403);
  });

  it('accepts a matching double-submit token', async () => {
    const app = buildApp();
    const csrf = await request(app).get('/csrf');
    const token = csrf.body.csrfToken as string;
    const res = await request(app)
      .post('/mutate')
      .set('Cookie', `x-csrf-token=${token}`)
      .set('x-csrf-token', token)
      .send({});
    expect(res.status).toBe(200);
  });

  it('issues a non-Secure cookie on a plain-HTTP request (self-host parity)', async () => {
    // A plain-HTTP deployment (or loopback e2e stack) must receive a cookie
    // the client is allowed to send back — a Secure cookie over http is
    // stored-but-never-returned by RFC 6265 clients, which would 403 every
    // cookie-session mutation.
    const res = await request(buildApp()).get('/csrf');
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toContain('x-csrf-token=');
    expect(setCookie).not.toMatch(/;\s*Secure/i);
  });

  it('issues a Secure cookie when the request arrived over TLS (proxy-forwarded)', async () => {
    // Production topology: TLS terminates upstream and the trusted hop
    // forwards X-Forwarded-Proto — `trust proxy` makes req.secure true.
    const app = buildApp();
    app.set('trust proxy', 1);
    const res = await request(app).get('/csrf').set('X-Forwarded-Proto', 'https');
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toMatch(/;\s*Secure/i);
  });

  it('exempts a well-formed public-API bearer key (Bearer rmf_…)', async () => {
    const res = await request(buildApp())
      .post('/mutate')
      .set('Authorization', 'Bearer rmf_abc123DEF-_')
      .send({});
    expect(res.status).toBe(200);
  });

  it('does NOT exempt a non-bearer Authorization header (no CSRF bypass)', async () => {
    // Regression guard: a forged/garbage Authorization value must not disable
    // the cookie CSRF check. Only the `Bearer rmf_…` api-key shape is exempt.
    const res = await request(buildApp())
      .post('/mutate')
      .set('Authorization', 'JWT some-token')
      .send({});
    expect(res.status).toBe(403);
  });

  it('does NOT exempt a Bearer token that is not an api-key (wrong prefix)', async () => {
    const res = await request(buildApp())
      .post('/mutate')
      .set('Authorization', 'Bearer not-an-api-key')
      .send({});
    expect(res.status).toBe(403);
  });
});
