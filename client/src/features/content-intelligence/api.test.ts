import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/api/client', () => ({
  apiClient: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;
    code: string;
    constructor(status: number, data: unknown, code = 'http') {
      super('api');
      this.status = status;
      this.data = data;
      this.code = code;
    }
  },
}));

import { apiClient } from '@shared/api/client';
import {
  cancelAnalysis,
  getAnalysis,
  listAnalyses,
  preflightAnalysis,
  regenerateAnalysis,
  startAnalysis,
  saveDraftVersion,
  saveBriefVersion,
  getRecommendationOutcome,
  getRecommendationApplicationCheck,
  listRecommendationHistory,
  mutateRecommendation,
  cancelInventory,
  getInventoryRun,
  listInventoryRuns,
  startInventory,
  suggestCompetitors,
  listCompetitors,
  addCompetitor,
  archiveCompetitor,
  restoreCompetitor,
  startCompetitorRun,
  listCompetitorRuns,
  getCompetitorRun,
  cancelCompetitorRun,
  listMonitors,
  createMonitor,
  getMonitorFeed,
  pauseMonitor,
  resumeMonitor,
  deleteMonitor,
  getMonitorNotifications,
  patchMonitorNotifications,
} from './api';

const mocked = vi.mocked(apiClient);

beforeEach(() => {
  mocked.mockReset();
  mocked.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('content-intelligence api', () => {
  it('startAnalysis POSTs to /sites/:siteId/content-analyses', async () => {
    await startAnalysis({
      siteId: 's1',
      ownedUrl: 'https://x/',
      keyword: 'k',
      locale: 'en',
      clientKey: 'cli-1',
    });
    expect(mocked).toHaveBeenCalledWith(
      '/sites/s1/content-analyses',
      expect.objectContaining({
        method: 'POST',
        body: {
          ownedUrl: 'https://x/',
          keyword: 'k',
          locale: 'en',
          clientKey: 'cli-1',
        },
      }),
    );
  });

  it('preflightAnalysis POSTs preflight route', async () => {
    await preflightAnalysis({
      siteId: 's1',
      ownedUrl: 'https://x/',
      keyword: 'k',
      locale: 'en',
    });
    expect(mocked).toHaveBeenCalledWith(
      '/sites/s1/content-analyses/preflight',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('saves explicit draft versions', async () => {
    await saveDraftVersion('analysis/one', 'safe markdown', 'client-key');
    expect(mocked).toHaveBeenLastCalledWith(
      '/content-analyses/analysis%2Fone/draft-versions',
      { method: 'POST', body: { markdown: 'safe markdown', clientKey: 'client-key' } },
    );
    const sections = [{ heading: 'Evidence', body: 'Use cited evidence.' }];
    await saveBriefVersion('analysis/one', sections, 'brief-client-key');
    expect(mocked).toHaveBeenLastCalledWith(
      '/content-analyses/analysis%2Fone/brief-versions',
      { method: 'POST', body: { sections, clientKey: 'brief-client-key' } },
    );
  });

  it('supports an unbound detail read', async () => {
    await getAnalysis('analysis/one');
    expect(mocked).toHaveBeenLastCalledWith(
      '/content-analyses/analysis%2Fone',
      { method: 'GET' },
    );
  });

  it('listAnalyses encodes cursor + limit', async () => {
    await listAnalyses({ siteId: 's1', cursor: 'c', limit: 5 });
    const [path] = mocked.mock.calls[0]!;
    expect(path).toBe('/sites/s1/content-analyses?cursor=c&limit=5');
  });

  it('listAnalyses omits query when empty', async () => {
    await listAnalyses({ siteId: 's2' });
    expect(mocked.mock.calls[0]![0]).toBe('/sites/s2/content-analyses');
  });

  it('getAnalysis, cancelAnalysis, regenerateAnalysis hit the right paths', async () => {
    await getAnalysis('a1', 's1');
    expect(mocked.mock.calls[0]![0]).toBe('/content-analyses/a1?siteId=s1');

    await cancelAnalysis('a1');
    expect(mocked.mock.calls[1]![0]).toBe('/content-analyses/a1/cancel');

    await regenerateAnalysis('a1');
    expect(mocked.mock.calls[2]![0]).toBe('/content-analyses/a1/regenerate');
  });

  it('threads AbortSignal', async () => {
    const controller = new AbortController();
    await startAnalysis({ siteId: 's', ownedUrl: 'https://x', keyword: 'k', locale: 'en' }, { signal: controller.signal });
    await preflightAnalysis({ siteId: 's', ownedUrl: 'https://x', keyword: 'k', locale: 'en' }, { signal: controller.signal });
    await listAnalyses({ siteId: 's', cursor: 'only-cursor' }, { signal: controller.signal });
    await getAnalysis('a1', 's', { signal: controller.signal });
    await cancelAnalysis('a1', { signal: controller.signal });
    await regenerateAnalysis('a1', { signal: controller.signal });
    for (const call of mocked.mock.calls) {
      expect(call[1]).toMatchObject({ signal: controller.signal });
    }
    expect(mocked.mock.calls[2]![0]).toContain('cursor=only-cursor');
  });

  it('startInventory POSTs to the site-scoped inventory endpoint', async () => {
    await startInventory({
      siteId: 's1',
      pageLimit: 20,
      allowedPaths: ['/blog'],
      excludedPaths: [],
      sitemapSeeds: ['https://x/sitemap.xml'],
      locale: 'en',
      clientKey: 'inv-1',
    });
    expect(mocked).toHaveBeenCalledWith(
      '/sites/s1/content-intelligence/inventory',
      expect.objectContaining({
        method: 'POST',
        body: {
          pageLimit: 20,
          allowedPaths: ['/blog'],
          excludedPaths: [],
          sitemapSeeds: ['https://x/sitemap.xml'],
          locale: 'en',
          clientKey: 'inv-1',
        },
      }),
    );
  });

  it('listInventoryRuns encodes cursor + limit and omits an empty query', async () => {
    await listInventoryRuns({ siteId: 's1', cursor: 'c', limit: 5 });
    expect(mocked.mock.calls[0]![0]).toBe(
      '/sites/s1/content-intelligence/inventory?cursor=c&limit=5',
    );
    await listInventoryRuns({ siteId: 's2' });
    expect(mocked.mock.calls[1]![0]).toBe('/sites/s2/content-intelligence/inventory');
  });

  it('getInventoryRun + cancelInventory hit site-scoped run paths (no signal)', async () => {
    await getInventoryRun('s1', 'r1');
    expect(mocked.mock.calls[0]![0]).toBe('/sites/s1/content-intelligence/inventory/r1');
    await cancelInventory('s1', 'r1');
    expect(mocked.mock.calls[1]![0]).toBe(
      '/sites/s1/content-intelligence/inventory/r1/cancel',
    );
    for (const call of mocked.mock.calls) {
      expect(call[1]).not.toHaveProperty('signal');
    }
  });

  it('threads an AbortSignal through every inventory call', async () => {
    const controller = new AbortController();
    await startInventory(
      { siteId: 's', pageLimit: 8, allowedPaths: [], excludedPaths: [], sitemapSeeds: [], locale: 'en' },
      { signal: controller.signal },
    );
    await listInventoryRuns({ siteId: 's', cursor: 'only' }, { signal: controller.signal });
    await getInventoryRun('s', 'r1', { signal: controller.signal });
    await cancelInventory('s', 'r1', { signal: controller.signal });
    for (const call of mocked.mock.calls) {
      expect(call[1]).toMatchObject({ signal: controller.signal });
    }
    expect(mocked.mock.calls[1]![0]).toContain('cursor=only');
  });

  it('calls recommendation lifecycle, application check, history, and outcome endpoints', async () => {
    await mutateRecommendation({
      analysisId: 'a/1',
      recommendationId: 'r/1',
      action: 'accept',
      analysisVersion: 'v1',
      expectedVersion: 0,
      clientKey: 'key',
    });
    expect(mocked).toHaveBeenLastCalledWith(
      '/content-analyses/a%2F1/recommendations/r%2F1/accept',
      expect.objectContaining({ method: 'POST', body: expect.not.objectContaining({ confirm: true }) }),
    );
    await mutateRecommendation({
      analysisId: 'a1',
      recommendationId: 'r1',
      action: 'apply',
      analysisVersion: 'v1',
      expectedVersion: 1,
      clientKey: 'key2',
      note: 'done',
    });
    expect(mocked).toHaveBeenLastCalledWith(
      '/content-analyses/a1/recommendations/r1/apply',
      expect.objectContaining({ body: expect.objectContaining({ confirm: true, note: 'done' }) }),
    );
    await listRecommendationHistory('a1', 'r1');
    expect(mocked.mock.calls.at(-1)?.[0]).toBe('/content-analyses/a1/recommendations/r1/history');
    await getRecommendationApplicationCheck('a1', 'r1');
    expect(mocked.mock.calls.at(-1)?.[0])
      .toBe('/content-analyses/a1/recommendations/r1/application-check');
    await getRecommendationOutcome('a1', 'r1');
    expect(mocked.mock.calls.at(-1)?.[0]).toBe('/content-analyses/a1/recommendations/r1/outcome');
  });
});

describe('competitor-content api', () => {
  it('suggestCompetitors + listCompetitors hit site-scoped read paths', async () => {
    await suggestCompetitors('s1');
    expect(mocked.mock.calls[0]![0]).toBe('/sites/s1/competitor-content/suggestions');
    await listCompetitors('s1', 'active');
    expect(mocked.mock.calls[1]![0]).toBe(
      '/sites/s1/competitor-content/competitors?status=active',
    );
    await listCompetitors('s1', 'all');
    expect(mocked.mock.calls[2]![0]).toBe(
      '/sites/s1/competitor-content/competitors?status=all',
    );
  });

  it('addCompetitor POSTs the url + source body', async () => {
    await addCompetitor({ siteId: 's1', url: 'https://x/', source: 'manual' });
    expect(mocked).toHaveBeenCalledWith(
      '/sites/s1/competitor-content/competitors',
      expect.objectContaining({
        method: 'POST',
        body: { url: 'https://x/', source: 'manual' },
      }),
    );
  });

  it('archive + restore competitor hit the id-scoped paths', async () => {
    await archiveCompetitor('s1', 'c1');
    expect(mocked.mock.calls[0]![0]).toBe(
      '/sites/s1/competitor-content/competitors/c1/archive',
    );
    await restoreCompetitor('s1', 'c1');
    expect(mocked.mock.calls[1]![0]).toBe(
      '/sites/s1/competitor-content/competitors/c1/restore',
    );
  });

  it('startCompetitorRun POSTs the run body', async () => {
    await startCompetitorRun({
      siteId: 's1',
      competitorIds: ['c1', 'c2'],
      ownedUrl: 'https://x/p',
      keyword: 'k',
      pageLimit: 15,
      locale: 'en',
      clientKey: 'cc-1',
    });
    expect(mocked).toHaveBeenCalledWith(
      '/sites/s1/competitor-content/runs',
      expect.objectContaining({
        method: 'POST',
        body: {
          competitorIds: ['c1', 'c2'],
          ownedUrl: 'https://x/p',
          keyword: 'k',
          pageLimit: 15,
          locale: 'en',
          clientKey: 'cc-1',
        },
      }),
    );
  });

  it('listCompetitorRuns encodes cursor + limit and omits an empty query', async () => {
    await listCompetitorRuns({ siteId: 's1', cursor: 'c', limit: 5 });
    expect(mocked.mock.calls[0]![0]).toBe(
      '/sites/s1/competitor-content/runs?cursor=c&limit=5',
    );
    await listCompetitorRuns({ siteId: 's2' });
    expect(mocked.mock.calls[1]![0]).toBe('/sites/s2/competitor-content/runs');
  });

  it('getCompetitorRun + cancelCompetitorRun hit run paths (no signal)', async () => {
    await getCompetitorRun('s1', 'r1');
    expect(mocked.mock.calls[0]![0]).toBe('/sites/s1/competitor-content/runs/r1');
    await cancelCompetitorRun('s1', 'r1');
    expect(mocked.mock.calls[1]![0]).toBe('/sites/s1/competitor-content/runs/r1/cancel');
    for (const call of mocked.mock.calls) {
      expect(call[1]).not.toHaveProperty('signal');
    }
  });

  it('threads an AbortSignal through every competitor call', async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    await suggestCompetitors('s', { signal });
    await listCompetitors('s', 'archived', { signal });
    await addCompetitor({ siteId: 's', url: 'https://x', source: 'suggested' }, { signal });
    await archiveCompetitor('s', 'c1', { signal });
    await restoreCompetitor('s', 'c1', { signal });
    await startCompetitorRun(
      { siteId: 's', competitorIds: ['c1'], ownedUrl: 'https://x', pageLimit: 5, locale: 'en' },
      { signal },
    );
    await listCompetitorRuns({ siteId: 's', cursor: 'only' }, { signal });
    await getCompetitorRun('s', 'r1', { signal });
    await cancelCompetitorRun('s', 'r1', { signal });
    for (const call of mocked.mock.calls) {
      expect(call[1]).toMatchObject({ signal });
    }
    expect(mocked.mock.calls[6]![0]).toContain('cursor=only');
  });
});

describe('content-monitoring api', () => {
  it('listMonitors encodes the status query', async () => {
    await listMonitors('s1', 'all');
    expect(mocked.mock.calls[0]![0]).toBe(
      '/sites/s1/content-monitoring/monitors?status=all',
    );
    await listMonitors('s1', 'cap_paused');
    expect(mocked.mock.calls[1]![0]).toBe(
      '/sites/s1/content-monitoring/monitors?status=cap_paused',
    );
  });

  it('createMonitor POSTs the target body', async () => {
    await createMonitor({
      siteId: 's1',
      targetUrl: 'https://example.com/pricing',
      targetKind: 'owned',
      locale: 'en',
    });
    expect(mocked).toHaveBeenCalledWith(
      '/sites/s1/content-monitoring/monitors',
      expect.objectContaining({
        method: 'POST',
        body: { targetUrl: 'https://example.com/pricing', targetKind: 'owned', locale: 'en' },
      }),
    );
  });

  it('getMonitorFeed encodes cursor + limit and omits an empty query', async () => {
    await getMonitorFeed({ siteId: 's1', monitorId: 'm1', cursor: 'c', limit: 20 });
    expect(mocked.mock.calls[0]![0]).toBe(
      '/sites/s1/content-monitoring/monitors/m1?cursor=c&limit=20',
    );
    await getMonitorFeed({ siteId: 's1', monitorId: 'm1' });
    expect(mocked.mock.calls[1]![0]).toBe('/sites/s1/content-monitoring/monitors/m1');
  });

  it('pause + resume + delete hit the id-scoped paths', async () => {
    await pauseMonitor('s1', 'm1');
    expect(mocked.mock.calls[0]![0]).toBe(
      '/sites/s1/content-monitoring/monitors/m1/pause',
    );
    await resumeMonitor('s1', 'm1');
    expect(mocked.mock.calls[1]![0]).toBe(
      '/sites/s1/content-monitoring/monitors/m1/resume',
    );
    await deleteMonitor('s1', 'm1');
    expect(mocked.mock.calls[2]![0]).toBe('/sites/s1/content-monitoring/monitors/m1');
    expect(mocked.mock.calls[2]![1]).toMatchObject({ method: 'DELETE' });
  });

  it('notification pref GET + PATCH hit the users endpoint', async () => {
    await getMonitorNotifications();
    expect(mocked.mock.calls[0]![0]).toBe('/users/notifications');
    expect(mocked.mock.calls[0]![1]).toMatchObject({ method: 'GET' });
    await patchMonitorNotifications(false);
    expect(mocked).toHaveBeenCalledWith(
      '/users/notifications',
      expect.objectContaining({ method: 'PATCH', body: { emailMonitorChange: false } }),
    );
  });

  it('threads an AbortSignal through every monitoring call', async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    await listMonitors('s', 'active', { signal });
    await createMonitor(
      { siteId: 's', targetUrl: 'https://x', targetKind: 'competitor', locale: 'en' },
      { signal },
    );
    await getMonitorFeed({ siteId: 's', monitorId: 'm1', cursor: 'only' }, { signal });
    await pauseMonitor('s', 'm1', { signal });
    await resumeMonitor('s', 'm1', { signal });
    await deleteMonitor('s', 'm1', { signal });
    await getMonitorNotifications({ signal });
    await patchMonitorNotifications(true, { signal });
    for (const call of mocked.mock.calls) {
      expect(call[1]).toMatchObject({ signal });
    }
    expect(mocked.mock.calls[2]![0]).toContain('cursor=only');
  });
});
