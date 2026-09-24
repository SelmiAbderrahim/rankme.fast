import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { toast } from 'sonner';
import {
  apiClient,
  apiFetch,
  ApiError,
  ResponseLanguageMismatchError,
  fetchCsrfToken,
  apiContextHeaders,
  activeRequestLocale,
  captureRequestLocale,
  isCurrentRequestLocale,
  setWorkspaceIdProvider,
  resolveAbsoluteApiUrl,
  resolveApiUrl,
  __resetCsrfTokenCacheForTests,
} from './client';
import {
  initI18n,
  changeLanguage,
  setPresentationLocale,
  subscribePresentationRefresh,
  SUPPORTED_LOCALES,
} from '@shared/i18n';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  setPresentationLocale('en');
  setWorkspaceIdProvider(null);
  __resetCsrfTokenCacheForTests();
});

interface FakeResponseInit {
  ok?: boolean;
  status?: number;
  contentType?: string | null;
  contentLanguage?: string | null;
  json?: unknown;
  jsonError?: Error;
  text?: string;
  textError?: Error;
}

const fakeResponse = (init: FakeResponseInit): Response =>
  ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-language'
          ? (init.contentLanguage ?? null)
          : (init.contentType ?? null),
    },
    json: async () => {
      if (init.jsonError) throw init.jsonError;
      return init.json;
    },
    text: async () => {
      if (init.textError) throw init.textError;
      return init.text ?? '';
    },
  }) as unknown as Response;

const fetchSpy = () => vi.spyOn(globalThis, 'fetch');

const requestPath = (input: unknown): string => {
  const url = String(input);
  return url.startsWith('http') ? new URL(url).pathname : url;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  setWorkspaceIdProvider(null);
});

describe('apiClient', () => {
  it('resolves relative API paths and preserves absolute URLs', () => {
    expect(resolveApiUrl('/thing')).toBe('/api/thing');
    expect(resolveApiUrl('https://api.example.test/thing')).toBe(
      'https://api.example.test/thing',
    );
    expect(resolveAbsoluteApiUrl('/thing', { origin: 'https://rankme.example' })).toBe(
      'https://rankme.example/api/thing',
    );
  });

  it('resolves parsed JSON for a 2xx response and resolves the base URL', async () => {
    const spy = fetchSpy().mockResolvedValue(
      fakeResponse({ contentType: 'application/json', json: { hello: 'world' } }),
    );
    const result = await apiClient<{ hello: string }>('/thing');
    expect(result).toEqual({ hello: 'world' });
    expect(requestPath(spy.mock.calls[0]![0])).toBe('/api/thing');
    expect(spy.mock.calls[0]![1]).toEqual(expect.any(Object));
  });

  it('always ships credentials so the session cookie flows', async () => {
    const spy = fetchSpy().mockResolvedValue(fakeResponse({ text: 'ok' }));
    await apiClient('/secure');
    expect(spy.mock.calls[0]![1]?.credentials).toBe('include');
  });

  it('attaches every supported active locale to REST and raw context requests', async () => {
    const spy = fetchSpy().mockResolvedValue(fakeResponse({ text: 'ok' }));
    for (const locale of SUPPORTED_LOCALES) {
      await changeLanguage(locale);
      await apiClient(`/locale-${locale}`);
      const headers = spy.mock.calls.at(-1)?.[1]?.headers as Headers;
      expect(headers.get('x-lang')).toBe(locale);
      expect(apiContextHeaders(`/raw-${locale}`).get('x-lang')).toBe(locale);
      expect(activeRequestLocale()).toBe(locale);
    }
  });

  it('keeps an explicit per-call language override', async () => {
    const spy = fetchSpy().mockResolvedValue(fakeResponse({ text: 'ok' }));
    await changeLanguage('ar');
    await apiClient('/explicit-locale', { locale: 'fr' });
    expect((spy.mock.calls[0]![1]?.headers as Headers).get('x-lang')).toBe('fr');
    expect(isCurrentRequestLocale(captureRequestLocale({ locale: 'fr' }))).toBe(true);
  });

  it('keeps language preferences actor-scoped while retaining workspace context elsewhere', () => {
    setWorkspaceIdProvider(() => 'workspace-owner');
    const preference = apiContextHeaders('/users/preferences/language');
    expect(preference.get('x-lang')).toBe('en');
    expect(preference.has('x-workspace-id')).toBe(false);
    expect(apiContextHeaders('/sites').get('x-workspace-id')).toBe('workspace-owner');
    expect(
      apiContextHeaders('https://rankme.example/api/report-shares/token').has(
        'x-workspace-id',
      ),
    ).toBe(false);
    expect(apiContextHeaders('/sites', { workspace: 'omit' }).has('x-workspace-id')).toBe(
      false,
    );
    expect(apiContextHeaders('http://%', {}).get('x-workspace-id')).toBe('workspace-owner');
  });

  it('applies the raw-fetch defaults, explicit header locale, generation, and none mode', async () => {
    const generation = captureRequestLocale().generation ?? 0;
    const spy = fetchSpy()
      .mockResolvedValueOnce(fakeResponse({ contentLanguage: 'en', text: 'default' }))
      .mockResolvedValueOnce(fakeResponse({ contentLanguage: 'ar', text: 'header' }))
      .mockResolvedValueOnce(fakeResponse({ contentLanguage: 'ar', text: 'header-generation' }))
      .mockResolvedValueOnce(fakeResponse({ contentLanguage: 'de', text: 'explicit' }))
      .mockResolvedValueOnce(fakeResponse({ text: 'neutral' }));

    await apiFetch('/raw-default');
    await apiFetch('/raw-header', {
      headers: { 'x-lang': 'ar' },
      localeMode: 'presentation',
    });
    await apiFetch('/raw-header-generation', {
      headers: { 'x-lang': 'ar' },
      presentationGeneration: generation,
    });
    await apiFetch('/raw-explicit', {
      locale: 'de',
      workspace: 'omit',
      allowLegacyNullContentLanguage: false,
    });
    await apiFetch('https://example.test/pixel', { localeMode: 'none' });

    expect((spy.mock.calls[0]![1]?.headers as Headers).get('x-lang')).toBe('en');
    expect((spy.mock.calls[1]![1]?.headers as Headers).get('x-lang')).toBe('ar');
    expect((spy.mock.calls[2]![1]?.headers as Headers).get('x-lang')).toBe('ar');
    expect((spy.mock.calls[3]![1]?.headers as Headers).get('x-lang')).toBe('de');
    expect((spy.mock.calls[4]![1]?.headers as Headers).has('x-lang')).toBe(false);
  });

  it('honors a supported x-lang header when apiClient has no explicit locale option', async () => {
    const spy = fetchSpy().mockResolvedValue(
      fakeResponse({ contentLanguage: 'fr', text: 'bonjour' }),
    );

    await expect(
      apiClient('/header-locale', {
        headers: { 'x-lang': 'fr' },
        allowLegacyNullContentLanguage: false,
      }),
    ).resolves.toBe('bonjour');
    expect((spy.mock.calls[0]![1]?.headers as Headers).get('x-lang')).toBe('fr');
  });

  it('supports presentation, artifact, and locale-neutral request modes', async () => {
    const spy = fetchSpy()
      .mockResolvedValueOnce(fakeResponse({ contentLanguage: 'en', text: 'presented' }))
      .mockResolvedValueOnce(fakeResponse({ contentLanguage: 'ar', text: 'pinned' }))
      .mockResolvedValueOnce(fakeResponse({ text: 'neutral' }));

    await apiClient('/presentation', { allowLegacyNullContentLanguage: false });
    await apiClient('/artifact', {
      localeMode: 'artifact',
      allowLegacyNullContentLanguage: false,
    });
    await apiClient('https://example.test/pixel', { localeMode: 'none' });

    expect((spy.mock.calls[0]![1]?.headers as Headers).get('x-lang')).toBe('en');
    expect((spy.mock.calls[1]![1]?.headers as Headers).get('x-lang')).toBe('en');
    expect((spy.mock.calls[2]![1]?.headers as Headers).has('x-lang')).toBe(false);
  });

  it('rejects a missing, unsupported, or mismatched presentation response language', async () => {
    fetchSpy()
      .mockResolvedValueOnce(fakeResponse({ text: 'missing' }))
      .mockResolvedValueOnce(fakeResponse({ contentLanguage: 'xx', text: 'bad' }))
      .mockResolvedValueOnce(fakeResponse({ contentLanguage: 'ar', text: 'stale' }));

    for (const path of ['/missing-language', '/unsupported-language', '/mismatch']) {
      await expect(
        apiClient(path, { allowLegacyNullContentLanguage: false }),
      ).rejects.toBeInstanceOf(ResponseLanguageMismatchError);
    }
  });

  it('allows a missing language only for an explicitly catalogued legacy artifact', async () => {
    fetchSpy().mockResolvedValue(fakeResponse({ text: 'legacy-bytes' }));
    await expect(
      apiClient('/legacy-artifact', {
        localeMode: 'artifact',
        allowLegacyNullContentLanguage: true,
      }),
    ).resolves.toBe('legacy-bytes');
  });

  it('requires artifact access errors to use the request locale', async () => {
    fetchSpy()
      .mockResolvedValueOnce(
        fakeResponse({
          ok: false,
          status: 404,
          contentLanguage: 'ar',
          contentType: 'application/json',
          json: { code: 'NOT_FOUND' },
        }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          ok: false,
          status: 404,
          contentLanguage: 'en',
          contentType: 'application/json',
          json: { code: 'NOT_FOUND' },
        }),
      );

    await expect(
      apiClient('/artifact-error-mismatch', {
        localeMode: 'artifact',
        allowLegacyNullContentLanguage: false,
      }),
    ).rejects.toBeInstanceOf(ResponseLanguageMismatchError);
    await expect(
      apiClient('/artifact-error-current', {
        localeMode: 'artifact',
        allowLegacyNullContentLanguage: false,
      }),
    ).rejects.toMatchObject({ status: 404, contentLanguage: 'en' });
  });

  it('aborts an old-generation presentation read without replacing the caller signal', async () => {
    const caller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    fetchSpy().mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          observedSignal = init?.signal ?? undefined;
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const pending = apiClient('/slow-read', { signal: caller.signal });
    await changeLanguage('ar');

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(observedSignal).toBeDefined();
    expect(observedSignal).not.toBe(caller.signal);
    expect(caller.signal.aborted).toBe(false);
  });

  it('rejects a presentation request captured before fetch begins', async () => {
    const old = captureRequestLocale();
    await changeLanguage('ar');
    const spy = fetchSpy();

    await expect(
      apiClient('/already-stale', {
        locale: old.locale ?? 'en',
        presentationGeneration: old.generation ?? 0,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects an old presentation read even when fetch ignores its abort signal', async () => {
    let resolveRead!: (response: Response) => void;
    const refreshes: string[] = [];
    const unsubscribe = subscribePresentationRefresh((signal) => {
      refreshes.push(signal.reason);
    });
    const spy = fetchSpy().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRead = resolve;
        }),
    );

    const pending = apiClient('/abort-ignoring-read');
    await changeLanguage('ar');
    resolveRead(fakeResponse({ contentLanguage: 'en', text: 'old copy' }));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(refreshes).toEqual(['language-changed']);
    unsubscribe();
  });

  it('does not abort or replay a mutation and requests only a free refresh when it lands stale', async () => {
    let resolveMutation!: (response: Response) => void;
    let mutationSignal: AbortSignal | undefined;
    const refreshes: string[] = [];
    const unsubscribe = subscribePresentationRefresh((signal) => {
      refreshes.push(signal.reason);
    });
    const spy = fetchSpy().mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        mutationSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          resolveMutation = resolve;
        });
      },
    );

    const pending = apiClient('/stored-mutation', {
      method: 'POST',
      csrf: false,
      body: { stable: true },
    });
    await changeLanguage('ar');
    expect(mutationSignal?.aborted).toBe(false);
    resolveMutation(fakeResponse({ contentLanguage: 'en', text: 'old copy' }));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(refreshes).toEqual(['language-changed', 'stale-mutation']);
    unsubscribe();
  });

  it('keeps an accepted artifact stream alive across a locale switch', async () => {
    const streamController = new AbortController();
    let responseSignal: AbortSignal | undefined;
    fetchSpy().mockImplementation(async (_input, init) => {
      responseSignal = init?.signal ?? undefined;
      return fakeResponse({ contentLanguage: 'en', text: 'stream-open' });
    });

    const response = await apiFetch('/chat/conversations/c1/messages', {
      method: 'POST',
      localeMode: 'artifact',
      timeoutMs: null,
      signal: streamController.signal,
    });
    await changeLanguage('ar');

    expect(await response.text()).toBe('stream-open');
    expect(responseSignal?.aborted).toBe(false);
  });

  it('does not abort or replay an artifact download already in progress', async () => {
    let resolveDownload!: (response: Response) => void;
    let downloadSignal: AbortSignal | undefined;
    const spy = fetchSpy().mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        downloadSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          resolveDownload = resolve;
        });
      },
    );

    const pending = apiFetch('/report-exports/snapshot/download', {
      localeMode: 'artifact',
      timeoutMs: null,
    });
    await changeLanguage('ar');
    expect(downloadSignal).toBeUndefined();
    resolveDownload(fakeResponse({ contentLanguage: 'en', text: 'immutable bytes' }));

    await expect(pending.then((response) => response.text())).resolves.toBe(
      'immutable bytes',
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('only accepts the final response during rapid en to ar to fr switching', async () => {
    const aborted: string[] = [];
    fetchSpy().mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const path = requestPath(input);
          init?.signal?.addEventListener('abort', () => {
            aborted.push(path);
            reject(new DOMException('Aborted', 'AbortError'));
          });
          if (path.endsWith('/fr')) {
            resolve(fakeResponse({ contentLanguage: 'fr', text: 'bonjour' }));
          }
        }),
    );

    const english = apiClient('/rapid/en', { allowLegacyNullContentLanguage: false });
    await changeLanguage('ar');
    const arabic = apiClient('/rapid/ar', { allowLegacyNullContentLanguage: false });
    await changeLanguage('fr');
    const french = apiClient('/rapid/fr', { allowLegacyNullContentLanguage: false });

    await expect(english).rejects.toMatchObject({ name: 'AbortError' });
    await expect(arabic).rejects.toMatchObject({ name: 'AbortError' });
    await expect(french).resolves.toBe('bonjour');
    expect(aborted).toEqual(['/api/rapid/en', '/api/rapid/ar']);
  });

  it('rejects a response that becomes stale while its JSON body is decoding', async () => {
    let markBodyStarted!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    let resolveBody!: (value: unknown) => void;
    const body = new Promise<unknown>((resolve) => {
      resolveBody = resolve;
    });
    const response = fakeResponse({
      contentType: 'application/json',
      contentLanguage: 'en',
    });
    vi.spyOn(response, 'json').mockImplementation(() => {
      markBodyStarted();
      return body;
    });
    fetchSpy().mockResolvedValue(response);

    const pending = apiClient('/slow-json', {
      allowLegacyNullContentLanguage: false,
    });
    await bodyStarted;
    await changeLanguage('ar');
    resolveBody({ sentence: 'Old English' });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('suppresses a stale artifact access error after its body starts decoding', async () => {
    let markBodyStarted!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    let resolveBody!: (value: unknown) => void;
    const body = new Promise<unknown>((resolve) => {
      resolveBody = resolve;
    });
    const response = fakeResponse({
      ok: false,
      status: 404,
      contentType: 'application/json',
      contentLanguage: 'en',
    });
    vi.spyOn(response, 'json').mockImplementation(() => {
      markBodyStarted();
      return body;
    });
    fetchSpy().mockResolvedValue(response);

    const pending = apiClient('/slow-artifact-error', {
      localeMode: 'artifact',
      allowLegacyNullContentLanguage: false,
    });
    await bodyStarted;
    await changeLanguage('ar');
    resolveBody({ error: 'Old English' });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([
    ['POST', true],
    ['HEAD', false],
  ] as const)(
    'suppresses a stale %s response after decode and refreshes only mutations',
    async (method, shouldRefresh) => {
      let markBodyStarted!: () => void;
      const bodyStarted = new Promise<void>((resolve) => {
        markBodyStarted = resolve;
      });
      let resolveBody!: (value: unknown) => void;
      const body = new Promise<unknown>((resolve) => {
        resolveBody = resolve;
      });
      const response = fakeResponse({
        contentType: 'application/json',
        contentLanguage: 'en',
      });
      vi.spyOn(response, 'json').mockImplementation(() => {
        markBodyStarted();
        return body;
      });
      fetchSpy().mockResolvedValue(response);
      const refreshes: string[] = [];
      const unsubscribe = subscribePresentationRefresh((signal) => {
        refreshes.push(signal.reason);
      });

      const pending = apiClient(`/slow-${method.toLowerCase()}`, {
        method,
        csrf: false,
        allowLegacyNullContentLanguage: false,
      });
      await bodyStarted;
      await changeLanguage('ar');
      resolveBody({ sentence: 'Old English' });

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(refreshes).toEqual(
        shouldRefresh
          ? ['language-changed', 'stale-mutation']
          : ['language-changed'],
      );
      unsubscribe();
    },
  );

  it('never attaches an Authorization header (cookie sessions only)', async () => {
    const spy = fetchSpy().mockResolvedValue(fakeResponse({ text: 'ok' }));
    await apiClient('/secure');
    const headers = spy.mock.calls[0]![1]?.headers as Headers;
    expect(headers.has('Authorization')).toBe(false);
  });

  it('throws an ApiError carrying status and data on a non-2xx response', async () => {
    fetchSpy().mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 422,
        contentType: 'application/json',
        json: { error: 'bad' },
      }),
    );
    const err = await apiClient('/broken').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).code).toBe('http');
    expect((err as ApiError).data).toEqual({ error: 'bad' });
    expect((err as ApiError).contentLanguage).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('records the Content-Language the server rendered the error in', async () => {
    fetchSpy().mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 404,
        contentType: 'application/json',
        contentLanguage: 'ar',
        json: { error: { message: 'غير موجود', code: 'NOT_FOUND', messageKey: 'errors.notFound' } },
      }),
    );
    const err = await apiClient('/missing', { locale: 'ar' }).catch((e: unknown) => e);
    expect((err as ApiError).contentLanguage).toBe('ar');
  });

  it('surfaces a deduped session-expired toast on 401 before throwing', async () => {
    fetchSpy().mockResolvedValue(
      fakeResponse({ ok: false, status: 401, contentType: 'application/json', json: {} }),
    );
    const err = await apiClient('/secure').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(toast.error).toHaveBeenCalledWith(expect.any(String), {
      id: 'session-expired',
    });
  });

  it('five parallel 401s show ONE toast id for sonner dedupe', async () => {
    fetchSpy().mockResolvedValue(
      fakeResponse({ ok: false, status: 401, contentType: 'application/json', json: {} }),
    );

    const errors = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        apiClient(`/secure-${index}`).catch((e: unknown) => e),
      ),
    );

    expect(errors).toHaveLength(5);
    for (const err of errors) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('http');
    }
    expect(toast.error).toHaveBeenCalledTimes(5);
    for (const call of vi.mocked(toast.error).mock.calls) {
      expect(call[1]).toEqual({ id: 'session-expired' });
    }
  });

  it('a network TypeError surfaces as ApiError code network', async () => {
    fetchSpy().mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const err = await apiClient('/offline').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).code).toBe('network');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a JSON SyntaxError surfaces as ApiError code parse', async () => {
    fetchSpy().mockResolvedValue(
      fakeResponse({
        contentType: 'application/json',
        jsonError: new SyntaxError('Unexpected token'),
      }),
    );
    const err = await apiClient('/bad-json').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(200);
    expect((err as ApiError).code).toBe('parse');
  });

  it('a text parse failure surfaces as ApiError code parse', async () => {
    fetchSpy().mockResolvedValue(
      fakeResponse({
        contentType: 'text/plain',
        textError: new Error('stream failed'),
      }),
    );
    const err = await apiClient('/bad-text').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(200);
    expect((err as ApiError).code).toBe('parse');
  });

  it('aborts a hung request at 15s with ApiError code timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    fetchSpy().mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const promise = apiClient('/hung').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    const err = await promise;

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('timeout');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('timeoutMs replaces the 15s default so a slow route survives it', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    fetchSpy().mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
          // Answers at 30s — past the default cap, inside the override.
          setTimeout(
            () => resolve(fakeResponse({ contentType: 'application/json', json: { ok: true } })),
            30_000,
          );
        }),
    );

    const promise = apiClient<{ ok: boolean }>('/slow', { timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('a caller signal also aborts', async () => {
    const controller = new AbortController();
    fetchSpy().mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const promise = apiClient('/caller-abort', { signal: controller.signal }).catch(
      (e: unknown) => e,
    );
    controller.abort();
    const err = await promise;

    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('AbortError');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('serialises a JSON body and sets the Content-Type header', async () => {
    // csrf:false — the auto-CSRF flow would insert an extra token fetch as
    // spy.mock.calls[0]; opting out keeps the assertion targeting the mutation.
    const spy = fetchSpy().mockResolvedValue(
      fakeResponse({ contentType: 'application/json', json: {} }),
    );
    await apiClient('/create', { method: 'POST', body: { a: 1 }, csrf: false });
    const options = spy.mock.calls[0]![1];
    expect(options?.body).toBe(JSON.stringify({ a: 1 }));
    expect((options?.headers as Headers).get('Content-Type')).toBe('application/json');
  });

  it('defaults to POST + auto-CSRF when a body is set but no method is given', async () => {
    // Covers the `hasJsonBody ? 'POST' : 'GET'` branch on the method fallback
    // path — no explicit method AND a body triggers the automatic POST default,
    // which in turn opts into the CSRF flow.
    const spy = fetchSpy()
      .mockResolvedValueOnce(
        fakeResponse({ contentType: 'application/json', json: { csrfToken: 'auto-tok' } }),
      )
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, text: '' }));
    await apiClient('/default-post', { body: { z: 9 } });
    expect(requestPath(spy.mock.calls[0]![0])).toBe('/api/security/csrf-token');
    const headers = spy.mock.calls[1]![1]?.headers as Headers;
    expect(headers.get('x-csrf-token')).toBe('auto-tok');
    expect(spy.mock.calls[1]![1]?.body).toBe(JSON.stringify({ z: 9 }));
  });

  it('returns raw text for a non-JSON / empty response', async () => {
    fetchSpy().mockResolvedValue(fakeResponse({ contentType: 'text/plain', text: 'plain body' }));
    const result = await apiClient<string>('/text');
    expect(result).toBe('plain body');
  });

  it('uses an absolute URL verbatim without prefixing the base', async () => {
    const spy = fetchSpy().mockResolvedValue(fakeResponse({ text: '' }));
    await apiClient('http://example.com/external');
    expect(spy).toHaveBeenCalledWith('http://example.com/external', expect.any(Object));
  });

  it('fetches a CSRF token and echoes it in the x-csrf-token header when csrf is set', async () => {
    const spy = fetchSpy()
      .mockResolvedValueOnce(
        fakeResponse({ contentType: 'application/json', json: { csrfToken: 'tok-123' } }),
      )
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 202, text: '' }));
    await apiClient('/legal/delete-account', { method: 'POST', csrf: true });
    // First call fetches the token; second is the guarded mutation.
    expect(requestPath(spy.mock.calls[0]![0])).toBe('/api/security/csrf-token');
    const headers = spy.mock.calls[1]![1]?.headers as Headers;
    expect(headers.get('x-csrf-token')).toBe('tok-123');
    expect(spy.mock.calls[1]![1]?.credentials).toBe('include');
  });

  it('fetchCsrfToken returns the token from the security endpoint', async () => {
    const spy = fetchSpy().mockResolvedValue(
      fakeResponse({ contentType: 'application/json', json: { csrfToken: 'abc' } }),
    );
    await expect(fetchCsrfToken()).resolves.toBe('abc');
    expect(requestPath(spy.mock.calls[0]![0])).toBe('/api/security/csrf-token');
    expect(spy.mock.calls[0]![1]).toEqual(expect.any(Object));
  });

  it('fetchCsrfToken itself failing surfaces ApiError', async () => {
    fetchSpy().mockRejectedValueOnce(new TypeError('offline'));
    const err = await fetchCsrfToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('network');
  });

  it('respects caller-supplied headers instead of overriding them', async () => {
    const spy = fetchSpy().mockResolvedValue(fakeResponse({ text: '' }));
    await apiClient('/custom', {
      method: 'POST',
      body: { x: 1 },
      headers: {
        'Content-Type': 'application/xml',
        Accept: 'text/plain',
      },
      csrf: false,
    });
    const headers = spy.mock.calls[0]![1]?.headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/xml');
    expect(headers.get('Accept')).toBe('text/plain');
  });

  it('attaches x-csrf-token automatically on POST/PUT/PATCH/DELETE', async () => {
    const methods = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
    for (const method of methods) {
      __resetCsrfTokenCacheForTests();
      const spy = fetchSpy()
        .mockResolvedValueOnce(
          fakeResponse({
            contentType: 'application/json',
            json: { csrfToken: `t-${method}` },
          }),
        )
        .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, text: '' }));
      await apiClient(`/mutate/${method}`, { method });
      // First call = /csrf-token, second = the actual mutation
      expect(requestPath(spy.mock.calls[0]![0])).toBe('/api/security/csrf-token');
      const headers = spy.mock.calls[1]![1]?.headers as Headers;
      expect(headers.get('x-csrf-token')).toBe(`t-${method}`);
      spy.mockRestore();
    }
  });

  it('does NOT attach x-csrf-token on GET', async () => {
    const spy = fetchSpy().mockResolvedValue(fakeResponse({ text: 'ok' }));
    await apiClient('/read');
    // Only one fetch — no csrf-token fetch happened.
    expect(spy).toHaveBeenCalledTimes(1);
    const headers = spy.mock.calls[0]![1]?.headers as Headers;
    expect(headers.get('x-csrf-token')).toBeNull();
  });

  it('CSRF token cached across mutations', async () => {
    const spy = fetchSpy()
      .mockResolvedValueOnce(
        fakeResponse({ contentType: 'application/json', json: { csrfToken: 'cached' } }),
      )
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, text: '' }))
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, text: '' }));
    await apiClient('/a', { method: 'POST' });
    await apiClient('/b', { method: 'POST' });
    // 3 fetches total: 1 token + 2 mutations (the second reused the cache).
    expect(spy).toHaveBeenCalledTimes(3);
    expect(requestPath(spy.mock.calls[0]![0])).toBe('/api/security/csrf-token');
    // Second mutation is call index 2 (not 3).
    const headers2 = spy.mock.calls[2]![1]?.headers as Headers;
    expect(headers2.get('x-csrf-token')).toBe('cached');
  });

  it('fetches a fresh CSRF token after the cache expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const spy = fetchSpy()
      .mockResolvedValueOnce(
        fakeResponse({ contentType: 'application/json', json: { csrfToken: 'first' } }),
      )
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, text: '' }))
      .mockResolvedValueOnce(
        fakeResponse({ contentType: 'application/json', json: { csrfToken: 'second' } }),
      )
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, text: '' }));

    await apiClient('/first', { method: 'POST' });
    vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
    await apiClient('/second', { method: 'POST' });

    expect(spy).toHaveBeenCalledTimes(4);
    expect(requestPath(spy.mock.calls[2]![0])).toBe('/api/security/csrf-token');
    const headers = spy.mock.calls[3]![1]?.headers as Headers;
    expect(headers.get('x-csrf-token')).toBe('second');
  });

  it('refreshes the token once and retries on a 403 CSRF rejection', async () => {
    const spy = fetchSpy()
      .mockResolvedValueOnce(
        fakeResponse({ contentType: 'application/json', json: { csrfToken: 'stale' } }),
      )
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 403, text: '' }))
      .mockResolvedValueOnce(
        fakeResponse({ contentType: 'application/json', json: { csrfToken: 'fresh' } }),
      )
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, text: '' }));
    await apiClient('/retry', { method: 'POST' });
    // Sequence: token, mutation (403), token-refresh, retry-mutation (200).
    expect(spy).toHaveBeenCalledTimes(4);
    const retryHeaders = spy.mock.calls[3]![1]?.headers as Headers;
    expect(retryHeaders.get('x-csrf-token')).toBe('fresh');
  });

  it('still throws when the CSRF retry itself returns 403', async () => {
    const spy = fetchSpy()
      .mockResolvedValueOnce(
        fakeResponse({ contentType: 'application/json', json: { csrfToken: 't1' } }),
      )
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 403, text: '' }))
      .mockResolvedValueOnce(
        fakeResponse({ contentType: 'application/json', json: { csrfToken: 't2' } }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          ok: false,
          status: 403,
          contentType: 'application/json',
          json: { error: 'still bad' },
        }),
      );
    const err = await apiClient('/still-broken', { method: 'POST' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).code).toBe('http');
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('honors an explicit csrf:false override on a mutating method', async () => {
    const spy = fetchSpy().mockResolvedValue(fakeResponse({ text: '' }));
    await apiClient('/optout', { method: 'POST', csrf: false });
    expect(spy).toHaveBeenCalledTimes(1);
    const headers = spy.mock.calls[0]![1]?.headers as Headers;
    expect(headers.get('x-csrf-token')).toBeNull();
  });

  it('honors an explicit csrf:true override on a normally-exempt method', async () => {
    // Manual GET with csrf:true should still fetch the token.
    const spy = fetchSpy()
      .mockResolvedValueOnce(
        fakeResponse({ contentType: 'application/json', json: { csrfToken: 'g-tok' } }),
      )
      .mockResolvedValueOnce(fakeResponse({ text: 'ok' }));
    await apiClient('/read', { csrf: true });
    expect(spy).toHaveBeenCalledTimes(2);
    const headers = spy.mock.calls[1]![1]?.headers as Headers;
    expect(headers.get('x-csrf-token')).toBe('g-tok');
  });

  it('falls back to /api when VITE_API_BASE_URL is absent at module load', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', undefined);
    const { apiClient: freshApiClient } = await import('./client');
    const spy = fetchSpy().mockResolvedValue(fakeResponse({ text: 'ok' }));

    await freshApiClient('/fallback');

    expect(requestPath(spy.mock.calls[0]![0])).toBe('/api/fallback');
  });
});
