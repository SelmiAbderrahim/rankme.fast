import { useTabParam } from '@shared/hooks/useTabParam';

export const BACKLINK_TABS = [
  'overview',
  'rows',
  'domains',
  'anchors',
  'history',
  'gap',
  'toxicity',
] as const;
export type BacklinkTab = (typeof BACKLINK_TABS)[number];
export const DEFAULT_BACKLINK_TAB: BacklinkTab = 'overview';

export function isBacklinkTab(value: unknown): value is BacklinkTab {
  return typeof value === 'string' && (BACKLINK_TABS as readonly string[]).includes(value);
}

/**
 * Canonical `?tab=` state for the standalone link-intelligence workspace.
 * Invalid explicit values are normalized in-place while every unrelated
 * query parameter is retained. The shared hook keeps tab writes replace-only.
 */
export function useBacklinkTab(
  paramName: 'tab' | 'view' = 'tab',
): [BacklinkTab, (tab: BacklinkTab) => void] {
  return useTabParam<BacklinkTab>(DEFAULT_BACKLINK_TAB, BACKLINK_TABS, paramName);
}
