import { useCallback, useMemo, useState } from 'react';
import type { PagesEnvelope, PagesSourceCapabilities } from './types';
import type { PagesMetricKey } from './formatters';

/**
 * Column visibility for the Pages table. Page and Actions are
 * always shown; everything else can be toggled from the column picker.
 *
 * Defaults come from the source and the whole result set, never from the rows
 * that happen to be on screen: a metric the current source cannot fill, or any
 * metric when nothing is measured, starts hidden so a GSC site does not see
 * four empty ranking-estimate columns. Because the defaults ignore the current
 * page, filter, and sort, columns do not appear or vanish as the user searches
 * or pages. An explicit choice in the picker is
 * a per-viewer convenience kept in localStorage; it always wins over the
 * default and survives reloads, but losing it (private mode, cleared site
 * data) only brings the defaults back.
 */
export const PAGES_METRIC_COLUMNS: PagesMetricKey[] = [
  'clicks',
  'impressions',
  'ctr',
  'averagePosition',
  'bestPosition',
  'keywordCount',
  'searchVolume',
  'difficulty',
  'estimatedTraffic',
];

export type PagesColumnId =
  | 'source'
  | 'crawl'
  | 'insights'
  | PagesMetricKey
  | 'associatedQueryCount'
  | 'positionChange';

export const PAGES_TOGGLEABLE_COLUMNS: PagesColumnId[] = [
  'source',
  'crawl',
  'insights',
  ...PAGES_METRIC_COLUMNS,
  'associatedQueryCount',
  'positionChange',
];

export type PagesColumnOverrides = Partial<Record<PagesColumnId, boolean>>;
export type PagesColumnVisibility = Record<PagesColumnId, boolean>;

export const PAGES_COLUMNS_STORAGE_KEY = 'rmf.pages.columns.v1';

const safeStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function readPagesColumnOverrides(): PagesColumnOverrides {
  const storage = safeStorage();
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PAGES_COLUMNS_STORAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const overrides: PagesColumnOverrides = {};
    for (const id of PAGES_TOGGLEABLE_COLUMNS) {
      const value = (parsed as Record<string, unknown>)[id];
      if (typeof value === 'boolean') overrides[id] = value;
    }
    return overrides;
  } catch {
    return {};
  }
}

export function writePagesColumnOverrides(overrides: PagesColumnOverrides): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    if (Object.keys(overrides).length === 0) storage.removeItem(PAGES_COLUMNS_STORAGE_KEY);
    else storage.setItem(PAGES_COLUMNS_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // A full or blocked quota only means the choice will not survive a reload.
  }
}

/** A metric column is available only when the current source can fill it. */
export function isPagesColumnAvailable(
  column: PagesColumnId,
  capabilities: PagesSourceCapabilities,
): boolean {
  return !(PAGES_METRIC_COLUMNS as readonly PagesColumnId[]).includes(column)
    || capabilities.metricAvailability[column as PagesMetricKey];
}

export function defaultPagesColumnVisibility(
  envelope: PagesEnvelope,
  capabilities: PagesSourceCapabilities,
): PagesColumnVisibility {
  const anyMeasured = capabilities.coverage.measuredPages > 0;
  const visibility = {
    source: true,
    crawl: true,
    insights: true,
    associatedQueryCount: anyMeasured,
    positionChange: envelope.comparison.previousObservedAt !== null,
  } as PagesColumnVisibility;
  for (const metric of PAGES_METRIC_COLUMNS) {
    visibility[metric] = anyMeasured && capabilities.metricAvailability[metric];
  }
  return visibility;
}

export interface PagesColumnsController {
  visibility: PagesColumnVisibility;
  customized: boolean;
  setVisible: (column: PagesColumnId, visible: boolean) => void;
  reset: () => void;
}

export function usePagesColumns(
  envelope: PagesEnvelope,
  capabilities: PagesSourceCapabilities,
): PagesColumnsController {
  const [overrides, setOverrides] = useState<PagesColumnOverrides>(readPagesColumnOverrides);
  const defaults = useMemo(
    () => defaultPagesColumnVisibility(envelope, capabilities),
    [envelope, capabilities],
  );
  const visibility = useMemo(() => {
    const merged = { ...defaults };
    for (const id of PAGES_TOGGLEABLE_COLUMNS) {
      merged[id] = isPagesColumnAvailable(id, capabilities) && (overrides[id] ?? defaults[id]);
    }
    return merged;
  }, [capabilities, defaults, overrides]);

  const setVisible = useCallback((column: PagesColumnId, visible: boolean) => {
    setOverrides((current) => {
      const next = { ...current, [column]: visible };
      writePagesColumnOverrides(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    writePagesColumnOverrides({});
    setOverrides({});
  }, []);

  return {
    visibility,
    customized: Object.keys(overrides).length > 0,
    setVisible,
    reset,
  };
}
