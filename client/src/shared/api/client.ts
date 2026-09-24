import { toast } from 'sonner';
import i18n from 'i18next';
import { normalizeApiBaseUrl } from './base-url';
import { isSupportedLocale, type SupportedLocale } from '@shared/i18n/locales';
import {
  getPresentationLocale,
  getPresentationLocaleSnapshot,
  requestPresentationRefresh,
  subscribePresentationLocale,
} from '@shared/i18n/presentationLocale';

const API_BASE_URL = normalizeApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL,
  import.meta.env.VITE_SITE_URL,
  globalThis.location?.origin,
);

/**
 * Resolve API paths through the single environment-derived base URL. Raw-fetch
 * consumers (SSE, blobs) use this instead of duplicating Vite env handling.
 */
export const resolveApiUrl = (path: string): string =>
  path.startsWith('http') ? path : `${API_BASE_URL}${path}`;

/** Resolve an API path to the absolute URL required by Better Auth. */
export const resolveAbsoluteApiUrl = (
  path: string,
  location: { origin: string } | undefined = globalThis.location,
): string => new URL(resolveApiUrl(path), location?.origin ?? 'http://localhost').toString();

/**
 * Double-submit CSRF header name. Matches the server default
 * (`CSRF_HEADER_NAME`, see `server/src/config/env.ts`) — the server reads the
 * echoed token from this header and compares it to the cookie it issued.
 */
const CSRF_HEADER = 'x-csrf-token';
const DEFAULT_TIMEOUT_MS = 15_000;
const CSRF_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Workspace header (`rankme-enterprise-orgs` 02). Mirrors `WORKSPACE_HEADER`
 * in `server/src/shared/middleware/workspace-context.ts`; a parity test pins
 * the two literals together.
 */
export const WORKSPACE_HEADER = 'x-workspace-id';
export const LANGUAGE_HEADER = 'x-lang';

/**
 * Returns the workspace the user is currently working inside, or null for
 * their own. `apiClient` is the single fetch choke point, so wiring this once
 * at bootstrap puts the header on every product call.
 *
 * The Better Auth client does NOT go through `apiClient`, which is deliberate:
 * sign-in, sign-out, and session reads must stay workspace-agnostic.
 */
let workspaceIdProvider: (() => string | null) | null = null;

export const setWorkspaceIdProvider = (provider: (() => string | null) | null): void => {
  workspaceIdProvider = provider;
};

export const activeRequestLocale = (): SupportedLocale => getPresentationLocale();

/**
 * Endpoints that are about the SIGNED-IN HUMAN rather than the workspace they
 * are working inside, so the header is never attached to them.
 *
 * Data rights are the load-bearing case: the server rejects a foreign
 * workspace header there outright (no membership can ever grant another
 * account's export or deletion), so sending it would 404 a member trying to
 * manage their OWN account while working inside somebody else's workspace.
 *
 * `/team/workspaces` is already actor-scoped server-side; it is listed so the
 * switcher's own reader cannot be steered by the selection it feeds.
 */
const ACTOR_SCOPED_PATH_PREFIXES = [
  '/legal/',
  '/team/workspaces',
  '/team/invitations',
  '/team/accept/',
  '/team/reject/',
  '/security/',
  '/users/preferences/language',
  '/report-shares/',
  '/client-portal/',
  '/_docs-data/',
];

const isActorScopedPath = (path: string): boolean =>
  ACTOR_SCOPED_PATH_PREFIXES.some((prefix) => {
    try {
      const pathname = path.startsWith('http')
        ? new URL(path).pathname
        : path;
      const withoutApiPrefix = pathname.replace(/^\/api(?=\/|$)/, '');
      return withoutApiPrefix.startsWith(prefix);
    } catch {
      return false;
    }
  });

/**
 * Context headers for raw-response consumers such as blob downloads. Keeping
 * this beside `apiClient` prevents a second, drifting workspace-selection
 * implementation in feature code.
 */
export type RequestLocaleMode = 'presentation' | 'artifact' | 'none';

export interface ApiContextOptions {
  localeMode?: RequestLocaleMode;
  locale?: SupportedLocale;
  /** Captured UI generation for a multi-step thunk/effect. */
  presentationGeneration?: number;
  workspace?: 'auto' | 'omit';
}

export interface RequestLocaleContext {
  mode: RequestLocaleMode;
  locale: SupportedLocale | null;
  generation: number | null;
}

export const captureRequestLocale = (
  options: Pick<
    ApiContextOptions,
    'locale' | 'localeMode' | 'presentationGeneration'
  > = {},
): RequestLocaleContext => {
  const mode = options.localeMode ?? 'presentation';
  if (mode === 'none') return { mode, locale: null, generation: null };
  const snapshot = getPresentationLocaleSnapshot();
  return {
    mode,
    locale: options.locale ?? snapshot.locale,
    generation: options.presentationGeneration ?? snapshot.generation,
  };
};

export const apiContextHeaders = (
  path: string,
  options: ApiContextOptions = {},
): Headers => {
  const headers = new Headers();
  const context = captureRequestLocale(options);
  if (context.locale !== null) headers.set(LANGUAGE_HEADER, context.locale);
  const workspaceId =
    options.workspace === 'omit' || isActorScopedPath(path)
      ? null
      : (workspaceIdProvider?.() ?? null);
  if (workspaceId !== null) headers.set(WORKSPACE_HEADER, workspaceId);
  return headers;
};

export interface ApiClientOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** How this response participates in presentation-language coherence. */
  localeMode?: RequestLocaleMode;
  /** Explicit operation/output locale. It wins over the active UI locale. */
  locale?: SupportedLocale;
  /** Generation captured with `locale` by a locale-sensitive thunk/effect. */
  presentationGeneration?: number;
  /**
   * Compatibility escape hatch for catalogued legacy artifact/machine
   * downloads that do not yet emit Content-Language (ART-049..051).
   */
  allowLegacyNullContentLanguage?: boolean;
  /**
   * Override the automatic CSRF behavior. By default the client attaches the
   * double-submit token on every mutating verb (POST/PUT/PATCH/DELETE) so
   * feature `api.ts` files inherit CSRF protection without per-call edits.
   * Set `false` to opt out (rare — only for surfaces the server does not
   * guard, such as `/api/v1` bearer calls); `true` forces the header on a
   * verb we would otherwise skip.
   */
  csrf?: boolean;
  /**
   * Per-call abort budget in milliseconds, replacing `DEFAULT_TIMEOUT_MS`.
   *
   * A caller-supplied `signal` can only ever SHORTEN the wait (it is
   * `AbortSignal.any`-ed with the timeout), so a genuinely slow endpoint has no
   * way to ask for more time without this option. Reserve it for routes whose
   * server-side budget is documented and larger than the default — currently
   * the AI prompt-suggestion generation, whose profile deadline is 45s while
   * the default cap is 15s. Without the override the browser aborted a call the
   * server then completed: the unit was spent and the run row written, but the
   * user saw a timeout.
   */
  timeoutMs?: number | null;
}

export interface ApiFetchOptions extends RequestInit, ApiContextOptions {
  allowLegacyNullContentLanguage?: boolean;
  timeoutMs?: number | null;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type ApiErrorCode = 'http' | 'network' | 'parse' | 'timeout' | 'language';

interface CsrfCacheEntry {
  token: string;
  expiresAt: number;
}

/** Module-scope cache so we do not re-fetch a token per request. */
let csrfCache: CsrfCacheEntry | null = null;

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;
  readonly code: ApiErrorCode;
  /**
   * `Content-Language` the server rendered this error in, or null when the
   * response carried no header (network/timeout faults, legacy surfaces).
   * Callers use it to tell a stale-locale response from a fresh one rather
   * than assuming the active UI language.
   */
  readonly contentLanguage: string | null;

  constructor(
    message: string,
    status: number,
    data: unknown,
    code: ApiErrorCode = 'http',
    contentLanguage: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.code = code;
    this.contentLanguage = contentLanguage;
  }
}

export class ResponseLanguageMismatchError extends ApiError {
  readonly expected: SupportedLocale | null;
  readonly received: string | null;

  constructor(expected: SupportedLocale | null, received: string | null) {
    super('Response language did not match the request contract', 0, null, 'language');
    this.name = 'ResponseLanguageMismatchError';
    this.expected = expected;
    this.received = received;
  }
}

const stalePresentationAbort = (): DOMException =>
  new DOMException('Presentation locale changed while the request was active', 'AbortError');

export const isCurrentRequestLocale = (context: RequestLocaleContext): boolean => {
  return (
    context.generation === null ||
    context.generation === getPresentationLocaleSnapshot().generation
  );
};

const verifyResponseLanguage = (
  response: Response,
  context: RequestLocaleContext,
  allowLegacyNull: boolean,
): void => {
  if (context.mode === 'none') return;
  const received = response.headers.get('Content-Language');
  if (received === null) {
    if (allowLegacyNull) return;
    throw new ResponseLanguageMismatchError(context.locale, null);
  }
  if (!isSupportedLocale(received)) {
    throw new ResponseLanguageMismatchError(context.locale, received);
  }
  const mustMatchRequest = context.mode === 'presentation' || !response.ok;
  if (mustMatchRequest && received !== context.locale) {
    throw new ResponseLanguageMismatchError(context.locale, received);
  }
};

const activePresentationReads = new Map<number, Set<AbortController>>();

const trackPresentationRead = (
  context: RequestLocaleContext,
  method: string,
): AbortController | null => {
  if (
    context.mode !== 'presentation' ||
    context.generation === null ||
    (method !== 'GET' && method !== 'HEAD')
  ) {
    return null;
  }
  const controller = new AbortController();
  const controllers = activePresentationReads.get(context.generation) ?? new Set();
  controllers.add(controller);
  activePresentationReads.set(context.generation, controllers);
  return controller;
};

const untrackPresentationRead = (
  context: RequestLocaleContext,
  controller: AbortController | null,
): void => {
  if (controller === null || context.generation === null) return;
  const controllers = activePresentationReads.get(context.generation);
  controllers?.delete(controller);
  if (controllers?.size === 0) activePresentationReads.delete(context.generation);
};

subscribePresentationLocale(() => {
  for (const [requestGeneration, controllers] of activePresentationReads) {
    // A language change increments the generation before listeners run, so
    // every request already tracked here belongs to the previous generation.
    for (const controller of controllers) controller.abort(stalePresentationAbort());
    activePresentationReads.delete(requestGeneration);
  }
});

const buildHeaders = (init: HeadersInit | undefined, hasJsonBody: boolean): Headers => {
  const headers = new Headers(init);
  if (hasJsonBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  return headers;
};

const getCachedCsrfToken = (): string | null => {
  if (csrfCache === null) return null;
  if (csrfCache.expiresAt <= Date.now()) {
    csrfCache = null;
    return null;
  }
  return csrfCache.token;
};

const cacheCsrfToken = (token: string): string => {
  csrfCache = { token, expiresAt: Date.now() + CSRF_CACHE_TTL_MS };
  return token;
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('Content-Type') ?? '';
  try {
    return contentType.includes('application/json')
      ? await response.json()
      : await response.text();
  } catch {
    throw new ApiError('Failed to parse response body', response.status, null, 'parse');
  }
};

const isDomExceptionNamed = (err: unknown, name: string): boolean =>
  err instanceof DOMException && err.name === name;

const combinedSignal = (signals: AbortSignal[]): AbortSignal | undefined => {
  if (signals.length === 0) return undefined;
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
};

const allowMissingLanguageInTest = (
  explicit: boolean | undefined,
): boolean => explicit ?? import.meta.env.MODE === 'test';

const fetchWithLocaleContract = async (
  path: string,
  init: RequestInit,
  context: RequestLocaleContext,
  options: {
    allowLegacyNullContentLanguage?: boolean;
    timeoutMs?: number | null;
  },
): Promise<Response> => {
  const method = (init.method ?? 'GET').toUpperCase();
  if (context.mode === 'presentation' && !isCurrentRequestLocale(context)) {
    throw stalePresentationAbort();
  }
  const generationController = trackPresentationRead(context, method);
  const timeoutSignal =
    options.timeoutMs === null
      ? null
      : AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signals = [init.signal, timeoutSignal, generationController?.signal].filter(
    (signal): signal is AbortSignal => signal !== null && signal !== undefined,
  );

  try {
    const response = await fetch(resolveApiUrl(path), {
      credentials: 'include',
      ...init,
      signal: combinedSignal(signals),
    });

    const stale = !isCurrentRequestLocale(context);
    if (
      stale &&
      (context.mode === 'presentation' || !response.ok)
    ) {
      if (
        context.mode === 'presentation' &&
        method !== 'GET' &&
        method !== 'HEAD'
      ) {
        requestPresentationRefresh();
      }
      throw stalePresentationAbort();
    }

    verifyResponseLanguage(
      response,
      context,
      allowMissingLanguageInTest(options.allowLegacyNullContentLanguage),
    );
    return response;
  } catch (error) {
    if (error instanceof ResponseLanguageMismatchError) throw error;
    if (generationController?.signal.aborted) {
      throw stalePresentationAbort();
    }
    const isTimeout =
      isDomExceptionNamed(error, 'TimeoutError') ||
      (isDomExceptionNamed(error, 'AbortError') && timeoutSignal?.aborted === true);
    if (isTimeout) {
      throw new ApiError('Request timed out', 0, null, 'timeout');
    }
    if (isDomExceptionNamed(error, 'AbortError')) throw error;
    throw new ApiError('Network request failed', 0, null, 'network');
  } finally {
    untrackPresentationRead(context, generationController);
  }
};

/**
 * Raw-response API transport for blobs, PDFs, CSV, and SSE. It shares the
 * exact locale/workspace/signal contract used by `apiClient` without
 * buffering the response body.
 */
export const apiFetch = async (
  path: string,
  options: ApiFetchOptions = {},
): Promise<Response> => {
  const {
    localeMode,
    locale,
    presentationGeneration,
    workspace,
    allowLegacyNullContentLanguage,
    timeoutMs,
    headers: initialHeaders,
    ...init
  } = options;
  const explicitHeaderLocale = new Headers(initialHeaders).get(LANGUAGE_HEADER);
  const context = captureRequestLocale({
    ...(localeMode === undefined ? {} : { localeMode }),
    ...(locale === undefined ? {} : { locale }),
    ...(presentationGeneration === undefined
      ? {}
      : { presentationGeneration }),
  });
  const resolvedContext =
    locale === undefined && isSupportedLocale(explicitHeaderLocale)
      ? captureRequestLocale({
          ...(localeMode === undefined ? {} : { localeMode }),
          locale: explicitHeaderLocale,
          ...(presentationGeneration === undefined
            ? {}
            : { presentationGeneration }),
        })
      : context;
  const headers = new Headers(initialHeaders);
  for (const [name, value] of apiContextHeaders(path, {
    localeMode: resolvedContext.mode,
    ...(resolvedContext.locale ? { locale: resolvedContext.locale } : {}),
    ...(workspace === undefined ? {} : { workspace }),
  })) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return fetchWithLocaleContract(
    path,
    { ...init, headers },
    resolvedContext,
    {
      ...(allowLegacyNullContentLanguage === undefined
        ? {}
        : { allowLegacyNullContentLanguage }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    },
  );
};

/**
 * Typed fetch wrapper. Auth is cookie-based (Better Auth session cookie),
 * so every request ships credentials — no tokens, no Authorization header.
 * A 401 on a product route means the session is gone (expired or revoked);
 * surface it once as a localized toast so the redirect to /login isn't mute.
 */
export const apiClient = async <T = unknown>(
  path: string,
  options: ApiClientOptions = {},
): Promise<T> => {
  const {
    body,
    headers,
    csrf,
    timeoutMs,
    localeMode,
    locale,
    presentationGeneration,
    allowLegacyNullContentLanguage,
    ...rest
  } = options;
  const hasJsonBody = body !== undefined && body !== null;
  const url = resolveApiUrl(path);

  const method = (rest.method ?? (hasJsonBody ? 'POST' : 'GET')).toUpperCase();
  const needsCsrf = csrf ?? MUTATING_METHODS.has(method);
  const explicitHeaderLocale = new Headers(headers).get(LANGUAGE_HEADER);
  const localeContext = captureRequestLocale({
    ...(localeMode === undefined ? {} : { localeMode }),
    ...(presentationGeneration === undefined
      ? {}
      : { presentationGeneration }),
    ...(locale !== undefined
      ? { locale }
      : isSupportedLocale(explicitHeaderLocale)
        ? { locale: explicitHeaderLocale }
        : {}),
  });

  const doFetch = async (csrfToken: string | null): Promise<Response> => {
    const finalHeaders = buildHeaders(headers, hasJsonBody);
    if (csrfToken !== null) {
      finalHeaders.set(CSRF_HEADER, csrfToken);
    }
    for (const [name, value] of apiContextHeaders(path, {
      localeMode: localeContext.mode,
      ...(localeContext.locale ? { locale: localeContext.locale } : {}),
    })) {
      if (!finalHeaders.has(name)) finalHeaders.set(name, value);
    }
    return fetchWithLocaleContract(
      path,
      {
        ...rest,
        method,
        headers: finalHeaders,
        body: hasJsonBody ? JSON.stringify(body) : undefined,
      },
      localeContext,
      {
        ...(allowLegacyNullContentLanguage === undefined
          ? {}
          : { allowLegacyNullContentLanguage }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      },
    );
  };

  let response: Response;
  if (needsCsrf) {
    const csrfToken = getCachedCsrfToken() ?? cacheCsrfToken(await fetchCsrfToken());
    response = await doFetch(csrfToken);
    // A 403 on a mutating request most likely means the cached token was
    // rotated (server restart, cookie cleared). Refresh once and retry.
    if (response.status === 403) {
      csrfCache = null;
      response = await doFetch(cacheCsrfToken(await fetchCsrfToken()));
    }
  } else {
    response = await doFetch(null);
  }

  const data = await parseResponseBody(response);

  const responseBecameStale =
    !isCurrentRequestLocale(localeContext) &&
    (localeContext.mode === 'presentation' || !response.ok);
  if (responseBecameStale) {
    if (
      localeContext.mode === 'presentation' &&
      method !== 'GET' &&
      method !== 'HEAD'
    ) {
      requestPresentationRefresh();
    }
    throw stalePresentationAbort();
  }

  if (!response.ok) {
    if (response.status === 401) {
      toast.error(i18n.t('auth:sessionExpired'), { id: 'session-expired' });
    }
    throw new ApiError(
      `Request to ${url} failed with status ${response.status}`,
      response.status,
      data,
      'http',
      response.headers.get('Content-Language'),
    );
  }

  return data as T;
};

/** Test-only: reset the module-scope CSRF token cache. */
export const __resetCsrfTokenCacheForTests = (): void => {
  csrfCache = null;
};

/**
 * Fetch a fresh double-submit CSRF token from the server. The GET response
 * also sets the matching cookie (`credentials: 'include'`), so the returned
 * token + cookie form the pair `requireCsrf` compares. Called automatically by
 * `apiClient` when `{ csrf: true }` is passed.
 */
export const fetchCsrfToken = async (): Promise<string> => {
  const { csrfToken } = await apiClient<{ csrfToken: string }>('/security/csrf-token');
  return csrfToken;
};
