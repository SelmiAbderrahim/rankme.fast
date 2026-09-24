import type { Page } from '@playwright/test';

export const E2E_RECOMMENDATION_ANALYSIS_ID = '507f1f77bcf86cd799439011';

/** Deterministic browser fixture for accessibility/RTL coverage of Content Intelligence. */
export async function mockRecommendationAnalysis(
  page: Page,
  siteId: string,
  locale: 'en' | 'ar' = 'en',
): Promise<void> {
  await page.route(
    `**/api/content-analyses/${E2E_RECOMMENDATION_ANALYSIS_ID}*`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'content-language': locale, vary: 'x-lang, Accept-Language' },
        body: JSON.stringify({
          analysisId: E2E_RECOMMENDATION_ANALYSIS_ID,
          siteId,
          ownedUrl: 'https://example.com/guide',
          keyword: 'content audit',
          locale,
          status: 'completed',
          stages: [],
          warnings: [],
          scorecard: null,
          schemaVersion: '2026-07-15.1',
          scorecardV2: null,
          owned: { url: 'https://example.com/guide', contentHash: 'analysis-hash' },
          recommendations: [{
            id: 'rec_1',
            section: 'coverage',
            ruleId: 'add-topic',
            direction: 'add',
            confidence: 0.9,
            messageKey: 'contentIntelligence.recs.coverage.addTopic',
            evidenceSourceIds: ['owned'],
          }],
          recommendationStates: [{
            recommendationId: 'rec_1',
            analysisVersion: '2026-07-15.1',
            state: 'accepted',
            version: 1,
            actorUserId: 'e2e-actor',
            stateChangedAt: '2026-07-15T00:00:00.000Z',
            appliedAt: null,
            baselineAnchorAt: null,
            contentHash: null,
            analysisContentHash: null,
            hashStatus: 'unavailable',
          }],
          brief: null,
          draft: null,
          citations: [],
          error: null,
          reservation: { key: 'e2e', reservedUnits: 1, refundedAt: null, refundReason: null },
          costMicros: 0,
          aiCostMicros: 0,
          requestedAt: '2026-07-14T00:00:00.000Z',
          startedAt: '2026-07-14T00:00:00.000Z',
          completedAt: '2026-07-15T00:00:00.000Z',
          cancelledAt: null,
        }),
      });
    },
  );
  await page.route(
    `**/api/content-analyses/${E2E_RECOMMENDATION_ANALYSIS_ID}/recommendations/rec_1/application-check`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'content-language': locale, vary: 'x-lang, Accept-Language' },
        body: JSON.stringify({
          available: true,
          hashStatus: 'same',
          contentHash: 'analysis-hash',
          analysisContentHash: 'analysis-hash',
          noteRequired: true,
          freshnessDays: 30,
        }),
      });
    },
  );
}
