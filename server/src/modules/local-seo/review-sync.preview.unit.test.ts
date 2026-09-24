import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertReviewIntelligenceEnabled: vi.fn(),
  loadOwnedProfile: vi.fn(),
}));

vi.mock('./review-sync.service.js', () => ({
  assertReviewIntelligenceEnabled: mocks.assertReviewIntelligenceEnabled,
  loadOwnedProfile: mocks.loadOwnedProfile,
}));

import { previewReviewSyncSpend } from './review-sync.preview.js';

const input = {
  profileId: '507f1f77bcf86cd799439011',
  sources: ['google', 'trustpilot'] as Array<'google' | 'trustpilot'>,
  depth: 10,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('review-sync preview', () => {
  it('describes one fresh sync unit without any capacity accounting', async () => {
    const preview = await previewReviewSyncSpend('account-1', input, {
      now: () => new Date('2026-08-14T00:00:00.000Z'),
    });

    expect(mocks.loadOwnedProfile).toHaveBeenCalledWith('account-1', input.profileId);
    expect(mocks.assertReviewIntelligenceEnabled).toHaveBeenCalledOnce();
    expect(preview).toEqual({
      deploymentMode: 'community',
      capacityEnforced: false,
      feature: 'review_intelligence',
      operation: 'review-sync',
      metric: 'review_syncs',
      productUnits: 1,
      cachedStatus: 'miss',
      breakdown: [
        {
          operationKey: 'review-sync:google+trustpilot',
          metric: 'review_syncs',
          productUnits: 1,
          cachedStatus: 'miss',
        },
      ],
      coverage: [
        {
          observationType: 'public-review-listing',
          state: 'supported',
          coverageNoteKey: 'observations.coverage.publicReviewsOnly',
        },
      ],
      estimatedAt: '2026-08-14T00:00:00.000Z',
    });
  });

  it('defaults the clock when no deps are supplied', async () => {
    const preview = await previewReviewSyncSpend('account-1', input);
    expect(Number.isNaN(Date.parse(preview.estimatedAt ?? ''))).toBe(false);
  });

  it('stops before pricing when the profile is not owned', async () => {
    mocks.loadOwnedProfile.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
    await expect(previewReviewSyncSpend('account-1', input)).rejects.toMatchObject({ status: 404 });
    expect(mocks.assertReviewIntelligenceEnabled).not.toHaveBeenCalled();
  });
});
