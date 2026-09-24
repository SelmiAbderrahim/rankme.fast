import { describe, expect, it } from 'vitest';
import { clearSiteMessages, sitesReducer } from './slice';
import { addSite, loadSites, pauseSite, removeSite, renameSite, resumeSite } from './thunks';
import {
  selectAddSiteError,
  selectAddingSite,
  selectCursorStack,
  selectDeleteSiteError,
  selectDeletingSiteId,
  selectNextCursor,
  selectPauseSiteError,
  selectPausingSiteId,
  selectRenameSiteError,
  selectRenamingSiteId,
  selectSites,
  selectSitesError,
  selectSitesLoaded,
  selectSitesLoading,
  selectSitesMessage,
} from './selectors';
import type { RootState } from '@app/store';
import type { Site, SitesState } from '../types';

const site = (id: string, domain = `${id}.example.com`): Site => ({
  id,
  url: `https://${domain}`,
  domain,
  displayName: '',
  paused: false,
  pausedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
});

const initial = (): SitesState => sitesReducer(undefined, { type: '@@init' });

describe('sites slice — loadSites', () => {
  it('pending sets loading and clears the error', () => {
    const state = sitesReducer(
      { ...initial(), error: 'old' },
      loadSites.pending('r1', { direction: 'initial' }),
    );
    expect(state.loading).toBe(true);
    expect(state.error).toBe('');
  });

  it('initial fulfilled replaces items and resets the cursor stack', () => {
    const seeded: SitesState = {
      ...initial(),
      cursorStack: [null, 'c1'],
      currentCursor: 'c1',
    };
    const state = sitesReducer(
      seeded,
      loadSites.fulfilled({ sites: [site('a')], nextCursor: 'c2' }, 'r1', {
        direction: 'initial',
      }),
    );
    expect(state.items).toHaveLength(1);
    expect(state.nextCursor).toBe('c2');
    expect(state.cursorStack).toEqual([]);
    expect(state.currentCursor).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.loaded).toBe(true);
  });

  it('a missing direction behaves like initial', () => {
    const state = sitesReducer(
      { ...initial(), cursorStack: [null] },
      loadSites.fulfilled({ sites: [], nextCursor: null }, 'r1', {}),
    );
    expect(state.cursorStack).toEqual([]);
    expect(state.currentCursor).toBeNull();
  });

  it('next pushes the current cursor onto the stack', () => {
    const state = sitesReducer(
      initial(),
      loadSites.fulfilled({ sites: [site('b')], nextCursor: 'c3' }, 'r1', {
        cursor: 'c2',
        direction: 'next',
      }),
    );
    expect(state.cursorStack).toEqual([null]);
    expect(state.currentCursor).toBe('c2');
  });

  it('prev pops the stack back to the prior page', () => {
    const seeded: SitesState = {
      ...initial(),
      cursorStack: [null],
      currentCursor: 'c2',
    };
    const state = sitesReducer(
      seeded,
      loadSites.fulfilled({ sites: [site('a')], nextCursor: 'c2' }, 'r1', {
        cursor: null,
        direction: 'prev',
      }),
    );
    expect(state.cursorStack).toEqual([]);
    expect(state.currentCursor).toBeNull();
  });

  it('rejected stores the payload message', () => {
    const state = sitesReducer(
      initial(),
      loadSites.rejected(null, 'r1', { direction: 'initial' }, 'load failed'),
    );
    expect(state.loading).toBe(false);
    expect(state.error).toBe('load failed');
  });

  it('rejected without payload stores an empty error', () => {
    const action = {
      type: loadSites.rejected.type,
      meta: { arg: { direction: 'initial' } },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = sitesReducer(initial(), action as never);
    expect(state.error).toBe('');
  });
});

describe('sites slice — addSite', () => {
  it('pending sets adding and clears prior messages', () => {
    const seeded: SitesState = { ...initial(), addError: 'old', message: 'old' };
    const state = sitesReducer(seeded, addSite.pending('r1', 'https://example.com'));
    expect(state.adding).toBe(true);
    expect(state.addError).toBe('');
    expect(state.message).toBe('');
  });

  it('fulfilled records the success message', () => {
    const state = sitesReducer(
      initial(),
      addSite.fulfilled({ site: site('a'), message: 'Site added.' }, 'r1', 'https://a.example.com'),
    );
    expect(state.adding).toBe(false);
    expect(state.message).toBe('Site added.');
  });

  it('rejected records the error', () => {
    const state = sitesReducer(
      initial(),
      addSite.rejected(null, 'r1', 'https://a.example.com', 'duplicate'),
    );
    expect(state.adding).toBe(false);
    expect(state.addError).toBe('duplicate');
  });

  it('rejected without payload stores an empty error', () => {
    const action = {
      type: addSite.rejected.type,
      meta: { arg: 'https://a.example.com' },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = sitesReducer(initial(), action as never);
    expect(state.addError).toBe('');
  });
});

describe('sites slice — removeSite', () => {
  it('pending marks the deleting id', () => {
    const state = sitesReducer(initial(), removeSite.pending('r1', 's-1'));
    expect(state.deletingId).toBe('s-1');
    expect(state.deleteError).toBe('');
  });

  it('fulfilled clears the deleting id and records the message', () => {
    const seeded: SitesState = { ...initial(), deletingId: 's-1' };
    const state = sitesReducer(
      seeded,
      removeSite.fulfilled({ id: 's-1', message: 'Site removed.' }, 'r1', 's-1'),
    );
    expect(state.deletingId).toBeNull();
    expect(state.message).toBe('Site removed.');
  });

  it('rejected records the error', () => {
    const state = sitesReducer(initial(), removeSite.rejected(null, 'r1', 's-1', 'nope'));
    expect(state.deletingId).toBeNull();
    expect(state.deleteError).toBe('nope');
  });

  it('rejected without payload stores an empty error', () => {
    const action = {
      type: removeSite.rejected.type,
      meta: { arg: 's-1' },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = sitesReducer(initial(), action as never);
    expect(state.deleteError).toBe('');
  });
});

describe('sites slice — renameSite', () => {
  it('pending marks the renaming id', () => {
    const state = sitesReducer(
      { ...initial(), renameError: 'old', message: 'old' },
      renameSite.pending('r1', { id: 's-1', displayName: 'X' }),
    );
    expect(state.renamingId).toBe('s-1');
    expect(state.renameError).toBe('');
    expect(state.message).toBe('');
  });

  it('fulfilled patches the matching row and clears renamingId', () => {
    const seeded: SitesState = {
      ...initial(),
      items: [site('a')],
      renamingId: 'a',
    };
    const renamed: Site = { ...site('a'), displayName: 'New' };
    const state = sitesReducer(
      seeded,
      renameSite.fulfilled(
        { site: renamed, message: 'Site updated.' },
        'r1',
        { id: 'a', displayName: 'New' },
      ),
    );
    expect(state.renamingId).toBeNull();
    expect(state.items[0]?.displayName).toBe('New');
    expect(state.message).toBe('Site updated.');
  });

  it('fulfilled leaves items alone when the id is not present', () => {
    const seeded: SitesState = { ...initial(), items: [site('a')] };
    const renamed: Site = { ...site('z'), displayName: 'Z' };
    const state = sitesReducer(
      seeded,
      renameSite.fulfilled(
        { site: renamed, message: 'Site updated.' },
        'r1',
        { id: 'z', displayName: 'Z' },
      ),
    );
    expect(state.items).toEqual([site('a')]);
  });

  it('rejected records the error and clears renamingId', () => {
    const state = sitesReducer(
      { ...initial(), renamingId: 's-1' },
      renameSite.rejected(null, 'r1', { id: 's-1', displayName: 'X' }, 'nope'),
    );
    expect(state.renamingId).toBeNull();
    expect(state.renameError).toBe('nope');
  });

  it('rejected without payload stores an empty error', () => {
    const action = {
      type: renameSite.rejected.type,
      meta: { arg: { id: 's-1', displayName: 'X' } },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = sitesReducer(initial(), action as never);
    expect(state.renameError).toBe('');
  });
});

describe('sites slice — pauseSite', () => {
  it('pending marks the pausing id and clears prior messages', () => {
    const state = sitesReducer(
      { ...initial(), pauseError: 'old', message: 'old' },
      pauseSite.pending('r1', 's-1'),
    );
    expect(state.pausingId).toBe('s-1');
    expect(state.pauseError).toBe('');
    expect(state.message).toBe('');
  });

  it('fulfilled patches the matching row in place and clears pausingId', () => {
    const seeded: SitesState = {
      ...initial(),
      items: [site('a'), site('b')],
      pausingId: 'a',
    };
    const paused: Site = { ...site('a'), paused: true, pausedAt: '2026-08-01T00:00:00.000Z' };
    const state = sitesReducer(
      seeded,
      pauseSite.fulfilled({ site: paused, message: 'Site paused.' }, 'r1', 'a'),
    );
    expect(state.pausingId).toBeNull();
    expect(state.items[0]).toEqual(paused);
    expect(state.items[1]).toEqual(site('b'));
    expect(state.message).toBe('Site paused.');
  });

  it('fulfilled leaves items alone when the id is not present', () => {
    const seeded: SitesState = { ...initial(), items: [site('a')] };
    const paused: Site = { ...site('z'), paused: true, pausedAt: '2026-08-01T00:00:00.000Z' };
    const state = sitesReducer(
      seeded,
      pauseSite.fulfilled({ site: paused, message: 'Site paused.' }, 'r1', 'z'),
    );
    expect(state.items).toEqual([site('a')]);
    expect(state.pausingId).toBeNull();
  });

  it('rejected records the error and clears pausingId', () => {
    const state = sitesReducer(
      { ...initial(), pausingId: 's-1' },
      pauseSite.rejected(null, 'r1', 's-1', 'nope'),
    );
    expect(state.pausingId).toBeNull();
    expect(state.pauseError).toBe('nope');
  });

  it('rejected without payload stores an empty error', () => {
    const action = {
      type: pauseSite.rejected.type,
      meta: { arg: 's-1' },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = sitesReducer(initial(), action as never);
    expect(state.pauseError).toBe('');
  });
});

describe('sites slice — resumeSite', () => {
  it('pending marks the pausing id and clears prior messages', () => {
    const state = sitesReducer(
      { ...initial(), pauseError: 'old', message: 'old' },
      resumeSite.pending('r1', 's-1'),
    );
    expect(state.pausingId).toBe('s-1');
    expect(state.pauseError).toBe('');
    expect(state.message).toBe('');
  });

  it('fulfilled patches the matching row in place and clears pausingId', () => {
    const pausedRow: Site = { ...site('a'), paused: true, pausedAt: '2026-08-01T00:00:00.000Z' };
    const seeded: SitesState = {
      ...initial(),
      items: [pausedRow, site('b')],
      pausingId: 'a',
    };
    const state = sitesReducer(
      seeded,
      resumeSite.fulfilled({ site: site('a'), message: 'Site resumed.' }, 'r1', 'a'),
    );
    expect(state.pausingId).toBeNull();
    expect(state.items[0]).toEqual(site('a'));
    expect(state.items[1]).toEqual(site('b'));
    expect(state.message).toBe('Site resumed.');
  });

  it('fulfilled leaves items alone when the id is not present', () => {
    const seeded: SitesState = { ...initial(), items: [site('a')] };
    const state = sitesReducer(
      seeded,
      resumeSite.fulfilled({ site: site('z'), message: 'Site resumed.' }, 'r1', 'z'),
    );
    expect(state.items).toEqual([site('a')]);
    expect(state.pausingId).toBeNull();
  });

  it('rejected records the error and clears pausingId', () => {
    const state = sitesReducer(
      { ...initial(), pausingId: 's-1' },
      resumeSite.rejected(null, 'r1', 's-1', 'nope'),
    );
    expect(state.pausingId).toBeNull();
    expect(state.pauseError).toBe('nope');
  });

  it('rejected without payload stores an empty error', () => {
    const action = {
      type: resumeSite.rejected.type,
      meta: { arg: 's-1' },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = sitesReducer(initial(), action as never);
    expect(state.pauseError).toBe('');
  });
});

describe('sites selectors', () => {
  it('each selector reads its slice field', () => {
    const sites: SitesState = {
      ...initial(),
      items: [site('a')],
      nextCursor: 'c2',
      cursorStack: [null],
      loading: true,
      loaded: true,
      error: 'e',
      adding: true,
      addError: 'ae',
      deletingId: 's-1',
      deleteError: 'de',
      renamingId: 's-1',
      renameError: 're',
      pausingId: 's-2',
      pauseError: 'pe',
      message: 'm',
    };
    const state = { sites } as RootState;
    expect(selectSites(state)).toEqual(sites.items);
    expect(selectNextCursor(state)).toBe('c2');
    expect(selectCursorStack(state)).toEqual([null]);
    expect(selectSitesLoading(state)).toBe(true);
    expect(selectSitesLoaded(state)).toBe(true);
    expect(selectSitesError(state)).toBe('e');
    expect(selectAddingSite(state)).toBe(true);
    expect(selectAddSiteError(state)).toBe('ae');
    expect(selectDeletingSiteId(state)).toBe('s-1');
    expect(selectDeleteSiteError(state)).toBe('de');
    expect(selectRenamingSiteId(state)).toBe('s-1');
    expect(selectRenameSiteError(state)).toBe('re');
    expect(selectPausingSiteId(state)).toBe('s-2');
    expect(selectPauseSiteError(state)).toBe('pe');
    expect(selectSitesMessage(state)).toBe('m');
  });
});

describe('sites slice — clearSiteMessages', () => {
  it('resets every transient message', () => {
    const seeded: SitesState = {
      ...initial(),
      error: 'a',
      addError: 'b',
      deleteError: 'c',
      renameError: 'r',
      pauseError: 'p',
      message: 'd',
    };
    const state = sitesReducer(seeded, clearSiteMessages());
    expect(state.error).toBe('');
    expect(state.addError).toBe('');
    expect(state.deleteError).toBe('');
    expect(state.renameError).toBe('');
    expect(state.pauseError).toBe('');
    expect(state.message).toBe('');
  });
});
