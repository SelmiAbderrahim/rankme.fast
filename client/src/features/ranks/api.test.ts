import { describe, expect, it, vi } from 'vitest';

vi.mock('@shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('@shared/api/client')>('@shared/api/client');
  return {
    ...actual,
    apiClient: vi.fn(async (path: string) => ({ path, ok: true })),
  };
});

import {
  checkNowRequest,
  fetchSerpFeatureDetailRequest,
  fetchSerpFeaturesRequest,
  createKeywordRequest,
  fetchKeywordHistoryRequest,
  fetchKeywordSuggestionsRequest,
  fetchKeywordsRequest,
  removeKeywordRequest,
  updateCadenceRequest,
} from './api';
import { apiClient } from '@shared/api/client';

describe('ranks api', () => {
  it('GETs the keyword list, with and without a cursor / abort signal', async () => {
    await fetchKeywordsRequest('site-1');
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/keywords');
    await fetchKeywordsRequest('site-1', 'cur sor');
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/keywords?cursor=cur%20sor');
    const controller = new AbortController();
    await fetchKeywordsRequest('site-1', null, { signal: controller.signal });
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/keywords', {
      signal: controller.signal,
    });
    await fetchKeywordsRequest('site-1', 'next', {
      signal: controller.signal,
      engine: 'bing',
    });
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/keywords?cursor=next&engine=bing', {
      signal: controller.signal,
    });
  });

  it('POSTs a new keyword', async () => {
    const body = {
      phrase: 'seo audit',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop' as const,
    };
    await createKeywordRequest('site-1', body);
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/keywords', {
      method: 'POST',
      body,
    });
  });

  it('POSTs site keyword discovery market input', async () => {
    const body = { locationCode: 2840, languageCode: 'en' };
    await fetchKeywordSuggestionsRequest('site-1', body);
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/keyword-suggestions', {
      method: 'POST',
      body,
    });
  });

  it('POSTs an on-demand rank check', async () => {
    await checkNowRequest('site-1');
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/keywords/check', {
      method: 'POST',
    });
    await checkNowRequest('site-1', 'kw-1');
    expect(apiClient).toHaveBeenCalledWith('/keywords/kw-1/check', {
      method: 'POST',
    });
  });

  it('DELETEs a keyword', async () => {
    await removeKeywordRequest('kw-1');
    expect(apiClient).toHaveBeenCalledWith('/keywords/kw-1', { method: 'DELETE' });
  });

  it('PATCHes the rank cadence', async () => {
    await updateCadenceRequest('site-1', 'daily');
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/rank-cadence', {
      method: 'PATCH',
      body: { cadence: 'daily' },
    });
  });

  it('GETs keyword history, with and without an abort signal', async () => {
    await fetchKeywordHistoryRequest('kw-1');
    expect(apiClient).toHaveBeenCalledWith('/keywords/kw-1/history');
    const controller = new AbortController();
    await fetchKeywordHistoryRequest('kw-1', { signal: controller.signal });
    expect(apiClient).toHaveBeenCalledWith('/keywords/kw-1/history', {
      signal: controller.signal,
    });
  });

  it('GETs stored SERP features for a site and a keyword, with and without a signal', async () => {
    await fetchSerpFeaturesRequest('site-1');
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/serp-features');
    const controller = new AbortController();
    await fetchSerpFeaturesRequest('site-1', { signal: controller.signal });
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/serp-features', {
      signal: controller.signal,
    });

    await fetchSerpFeatureDetailRequest('kw-1');
    expect(apiClient).toHaveBeenCalledWith('/keywords/kw-1/serp-features');
    await fetchSerpFeatureDetailRequest('kw-1', { signal: controller.signal });
    expect(apiClient).toHaveBeenCalledWith('/keywords/kw-1/serp-features', {
      signal: controller.signal,
    });
  });
});
