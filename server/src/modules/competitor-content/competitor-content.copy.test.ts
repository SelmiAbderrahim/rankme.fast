import { describe, expect, it } from 'vitest';
import { translate } from '../../shared/i18n/index.js';
import type { CompetitorContentFindings } from './competitor-content.schemas.js';
import {
  localizeCompetitorContentFindings,
  localizeCompetitorContentWarning,
} from './competitor-content.copy.js';

describe('competitor-content deterministic copy', () => {
  it('maps ordinary, allowed AI, rejected AI, and unknown warnings', () => {
    expect(localizeCompetitorContentWarning('ar', {
      code: 'competitor_partial', messageKey: 'ignored',
    })).toEqual({
      code: 'competitor_partial',
      messageKey: 'contentIntelligence.competitorContent.warnings.partialPortfolio',
      message: translate('ar', 'contentIntelligence.competitorContent.warnings.partialPortfolio'),
    });
    expect(localizeCompetitorContentWarning('fr', {
      code: 'competitor_ai_skipped',
      messageKey: 'contentIntelligence.competitorContent.warnings.aiBudgetExhausted',
    }).messageKey).toBe('contentIntelligence.competitorContent.warnings.aiBudgetExhausted');
    expect(localizeCompetitorContentWarning('de', {
      code: 'competitor_ai_skipped',
      messageKey: 'operator.untrusted',
    }).messageKey).toBe('contentIntelligence.competitorContent.warnings.unknown');
    expect(localizeCompetitorContentWarning('es', {
      code: 'future_warning', messageKey: 'ignored',
    }).messageKey).toBe('contentIntelligence.competitorContent.warnings.unknown');
  });

  it('localizes opportunity labels with and without safe variables', () => {
    const findings = {
      version: '1',
      thresholdsVersion: '1',
      ownedUrl: 'https://example.test/page',
      keyword: null,
      deltas: [],
      opportunities: [
        {
          id: 'topic', kind: 'topic_gap', confidence: 'high',
          evidenceSourceIds: ['topic:automation'], keywordEvidence: [],
          messageKey: 'contentIntelligence.competitorContent.opportunityCopy.topicGap',
          messageVars: { topic: 'automation' },
        },
        {
          id: 'format', kind: 'format_gap', confidence: 'medium',
          evidenceSourceIds: [], keywordEvidence: [],
          messageKey: 'contentIntelligence.competitorContent.opportunityCopy.formatGap',
        },
      ],
      partialDomains: [],
      aiExplanation: null,
    } as CompetitorContentFindings;
    const localized = localizeCompetitorContentFindings('ar', findings);
    expect(localized.opportunities[0]).toMatchObject({
      messageVars: { topic: 'automation' },
      label: translate(
        'ar',
        'contentIntelligence.competitorContent.opportunityCopy.topicGap',
        { topic: 'automation' },
      ),
    });
    expect(localized.opportunities[1]).not.toHaveProperty('messageVars');
    expect(localized.opportunities[1]?.label).not.toContain('{{');
  });
});
