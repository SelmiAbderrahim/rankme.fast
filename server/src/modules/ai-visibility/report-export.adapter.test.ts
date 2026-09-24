import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db as database } from '../../db/client.js';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';

const mocked = vi.hoisted(() => ({
  competitors: vi.fn(),
  mentions: vi.fn(),
  prompts: vi.fn(),
  share: vi.fn(),
}));

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./ai-visibility.repository.js', () => ({
  listTrackedPrompts: mocked.prompts,
  readRecentCompetitorMentions: mocked.competitors,
  readRecentMentions: mocked.mentions,
}));
vi.mock('./ai-visibility.service.js', () => ({ computeShareOfVoicePct: mocked.share }));

import { createAiVisibilityReportExportAdapter } from './report-export.adapter.js';

const accountId = 'ai-visibility-export-account';
const actorUserId = 'ai-visibility-export-user';
const siteId = '507f1f77bcf86cd799439011';
const checkedAt = new Date('2026-08-10T10:00:00.000Z');
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function prompt(input: Record<string, unknown> = {}) {
  return { id: 'prompt-1', prompt: 'best seo audit', createdAt: '2026-07-01T00:00:00.000Z', ...input };
}

function mention(input: Record<string, unknown> = {}) {
  return {
    id: 'mention-1', prompt: 'best seo audit', model: 'fixture-model',
    mentioned: true, citedUrl: 'https://example.test/', sentiment: 'positive', checkedAt,
    ...input,
  };
}

function competitor(input: Record<string, unknown> = {}) {
  return {
    id: 'competitor-1', prompt: 'best seo audit', model: 'fixture-model',
    competitorDomain: 'competitor.test', mentioned: true, cited: false, checkedAt,
    ...input,
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
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId, url: 'https://example.test', domain: 'example.test', displayName: 'AI Example',
    paused: false, pausedAt: null, createdAt: checkedAt.toISOString(), updatedAt: checkedAt.toISOString(),
  });
  mocked.prompts.mockReset().mockResolvedValue([
    prompt(), prompt({ id: 'prompt-2', prompt: 'rank tracker' }),
  ]);
  mocked.mentions.mockReset().mockResolvedValue([
    mention(),
    mention({ id: 'mention-2', prompt: 'rank tracker', model: 'other-model', mentioned: false, sentiment: null }),
  ]);
  mocked.competitors.mockReset().mockResolvedValue([
    competitor(),
    competitor({ id: 'competitor-2', prompt: 'rank tracker', model: 'other-model', mentioned: false }),
  ]);
  mocked.share.mockReset().mockReturnValue(50);
});

describe('AI visibility report export adapter', () => {
  it('validates complete bounded windows and enforces site scope', async () => {
    const adapter = createAiVisibilityReportExportAdapter(database);
    expect(adapter.selectionSchema.parse({})).toEqual({});
    expect(adapter.selectionSchema.safeParse({ from: '2026-08-01' }).success).toBe(false);
    expect(adapter.selectionSchema.safeParse({ from: '2026-08-01', to: '2026-08-02' }).success)
      .toBe(false);
    expect(adapter.selectionSchema.safeParse({ from: '2025-01-01', to: '2026-08-01' }).success)
      .toBe(false);
    expect(adapter.selectionSchema.safeParse({ from: '2026-08-01', to: '2026-08-07' }).success)
      .toBe(true);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    expect(getSite).toHaveBeenCalledWith(accountId, siteId);
    await expect(adapter.assertAccess(access('site_resource'))).rejects.toMatchObject({ status: 404 });
  });

  it('exports prompt and mention evidence with the default rolling window and every format', async () => {
    // The default window is the trailing 30 days, so pin the clock near the
    // fixture observations instead of depending on the wall clock.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-08-20T00:00:00.000Z') });
    const adapter = createAiVisibilityReportExportAdapter(database);
    const result = await adapter.compose(compose({}));
    vi.useRealTimers();
    expect(result.document.subject[0]?.value).toBe('AI Example');
    expect(result.document.completeness.selectedItems).toBe(6);
    expect(mocked.share).toHaveBeenCalledWith({
      brandMentionedCount: 1, competitorMentionedCount: 1,
    });
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({
        document: result.document, format, snapshotCreatedAt: checkedAt.toISOString(),
      })).resolves.toMatchObject({ format });
    }
  });

  it('applies prompt, model, sentiment, and explicit inclusive-window filters', async () => {
    const adapter = createAiVisibilityReportExportAdapter(database);
    let result = await adapter.compose(compose({
      from: '2026-08-07', to: '2026-08-12',
      prompt: ['best seo audit'], model: ['fixture-model'], sentiment: ['positive'],
    }));
    expect(result.document.completeness.selectedItems).toBe(3);

    result = await adapter.compose(compose({
      from: '2026-08-07', to: '2026-08-12',
      prompt: ['rank tracker'], model: ['other-model'], sentiment: ['negative'],
    }));
    expect(result.document.completeness.selectedItems).toBe(2);

    result = await adapter.compose(compose({
      from: '2026-07-01', to: '2026-07-31',
    }));
    expect(result.document.completeness.selectedItems).toBe(2);
  });

  it('uses the selected end time and domain label when no observations survive', async () => {
    mocked.mentions.mockResolvedValue([]);
    mocked.competitors.mockResolvedValue([]);
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt: checkedAt.toISOString(), updatedAt: checkedAt.toISOString(),
    });
    const adapter = createAiVisibilityReportExportAdapter(database);
    const result = await adapter.compose(compose({ from: '2026-08-01', to: '2026-08-07' }));
    expect(result.document.subject[0]?.value).toBe('example.test');
    expect(result.document.sourceDates[0]?.observedAt).toBe('2026-08-07T23:59:59.999Z');
  });
});
