import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@shared/api/client';
import {
  fetchInternalLinkCsv,
  fetchInternalLinkRun,
  fetchInternalLinkRuns,
  previewInternalLinkRun,
  startInternalLinkRun,
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

describe('internal-links API', () => {
  it('previews and starts with bounded locale input', async () => {
    mocked.mockResolvedValue({} as never);
    await previewInternalLinkRun('site');
    expect(mocked).toHaveBeenLastCalledWith('/sites/site/internal-link-runs/preview', {
      method: 'POST',
      body: {},
    });
    await startInternalLinkRun('site', 'ar');
    expect(mocked).toHaveBeenLastCalledWith('/sites/site/internal-link-runs', {
      method: 'POST',
      body: { locale: 'ar' },
    });
  });

  it('lists and reads runs with and without abort signals', async () => {
    mocked.mockResolvedValue({ items: [] } as never);
    await fetchInternalLinkRuns('site');
    expect(mocked).toHaveBeenLastCalledWith('/sites/site/internal-link-runs', {});
    const controller = new AbortController();
    await fetchInternalLinkRuns('site', controller.signal);
    expect(mocked).toHaveBeenLastCalledWith('/sites/site/internal-link-runs', {
      signal: controller.signal,
    });
    await fetchInternalLinkRun('run');
    expect(mocked).toHaveBeenLastCalledWith('/internal-link-runs/run', {});
    await fetchInternalLinkRun('run', controller.signal);
    expect(mocked).toHaveBeenLastCalledWith('/internal-link-runs/run', {
      signal: controller.signal,
    });
  });

  it('requests the stored CSV as text', async () => {
    mocked.mockResolvedValue('source_url\r\n' as never);
    await expect(fetchInternalLinkCsv('run')).resolves.toContain('source_url');
    expect(mocked).toHaveBeenLastCalledWith('/internal-link-runs/run/export.csv', {
      localeMode: 'artifact',
      allowLegacyNullContentLanguage: true,
      headers: { Accept: 'text/csv' },
    });
  });
});
