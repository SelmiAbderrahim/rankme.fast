/**
 * Identical-request de-duplication for read thunks.
 *
 * Several components on one page (a panel, the overview card, a report row)
 * each dispatch the same load thunk with the same arguments, and effects that
 * abort-and-redispatch (filter changes, locale refresh) fire it again within
 * the same tick. `shareInFlight` collapses concurrent calls with the same key
 * into ONE network request: every caller still runs its own thunk lifecycle
 * (its own pending/fulfilled actions and abort handling) but awaits the same
 * promise. The entry is removed the moment the request settles, so this is
 * never a cache and a later call always refetches.
 *
 * The shared request deliberately takes no caller's AbortSignal: a caller that
 * aborts (RTK rejects its thunk on its own) must not cancel the request other
 * callers, or the redispatch that follows the abort, are still waiting on.
 */
const pending = new Map<string, Promise<unknown>>();

export const shareInFlight = <T>(key: string, start: () => Promise<T>): Promise<T> => {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const request: Promise<T> = start().finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  return request;
};

/** Forget in-flight reads whose key starts with `prefix` (they stay running). */
export const dropInFlight = (prefix: string): void => {
  for (const key of pending.keys()) {
    if (key.startsWith(prefix)) pending.delete(key);
  }
};

/**
 * Run a mutation so that no read started before it settled can be joined by a
 * read dispatched after it: a post-mutation reload must see the mutation.
 */
export const withInFlightInvalidation = async <T>(
  prefix: string,
  mutate: () => Promise<T>,
): Promise<T> => {
  dropInFlight(prefix);
  try {
    return await mutate();
  } finally {
    dropInFlight(prefix);
  }
};
