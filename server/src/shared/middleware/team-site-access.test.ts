import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DICTIONARIES } from '../i18n/index.js';
import { errorHandler } from './error-handler.js';
import {
  allowedTeamSiteIds,
  assertTeamSiteAccess,
  requireTeamResourceSiteAccess,
  requireTeamSiteAccess,
} from './team-site-access.js';

const SITE_A = '507f1f77bcf86cd799439011';
const SITE_B = '507f1f77bcf86cd799439012';

const withScope = (
  role: 'owner' | 'admin' | 'member' | undefined,
  mode?: 'all' | 'selected',
  ids: readonly string[] = [],
): RequestHandler => (req, _res, next) => {
  req.teamRole = role;
  req.teamSiteAccessMode = mode;
  if (mode === 'selected') req.teamSiteIds = new Set(ids);
  next();
};

function probe(guard: RequestHandler, scope: RequestHandler) {
  const app = express();
  app.use(scope);
  app.get(
    '/:siteId',
    guard,
    (req, res) => res.json({ allowed: allowedTeamSiteIds(req) }),
  );
  app.use(errorHandler);
  return app;
}

function resourceProbe(guard: RequestHandler, scope: RequestHandler) {
  const app = express();
  app.use(scope);
  app.get('/resource', guard, (_req, res) => res.json({ allowed: true }));
  app.use(errorHandler);
  return app;
}

describe('team site access', () => {
  it.each([
    ['owner', 'owner', 'selected'],
    ['all-scoped member', 'member', 'all'],
    ['route outside workspaceContext', undefined, undefined],
  ] as const)('%s is unrestricted', async (_label, role, mode) => {
    const app = probe(
      requireTeamSiteAccess((req) => req.params.siteId),
      withScope(role, mode, []),
    );
    const res = await request(app).get(`/${SITE_B}`);
    expect(res.status).toBe(200);
    expect(res.body.allowed).toBeNull();
  });

  it('passes and exposes the exact selected grant set', async () => {
    const app = probe(
      requireTeamSiteAccess((req) => req.params.siteId),
      withScope('member', 'selected', [SITE_A]),
    );
    const res = await request(app).get(`/${SITE_A}`);
    expect(res.status).toBe(200);
    expect(res.body.allowed).toEqual([SITE_A]);
  });

  it('hides an unassigned site behind the ordinary 404', async () => {
    const app = probe(
      requireTeamSiteAccess((req) => req.params.siteId),
      withScope('admin', 'selected', [SITE_A]),
    );
    const res = await request(app).get(`/${SITE_B}`);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(DICTIONARIES.en.sites.errors.notFound);
  });

  it('fails closed when a foreign workspace actor has no resolved scope', () => {
    const req = { teamRole: 'member' } as express.Request;
    expect(allowedTeamSiteIds(req)).toEqual([]);
    expect(() => assertTeamSiteAccess(req, SITE_A)).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });

  it('treats a selected scope with no grant set as empty', () => {
    const req = {
      teamRole: 'member',
      teamSiteAccessMode: 'selected',
    } as express.Request;
    expect(allowedTeamSiteIds(req)).toEqual([]);
  });

  it('leaves malformed ids to the downstream route schema', async () => {
    const app = probe(
      requireTeamSiteAccess((req) => req.params.siteId),
      withScope('member', 'selected', []),
    );
    expect((await request(app).get('/not-an-object-id')).status).toBe(200);
  });

  it.each([
    ['route outside workspaceContext', undefined, undefined],
    ['workspace owner', 'owner', 'selected'],
    ['all-scoped member', 'member', 'all'],
  ] as const)('does not resolve resource ownership for an unrestricted %s', async (
    _label,
    role,
    mode,
  ) => {
    const app = resourceProbe(
      requireTeamResourceSiteAccess(() => {
        throw new Error('resolver must not run');
      }),
      withScope(role, mode),
    );
    expect((await request(app).get('/resource')).status).toBe(200);
  });

  it('passes missing and granted selected-scope resources downstream', async () => {
    const scope = withScope('member', 'selected', [SITE_A]);
    const missing = resourceProbe(
      requireTeamResourceSiteAccess(() => undefined),
      scope,
    );
    expect((await request(missing).get('/resource')).status).toBe(200);

    const granted = resourceProbe(
      requireTeamResourceSiteAccess(() => SITE_A),
      scope,
    );
    expect((await request(granted).get('/resource')).status).toBe(200);
  });

  it('hides account-wide and denied selected-scope resources', async () => {
    const scope = withScope('member', 'selected', [SITE_A]);
    const accountWide = resourceProbe(
      requireTeamResourceSiteAccess(() => null),
      scope,
    );
    const accountWideResponse = await request(accountWide).get('/resource');
    expect(accountWideResponse.status).toBe(404);
    expect(accountWideResponse.body.error.message).toBe(
      DICTIONARIES.en.errors.notFound,
    );

    const denied = resourceProbe(
      requireTeamResourceSiteAccess(() => SITE_B, 'sites.errors.notFound'),
      scope,
    );
    const deniedResponse = await request(denied).get('/resource');
    expect(deniedResponse.status).toBe(404);
    expect(deniedResponse.body.error.message).toBe(
      DICTIONARIES.en.sites.errors.notFound,
    );
  });
});
