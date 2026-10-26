import { createContext, useContext, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export interface AppTitleDetail {
  token: object;
  locationKey: string;
  segments: readonly string[];
}
export interface AppTitleRegistry {
  set(detail: AppTitleDetail): void;
  clear(token: object): void;
}
export const AppTitleRegistryContext = createContext<AppTitleRegistry | null>(null);

/** Refine the shell title with localized segments belonging to this location. */
export function useAppTitleDetail(segments: readonly (string | null | undefined)[] | null): boolean {
  const registry = useContext(AppTitleRegistryContext);
  const { key } = useLocation();
  const signature = segments === null ? null : JSON.stringify(segments.map((segment) => segment?.replace(/\s+/g, ' ').trim() ?? '').filter(Boolean));
  useEffect(() => {
    if (registry === null || signature === null) return;
    const token = {};
    registry.set({ token, locationKey: key, segments: JSON.parse(signature) as string[] });
    return () => registry.clear(token);
  }, [registry, key, signature]);
  return registry !== null;
}
