import { describe, expect, it } from 'vitest';
import { translate } from '../../shared/i18n/index.js';
import type {
  Recommendation,
  Scorecard,
} from './content-analysis.schemas.js';
import {
  localizeContentAnalysisWarning,
  localizeRecommendation,
  localizeScorecard,
} from './content-analysis.copy.js';
import type { InventoryFindings } from './inventory.schemas.js';
import {
  localizeInventoryFindings,
  localizeInventoryWarning,
} from './inventory.copy.js';

describe('content-intelligence deterministic copy', () => {
  it('maps known and unknown analysis warning codes without trusting stored keys', () => {
    expect(localizeContentAnalysisWarning('ar', {
      code: 'serp_unavailable',
      messageKey: 'operator.supplied.key',
    })).toEqual({
      code: 'serp_unavailable',
      messageKey: 'contentIntelligence.warnings.serpUnavailable',
      message: translate('ar', 'contentIntelligence.warnings.serpUnavailable'),
    });
    expect(localizeContentAnalysisWarning('fr', {
      code: 'future_warning',
      messageKey: 'contentIntelligence.warnings.serpUnavailable',
    })).toEqual({
      code: 'future_warning',
      messageKey: 'contentIntelligence.warnings.unknown',
      message: translate('fr', 'contentIntelligence.warnings.unknown'),
    });
  });

  it('allowlists score reasons and recommendation keys with safe fallbacks', () => {
    const scorecard = {
      version: '1',
      total: 50,
      sections: [
        {
          key: 'search_intent', score: 50, weight: 50, confidence: 1,
          reason: 'contentIntelligence.reasons.intent.strong',
        },
        {
          key: 'topic_coverage', score: 50, weight: 50, confidence: 1,
          reason: 'contentIntelligence.reasons.not-a-real-key',
        },
        {
          key: 'readability', score: 50, weight: 0, confidence: 1,
          reason: 'auditRules.robots-blocked.why',
        },
      ],
    } as unknown as Scorecard;
    const localized = localizeScorecard('de', scorecard);
    expect(localized.sections.map((section) => section.reasonKey)).toEqual([
      'contentIntelligence.reasons.intent.strong',
      'contentIntelligence.reasons.unknown',
      'contentIntelligence.reasons.unknown',
    ]);
    expect(localized.sections.every((section) => !section.reasonText.includes('{{'))).toBe(true);

    const base = {
      id: 'recommendation',
      section: 'search_intent',
      ruleId: 'rule',
      direction: 'clarify',
      confidence: 1,
      evidenceSourceIds: [],
    } as const;
    expect(localizeRecommendation('es', {
      ...base,
      messageKey: 'contentIntelligence.rules.keyword-in-title',
    } as unknown as Recommendation).messageKey).toBe('contentIntelligence.rules.keyword-in-title');
    expect(localizeRecommendation('es', {
      ...base,
      messageKey: 'contentIntelligence.rules.not-a-real-key',
    } as unknown as Recommendation).messageKey).toBe('contentIntelligence.rules.unknown');
    expect(localizeRecommendation('es', {
      ...base,
      messageKey: 'auditRules.robots-blocked.fix',
    } as unknown as Recommendation).messageKey).toBe('contentIntelligence.rules.unknown');
  });

  it('localizes inventory warnings and every reason enum', () => {
    expect(localizeInventoryWarning('zh', {
      code: 'inventory_partial_crawl',
      messageKey: 'ignored',
    }).messageKey).toBe('contentIntelligence.inventory.warnings.partialCrawl');
    expect(localizeInventoryWarning('ru', {
      code: 'future_warning',
      messageKey: 'ignored',
    }).messageKey).toBe('contentIntelligence.inventory.warnings.unknown');

    const findings = {
      version: '1',
      thresholdsVersion: '1',
      clusters: [],
      duplicates: [],
      thinPages: [
        { url: 'https://example.test/thin', reason: 'thin', wordCount: 1, internalLinkCount: 0 },
        { url: 'https://example.test/weak', reason: 'weakly_linked', wordCount: 500, internalLinkCount: 1 },
      ],
      orphanPages: [
        { url: 'https://example.test/orphan', reason: 'orphan', wordCount: 500, internalLinkCount: 0 },
      ],
      cannibalization: [],
      gaps: [],
      opportunityExplanation: null,
    } satisfies InventoryFindings;
    const localized = localizeInventoryFindings('ar', findings);
    expect([
      ...localized.thinPages,
      ...localized.orphanPages,
    ].map((item) => item.reasonKey)).toEqual([
      'contentIntelligence.inventory.reasons.thin',
      'contentIntelligence.inventory.reasons.weaklyLinked',
      'contentIntelligence.inventory.reasons.orphan',
    ]);
    expect(localized.thinPages[0]?.reasonText).toMatch(/[\u0600-\u06ff]/u);
  });
});
