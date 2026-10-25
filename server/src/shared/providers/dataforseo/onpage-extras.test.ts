import { describe, expect, it, beforeAll, afterEach, afterAll } from 'vitest';
import { providerContractTests } from '../../testing/fixtures/contract.js';
import { mockVendor, vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import { fetchDuplicateTagGroups, fetchRedirectChains, readDuplicateContent, readWaterfall,
  fetchResources, readPagesByResource, readExtraSignals } from './onpage-extras.js';
import type { AuditPage } from '../types.js';

const cfg = { login: 'sandbox-login', password: 'sandbox-password', baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60, maxRetries: 0, backoffBaseMs: 1, random: () => 0 };
const id = 'TASK_ID';
const url = 'https://example.com/blog/a?id=7';

providerContractTests({ title: 'duplicate tag groups', fixtureProvider: 'dataforseo-onpage',
  fixtureOperation: 'duplicate-tags', makeCall: () => fetchDuplicateTagGroups(cfg, id, 100),
  assertSuccess: (groups) => expect(groups.some((group) => group.urls.length >= 2)).toBe(true) });
providerContractTests({ title: 'redirect chains', fixtureProvider: 'dataforseo-onpage',
  fixtureOperation: 'redirect-chains', makeCall: () => fetchRedirectChains(cfg, id, 100),
  assertSuccess: (chains) => expect(chains[0]?.hops.length).toBeGreaterThan(1) });
providerContractTests({ title: 'near duplicate content', fixtureProvider: 'dataforseo-onpage',
  fixtureOperation: 'duplicate-content', makeCall: () => readDuplicateContent(cfg, id, url),
  assertSuccess: (matches) => expect(matches[0]).toMatchObject({ url: 'https://example.com/blog/b', similarity: 8 }) });
providerContractTests({ title: 'page waterfall', fixtureProvider: 'dataforseo-onpage',
  fixtureOperation: 'waterfall', makeCall: () => readWaterfall(cfg, id, url),
  assertSuccess: (ms) => expect(ms).toBe(2400) });
providerContractTests({ title: 'loaded resources', fixtureProvider: 'dataforseo-onpage',
  fixtureOperation: 'resources', makeCall: () => fetchResources(cfg, id, 100),
  assertSuccess: (result) => expect(result.resources.some((resource) => resource.isBroken)).toBe(true) });
providerContractTests({ title: 'pages using a resource', fixtureProvider: 'dataforseo-onpage',
  fixtureOperation: 'pages-by-resource', makeCall: () => readPagesByResource(cfg, id, 'https://example.com/img/missing.png'),
  assertSuccess: (result) => expect(result.urls).toEqual(['https://example.com/', 'https://example.com/new']) });

describe('extra on-page reads', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('leaves a failed extra signal unavailable while retaining the finished crawl', async () => {
    mockVendor('dataforseo-onpage', 'duplicate-tags', 'quota');
    const page: AuditPage = { url, statusCode: 200, title: 'A', metaDescription: null,
      h1: [], h2: [], canonical: null, hasStructuredData: false, structuredDataErrors: [],
      isIndexable: true, brokenLinks: [], onPageScore: 90 };
    const result = await readExtraSignals(cfg, id, [page], { pagesPerRequest: 100, resourceScan: false });
    expect(result.unavailableSignals?.some((signal) => signal.signal === 'duplicate-tags')).toBe(true);
    expect(page.statusCode).toBe(200);
  });
});
