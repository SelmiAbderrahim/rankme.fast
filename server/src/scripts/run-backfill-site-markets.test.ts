import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../shared/testing/mongo.js';
import { Site } from '../modules/sites/sites.model.js';
import { User } from '../modules/users/users.model.js';
import { runBackfillSiteMarkets, storedAccountLocale } from './run-backfill-site-markets.js';

beforeAll(startMemoryMongo);
afterAll(stopMemoryMongo);
beforeEach(clearCollections);

describe('site-market backfill runner', () => {
    it('reads a stored account locale and returns null for a missing account', async () => {
        const user = await User.create({ email: 'market-locale@example.com', language: 'de' });
        expect(await storedAccountLocale(String(user._id))).toBe('de');
        expect(await storedAccountLocale(new Types.ObjectId().toString())).toBeNull();
    });

    it('connects, backfills from stored locale, and disconnects', async () => {
        const user = await User.create({ email: 'market-runner@example.com', language: 'de' });
        const site = await Site.create({ accountId: user._id, url: 'https://brand.example.com/', domain: 'brand.example.com' });
        const connect = vi.fn().mockResolvedValue(undefined);
        const disconnect = vi.fn().mockResolvedValue(undefined);
        const logger = { info: vi.fn() };
        const result = await runBackfillSiteMarkets({
            mongoose: { connect, disconnect } as never, mongoUri: 'mongodb://test/isolated',
            catalog: [{ countryCode: 'DE', locationCode: 2276, languageCodes: ['de'] }],
            dryRun: false, logger: logger as never,
        });
        expect(result).toEqual({ inspected: 1, updated: 1, unchanged: 0, errors: 0 });
        expect((await Site.findById(site._id).lean())?.defaultMarket).toMatchObject({
            source: 'inferred', languageCode: 'de', basis: 'locale',
        });
        expect(connect).toHaveBeenCalledWith('mongodb://test/isolated');
        expect(disconnect).toHaveBeenCalledOnce();
    });

    it('disconnects when reading sites fails', async () => {
        const connect = vi.fn().mockResolvedValue(undefined);
        const disconnect = vi.fn().mockResolvedValue(undefined);
        const find = vi.spyOn(Site, 'find').mockImplementationOnce(() => { throw new Error('database read failed'); });
        try {
            await expect(runBackfillSiteMarkets({ mongoose: { connect, disconnect } as never,
                mongoUri: 'mongodb://test/isolated', catalog: [], dryRun: true,
                logger: { info: vi.fn() } as never })).rejects.toThrow('database read failed');
            expect(disconnect).toHaveBeenCalledOnce();
        }
        finally {
            find.mockRestore();
        }
    });
});
