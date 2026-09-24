import type { z } from 'zod';
import type { ReportCatalogDescriptor, ReportBrandingSnapshot, ReportDocumentV1, ReportExportAdapterResult, ReportFormat, ReportKindId, ReportLocale, ReportRenderedResult, ReportDownloadHeaders, ReportSelection, ReportSourceTarget, } from '../../shared/report-exports/index.js';
export interface ReportExportCapabilityDto {
    kind: ReportKindId;
    kindVersion: number;
    classification: ReportCatalogDescriptor['classification'];
    targetScope: ReportCatalogDescriptor['targetScope'];
    formats: ReportFormat[];
    share: {
        eligible: boolean;
        formats: Array<'view' | 'pdf' | 'csv'>;
    };
    brandingModes: Array<'rankmefast' | 'white_label'>;
    bounds: {
        selectedItems: number;
        pdfItems: number | null;
        csvRows: number | null;
        narrowingFields: string[];
    };
    title: string;
    description: string;
    bound: string;
}
export interface ReportExportCapabilitiesDto {
    enabled: boolean;
    kinds: ReportExportCapabilityDto[];
}
export type ReportExportAccessPurpose = 'create' | 'persist' | 'read' | 'download';
export interface ReportExportAccessContext {
    accountId: string;
    actorUserId: string;
    purpose: ReportExportAccessPurpose;
    target: ReportSourceTarget;
    format: ReportFormat;
    locale: ReportLocale;
    sourceVersion?: string;
}
export interface ReportExportComposeContext extends Omit<ReportExportAccessContext, 'purpose' | 'sourceVersion'> {
    selection: ReportSelection;
    branding: ReportBrandingSnapshot;
}
export interface ReportExportRenderContext {
    document: ReportDocumentV1;
    format: ReportFormat;
    snapshotCreatedAt: string;
}
/**
 * Source adapters read persisted feature data through that feature's public
 * API. They never enqueue, meter, refresh, or call a provider.
 */
export interface ReportExportAdapter<TSelection extends ReportSelection = ReportSelection> {
    kind: ReportKindId;
    kindVersion: number;
    supportedFormats: readonly ReportFormat[];
    selectionSchema: z.ZodType<TSelection, z.ZodTypeDef, unknown>;
    assertAccess(context: ReportExportAccessContext): Promise<void>;
    compose(context: Omit<ReportExportComposeContext, 'selection'> & {
        selection: TSelection;
    }): Promise<ReportExportAdapterResult>;
    render(context: ReportExportRenderContext): Promise<ReportRenderedResult>;
}
export interface ReportExportSnapshotSummaryDto {
    id: string;
    kind: ReportKindId;
    format: ReportFormat;
    locale: ReportLocale;
    title: string;
    schemaVersion: number;
    kindVersion: number;
    completeness: ReportDocumentV1['completeness'];
    sourceDates: ReportDocumentV1['sourceDates'];
    createdAt: string;
    expiresAt: string;
}
export interface ReportExportSnapshotDetailDto extends ReportExportSnapshotSummaryDto {
    document: ReportDocumentV1;
}
export interface ReportExportListDto {
    items: ReportExportSnapshotSummaryDto[];
    nextCursor: string | null;
}
export interface ReportExportShareCenterItemDto {
    id: string;
    snapshotId: string;
    formats: ReportPublicFormat[];
    expiresAt: string;
    revokedAt: string | null;
    accessCount: number;
    lastAccessedAt: string | null;
    createdAt: string;
    snapshot: null | Pick<ReportExportSnapshotSummaryDto, 'id' | 'kind' | 'locale' | 'title' | 'expiresAt'>;
}
export interface ReportExportShareCenterListDto {
    items: ReportExportShareCenterItemDto[];
    nextCursor: string | null;
}
export interface ReportExportDownload {
    snapshotId: string;
    kind: ReportKindId;
    format: ReportFormat;
    locale: ReportLocale;
    filename: string;
    contentDisposition: string;
    mediaType: string;
    headers: ReportDownloadHeaders;
    bytes: Buffer;
}
export type ReportPublicFormat = 'view' | 'pdf' | 'csv';
export interface PublicReportDto {
    schemaVersion: number;
    kindVersion: number;
    kind: ReportDocumentV1['kind'];
    locale: ReportLocale;
    title: string;
    subject: ReportDocumentV1['subject'];
    selection: ReportDocumentV1['selection'];
    sourceDates: Array<Omit<ReportDocumentV1['sourceDates'][number], 'id' | 'sourceNoteKey'>>;
    completeness: ReportDocumentV1['completeness'];
    branding: ReportDocumentV1['branding'];
    /** Canonical block allowlist with persistence/reference ids removed. */
    blocks: Array<Record<string, unknown>>;
    formats: ReportPublicFormat[];
    expiresAt: string;
}
export interface PublicReportFile {
    snapshotId: string;
    kind: ReportDocumentV1['kind'];
    format: Exclude<ReportPublicFormat, 'view'>;
    locale: ReportLocale;
    headers: ReportDownloadHeaders;
    bytes: Buffer;
}
