import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { ApiError } from '@shared/api/client';
import { initI18n } from '@shared/i18n';
import * as api from '../api';
import { sitesReducer } from './slice';
import { addSite, loadSites, pauseSite, removeSite, renameSite, resumeSite } from './thunks';
import type { Site } from '../types';

vi.mock('../api', () => ({
  fetchSitesRequest: vi.fn(),
  createSiteRequest: vi.fn(),
  deleteSiteRequest: vi.fn(),
  updateSiteRequest: vi.fn(),
  pauseSiteRequest: vi.fn(),
  resumeSiteRequest: vi.fn(),
}));

const mocked = vi.mocked(api);

const site: Site = {
  id: 's-1',
  url: 'https://example.com',
  domain: 'example.com',
  displayName: '',
  paused: false,
  pausedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const makeStore = () => configureStore({ reducer: { sites: sitesReducer } });

const serverError = (message: string, status = 400) =>
  new ApiError('request failed', status, { error: { message } });

beforeAll(() => {
  initI18n({ initialLocale: 'en' });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadSites', () => {
  it('stores the fetched page on success', async () => {
    mocked.fetchSitesRequest.mockResolvedValue({ sites: [site], nextCursor: null });
    const store = makeStore();
    await store.dispatch(loadSites({ direction: 'initial' }));
    expect(mocked.fetchSitesRequest).toHaveBeenCalledWith(undefined);
    expect(store.getState().sites.items).toEqual([site]);
    expect(store.getState().sites.loaded).toBe(true);
  });

  it('passes the cursor through', async () => {
    mocked.fetchSitesRequest.mockResolvedValue({ sites: [], nextCursor: null });
    const store = makeStore();
    await store.dispatch(loadSites({ cursor: 'c1', direction: 'next' }));
    expect(mocked.fetchSitesRequest).toHaveBeenCalledWith('c1');
  });

  it('rejects with the server-localized message', async () => {
    mocked.fetchSitesRequest.mockRejectedValue(serverError('serveur en panne', 500));
    const store = makeStore();
    await store.dispatch(loadSites({ direction: 'initial' }));
    expect(store.getState().sites.error).toBe('serveur en panne');
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.fetchSitesRequest.mockRejectedValue(new TypeError('fetch failed'));
    const store = makeStore();
    await store.dispatch(loadSites({ direction: 'initial' }));
    expect(store.getState().sites.error).toBe('Could not load your sites.');
  });
});

describe('addSite', () => {
  it('resolves with the created site and message', async () => {
    mocked.createSiteRequest.mockResolvedValue({ site, message: 'Site added.' });
    const store = makeStore();
    const result = await store.dispatch(addSite('https://example.com'));
    expect(addSite.fulfilled.match(result)).toBe(true);
    expect(store.getState().sites.message).toBe('Site added.');
  });

  it('rejects with the server message (e.g. duplicate 409)', async () => {
    mocked.createSiteRequest.mockRejectedValue(
      serverError('That site is already in your account.', 409),
    );
    const store = makeStore();
    await store.dispatch(addSite('https://example.com'));
    expect(store.getState().sites.addError).toBe('That site is already in your account.');
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.createSiteRequest.mockRejectedValue(new TypeError('fetch failed'));
    const store = makeStore();
    await store.dispatch(addSite('https://example.com'));
    expect(store.getState().sites.addError).toBe('Could not add the site.');
  });
});

describe('renameSite', () => {
  it('resolves with the renamed site and updates the row', async () => {
    const renamed = { ...site, displayName: 'My blog' };
    mocked.updateSiteRequest.mockResolvedValue({ site: renamed, message: 'Site updated.' });
    const store = makeStore();
    // seed the row so the fulfilled reducer can patch it
    store.dispatch({
      type: 'sites/load/fulfilled',
      payload: { sites: [site], nextCursor: null },
      meta: { arg: { direction: 'initial' } },
    });
    const result = await store.dispatch(
      renameSite({ id: site.id, displayName: 'My blog' }),
    );
    expect(renameSite.fulfilled.match(result)).toBe(true);
    expect(mocked.updateSiteRequest).toHaveBeenCalledWith('s-1', 'My blog');
    expect(store.getState().sites.items[0]?.displayName).toBe('My blog');
    expect(store.getState().sites.message).toBe('Site updated.');
    expect(store.getState().sites.renamingId).toBeNull();
  });

  it('leaves the items untouched when the renamed id is not in the list', async () => {
    const renamed = { ...site, id: 's-elsewhere', displayName: 'Elsewhere' };
    mocked.updateSiteRequest.mockResolvedValue({ site: renamed, message: 'Site updated.' });
    const store = makeStore();
    await store.dispatch(
      renameSite({ id: 's-elsewhere', displayName: 'Elsewhere' }),
    );
    expect(store.getState().sites.items).toEqual([]);
  });

  it('rejects with the server-localized message', async () => {
    mocked.updateSiteRequest.mockRejectedValue(serverError('Site not found.', 404));
    const store = makeStore();
    await store.dispatch(renameSite({ id: 's-1', displayName: 'X' }));
    expect(store.getState().sites.renameError).toBe('Site not found.');
    expect(store.getState().sites.renamingId).toBeNull();
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.updateSiteRequest.mockRejectedValue(new TypeError('fetch failed'));
    const store = makeStore();
    await store.dispatch(renameSite({ id: 's-1', displayName: 'X' }));
    expect(store.getState().sites.renameError).toBe('Could not update the site.');
  });
});

describe('removeSite', () => {
  it('resolves with the deleted id and message', async () => {
    mocked.deleteSiteRequest.mockResolvedValue({ message: 'Site removed.' });
    const store = makeStore();
    const result = await store.dispatch(removeSite('s-1'));
    expect(removeSite.fulfilled.match(result)).toBe(true);
    expect(mocked.deleteSiteRequest).toHaveBeenCalledWith('s-1');
    expect(store.getState().sites.message).toBe('Site removed.');
  });

  it('rejects with the server message', async () => {
    mocked.deleteSiteRequest.mockRejectedValue(serverError('Site not found.', 404));
    const store = makeStore();
    await store.dispatch(removeSite('s-1'));
    expect(store.getState().sites.deleteError).toBe('Site not found.');
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.deleteSiteRequest.mockRejectedValue(new TypeError('fetch failed'));
    const store = makeStore();
    await store.dispatch(removeSite('s-1'));
    expect(store.getState().sites.deleteError).toBe('Could not delete the site.');
  });
});

describe('pauseSite', () => {
  it('resolves with the paused site and patches the row', async () => {
    const paused = { ...site, paused: true, pausedAt: '2026-08-01T00:00:00.000Z' };
    mocked.pauseSiteRequest.mockResolvedValue({ site: paused, message: 'Site paused.' });
    const store = makeStore();
    // seed the row so the fulfilled reducer can patch it
    store.dispatch({
      type: 'sites/load/fulfilled',
      payload: { sites: [site], nextCursor: null },
      meta: { arg: { direction: 'initial' } },
    });
    const result = await store.dispatch(pauseSite(site.id));
    expect(pauseSite.fulfilled.match(result)).toBe(true);
    expect(mocked.pauseSiteRequest).toHaveBeenCalledWith('s-1');
    expect(store.getState().sites.items[0]?.paused).toBe(true);
    expect(store.getState().sites.message).toBe('Site paused.');
    expect(store.getState().sites.pausingId).toBeNull();
  });

  it('rejects with the server-localized message', async () => {
    mocked.pauseSiteRequest.mockRejectedValue(serverError('Site not found.', 404));
    const store = makeStore();
    await store.dispatch(pauseSite('s-1'));
    expect(store.getState().sites.pauseError).toBe('Site not found.');
    expect(store.getState().sites.pausingId).toBeNull();
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.pauseSiteRequest.mockRejectedValue(new TypeError('fetch failed'));
    const store = makeStore();
    await store.dispatch(pauseSite('s-1'));
    expect(store.getState().sites.pauseError).toBe('Could not pause the site.');
  });
});

describe('resumeSite', () => {
  it('resolves with the resumed site and patches the row', async () => {
    const pausedSite = { ...site, paused: true, pausedAt: '2026-08-01T00:00:00.000Z' };
    mocked.resumeSiteRequest.mockResolvedValue({ site, message: 'Site resumed.' });
    const store = makeStore();
    store.dispatch({
      type: 'sites/load/fulfilled',
      payload: { sites: [pausedSite], nextCursor: null },
      meta: { arg: { direction: 'initial' } },
    });
    const result = await store.dispatch(resumeSite(site.id));
    expect(resumeSite.fulfilled.match(result)).toBe(true);
    expect(mocked.resumeSiteRequest).toHaveBeenCalledWith('s-1');
    expect(store.getState().sites.items[0]?.paused).toBe(false);
    expect(store.getState().sites.message).toBe('Site resumed.');
    expect(store.getState().sites.pausingId).toBeNull();
  });

  it('rejects with the server-localized message', async () => {
    mocked.resumeSiteRequest.mockRejectedValue(serverError('Site not found.', 404));
    const store = makeStore();
    await store.dispatch(resumeSite('s-1'));
    expect(store.getState().sites.pauseError).toBe('Site not found.');
    expect(store.getState().sites.pausingId).toBeNull();
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.resumeSiteRequest.mockRejectedValue(new TypeError('fetch failed'));
    const store = makeStore();
    await store.dispatch(resumeSite('s-1'));
    expect(store.getState().sites.pauseError).toBe('Could not resume the site.');
  });
});
