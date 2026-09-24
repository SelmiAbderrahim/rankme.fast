import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn());

vi.mock('@shared/api/client', () => ({
  apiClient: api,
}));

import {
  getLanguagePreference,
  patchLanguagePreference,
} from './preferenceApi';

beforeEach(() => {
  api.mockReset();
});

describe('language preference API', () => {
  it('gets with and without an abort signal', async () => {
    api.mockResolvedValue({ language: 'en' });
    await expect(getLanguagePreference()).resolves.toEqual({ language: 'en' });
    expect(api).toHaveBeenLastCalledWith('/users/preferences/language', {});

    const controller = new AbortController();
    await getLanguagePreference(controller.signal);
    expect(api).toHaveBeenLastCalledWith('/users/preferences/language', {
      signal: controller.signal,
    });
  });

  it('patches with the selected locale header and optional compare-and-set fields', async () => {
    api.mockResolvedValue({ language: 'ar' });
    await expect(patchLanguagePreference('ar')).resolves.toEqual({ language: 'ar' });
    expect(api).toHaveBeenLastCalledWith('/users/preferences/language', {
      method: 'PATCH',
      body: { language: 'ar' },
      locale: 'ar',
    });

    const controller = new AbortController();
    await patchLanguagePreference('fr', {
      ifUnset: true,
      signal: controller.signal,
    });
    expect(api).toHaveBeenLastCalledWith('/users/preferences/language', {
      method: 'PATCH',
      body: { language: 'fr', ifUnset: true },
      locale: 'fr',
      signal: controller.signal,
    });
  });
});
