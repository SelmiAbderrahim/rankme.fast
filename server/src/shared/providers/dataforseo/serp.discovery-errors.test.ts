/**
 * `searchPublicPages` — non-vendor error passthrough.
 *
 * Isolated from `serp.test.ts` because `vi.mock` is file-hoisted: stubbing
 * `dataForSeoRequest` here lets the test throw an error that the shared HTTP
 * client can never produce through the mocked transport (it classifies every
 * transport fault into a `Vendor*Error`). An unclassified error must reach
 * the queue unchanged so BullMQ retry semantics apply.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SiteMarket } from '../../observations/types.js';

vi.mock('../http.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, dataForSeoRequest: vi.fn() };
});

const { dataForSeoRequest } = await import('../http.js');
const { createDataForSeoRankProvider } = await import('./serp.js');

const US_MARKET: SiteMarket = {
  country: 'US',
  region: null,
  city: null,
  language: 'en',
  device: 'desktop',
};

describe('DataForSeoRankProvider.searchPublicPages — unclassified errors', () => {
  it('propagates a non-vendor error unchanged instead of skipping the query', async () => {
    vi.mocked(dataForSeoRequest).mockRejectedValueOnce(new Error('kernel panic'));
    const provider = createDataForSeoRankProvider({
      login: 'sandbox-login',
      password: 'sandbox-password',
      baseUrl: 'https://dataforseo.mock/v3',
    });
    await expect(
      provider.searchPublicPages({
        queries: [{ id: 'q1', text: 'query one' }],
        siteMarket: US_MARKET,
        perQueryLimit: 1,
      }),
    ).rejects.toThrow('kernel panic');
  });
});
