/**
 * Persistence for the active workspace (`rankme-enterprise-orgs` 02).
 *
 * One namespaced key. The stored value is ALWAYS re-validated against the
 * workspaces the server just returned: a membership can be revoked between
 * sessions, and a stale id would otherwise make every request 404 with no way
 * out but clearing site data.
 */
const STORAGE_KEY = 'rankme.activeWorkspaceId';

/** localStorage throws in private-mode Safari and is absent during SSR. */
const safeStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export const readStoredWorkspaceId = (): string | null => {
  const value = safeStorage()?.getItem(STORAGE_KEY) ?? null;
  return value === null || value === '' ? null : value;
};

export const writeStoredWorkspaceId = (id: string | null): void => {
  const storage = safeStorage();
  if (!storage) return;
  try {
    if (id === null) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, id);
  } catch {
    // A full or blocked quota must never break navigation — the switcher just
    // stops surviving reloads.
  }
};
