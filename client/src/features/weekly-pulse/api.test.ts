import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/api/client', () => ({
  apiClient: vi.fn(),
}));

import { apiClient } from '@shared/api/client';
import {
  getGenerativeAppearance,
  getWeeklyPulseHistoryDetail,
  getWeeklyPulseState,
  listWeeklyPulseHistory,
  previewWeeklyPulse,
  setWeeklyPulseSubscription,
} from './api';

const mocked = vi.mocked(apiClient);

beforeEach(() => {
  mocked.mockReset();
  mocked.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('weekly-pulse api', () => {
  it('getWeeklyPulseState GETs the site pulse path with an encoded site id', async () => {
    await getWeeklyPulseState('s/1');
    const [path, opts] = mocked.mock.calls[0]!;
    expect(path).toBe('/sites/s%2F1/weekly-pulse');
    expect(opts).toMatchObject({ method: 'GET' });
    expect(opts).not.toHaveProperty('signal');
  });

  it('getWeeklyPulseState threads AbortSignal when provided', async () => {
    const controller = new AbortController();
    await getWeeklyPulseState('s1', { signal: controller.signal });
    expect(mocked.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
  });

  it('previewWeeklyPulse POSTs an empty body to the preview path', async () => {
    await previewWeeklyPulse('s1');
    const [path, opts] = mocked.mock.calls[0]!;
    expect(path).toBe('/sites/s1/weekly-pulse/preview');
    expect(opts).toMatchObject({ method: 'POST', body: {} });
    expect(opts).not.toHaveProperty('signal');
  });

  it('previewWeeklyPulse threads AbortSignal when provided', async () => {
    const controller = new AbortController();
    await previewWeeklyPulse('s1', { signal: controller.signal });
    expect(mocked.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
  });

  it('setWeeklyPulseSubscription PUTs the subscription body', async () => {
    await setWeeklyPulseSubscription('s/2', {
      enabled: true,
      acknowledgedPreviewAt: '2026-01-05T09:00:00.000Z',
    });
    const [path, opts] = mocked.mock.calls[0]!;
    expect(path).toBe('/sites/s%2F2/weekly-pulse');
    expect(opts).toMatchObject({
      method: 'PUT',
      body: { enabled: true, acknowledgedPreviewAt: '2026-01-05T09:00:00.000Z' },
    });
  });

  it('setWeeklyPulseSubscription threads AbortSignal when provided', async () => {
    const controller = new AbortController();
    await setWeeklyPulseSubscription('s1', { enabled: false }, {
      signal: controller.signal,
    });
    expect(mocked.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
  });

  it('listWeeklyPulseHistory omits the query string without params', async () => {
    await listWeeklyPulseHistory('s1');
    const [path, opts] = mocked.mock.calls[0]!;
    expect(path).toBe('/sites/s1/weekly-pulse/history');
    expect(opts).toMatchObject({ method: 'GET' });
  });

  it('listWeeklyPulseHistory encodes limit + cursor query params', async () => {
    await listWeeklyPulseHistory('s1', { limit: 10, cursor: 'c 1' });
    const [path] = mocked.mock.calls[0]!;
    expect(path).toBe('/sites/s1/weekly-pulse/history?limit=10&cursor=c+1');
  });

  it('listWeeklyPulseHistory ignores a null cursor and zero limit', async () => {
    await listWeeklyPulseHistory('s1', { limit: 0, cursor: null });
    expect(mocked.mock.calls[0]![0]).toBe('/sites/s1/weekly-pulse/history');
  });

  it('listWeeklyPulseHistory threads AbortSignal when provided', async () => {
    const controller = new AbortController();
    await listWeeklyPulseHistory('s1', { limit: 5 }, { signal: controller.signal });
    expect(mocked.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
  });

  it('getWeeklyPulseHistoryDetail encodes both ids', async () => {
    await getWeeklyPulseHistoryDetail('s/1', 'p/1');
    const [path, opts] = mocked.mock.calls[0]!;
    expect(path).toBe('/sites/s%2F1/weekly-pulse/history/p%2F1');
    expect(opts).toMatchObject({ method: 'GET' });
  });

  it('getWeeklyPulseHistoryDetail threads AbortSignal when provided', async () => {
    const controller = new AbortController();
    await getWeeklyPulseHistoryDetail('s1', 'p1', { signal: controller.signal });
    expect(mocked.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
  });

  it('getGenerativeAppearance GETs the google endpoint with an encoded siteId query', async () => {
    await getGenerativeAppearance('s 1');
    const [path, opts] = mocked.mock.calls[0]!;
    expect(path).toBe('/google/generative-appearance?siteId=s%201');
    expect(opts).toMatchObject({ method: 'GET' });
    expect(opts).not.toHaveProperty('signal');
  });

  it('getGenerativeAppearance threads AbortSignal when provided', async () => {
    const controller = new AbortController();
    await getGenerativeAppearance('s1', { signal: controller.signal });
    expect(mocked.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
  });
});
