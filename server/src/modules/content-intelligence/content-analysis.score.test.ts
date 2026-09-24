/**
 * Content Intelligence — deterministic scorecard tests (Phase A6).
 *
 * The scorer is pure, so every section branch, every rule trigger, the
 * stuffing detector, and the SEC-INJECT length caps are pinned directly.
 * The module-load weight-sum assertion is exercised through an isolated
 * module graph (`vi.resetModules` + `vi.doMock` + dynamic import).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  SCAN_CHAR_CAP,
  buildScorecard,
  detectStuffing,
  type ScoreInput,
} from './content-analysis.score.js';
import {
  SCORE_VERSION,
  SCORECARD_SECTIONS,
  recommendationSchema,
  scorecardSchema,
  type CompetitorEvidence,
  type OwnedPageFacts,
} from './content-analysis.schemas.js';

function makeOwned(overrides: Partial<OwnedPageFacts> = {}): OwnedPageFacts {
  return {
    url: 'https://example.com/guide',
    title: 'Complete guide to seo audits today',
    description:
      'A practical walkthrough of running an seo audit on any site, step by step.',
    canonical: 'https://example.com/guide',
    language: 'en',
    wordCount: 1_000,
    headingCount: 5,
    schemaTypes: ['Article', 'FAQPage'],
    hasSchemaOrgArticle: true,
    internalLinkCount: 5,
    externalLinkCount: 2,
    contentHash: 'owned-hash',
    excerpt:
      'This long form guide walks through seo audits with practical detail and examples.',
    ...overrides,
  };
}

function makeCompetitor(
  index: number,
  overrides: Partial<CompetitorEvidence> = {},
): CompetitorEvidence {
  return {
    sourceId: `competitor-${index}`,
    url: `https://rival-${index}.example/post`,
    title: `Rival ${index}`,
    wordCount: 1_000,
    headingCount: 5,
    schemaTypes: ['Article'],
    hasSchemaOrgArticle: true,
    snippet: 'A short bounded snippet.',
    contentHash: `competitor-hash-${index}`,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    keyword: 'seo audits',
    owned: makeOwned(),
    keywordEvidence: {
      keyword: 'seo audits',
      locationCode: 2840,
      languageCode: 'en',
      volume: 320,
      difficulty: 42,
      intent: 'informational',
    },
    serp: { device: 'desktop', ownedPosition: 3, topUrls: [] },
    competitors: [
      makeCompetitor(1, { wordCount: 900, headingCount: 4 }),
      makeCompetitor(2, { wordCount: 1_000, headingCount: 5 }),
      makeCompetitor(3, { wordCount: 1_100, headingCount: 6 }),
    ],
    ...overrides,
  };
}

function ruleIds(input: ScoreInput): string[] {
  return buildScorecard(input).recommendations.map((r) => r.ruleId);
}

describe('buildScorecard — determinism + schema validity', () => {
  it('produces identical output for identical inputs (no clock, no random)', () => {
    const a = buildScorecard(makeInput());
    const b = buildScorecard(makeInput());
    expect(a).toEqual(b);
  });

  it('emits a zod-valid scorecard and zod-valid recommendations', () => {
    const output = buildScorecard(
      makeInput({ owned: makeOwned({ title: null, canonical: null }) }),
    );
    expect(() => scorecardSchema.parse(output.scorecard)).not.toThrow();
    expect(output.recommendations.length).toBeGreaterThan(0);
    for (const rec of output.recommendations) {
      expect(() => recommendationSchema.parse(rec)).not.toThrow();
    }
    expect(output.scorecard.version).toBe(SCORE_VERSION);
    expect(output.scorecard.sections.map((s) => s.key)).toEqual([...SCORECARD_SECTIONS]);
    expect(output.scorecard.sections.reduce((sum, s) => sum + s.weight, 0)).toBe(100);
  });
});

describe('detectStuffing', () => {
  const filler = (count: number): string =>
    Array.from({ length: count }, (_, i) => `word${i}`).join(' ');

  it('returns false for an empty excerpt', () => {
    expect(detectStuffing('', 'seo audits')).toBe(false);
  });

  it('returns false when the page has fewer than the minimum token count', () => {
    expect(detectStuffing('audit audit audit', 'audit tools')).toBe(false);
  });

  it('detects a keyword term repeated past both the count and ratio thresholds', () => {
    const text = `${'audit '.repeat(20)}${filler(30)}`;
    expect(detectStuffing(text, 'audit tools')).toBe(true);
  });

  it('ignores a frequent unrelated word (a brand name is not stuffing)', () => {
    const text = `${'brandname '.repeat(20)}${filler(30)}`;
    expect(detectStuffing(text, 'seo audits')).toBe(false);
  });

  it('ignores a keyword term whose share of tokens stays under the ratio', () => {
    const text = `${'audit '.repeat(16)}${filler(384)}`;
    expect(detectStuffing(text, 'audit tools')).toBe(false);
  });

  it('ignores repetition below the minimum count even at a high ratio', () => {
    const text = `${'audit '.repeat(10)}${filler(10)}`;
    expect(detectStuffing(text, 'audit tools')).toBe(false);
  });

  it('never counts short keyword tokens (stop-word proxy)', () => {
    const text = `${'seo '.repeat(999)}${filler(30)}`;
    // 'seo' is under the 4-char token minimum on BOTH sides of the compare.
    expect(detectStuffing(text, 'seo')).toBe(false);
  });

  it('scans only the first SCAN_CHAR_CAP characters (SEC-INJECT cap)', () => {
    expect(SCAN_CHAR_CAP).toBe(8_000);
    // 'pad ' × 2000 = exactly 8000 chars; every stuffed term sits past the cap
    // and every in-cap token is under the 4-char minimum.
    const text = `${'pad '.repeat(2_000)}${'audit '.repeat(20)}${filler(30)}`;
    expect(detectStuffing(text, 'audit tools')).toBe(false);
  });
});

describe('section scorers', () => {
  it('intent: full evidence + top-10 position + keyword in title and body scores strong', () => {
    const output = buildScorecard(makeInput());
    const intent = output.scorecard.sections.find((s) => s.key === 'intent')!;
    expect(intent.score).toBe(100);
    expect(intent.confidence).toBe(0.9);
    expect(intent.reason).toBe('contentIntelligence.reasons.intent.strong');
  });

  it('intent: no serp and no keyword evidence yields the neutral no-evidence result', () => {
    const output = buildScorecard(makeInput({ serp: null, keywordEvidence: null }));
    const intent = output.scorecard.sections.find((s) => s.key === 'intent')!;
    expect(intent).toMatchObject({
      score: 50,
      confidence: 0.2,
      reason: 'contentIntelligence.reasons.intent.noEvidence',
    });
  });

  it('intent: positions 11-30 earn the middle band; deeper or absent positions the floor', () => {
    const middling = buildScorecard(
      makeInput({ serp: { device: 'desktop', ownedPosition: 20, topUrls: [] } }),
    ).scorecard.sections.find((s) => s.key === 'intent')!;
    expect(middling.score).toBe(85); // 40 title + 20 body + 25 position band

    const deep = buildScorecard(
      makeInput({ serp: { device: 'desktop', ownedPosition: 50, topUrls: [] } }),
    ).scorecard.sections.find((s) => s.key === 'intent')!;
    expect(deep.score).toBe(70); // 40 + 20 + 10 floor

    const absent = buildScorecard(
      makeInput({ serp: { device: 'desktop', ownedPosition: null, topUrls: [] } }),
    ).scorecard.sections.find((s) => s.key === 'intent')!;
    expect(absent.score).toBe(70);
  });

  it('intent: partial evidence (serp XOR keyword) reduces confidence to 0.6', () => {
    const serpOnly = buildScorecard(makeInput({ keywordEvidence: null }))
      .scorecard.sections.find((s) => s.key === 'intent')!;
    expect(serpOnly.confidence).toBe(0.6);

    const keywordOnly = buildScorecard(makeInput({ serp: null }))
      .scorecard.sections.find((s) => s.key === 'intent')!;
    expect(keywordOnly.confidence).toBe(0.6);
    // The serp-less path takes the +10 fallback band.
    expect(keywordOnly.score).toBe(70);
  });

  it('intent: a page missing the keyword everywhere with no ranking is needsWork', () => {
    const output = buildScorecard(
      makeInput({
        owned: makeOwned({ title: 'Unrelated page', excerpt: 'Nothing relevant here.' }),
        serp: { device: 'desktop', ownedPosition: null, topUrls: [] },
      }),
    );
    const intent = output.scorecard.sections.find((s) => s.key === 'intent')!;
    expect(intent.score).toBe(10);
    expect(intent.reason).toBe('contentIntelligence.reasons.intent.needsWork');
  });

  it('intent: a whitespace-only keyword never matches (empty-needle guard)', () => {
    const output = buildScorecard(makeInput({ keyword: '   ' }));
    const intent = output.scorecard.sections.find((s) => s.key === 'intent')!;
    expect(intent.score).toBe(40); // only the position band contributes
  });

  it('coverage: absolute-depth fallback tiers apply when no competitor evidence exists', () => {
    const tier = (wordCount: number): number =>
      buildScorecard(
        makeInput({ competitors: [], owned: makeOwned({ wordCount }) }),
      ).scorecard.sections.find((s) => s.key === 'coverage')!.score;
    expect(tier(1_500)).toBe(85);
    expect(tier(800)).toBe(75);
    expect(tier(300)).toBe(60);
    expect(tier(100)).toBe(20); // round((100/300)*60)

    const section = buildScorecard(makeInput({ competitors: [] }))
      .scorecard.sections.find((s) => s.key === 'coverage')!;
    expect(section.confidence).toBe(0.4);
    expect(section.reason).toBe('contentIntelligence.reasons.coverage.noEvidence');
  });

  it('coverage: competitor medians drive the ratio path at high confidence', () => {
    const section = buildScorecard(makeInput())
      .scorecard.sections.find((s) => s.key === 'coverage')!;
    // wordRatio = (1000/1000)/1.2, headingRatio = (5/5)/1.2 → round(83.33) = 83.
    expect(section.score).toBe(83);
    expect(section.confidence).toBe(0.9);
    expect(section.reason).toBe('contentIntelligence.reasons.coverage.strong');
  });

  it('coverage: zero-valued competitor counts are filtered and an even median averages', () => {
    const output = buildScorecard(
      makeInput({
        competitors: [
          makeCompetitor(1, { wordCount: 0, headingCount: 0 }),
          makeCompetitor(2, { wordCount: 800, headingCount: 0 }),
          makeCompetitor(3, { wordCount: 1_200, headingCount: 0 }),
        ],
        owned: makeOwned({ wordCount: 200, headingCount: 0 }),
      }),
    );
    const section = output.scorecard.sections.find((s) => s.key === 'coverage')!;
    // Median words = (800+1200)/2 = 1000; headings median null → wordRatio reused.
    // wordRatio = (200/1000)/1.2 = 0.1667 → round(16.67) = 17.
    expect(section.score).toBe(17);
    expect(section.reason).toBe('contentIntelligence.reasons.coverage.needsWork');
  });

  it('coverage: suspected stuffing caps the section score at 40', () => {
    const stuffed = `${'audit '.repeat(20)}${Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')}`;
    const output = buildScorecard(
      makeInput({
        keyword: 'audit tools',
        owned: makeOwned({ excerpt: stuffed, wordCount: 1_000 }),
      }),
    );
    const section = output.scorecard.sections.find((s) => s.key === 'coverage')!;
    expect(section.score).toBeLessThanOrEqual(40);
    expect(output.stuffingSuspected).toBe(true);
    expect(ruleIds(makeInput({ keyword: 'audit tools', owned: makeOwned({ excerpt: stuffed }) })))
      .toContain('keyword-stuffing');
  });

  it('structure: ideal title/description/headings score 100; degraded lengths take the low bands', () => {
    const ideal = buildScorecard(makeInput())
      .scorecard.sections.find((s) => s.key === 'structure')!;
    expect(ideal.score).toBe(100);
    expect(ideal.confidence).toBe(1);
    expect(ideal.reason).toBe('contentIntelligence.reasons.structure.strong');

    const degraded = buildScorecard(
      makeInput({
        owned: makeOwned({
          title: 'Short', // < 10 chars → 25
          description: 'Tiny desc.', // < 50 chars → 20
          headingCount: 1, // < 2 → 0
        }),
      }),
    ).scorecard.sections.find((s) => s.key === 'structure')!;
    expect(degraded.score).toBe(45);
    expect(degraded.reason).toBe('contentIntelligence.reasons.structure.needsWork');

    const empty = buildScorecard(
      makeInput({
        owned: makeOwned({ title: null, description: null, headingCount: 0 }),
      }),
    ).scorecard.sections.find((s) => s.key === 'structure')!;
    expect(empty.score).toBe(0);
  });

  it('links: three internal plus one external is strong; sparse links scale down', () => {
    const strong = buildScorecard(makeInput())
      .scorecard.sections.find((s) => s.key === 'links')!;
    expect(strong.score).toBe(100);
    expect(strong.reason).toBe('contentIntelligence.reasons.links.strong');

    const sparse = buildScorecard(
      makeInput({ owned: makeOwned({ internalLinkCount: 1, externalLinkCount: 0 }) }),
    ).scorecard.sections.find((s) => s.key === 'links')!;
    expect(sparse.score).toBe(20);
    expect(sparse.reason).toBe('contentIntelligence.reasons.links.needsWork');
  });

  it('schema: structured data, Article markup, and a description stack to 100', () => {
    const full = buildScorecard(makeInput())
      .scorecard.sections.find((s) => s.key === 'schema')!;
    expect(full.score).toBe(100);
    expect(full.reason).toBe('contentIntelligence.reasons.schema.strong');

    const none = buildScorecard(
      makeInput({
        owned: makeOwned({ schemaTypes: [], hasSchemaOrgArticle: false, description: null }),
      }),
    ).scorecard.sections.find((s) => s.key === 'schema')!;
    expect(none.score).toBe(0);
    expect(none.reason).toBe('contentIntelligence.reasons.schema.needsWork');
  });

  it('technical: language, canonical, and a non-empty excerpt stack to 100', () => {
    const full = buildScorecard(makeInput())
      .scorecard.sections.find((s) => s.key === 'technical')!;
    expect(full.score).toBe(100);
    expect(full.reason).toBe('contentIntelligence.reasons.technical.strong');

    const none = buildScorecard(
      makeInput({
        owned: makeOwned({ language: null, canonical: null, excerpt: '' }),
      }),
    ).scorecard.sections.find((s) => s.key === 'technical')!;
    expect(none.score).toBe(0);
    expect(none.reason).toBe('contentIntelligence.reasons.technical.needsWork');
  });

  it('weights the total by section weight and clamps to 0..100', () => {
    const output = buildScorecard(makeInput());
    const expected = Math.round(
      output.scorecard.sections.reduce((sum, s) => sum + (s.score * s.weight) / 100, 0),
    );
    expect(output.scorecard.total).toBe(expected);
    expect(output.scorecard.total).toBeGreaterThanOrEqual(0);
    expect(output.scorecard.total).toBeLessThanOrEqual(100);
  });
});

describe('rule triggers — all fourteen on and off', () => {
  it('a strong page with full evidence triggers zero rules', () => {
    expect(ruleIds(makeInput())).toEqual([]);
  });

  it('a weak page with full evidence triggers the twelve applicable rules', () => {
    const weak = makeInput({
      owned: makeOwned({
        title: null,
        description: null,
        canonical: null,
        language: null,
        wordCount: 50,
        headingCount: 0,
        schemaTypes: [],
        hasSchemaOrgArticle: false,
        internalLinkCount: 0,
        externalLinkCount: 0,
        excerpt: 'Nothing about the topic at all.',
      }),
      serp: { device: 'desktop', ownedPosition: null, topUrls: [] },
      competitors: [
        makeCompetitor(1, { wordCount: 1_000, headingCount: 3 }),
        makeCompetitor(2, { wordCount: 1_000, headingCount: 3 }),
        makeCompetitor(3, { wordCount: 1_000, headingCount: 3 }),
      ],
    });
    expect(ruleIds(weak).sort()).toEqual(
      [
        'keyword-in-title',
        'serp-presence',
        'expand-content',
        'broaden-headings',
        'add-title',
        'add-description',
        'add-headings',
        'add-internal-links',
        'add-external-links',
        'add-structured-data',
        'set-canonical',
        'set-language',
      ].sort(),
    );
  });

  it('mark-up-article fires only when schema types exist without Article', () => {
    const ids = ruleIds(
      makeInput({
        owned: makeOwned({ schemaTypes: ['FAQPage'], hasSchemaOrgArticle: false }),
      }),
    );
    expect(ids).toContain('mark-up-article');
    expect(ids).not.toContain('add-structured-data');
  });

  it('competitor-backed rules attach owned + competitor evidence; others stay owned-only', () => {
    const weak = makeInput({
      owned: makeOwned({ wordCount: 50, title: null }),
    });
    const output = buildScorecard(weak);
    const expand = output.recommendations.find((r) => r.ruleId === 'expand-content')!;
    expect(expand.evidenceSourceIds).toEqual([
      'owned',
      'competitor-1',
      'competitor-2',
      'competitor-3',
    ]);
    const title = output.recommendations.find((r) => r.ruleId === 'add-title')!;
    expect(title.evidenceSourceIds).toEqual(['owned']);
    expect(expand.id).toBe('rec-coverage-expand-content');
    expect(expand.messageKey).toBe('contentIntelligence.rules.expand-content');
  });

  it('caps evidenceSourceIds at ten entries with many competitors (schema-valid)', () => {
    const competitors = Array.from({ length: 12 }, (_, i) =>
      makeCompetitor(i + 1, { wordCount: 2_000, headingCount: 8 }),
    );
    const output = buildScorecard(
      makeInput({ competitors, owned: makeOwned({ wordCount: 100 }) }),
    );
    const expand = output.recommendations.find((r) => r.ruleId === 'expand-content')!;
    expect(expand.evidenceSourceIds).toHaveLength(10);
    expect(expand.evidenceSourceIds[0]).toBe('owned');
    expect(() => recommendationSchema.parse(expand)).not.toThrow();
  });
});

describe('module-load weight assertion', () => {
  it('throws at import time when SECTION_WEIGHTS do not sum to 100', async () => {
    vi.resetModules();
    vi.doMock('./content-analysis.schemas.js', () => ({
      SECTION_WEIGHTS: {
        intent: 10,
        coverage: 10,
        structure: 10,
        links: 10,
        schema: 10,
        technical: 10,
      },
      SCORE_VERSION: 'weights-test',
      SCORECARD_SECTIONS: ['intent', 'coverage', 'structure', 'links', 'schema', 'technical'],
    }));
    try {
      await expect(import('./content-analysis.score.js')).rejects.toThrow(
        /SECTION_WEIGHTS must sum to 100 \(got 60\)/,
      );
    } finally {
      vi.doUnmock('./content-analysis.schemas.js');
      vi.resetModules();
    }
  });
});
