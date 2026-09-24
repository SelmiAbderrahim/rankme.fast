import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db as database } from '../../db/client.js';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';

const mocked = vi.hoisted(() => ({ decisions: vi.fn(), result: vi.fn() }));

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./audience-research.decisions.js', () => ({ listTerminalSignalDecisions: mocked.decisions }));
vi.mock('./audience-research.service.js', () => ({ getAudienceResearchRunResult: mocked.result }));

import { createAudienceResearchReportExportAdapter } from './report-export.adapter.js';

const accountId = 'audience-export-account';
const actorUserId = 'audience-export-user';
const siteId = '507f1f77bcf86cd799439011';
const runId = '507f1f77bcf86cd799439012';
const completedAt = '2026-08-10T10:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function source(input: Record<string, unknown> = {}) {
  return {
    sourceId: 'source-1', canonicalUrl: 'https://forum.test/thread', title: 'Forum thread',
    sourceType: 'forum', registrableDomain: 'forum.test', observedAt: completedAt,
    contentHash: 'hash-1', excerpt: 'Users want faster audits.',
    observationMeta: { sourceKind: 'provider_observation', observedAt: completedAt },
    ...input,
  };
}

function signal(input: Record<string, unknown> = {}) {
  return {
    signalId: 'signal-1', type: 'request', title: 'Faster audit requests',
    summary: 'Users ask for faster audit results.', suggestedRoute: 'product',
    citedSourceIds: ['source-1'], independentDomainCount: 2, sourceTypeCount: 1,
    mostRecentSourceObservedAt: completedAt, confidence: 'high',
    ...input,
  };
}

function result(input: Record<string, unknown> = {}) {
  return {
    runId, siteId, state: 'completed', stage: 'terminal',
    outputLocale: 'fr',
    counts: { candidates: 2, sources: 2, signals: 2 }, progress: { percent: 100 },
    coverageNoteKey: null, costMicros: { total: 10, byStage: {} },
    terminal: { state: 'completed', reasonCode: 'ok', completedAt },
    requestedAt: '2026-08-10T09:00:00.000Z', startedAt: '2026-08-10T09:01:00.000Z',
    completedAt, updatedAt: completedAt,
    input: {
      outputLocale: 'fr', siteMarket: null, competitorDomains: [], seedTopics: ['seo'],
      queryTemplateVersion: 1,
    },
    sources: [
      source(),
      source({ sourceId: 'source-2', sourceType: 'review', title: 'Review', canonicalUrl: 'https://review.test/item', registrableDomain: 'review.test' }),
      source({ sourceId: 'source-3', sourceType: 'question', title: 'Question', canonicalUrl: 'https://question.test/item', registrableDomain: 'question.test' }),
    ],
    signals: [
      signal(),
      signal({
        signalId: 'signal-2', type: 'complaint', title: 'Complex setup', summary: '',
        citedSourceIds: [], confidence: 'low', mostRecentSourceObservedAt: null,
      }),
    ],
    ledgerSummary: { total: 3, ai: 1, byStage: {} },
    ...input,
  };
}

function decision(input: Record<string, unknown> = {}) {
  return {
    signalId: 'signal-1', terminalDecision: 'accepted', destination: 'product',
    downstreamId: 'action-1', deepLinkPath: '/actions/action-1', decidedAt: completedAt,
    decidedBy: { userId: actorUserId }, duplicate: false,
    ...input,
  };
}

function access(scope: 'site_resource' | 'site' = 'site_resource') {
  return {
    accountId,
    actorUserId,
    purpose: 'create' as const,
    target: scope === 'site_resource'
      ? { scope: 'site_resource' as const, siteId, resourceId: runId }
      : { scope: 'site' as const, siteId },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

function compose(selection: Record<string, unknown>, format: 'pdf' | 'csv' | 'json' = 'json') {
  return { ...access(), selection, format, branding };
}

beforeEach(() => {
  mocked.result.mockReset().mockResolvedValue(result());
  mocked.decisions.mockReset().mockResolvedValue([decision()]);
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId, url: 'https://example.test', domain: 'example.test', displayName: 'Audience Site',
    paused: false, pausedAt: null, createdAt: completedAt, updatedAt: completedAt,
  });
});

describe('audience research report export adapter', () => {
  it('validates filters, joins terminal decisions, and enforces resource scope', async () => {
    const adapter = createAudienceResearchReportExportAdapter(database);
    expect(adapter.selectionSchema.parse({})).toEqual({});
    expect(adapter.selectionSchema.safeParse({ confidence: ['unknown'] }).success).toBe(false);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    expect(mocked.result).toHaveBeenCalledWith({ accountId, siteId, runId });
    expect(mocked.decisions).toHaveBeenCalledWith(database, { accountId, runId });
    await expect(adapter.assertAccess(access('site'))).rejects.toMatchObject({ status: 404 });
  });

  it('exports cited and uncited sources, decided and undecided signals, and every format', async () => {
    const adapter = createAudienceResearchReportExportAdapter(database);
    const resultValue = await adapter.compose(compose({}));
    expect(resultValue.document.subject[0]?.value).toBe('Audience Site');
    expect(resultValue.document.completeness.selectedItems).toBe(5);
    expect(JSON.stringify(resultValue.document)).toContain('outputLocale');
    expect(JSON.stringify(resultValue.document)).toContain('fr');
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({
        document: resultValue.document, format, snapshotCreatedAt: completedAt,
      })).resolves.toMatchObject({ format });
    }
  });

  it('applies confidence, signal, decision, and source filters without dropping cited evidence', async () => {
    const adapter = createAudienceResearchReportExportAdapter(database);
    let composed = await adapter.compose(compose({
      confidence: ['high'], signal: ['request'], decision: ['accepted'], source: ['review'],
    }));
    expect(composed.document.completeness.selectedItems).toBe(3);

    composed = await adapter.compose(compose({
      confidence: ['low'], signal: ['complaint'], decision: ['undecided'], source: ['question'],
    }));
    expect(composed.document.completeness.selectedItems).toBe(2);

    composed = await adapter.compose(compose({
      confidence: ['medium'], signal: ['request'], decision: ['dismissed'], source: ['other'],
    }));
    expect(composed.document.completeness.selectedItems).toBe(0);
  });

  it('uses updated/domain fallbacks and serializes undefined boundary values as null', async () => {
    mocked.result.mockResolvedValue(result({
      completedAt: null,
      input: undefined,
      terminal: undefined,
      sources: [source({ observationMeta: undefined })],
      signals: [],
    }));
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt: completedAt, updatedAt: completedAt,
    });
    const adapter = createAudienceResearchReportExportAdapter(database);
    const composed = await adapter.compose(compose({}));
    expect(composed.document.subject[0]?.value).toBe('example.test');
    expect(composed.document.sourceDates[0]?.observedAt).toBe(completedAt);
  });
});
