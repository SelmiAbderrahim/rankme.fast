/**
 * Deterministic delta + opportunity unit tests.
 *
 * Proves the comparison is reproducible, source-linked, evidence-gated, and
 * INDEPENDENT of any AI call: every opportunity carries evidence ids + a
 * confidence, target-keyword findings require DataForSEO demand + site
 * relevance, and access failures surface as `partialDomains`, never a weakness.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDelta,
  compareReviewedPairs,
  compareCompetitors,
  detectOpportunities,
  type CompetitorPageInput,
} from './competitor-content.delta.js';
import {
  competitorContentFindingsSchema,
  type CompetitorPageFacts,
} from './competitor-content.schemas.js';

function facts(over: Partial<CompetitorPageFacts> = {}): CompetitorPageFacts {
  return {
    url: 'https://example.com/page',
    role: 'owned',
    competitorDomain: null,
    statusCode: 200,
    title: 'Best running shoes',
    description: null,
    headings: ['Overview'],
    wordCount: 400,
    schemaTypes: [],
    hasSchemaOrgArticle: false,
    internalLinkCount: 2,
    externalLinkCount: 1,
    contentHash: 'owned-hash',
    primaryTopics: ['best', 'running', 'shoes'],
    secondaryTopics: [],
    snippet: 'owned snippet',
    ...over,
  };
}

function competitor(over: Partial<CompetitorPageFacts>, evidence: Partial<CompetitorPageInput> = {}): CompetitorPageInput {
  return {
    facts: facts({ role: 'competitor', competitorDomain: 'rival.com', url: 'https://rival.com/', ...over }),
    sharedQueries: ['running'],
    demandQueries: [],
    ...evidence,
  };
}

describe('buildDelta', () => {
  it('computes signed numeric deltas + missing/owned-only topics + schema gaps', () => {
    const owned = facts({ wordCount: 300, headings: ['A'], internalLinkCount: 2, externalLinkCount: 1, primaryTopics: ['running', 'shoes'], secondaryTopics: ['trail'] });
    const comp = competitor({
      wordCount: 900,
      headings: ['A', 'B', 'C', 'D'],
      internalLinkCount: 10,
      externalLinkCount: 4,
      schemaTypes: ['Product', 'FAQPage'],
      primaryTopics: ['running', 'marathon'],
      secondaryTopics: ['nutrition'],
      title: 'Marathon running nutrition guide',
    });
    const delta = buildDelta(owned, comp);
    expect(delta.competitorDomain).toBe('rival.com');
    expect(delta.wordCountDelta).toBe(600);
    expect(delta.headingCountDelta).toBe(3);
    expect(delta.internalLinkDelta).toBe(8);
    expect(delta.externalLinkDelta).toBe(3);
    expect(delta.missingSchemaTypes).toEqual(['faqpage', 'product']);
    expect(delta.missingTopics).toContain('marathon');
    expect(delta.ownedOnlyTopics).toContain('trail');
    expect(delta.snippetSourceId).toBe('snippet:rival.com');
  });

  it('falls back to the url as the domain label when competitorDomain is null', () => {
    const delta = buildDelta(facts(), competitor({ competitorDomain: null, url: 'https://rival.com/x' }));
    expect(delta.competitorDomain).toBe('https://rival.com/x');
  });

  it('normalizes + dedups shared queries from evidence', () => {
    const delta = buildDelta(facts(), competitor({}, { sharedQueries: ['Running Shoes', 'running   shoes', ''] }));
    expect(delta.sharedQueries).toEqual(['running shoes']);
  });

  it('bounds the per-page term set (maxTermsPerPage) on a huge page', () => {
    const manyHeadings = Array.from({ length: 260 }, (_, i) => `topicword${i}`);
    const owned = facts({ headings: manyHeadings, primaryTopics: [], secondaryTopics: [] });
    const delta = buildDelta(owned, competitor({ headings: [], primaryTopics: ['unique'], secondaryTopics: [] }));
    // The competitor's 'unique' term is missing from the (bounded) owned set.
    expect(delta.missingTopics).toContain('unique');
    expect(delta.ownedOnlyTopics.length).toBeLessThanOrEqual(40);
  });
});

describe('detectOpportunities', () => {
  it('flags topic gaps with rising confidence by competitor coverage', () => {
    const owned = facts({ primaryTopics: ['shoes'], secondaryTopics: [], title: 'Shoes', headings: [] });
    const c1 = competitor({ competitorDomain: 'a.com', title: 'Marathon training', headings: [], primaryTopics: ['marathon'], secondaryTopics: [] });
    const c2 = competitor({ competitorDomain: 'b.com', title: 'Marathon training', headings: [], primaryTopics: ['marathon'], secondaryTopics: [] });
    const deltas = [buildDelta(owned, c1), buildDelta(owned, c2)];
    const opps = detectOpportunities(owned, [c1, c2], deltas, null);
    const topic = opps.find(
      (o) => o.kind === 'topic_gap' && o.messageVars?.topic === 'marathon',
    );
    expect(topic?.confidence).toBe('high');
    expect(topic?.evidenceSourceIds).toContain('domain:a.com');
    expect(topic?.evidenceSourceIds).toContain('domain:b.com');
  });

  it('flags schema, format, and internal-linking gaps', () => {
    const owned = facts({ schemaTypes: [], headings: ['One'], internalLinkCount: 1 });
    const comp = competitor({
      schemaTypes: ['Product', 'FAQPage'],
      headings: ['A', 'B', 'C', 'D', 'E'],
      internalLinkCount: 12,
    });
    const opps = detectOpportunities(owned, [comp], [buildDelta(owned, comp)], null);
    expect(opps.some((o) => o.kind === 'schema_gap')).toBe(true);
    expect(opps.some((o) => o.kind === 'format_gap')).toBe(true);
    expect(opps.some((o) => o.kind === 'internal_linking_gap')).toBe(true);
  });

  it('flags a differentiated strength for a topic no competitor covers', () => {
    const owned = facts({ primaryTopics: ['waterproofing'], secondaryTopics: [], title: 'Waterproofing', headings: [] });
    const comp = competitor({ primaryTopics: ['running'], secondaryTopics: [], title: 'Running', headings: [] });
    const opps = detectOpportunities(owned, [comp], [buildDelta(owned, comp)], null);
    const strength = opps.find((o) => o.kind === 'differentiated_strength');
    expect(strength?.confidence).toBe('medium');
    expect(strength?.evidenceSourceIds[0]).toContain('owned-topic:waterproofing');
  });

  it('flags a relevant target keyword with demand (high when volume present)', () => {
    const owned = facts({ primaryTopics: ['running', 'shoes'] });
    const comp = competitor({}, { demandQueries: [{ query: 'running shoes', searchVolume: 5_000 }, { query: 'unrelated widget', searchVolume: 100 }] });
    const opps = detectOpportunities(owned, [comp], [buildDelta(owned, comp)], null);
    const kw = opps.filter((o) => o.kind === 'target_keyword');
    expect(kw).toHaveLength(1);
    expect(kw[0]).toMatchObject({
      messageKey: 'contentIntelligence.competitorContent.opportunityCopy.targetKeyword',
      messageVars: { query: 'running shoes' },
    });
    expect(kw[0]!.confidence).toBe('high');
  });

  it('uses the run focus keyword for relevance (null owned title) and downgrades zero-volume demand', () => {
    const owned = facts({ title: null, primaryTopics: ['gear'], headings: [] });
    const comp = competitor({}, { demandQueries: [{ query: 'shoes review', searchVolume: null }] });
    const opps = detectOpportunities(owned, [comp], [buildDelta(owned, comp)], 'shoes');
    const kw = opps.find((o) => o.kind === 'target_keyword');
    expect(kw?.confidence).toBe('medium');
  });

  it('keeps the max across null + numeric volumes for the same query (both nullish arms)', () => {
    const owned = facts({ primaryTopics: ['running', 'gear'] });
    // `running gear`: null then 3 → existing null (`null ?? 0`) vs 3 → keeps 3.
    // `running trail`: 7 then null → `dq.searchVolume ?? 0` on the null side.
    const c1 = competitor({ competitorDomain: 'a.com' }, { demandQueries: [{ query: '   ', searchVolume: 5 }, { query: 'running gear', searchVolume: null }, { query: 'running trail', searchVolume: 7 }] });
    const c2 = competitor({ competitorDomain: 'b.com' }, { demandQueries: [{ query: 'running gear', searchVolume: 3 }, { query: 'running trail', searchVolume: null }] });
    const opps = detectOpportunities(owned, [c1, c2], [buildDelta(owned, c1), buildDelta(owned, c2)], null);
    const kws = opps.filter((o) => o.kind === 'target_keyword');
    expect(kws.find((o) => o.messageVars?.query === 'running gear')?.confidence).toBe('high');
    expect(kws.find((o) => o.messageVars?.query === 'running trail')?.confidence).toBe('high');
  });

  it('deduplicates and caps keyword evidence attached to a gap', () => {
    const owned = facts({ schemaTypes: [] });
    const keywordEvidence = Array.from({ length: 21 }, (_, index) => ({
      keyword: `keyword-${index}`,
      class: 'shared_behind' as const,
      ownedPosition: 8,
      competitorPosition: 3,
      ownedUrl: owned.url,
      competitorUrl: 'https://rival.com/',
      searchVolume: 100,
      intent: 'informational' as const,
      provenanceIndexes: [index],
    }));
    keywordEvidence.splice(1, 0, keywordEvidence[0]!);
    const comp = competitor(
      { schemaTypes: ['FAQPage'] },
      {
        sharedQueries: ['running'],
        match: {
          ownedUrl: owned.url,
          landscapeReportId: null,
          landscapeOpportunityId: null,
          suggestionId: null,
          keywordEvidence,
        },
      },
    );
    const opportunity = detectOpportunities(
      owned,
      [comp],
      [buildDelta(owned, comp)],
      null,
    ).find((entry) => entry.kind === 'schema_gap');
    expect(opportunity?.keywordEvidence).toHaveLength(20);
    expect(new Set(opportunity?.keywordEvidence.map((entry) => entry.keyword)).size).toBe(20);
  });

  it('returns no differentiated strengths without a comparable competitor', () => {
    expect(detectOpportunities(facts(), [], [], null)).toEqual([]);
  });
});

describe('compareCompetitors', () => {
  it('produces schema-valid, deterministic findings with sorted partial domains', () => {
    const owned = facts();
    const comp = competitor({});
    const findings = compareCompetitors(owned, [comp], ['z.com', 'a.com'], 'shoes');
    expect(competitorContentFindingsSchema.safeParse(findings).success).toBe(true);
    expect(findings.partialDomains).toEqual(['a.com', 'z.com']);
    expect(findings.keyword).toBe('shoes');
    expect(findings.aiExplanation).toBeNull();
    // Determinism — same inputs, identical output.
    const again = compareCompetitors(owned, [comp], ['z.com', 'a.com'], 'shoes');
    expect(JSON.stringify(again)).toBe(JSON.stringify(findings));
  });

  it('carries a null keyword through when none is supplied', () => {
    const findings = compareCompetitors(facts(), [competitor({})], [], null);
    expect(findings.keyword).toBeNull();
  });

  it('serializes an empty reviewed-pair set without inventing an owned URL', () => {
    const findings = compareReviewedPairs([], ['z.example', 'z.example'], null);
    expect(findings.ownedUrl).toBe('');
    expect(findings.partialDomains).toEqual(['z.example']);
    expect(findings.deltas).toEqual([]);
  });
});
