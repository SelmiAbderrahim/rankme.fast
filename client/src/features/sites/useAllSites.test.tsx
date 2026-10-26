import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSitesRequest } from './api';
import { SITE_PICKER_MAX_PAGES, SITE_PICKER_PAGE_SIZE, useAllSites } from './useAllSites';
import type { Site, SiteListPage } from './types';
vi.mock('./api', () => ({ fetchSitesRequest: vi.fn() }));
const fetchSites = vi.mocked(fetchSitesRequest);
const site = (id: string) => ({ id }) as Site;
beforeEach(() => fetchSites.mockReset());
afterEach(cleanup);

describe('all sites for pickers', () => {
  it('reads every page with an explicit size and preserves site order', async () => {
    fetchSites
      .mockResolvedValueOnce({ sites: [site('a')], nextCursor: 'two' })
      .mockResolvedValueOnce({ sites: [site('b')], nextCursor: null });
    const hook = renderHook(() => useAllSites());
    expect(hook.result.current.status).toBe('loading');
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(hook.result.current.sites.map((item) => item.id)).toEqual(['a', 'b']);
    expect(hook.result.current).toMatchObject({ truncated: false });
    expect(fetchSites.mock.calls).toEqual([
      [null, expect.any(AbortSignal), SITE_PICKER_PAGE_SIZE],
      ['two', expect.any(AbortSignal), SITE_PICKER_PAGE_SIZE],
    ]);
  });

  it('marks a full guard-limited read as partial and detects repeated cursors', async () => {
    let page = 0;
    fetchSites.mockImplementation(async () => ({
      sites: [site(String(page))],
      nextCursor: String(++page),
    }));
    const first = renderHook(() => useAllSites());
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(fetchSites).toHaveBeenCalledTimes(SITE_PICKER_MAX_PAGES);
    expect(first.result.current.sites).toHaveLength(100);
    expect(first.result.current).toMatchObject({ truncated: true });
    first.unmount();
    fetchSites.mockReset().mockResolvedValue({ sites: [], nextCursor: 'same' });
    const second = renderHook(() => useAllSites());
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(fetchSites).toHaveBeenCalledTimes(2);
    expect(second.result.current).toMatchObject({ truncated: true });
  });

  it('exposes partial results on failure and resets on retry', async () => {
    fetchSites
      .mockResolvedValueOnce({ sites: [site('a')], nextCursor: 'two' })
      .mockRejectedValueOnce(new Error('temporary'));
    const hook = renderHook(() => useAllSites());
    await waitFor(() => expect(hook.result.current.status).toBe('error'));
    expect(hook.result.current.sites).toEqual([site('a')]);
    fetchSites.mockResolvedValueOnce({ sites: [], nextCursor: null });
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(hook.result.current.sites).toEqual([]);
  });

  it('aborts on unmount and launches no next page when the old response arrives', async () => {
    let resolve!: (page: SiteListPage) => void;
    fetchSites.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const hook = renderHook(() => useAllSites());
    const signal = fetchSites.mock.calls[0]?.[1] as AbortSignal;
    hook.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ sites: [site('late')], nextCursor: 'two' }));
    expect(fetchSites).toHaveBeenCalledTimes(1);
  });

  it('ignores cancelled errors and a superseded retry response', async () => {
    let reject!: (error: unknown) => void;
    fetchSites.mockReturnValueOnce(
      new Promise((_, r) => {
        reject = r;
      }),
    );
    const hook = renderHook(() => useAllSites());
    fetchSites.mockResolvedValueOnce({ sites: [site('new')], nextCursor: null });
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    await act(async () => reject(new Error('old')));
    expect(hook.result.current.sites).toEqual([site('new')]);
  });
});
