import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@shared/api/client';
import { initI18n } from '@shared/i18n';
import * as api from '../api';
import type { AppProfile } from '../types';
import { appSeoReducer, clearAppSeoRegistration, initialAppSeoState } from './slice';
import { selectAppProfileCount, selectAppProfiles, selectAppSeoRegistration } from './selectors';
import { loadAppProfiles, registerAppProfile, unregisterAppProfile } from './thunks';
import type { RootState } from '@app/store';

vi.mock('../api', () => ({
  fetchAppProfiles: vi.fn(),
  createAppProfile: vi.fn(),
  removeAppProfile: vi.fn(),
}));

const profile: AppProfile = {
  id: 'profile-1',
  siteId: 'site-1',
  playPackageId: 'com.example.app',
  appStoreId: null,
  paired: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const makeTestStore = () => configureStore({ reducer: { appSeo: appSeoReducer } });

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  vi.resetAllMocks();
});

describe('App SEO lazy slice', () => {
  it('all selectors fall back to initial state before injection', () => {
    const state = {} as RootState;
    expect(selectAppProfiles(state)).toBe(initialAppSeoState.profiles);
    expect(selectAppSeoRegistration(state)).toBe(initialAppSeoState.registration);
    expect(selectAppProfileCount(state)).toBe(0);
  });

  it('loads, registers, deletes, and clears registration state', async () => {
    vi.mocked(api.fetchAppProfiles).mockResolvedValueOnce([profile]);
    vi.mocked(api.createAppProfile).mockResolvedValueOnce({ ...profile, id: 'profile-2' });
    vi.mocked(api.removeAppProfile).mockResolvedValueOnce(undefined);
    const store = makeTestStore();

    await store.dispatch(loadAppProfiles({ siteId: 'site-1' }));
    expect(store.getState().appSeo.profiles).toEqual([profile]);
    expect(store.getState().appSeo.registration.status).toBe('idle');

    await store.dispatch(
      registerAppProfile({
        siteId: 'site-1',
        input: { appStoreId: '123456', paired: false },
      }),
    );
    expect(store.getState().appSeo.profiles.map(({ id }) => id)).toEqual([
      'profile-2',
      'profile-1',
    ]);

    await store.dispatch(unregisterAppProfile({ siteId: 'site-1', profileId: 'profile-1' }));
    expect(store.getState().appSeo.profiles).toHaveLength(1);
    store.dispatch(clearAppSeoRegistration());
    expect(store.getState().appSeo.registration).toEqual({ status: 'idle', message: '' });
  });

  it.each([
    [
      new ApiError('disabled', 503, { error: { message: 'App SEO is unavailable' } }),
      'unavailable',
      'App SEO is unavailable',
    ],
    [
      new ApiError('server error', 500, { error: { message: 'App profile request failed' } }),
      'failed',
      'App profile request failed',
    ],
    [new Error('offline'), 'failed', 'The request could not be completed. Try again.'],
  ] as const)('classifies mutation refusals as %s', async (error, status, message) => {
    vi.mocked(api.createAppProfile).mockRejectedValueOnce(error);
    const store = makeTestStore();
    await store.dispatch(
      registerAppProfile({
        siteId: 'site-1',
        input: { playPackageId: 'com.example.app', paired: false },
      }),
    );
    expect(store.getState().appSeo.registration).toEqual({ status, message });
  });

  it('stores list and delete failures and handles reducer rejections without a payload', async () => {
    vi.mocked(api.fetchAppProfiles).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(api.removeAppProfile).mockRejectedValueOnce(new Error('offline'));
    const store = makeTestStore();
    await store.dispatch(loadAppProfiles({ siteId: 'site-1' }));
    expect(store.getState().appSeo.registration.status).toBe('failed');
    await store.dispatch(unregisterAppProfile({ siteId: 'site-1', profileId: 'profile-1' }));
    expect(store.getState().appSeo.registration.status).toBe('failed');

    const withoutPayload = appSeoReducer(
      initialAppSeoState,
      registerAppProfile.rejected(new Error('raw failure'), 'request-1', {
        siteId: 'site-1',
        input: { paired: false },
      }),
    );
    expect(withoutPayload.registration).toEqual({ status: 'failed', message: 'raw failure' });

    const withoutPayloadOrMessage = appSeoReducer(initialAppSeoState, {
      type: registerAppProfile.rejected.type,
      meta: {
        requestId: 'request-2',
        requestStatus: 'rejected',
        arg: { siteId: 'site-1', input: { paired: false } },
      },
      error: {},
    });
    expect(withoutPayloadOrMessage.registration).toEqual({ status: 'failed', message: '' });
  });
});
