import { describe, expect, it } from 'vitest';
import {
  contentBriefCreateBodySchema,
  contentBriefDraftBodySchema,
  contentBriefIdParamSchema,
  contentBriefListQuerySchema,
  contentBriefPathParamsSchema,
  contentBriefPreviewBodySchema,
  contentBriefSiteParamSchema,
  normalizeBriefKeyword,
} from './content-brief.schemas.js';

describe('content-brief schemas', () => {
  it('normalizes NFKC keyword whitespace and applies defaults', () => {
    expect(normalizeBriefKeyword('  ＡI\n SEO  ')).toBe('ai seo');
    expect(contentBriefPreviewBodySchema.parse({ keyword: ' Test ', locale: 'en' }))
      .toEqual({ keyword: 'test', locale: 'en' });
    expect(contentBriefListQuerySchema.parse({})).toEqual({ status: 'all', limit: 20 });
    expect(contentBriefListQuerySchema.parse({ status: 'completed', limit: '50' }))
      .toEqual({ status: 'completed', limit: 50 });
  });

  it('accepts bounded create, ids, cursor, and drafts', () => {
    expect(contentBriefCreateBodySchema.parse({
      keyword: 'keyword', locale: 'ar', clientKey: 'client_key-1',
    }).clientKey).toBe('client_key-1');
    const id = 'a'.repeat(24);
    expect(contentBriefIdParamSchema.parse({ briefId: id })).toEqual({ briefId: id });
    expect(contentBriefSiteParamSchema.parse({ siteId: id })).toEqual({ siteId: id });
    expect(contentBriefPathParamsSchema.parse({ siteId: id, briefId: id }))
      .toEqual({ siteId: id, briefId: id });
    expect(contentBriefDraftBodySchema.parse({ draft: 'text', locale: 'zh' }).draft).toBe('text');
    expect(contentBriefListQuerySchema.parse({ cursor: 'abc' }).cursor).toBe('abc');
  });

  it('rejects empty/oversized/unknown/malformed values at the HTTP boundary', () => {
    const id = 'a'.repeat(24);
    for (const value of [
      { keyword: ' ', locale: 'en' },
      { keyword: 'x'.repeat(201), locale: 'en' },
      { keyword: 'ok', locale: 'it' },
      { keyword: 'ok', locale: 'en', unknown: true },
    ]) expect(contentBriefPreviewBodySchema.safeParse(value).success).toBe(false);
    expect(contentBriefCreateBodySchema.safeParse({ keyword: 'x', locale: 'en', clientKey: '!' }).success).toBe(false);
    expect(contentBriefListQuerySchema.safeParse({ status: 'mystery' }).success).toBe(false);
    expect(contentBriefListQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(contentBriefIdParamSchema.safeParse({ briefId: 'no' }).success).toBe(false);
    expect(contentBriefSiteParamSchema.safeParse({ siteId: id, extra: true }).success).toBe(false);
    expect(contentBriefPathParamsSchema.safeParse({ siteId: id, briefId: id, extra: true }).success).toBe(false);
    expect(contentBriefDraftBodySchema.safeParse({ draft: '', locale: 'en' }).success).toBe(false);
    expect(contentBriefDraftBodySchema.safeParse({ draft: 'x'.repeat(50_001), locale: 'en' }).success).toBe(false);
  });
});
