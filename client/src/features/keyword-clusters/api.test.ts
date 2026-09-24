import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@shared/api/client';
import {
  fetchKeywordClusterRun,
  fetchKeywordClusterRuns,
  fetchKeywordClusterKeywords,
  previewKeywordClusterRun,
  startKeywordClusterRun,
} from './api';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mocked = vi.mocked(apiClient);

beforeEach(() => {
  mocked.mockReset();
  mocked.mockResolvedValue({ sites: [] } as never);
});

describe('keyword-clusters API', () => {
  it('previews and starts with bounded locale input', async () => {
    mocked.mockResolvedValue({} as never);
    await previewKeywordClusterRun('site', ['keyword-1', 'keyword-2']);
    expect(mocked).toHaveBeenLastCalledWith(
      '/sites/site/keyword-cluster-runs/preview',
      { method: 'POST', body: { keywordIds: ['keyword-1', 'keyword-2'] } },
    );
    await startKeywordClusterRun('site', 'ar', ['keyword-1', 'keyword-2']);
    expect(mocked).toHaveBeenLastCalledWith('/sites/site/keyword-cluster-runs', {
      method: 'POST',
      body: { locale: 'ar', keywordIds: ['keyword-1', 'keyword-2'] },
    });
  });

  it('loads paginated active Google keywords for the scope picker', async () => {
    const controller = new AbortController();
    mocked
      .mockResolvedValueOnce({
        keywords: [
          { id: 'g-1', phrase: 'one', active: true, engine: 'google' },
          { id: 'b-1', phrase: 'bing', active: true, engine: 'bing' },
        ],
        nextCursor: 'next page',
      } as never)
      .mockResolvedValueOnce({
        keywords: [
          { id: 'g-2', phrase: 'two', active: true, engine: 'google' },
          { id: 'g-3', phrase: 'inactive', active: false, engine: 'google' },
        ],
        nextCursor: null,
      } as never);

    await expect(fetchKeywordClusterKeywords('site', controller.signal)).resolves.toEqual([
      { id: 'g-1', phrase: 'one' },
      { id: 'g-2', phrase: 'two' },
    ]);
    expect(mocked).toHaveBeenNthCalledWith(1, '/sites/site/keywords', {
      signal: controller.signal,
    });
    expect(mocked).toHaveBeenNthCalledWith(2, '/sites/site/keywords?cursor=next%20page', {
      signal: controller.signal,
    });
  });

  it('stops at the bounded 200-keyword scope without fetching another page', async () => {
    mocked.mockResolvedValueOnce({
      keywords: Array.from({ length: 200 }, (_, index) => ({
        id: `g-${index}`,
        phrase: `keyword ${index}`,
        active: true,
        engine: 'google',
      })),
      nextCursor: 'must-not-be-read',
    } as never);

    const keywords = await fetchKeywordClusterKeywords('site');

    expect(keywords).toHaveLength(200);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('lists and reads runs with and without abort signals', async () => {
    mocked.mockResolvedValue({ items: [] } as never);
    await fetchKeywordClusterRuns('site');
    expect(mocked).toHaveBeenLastCalledWith('/sites/site/keyword-cluster-runs', {});
    const controller = new AbortController();
    await fetchKeywordClusterRuns('site', controller.signal);
    expect(mocked).toHaveBeenLastCalledWith('/sites/site/keyword-cluster-runs', {
      signal: controller.signal,
    });
    await fetchKeywordClusterRun('run');
    expect(mocked).toHaveBeenLastCalledWith('/keyword-cluster-runs/run', {});
    await fetchKeywordClusterRun('run', controller.signal);
    expect(mocked).toHaveBeenLastCalledWith('/keyword-cluster-runs/run', {
      signal: controller.signal,
    });
  });
});
