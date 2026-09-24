import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createPagesRouter } from './pages.routes.js';
import { PagesError, type PagesService } from './pages.service.js';
import { translate } from '../../shared/i18n/index.js';

const SITE = '507f1f77bcf86cd799439012';
const PAGE = 'a'.repeat(43);

function service(overrides: Partial<PagesService> = {}): PagesService {
  return {
    list: vi.fn().mockResolvedValue({ kind: 'list' }),
    detail: vi.fn().mockResolvedValue({ kind: 'detail' }),
    refresh: vi.fn().mockResolvedValue({ kind: 'refresh' }),
    ...overrides,
  };
}

function appFor(mock: PagesService, rateLimit = false, translate = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'actor', email: 'actor@example.com', emailVerified: true } as never;
    req.workspaceAccountId = 'workspace';
    if (translate) req.t = (key) => `translated:${key}`;
    next();
  });
  app.use('/api/sites/:siteId/pages', createPagesRouter({ service: mock, rateLimit }));
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: 'next' }));
  return app;
}

describe('Pages routes and controller', () => {
  it('validates and dispatches list, detail, and empty-body refresh with workspace account scope', async () => {
    const mock = service();
    await request(appFor(mock)).get(`/api/sites/${SITE}/pages?range=7d&limit=50&sort=url&direction=asc&q=alpha`).expect(200, { kind: 'list' });
    expect(mock.list).toHaveBeenCalledWith('workspace', SITE, expect.objectContaining({ range: '7d', limit: 50, sort: 'url', direction: 'asc', q: 'alpha' }));
    await request(appFor(mock)).get(`/api/sites/${SITE}/pages/${PAGE}?range=90d`).expect(200, { kind: 'detail' });
    expect(mock.detail).toHaveBeenCalledWith('workspace', SITE, PAGE, '90d');
    await request(appFor(mock)).post(`/api/sites/${SITE}/pages/refresh`).send({}).expect(200, { kind: 'refresh' });
    await request(appFor(mock)).post(`/api/sites/${SITE}/pages/refresh`).expect(200, { kind: 'refresh' });
    expect(mock.refresh).toHaveBeenCalledWith('workspace', SITE);
  });

  it.each([
    [`/api/sites/not-an-id/pages`, 'get'],
    [`/api/sites/${SITE}/pages?range=6d`, 'get'],
    [`/api/sites/${SITE}/pages?q=`, 'get'],
    [`/api/sites/${SITE}/pages?limit=26`, 'get'],
    [`/api/sites/${SITE}/pages?unknown=true`, 'get'],
    [`/api/sites/${SITE}/pages/short`, 'get'],
    [`/api/sites/${SITE}/pages/refresh`, 'post'],
  ] as const)('returns the localized bounded request error for %s', async (url, method) => {
    const call = request(appFor(service()))[method](url);
    if (method === 'post') call.send({ source: 'tampered' });
    const response = await call.expect(400);
    expect(response.body.error).toMatchObject({
      code: 'PAGES_INVALID_REQUEST',
      messageKey: 'pages.errors.invalidRequest',
      message: translate('en', 'pages.errors.invalidRequest'),
    });
  });

  it('serializes stable Pages errors with optional safe details and stale state', async () => {
    const state = { envelope: { status: 'stale' } } as never;
    const mock = service({ list: vi.fn().mockRejectedValue(new PagesError(400, 'PAGES_INVALID_CURSOR', 'pages.errors.invalidCursor', { field: 'cursor' }, state)) });
    const response = await request(appFor(mock)).get(`/api/sites/${SITE}/pages`).expect(400);
    expect(response.body).toEqual({
      error: {
        code: 'PAGES_INVALID_CURSOR',
        messageKey: 'pages.errors.invalidCursor',
        message: translate('en', 'pages.errors.invalidCursor'),
        details: { field: 'cursor' },
      },
      state,
    });
    expect(response.headers['content-language']).toBe('en');
  });

  it('falls back to the stable message key and omits absent error metadata', async () => {
    const mock = service({ list: vi.fn().mockRejectedValue(new PagesError(404, 'PAGES_SITE_NOT_FOUND', 'pages.errors.siteNotFound')) });
    const response = await request(appFor(mock, false, false)).get(`/api/sites/${SITE}/pages`).expect(404);
    expect(response.body).toEqual({
      error: {
        code: 'PAGES_SITE_NOT_FOUND',
        messageKey: 'pages.errors.siteNotFound',
        message: translate('en', 'pages.errors.siteNotFound'),
      },
    });
  });

  it('sends unknown errors onward', async () => {
    const broken = service({ detail: vi.fn().mockRejectedValue(new Error('boom')) });
    await request(appFor(broken)).get(`/api/sites/${SITE}/pages/${PAGE}`).expect(500, { error: 'next' });
  });

  it('uses the localized product-route limiter for bounded reads', async () => {
    const app = appFor(service(), true);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await request(app).get(`/api/sites/${SITE}/pages`).expect(200);
    }
    const limited = await request(app).get(`/api/sites/${SITE}/pages`).expect(429);
    expect(limited.body.error).toEqual({
      code: 'PAGES_RATE_LIMITED',
      messageKey: 'pages.errors.rateLimited',
      message: translate('en', 'pages.errors.rateLimited'),
    });
  });
});
