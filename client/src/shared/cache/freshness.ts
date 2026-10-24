/** Shared freshness policy for account and workspace bootstrap data. */
export const CACHE_TTL_MS = {
  sites: 60_000,
  invitations: 60_000,
  workspaces: 5 * 60_000,
  pages: 60_000,
  siteHealth: 60_000,
} as const;

export interface CacheLoadOptions {
  force?: boolean;
  maxAgeMs?: number;
}

export interface CacheStamp {
  loadedAt: number | null;
  loading: boolean;
}

export const isFresh = (loadedAt: number | null, maxAgeMs: number, now = Date.now()): boolean =>
  loadedAt !== null && now - loadedAt >= 0 && now - loadedAt < maxAgeMs;

/** Force ignores freshness, while an active read remains authoritative. */
export const shouldLoad = (
  stamp: CacheStamp,
  options: CacheLoadOptions | void | undefined,
  defaultMaxAgeMs: number,
  now = Date.now(),
): boolean => {
  if (stamp.loading) return false;
  if (options?.force) return true;
  return !isFresh(stamp.loadedAt, options?.maxAgeMs ?? defaultMaxAgeMs, now);
};
