import { describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import {
  resolveAiTaskProfile,
  SYSTEM_INSTRUCTION_TEMPLATES,
} from '../../shared/ai-profiles/index.js';
import type { InventoryPageFacts } from '../content-intelligence/index.js';
import {
  applyInternalLinkingAiOutput,
  InternalLinkAiOutputContractError,
  validateInternalLinkingAiOutput,
} from './internal-links.ai-contract.js';
import type { InternalLinkSuggestion } from './internal-links.schemas.js';

const DATE = '2026-08-01T00:00:00.000Z';

function inventoryPage(url: string, noindex = false): InventoryPageFacts {
  return {
    url,
    canonical: null,
    statusCode: 200,
    robots: [],
    language: 'en',
    title: 'Page',
    description: null,
    headings: ['Internal link page'],
    wordCount: 500,
    schemaTypes: [],
    hasSchemaOrgArticle: false,
    internalLinkCount: 0,
    externalLinkCount: 0,
    internalOutLinks: [],
    contentHash: url,
    primaryTopics: [],
    secondaryTopics: [],
    targetQueries: [],
    qualityFlags: noindex ? ['noindex'] : [],
  };
}

function candidate(
  id: string,
  sourceUrl = 'https://example.com/source',
  targetUrl = 'https://example.com/target',
): InternalLinkSuggestion {
  return {
    id,
    sourceUrl,
    sourceSection: '/',
    sourceWordCount: 500,
    targetUrl,
    targetFlag: 'orphan',
    targetInboundCount: 0,
    confidence: 'high',
    sharedQueries: ['seo audit'],
    headingMatches: ['audit', 'seo'],
    anchorText: 'SEO audit',
    inventoryDate: DATE,
    rank: null,
    rankingSource: 'deterministic',
  };
}

const C1 = candidate('link-11111111111111111111');
const C2 = candidate(
  'link-22222222222222222222',
  'https://example.com/other-source',
  'https://example.com/other-target',
);
const INVENTORY = [
  inventoryPage(C1.sourceUrl),
  inventoryPage(C1.targetUrl),
  inventoryPage(C2.sourceUrl),
  inventoryPage(C2.targetUrl),
];

function output(overrides: Record<string, unknown> = {}) {
  return {
    suggestions: [
      {
        candidateId: C1.id,
        sourceUrl: C1.sourceUrl,
        targetUrl: C1.targetUrl,
        anchorText: 'concise SEO audit guide',
        ...overrides,
      },
    ],
    citations: [C1.id],
  };
}

describe('internal_linking AI profile', () => {
  it('pins the 12,000-micro ceiling and candidate-only data classification', () => {
    const profile = resolveAiTaskProfile('internal_linking');
    expect(profile.maxCostMicros).toBe(12_000n);
    expect(profile.maxCostMicros).toBeLessThanOrEqual(
      BigInt(env.INTERNAL_LINKING_COST_CEILING_MICROS),
    );
    expect(profile.sourceCollections).toEqual(['candidates']);
    expect(profile.dataClassification).toEqual({
      sanitizedPageTextPermitted: false,
      sanitizedCompetitorTextPermitted: false,
      generatedTextInputPermitted: false,
    });
    expect(
      SYSTEM_INSTRUCTION_TEMPLATES[profile.systemInstruction.templateId],
    ).toContain('Never add a page');
    expect(
      profile.inputSchema.safeParse({
        candidates: [
          {
            id: C1.id,
            sourceUrl: C1.sourceUrl,
            targetUrl: C1.targetUrl,
            targetFlag: 'orphan',
            targetInboundCount: 0,
            confidence: 'high',
            sharedQueries: ['seo audit'],
            headingMatches: ['audit'],
            targetLabel: 'SEO audit',
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      profile.inputSchema.safeParse({ candidates: [], pageMarkdown: 'secret' }).success,
    ).toBe(false);
  });
});

describe('validateInternalLinkingAiOutput', () => {
  it('accepts exact inventoried pairs and apply preserves omitted candidates', () => {
    const accepted = validateInternalLinkingAiOutput(output(), [C1, C2], INVENTORY);
    const applied = applyInternalLinkingAiOutput(accepted, [C1, C2]);
    expect(applied).toHaveLength(2);
    expect(applied[0]).toMatchObject({
      id: C1.id,
      anchorText: 'concise SEO audit guide',
      rank: 1,
      rankingSource: 'ai',
    });
    expect(applied[1]).toMatchObject({
      id: C2.id,
      anchorText: C2.anchorText,
      rank: null,
      rankingSource: 'deterministic',
    });
    expect(
      applyInternalLinkingAiOutput(
        { suggestions: [], citations: [] },
        [C1],
      )[0]?.rankingSource,
    ).toBe('deterministic');
  });

  it('rejects structural additions and anchors above 120 code points', () => {
    expect(() =>
      validateInternalLinkingAiOutput(
        { ...output(), unexpected: true },
        [C1],
        INVENTORY,
      ),
    ).toThrow(InternalLinkAiOutputContractError);
    expect(() =>
      validateInternalLinkingAiOutput(
        output({ anchorText: 'a'.repeat(121) }),
        [C1],
        INVENTORY,
      ),
    ).toThrow(InternalLinkAiOutputContractError);
  });

  it('rejects unknown ids, changed pairs, and URLs outside inventory', () => {
    expect(() =>
      validateInternalLinkingAiOutput(
        output({ candidateId: 'link-99999999999999999999' }),
        [C1],
        INVENTORY,
      ),
    ).toThrow(InternalLinkAiOutputContractError);
    expect(() =>
      validateInternalLinkingAiOutput(
        output({ sourceUrl: 'https://example.com/changed' }),
        [C1],
        [...INVENTORY, inventoryPage('https://example.com/changed')],
      ),
    ).toThrow(InternalLinkAiOutputContractError);
    const outside = candidate(
      'link-33333333333333333333',
      C1.sourceUrl,
      'https://outside.example/target',
    );
    expect(() =>
      validateInternalLinkingAiOutput(
        {
          suggestions: [
            {
              candidateId: outside.id,
              sourceUrl: outside.sourceUrl,
              targetUrl: outside.targetUrl,
              anchorText: 'outside',
            },
          ],
          citations: [],
        },
        [outside],
        INVENTORY,
      ),
    ).toThrow(InternalLinkAiOutputContractError);
  });

  it('rejects a noindex target even when a supplied candidate names it', () => {
    const hostile = candidate(
      'link-44444444444444444444',
      C1.sourceUrl,
      'https://example.com/noindex',
    );
    expect(() =>
      validateInternalLinkingAiOutput(
        {
          suggestions: [
            {
              candidateId: hostile.id,
              sourceUrl: hostile.sourceUrl,
              targetUrl: hostile.targetUrl,
              anchorText: 'noindex',
            },
          ],
          citations: [],
        },
        [hostile],
        [inventoryPage(hostile.sourceUrl), inventoryPage(hostile.targetUrl, true)],
      ),
    ).toThrow(InternalLinkAiOutputContractError);
  });

  it('rejects duplicate candidate ids and duplicate source-target pairs', () => {
    const row = output().suggestions[0]!;
    expect(() =>
      validateInternalLinkingAiOutput(
        { suggestions: [row, row], citations: [] },
        [C1],
        INVENTORY,
      ),
    ).toThrow(InternalLinkAiOutputContractError);

    const samePair = candidate(
      'link-55555555555555555555',
      C1.sourceUrl,
      C1.targetUrl,
    );
    expect(() =>
      validateInternalLinkingAiOutput(
        {
          suggestions: [
            row,
            {
              candidateId: samePair.id,
              sourceUrl: samePair.sourceUrl,
              targetUrl: samePair.targetUrl,
              anchorText: 'second',
            },
          ],
          citations: [],
        },
        [C1, samePair],
        INVENTORY,
      ),
    ).toThrow(InternalLinkAiOutputContractError);
  });
});

