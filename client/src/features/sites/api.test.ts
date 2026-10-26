import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '@shared/api/client';
import {
  createSiteRequest,
  deleteSiteRequest,
  fetchSiteRequest,
  fetchSiteMarketRequest,
  fetchSiteSummariesRequest,
  fetchSitesRequest,
  pauseSiteRequest,
  resumeSiteRequest,
  updateSiteMarketRequest,
  updateSiteRequest,
} from './api';

vi.mock('@shared/api/client', () => ({ apiClient: vi.fn() }));
const apiClient = vi.mocked(client.apiClient);

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.mockResolvedValue({} as never);
});

describe('sites api wrappers', () => {
  it('fetchSitesRequest lists without a cursor', async () => {
    await fetchSitesRequest();
    expect(apiClient).toHaveBeenCalledWith('/sites');
  });

  it('fetchSitesRequest encodes the cursor', async () => {
    await fetchSitesRequest('abc/123');
    expect(apiClient).toHaveBeenCalledWith('/sites?cursor=abc%2F123');
  });

  it('fetchSitesRequest treats null cursor as first page', async () => {
    await fetchSitesRequest(null);
    expect(apiClient).toHaveBeenCalledWith('/sites');
  });

  it('fetchSitesRequest supports an explicit picker size and abort signal', async () => {
    const signal = new AbortController().signal;
    await fetchSitesRequest('a/b', signal, 100);
    expect(apiClient).toHaveBeenCalledWith('/sites?cursor=a%2Fb&limit=100', { signal });
    await fetchSitesRequest(null, undefined, 100);
    expect(apiClient).toHaveBeenCalledWith('/sites?limit=100');
  });

  it('fetchSiteRequest reads one site by encoded id', async () => {
    await fetchSiteRequest('a/b');
    expect(apiClient).toHaveBeenCalledWith('/sites/a%2Fb');
  });

  it('createSiteRequest posts the url', async () => {
    await createSiteRequest('https://example.com');
    expect(apiClient).toHaveBeenCalledWith('/sites', {
      method: 'POST',
      body: { url: 'https://example.com' },
    });
  });

  it('deleteSiteRequest deletes by id', async () => {
    await deleteSiteRequest('s-1');
    expect(apiClient).toHaveBeenCalledWith('/sites/s-1', { method: 'DELETE' });
  });

  it('updateSiteRequest patches the displayName', async () => {
    await updateSiteRequest('s-1', 'My blog');
    expect(apiClient).toHaveBeenCalledWith('/sites/s-1', {
      method: 'PATCH',
      body: { displayName: 'My blog' },
    });
  });

  it('pauseSiteRequest posts to the pause endpoint', async () => {
    await pauseSiteRequest('s-1');
    expect(apiClient).toHaveBeenCalledWith('/sites/s-1/pause', { method: 'POST' });
  });

  it('resumeSiteRequest posts to the resume endpoint', async () => {
    await resumeSiteRequest('s-1');
    expect(apiClient).toHaveBeenCalledWith('/sites/s-1/resume', { method: 'POST' });
  });

  it('reads site summaries for a comma-separated, encoded list of ids', async () => {
    await fetchSiteSummariesRequest(['a', 'b/c']);
    expect(apiClient).toHaveBeenCalledWith('/dashboard/site-summaries?ids=a%2Cb%2Fc');
  });

  it('saves a default market and reads the resolved market, with and without an abort signal', async () => {
    const market = { locationCode: 2276, languageCode: 'de', device: 'mobile' as const };
    await updateSiteMarketRequest('a/b', market);
    expect(apiClient).toHaveBeenCalledWith('/sites/a%2Fb', { method: 'PATCH', body: { defaultMarket: market } });
    await fetchSiteMarketRequest('a/b');
    expect(apiClient).toHaveBeenLastCalledWith('/sites/a%2Fb/market', {});
    const { signal } = new AbortController();
    await fetchSiteMarketRequest('a/b', signal);
    expect(apiClient).toHaveBeenLastCalledWith('/sites/a%2Fb/market', { signal });
  });
});
