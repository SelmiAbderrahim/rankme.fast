import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { keywords } from '../../db/schema/keywords.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { DEFAULT_PAGES_MARKET, resolvePagesFallbackMarket } from './market-resolver.js';

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

describe('resolvePagesFallbackMarket', () => {
  it('returns the repository default when no active Google keyword exists', async () => {
    const db = getTestDb();
    await db.insert(keywords).values({
      accountId: 'other',
      siteId: 'site',
      phrase: 'ignored',
      locationCode: 2276,
      languageCode: 'de',
      active: true,
      engine: 'google',
    });
    await expect(
      resolvePagesFallbackMarket(db as never, 'account', 'site'),
    ).resolves.toEqual(DEFAULT_PAGES_MARKET);
  });

  it('uses frequency then numeric location and language tie-breaks within the tenant/site', async () => {
    const db = getTestDb();
    await db.insert(keywords).values([
      {
        accountId: 'account', siteId: 'site', phrase: 'one', locationCode: 2840,
        languageCode: 'en', active: true, engine: 'google', device: 'desktop',
      },
      {
        accountId: 'account', siteId: 'site', phrase: 'two', locationCode: 2276,
        languageCode: 'de', active: true, engine: 'google', device: 'desktop',
      },
      {
        accountId: 'account', siteId: 'site', phrase: 'three', locationCode: 2276,
        languageCode: 'en', active: true, engine: 'google', device: 'desktop',
      },
      {
        accountId: 'account', siteId: 'site', phrase: 'inactive', locationCode: 2036,
        languageCode: 'en', active: false, engine: 'google', device: 'desktop',
      },
      {
        accountId: 'account', siteId: 'site', phrase: 'bing', locationCode: 2036,
        languageCode: 'en', active: true, engine: 'bing', device: 'desktop',
      },
    ]);
    await expect(
      resolvePagesFallbackMarket(db as never, 'account', 'site'),
    ).resolves.toEqual({
      locationCode: 2276,
      languageCode: 'de',
      selection: 'tracked_keyword_mode',
    });

    await db.insert(keywords).values({
      accountId: 'account', siteId: 'site', phrase: 'four', locationCode: 2840,
      languageCode: 'en', active: true, engine: 'google', device: 'mobile',
    });
    await expect(
      resolvePagesFallbackMarket(db as never, 'account', 'site'),
    ).resolves.toMatchObject({ locationCode: 2840, languageCode: 'en' });
  });
});
