import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db as database } from '../../db/client.js';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';

const mocked = vi.hoisted(() => ({ listActions: vi.fn() }));

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./actions.service.js', () => ({ listActionsForSite: mocked.listActions }));

import { createActionsReportExportAdapter } from './report-export.adapter.js';

const accountId = 'actions-export-account';
const actorUserId = 'actions-export-user';
const siteId = '507f1f77bcf86cd799439011';
const observedAt = '2026-08-10T10:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function action(input: Record<string, unknown> = {}) {
  return {
    id: 'action-1', siteId, sourceType: 'audit_finding', sourceId: 'finding-1',
    sourceLink: '/audits/run-1', problem: 'Missing title', whyItMatters: 'Searchers need context.',
    nextStep: 'Add a descriptive title.', affectedUrls: ['https://example.test/a'],
    copy: {
      problem: { messageKey: 'audit.rules.title-tag.title' },
      whyItMatters: { messageKey: 'audit.rules.title-tag.why' },
      nextStep: { messageKey: 'audit.rules.title-tag.fix' },
    },
    evidence: [
      {
        sourceRef: 'finding-1', url: 'https://example.test/a',
        observation: {
          observedAt, provider: 'first_party', operation: 'audit', source: 'audit',
          market: { locationCode: 2840, languageCode: 'en' }, freshness: 'fresh', cached: false,
        },
      },
      {
        sourceRef: 'finding-2',
        observation: {
          observedAt, provider: 'first_party', operation: 'audit', source: 'audit',
          market: null, freshness: 'fresh', cached: false,
        },
      },
    ],
    severity: 'critical', firstPartyImpact: 'confirmed', confidence: 'high', effort: 'low',
    state: 'open', version: 1, reappearedAfterFix: false, observedAt,
    lastVerifiedAt: null, retest: { available: true },
    ...input,
  };
}

function page(input: { items?: unknown[]; nextCursor?: string | null } = {}) {
  return {
    items: input.items ?? [action()],
    sourceStatus: {
      audit_finding: { status: 'available', lastObservedAt: observedAt },
      confirmed_rank_drop: { status: 'stale' },
    },
    nextCursor: input.nextCursor ?? null,
  };
}

function access(scope: 'site' | 'site_resource' = 'site') {
  return {
    accountId,
    actorUserId,
    purpose: 'create' as const,
    target: scope === 'site'
      ? { scope: 'site' as const, siteId }
      : { scope: 'site_resource' as const, siteId, resourceId: 'resource' },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

function compose(selection: Record<string, unknown>, format: 'pdf' | 'csv' | 'json' = 'json') {
  return { ...access(), selection, format, branding };
}

beforeEach(() => {
  mocked.listActions.mockReset().mockImplementation(async (input) =>
    page({
      items: input.cursor ? [action({ id: 'action-2', sourceType: 'confirmed_rank_drop' })] : undefined,
      nextCursor: input.cursor ? null : 'next-page',
    }));
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId, url: 'https://example.test', domain: 'example.test', displayName: 'Action Site',
    paused: false, pausedAt: null, createdAt: observedAt, updatedAt: observedAt,
  });
});

describe('actions report export adapter', () => {
  it('validates filters, paginates with locale, and enforces site scope', async () => {
    const adapter = createActionsReportExportAdapter(database);
    expect(adapter.selectionSchema.parse({})).toEqual({});
    expect(adapter.selectionSchema.safeParse({ severity: ['unknown'] }).success).toBe(false);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    expect(mocked.listActions).toHaveBeenCalledTimes(2);
    expect(mocked.listActions).toHaveBeenLastCalledWith(expect.objectContaining({
      accountId, siteId, locale: 'en', cursor: 'next-page', limit: 50,
    }));
    await expect(adapter.assertAccess(access('site_resource'))).rejects.toMatchObject({ status: 404 });
  });

  it('exports copied evidence, market isolation, source status, and every format', async () => {
    const adapter = createActionsReportExportAdapter(database);
    const result = await adapter.compose(compose({}));
    expect(result.document.subject[0]?.value).toBe('Action Site');
    expect(result.document.completeness.selectedItems).toBe(2);
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: observedAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('applies each filter independently and preserves a missing source-status state', async () => {
    mocked.listActions.mockResolvedValue(page({ nextCursor: null }));
    const adapter = createActionsReportExportAdapter(database);
    const matching = {
      source: ['audit_finding'], state: ['open'], severity: ['critical'],
      confidence: ['high'], effort: ['low'],
    };
    await expect(adapter.compose(compose(matching))).resolves.toMatchObject({
      document: { completeness: { selectedItems: 1 } },
    });
    for (const selection of [
      { source: ['confirmed_rank_drop'] },
      { source: ['audit_finding'], state: ['dismissed'] },
      { source: ['audit_finding'], state: ['open'], severity: ['warning'] },
      { source: ['audit_finding'], state: ['open'], severity: ['critical'], confidence: ['low'] },
      { source: ['audit_finding'], state: ['open'], severity: ['critical'], confidence: ['high'], effort: ['high'] },
    ]) {
      const result = await adapter.compose(compose(selection));
      expect(result.document.completeness.selectedItems).toBe(0);
    }

    mocked.listActions.mockResolvedValue({
      ...page({ items: [action({ sourceType: 'audience_research' })], nextCursor: null }),
      sourceStatus: {},
    });
    await expect(adapter.compose(compose({}))).resolves.toMatchObject({
      document: { completeness: { selectedItems: 1 } },
    });
  });

  it('uses epoch/domain fallbacks and stops pagination at the export bound', async () => {
    const many = Array.from({ length: 1_001 }, (_, index) => action({ id: `action-${index}` }));
    mocked.listActions.mockResolvedValueOnce(page({ items: many, nextCursor: 'bounded-stop' }));
    const adapter = createActionsReportExportAdapter(database);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    expect(mocked.listActions).toHaveBeenCalledTimes(1);

    mocked.listActions.mockResolvedValue(page({ items: [], nextCursor: null }));
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt: observedAt, updatedAt: observedAt,
    });
    const result = await adapter.compose(compose({}));
    expect(result.document.subject[0]?.value).toBe('example.test');
    expect(result.document.sourceDates[0]?.observedAt).toBe(new Date(0).toISOString());
  });
});
