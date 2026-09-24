import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@shared/api/client';
import {
  createBrandRadarScan,
  fetchBrandRadarMentions,
  fetchBrandRadarScan,
  fetchBrandRadarScans,
  previewBrandRadarScan,
} from './api';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);
const SITE = '65f000000000000000000abc';

beforeEach(() => {
  mockedApiClient.mockReset();
  mockedApiClient.mockResolvedValue({} as never);
});

describe('brand-radar api wrappers', () => {
  it('posts the preview body to the site-nested preview path', async () => {
    await previewBrandRadarScan(SITE, { brandQuery: 'RankMeFast' });
    expect(mockedApiClient).toHaveBeenCalledWith(`/sites/${SITE}/brand-radar/preview`, {
      method: 'POST',
      body: { brandQuery: 'RankMeFast' },
    });
  });

  it('posts the create body to the site-nested scans path', async () => {
    await createBrandRadarScan(SITE, {
      brandQuery: 'RankMeFast',
      language: 'fr',
      locationCode: 2840,
    });
    expect(mockedApiClient).toHaveBeenCalledWith(`/sites/${SITE}/brand-radar/scans`, {
      method: 'POST',
      body: { brandQuery: 'RankMeFast', language: 'fr', locationCode: 2840 },
    });
  });

  it('lists scans without a query string when no option is supplied', async () => {
    await fetchBrandRadarScans(SITE);
    expect(mockedApiClient).toHaveBeenCalledWith(`/sites/${SITE}/brand-radar/scans`);
  });

  it('serializes limit and cursor and forwards the abort signal', async () => {
    const controller = new AbortController();
    await fetchBrandRadarScans(SITE, {
      limit: 20,
      cursor: 'cur+sor=',
      signal: controller.signal,
    });
    expect(mockedApiClient).toHaveBeenCalledWith(
      `/sites/${SITE}/brand-radar/scans?limit=20&cursor=cur%2Bsor%3D`,
      { signal: controller.signal },
    );
  });

  it('keeps the cursor param out when it is empty', async () => {
    await fetchBrandRadarScans(SITE, { cursor: '' });
    expect(mockedApiClient).toHaveBeenCalledWith(`/sites/${SITE}/brand-radar/scans`);
  });

  it('reads one scan detail, with and without an abort signal', async () => {
    await fetchBrandRadarScan('65f000000000000000000001');
    expect(mockedApiClient).toHaveBeenCalledWith(
      '/brand-radar/scans/65f000000000000000000001',
    );

    const controller = new AbortController();
    await fetchBrandRadarScan('65f000000000000000000001', {
      signal: controller.signal,
    });
    expect(mockedApiClient).toHaveBeenLastCalledWith(
      '/brand-radar/scans/65f000000000000000000001',
      { signal: controller.signal },
    );
  });

  it('reads the mention inventory with no query string by default', async () => {
    await fetchBrandRadarMentions('65f000000000000000000001');
    expect(mockedApiClient).toHaveBeenCalledWith(
      '/brand-radar/scans/65f000000000000000000001/mentions',
    );
  });

  it('serializes the mention limit and cursor and forwards the abort signal', async () => {
    const controller = new AbortController();
    await fetchBrandRadarMentions('65f000000000000000000001', {
      limit: 100,
      cursor: 'cur+sor=',
      signal: controller.signal,
    });
    expect(mockedApiClient).toHaveBeenCalledWith(
      '/brand-radar/scans/65f000000000000000000001/mentions?limit=100&cursor=cur%2Bsor%3D',
      { signal: controller.signal },
    );
  });

  it('keeps an empty mention cursor out of the query string', async () => {
    await fetchBrandRadarMentions('65f000000000000000000001', { cursor: '' });
    expect(mockedApiClient).toHaveBeenCalledWith(
      '/brand-radar/scans/65f000000000000000000001/mentions',
    );
  });
});
