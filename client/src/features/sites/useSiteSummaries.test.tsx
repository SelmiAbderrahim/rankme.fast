import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchSiteSummariesRequest } from './api';
import { useSiteSummaries } from './useSiteSummaries';

vi.mock('./api', () => ({ fetchSiteSummariesRequest: vi.fn() }));
const fetch = vi.mocked(fetchSiteSummariesRequest);

beforeEach(() => vi.clearAllMocks());

it('ignores a late answer for a previous Sites page', async () => {
  let resolveOld!: (value: Awaited<ReturnType<typeof fetch>>) => void;
  fetch.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
  fetch.mockResolvedValueOnce({ summaries: [{ id: 'new', trackedKeywords: 2,
    lastAudit: { state: 'unavailable', reason: 'no_audit' },
    openFixNow: { state: 'unavailable', reason: 'no_audit' } }] });
  const { result, rerender } = renderHook(({ ids }) => useSiteSummaries(ids), { initialProps: { ids: ['old'] } });
  rerender({ ids: ['new'] });
  await waitFor(() => expect(result.current.byId.get('new')?.trackedKeywords).toBe(2));
  await act(async () => { resolveOld({ summaries: [] }); });
  expect(result.current.byId.get('new')?.trackedKeywords).toBe(2);
});

it('reports a failed summary read and clears it when the page becomes empty', async () => {
  fetch.mockRejectedValueOnce(new Error('offline'));
  const { result, rerender } = renderHook(({ ids }) => useSiteSummaries(ids), { initialProps: { ids: ['site-1'] } });
  await waitFor(() => expect(result.current.failed).toBe(true));
  rerender({ ids: [] });
  await waitFor(() => expect(result.current).toMatchObject({ loading: false, failed: false }));
  expect(result.current.byId.size).toBe(0);
});

it('ignores a late failure for a previous Sites page', async () => {
  let rejectOld!: (reason: unknown) => void;
  fetch.mockReturnValueOnce(new Promise((_, reject) => { rejectOld = reject; }));
  fetch.mockResolvedValueOnce({ summaries: [] });
  const { result, rerender } = renderHook(({ ids }) => useSiteSummaries(ids), { initialProps: { ids: ['old'] } });
  rerender({ ids: ['new'] });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { rejectOld(new Error('offline')); });
  expect(result.current.failed).toBe(false);
});

