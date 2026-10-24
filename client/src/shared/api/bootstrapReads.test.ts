import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, apiFetch, invalidateApiReadContext, setWorkspaceIdProvider, resolveAbsoluteApiUrl } from './client';
import { setPresentationLocale } from '@shared/i18n/presentationLocale';

const response = (locale = 'en'): Response => new Response(JSON.stringify({ value: locale }), { headers: { 'Content-Type': 'application/json', 'Content-Language': locale } });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => { setPresentationLocale('en'); setWorkspaceIdProvider(null); });
afterEach(() => { vi.restoreAllMocks(); setWorkspaceIdProvider(null); });

describe('bootstrap read locale isolation', () => {
  for (const path of ['/sites', '/sites?cursor=next', '/team/invitations', '/team/workspaces']) {
    it(`retries ${path} once with fresh presentation headers`, async () => {
      const gate = deferred<Response>();
      const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => gate.promise).mockResolvedValueOnce(response('de'));
      const read = apiClient(path);
      setPresentationLocale('de'); gate.resolve(response());
      await expect(read).resolves.toEqual({ value: 'de' });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('x-lang')).toBe('de');
    });
  }
  it('does not retry a second locale cancellation', async () => {
    const first = deferred<Response>(); const second = deferred<Response>();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const read = apiClient('/sites');
    setPresentationLocale('de'); first.resolve(response());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    setPresentationLocale('fr'); second.resolve(response('de'));
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  for (const options of [{ signal: new AbortController().signal }, { localeMode: 'artifact' as const }, { locale: 'en' as const }, { headers: { 'x-lang': 'en' } }]) {
    it(`does not replay an explicitly scoped or caller-cancelled read ${JSON.stringify(options)}`, async () => {
      const gate = deferred<Response>();
      const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => gate.promise);
      const abort = new AbortController();
      const read = apiClient('/sites', options.signal ? { signal: abort.signal } : options);
      setPresentationLocale('de'); if (options.signal) abort.abort(); gate.resolve(response());
      if (options.localeMode === 'artifact') await expect(read).resolves.toEqual({ value: 'en' });
      else await expect(read).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  }
  for (const path of ['/sites/id', '/team/invitations/preview/token', '/other', 'https://example.test/sites']) {
    it(`leaves non-bootstrap path ${path} under the presentation contract`, async () => {
      const gate = deferred<Response>(); const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => gate.promise);
      const read = apiClient(path); setPresentationLocale('de'); gate.resolve(response());
      await expect(read).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).toHaveBeenCalledTimes(1);
    });
  }
  it('does not replay raw transport or mutations', async () => {
    const gate = deferred<Response>(); const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => gate.promise);
    const read = apiFetch('/sites'); setPresentationLocale('de'); gate.resolve(response());
    await expect(read).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  for (const change of ['account', 'workspace']) {
    it(`rejects a late old ${change} answer and does not replay it`, async () => {
      let workspace = 'a'; setWorkspaceIdProvider(() => workspace);
      const gate = deferred<Response>(); const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => gate.promise);
      const read = apiClient('/sites');
      if (change === 'account') invalidateApiReadContext(); else workspace = 'b';
      setPresentationLocale('de'); gate.resolve(response());
      await expect(read).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).toHaveBeenCalledTimes(1);
    });
  }
  it('checks the context again after the response body settles', async () => {
    const body = deferred<unknown>();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ...response(), ok: true, headers: new Headers({ 'Content-Type': 'application/json', 'Content-Language': 'en' }), json: () => body.promise } as Response);
    const read = apiClient('/sites'); await Promise.resolve(); await Promise.resolve();
    invalidateApiReadContext(); body.resolve({ value: 'old' });
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
  });
});

 it('refuses an already cancelled bootstrap caller before fetching', async () => {
   const abort = new AbortController(); abort.abort(); const fetch = vi.spyOn(globalThis, 'fetch');
   await expect(apiClient('/sites', { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
   expect(fetch).not.toHaveBeenCalled();
 });
 it('does not retry a caller abort without a locale transition', async () => {
   const abort = new AbortController();
   const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { abort.abort(); throw new DOMException('cancelled', 'AbortError'); });
   await expect(apiClient('/sites', { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
   expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('resolves absolute API URLs when the browser location is unavailable', () => {
   vi.stubGlobal('location', undefined);
   expect(resolveAbsoluteApiUrl('/sites')).toBe('http://localhost/api/sites');
   vi.unstubAllGlobals();
 });

 it('retries a real fetch cancellation caused by locale change, without aborting the caller', async () => {
   const caller = new AbortController();
   const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_url, init) => new Promise<Response>((_resolve, reject) => {
     init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
   })).mockResolvedValueOnce(response('de'));
   const read = apiClient('/sites', { signal: caller.signal }); setPresentationLocale('de');
   await expect(read).resolves.toEqual({ value: 'de' });
   expect(caller.signal.aborted).toBe(false); expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('never replays a mutation on a bootstrap pathname', async () => {
   const gate = deferred<Response>(); const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => gate.promise);
   const mutation = apiClient('/sites', { method: 'POST', body: { url: 'https://example.test' }, csrf: false });
   setPresentationLocale('de'); gate.resolve(response());
   await expect(mutation).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).toHaveBeenCalledTimes(1);
 });

 it('does not replay a locale-cancelled bootstrap read across a successful mutation', async () => {
   const gate = deferred<Response>();
   const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => gate.promise).mockResolvedValueOnce(response('de'));
   const read = apiClient('/sites'); setPresentationLocale('de');
   await apiClient('/sites/id', { method: 'PATCH', body: { displayName: 'New' }, csrf: false });
   gate.resolve(response());
   await expect(read).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).toHaveBeenCalledTimes(2);
 });
