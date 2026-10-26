import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Lifecycle permissions supplement the server's authoritative pause guard. */
export interface SiteCapabilities {
  paused: boolean;
  /** Start manual or background work, including vendor calls. */
  canRun: boolean;
  canSchedule: boolean;
  canResume: boolean;
}
export interface SiteCapabilitiesWithReason extends SiteCapabilities {
  blockedReason: string | null;
}
const ACTIVE: SiteCapabilities = Object.freeze({ paused: false, canRun: true, canSchedule: true, canResume: false });
const PAUSED: SiteCapabilities = Object.freeze({ paused: true, canRun: false, canSchedule: false, canResume: true });

/** Unknown sites use the active fallback; the server still checks every operation. */
export function siteCapabilities(site: { paused?: boolean } | null | undefined): SiteCapabilities {
  return site?.paused === true ? PAUSED : ACTIVE;
}
export function useCapabilitiesWithReason(capabilities: SiteCapabilities): SiteCapabilitiesWithReason {
  const { t } = useTranslation('sites');
  return useMemo(() => ({ ...capabilities, blockedReason: capabilities.paused ? t('paused.actionBlocked') : null }), [capabilities, t]);
}
const SiteLifecycleContext = createContext<SiteCapabilities | null>(null);
export interface SiteLifecycleProviderProps {
  paused: boolean;
  children: ReactNode;
}
export const SiteLifecycleProvider = ({ paused, children }: SiteLifecycleProviderProps) => (
  <SiteLifecycleContext.Provider value={siteCapabilities({ paused })}>{children}</SiteLifecycleContext.Provider>
);
export function useWorkspaceSiteCapabilities(): SiteCapabilitiesWithReason {
  return useCapabilitiesWithReason(useContext(SiteLifecycleContext) ?? ACTIVE);
}
