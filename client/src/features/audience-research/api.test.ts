import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/api/client', () => ({
  apiClient: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;
    code: string;
    constructor(status: number, data: unknown, code = 'http') {
      super('api');
      this.status = status;
      this.data = data;
      this.code = code;
    }
  },
}));

import { apiClient } from '@shared/api/client';
import {
  getAudienceResearchRun,
  getAudienceResearchRunResult,
  listAudienceResearchRuns,
  postAudienceResearchSignalDecision,
  startAudienceResearchRun,
} from './api';
import type { AudienceResearchInput } from './types';

const mocked = vi.mocked(apiClient);

const input: AudienceResearchInput = {
  siteMarket: { country: 'US', region: null, city: null, language: 'en', device: 'all' },
  competitorDomains: ['a.com'],
  seedTopics: ['topic one'],
};

beforeEach(() => {
  mocked.mockReset();
  mocked.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('audience-research api', () => {
  it('startAudienceResearchRun POSTs to /sites/:siteId/audience-research/runs', async () => {
    await startAudienceResearchRun('s1', input);
    expect(mocked).toHaveBeenCalledWith(
      '/sites/s1/audience-research/runs',
      expect.objectContaining({ method: 'POST', body: input }),
    );
  });

  it('listAudienceResearchRuns encodes limit + cursor', async () => {
    await listAudienceResearchRuns('s1', { limit: 5, cursor: 'c' });
    expect(mocked.mock.calls[0]![0]).toBe(
      '/sites/s1/audience-research/runs?limit=5&cursor=c',
    );
  });

  it('listAudienceResearchRuns omits query when empty', async () => {
    await listAudienceResearchRuns('s1');
    expect(mocked.mock.calls[0]![0]).toBe('/sites/s1/audience-research/runs');
  });

  it('getAudienceResearchRun and getAudienceResearchRunResult hit the right paths', async () => {
    await getAudienceResearchRun('s1', 'r1');
    expect(mocked.mock.calls[0]![0]).toBe('/sites/s1/audience-research/runs/r1');

    await getAudienceResearchRunResult('s1', 'r1');
    expect(mocked.mock.calls[1]![0]).toBe(
      '/sites/s1/audience-research/runs/r1/result',
    );
  });

  it('threads AbortSignal through every call', async () => {
    const controller = new AbortController();
    await startAudienceResearchRun('s', input, { signal: controller.signal });
    await listAudienceResearchRuns('s', {}, { signal: controller.signal });
    await getAudienceResearchRun('s', 'r', { signal: controller.signal });
    await getAudienceResearchRunResult('s', 'r', { signal: controller.signal });
    for (const call of mocked.mock.calls) {
      expect(call[1]).toMatchObject({ signal: controller.signal });
    }
  });

  it('encodes siteId and runId path segments', async () => {
    await getAudienceResearchRun('s/1', 'r/1');
    expect(mocked.mock.calls[0]![0]).toBe('/sites/s%2F1/audience-research/runs/r%2F1');
  });

  describe('postAudienceResearchSignalDecision', () => {
    it('POSTs accept with only server-authoritative fields', async () => {
      await postAudienceResearchSignalDecision({
        siteId: 's1',
        runId: 'r1',
        signalId: 'sig-1',
        decision: 'accepted',
        destination: 'product',
        idempotencyKey: 'k1234567',
      });
      expect(mocked.mock.calls[0]![0]).toBe(
        '/sites/s1/audience-research/runs/r1/signals/sig-1/decision',
      );
      expect(mocked.mock.calls[0]![1]).toMatchObject({
        method: 'POST',
        body: {
          decision: 'accepted',
          destination: 'product',
          idempotencyKey: 'k1234567',
        },
      });
      // The client MUST NEVER send evidence, confidence, priority, sources,
      // etc. — the body has ONLY the three fields above.
      const body = (mocked.mock.calls[0]![1] as { body: Record<string, unknown> }).body;
      expect(Object.keys(body).sort()).toEqual([
        'decision',
        'destination',
        'idempotencyKey',
      ]);
    });

    it('POSTs dismiss with optional reason', async () => {
      await postAudienceResearchSignalDecision({
        siteId: 's1',
        runId: 'r1',
        signalId: 'sig-1',
        decision: 'dismissed',
        reason: 'not_relevant',
        idempotencyKey: 'k1234567',
      });
      expect(mocked.mock.calls[0]![1]).toMatchObject({
        method: 'POST',
        body: {
          decision: 'dismissed',
          reason: 'not_relevant',
          idempotencyKey: 'k1234567',
        },
      });
    });

    it('percent-encodes signal id path segment', async () => {
      await postAudienceResearchSignalDecision({
        siteId: 's/1',
        runId: 'r/1',
        signalId: 'sig/one',
        decision: 'dismissed',
        idempotencyKey: 'k1234567',
      });
      expect(mocked.mock.calls[0]![0]).toBe(
        '/sites/s%2F1/audience-research/runs/r%2F1/signals/sig%2Fone/decision',
      );
    });

    it('threads AbortSignal through', async () => {
      const controller = new AbortController();
      await postAudienceResearchSignalDecision(
        {
          siteId: 's1',
          runId: 'r1',
          signalId: 'sig-1',
          decision: 'dismissed',
          idempotencyKey: 'k1234567',
        },
        { signal: controller.signal },
      );
      expect(mocked.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
    });
  });
});
