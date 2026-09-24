/**
 * Team-role guards — `rankme-enterprise-orgs` 02.
 *
 * Two layers:
 *  1. Unit — the rank comparison and the DB-free header rejection.
 *  2. Router — every owner-only surface answers 404 (never 403) to an
 *     accepted ADMIN-role member carrying the owner's workspace header. Admin
 *     is used deliberately: it is the most privileged non-owner role, so a
 *     pass here would mean `member` passes too.
 */
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { teamMembers } from '../../db/schema/team-members.js';
import { setTeamDb } from '../../modules/team/team.holder.js';
import { Site } from '../../modules/sites/index.js';
import { DICTIONARIES } from '../i18n/index.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../testing/auth.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../testing/postgres.js';
import { errorHandler } from './error-handler.js';
import {
  rejectForeignWorkspace,
  requireTeamRole,
  requireWorkspaceOwner,
} from './require-team-role.js';
import { WORKSPACE_HEADER } from './workspace-context.js';

function guardApp(
  guard: express.RequestHandler,
  seed: express.RequestHandler,
): Express {
  const app = express();
  app.use(seed);
  app.use(guard);
  app.get('/probe', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

const withRole = (role: 'owner' | 'admin' | 'member' | undefined): express.RequestHandler =>
  (req, _res, next) => {
    req.user = { id: 'caller' };
    req.teamRole = role;
    next();
  };

describe('requireWorkspaceOwner', () => {
  it.each([
    ['no workspace context at all (own account)', undefined, 200],
    ['owner', 'owner', 200],
    ['admin', 'admin', 404],
    ['member', 'member', 404],
  ] as const)('%s → %i', async (_label, role, status) => {
    const res = await request(guardApp(requireWorkspaceOwner, withRole(role))).get('/probe');
    expect(res.status).toBe(status);
  });

  it('answers with the generic not-found message, never a 403', async () => {
    const res = await request(guardApp(requireWorkspaceOwner, withRole('member'))).get('/probe');
    expect(res.body.error.message).toBe(DICTIONARIES.en.errors.notFound);
  });
});

describe('requireTeamRole', () => {
  it.each([
    ['owner meets admin', 'admin', 'owner', 200],
    ['admin meets admin', 'admin', 'admin', 200],
    ['member fails admin', 'admin', 'member', 404],
    ['owner meets member', 'member', 'owner', 200],
    ['admin meets member', 'member', 'admin', 200],
    ['member meets member', 'member', 'member', 200],
    ['absent context meets admin', 'admin', undefined, 200],
  ] as const)('%s', async (_label, min, role, status) => {
    const app = guardApp(requireTeamRole(min), withRole(role));
    expect((await request(app).get('/probe')).status).toBe(status);
  });
});

describe('rejectForeignWorkspace', () => {
  const seed: express.RequestHandler = (req, _res, next) => {
    req.user = { id: 'caller' };
    next();
  };

  it('passes a request with no workspace header', async () => {
    expect((await request(guardApp(rejectForeignWorkspace, seed)).get('/probe')).status).toBe(200);
  });

  it("passes a header naming the caller's own account", async () => {
    const res = await request(guardApp(rejectForeignWorkspace, seed))
      .get('/probe')
      .set(WORKSPACE_HEADER, 'caller');
    expect(res.status).toBe(200);
  });

  it('passes a whitespace-only header', async () => {
    const res = await request(guardApp(rejectForeignWorkspace, seed))
      .get('/probe')
      .set(WORKSPACE_HEADER, '  ');
    expect(res.status).toBe(200);
  });

  it('rejects a header naming another account, with no database read', async () => {
    const res = await request(guardApp(rejectForeignWorkspace, seed))
      .get('/probe')
      .set(WORKSPACE_HEADER, 'somebody-else');
    expect(res.status).toBe(404);
  });

  it('rejects an unauthenticated caller', async () => {
    const app = guardApp(rejectForeignWorkspace, (_req, _res, next) => next());
    const res = await request(app).get('/probe').set(WORKSPACE_HEADER, 'somebody-else');
    expect(res.status).toBe(401);
  });
});

describe('owner-only surfaces reject a foreign workspace (router level)', () => {
  const app = createApp();
  let owner: TestUser;
  let member: TestUser;
  let ownerSiteId: string;

  beforeAll(async () => {
    await startMemoryMongo();
    await startTestPostgres();
    installTestAuth();
  });

  afterAll(async () => {
    uninstallTestAuth();
    setTeamDb(null);
    await stopTestPostgres();
    await stopMemoryMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    await truncateAllTables();
    setTeamDb(getTestDb() as unknown as never);
    owner = await signupVerifiedUser(app, { email: 'workspace-owner@example.com' });
    member = await signupVerifiedUser(app, { email: 'workspace-admin@example.com' });
    await getTestDb().insert(teamMembers).values({
      teamId: owner.id,
      userId: member.id,
      email: 'workspace-admin@example.com',
      role: 'admin',
      inviteTokenHash: 'a'.repeat(64),
      invitedBy: owner.id,
      acceptedAt: new Date('2026-07-01T00:00:00Z'),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });
    const site = await Site.create({
      accountId: owner.id,
      url: 'https://google-owner-only.example',
      domain: 'google-owner-only.example',
    });
    ownerSiteId = String(site._id);
  });

  const OWNER_ONLY_ROUTES = [
    ['api keys', '/api/api-keys'],
    ['mcp permissions', '/api/mcp-permissions'],
  ] as const;

  it.each(OWNER_ONLY_ROUTES)(
    '%s → 404 for an admin-role member using the owner workspace',
    async (_label, path) => {
      const res = await request(app)
        .get(path)
        .set('Cookie', member.cookie)
        .set(WORKSPACE_HEADER, owner.id);
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe(DICTIONARIES.en.errors.notFound);
    },
  );

  it.each(OWNER_ONLY_ROUTES)('%s → reachable for the owner with no header', async (_label, path) => {
    const res = await request(app).get(path).set('Cookie', owner.cookie);
    expect(res.status).not.toBe(404);
  });

  it('keeps the Site-scoped Google surface owner-only', async () => {
    const path = `/api/sites/${ownerSiteId}/google/configuration`;
    const memberResponse = await request(app)
      .get(path)
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id);
    expect(memberResponse.status).toBe(404);
    expect(memberResponse.body.error.message).toBe(DICTIONARIES.en.errors.notFound);

    const ownerResponse = await request(app).get(path).set('Cookie', owner.cookie);
    expect(ownerResponse.status).not.toBe(404);
  });

  it('data rights reject the owner workspace header without a database read', async () => {
    const res = await request(app)
      .get('/api/legal/account-deletion')
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id);
    expect(res.status).toBe(404);
  });

  it('data rights stay reachable for the caller with no header', async () => {
    const res = await request(app)
      .get('/api/legal/account-deletion')
      .set('Cookie', member.cookie);
    expect(res.status).not.toBe(404);
  });

  it('the team roster stays readable for an admin member inside the owner workspace', async () => {
    const res = await request(app)
      .get('/api/team')
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id);
    expect(res.status).not.toBe(404);
  });

  it('a stranger carrying the owner workspace header is not found', async () => {
    const stranger = await signupVerifiedUser(app, { email: 'stranger@example.com' });
    const teamRes = await request(app)
      .get('/api/team')
      .set('Cookie', stranger.cookie)
      .set(WORKSPACE_HEADER, owner.id);
    expect(teamRes.status).toBe(404);

    const keysRes = await request(app)
      .get('/api/api-keys')
      .set('Cookie', stranger.cookie)
      .set(WORKSPACE_HEADER, owner.id);
    expect(keysRes.status).toBe(404);
  });
});
