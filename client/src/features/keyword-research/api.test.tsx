import { describe, expect, it, vi } from 'vitest';

vi.mock('@shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('@shared/api/client')>(
    '@shared/api/client',
  );
  return {
    ...actual,
    apiClient: vi.fn(async (path: string) => ({ path, ok: true })),
  };
});

import {
  exploreLiveTrendsRequest,
  fetchClusterRunRequest,
  fetchClusterRunsRequest,
  fetchGapRequest,
  fetchLiveTrendsListRequest,
  fetchLiveTrendsRunRequest,
  fetchLongTailRequest,
  previewLiveTrendsRequest,
  fetchHistoryRequest,
  fetchIdeasRequest,
  fetchIntentRequest,
  fetchKeywordPreviewRequest,
  fetchMetricsRequest,
  fetchOverviewRequest,
  fetchRelatedRequest,
  fetchTrendsRequest,
  postClusterDecisionRequest,
  runClustersRequest,
} from './api';
import { apiClient } from '@shared/api/client';

describe('keyword-research api', () => {
  it('POSTs to /keyword-research/metrics', async () => {
    await fetchMetricsRequest({
      keywords: ['a'],
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/metrics', {
      method: 'POST',
      body: { keywords: ['a'], locationCode: 2840, languageCode: 'en' },
    });
  });

  it('POSTs to /keyword-research/related', async () => {
    await fetchRelatedRequest({
      keyword: 'seed',
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/related', {
      method: 'POST',
      body: { keyword: 'seed', locationCode: 2840, languageCode: 'en' },
    });
  });

  it('POSTs to /keyword-research/intent', async () => {
    await fetchIntentRequest({
      keywords: ['a', 'b'],
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/intent', {
      method: 'POST',
      body: { keywords: ['a', 'b'], locationCode: 2840, languageCode: 'en' },
    });
  });

  it('POSTs to /keyword-research/ideas', async () => {
    await fetchIdeasRequest({
      seed: 'seed',
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/ideas', {
      method: 'POST',
      body: { seed: 'seed', locationCode: 2840, languageCode: 'en' },
    });
  });

  it('POSTs to /keyword-research/long-tail', async () => {
    await fetchLongTailRequest({
      seed: 'seed',
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/long-tail', {
      method: 'POST',
      body: { seed: 'seed', locationCode: 2840, languageCode: 'en' },
    });
  });

  it('GETs /keyword-research/history with no querystring by default', async () => {
    await fetchHistoryRequest();
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/history');
  });

  it('GETs /keyword-research/history with cursor only', async () => {
    await fetchHistoryRequest({ cursor: 'abc-123' });
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/history?cursor=abc-123');
  });

  it('GETs /keyword-research/history with limit only', async () => {
    await fetchHistoryRequest({ limit: 5 });
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/history?limit=5');
  });

  it('GETs /keyword-research/history with cursor + limit', async () => {
    await fetchHistoryRequest({ cursor: 'abc-123', limit: 5 });
    expect(apiClient).toHaveBeenCalledWith(
      '/keyword-research/history?cursor=abc-123&limit=5',
    );
  });
});

describe('keyword-intelligence api', () => {
  const market = { locationCode: 2840, languageCode: 'en' };

  it('POSTs to /keyword-research/gap', async () => {
    await fetchGapRequest({
      ownDomain: 'own.example',
      competitors: ['rival.example'],
      ...market,
    });
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/gap', {
      method: 'POST',
      body: { ownDomain: 'own.example', competitors: ['rival.example'], ...market },
    });
  });

  it('POSTs to /keyword-research/overview', async () => {
    await fetchOverviewRequest({ keywords: ['a'], ...market });
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/overview', {
      method: 'POST',
      body: { keywords: ['a'], ...market },
    });
  });

  it('POSTs to /keyword-research/trends', async () => {
    await fetchTrendsRequest({ keywords: ['a', 'b'], ...market });
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/trends', {
      method: 'POST',
      body: { keywords: ['a', 'b'], ...market },
    });
  });

  it('POSTs the discriminated preview union to /keyword-research/preview', async () => {
    await fetchKeywordPreviewRequest({
      operation: 'gap',
      ownDomain: 'own.example',
      competitors: ['rival.example'],
      ...market,
    });
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/preview', {
      method: 'POST',
      body: {
        operation: 'gap',
        ownDomain: 'own.example',
        competitors: ['rival.example'],
        ...market,
      },
    });
    await fetchKeywordPreviewRequest({ operation: 'overview', keywords: ['a'], ...market });
    expect(apiClient).toHaveBeenLastCalledWith('/keyword-research/preview', {
      method: 'POST',
      body: { operation: 'overview', keywords: ['a'], ...market },
    });
  });

  it('POSTs to /keyword-research/clusters', async () => {
    await runClustersRequest({ phrases: ['a'], ...market });
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/clusters', {
      method: 'POST',
      body: { phrases: ['a'], ...market },
    });
  });

  it('GETs /keyword-research/clusters with no querystring by default', async () => {
    await fetchClusterRunsRequest();
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/clusters');
  });

  it('GETs /keyword-research/clusters with cursor + limit', async () => {
    await fetchClusterRunsRequest({ cursor: 'cur', limit: 10 });
    expect(apiClient).toHaveBeenCalledWith(
      '/keyword-research/clusters?cursor=cur&limit=10',
    );
  });

  it('GETs a single cluster run with an encoded run id', async () => {
    await fetchClusterRunRequest('a'.repeat(64));
    expect(apiClient).toHaveBeenCalledWith(
      `/keyword-research/clusters/${'a'.repeat(64)}`,
    );
  });

  // --- Live keyword trends wrappers ----------------------------------------

  it('POSTs the live-trends preview body verbatim', async () => {
    await previewLiveTrendsRequest({
      keywords: ['solar panels'],
      geo: 'us',
      language: 'en',
    });
    expect(apiClient).toHaveBeenCalledWith(
      '/keyword-research/trends/explore/preview',
      {
        method: 'POST',
        body: { keywords: ['solar panels'], geo: 'us', language: 'en' },
      },
    );
  });

  it('POSTs the live-trends exploration body verbatim', async () => {
    await exploreLiveTrendsRequest({
      keywords: ['solar panels', 'heat pump'],
      geo: 'gb',
      language: 'en',
      siteId: 'f'.repeat(24),
    });
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/trends/explore', {
      method: 'POST',
      body: {
        keywords: ['solar panels', 'heat pump'],
        geo: 'gb',
        language: 'en',
        siteId: 'f'.repeat(24),
      },
    });
  });

  it('GETs the stored live-trends list with no querystring by default', async () => {
    await fetchLiveTrendsListRequest();
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/trends');
  });

  it('GETs the stored live-trends list with cursor + limit + siteId', async () => {
    await fetchLiveTrendsListRequest({
      cursor: 'cur',
      limit: 20,
      siteId: 'f'.repeat(24),
    });
    expect(apiClient).toHaveBeenCalledWith(
      `/keyword-research/trends?cursor=cur&limit=20&siteId=${'f'.repeat(24)}`,
    );
  });

  it('GETs a single stored exploration with an encoded run id', async () => {
    await fetchLiveTrendsRunRequest('a b/c');
    expect(apiClient).toHaveBeenCalledWith('/keyword-research/trends/a%20b%2Fc');
  });

  it('POSTs a cluster decision with encoded ids', async () => {
    await postClusterDecisionRequest('r'.repeat(64), 'c'.repeat(64), {
      kind: 'accepted',
      idempotencyKey: 'ik-1',
      siteId: 'f'.repeat(24),
    });
    expect(apiClient).toHaveBeenCalledWith(
      `/keyword-research/clusters/${'r'.repeat(64)}/clusters/${'c'.repeat(64)}/decision`,
      {
        method: 'POST',
        body: { kind: 'accepted', idempotencyKey: 'ik-1', siteId: 'f'.repeat(24) },
      },
    );
  });
});
