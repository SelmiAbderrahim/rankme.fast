import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@shared/api/client';
import {
  createContentBrief,
  getContentBrief,
  listContentBriefs,
  previewContentBrief,
  rescoreContentBrief,
} from './api';

vi.mock('@shared/api/client', () => ({ apiClient: vi.fn() }));
const mocked = vi.mocked(apiClient);

beforeEach(() => mocked.mockReset().mockResolvedValue({}));

describe('content-brief API', () => {
  it('encodes site and brief path segments and forwards abort signals', async () => {
    const controller = new AbortController();
    await previewContentBrief('site / 1', { keyword: 'proof', locale: 'en' }, { signal: controller.signal });
    await getContentBrief('site / 1', 'brief / 1', { signal: controller.signal });
    expect(mocked.mock.calls[0]).toEqual([
      '/sites/site%20%2F%201/content-briefs/preview',
      { method: 'POST', body: { keyword: 'proof', locale: 'en' }, signal: controller.signal },
    ]);
    expect(mocked.mock.calls[1]).toEqual([
      '/sites/site%20%2F%201/content-briefs/brief%20%2F%201',
      { signal: controller.signal },
    ]);
  });

  it('creates and re-scores through bounded mutation endpoints', async () => {
    await createContentBrief('s1', { keyword: 'proof', locale: 'fr', clientKey: 'key' });
    await rescoreContentBrief('s1', 'b1', { draft: 'Draft', locale: 'fr' });
    expect(mocked.mock.calls[0]).toEqual([
      '/sites/s1/content-briefs',
      { method: 'POST', body: { keyword: 'proof', locale: 'fr', clientKey: 'key' } },
    ]);
    expect(mocked.mock.calls[1]).toEqual([
      '/sites/s1/content-briefs/b1/drafts',
      { method: 'POST', body: { draft: 'Draft', locale: 'fr' } },
    ]);
  });

  it('serializes URL-backed list status and optional cursor', async () => {
    await listContentBriefs('s1', 'completed');
    await listContentBriefs('s1', 'all', 'cursor value');
    expect(mocked.mock.calls[0]?.[0]).toBe('/sites/s1/content-briefs?status=completed&limit=20');
    expect(mocked.mock.calls[1]?.[0]).toBe('/sites/s1/content-briefs?status=all&limit=20&cursor=cursor+value');
  });
});
