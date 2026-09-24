import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '@shared/api/client';
import { deleteAccountRequest, exportMyDataRequest, fetchCsrfToken } from './api';

vi.mock('@shared/api/client', () => ({ apiClient: vi.fn() }));
const apiClient = vi.mocked(client.apiClient);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('account api', () => {
  it('exportMyDataRequest POSTs the legal export path', async () => {
    apiClient.mockResolvedValue({ account: { id: 'u-1' } } as never);
    const result = await exportMyDataRequest();
    expect(apiClient).toHaveBeenCalledWith('/legal/export', {
      method: 'POST',
      localeMode: 'artifact',
      allowLegacyNullContentLanguage: true,
    });
    expect(result).toEqual({ account: { id: 'u-1' } });
  });

  it('fetchCsrfToken GETs the csrf-token path', async () => {
    apiClient.mockResolvedValue({ csrfToken: 'tok-9' } as never);
    const result = await fetchCsrfToken();
    expect(apiClient).toHaveBeenCalledWith('/security/csrf-token');
    expect(result).toEqual({ csrfToken: 'tok-9' });
  });

  it('deleteAccountRequest POSTs delete-account with the CSRF header', async () => {
    apiClient.mockResolvedValue({
      scheduledAt: '2026-08-01T00:00:00.000Z',
      purgeAt: '2026-08-31T00:00:00.000Z',
      warningEmailQueued: true,
    } as never);
    const result = await deleteAccountRequest('tok-9');
    expect(apiClient).toHaveBeenCalledWith('/legal/delete-account', {
      method: 'POST',
      headers: { 'x-csrf-token': 'tok-9' },
    });
    expect(result.scheduledAt).toBe('2026-08-01T00:00:00.000Z');
  });
});
