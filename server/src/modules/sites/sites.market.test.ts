import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { installTestAuth, signupVerifiedUser, uninstallTestAuth } from '../../shared/testing/auth.js';
import { __setCsrfBypassForTests } from '../../shared/middleware/csrf.js';
import { createFakeAppDataProvider, createFakeContentAnalysisProvider, createFakeKeywordProvider } from '../../shared/providers/fakes.js';
import { setMarketCatalogDeps } from '../market-catalog/index.js';
import { setTeamDb } from '../team/team.holder.js';
import { setSitesDb } from './sites.holder.js';
import { Site } from './sites.model.js';
import { getSiteMarket, updateSite } from './sites.service.js';

const app = createApp();
const catalogProvider = createFakeKeywordProvider();
const listMarkets = vi.spyOn(catalogProvider, 'listMarkets');

beforeAll(async () => {
    await startMemoryMongo();
    const db = await startTestPostgres();
    installTestAuth();
    setSitesDb(db as never);
    setTeamDb(db as never);
    __setCsrfBypassForTests(true);
});
afterAll(async () => {
    __setCsrfBypassForTests(false);
    uninstallTestAuth();
    setMarketCatalogDeps(null);
    setSitesDb(null);
    setTeamDb(null);
    await stopTestPostgres();
    await stopMemoryMongo();
});
beforeEach(async () => {
    await clearCollections();
    await truncateAllTables();
    listMarkets.mockClear();
    setMarketCatalogDeps({
        db: getTestDb() as never,
        keywordProvider: catalogProvider,
        contentAnalysisProvider: createFakeContentAnalysisProvider(),
        appDataProvider: createFakeAppDataProvider(),
    });
});

describe('site default market', () => {
    it('infers a country market at creation without a live provider', async () => {
        const user = await signupVerifiedUser(app, { email: 'site-market-create@example.test' });
        const response = await request(app).post('/api/sites').set('Cookie', user.cookie)
            .send({ url: 'https://store.example.sa' });
        expect(response.status).toBe(201);
        expect(response.body.site.defaultMarket).toMatchObject({
            locationCode: 2682, languageCode: 'ar', device: 'desktop', source: 'inferred',
        });
    });

    it('lets the owner save a catalog market without changing the site name', async () => {
        const user = await signupVerifiedUser(app, { email: 'site-market-edit@example.test' });
        const site = await Site.create({ accountId: user.id, url: 'https://store.example.sa/', domain: 'store.example.sa' });
        const response = await request(app).patch(`/api/sites/${site._id}`).set('Cookie', user.cookie)
            .send({ defaultMarket: { locationCode: 2840, languageCode: 'es', device: 'mobile' } });
        expect(response.status).toBe(200);
        expect(response.body.site.defaultMarket).toMatchObject({ source: 'owner', locationCode: 2840, languageCode: 'es' });
        expect(response.body.site.displayName).toBe('');
        const read = await request(app).get(`/api/sites/${site._id}/market`).set('Cookie', user.cookie);
        expect(read.status).toBe(200);
        expect(read.body.market).toMatchObject({ source: 'owner', countryCode: 'US' });
    });

    it('rejects another account site before reading the catalog', async () => {
        const alice = await signupVerifiedUser(app, { email: 'site-market-alice@example.test' });
        const bob = await signupVerifiedUser(app, { email: 'site-market-bob@example.test' });
        const site = await Site.create({ accountId: bob.id, url: 'https://store.example.sa/', domain: 'store.example.sa' });
        const update = await request(app).patch(`/api/sites/${site._id}`).set('Cookie', alice.cookie)
            .send({ defaultMarket: { locationCode: 2840, languageCode: 'en', device: 'desktop' } });
        expect(update.status).toBe(404);
        const read = await request(app).get(`/api/sites/${site._id}/market`).set('Cookie', alice.cookie);
        expect(read.status).toBe(404);
        expect(listMarkets).not.toHaveBeenCalled();
        expect((await Site.findById(site._id).lean())?.defaultMarket).toBeNull();
    });

    it('rejects invalid site ids and unsupported owner market choices', async () => {
        const user = await signupVerifiedUser(app, { email: 'site-market-invalid@example.test' });
        const site = await Site.create({ accountId: user.id, url: 'https://store.example.sa/', domain: 'store.example.sa' });
        expect((await request(app).get('/api/sites/not-an-id/market').set('Cookie', user.cookie)).status).toBe(404);
        const response = await request(app).patch(`/api/sites/${site._id}`).set('Cookie', user.cookie)
            .send({ defaultMarket: { locationCode: 2840, languageCode: 'zz', device: 'mobile' } });
        expect(response.status).toBe(400);
        expect((await Site.findById(site._id).lean())?.defaultMarket).toBeNull();
    });

    it('keeps existing market reads available while catalog service is unavailable', async () => {
        const user = await signupVerifiedUser(app, { email: 'site-market-unavailable@example.test' });
        const site = await Site.create({ accountId: user.id, url: 'https://store.example.sa/', domain: 'store.example.sa' });
        setMarketCatalogDeps(null);
        const read = await request(app).get(`/api/sites/${site._id}/market`).set('Cookie', user.cookie);
        expect(read.status).toBe(200);
        expect(read.body.market).toMatchObject({ source: 'cctld', languageCode: 'ar' });
        const update = await request(app).patch(`/api/sites/${site._id}`).set('Cookie', user.cookie)
            .send({ defaultMarket: { locationCode: 2840, languageCode: 'en', device: 'desktop' } });
        expect(update.status).toBe(503);
    });

    it('rejects a vanished owned site during a direct market read or update', async () => {
        const user = await signupVerifiedUser(app, { email: 'site-market-race@example.test' });
        const absent = new Site({ accountId: user.id, url: 'https://absent.example.com/', domain: 'absent.example.com' });
        await expect(getSiteMarket(user.id, String(absent._id))).rejects.toMatchObject({ status: 404 });
        const site = await Site.create({ accountId: user.id, url: 'https://race.example.com/', domain: 'race.example.com' });
        const update = vi.spyOn(Site, 'findOneAndUpdate').mockResolvedValueOnce(null as never);
        try {
            await expect(updateSite(user.id, String(site._id), { displayName: 'New name' }))
                .rejects.toMatchObject({ status: 404 });
        }
        finally {
            update.mockRestore();
        }
        expect((await Site.findById(site._id).lean())?.displayName).toBe('');
    });
});
