import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { resolveKeywordMarket } from './keyword-market.js';

const mocks = vi.hoisted(() => ({
    findOne: vi.fn(),
    resolveSiteMarket: vi.fn(),
    getMarketCatalog: vi.fn(),
}));

vi.mock('../sites/index.js', () => ({
    Site: { findOne: mocks.findOne },
    resolveSiteMarket: mocks.resolveSiteMarket,
    countryForLocation: (code: number) => code === 2276 ? 'DE' : 'US',
    countryLanguage: (country: string) => country === 'DE' ? 'de' : 'en',
}));
vi.mock('../market-catalog/index.js', () => ({
    getMarketCatalog: mocks.getMarketCatalog,
    getMarketCatalogDeps: () => ({}),
}));

const siteId = new Types.ObjectId().toString();
const accountId = new Types.ObjectId().toString();
const base = { accountId, siteId, engine: 'google' };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOne.mockReturnValue({ select: async () => ({ domain: 'example.de' }) });
    mocks.resolveSiteMarket.mockResolvedValue({ locationCode: 2276, languageCode: 'de', device: 'mobile' });
    mocks.getMarketCatalog.mockResolvedValue({ markets: [
        { countryCode: 'DE', locationCode: 2276, languageCodes: ['de', 'en'] },
        { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
    ] });
});

describe('keyword market choice', () => {
    it('uses the site default when the request omits its market', async () => {
        expect(await resolveKeywordMarket(base)).toEqual({ locationCode: 2276, languageCode: 'de', device: 'mobile' });
    });

    it('keeps an explicit country and picks one of its supported languages', async () => {
        expect(await resolveKeywordMarket({ ...base, locationCode: 2840 })).toEqual({
            locationCode: 2840, languageCode: 'en', device: 'mobile',
        });
    });

    it('refuses a foreign site before reading the catalog', async () => {
        mocks.findOne.mockReturnValue({ select: async () => null });
        await expect(resolveKeywordMarket(base)).rejects.toMatchObject({ status: 404 });
        expect(mocks.getMarketCatalog).not.toHaveBeenCalled();
    });

    it('rejects a language not offered for an explicit Google market', async () => {
        await expect(resolveKeywordMarket({ ...base, locationCode: 2276, languageCode: 'fr' }))
            .rejects.toMatchObject({ status: 400 });
    });
});
