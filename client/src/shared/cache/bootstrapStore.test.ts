import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeStore, resetAccountState } from '@app/store';
import { loadSites, addSite } from '@features/sites';
import { loadWorkspaces, setActiveWorkspace, workspaceInitialState } from '@features/workspace';
import { loadPendingInvitations, INBOX_MAX_AGE_MS } from '@features/team/store/inboxSlice';
import * as sitesApi from '@features/sites/api';
import * as teamApi from '@features/team/api';
import { initI18n } from '@shared/i18n';

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(sitesApi, 'fetchSitesRequest'); vi.spyOn(sitesApi, 'createSiteRequest').mockResolvedValue({ site: {} as never, message: 'Created' }); vi.spyOn(teamApi, 'fetchWorkspacesRequest'); initI18n({ initialLocale: 'en' }); });

describe('bootstrap store freshness and context', () => {
  it('caches the sites first page, forces refresh, and preserves cursor navigation', async () => {
    vi.mocked(sitesApi.fetchSitesRequest).mockResolvedValue({ sites: [], nextCursor: 'next' });
    const store = makeStore();
    await store.dispatch(loadSites({})); await store.dispatch(loadSites({}));
    expect(sitesApi.fetchSitesRequest).toHaveBeenCalledTimes(1);
    expect(store.getState().sites.loadedAt).toEqual(expect.any(Number));
    await store.dispatch(loadSites({ force: true }));
    await store.dispatch(loadSites({ cursor: 'next', direction: 'next' }));
    await store.dispatch(loadSites({ cursor: null, direction: 'prev' }));
    expect(sitesApi.fetchSitesRequest).toHaveBeenCalledTimes(4);
    await store.dispatch(addSite('https://example.test'));
    expect(store.getState().sites.loadedAt).toBeNull();
    await store.dispatch(loadSites({}));
    expect(sitesApi.fetchSitesRequest).toHaveBeenCalledTimes(5);
  });
  it('does not start a second sites fetch while a forced refresh is pending', async () => {
    const gate = deferred<{ sites: []; nextCursor: null }>(); vi.mocked(sitesApi.fetchSitesRequest).mockReturnValue(gate.promise);
    const store = makeStore(); const first = store.dispatch(loadSites({}));
    const second = store.dispatch(loadSites({ force: true })); const count = vi.mocked(sitesApi.fetchSitesRequest).mock.calls.length;
    gate.resolve({ sites: [], nextCursor: null }); await Promise.all([first, second]); expect(count).toBe(1);
  });
  it('stores workspace freshness and allows an explicit forced refresh', async () => {
    vi.mocked(teamApi.fetchWorkspacesRequest).mockResolvedValue({ workspaces: [] }); const store = makeStore();
    await store.dispatch(loadWorkspaces()); await store.dispatch(loadWorkspaces()); expect(teamApi.fetchWorkspacesRequest).toHaveBeenCalledTimes(1);
    expect(store.getState().workspace.loadedAt).toEqual(expect.any(Number));
    await store.dispatch(loadWorkspaces({ force: true })); expect(teamApi.fetchWorkspacesRequest).toHaveBeenCalledTimes(2);
  });
  for (const action of [resetAccountState(), setActiveWorkspace(null)]) {
    it(`discards late fulfilled bootstrap state after ${action.type}`, async () => {
      const gate = deferred<{ sites: []; nextCursor: null }>(); vi.mocked(sitesApi.fetchSitesRequest).mockReturnValue(gate.promise);
      const store = makeStore(); const first = store.dispatch(loadSites({})); store.dispatch(action);
      gate.resolve({ sites: [], nextCursor: null }); await first;
      expect(store.getState().sites.loaded).toBe(false); expect(store.getState().sites.loadedAt).toBeNull();
    });
  }
  it('uses a one-minute passive invitation lifetime without changing explicit refresh defaults', () => {
    expect(INBOX_MAX_AGE_MS).toBe(60000); expect(loadPendingInvitations.typePrefix).toBe('teamInbox/load');
  });
});

 it('invalidates workspace freshness after either invitation acceptance flow', async () => {
   vi.mocked(teamApi.fetchWorkspacesRequest).mockResolvedValue({ workspaces: [] }); const store = makeStore();
   for (const type of ['teamInbox/accept/fulfilled', 'team/accept/fulfilled']) {
     await store.dispatch(loadWorkspaces({ force: true }));
     store.dispatch({ type, payload: { id: 'invite', message: 'Accepted' } });
     expect(store.getState().workspace.loadedAt).toBeNull();
   }
 });

 it('keeps a shared sites request alive when one thunk caller aborts and a replacement subscribes', async () => {
   const gate = deferred<{ sites: []; nextCursor: null }>(); vi.mocked(sitesApi.fetchSitesRequest).mockReturnValue(gate.promise);
   const store = makeStore(); const first = store.dispatch(loadSites({})); first.abort(); await first;
   const replacement = store.dispatch(loadSites({})); const count = vi.mocked(sitesApi.fetchSitesRequest).mock.calls.length;
   gate.resolve({ sites: [], nextCursor: null }); await replacement;
   expect(count).toBe(1); expect(store.getState().sites.loaded).toBe(true);
 });

 it('keeps a new account answer when an older aborted caller settles late', async () => {
   const old = deferred<{ sites: []; nextCursor: null }>(); const fresh = deferred<{ sites: []; nextCursor: null }>();
   vi.mocked(sitesApi.fetchSitesRequest).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
   const store = makeStore(); const first = store.dispatch(loadSites({})); store.dispatch(resetAccountState());
   const second = store.dispatch(loadSites({})); fresh.resolve({ sites: [], nextCursor: null }); await second;
   const snapshot = store.getState().sites; first.abort(); await first; old.resolve({ sites: [], nextCursor: null });
   await Promise.resolve(); expect(store.getState().sites).toEqual(snapshot);
   expect(sitesApi.fetchSitesRequest).toHaveBeenCalledTimes(2);
 });

 it('discards a sites answer started before a site mutation and allows a fresh reload', async () => {
   const old = deferred<{ sites: []; nextCursor: null }>();
   vi.mocked(sitesApi.fetchSitesRequest).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ sites: [], nextCursor: null });
   const store = makeStore(); const first = store.dispatch(loadSites({})); await store.dispatch(addSite('https://example.test'));
   expect(store.getState().sites.loading).toBe(false);
   const second = store.dispatch(loadSites({})); await second;
   const snapshot = store.getState().sites; old.resolve({ sites: [], nextCursor: null }); await first;
   expect(store.getState().sites).toEqual(snapshot); expect(sitesApi.fetchSitesRequest).toHaveBeenCalledTimes(2);
 });

 for (const type of ['teamInbox/accept/fulfilled', 'teamInbox/reject/fulfilled', 'team/accept/fulfilled']) {
   it(`discards an invitation list started before ${type}`, async () => {
     const inbox = deferred<{ invitations: never[] }>(); const workspaces = deferred<{ workspaces: [] }>();
     vi.spyOn(teamApi, 'fetchPendingInvitationsRequest').mockReturnValue(inbox.promise);
     vi.mocked(teamApi.fetchWorkspacesRequest).mockReturnValue(workspaces.promise);
     const store = makeStore(); const first = store.dispatch(loadPendingInvitations()); const workspaceRead = store.dispatch(loadWorkspaces());
     store.dispatch({ type, payload: { id: 'invite', message: 'Saved' } });
     expect(store.getState().teamInbox.fetching).toBe(false);
     if (type !== 'teamInbox/reject/fulfilled') expect(store.getState().workspace.status).toBe('idle');
     inbox.resolve({ invitations: [{ id: 'invite' }] as never[] }); workspaces.resolve({ workspaces: [] });
     await Promise.all([first, workspaceRead]);
     expect(store.getState().teamInbox.invitations).toEqual([]);
     if (type !== 'teamInbox/reject/fulfilled') expect(store.getState().workspace.loadedAt).toBeNull();
   });
 }

for (const settlement of ['fulfilled', 'aborted']) {
  it(`allows a workspace refresh after a switch invalidates a ${settlement} request`, async () => {
    const old = deferred<{ workspaces: [] }>();
    const workspace = { accountId: 'other-account', label: 'Other workspace', role: 'member' as const, isOwn: false };
    const workspaces = [workspace];
    vi.mocked(teamApi.fetchWorkspacesRequest).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ workspaces });
    const store = makeStore({ workspace: { ...workspaceInitialState, workspaces, status: 'loaded', loadedAt: 42 } });
    const first = store.dispatch(loadWorkspaces({ force: true }));
    store.dispatch(setActiveWorkspace(workspace.accountId));
    if (settlement === 'aborted') first.abort();
    old.resolve({ workspaces: [] });
    await first;
    expect(store.getState().workspace).toMatchObject({
      activeWorkspaceId: workspace.accountId,
      workspaces,
      status: 'idle',
      loadedAt: null,
    });
    await store.dispatch(loadWorkspaces({ force: true }));
    expect(teamApi.fetchWorkspacesRequest).toHaveBeenCalledTimes(2);
    expect(store.getState().workspace.status).toBe('loaded');
  });
}
