import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db as database } from '../../db/client.js';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';

const mocked = vi.hoisted(() => ({ monitor: vi.fn() }));

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./monitoring.service.js', () => ({ getMonitor: mocked.monitor }));

import { createContentMonitorReportExportAdapter } from './report-export.adapter.js';

const accountId = 'monitor-export-account';
const actorUserId = 'monitor-export-user';
const siteId = '507f1f77bcf86cd799439011';
const monitorId = '507f1f77bcf86cd799439012';
const updatedAt = '2026-08-10T12:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function monitor(input: Record<string, unknown> = {}) {
  return {
    id: monitorId, siteId, targetUrl: 'https://example.test/page',
    targetKind: 'page', status: 'active', updatedAt,
    ...input,
  };
}

function event(input: Record<string, unknown> = {}) {
  return {
    eventKey: 'event-1', kind: 'content_changed', checkId: 'check-1',
    isoWeek: '2026-W33', diffText: 'Title changed.',
    recordedAt: '2026-08-10T10:00:00.000Z',
    ...input,
  };
}

function page(input: {
  feed?: unknown[];
  nextCursor?: string | null;
  monitor?: unknown;
} = {}) {
  return {
    monitor: input.monitor === undefined ? monitor() : input.monitor,
    feed: input.feed ?? [
      event(),
      event({ eventKey: 'event-2', kind: 'metadata_changed', diffText: null, recordedAt: '2026-08-11T10:00:00.000Z' }),
    ],
    nextCursor: input.nextCursor ?? null,
  };
}

function access(scope: 'site_resource' | 'site' = 'site_resource') {
  return {
    accountId,
    actorUserId,
    purpose: 'create' as const,
    target: scope === 'site_resource'
      ? { scope: 'site_resource' as const, siteId, resourceId: monitorId }
      : { scope: 'site' as const, siteId },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

function compose(selection: Record<string, unknown>, format: 'csv' | 'json' = 'json') {
  return { ...access(), selection, format, branding };
}

beforeEach(() => {
  mocked.monitor.mockReset().mockImplementation(async (input) =>
    page({
      feed: input.cursor ? [event({ eventKey: 'event-3', recordedAt: '2026-08-12T10:00:00.000Z' })] : undefined,
      nextCursor: input.cursor ? null : 'next-page',
    }));
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId, url: 'https://example.test', domain: 'example.test', displayName: 'Monitor Site',
    paused: false, pausedAt: null, createdAt: updatedAt, updatedAt,
  });
});

describe('content monitor report export adapter', () => {
  it('validates paired bounded windows, paginates, and enforces resource scope', async () => {
    const adapter = createContentMonitorReportExportAdapter(database);
    expect(adapter.selectionSchema.parse({})).toEqual({});
    expect(adapter.selectionSchema.safeParse({ from: '2026-08-01' }).success).toBe(false);
    expect(adapter.selectionSchema.safeParse({ from: '2026-08-02', to: '2026-08-01' }).success)
      .toBe(false);
    expect(adapter.selectionSchema.safeParse({ from: '2025-01-01', to: '2026-08-01' }).success)
      .toBe(false);
    expect(adapter.selectionSchema.safeParse({ from: '2026-08-01', to: '2026-08-01' }).success)
      .toBe(true);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    expect(mocked.monitor).toHaveBeenCalledTimes(2);
    expect(mocked.monitor).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next-page' }));
    await expect(adapter.assertAccess(access('site'))).rejects.toMatchObject({ status: 404 });
  });

  it('exports retained and unavailable diffs and renders both formats', async () => {
    const adapter = createContentMonitorReportExportAdapter(database);
    const result = await adapter.compose(compose({}));
    expect(result.document.subject[0]?.value).toBe('Monitor Site');
    expect(result.document.completeness.selectedItems).toBe(3);
    expect(result.document.sourceDates[0]?.observedAt).toBe('2026-08-12T10:00:00.000Z');
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: updatedAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('filters event kinds and inclusive dates and uses monitor/domain fallbacks', async () => {
    mocked.monitor.mockResolvedValue(page({ nextCursor: null }));
    const adapter = createContentMonitorReportExportAdapter(database);
    let result = await adapter.compose(compose({
      eventKind: ['metadata_changed'], from: '2026-08-11', to: '2026-08-11',
    }));
    expect(result.document.completeness.selectedItems).toBe(1);

    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt: updatedAt, updatedAt,
    });
    result = await adapter.compose(compose({
      eventKind: ['missing'], from: '2026-08-01', to: '2026-08-20',
    }));
    expect(result.document.subject[0]?.value).toBe('example.test');
    expect(result.document.sourceDates[0]?.observedAt).toBe(updatedAt);
  });

  it('stops at the export bound and diagnoses a missing monitor envelope', async () => {
    const many = Array.from({ length: 1_001 }, (_, index) => event({ eventKey: `event-${index}` }));
    mocked.monitor.mockResolvedValueOnce(page({ feed: many, nextCursor: 'bounded-stop' }));
    const adapter = createContentMonitorReportExportAdapter(database);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    expect(mocked.monitor).toHaveBeenCalledTimes(1);

    mocked.monitor.mockResolvedValueOnce(page({ monitor: null, feed: [], nextCursor: null }));
    await expect(adapter.assertAccess(access())).rejects.toThrow('no monitor');
  });
});
