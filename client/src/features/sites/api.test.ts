import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '@shared/api/client';
import {
  createSiteRequest,
  deleteSiteRequest,
  fetchSitesRequest,
  pauseSiteRequest,
  resumeSiteRequest,
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
});
