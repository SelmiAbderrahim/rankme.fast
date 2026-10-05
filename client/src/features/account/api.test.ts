import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '@shared/api/client';
import { exportMyDataRequest } from './api';

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
});
