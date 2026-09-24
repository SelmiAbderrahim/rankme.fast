/**
 * Workstream C — API-key management routes + service unit edges.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
} from '../../shared/testing/auth.js';
import { apiKeys } from '../../db/schema/api-keys.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';
import { setApiKeysDb } from './api-keys.holder.js';
import {
  LAST_USED_THROTTLE_MS,
  MAX_ACTIVE_API_KEYS,
  createApiKey,
  generateApiKey,
  hashApiKey,
  resolveApiKey,
  touchLastUsed,
} from './api-keys.service.js';
import { parseStoredScopes } from '../../shared/mcp-permissions/types.js';

const app = createApp();

function db() {
  return getTestDb() as unknown as Parameters<typeof createApiKey>[0];
}

async function seedUser(email: string) {
  return signupVerifiedUser(app, { email });
}

beforeAll(async () => {
  await startMemoryMongo();
  const testDb = await startTestPostgres();
  installTestAuth();
  setApiKeysDb(testDb as unknown as never);
});
afterAll(async () => {
  uninstallTestAuth();
  setApiKeysDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  vi.restoreAllMocks();
});

describe('generateApiKey / hashApiKey', () => {
  it('emits rmf_-prefixed keys with a 40-char base64url secret and a matching prefix', () => {
    const { key, prefix } = generateApiKey();
    expect(key).toMatch(/^rmf_[A-Za-z0-9_-]{40}$/);
    expect(prefix).toBe(`rmf_${key.slice(4, 12)}`);
  });

  it('hashApiKey is deterministic sha256 hex', () => {
    const digest = hashApiKey('rmf_x');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey('rmf_x')).toBe(digest);
    expect(hashApiKey('rmf_y')).not.toBe(digest);
  });
});

describe('POST /api/api-keys', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).post('/api/api-keys').send({ name: 'ci' });
    expect(res.status).toBe(401);
  });

  it('creates a key for any verified account — full key returned exactly once, only the hash stored', async () => {
    const user = await seedUser('starter@x.co');
    const res = await request(app)
      .post('/api/api-keys')
      .set('Cookie', user.cookie)
      .send({ name: 'ci key' });
    expect(res.status).toBe(201);
    const created = res.body.apiKey;
    expect(created.key).toMatch(/^rmf_[A-Za-z0-9_-]{40}$/);
    expect(created.name).toBe('ci key');
    expect(created.prefix).toBe(created.key.slice(0, 12));
    expect(created.createdAt).toBeTruthy();

    // The table holds the sha256 digest, never the key.
    const rows = await getTestDb().select().from(apiKeys);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.keyHash).toBe(hashApiKey(created.key));
    expect(JSON.stringify(rows)).not.toContain(created.key);

    // …and the list endpoint never echoes the key or hash again.
    const list = await request(app).get('/api/api-keys').set('Cookie', user.cookie);
    expect(list.status).toBe(200);
    expect(list.body.apiKeys).toHaveLength(1);
    expect(list.body.apiKeys[0]).toMatchObject({
      id: created.id,
      name: 'ci key',
      prefix: created.prefix,
      revokedAt: null,
      lastUsedAt: null,
    });
    expect(JSON.stringify(list.body)).not.toContain(created.key);
    expect(JSON.stringify(list.body)).not.toContain(hashApiKey(created.key));
  });

  it('list serializes lastUsedAt and revokedAt as ISO strings once set', async () => {
    const user = await seedUser('agency-list@x.co');
    const created = await request(app)
      .post('/api/api-keys')
      .set('Cookie', user.cookie)
      .send({ name: 'used-then-revoked' })
      .expect(201);
    const id = created.body.apiKey.id as string;

    await touchLastUsed(db(), id);
    await request(app).delete(`/api/api-keys/${id}`).set('Cookie', user.cookie).expect(200);

    const list = await request(app).get('/api/api-keys').set('Cookie', user.cookie);
    expect(list.status).toBe(200);
    const row = list.body.apiKeys[0];
    expect(typeof row.lastUsedAt).toBe('string');
    expect(typeof row.revokedAt).toBe('string');
    expect(new Date(row.revokedAt).getTime()).not.toBeNaN();
  });

  it('rejects an empty name with 400', async () => {
    const user = await seedUser('agency-empty@x.co');
    const res = await request(app)
      .post('/api/api-keys')
      .set('Cookie', user.cookie)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it(`refuses the ${MAX_ACTIVE_API_KEYS + 1}th active key with a localized 409`, async () => {
    const user = await seedUser('agency-cap@x.co');
    for (let i = 0; i < MAX_ACTIVE_API_KEYS; i += 1) {
      await request(app)
        .post('/api/api-keys')
        .set('Cookie', user.cookie)
        .send({ name: `key-${i}` })
        .expect(201);
    }
    const overflow = await request(app)
      .post('/api/api-keys')
      .set('Cookie', user.cookie)
      .send({ name: 'one-too-many' });
    expect(overflow.status).toBe(409);
    expect(overflow.body.error.message).toBe(DICTIONARIES.en.apiKeys.errors.tooMany);
  });

  it('revoked keys do not count toward the active cap', async () => {
    const user = await seedUser('agency-cap2@x.co');
    for (let i = 0; i < MAX_ACTIVE_API_KEYS; i += 1) {
      await request(app)
        .post('/api/api-keys')
        .set('Cookie', user.cookie)
        .send({ name: `key-${i}` })
        .expect(201);
    }
    const list = await request(app).get('/api/api-keys').set('Cookie', user.cookie);
    const victim = list.body.apiKeys[0].id as string;
    await request(app)
      .delete(`/api/api-keys/${victim}`)
      .set('Cookie', user.cookie)
      .expect(200);
    await request(app)
      .post('/api/api-keys')
      .set('Cookie', user.cookie)
      .send({ name: 'fits-again' })
      .expect(201);
  });
});

describe('DELETE /api/api-keys/:id', () => {
  it('revokes a key (sets revokedAt) and the revoked key stops resolving', async () => {
    const user = await seedUser('agency-rev@x.co');
    const created = await request(app)
      .post('/api/api-keys')
      .set('Cookie', user.cookie)
      .send({ name: 'to-revoke' })
      .expect(201);
    const { id, key } = created.body.apiKey as { id: string; key: string };

    expect(await resolveApiKey(db(), key)).toMatchObject({ keyId: id });

    const res = await request(app)
      .delete(`/api/api-keys/${id}`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(DICTIONARIES.en.apiKeys.revoked);

    const [row] = await getTestDb().select().from(apiKeys).where(eq(apiKeys.id, id));
    expect(row?.revokedAt).toBeInstanceOf(Date);
    expect(await resolveApiKey(db(), key)).toBeNull();

    // Revoking again → 404 (tombstoned, not repeatable).
    await request(app)
      .delete(`/api/api-keys/${id}`)
      .set('Cookie', user.cookie)
      .expect(404);
  });

  it("cross-account DELETE is a 404 — never leaks another account's key", async () => {
    const owner = await seedUser('owner@x.co');
    const stranger = await seedUser('stranger@x.co');
    const created = await request(app)
      .post('/api/api-keys')
      .set('Cookie', owner.cookie)
      .send({ name: 'mine' })
      .expect(201);
    const res = await request(app)
      .delete(`/api/api-keys/${created.body.apiKey.id}`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(DICTIONARIES.en.apiKeys.errors.notFound);
  });

  it('a malformed (non-uuid) id is a 404, not a database error', async () => {
    const user = await seedUser('agency-bad@x.co');
    const res = await request(app)
      .delete('/api/api-keys/not-a-uuid')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });
});

describe('scope endpoints (rankme-ai-chat-mcp 01)', () => {
  async function seedWithSite(email: string) {
    const user = await seedUser(email);
    const { Site } = await import('../sites/index.js');
    const site = await Site.create({
      accountId: user.id,
      url: `https://${email.split('@')[0]}.example.com`,
      domain: `${email.split('@')[0]}.example.com`,
      displayName: '',
    });
    return { user, siteId: String(site._id) };
  }

  it('POST accepts scopes, returns them, and the list DTO exposes them', async () => {
    const { user, siteId } = await seedWithSite('scope-create@x.co');
    const scopes = {
      tools: { start_audit: false },
      allowedSiteIds: [siteId],
      allowSpend: false,
    };
    const created = await request(app)
      .post('/api/api-keys')
      .set('Cookie', user.cookie)
      .send({ name: 'scoped', scopes });
    expect(created.status).toBe(201);
    expect(created.body.apiKey.scopes).toEqual(scopes);

    const list = await request(app).get('/api/api-keys').set('Cookie', user.cookie);
    expect(list.body.apiKeys[0].scopes).toEqual(scopes);

    const resolved = await resolveApiKey(db(), created.body.apiKey.key);
    expect(resolved?.scopes).toEqual(scopes);
  });

  it('POST without scopes keeps scopes null (unscoped)', async () => {
    const user = await seedUser('scope-none@x.co');
    const created = await request(app)
      .post('/api/api-keys')
      .set('Cookie', user.cookie)
      .send({ name: 'plain' });
    expect(created.status).toBe(201);
    expect(created.body.apiKey.scopes).toBeNull();
  });

  it('POST rejects an unknown tool name and a non-owned site with localized 400s', async () => {
    const { user } = await seedWithSite('scope-badcreate@x.co');
    const stranger = await seedWithSite('scope-victim@x.co');
    const badTool = await request(app)
      .post('/api/api-keys')
      .set('Cookie', user.cookie)
      .send({ name: 'x', scopes: { tools: { nuke_all: true } } });
    expect(badTool.status).toBe(400);
    expect(badTool.body.error.message).toBe(
      DICTIONARIES.en.mcp.permissions.errors.unknownTool,
    );
    const badSite = await request(app)
      .post('/api/api-keys')
      .set('Cookie', user.cookie)
      .send({ name: 'x', scopes: { allowedSiteIds: [stranger.siteId] } });
    expect(badSite.status).toBe(400);
    expect(badSite.body.error.message).toBe(
      DICTIONARIES.en.mcp.permissions.errors.invalidSite,
    );
  });

  it('POST rejects malformed scopes (unknown key / wrong types) with 400', async () => {
    const user = await seedUser('scope-malformed@x.co');
    await request(app)
      .post('/api/api-keys')
      .set('Cookie', user.cookie)
      .send({ name: 'x', scopes: { surprise: true } })
      .expect(400);
    await request(app)
      .post('/api/api-keys')
      .set('Cookie', user.cookie)
      .send({ name: 'x', scopes: { allowedSiteIds: ['not-hex'] } })
      .expect(400);
  });

  it('PATCH replaces scopes and null clears them', async () => {
    const { user, siteId } = await seedWithSite('scope-patch@x.co');
    const created = await request(app)
      .post('/api/api-keys')
      .set('Cookie', user.cookie)
      .send({ name: 'patchme' });
    const id = created.body.apiKey.id as string;
    const lastUsedAt = new Date('2026-08-01T12:00:00.000Z');
    await getTestDb().update(apiKeys).set({ lastUsedAt }).where(eq(apiKeys.id, id));

    const patched = await request(app)
      .patch(`/api/api-keys/${id}/scopes`)
      .set('Cookie', user.cookie)
      .send({ scopes: { allowedSiteIds: [siteId], allowSpend: false } });
    expect(patched.status).toBe(200);
    expect(patched.body.apiKey.scopes).toEqual({
      allowedSiteIds: [siteId],
      allowSpend: false,
    });
    expect(patched.body.apiKey.lastUsedAt).toBe(lastUsedAt.toISOString());

    await getTestDb().update(apiKeys).set({ lastUsedAt: null }).where(eq(apiKeys.id, id));
    const cleared = await request(app)
      .patch(`/api/api-keys/${id}/scopes`)
      .set('Cookie', user.cookie)
      .send({ scopes: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.apiKey.lastUsedAt).toBeNull();
    expect(cleared.body.apiKey.scopes).toBeNull();
  });

  it('PATCH is 404 for cross-account, revoked, missing, and non-uuid ids', async () => {
    const { user } = await seedWithSite('scope-owner2@x.co');
    const other = await seedUser('scope-thief@x.co');
    const created = await request(app)
      .post('/api/api-keys')
      .set('Cookie', user.cookie)
      .send({ name: 'target' });
    const id = created.body.apiKey.id as string;

    await request(app)
      .patch(`/api/api-keys/${id}/scopes`)
      .set('Cookie', other.cookie)
      .send({ scopes: null })
      .expect(404);

    await request(app)
      .patch('/api/api-keys/not-a-uuid/scopes')
      .set('Cookie', user.cookie)
      .send({ scopes: null })
      .expect(404);

    await request(app)
      .patch('/api/api-keys/00000000-0000-4000-8000-000000000000/scopes')
      .set('Cookie', user.cookie)
      .send({ scopes: null })
      .expect(404);

    await request(app).delete(`/api/api-keys/${id}`).set('Cookie', user.cookie).expect(200);
    await request(app)
      .patch(`/api/api-keys/${id}/scopes`)
      .set('Cookie', user.cookie)
      .send({ scopes: { allowSpend: false } })
      .expect(404);
  });
});

describe('resolveApiKey scopes (rankme-ai-chat-mcp 01)', () => {
  it('legacy keys (no scopes column value) resolve with scopes null — behavior unchanged', async () => {
    const user = await seedUser('scopes-legacy@example.com');
    const created = await createApiKey(db(), { accountId: user.id, name: 'legacy' });
    const resolved = await resolveApiKey(db(), created.key);
    expect(resolved).toMatchObject({ keyId: created.id, accountId: user.id });
    expect(resolved?.scopes).toBeNull();
  });

  it('valid stored scopes are returned parsed', async () => {
    const user = await seedUser('scopes-valid@example.com');
    const created = await createApiKey(db(), { accountId: user.id, name: 'scoped' });
    const scopes = {
      tools: { start_audit: false },
      allowedSiteIds: ['64b000000000000000000001'],
      allowSpend: false,
    };
    await getTestDb().update(apiKeys).set({ scopes }).where(eq(apiKeys.id, created.id));
    const resolved = await resolveApiKey(db(), created.key);
    expect(resolved?.scopes).toEqual(scopes);
  });

  it('malformed stored scopes collapse to null (permissive), never half-apply', async () => {
    const user = await seedUser('scopes-bad@example.com');
    const created = await createApiKey(db(), { accountId: user.id, name: 'bad' });
    await getTestDb()
      .update(apiKeys)
      .set({ scopes: { tools: 'everything', extra: 1 } })
      .where(eq(apiKeys.id, created.id));
    const resolved = await resolveApiKey(db(), created.key);
    expect(resolved).not.toBeNull();
    expect(resolved?.scopes).toBeNull();
  });

  it('parseStoredScopes: null/undefined stay null; empty object parses; junk rejects', () => {
    expect(parseStoredScopes(null)).toBeNull();
    expect(parseStoredScopes(undefined)).toBeNull();
    expect(parseStoredScopes({})).toEqual({});
    expect(parseStoredScopes({ allowSpend: true })).toEqual({ allowSpend: true });
    expect(parseStoredScopes('nope')).toBeNull();
    expect(parseStoredScopes({ allowedSiteIds: [1] })).toBeNull();
    expect(parseStoredScopes({ tools: { '': true } })).toBeNull();
  });
});

describe('touchLastUsed throttle', () => {
  it('writes on first touch, skips within the window, writes again after it', async () => {
    const created = await createApiKey(db(), { accountId: 'acct-1', name: 'k' });

    await touchLastUsed(db(), created.id);
    const [first] = await getTestDb()
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, created.id));
    expect(first?.lastUsedAt).toBeInstanceOf(Date);

    // Immediate second touch: stored value is < 60s old → no write.
    await touchLastUsed(db(), created.id);
    const [second] = await getTestDb()
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, created.id));
    expect(second?.lastUsedAt?.getTime()).toBe(first?.lastUsedAt?.getTime());

    // Age the stored value past the throttle window → write happens.
    const aged = new Date(Date.now() - LAST_USED_THROTTLE_MS - 1000);
    await getTestDb()
      .update(apiKeys)
      .set({ lastUsedAt: aged })
      .where(eq(apiKeys.id, created.id));
    await touchLastUsed(db(), created.id);
    const [third] = await getTestDb()
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, created.id));
    expect(third?.lastUsedAt?.getTime()).toBeGreaterThan(aged.getTime());
  });
});
