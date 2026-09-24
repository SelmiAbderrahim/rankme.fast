import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db as database } from '../../db/client.js';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';

const mocked = vi.hoisted(() => ({ scan: vi.fn() }));

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./geogrid.service.js', () => ({ getGeogridScan: mocked.scan }));

import { createGeogridReportExportAdapter } from './report-export.adapter.js';

const accountId = 'geogrid-export-account';
const actorUserId = 'geogrid-export-user';
const siteId = '507f1f77bcf86cd799439011';
const scanId = '13bea72e-4fc8-495d-bcd7-03841ee099d2';
const createdAt = '2026-08-10T09:00:00.000Z';
const finishedAt = '2026-08-10T10:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function scan(input: Record<string, unknown> = {}) {
  return {
    id: scanId, keywordId: 'keyword-1', keyword: 'seo agency', status: 'succeeded',
    centerLat: 40, centerLng: -73, spacingMeters: 500, gridSize: 3, zoom: 14,
    totalCells: 3, observedCells: 1, notInPackCells: 1, failedCells: 1,
    createdAt, finishedAt, failureReason: null,
    cells: [
      { pointIndex: 0, lat: 40, lng: -73, state: 'observed', position: 2, totalPackSize: 3, capturedAt: '2026-08-10T09:30:00.000Z' },
      { pointIndex: 1, lat: 40.01, lng: -73, state: 'not_in_pack', position: null, totalPackSize: 3, capturedAt: '2026-08-10T09:40:00.000Z' },
      { pointIndex: 2, lat: 40.02, lng: -73, state: 'failed' },
    ],
    ...input,
  };
}

function access(scope: 'site_resource' | 'site' = 'site_resource') {
  return {
    accountId,
    actorUserId,
    purpose: 'create' as const,
    target: scope === 'site_resource'
      ? { scope: 'site_resource' as const, siteId, resourceId: scanId }
      : { scope: 'site' as const, siteId },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

function compose(selection: Record<string, unknown>, format: 'pdf' | 'csv' | 'json' = 'json') {
  return { ...access(), selection, format, branding };
}

beforeEach(() => {
  mocked.scan.mockReset().mockResolvedValue(scan());
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId, url: 'https://example.test', domain: 'example.test', displayName: 'Grid Site',
    paused: false, pausedAt: null, createdAt, updatedAt: finishedAt,
  });
});

describe('geogrid report export adapter', () => {
  it('validates cell states, preserves owner inputs, and enforces resource scope', async () => {
    const adapter = createGeogridReportExportAdapter(database);
    expect(adapter.selectionSchema.parse({})).toEqual({});
    expect(adapter.selectionSchema.safeParse({ state: ['unknown'] }).success).toBe(false);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    expect(mocked.scan).toHaveBeenCalledWith(accountId, siteId, scanId, { db: database });
    await expect(adapter.assertAccess(access('site'))).rejects.toMatchObject({ status: 404 });
  });

  it('exports observed, bounded-miss, and failed cell truth states and renders every format', async () => {
    const adapter = createGeogridReportExportAdapter(database);
    const result = await adapter.compose(compose({}));
    expect(result.document.subject[0]?.value).toBe('Grid Site');
    expect(result.document.completeness.selectedItems).toBe(3);
    expect(result.document.sourceDates[0]?.observedAt).toBe('2026-08-10T09:40:00.000Z');
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: finishedAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('filters states independently', async () => {
    const adapter = createGeogridReportExportAdapter(database);
    for (const state of ['observed', 'not_in_pack', 'failed'] as const) {
      const result = await adapter.compose(compose({ state: [state] }));
      expect(result.document.completeness.selectedItems).toBe(1);
    }
    const empty = await adapter.compose(compose({ state: [] }));
    expect(empty.document.completeness.selectedItems).toBe(0);
  });

  it('uses finished, created, and site-domain fallbacks when no captured cells remain', async () => {
    mocked.scan.mockResolvedValue(scan({ cells: [{ pointIndex: 2, lat: 40, lng: -73, state: 'failed' }] }));
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt, updatedAt: finishedAt,
    });
    const adapter = createGeogridReportExportAdapter(database);
    let result = await adapter.compose(compose({}));
    expect(result.document.subject[0]?.value).toBe('example.test');
    expect(result.document.sourceDates[0]?.observedAt).toBe(finishedAt);

    mocked.scan.mockResolvedValueOnce(scan({ cells: [], finishedAt: null }));
    result = await adapter.compose(compose({}));
    expect(result.document.sourceDates[0]?.observedAt).toBe(createdAt);
  });
});
