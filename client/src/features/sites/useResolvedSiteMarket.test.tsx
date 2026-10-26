import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useResolvedSiteMarket } from './useResolvedSiteMarket';
import { fetchSiteMarketRequest } from './api';
import type { Site } from './types';

vi.mock('./api', () => ({ fetchSiteMarketRequest: vi.fn() }));
const fetchMarket = vi.mocked(fetchSiteMarketRequest);
const site = (id: string): Site => ({
  id, url: `https://${id}.example/`, domain: `${id}.example`, displayName: '',
  defaultMarket: { locationCode: 2276, languageCode: 'de', device: 'mobile', source: 'inferred' },
  paused: false, pausedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

beforeEach(() => { vi.clearAllMocks(); });

it('uses the server decision, then refreshes it when the site changes', async () => {
  fetchMarket.mockResolvedValue({ market: {
    locationCode: 2840, languageCode: 'en', device: 'desktop', source: 'search_console', countryCode: 'US',
  } });
  const { result, rerender } = renderHook(({ current }) => useResolvedSiteMarket(current), {
    initialProps: { current: site('first') },
  });
  expect(result.current).toBeUndefined();
  await waitFor(() => expect(result.current).toMatchObject({ source: 'search_console', locationCode: 2840 }));
  rerender({ current: site('second') });
  expect(result.current).toBeUndefined();
  await waitFor(() => expect(fetchMarket).toHaveBeenCalledWith('second', expect.any(AbortSignal)));
});

it('uses the stored market if the resolved read fails', async () => {
  fetchMarket.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useResolvedSiteMarket(site('offline')));
  await waitFor(() => expect(result.current).toEqual({ locationCode: 2276, languageCode: 'de', device: 'mobile' }));
});

it('ignores an answer or a failure that arrives after the site changed', async () => {
  let resolveLate!: (value: Awaited<ReturnType<typeof fetchSiteMarketRequest>>) => void;
  fetchMarket.mockReturnValueOnce(new Promise((resolve) => { resolveLate = resolve; }));
  const first = renderHook(() => useResolvedSiteMarket(site('late')));
  first.unmount();
  resolveLate({ market: { locationCode: 2840, languageCode: 'en', device: 'desktop', source: 'owner', countryCode: 'US' } });

  let rejectLate!: (reason: unknown) => void;
  fetchMarket.mockReturnValueOnce(new Promise((_, reject) => { rejectLate = reject; }));
  const second = renderHook(() => useResolvedSiteMarket(site('later')));
  second.unmount();
  rejectLate(new Error('offline'));
  await Promise.resolve();
  expect(second.result.current).toBeUndefined();
});

it('has no market for a missing site, and none when a site without a stored market cannot be read', async () => {
  expect(renderHook(() => useResolvedSiteMarket(undefined)).result.current).toBeUndefined();
  fetchMarket.mockRejectedValue(new Error('offline'));
  const unmarked = { ...site('plain'), defaultMarket: undefined };
  const { result } = renderHook(() => useResolvedSiteMarket(unmarked));
  await waitFor(() => expect(result.current).toBeNull());
});

