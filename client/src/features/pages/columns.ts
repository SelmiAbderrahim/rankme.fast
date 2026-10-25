import { useCallback, useMemo, useState } from 'react';
import type { PagesEnvelope, PagesSourceCapabilities } from './types';
import type { PagesMetricKey } from './formatters';

export const PAGES_METRIC_COLUMNS: PagesMetricKey[] = [
  'clicks', 'impressions', 'ctr', 'averagePosition', 'bestPosition',
  'keywordCount', 'searchVolume', 'difficulty', 'estimatedTraffic',
];
export type PagesColumnId = 'source' | 'crawl' | 'insights' | PagesMetricKey | 'associatedQueryCount' | 'positionChange';
export const PAGES_TOGGLEABLE_COLUMNS: PagesColumnId[] = [
  'source', 'crawl', 'insights', ...PAGES_METRIC_COLUMNS, 'associatedQueryCount', 'positionChange',
];
export type PagesColumnOverrides = Partial<Record<PagesColumnId, boolean>>;
export type PagesColumnVisibility = Record<PagesColumnId, boolean>;
export const PAGES_COLUMNS_STORAGE_KEY = 'rmf.pages.columns.v1';

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null; }
  catch { return null; }
}

export function readPagesColumnOverrides(): PagesColumnOverrides {
  const saved = storage();
  if (!saved) return {};
  try {
    const parsed: unknown = JSON.parse(saved.getItem(PAGES_COLUMNS_STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const overrides: PagesColumnOverrides = {};
    for (const key of PAGES_TOGGLEABLE_COLUMNS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'boolean') overrides[key] = value;
    }
    return overrides;
  } catch { return {}; }
}

export function writePagesColumnOverrides(overrides: PagesColumnOverrides): void {
  const saved = storage();
  if (!saved) return;
  try {
    if (Object.keys(overrides).length === 0) saved.removeItem(PAGES_COLUMNS_STORAGE_KEY);
    else saved.setItem(PAGES_COLUMNS_STORAGE_KEY, JSON.stringify(overrides));
  } catch { /* The current choice still works when storage is blocked. */ }
}

export function isPagesColumnAvailable(column: PagesColumnId, capabilities: PagesSourceCapabilities): boolean {
  return !PAGES_METRIC_COLUMNS.includes(column as PagesMetricKey)
    || capabilities.metricAvailability[column as PagesMetricKey];
}

export function defaultPagesColumnVisibility(
  envelope: PagesEnvelope,
  capabilities: PagesSourceCapabilities,
): PagesColumnVisibility {
  const measured = capabilities.coverage.measuredPages > 0;
  const visibility = {
    source: true, crawl: true, insights: true,
    associatedQueryCount: measured,
    positionChange: envelope.comparison.previousObservedAt !== null,
  } as PagesColumnVisibility;
  for (const metric of PAGES_METRIC_COLUMNS) visibility[metric] = measured && capabilities.metricAvailability[metric];
  return visibility;
}

export interface PagesColumnsController {
  visibility: PagesColumnVisibility;
  customized: boolean;
  setVisible: (column: PagesColumnId, visible: boolean) => void;
  reset: () => void;
}

export function usePagesColumns(envelope: PagesEnvelope, capabilities: PagesSourceCapabilities): PagesColumnsController {
  const [overrides, setOverrides] = useState<PagesColumnOverrides>(readPagesColumnOverrides);
  const defaults = useMemo(() => defaultPagesColumnVisibility(envelope, capabilities), [envelope, capabilities]);
  const visibility = useMemo(() => {
    const next = { ...defaults };
    for (const key of PAGES_TOGGLEABLE_COLUMNS) {
      next[key] = isPagesColumnAvailable(key, capabilities) && (overrides[key] ?? defaults[key]);
    }
    return next;
  }, [capabilities, defaults, overrides]);
  const setVisible = useCallback((column: PagesColumnId, visible: boolean) => {
    setOverrides((current) => {
      const next = { ...current, [column]: visible };
      writePagesColumnOverrides(next);
      return next;
    });
  }, []);
  const reset = useCallback(() => { writePagesColumnOverrides({}); setOverrides({}); }, []);
  return { visibility, customized: Object.keys(overrides).length > 0, setVisible, reset };
}
