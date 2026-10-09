import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '@shared/api/client';
import * as api from './api';
import { useSiteLookup } from './useSiteLookup';
import type { Site } from './types';

vi.mock('./api', () => ({ fetchSiteRequest: vi.fn() }));
const fetchSite = vi.mocked(api.fetchSiteRequest);

const site = (id: string): Site => ({
  id,
  url: `https://${id}.example`,
  domain: `${id}.example`,
  displayName: id,
  paused: false,
  pausedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
});

describe('useSiteLookup', () => {
  beforeEach(() => fetchSite.mockReset());

  it('stays idle and never calls the API while disabled', () => {
    const { result } = renderHook(() => useSiteLookup('a', false));
    expect(result.current.status).toBe('idle');
    expect(fetchSite).not.toHaveBeenCalled();
  });

  it('resolves a found site, then drops it when the id changes', async () => {
    fetchSite.mockResolvedValueOnce({ site: site('a') });
    const { result, rerender } = renderHook(({ id }) => useSiteLookup(id, true), {
      initialProps: { id: 'a' },
    });
    await waitFor(() => expect(result.current.status).toBe('found'));
    expect(result.current.site?.id).toBe('a');

    fetchSite.mockRejectedValueOnce(new ApiError('Not found', 404, null));
    rerender({ id: 'b' });
    await waitFor(() => expect(result.current.status).toBe('notFound'));
    expect(result.current.site).toBeNull();
  });

  it('maps 404 to notFound and everything else to a retryable error', async () => {
    fetchSite.mockRejectedValueOnce(new ApiError('Gateway', 502, null));
    const { result } = renderHook(() => useSiteLookup('a', true));
    await waitFor(() => expect(result.current.status).toBe('error'));

    fetchSite.mockRejectedValueOnce(new ApiError('Not found', 404, null));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('notFound'));
  });

  it('ignores a response that lands after unmount', async () => {
    let resolve!: (value: { site: Site }) => void;
    fetchSite.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const first = renderHook(() => useSiteLookup('a', true));
    first.unmount();
    await act(async () => resolve({ site: site('a') }));

    let reject!: (reason: unknown) => void;
    fetchSite.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
    const second = renderHook(() => useSiteLookup('a', true));
    second.unmount();
    await act(async () => reject(new Error('late')));
    expect(fetchSite).toHaveBeenCalledTimes(2);
  });
});
