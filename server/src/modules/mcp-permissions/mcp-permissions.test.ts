/**
 * Account MCP permission settings routes + service.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
} from '../../shared/testing/auth.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';
import { Site } from '../sites/index.js';
import { MCP_PERMISSION_TOOL_NAMES } from './mcp-permissions.controller.js';
import { getAccountMcpSpec } from './mcp-permissions.service.js';
import { McpPermissionSettings } from './mcp-permissions.model.js';

const app = createApp();

function insertSite(accountId: string, domain: string) {
  return Site.create({ accountId, url: `https://${domain}`, domain, displayName: '' });
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  installTestAuth();
});
afterAll(async () => {
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await clearCollections();
  await truncateAllTables();
});

describe('GET /api/mcp-permissions', () => {
  it('401 when unauthenticated', async () => {
    await request(app).get('/api/mcp-permissions').expect(401);
  });

  it('a fresh account reads fully-permissive defaults (missing doc)', async () => {
    const user = await signupVerifiedUser(app, { email: 'perm-defaults@x.co' });
    const res = await request(app)
      .get('/api/mcp-permissions')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.allowSpend).toBe(true);
    expect(res.body.allowedSiteIds).toEqual([]);
    expect(Object.keys(res.body.tools).sort()).toEqual(
      [...MCP_PERMISSION_TOOL_NAMES].sort(),
    );
    for (const name of MCP_PERMISSION_TOOL_NAMES) {
      expect(res.body.tools[name]).toBe(true);
    }
    expect(await getAccountMcpSpec(user.id)).toBeNull();
  });

  it('treats a legacy stored document with no tools map as permissive', async () => {
    await McpPermissionSettings.collection.insertOne({
      accountId: 'legacy-account',
      allowedSiteIds: [],
      allowSpend: true,
    });

    await expect(getAccountMcpSpec('legacy-account')).resolves.toEqual({});
  });
});

describe('PUT /api/mcp-permissions', () => {
  it('round-trips a full settings save', async () => {
    const user = await signupVerifiedUser(app, { email: 'perm-roundtrip@x.co' });
    const site = await insertSite(user.id, 'roundtrip.example.com');
    const siteId = String(site._id);
    const put = await request(app)
      .put('/api/mcp-permissions')
      .set('Cookie', user.cookie)
      .send({
        tools: { start_audit: false, list_sites: true },
        allowedSiteIds: [siteId],
        allowSpend: false,
      });
    expect(put.status).toBe(200);
    expect(put.body.tools.start_audit).toBe(false);
    expect(put.body.tools.list_sites).toBe(true);
    expect(put.body.tools.get_rank_history).toBe(true);
    expect(put.body.allowedSiteIds).toEqual([siteId]);
    expect(put.body.allowSpend).toBe(false);

    const get = await request(app)
      .get('/api/mcp-permissions')
      .set('Cookie', user.cookie);
    expect(get.body).toEqual(put.body);

    // The stored spec feeds the engine with only the restrictive fields set.
    expect(await getAccountMcpSpec(user.id)).toEqual({
      tools: { start_audit: false, list_sites: true },
      allowedSiteIds: [siteId],
      allowSpend: false,
    });
  });

  it('a permissive re-save collapses back to the default read shape', async () => {
    const user = await signupVerifiedUser(app, { email: 'perm-reset@x.co' });
    await request(app)
      .put('/api/mcp-permissions')
      .set('Cookie', user.cookie)
      .send({ tools: { start_audit: false }, allowSpend: false })
      .expect(200);
    const reset = await request(app)
      .put('/api/mcp-permissions')
      .set('Cookie', user.cookie)
      .send({})
      .expect(200);
    expect(reset.body.tools.start_audit).toBe(true);
    expect(reset.body.allowSpend).toBe(true);
    expect(reset.body.allowedSiteIds).toEqual([]);
    // Stored doc exists but is fully permissive → empty spec.
    expect(await getAccountMcpSpec(user.id)).toEqual({});
  });

  it('rejects an unknown tool name with a localized 400', async () => {
    const user = await signupVerifiedUser(app, { email: 'perm-unknown@x.co' });
    const res = await request(app)
      .put('/api/mcp-permissions')
      .set('Cookie', user.cookie)
      .send({ tools: { delete_everything: true } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.mcp.permissions.errors.unknownTool,
    );
  });

  it("rejects another account's siteId with a localized 400 (no existence leak)", async () => {
    const owner = await signupVerifiedUser(app, { email: 'perm-owner@x.co' });
    const stranger = await signupVerifiedUser(app, { email: 'perm-stranger@x.co' });
    const strangerSite = await insertSite(stranger.id, 'stranger.example.com');
    const res = await request(app)
      .put('/api/mcp-permissions')
      .set('Cookie', owner.cookie)
      .send({ allowedSiteIds: [String(strangerSite._id)] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.mcp.permissions.errors.invalidSite,
    );
  });

  it('rejects a nonexistent siteId identically to a non-owned one', async () => {
    const user = await signupVerifiedUser(app, { email: 'perm-missing@x.co' });
    const res = await request(app)
      .put('/api/mcp-permissions')
      .set('Cookie', user.cookie)
      .send({ allowedSiteIds: ['64b000000000000000000123'] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.mcp.permissions.errors.invalidSite,
    );
  });

  it('rejects a deleting site and never persists it in the allow-list', async () => {
    const user = await signupVerifiedUser(app, { email: 'perm-deleting@x.co' });
    const site = await insertSite(user.id, 'deleting.example.com');
    await Site.updateOne(
      { _id: site._id },
      { $set: { deletionStartedAt: new Date() } },
    );
    const res = await request(app)
      .put('/api/mcp-permissions')
      .set('Cookie', user.cookie)
      .send({ allowedSiteIds: [String(site._id)] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.mcp.permissions.errors.invalidSite,
    );
    expect(await McpPermissionSettings.exists({ accountId: user.id })).toBeNull();
  });

  it('fails closed when deletion claims after validation but before lease acquisition', async () => {
    const user = await signupVerifiedUser(app, { email: 'perm-delete-race@x.co' });
    const site = await insertSite(user.id, 'delete-race.example.com');
    vi.spyOn(Site, 'countDocuments').mockImplementationOnce((async () => {
      await Site.collection.updateOne(
        { _id: site._id },
        { $set: { deletionStartedAt: new Date() } },
      );
      return 1;
    }) as never);

    await request(app)
      .put('/api/mcp-permissions')
      .set('Cookie', user.cookie)
      .send({ allowedSiteIds: [String(site._id)] })
      .expect(400);

    expect(await McpPermissionSettings.exists({ accountId: user.id })).toBeNull();
  });

  it('rejects a malformed body (unknown key / bad types) with 400', async () => {
    const user = await signupVerifiedUser(app, { email: 'perm-badbody@x.co' });
    await request(app)
      .put('/api/mcp-permissions')
      .set('Cookie', user.cookie)
      .send({ nonsense: true })
      .expect(400);
    await request(app)
      .put('/api/mcp-permissions')
      .set('Cookie', user.cookie)
      .send({ allowedSiteIds: ['not-an-object-id'] })
      .expect(400);
  });

  it("cross-account isolation: one account's save never leaks into another's read", async () => {
    const a = await signupVerifiedUser(app, { email: 'perm-a@x.co' });
    const b = await signupVerifiedUser(app, { email: 'perm-b@x.co' });
    await request(app)
      .put('/api/mcp-permissions')
      .set('Cookie', a.cookie)
      .send({ tools: { start_audit: false }, allowSpend: false })
      .expect(200);
    const bRead = await request(app)
      .get('/api/mcp-permissions')
      .set('Cookie', b.cookie)
      .expect(200);
    expect(bRead.body.tools.start_audit).toBe(true);
    expect(bRead.body.allowSpend).toBe(true);
    expect(await getAccountMcpSpec(b.id)).toBeNull();
  });
});
