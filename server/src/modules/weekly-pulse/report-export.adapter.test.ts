import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db as database } from '../../db/client.js';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';

const mocked = vi.hoisted(() => ({ pulse: vi.fn() }));

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./weekly-pulse.service.js', () => ({ getPulseHistoryDetail: mocked.pulse }));

import { createWeeklyPulseReportExportAdapter } from './report-export.adapter.js';

const accountId = 'pulse-export-account';
const actorUserId = 'pulse-export-user';
const siteId = '507f1f77bcf86cd799439011';
const pulseId = '507f1f77bcf86cd799439012';
const renderedAt = '2026-08-10T10:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function projection(input: Record<string, unknown> = {}) {
  return {
    header: { renderedAt, title: 'Weekly pulse' },
    coverage: { state: 'complete' },
    citations_new: [{ url: 'https://source.test/new' }],
    citations_lost: [],
    citations_unknown_partial: [],
    confirmed_rank_drops: [{ keyword: 'seo audit' }],
    actions_completed: [],
    actions_regressed: [],
    next_actions_top3: [{ title: 'Fix title' }],
    gsc_appearance: { clicks: 10 },
    brand_deltas: [{ domain: 'example.test', delta: 1 }],
    deep_links: { actions: '/actions' },
    ...input,
  };
}

function detail(input: Record<string, unknown> = {}) {
  return {
    runId: pulseId,
    isoWeek: '2026-W33',
    status: 'succeeded',
    projection: projection(),
    citationChanges: [
      { change: 'new', url: 'https://source.test/new' },
      { change: 'lost', url: 'https://source.test/lost' },
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
      ? { scope: 'site_resource' as const, siteId, resourceId: pulseId }
      : { scope: 'site' as const, siteId },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

function compose(selection: Record<string, unknown>, format: 'pdf' | 'json' = 'json') {
  return { ...access(), selection, format, branding };
}

beforeEach(() => {
  mocked.pulse.mockReset().mockResolvedValue(detail());
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId, url: 'https://example.test', domain: 'example.test', displayName: 'Pulse Site',
    paused: false, pausedAt: null, createdAt: renderedAt, updatedAt: renderedAt,
  });
});

describe('weekly pulse report export adapter', () => {
  it('validates sections, passes actor identity, and enforces resource scope', async () => {
    const adapter = createWeeklyPulseReportExportAdapter(database);
    expect(adapter.selectionSchema.parse({})).toEqual({});
    expect(adapter.selectionSchema.safeParse({ sections: ['unknown'] }).success).toBe(false);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    expect(mocked.pulse).toHaveBeenCalledWith({
      accountId, siteId, userId: actorUserId, pulseId, locale: 'en',
    }, { db: database, queue: null });
    await expect(adapter.assertAccess(access('site'))).rejects.toMatchObject({ status: 404 });
  });

  it('exports every projection section and citation change and renders both formats', async () => {
    const adapter = createWeeklyPulseReportExportAdapter(database);
    const result = await adapter.compose(compose({}));
    expect(result.document.subject[0]?.value).toBe('Pulse Site');
    expect(result.document.completeness.selectedItems).toBe(11);
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: renderedAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('supports an empty selection and a projection without optional brand deltas', async () => {
    mocked.pulse.mockResolvedValue(detail({
      projection: projection({ brand_deltas: undefined }),
    }));
    const adapter = createWeeklyPulseReportExportAdapter(database);
    const result = await adapter.compose(compose({ sections: [] }));
    expect(result.document.completeness.selectedItems).toBe(1);
  });

  it('retains a projection-unavailable run with epoch and site-domain fallbacks', async () => {
    mocked.pulse.mockResolvedValue(detail({ projection: null }));
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt: renderedAt, updatedAt: renderedAt,
    });
    const adapter = createWeeklyPulseReportExportAdapter(database);
    const result = await adapter.compose(compose({ sections: ['header'] }));
    expect(result.document.subject[0]?.value).toBe('example.test');
    expect(result.document.sourceDates[0]?.observedAt).toBe(new Date(0).toISOString());
    expect(result.document.completeness.selectedItems).toBe(1);
  });
});
