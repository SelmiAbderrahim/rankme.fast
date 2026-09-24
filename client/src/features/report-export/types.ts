import type { SupportedLocale } from '@shared/i18n';

export type ReportFormat = 'pdf' | 'csv' | 'json' | 'md' | 'jsonld' | 'txt';
export type PublicReportFormat = 'view' | 'pdf' | 'csv';
export type ReportTarget =
  | { scope: 'site'; siteId: string }
  | { scope: 'site_resource'; siteId: string; resourceId: string }
  | { scope: 'account_resource'; resourceId: string; siteId?: string };
/** Arbitrary view narrowing is validated against the selected report kind. */
export type ReportViewFilters = object;

export interface ReportExportCapability {
  kind: string;
  kindVersion: number;
  classification: 'report' | 'dataset' | 'native_artifact';
  targetScope: ReportTarget['scope'];
  formats: ReportFormat[];
  share: { eligible: boolean; formats: PublicReportFormat[] };
  brandingModes: Array<'rankmefast' | 'white_label'>;
  bounds: {
    selectedItems: number;
    pdfItems: number | null;
    csvRows: number | null;
    narrowingFields: string[];
  };
  title: string;
  titleKey: string;
  description: string;
  descriptionKey: string;
  bound: string;
  boundKey: string;
}

export interface ReportExportCapabilities {
  enabled: boolean;
  kinds: ReportExportCapability[];
}

export interface ReportSourceDate {
  id?: string;
  label: string;
  kind: string;
  observedAt?: string;
  from?: string;
  to?: string;
  freshness?: string;
}

export interface ReportSnapshotSummary {
  id: string;
  kind: string;
  format: ReportFormat;
  locale: SupportedLocale;
  title: string;
  schemaVersion: number;
  kindVersion: number;
  completeness: {
    state: 'complete';
    selectedItems: number;
    representedItems: number;
    bound: string;
  };
  sourceDates: ReportSourceDate[];
  createdAt: string;
  expiresAt: string;
}

export interface ReportSnapshotPage {
  items: ReportSnapshotSummary[];
  nextCursor: string | null;
}

export interface CreateReportSnapshotInput {
  kind: string;
  format: ReportFormat;
  target: ReportTarget;
  selection: ReportViewFilters;
  locale?: SupportedLocale;
  brandingMode?: 'rankmefast' | 'white_label';
}

export interface ReportScalar {
  type: 'string' | 'number' | 'date' | 'url' | 'boolean' | 'null' | 'unavailable';
  value: string | number | boolean | null;
  reason?: string;
}

export interface ReportTableData {
  columns: Array<{ key: string; label: string; unit?: string }>;
  rows: Array<{
    id?: string;
    cells: Array<{ columnKey: string; value: ReportScalar }>;
  }>;
}

export type PublicReportBlock =
  | { type: 'heading'; id?: string; level: number; text: string }
  | { type: 'prose'; id?: string; tone: string; text: string }
  | {
      type: 'kpi_group' | 'key_value';
      id?: string;
      items: Array<{ id?: string; label: string; value: ReportScalar; unit?: string }>;
    }
  | {
      type: 'findings';
      id?: string;
      items: Array<{
        id?: string;
        ruleKey: string;
        bucket: string;
        severity: string;
        title: string;
        why: string;
        fix?: string;
        pass?: string;
        affectedUrls: string[];
        evidence: string[];
      }>;
    }
  | ({ type: 'table'; id?: string } & ReportTableData)
  | {
      type: 'time_series';
      id?: string;
      series: Array<{ id?: string; label: string }>;
      tableFallback: ReportTableData;
    }
  | {
      type: 'source_note';
      id?: string;
      sourceDateId?: string;
      methodology: string;
      coverageWarning?: string;
    }
  | { type: 'state'; id?: string; state: 'empty' | 'unavailable'; reason: string }
  | { type: 'native_artifact'; id?: string; artifactId?: string };

export interface PublicReport {
  schemaVersion: number;
  kindVersion: number;
  kind: string;
  locale: SupportedLocale;
  title: string;
  subject: Array<{ label: string; value: string }>;
  selection: Array<{ label: string; value: string }>;
  sourceDates: ReportSourceDate[];
  completeness: ReportSnapshotSummary['completeness'];
  branding: {
    mode: 'rankmefast' | 'white_label';
    companyName: string;
    accentColor: string;
    logo: null | { mediaType: 'image/png'; bytesBase64: string; width: number; height: number };
  };
  blocks: PublicReportBlock[];
  formats: PublicReportFormat[];
  expiresAt: string;
}

export interface ReportShareSummary {
  id: string;
  snapshotId: string;
  formats: PublicReportFormat[];
  expiresAt: string;
  revokedAt: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
}

export interface CreatedReportShare extends ReportShareSummary {
  url: string;
}

export interface ReportShareCenterItem extends ReportShareSummary {
  snapshot: null | Pick<
    ReportSnapshotSummary,
    'id' | 'kind' | 'locale' | 'title' | 'expiresAt'
  >;
}

export interface ReportShareCenterPage {
  items: ReportShareCenterItem[];
  nextCursor: string | null;
}

export interface ReportShareLoaderContext {
  apiOrigin?: string;
}

export interface ReportExportState {
  capabilities: ReportExportCapability[];
  enabled: boolean;
  capabilitiesLoading: boolean;
  capabilitiesLoaded: boolean;
  capabilitiesError: string;
  snapshots: ReportSnapshotSummary[];
  snapshotsCursor: string | null;
  snapshotsLoading: boolean;
  snapshotsLoaded: boolean;
  snapshotsError: string;
  shares: ReportShareCenterItem[];
  sharesCursor: string | null;
  sharesLoading: boolean;
  sharesLoaded: boolean;
  sharesError: string;
  activeOperation: string | null;
  operationError: string;
}
