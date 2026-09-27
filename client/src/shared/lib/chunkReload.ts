/**
 * Stale lazy-chunk recovery.
 *
 * After a deploy the hashed route chunks of the previous build are gone, so a
 * tab that loaded the old shell fails its next `import()` with
 * "Failed to fetch dynamically imported module". Reloading once fetches the
 * new shell and its chunks; a sessionStorage timestamp keeps a genuinely
 * broken chunk from reloading in a loop.
 */
const STORAGE_KEY = 'rmf.chunkReloadAt';
/** A second failure inside this window shows the error page instead. */
export const CHUNK_RELOAD_GUARD_MS = 60_000;

const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
  /loading (?:css )?chunk [\w-]+ failed/i,
];

/** True for the browser errors a missing/renamed build chunk produces. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  return typeof message === 'string' && CHUNK_ERROR_PATTERNS.some((re) => re.test(message));
}

export interface ChunkReloadEnv {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  reload?: () => void;
  now?: () => number;
}

const defaultStorage = (): Pick<Storage, 'getItem' | 'setItem'> | undefined => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
};

/**
 * Reload the page once for a stale chunk. Returns false (and does nothing)
 * when a reload already happened within the guard window or storage is
 * unavailable — the caller then shows its error UI.
 */
export function reloadOnceForStaleChunk(env: ChunkReloadEnv = {}): boolean {
  const storage = 'storage' in env ? env.storage : defaultStorage();
  const now = (env.now ?? Date.now)();
  const reload = env.reload ?? (() => globalThis.location.reload());
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(STORAGE_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_GUARD_MS) return false;
    storage.setItem(STORAGE_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}
