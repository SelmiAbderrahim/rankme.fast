/**
 * Competitor content schema unit tests (spec 09). Exercises the SEC-BOUND
 * ceilings, defaults, and the derived-facts / findings shapes.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPETITOR_CONTENT_PAGES_PER_RUN,
  COMPETITOR_PORTFOLIO_MAX_COMPETITORS,
} from '../../shared/safety/feature-limits.js';
import {
  addCompetitorBodySchema,
  competitorContentFindingsSchema,
  competitorOpportunitySchema,
  competitorPageFactsSchema,
  listCompetitorsQuerySchema,
  listRunsQuerySchema,
  startCompetitorRunBodySchema,
} from './competitor-content.schemas.js';

describe('addCompetitorBodySchema', () => {
  it('accepts a public url and defaults source to manual', () => {
    const parsed = addCompetitorBodySchema.parse({ url: 'https://rival.com' });
    expect(parsed.source).toBe('manual');
  });

  it('rejects a non-http url', () => {
    expect(addCompetitorBodySchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
  });
});

describe('startCompetitorRunBodySchema', () => {
  it('applies the pageLimit default + requires at least one competitor', () => {
    const parsed = startCompetitorRunBodySchema.parse({
      competitorIds: ['a'],
      ownedUrl: 'https://example.com/page',
      locale: 'en',
    });
    expect(parsed.pageLimit).toBe(COMPETITOR_CONTENT_PAGES_PER_RUN);
    expect(startCompetitorRunBodySchema.safeParse({ competitorIds: [], ownedUrl: 'https://example.com', locale: 'en' }).success).toBe(false);
  });

  it('clamps competitorIds to the portfolio ceiling and pageLimit to the run ceiling', () => {
    const tooMany = Array.from({ length: COMPETITOR_PORTFOLIO_MAX_COMPETITORS + 1 }, (_, i) => `c${i}`);
    expect(startCompetitorRunBodySchema.safeParse({ competitorIds: tooMany, ownedUrl: 'https://example.com', locale: 'en' }).success).toBe(false);
    expect(
      startCompetitorRunBodySchema.safeParse({
        competitorIds: ['a'],
        ownedUrl: 'https://example.com',
        locale: 'en',
        pageLimit: COMPETITOR_CONTENT_PAGES_PER_RUN + 1,
      }).success,
    ).toBe(false);
  });

  it('rejects an unsafe owned url', () => {
    expect(
      startCompetitorRunBodySchema.safeParse({ competitorIds: ['a'], ownedUrl: 'ftp://x', locale: 'en' }).success,
    ).toBe(false);
  });

  it('enforces reviewed and compatibility page limits and forbids mixing them', () => {
    const reviewed = {
      landscapeReportId: '000000000000000000000001',
      landscapeOpportunityId: 'opportunity-1',
      suggestionId: 'suggestion-1',
    };
    const explicit = (url: string) => ({
      competitorId: '00000000-0000-4000-8000-000000000001',
      url,
    });
    const base = {
      competitorIds: [],
      ownedUrl: 'https://example.com/page',
      locale: 'en',
      pageLimit: 1,
    };
    expect(startCompetitorRunBodySchema.safeParse({
      ...base,
      reviewedPageMatches: [reviewed, reviewed],
    }).success).toBe(false);
    expect(startCompetitorRunBodySchema.safeParse({
      ...base,
      competitorUrls: [explicit('https://one.example'), explicit('https://two.example')],
    }).success).toBe(false);
    expect(startCompetitorRunBodySchema.safeParse({
      ...base,
      reviewedPageMatches: [reviewed],
      competitorUrls: [explicit('https://one.example')],
    }).success).toBe(false);
  });
});

describe('list query schemas', () => {
  it('defaults status + limit', () => {
    expect(listCompetitorsQuerySchema.parse({}).status).toBe('active');
    expect(listRunsQuerySchema.parse({}).limit).toBe(20);
  });
});

describe('result schemas', () => {
  it('validates a full page-facts shape and rejects a snippet over the cap', () => {
    const valid = {
      url: 'https://rival.com/',
      role: 'competitor' as const,
      competitorDomain: 'rival.com',
      statusCode: 200,
      title: 'x',
      description: null,
      headings: ['h'],
      wordCount: 10,
      schemaTypes: [],
      hasSchemaOrgArticle: false,
      internalLinkCount: 0,
      externalLinkCount: 0,
      contentHash: 'h',
      primaryTopics: [],
      secondaryTopics: [],
      snippet: 'short',
    };
    expect(competitorPageFactsSchema.safeParse(valid).success).toBe(true);
    expect(competitorPageFactsSchema.safeParse({ ...valid, snippet: 'x'.repeat(10_000) }).success).toBe(false);
  });

  it('validates an empty findings object', () => {
    const findings = {
      version: '1',
      thresholdsVersion: '1',
      ownedUrl: 'https://example.com/p',
      keyword: null,
      deltas: [],
      opportunities: [],
      partialDomains: [],
      aiExplanation: null,
    };
    expect(competitorContentFindingsSchema.safeParse(findings).success).toBe(true);
  });

  it('upgrades every legacy opportunity kind from evidence instead of frozen prose', () => {
    const base = {
      id: 'legacy',
      confidence: 'high' as const,
      keywordEvidence: [],
      label: 'Frozen English copy that must be discarded',
    };
    const cases = [
      ['topic_gap', ['topic:automation'], { topic: 'automation' }],
      ['schema_gap', ['schema:FAQPage'], { schemaType: 'FAQPage' }],
      ['differentiated_strength', ['owned-topic:security'], { topic: 'security' }],
      ['target_keyword', ['query:seo audit'], { query: 'seo audit' }],
      ['format_gap', ['format:list'], undefined],
      ['internal_linking_gap', [], undefined],
    ] as const;
    for (const [kind, evidenceSourceIds, messageVars] of cases) {
      const parsed = competitorOpportunitySchema.parse({
        ...base,
        kind,
        evidenceSourceIds,
      });
      expect(parsed).not.toHaveProperty('label');
      expect(parsed.messageVars).toEqual(messageVars);
    }
  });

  it('handles legacy evidence misses and keeps semantic opportunities unchanged', () => {
    const legacy = competitorOpportunitySchema.parse({
      id: 'legacy-miss', kind: 'topic_gap', confidence: 'low',
      evidenceSourceIds: ['topic-wrong:automation'], keywordEvidence: [],
      label: 'Discard me',
    });
    expect(legacy.messageVars).toBeUndefined();

    const semantic = {
      id: 'semantic', kind: 'topic_gap' as const, confidence: 'medium' as const,
      evidenceSourceIds: ['topic:automation'], keywordEvidence: [],
      messageKey: 'contentIntelligence.competitorContent.opportunityCopy.topicGap' as const,
      messageVars: { topic: 'automation' },
    };
    expect(competitorOpportunitySchema.parse(semantic)).toEqual(semantic);
  });

  it('rejects unsafe or unbounded semantic variables', () => {
    const base = {
      id: 'semantic', kind: 'topic_gap', confidence: 'medium',
      evidenceSourceIds: [], keywordEvidence: [],
      messageKey: 'contentIntelligence.competitorContent.opportunityCopy.topicGap',
    };
    expect(competitorOpportunitySchema.safeParse({
      ...base, messageVars: { constructor: 'unsafe' },
    }).success).toBe(false);
    expect(competitorOpportunitySchema.safeParse({
      ...base, messageVars: { topic: '\u0000unsafe' },
    }).success).toBe(false);
    expect(competitorOpportunitySchema.safeParse({
      ...base,
      messageVars: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`v${index}`, index])),
    }).success).toBe(false);
    expect(competitorOpportunitySchema.safeParse({
      ...base, messageVars: { score: Number.POSITIVE_INFINITY },
    }).success).toBe(false);
  });
});
