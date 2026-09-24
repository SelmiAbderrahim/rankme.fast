import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { gscSearchAnalytics, gscSyncRuns } from '../../db/schema/gsc.js';
import { teamMembers, teamMemberSiteGrants } from '../../db/schema/team-members.js';
import { createFakeGscProvider, createFakeKeywordProvider } from '../../shared/providers/fakes.js';
import { VendorUnavailableError } from '../../shared/providers/index.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { installTestAuth, signupTestUser, signupVerifiedUser, uninstallTestAuth } from '../../shared/testing/auth.js';
import { setKeywordProvider, setKeywordResearchDb } from '../keyword-research/index.js';
import {
  SCOPE_GSC,
  setGoogleConnectionsDb,
  setGoogleGscProvider,
  upsertConnection,
} from '../google-connections/index.js';
import { Site } from '../sites/index.js';
import { setTeamDb } from '../team/team.holder.js';
import {
  readPreviousPagesGscTotals,
  runTrackedPagesGscSync,
} from './pages.routes.js';

const app = createApp();
const BINDING_GENERATION_ID = 'legacy';

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setKeywordResearchDb(db as never);
  setGoogleConnectionsDb(db as never);
  setTeamDb(db as never);
  setKeywordProvider(createFakeKeywordProvider());
});
afterAll(async () => {
  setKeywordProvider(null);
  setGoogleGscProvider(null);
  setKeywordResearchDb(null);
  setTeamDb(null);
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setKeywordProvider(createFakeKeywordProvider());
  setGoogleGscProvider(null);
  vi.restoreAllMocks();
});

async function siteFor(accountId: string) {
  const site = await Site.create({ accountId: new mongoose.Types.ObjectId(accountId), url: 'https://example.com/', domain: 'example.com' });
  return String(site._id);
}

describe('authenticated Pages API isolation and provider reuse', () => {
  it('tracks thrown GSC infrastructure failures and resolves previous totals with tenant scope', async () => {
    const db = getTestDb();
    const accountId = '507f1f77bcf86cd799439021';
    const siteId = '507f1f77bcf86cd799439022';
    await db.insert(gscSearchAnalytics).values({
      accountId, siteId, bindingGenerationId: BINDING_GENERATION_ID, snapshotDate: '2026-08-01', dimensionSet: 'query', windowDays: 28,
      dimensionKey: 'stored-query', clicks: 3, impressions: 7, ctr: 3 / 7, position: 2,
      fetchedAt: new Date('2026-08-04T00:00:00Z'),
    });
    await expect(readPreviousPagesGscTotals(db as never, accountId, siteId, '2026-08-02'))
      .resolves.toEqual({ clicks: 3, impressions: 7 });
    await expect(readPreviousPagesGscTotals(db as never, accountId, siteId, '2026-08-01'))
      .resolves.toBeNull();

    const provider = createFakeGscProvider();
    const input = { accountId, siteId, domain: 'example.com', propertyUrlHash: 'a'.repeat(64), bindingGenerationId: BINDING_GENERATION_ID };
    await expect(runTrackedPagesGscSync(db as never, provider, input, {
      now: () => new Date('2026-08-09T11:00:00Z'),
      sync: vi.fn(async (_account, _site, _domain, deps) => {
        await expect(deps.persist.readPreviousTotals(siteId, '2026-08-02'))
          .resolves.toEqual({ clicks: 3, impressions: 7 });
        return {
          status: 'ok' as const,
          snapshotDate: '2026-08-06',
          counts: { date: 0, query: 1, page: 1, country: 0, device: 0, 'query,page': 0 },
          sitemaps: 0,
        };
      }),
    })).resolves.toMatchObject({ status: 'ok' });
    const error = new TypeError('infrastructure');
    await expect(runTrackedPagesGscSync(db as never, provider, input, {
      now: () => new Date('2026-08-09T12:00:00Z'),
      sync: vi.fn().mockRejectedValue(error),
    })).rejects.toBe(error);
    await expect(runTrackedPagesGscSync(db as never, provider, input, {
      now: () => new Date('2026-08-09T13:00:00Z'),
      sync: vi.fn().mockRejectedValue('opaque'),
    })).rejects.toBe('opaque');
    expect((await db.select().from(gscSyncRuns)).filter((row) => row.status === 'failed').map((row) => row.failureClass))
      .toEqual(['TypeError', 'unknown']);
  });

  it('rejects unauthenticated and unverified requests before Pages data access', async () => {
    const owner = await signupTestUser(app, { email: 'unverified-pages@example.com' });
    const siteId = await siteFor(owner.id);
    await request(app).get(`/api/sites/${siteId}/pages`).expect(401);
    await request(app).get(`/api/sites/${siteId}/pages`).set('Cookie', owner.cookie).expect(403);
  });

  it('returns 404 for foreign sites and forged workspaces while accepted members can read and refresh', async () => {
    const owner = await signupVerifiedUser(app, { email: 'pages-owner@example.com' });
    const member = await signupVerifiedUser(app, { email: 'pages-member@example.com' });
    const outsider = await signupVerifiedUser(app, { email: 'pages-outsider@example.com' });
    const siteId = await siteFor(owner.id);
    await getTestDb().insert(teamMembers).values({
      teamId: owner.id, userId: member.id, email: member.email, role: 'member',
      inviteTokenHash: 'a'.repeat(64), invitedBy: owner.id, acceptedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000),
    });
    await request(app).get(`/api/sites/${siteId}/pages`).set('Cookie', outsider.cookie).expect(404);
    await request(app).get(`/api/sites/${siteId}/pages`).set('Cookie', outsider.cookie).set('x-workspace-id', owner.id).expect(404);
    const memberRead = await request(app).get(`/api/sites/${siteId}/pages`).set('Cookie', member.cookie).set('x-workspace-id', owner.id).expect(200);
    expect(memberRead.body.envelope).toMatchObject({ source: 'none', status: 'empty', fallbackReason: 'gsc_not_connected' });
    const memberRefresh = await request(app).post(`/api/sites/${siteId}/pages/refresh`).set('Cookie', member.cookie).set('x-workspace-id', owner.id).send({}).expect(200);
    expect(memberRefresh.body.refresh).toMatchObject({ source: 'demo' });
  });

  it('hides Pages reads and refresh for a selected member without the site grant', async () => {
    const owner = await signupVerifiedUser(app, { email: 'pages-scope-owner@example.com' });
    const member = await signupVerifiedUser(app, { email: 'pages-scope-member@example.com' });
    const allowedSiteId = await siteFor(owner.id);
    const denied = await Site.create({
      accountId: new mongoose.Types.ObjectId(owner.id),
      url: 'https://denied.example.com/',
      domain: 'denied.example.com',
    });
    const [membership] = await getTestDb().insert(teamMembers).values({
      teamId: owner.id,
      userId: member.id,
      email: member.email,
      role: 'member',
      siteAccessMode: 'selected',
      inviteTokenHash: 'b'.repeat(64),
      invitedBy: owner.id,
      acceptedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    }).returning({ id: teamMembers.id });
    await getTestDb().insert(teamMemberSiteGrants).values({
      teamMemberId: membership!.id,
      siteId: allowedSiteId,
    });
    const ranked = vi.fn(createFakeKeywordProvider().getRankedKeywordsForSite);
    setKeywordProvider({ ...createFakeKeywordProvider(), getRankedKeywordsForSite: ranked });
    const headers = { Cookie: member.cookie, 'x-workspace-id': owner.id };

    await request(app)
      .get(`/api/sites/${String(denied._id)}/pages`)
      .set(headers)
      .expect(404);
    await request(app)
      .post(`/api/sites/${String(denied._id)}/pages/refresh`)
      .set(headers)
      .send({})
      .expect(404);
    expect(ranked).not.toHaveBeenCalled();
  });

  it('keeps both GETs provider-free and reuses the fallback cache across refreshes', async () => {
    const owner = await signupVerifiedUser(app, { email: 'pages-spend@example.com' });
    const siteId = await siteFor(owner.id);
    const base = createFakeKeywordProvider();
    const ranked = vi.fn(base.getRankedKeywordsForSite.bind(base));
    setKeywordProvider({ ...base, getRankedKeywordsForSite: ranked });
    await request(app).get(`/api/sites/${siteId}/pages`).set('Cookie', owner.cookie).expect(200);
    expect(ranked).not.toHaveBeenCalled();
    const first = await request(app).post(`/api/sites/${siteId}/pages/refresh`).set('Cookie', owner.cookie).send({}).expect(200);
    const second = await request(app).post(`/api/sites/${siteId}/pages/refresh`).set('Cookie', owner.cookie).send({}).expect(200);
    expect(first.body.refresh.cache).toBe('miss');
    expect(second.body.refresh.cache).toBe('hit');
    expect(ranked).toHaveBeenCalledTimes(1);
    const pageId = first.body.state.items[0]?.pageId as string;
    await request(app).get(`/api/sites/${siteId}/pages`).set('Cookie', owner.cookie).expect(200);
    if (pageId) await request(app).get(`/api/sites/${siteId}/pages/${pageId}`).set('Cookie', owner.cookie).expect(200);
    if (pageId) {
      const foreign = await signupVerifiedUser(app, { email: 'pages-foreign-page@example.com' });
      const foreignSiteId = await siteFor(foreign.id);
      await request(app).get(`/api/sites/${foreignSiteId}/pages/${pageId}`).set('Cookie', foreign.cookie).expect(404);
    }
    expect(ranked).toHaveBeenCalledTimes(1);
  });

  it('refreshes an exact GSC property without a keyword provider call and persists a readable sync state', async () => {
    const owner = await signupVerifiedUser(app, { email: 'pages-gsc-spend@example.com' });
    const siteId = await siteFor(owner.id);
    await upsertConnection({ accountId: owner.id, googleAccountEmail: owner.email, refreshToken: 'fake-refresh', scopes: [SCOPE_GSC] });
    await Site.updateOne({ _id: siteId, accountId: owner.id }, { $set: { gscPropertyUrl: 'sc-domain:example.com', gscBindingGenerationId: BINDING_GENERATION_ID, gscBindingSource: 'legacy' } });
    const gsc = createFakeGscProvider();
    const query = vi.spyOn(gsc, 'querySearchAnalytics');
    setGoogleGscProvider(gsc);
    await getTestDb().insert(gscSearchAnalytics).values({ accountId: owner.id, siteId, bindingGenerationId: BINDING_GENERATION_ID, snapshotDate: '2020-01-01', dimensionSet: 'query', windowDays: 28, dimensionKey: 'historical', clicks: 1, impressions: 2, ctr: 0.5, position: 3, fetchedAt: new Date('2020-01-04') });
    const response = await request(app).post(`/api/sites/${siteId}/pages/refresh`).set('Cookie', owner.cookie).send({}).expect(200);
    expect(response.body.refresh).toMatchObject({ source: 'gsc', cache: 'not_applicable' });
    expect(query).toHaveBeenCalled();
    const read = await request(app).get(`/api/sites/${siteId}/pages`).set('Cookie', owner.cookie).expect(200);
    expect(read.body.envelope).toMatchObject({ source: 'gsc', status: 'ready' });
    const pageId = read.body.items[0]?.pageId as string | undefined;
    if (pageId) await request(app).get(`/api/sites/${siteId}/pages/${pageId}`).set('Cookie', owner.cookie).expect(200);
  });

  it('persists empty and failed terminal GSC refresh health without falling through to fallback', async () => {
    const unavailableOwner = await signupVerifiedUser(app, { email: 'pages-gsc-unconfigured@example.com' });
    const unavailableSite = await siteFor(unavailableOwner.id);
    await upsertConnection({ accountId: unavailableOwner.id, googleAccountEmail: unavailableOwner.email, refreshToken: 'fake-refresh', scopes: [SCOPE_GSC] });
    await Site.updateOne({ _id: unavailableSite, accountId: unavailableOwner.id }, { $set: { gscPropertyUrl: 'sc-domain:example.com', gscBindingGenerationId: BINDING_GENERATION_ID, gscBindingSource: 'legacy' } });
    const unavailable = await request(app).post(`/api/sites/${unavailableSite}/pages/refresh`).set('Cookie', unavailableOwner.cookie).send({}).expect(503);
    expect(unavailable.body.error).toMatchObject({ code: 'PAGES_GSC_UNAVAILABLE' });

    const emptyOwner = await signupVerifiedUser(app, { email: 'pages-gsc-empty@example.com' });
    const emptySite = await siteFor(emptyOwner.id);
    await upsertConnection({ accountId: emptyOwner.id, googleAccountEmail: emptyOwner.email, refreshToken: 'fake-refresh', scopes: [SCOPE_GSC] });
    await Site.updateOne({ _id: emptySite, accountId: emptyOwner.id }, { $set: { gscPropertyUrl: 'sc-domain:example.com', gscBindingGenerationId: BINDING_GENERATION_ID, gscBindingSource: 'legacy' } });
    const emptyProvider = createFakeGscProvider();
    vi.spyOn(emptyProvider, 'querySearchAnalytics').mockImplementation(async (_connection, input) => ({ rows: [], sampled: false, startDate: input.startDate, endDate: input.endDate, dimensions: input.dimensions }));
    setGoogleGscProvider(emptyProvider);
    const empty = await request(app).post(`/api/sites/${emptySite}/pages/refresh`).set('Cookie', emptyOwner.cookie).send({}).expect(200);
    expect(empty.body).toMatchObject({ refresh: { outcome: 'empty', source: 'gsc' }, state: { envelope: { source: 'gsc', status: 'empty' } } });

    const failedOwner = await signupVerifiedUser(app, { email: 'pages-gsc-failed@example.com' });
    const failedSite = await siteFor(failedOwner.id);
    await upsertConnection({ accountId: failedOwner.id, googleAccountEmail: failedOwner.email, refreshToken: 'fake-refresh', scopes: [SCOPE_GSC] });
    await Site.updateOne({ _id: failedSite, accountId: failedOwner.id }, { $set: { gscPropertyUrl: 'sc-domain:example.com', gscBindingGenerationId: BINDING_GENERATION_ID, gscBindingSource: 'legacy' } });
    setGoogleGscProvider(createFakeGscProvider({ failure: new VendorUnavailableError('offline', { provider: 'google', operation: 'gsc-search-analytics' }) }));
    const failed = await request(app).post(`/api/sites/${failedSite}/pages/refresh`).set('Cookie', failedOwner.cookie).send({}).expect(503);
    expect(failed.body.error).toMatchObject({ code: 'PAGES_GSC_UNAVAILABLE' });
    const state = await request(app).get(`/api/sites/${failedSite}/pages`).set('Cookie', failedOwner.cookie).expect(200);
    expect(state.body.envelope).toMatchObject({ source: 'gsc', status: 'unavailable' });
  });
});
