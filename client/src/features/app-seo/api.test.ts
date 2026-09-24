import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@shared/api/client';
import { createAppProfile, fetchAppProfiles, removeAppProfile } from './api';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);
const siteId = '65f000000000000000000abc';

beforeEach(() => mockedApiClient.mockReset());

describe('App SEO API paths', () => {
  it('lists profiles from the site-nested path', async () => {
    mockedApiClient.mockResolvedValueOnce({ items: [{ id: 'profile-1' }] });
    await expect(fetchAppProfiles(siteId)).resolves.toEqual([{ id: 'profile-1' }]);
    expect(mockedApiClient).toHaveBeenCalledWith(`/sites/${siteId}/apps/profiles`);
  });

  it('posts registration input and unwraps the profile', async () => {
    const input = { playPackageId: 'com.example.app', paired: false };
    mockedApiClient.mockResolvedValueOnce({ profile: { id: 'profile-1' } });
    await expect(createAppProfile(siteId, input)).resolves.toEqual({ id: 'profile-1' });
    expect(mockedApiClient).toHaveBeenCalledWith(`/sites/${siteId}/apps/profiles`, {
      method: 'POST',
      body: input,
    });
  });

  it('deletes the encoded profile path', async () => {
    mockedApiClient.mockResolvedValueOnce(undefined);
    await removeAppProfile(siteId, 'profile/1');
    expect(mockedApiClient).toHaveBeenCalledWith(`/sites/${siteId}/apps/profiles/profile%2F1`, {
      method: 'DELETE',
    });
  });
});
