import { expect, it, vi } from 'vitest';
import { apiClient } from '@shared/api/client';
import { fetchSiteHealthRequest } from './api';

vi.mock('@shared/api/client', () => ({ apiClient: vi.fn() }));

it('reads the stored dashboard health endpoint', async () => {
  vi.mocked(apiClient).mockResolvedValueOnce({ sites: [] });
  await fetchSiteHealthRequest();
  expect(apiClient).toHaveBeenCalledWith('/dashboard/site-health');
});
