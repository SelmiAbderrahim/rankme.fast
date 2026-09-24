/**
 * Workspace context middleware — `rankme-enterprise-orgs` 02.
 *
 * The whole authorization decision for shared workspaces lives in one
 * middleware, so this suite is the exhaustive matrix for it:
 *  - absent / empty / own-id header → own workspace, role `owner`
 *  - accepted membership → owner's workspace, role propagated (member/admin)
 *  - pending, expired-pending, revoked, stranger, malformed → 404, never 403
 *
 * A mini Express app is used rather than `createApp()` so the resolved
 * `workspaceAccountId` / `teamRole` can be asserted directly instead of
 * inferred from a product route's behavior.
 */
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  teamMembers,
  teamMemberSiteGrants,
} from '../../db/schema/team-members.js';
import { DICTIONARIES } from '../i18n/index.js';
import type { ApplicationDb } from '../types/application-db.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
  type TestDb,
} from '../testing/postgres.js';
import { errorHandler } from './error-handler.js';
import { WORKSPACE_HEADER, workspaceContext } from './workspace-context.js';

const OWNER = '111111111111111111111111';
const MEMBER = '222222222222222222222222';
const STRANGER = '333333333333333333333333';

let db: TestDb;
const resolveDb = () => db as unknown as ApplicationDb;

/** Signed-in caller stub — `requireAuth` is not under test here. */
function probeApp(callerId: string | null): Express {
  const app = express();
  app.use((req, _res, next) => {
    if (callerId) req.user = { id: callerId };
    next();
  });
  app.use(workspaceContext(resolveDb));
  app.get('/probe', (req, res) => {
    res.json({
      accountId: req.workspaceAccountId,
      role: req.teamRole,
      siteAccessMode: req.teamSiteAccessMode,
      siteIds: [...(req.teamSiteIds ?? [])],
    });
  });
  app.use(errorHandler);
  return app;
}

interface MembershipOptions {
  role?: 'owner' | 'admin' | 'member';
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
  expiresAt?: Date;
  siteAccessMode?: 'all' | 'selected';
  siteIds?: readonly string[];
}

async function seedMembership(token: string, options: MembershipOptions = {}): Promise<void> {
  const [membership] = await db.insert(teamMembers).values({
    teamId: OWNER,
    userId: MEMBER,
    email: 'member@example.com',
    role: options.role ?? 'member',
    siteAccessMode: options.siteAccessMode ?? 'all',
    inviteTokenHash: token,
    invitedBy: OWNER,
    acceptedAt: options.acceptedAt === undefined ? new Date('2026-07-01T00:00:00Z') : options.acceptedAt,
    revokedAt: options.revokedAt ?? null,
    expiresAt: options.expiresAt ?? new Date('2099-01-01T00:00:00Z'),
  }).returning({ id: teamMembers.id });
  if (options.siteIds?.length) {
    await db.insert(teamMemberSiteGrants).values(
      options.siteIds.map((siteId) => ({
        teamMemberId: membership!.id,
        siteId,
      })),
    );
  }
}

beforeAll(async () => {
  db = await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
});

describe('workspaceContext — own workspace', () => {
  it('resolves the caller as their own workspace owner when no header is sent', async () => {
    const res = await request(probeApp(MEMBER)).get('/probe');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accountId: MEMBER,
      role: 'owner',
      siteAccessMode: 'all',
      siteIds: [],
    });
  });

  it('treats a whitespace-only header as absent', async () => {
    const res = await request(probeApp(MEMBER)).get('/probe').set(WORKSPACE_HEADER, '   ');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accountId: MEMBER,
      role: 'owner',
      siteAccessMode: 'all',
      siteIds: [],
    });
  });

  it("treats the caller's own id as their own workspace without a database read", async () => {
    const spy = vi.fn(resolveDb);
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: MEMBER };
      next();
    });
    app.use(workspaceContext(spy));
    app.get('/probe', (req, res) => {
      res.json({
        accountId: req.workspaceAccountId,
        role: req.teamRole,
        siteAccessMode: req.teamSiteAccessMode,
      });
    });
    app.use(errorHandler);

    const res = await request(app).get('/probe').set(WORKSPACE_HEADER, MEMBER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accountId: MEMBER,
      role: 'owner',
      siteAccessMode: 'all',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request before touching the header', async () => {
    const res = await request(probeApp(null)).get('/probe').set(WORKSPACE_HEADER, OWNER);
    expect(res.status).toBe(401);
  });
});

describe('workspaceContext — accepted membership', () => {
  it('resolves the owner workspace and propagates the member role', async () => {
    await seedMembership('a'.repeat(64));
    const res = await request(probeApp(MEMBER)).get('/probe').set(WORKSPACE_HEADER, OWNER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accountId: OWNER,
      role: 'member',
      siteAccessMode: 'all',
      siteIds: [],
    });
  });

  it('propagates the admin role', async () => {
    await seedMembership('b'.repeat(64), { role: 'admin' });
    const res = await request(probeApp(MEMBER)).get('/probe').set(WORKSPACE_HEADER, OWNER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accountId: OWNER,
      role: 'admin',
      siteAccessMode: 'all',
      siteIds: [],
    });
  });

  it('loads the exact selected-site grants for the accepted membership', async () => {
    const siteIds = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'];
    await seedMembership('i'.repeat(64), {
      siteAccessMode: 'selected',
      siteIds,
    });
    const res = await request(probeApp(MEMBER)).get('/probe').set(WORKSPACE_HEADER, OWNER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accountId: OWNER,
      role: 'member',
      siteAccessMode: 'selected',
      siteIds,
    });
  });

  it('fails closed to an empty grant set when a selected membership has no grants', async () => {
    await seedMembership('j'.repeat(64), { siteAccessMode: 'selected' });
    const res = await request(probeApp(MEMBER)).get('/probe').set(WORKSPACE_HEADER, OWNER);
    expect(res.status).toBe(200);
    expect(res.body.siteAccessMode).toBe('selected');
    expect(res.body.siteIds).toEqual([]);
  });
});

describe('workspaceContext — fail-closed rejections (404, never 403)', () => {
  it('rejects a pending invite that has not been accepted', async () => {
    await seedMembership('c'.repeat(64), { acceptedAt: null });
    const res = await request(probeApp(MEMBER)).get('/probe').set(WORKSPACE_HEADER, OWNER);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(DICTIONARIES.en.errors.notFound);
  });

  it('rejects an expired pending invite', async () => {
    await seedMembership('d'.repeat(64), {
      acceptedAt: null,
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    });
    const res = await request(probeApp(MEMBER)).get('/probe').set(WORKSPACE_HEADER, OWNER);
    expect(res.status).toBe(404);
  });

  it('rejects a revoked membership — this is how removal cuts access', async () => {
    await seedMembership('e'.repeat(64), { revokedAt: new Date('2026-07-05T00:00:00Z') });
    const res = await request(probeApp(MEMBER)).get('/probe').set(WORKSPACE_HEADER, OWNER);
    expect(res.status).toBe(404);
  });

  it('rejects a caller with no membership row at all', async () => {
    await seedMembership('f'.repeat(64));
    const res = await request(probeApp(STRANGER)).get('/probe').set(WORKSPACE_HEADER, OWNER);
    expect(res.status).toBe(404);
  });

  it('rejects a membership belonging to a different workspace', async () => {
    await seedMembership('g'.repeat(64));
    const res = await request(probeApp(MEMBER)).get('/probe').set(WORKSPACE_HEADER, STRANGER);
    expect(res.status).toBe(404);
  });

  it.each([
    ['spaces', 'not a workspace'],
    ['sql-ish punctuation', "abc';--"],
    ['path traversal', '../../etc/passwd'],
    ['over the length bound', 'a'.repeat(65)],
  ])('rejects a malformed header (%s) without querying the database', async (_label, value) => {
    const spy = vi.fn(resolveDb);
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: MEMBER };
      next();
    });
    app.use(workspaceContext(spy));
    app.get('/probe', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    const res = await request(app).get('/probe').set(WORKSPACE_HEADER, value);
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
});
