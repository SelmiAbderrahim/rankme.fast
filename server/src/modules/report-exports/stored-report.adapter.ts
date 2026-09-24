import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { REPORT_DOCUMENT_SCHEMA, REPORT_DOCUMENT_SCHEMA_VERSION, REPORT_GLOBAL_BOUNDS, REPORT_NATIVE_MEDIA_TYPES, getReportCatalogDescriptor, renderReportDocument, reportCatalogCopy, reportCopy, reportSourceDate, reportSourceNote, reportSourceVersion, reportTable, stableReportJson, stableSortText, type ReportBlockV1, type ReportCatalogDescriptor, type ReportDocumentV1, type ReportExportAdapterResult, type ReportFormat, type ReportJsonValue, type ReportKindId, type ReportRenderedResult, type ReportSelection, type ReportSourceTarget, type ReportTableRowInput, } from '../../shared/report-exports/index.js';
import { serializeJsonLd } from '../../shared/security/json-ld.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { TranslationKey } from '../../shared/i18n/errors.js';
import type { ReportExportAccessContext, ReportExportAdapter, ReportExportComposeContext, } from './report-exports.types.js';
export type StoredReportProvenance = 'observation' | 'derived' | 'generated';
export interface StoredReportRecord {
    id: string;
    recordType: string;
    key: string;
    label?: string | null;
    value?: string | number | boolean | null;
    details?: ReportJsonValue | string | null;
    state?: string | null;
    observedAt?: string | null;
    provenance: StoredReportProvenance;
}
export interface StoredNativeArtifact {
    format: 'md' | 'jsonld';
    label: string;
    /** Markdown text or the exact JSON-LD object to serialize through the allowlist serializer. */
    value: string | Record<string, unknown>;
}
export interface LoadedStoredReport {
    siteLabel: string;
    observedAt: string;
    sourceVersionValue: unknown;
    records: readonly StoredReportRecord[];
    /** Logical selected source items; metadata rows do not inflate catalog bounds. */
    selectedItems?: number;
    subject?: readonly {
        label: string;
        value: string;
    }[];
    artifact?: StoredNativeArtifact;
}
interface StoredReportAdapterConfig<TSelection extends ReportSelection> {
    kind: ReportKindId;
    localizationStem: string;
    formats: readonly ReportFormat[];
    selectionSchema: z.ZodType<TSelection, z.ZodTypeDef, unknown>;
    access(context: ReportExportAccessContext): Promise<unknown>;
    load(context: Omit<ReportExportComposeContext, 'selection'> & {
        selection: TSelection;
    }): Promise<LoadedStoredReport>;
}
function sourceDateId(provenance: StoredReportProvenance): string {
    return `stored-${provenance}`;
}
function boundedValue(value: unknown): string {
    const rendered = typeof value === 'string' ? value : stableReportJson(value);
    return rendered.length <= 900
        ? rendered
        : `${reportSourceVersion('selection', value)} (${Buffer.byteLength(rendered, 'utf8')} bytes)`;
}
function selectionItems(locale: ReportDocumentV1['locale'], selection: ReportSelection): ReportDocumentV1['selection'] {
    return Object.keys(selection).sort(stableSortText).map((key, index) => ({
        label: `${reportCopy(locale, 'fields.selection')} ${index + 1}`,
        value: boundedValue({ [key]: selection[key] }),
    }));
}
function recordRows(records: readonly StoredReportRecord[]): ReportTableRowInput[] {
    return records.map((record, index) => ({
        id: `stored-row-${index + 1}`,
        values: [
            record.recordType,
            record.key,
            record.label ?? null,
            record.value ?? null,
            typeof record.details === 'string'
                ? record.details
                : record.details == null
                    ? ''
                    : stableReportJson(record.details),
            record.state ?? null,
            record.observedAt ?? null,
            record.provenance,
        ],
        sourceDateId: sourceDateId(record.provenance),
    }));
}
function table(locale: ReportDocumentV1['locale'], records: readonly StoredReportRecord[]) {
    return reportTable({
        id: 'stored-records',
        columns: [
            { key: 'recordType', label: reportCopy(locale, 'fields.recordType'), valueType: 'string' },
            { key: 'key', label: reportCopy(locale, 'fields.label'), valueType: 'string' },
            { key: 'label', label: reportCopy(locale, 'fields.context'), valueType: 'string' },
            { key: 'value', label: reportCopy(locale, 'fields.value'), valueType: 'string' },
            { key: 'details', label: reportCopy(locale, 'fields.details'), valueType: 'string' },
            { key: 'state', label: reportCopy(locale, 'fields.status'), valueType: 'string' },
            { key: 'observedAt', label: reportCopy(locale, 'fields.observedAt'), valueType: 'string' },
            { key: 'provenance', label: reportCopy(locale, 'fields.provenance'), valueType: 'string' },
        ],
        rows: recordRows(records),
    });
}
function nativeText(artifact: StoredNativeArtifact): string {
    if (artifact.format === 'md') {
        if (typeof artifact.value !== 'string')
            throw new TypeError('markdown artifact must be text');
        return artifact.value;
    }
    if (typeof artifact.value === 'string')
        throw new TypeError('JSON-LD artifact must be an object');
    return serializeJsonLd(artifact.value);
}
function nativeBlocks(locale: ReportDocumentV1['locale'], artifact: StoredNativeArtifact): {
    blocks: ReportBlockV1[];
    artifacts: ReportDocumentV1['artifacts'];
} {
    const text = nativeText(artifact);
    const bytes = Buffer.from(text, 'utf8');
    const descriptor = {
        id: 'native-artifact',
        label: artifact.label,
        format: artifact.format,
        mediaType: REPORT_NATIVE_MEDIA_TYPES[artifact.format],
        extension: artifact.format,
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        validation: 'valid' as const,
    };
    return {
        artifacts: [descriptor],
        blocks: [
            reportTable({
                id: 'native-artifact-source',
                columns: [{ key: 'content', label: reportCopy(locale, 'fields.value'), valueType: 'string' }],
                rows: [{ id: 'native-artifact-content', values: [text], sourceDateId: 'stored-generated' }],
            }),
            { type: 'native_artifact', id: 'native-artifact-block', artifactId: descriptor.id },
        ],
    };
}
function requireStoredReportDescriptor(kind: string): ReportCatalogDescriptor {
    const descriptor = getReportCatalogDescriptor(kind);
    if (!descriptor)
        throw new Error(`missing report descriptor: ${kind}`);
    return descriptor;
}
function assertStoredReportBounds(descriptor: ReportCatalogDescriptor, format: ReportFormat, selectedItems: number, representedRecords: number): void {
    const formatBound = format === 'pdf'
        ? descriptor.bounds.pdfItems
        : descriptor.bounds.selectedItems;
    const representationBound = format === 'pdf'
        ? REPORT_GLOBAL_BOUNDS.pdfItems
        : format === 'csv'
            ? REPORT_GLOBAL_BOUNDS.csvRows
            : Number.POSITIVE_INFINITY;
    if ((formatBound !== null && selectedItems > formatBound) ||
        representedRecords > representationBound) {
        throw HttpError.badRequest({ code: 'REPORT_EXPORTS_ERRORS_SELECTION_TOO_LARGE', messageKey: 'reportExports.errors.selectionTooLarge' });
    }
}
function renderNative(document: ReportDocumentV1, format: ReportFormat): ReportRenderedResult {
    if (format !== 'md' && format !== 'jsonld')
        throw new TypeError('unsupported native format');
    const block = document.blocks.find((candidate) => candidate.type === 'table' && candidate.id === 'native-artifact-source');
    const scalar = block?.type === 'table' ? block.rows[0]?.cells[0]?.value : undefined;
    if (!scalar || scalar.type !== 'string')
        throw new TypeError('canonical native artifact is missing');
    return {
        format,
        mediaType: REPORT_NATIVE_MEDIA_TYPES[format],
        extension: format,
        bytes: Buffer.from(scalar.value, 'utf8'),
    };
}
export function createStoredReportAdapter<TSelection extends ReportSelection>(config: StoredReportAdapterConfig<TSelection>): ReportExportAdapter<TSelection> {
    return {
        kind: config.kind,
        kindVersion: 1,
        supportedFormats: config.formats,
        selectionSchema: config.selectionSchema,
        async assertAccess(context) {
            const value = await config.access(context);
            const sourceVersion = reportSourceVersion(config.kind, value);
            if (context.purpose === 'persist' &&
                context.sourceVersion &&
                context.sourceVersion !== sourceVersion) {
                throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
            }
        },
        async compose(context): Promise<ReportExportAdapterResult> {
            const loaded = await config.load(context);
            const descriptor = requireStoredReportDescriptor(config.kind);
            const selectedItems = loaded.selectedItems ?? loaded.records.length;
            assertStoredReportBounds(descriptor, context.format, selectedItems, loaded.records.length);
            const sourceDates = (['observation', 'derived', 'generated'] as const).map((kind) => reportSourceDate({
                id: sourceDateId(kind),
                label: reportCopy(context.locale, kind === 'observation'
                    ? 'sources.storedObservation'
                    : kind === 'derived'
                        ? 'sources.storedDerived'
                        : 'sources.storedGenerated'),
                kind: kind === 'observation' ? 'provider_observation' : kind,
                observedAt: loaded.observedAt,
                sourceNoteKey: `stored.${kind}`,
                freshness: 'unknown',
            }));
            const artifactParts = loaded.artifact
                ? nativeBlocks(context.locale, loaded.artifact)
                : { blocks: [] as ReportBlockV1[], artifacts: [] as ReportDocumentV1['artifacts'] };
            if ((context.format === 'md' || context.format === 'jsonld') && !loaded.artifact) {
                throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_INVALID_ARTIFACT', messageKey: 'reportExports.errors.invalidArtifact' });
            }
            const notes: ReportBlockV1[] = [
                reportSourceNote({ id: 'stored-observation-note', sourceDateId: 'stored-observation', methodology: reportCopy(context.locale, 'notes.storedObservation') }),
                reportSourceNote({ id: 'stored-derived-note', sourceDateId: 'stored-derived', methodology: reportCopy(context.locale, 'notes.storedDerived') }),
                reportSourceNote({ id: 'stored-generated-note', sourceDateId: 'stored-generated', methodology: reportCopy(context.locale, 'notes.storedGenerated') }),
            ];
            const document: ReportDocumentV1 = {
                schema: REPORT_DOCUMENT_SCHEMA,
                schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
                kind: config.kind,
                kindVersion: 1,
                locale: context.locale,
                title: reportCatalogCopy(context.locale, config.localizationStem, 'title'),
                subject: [
                    { label: reportCopy(context.locale, 'fields.site'), value: loaded.siteLabel },
                    ...(loaded.subject ?? []),
                ],
                selection: selectionItems(context.locale, context.selection),
                sourceDates,
                completeness: {
                    state: 'complete',
                    selectedItems,
                    representedItems: selectedItems,
                    bound: reportCatalogCopy(context.locale, config.localizationStem, 'bound'),
                },
                branding: context.branding,
                blocks: [table(context.locale, loaded.records), ...artifactParts.blocks, ...notes],
                artifacts: artifactParts.artifacts,
            };
            return {
                document,
                sourceVersion: reportSourceVersion(config.kind, loaded.sourceVersionValue),
            };
        },
        render: ({ document, format, snapshotCreatedAt }) => renderReportDocument({
            document,
            format,
            snapshotCreatedAt,
            ...(format === 'md' || format === 'jsonld'
                ? { renderNative: async () => renderNative(document, format) }
                : {}),
        }),
    };
}
export function storedRecord(recordType: string, key: string, details: ReportJsonValue | string, provenance: StoredReportProvenance, input: Partial<Omit<StoredReportRecord, 'recordType' | 'key' | 'details' | 'provenance'>> = {}): StoredReportRecord {
    return { id: input.id ?? `${recordType}:${key}`, recordType, key, details, provenance, ...input };
}
export function assertSiteResourceTarget(target: ReportSourceTarget, notFoundKey: TranslationKey = 'reportExports.errors.notFound'): asserts target is Extract<ReportSourceTarget, {
    scope: 'site_resource';
}> {
    if (target.scope !== 'site_resource')
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: notFoundKey });
}
export function assertSiteTarget(target: ReportSourceTarget, notFoundKey: TranslationKey = 'reportExports.errors.notFound'): asserts target is Extract<ReportSourceTarget, {
    scope: 'site';
}> {
    if (target.scope !== 'site')
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: notFoundKey });
}
export const storedReportAdapterTestables = Object.freeze({
    sourceDateId,
    boundedValue,
    selectionItems,
    recordRows,
    table,
    nativeText,
    nativeBlocks,
    requireStoredReportDescriptor,
    assertStoredReportBounds,
    renderNative,
});
