import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../shared/testing/mongo.js';
import { Site } from '../modules/sites/sites.model.js';
import { backfillSiteMarkets } from './backfill-site-markets.js';

const catalog = [
    { countryCode: 'SA', locationCode: 2682, languageCodes: ['ar'] },
    { countryCode: 'DE', locationCode: 2276, languageCodes: ['de'] },
    { countryCode: 'US', locationCode: 2840, languageCodes: ['en'] },
];
const accountId = new Types.ObjectId();
const create = (domain: string, extra: Record<string, unknown> = {}) => Site.create({
    accountId, url: `https://${domain}/`, domain, ...extra,
});

beforeAll(startMemoryMongo);
afterAll(stopMemoryMongo);
beforeEach(clearCollections);

describe('site-market backfill', () => {
    it('fills missing markets, preserves owner choices, and is idempotent', async () => {
        const saudi = await create('store.sa');
        const owner = await create('owner.de', { defaultMarket: {
            locationCode: 2840, languageCode: 'en', device: 'mobile', source: 'owner',
        } });
        const deleting = await create('deleting.de', { deletionStartedAt: new Date() });
        const deps = { siteModel: Site, catalog, accountLocale: async () => 'de' };
        expect(await backfillSiteMarkets(deps)).toEqual({ inspected: 2, updated: 1, unchanged: 1, errors: 0 });
        expect((await Site.findById(saudi._id).lean())?.defaultMarket).toMatchObject({
            locationCode: 2682, languageCode: 'ar', source: 'inferred', basis: 'cctld',
        });
        expect((await Site.findById(owner._id).lean())?.defaultMarket).toMatchObject({ source: 'owner', device: 'mobile' });
        expect((await Site.findById(deleting._id).lean())?.defaultMarket).toBeNull();
        expect(await backfillSiteMarkets(deps)).toEqual({ inspected: 2, updated: 0, unchanged: 2, errors: 0 });
    });

    it('reports a dry run without changing stored sites', async () => {
        const site = await create('brand.de');
        expect(await backfillSiteMarkets({ siteModel: Site, catalog, accountLocale: async () => null, dryRun: true }))
            .toEqual({ inspected: 1, updated: 1, unchanged: 0, errors: 0 });
        expect((await Site.findById(site._id).lean())?.defaultMarket).toBeNull();
    });
});
