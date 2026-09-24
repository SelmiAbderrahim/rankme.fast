import { useTabParam } from '@shared/hooks/useTabParam';
import type { RuleBucket } from './types';

export const REPORT_TABS = ['fix-now', 'watch', 'passed'] as const;
export type ReportTab = (typeof REPORT_TABS)[number];
export const DEFAULT_REPORT_TAB: ReportTab = 'fix-now';

export function isReportTab(value: unknown): value is ReportTab {
  return typeof value === 'string' && (REPORT_TABS as readonly string[]).includes(value);
}

/**
 * `?bucket=` state per `.claude/rules/url-tab-state.md` — default fix-now,
 * `replace: true` on switch, invalid values fall back to the default.
 *
 * Report bucket tabs use `?bucket=` (not `?tab=`) so they never collide with
 * the outer site-workspace `?tab=` param when ReportPage is embedded under
 * `/sites/:siteId?tab=report`.
 */
export function useReportTab(): [ReportTab, (tab: ReportTab) => void] {
  return useTabParam<ReportTab>(DEFAULT_REPORT_TAB, REPORT_TABS, 'bucket');
}

export function bucketForTab(tab: ReportTab): RuleBucket {
  return tab;
}
