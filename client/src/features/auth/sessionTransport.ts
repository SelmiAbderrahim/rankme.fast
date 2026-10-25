const SESSION_TIMEOUT_MS = 8_000;
const RETRY_DELAYS_MS = [500, 1_000] as const;

class InvalidSessionResponse extends Error {
  constructor() {
    super('Invalid session response');
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const validSession = (value: unknown): boolean => value === null || (
  isRecord(value) && (
    (value.user === null && value.session === null) ||
    (isRecord(value.user) && typeof value.user.id === 'string' &&
      isRecord(value.session) && typeof value.session.id === 'string')
  )
);

const abortError = () => new DOMException('Session read canceled', 'AbortError');
const timeoutError = () => new DOMException('Session read timed out', 'TimeoutError');

const waitForRetry = (delay: number, signal: AbortSignal | null | undefined): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const readWithDeadline = async (
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  parent: AbortSignal | null | undefined,
): Promise<Response> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    cancel = () => {
      controller.abort();
      reject(abortError());
    };
    parent?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(timeoutError());
    }, SESSION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(input, { ...init, signal: controller.signal });
        const body = await response.clone().text();
        if (response.ok) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(body) as unknown;
          } catch {
            throw new InvalidSessionResponse();
          }
          if (!validSession(parsed)) throw new InvalidSessionResponse();
        }
        return response;
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    if (cancel) parent?.removeEventListener('abort', cancel);
  }
};

/** Better Auth still owns the session atom; only its session read gets retry. */
export const createSessionTransport = (fetcher: typeof fetch): typeof fetch => async (input, init) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  if (!url.pathname.endsWith('/auth/get-session') || method !== 'GET') {
    return fetcher(input, init);
  }

  const parent = init?.signal ?? request?.signal;
  parent?.throwIfAborted();
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await readWithDeadline(fetcher, input, init, parent);
      if (attempt >= RETRY_DELAYS_MS.length ||
        ![408, 429].includes(response.status) && response.status < 500) return response;
      void response.body?.cancel();
    } catch (error) {
      if (parent?.aborted || error instanceof InvalidSessionResponse || attempt >= RETRY_DELAYS_MS.length) {
        throw error;
      }
    }
    await waitForRetry(RETRY_DELAYS_MS[attempt]!, parent);
  }
};

export const sessionTransport = createSessionTransport((input, init) => fetch(input, init));
