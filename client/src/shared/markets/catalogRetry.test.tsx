import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@shared/api/client';
import { __resetPresentationLocaleForTests, setPresentationLocale } from '@shared/i18n/presentationLocale';
import { useMarketCatalog } from './useMarketCatalog';
import type { MarketCatalogResponse } from './types';

const fetchCatalog = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ fetchMarketCatalog: fetchCatalog }));
const catalog: MarketCatalogResponse = { surface: 'seo', markets: [{ countryCode: 'FR', locationCode: 2250, languageCodes: ['fr'] }], fetchedAt: '2026-10-01T00:00:00Z', cached: true };
beforeEach(() => { vi.useFakeTimers(); fetchCatalog.mockReset(); __resetPresentationLocaleForTests(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const flush = () => act(async () => { await Promise.resolve(); });

describe('market catalogue recovery', () => {
  it('backs off transient failures at 250ms and 750ms before succeeding', async () => {
    fetchCatalog.mockRejectedValueOnce(new TypeError('offline')).mockRejectedValueOnce(new ApiError('busy', 429, null)).mockResolvedValueOnce(catalog);
    const { result } = renderHook(() => useMarketCatalog('seo'));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(249); });
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(749); });
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchCatalog).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ markets: catalog.markets, loading: false, error: false });
  });

  it.each([
    new ApiError('offline', 0, null, 'network'), new ApiError('slow', 0, null, 'timeout'),
    new ApiError('wait', 408, null), new ApiError('wait', 425, null), new ApiError('busy', 503, null),
    new DOMException('offline', 'NetworkError'),
  ])('bounds transient retries for %s', async (error) => {
    fetchCatalog.mockRejectedValue(error);
    const { result } = renderHook(() => useMarketCatalog('seo'));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetchCatalog).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ loading: false, error: true });
  });

  it.each([new ApiError('invalid', 400, null), new Error('invalid payload'), { name: 'AbortError' }])('does not retry non-transient refusals or validation failures', async (error) => {
    fetchCatalog.mockRejectedValueOnce(error).mockResolvedValueOnce(catalog);
    const { result } = renderHook(() => useMarketCatalog('seo'));
    await flush();
    expect(result.current.error).toBe(true);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    act(() => result.current.retry());
    await flush();
    expect(result.current).toMatchObject({ markets: catalog.markets, loading: false, error: false });
  });

  it('cancels a pending backoff when unmounted', async () => {
    fetchCatalog.mockRejectedValue(new TypeError('offline'));
    const view = renderHook(() => useMarketCatalog('seo'));
    await flush();
    const signal = fetchCatalog.mock.calls[0]![1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reloads after a locale change and ignores the old response', async () => {
    let resolveOld!: (value: MarketCatalogResponse) => void;
    fetchCatalog.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce(catalog);
    const { result } = renderHook(() => useMarketCatalog('seo'));
    const oldSignal = fetchCatalog.mock.calls[0]![1] as AbortSignal;
    act(() => { setPresentationLocale('ar'); });
    await flush();
    expect(oldSignal.aborted).toBe(true);
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    await act(async () => { resolveOld({ ...catalog, markets: [] }); });
    expect(result.current.markets).toEqual(catalog.markets);
    expect(result.current.error).toBe(false);
  });

  it('does not present transport cancellation as a catalogue failure', async () => {
    fetchCatalog.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    const { result } = renderHook(() => useMarketCatalog('seo'));
    await flush();
    expect(result.current.error).toBe(false);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });
});
