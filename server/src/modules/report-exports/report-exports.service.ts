import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { REPORT_DOCUMENT_SCHEMA_VERSION, REPORT_GLOBAL_BOUNDS, REPORT_SNAPSHOT_TTL_DAYS, ReportRenderRefusal, assertReportDocumentRenderable, createReportDownloadHeaders, createSafeReportFilename, getReportCatalogDescriptor, renderReportDocument, reportBrandingSnapshotSchema, reportDocumentV1Schema, reportExportAdapterResultSchema, stableReportJson as serializeStableReportJson, type ReportBrandingSnapshot, type ReportDocumentV1, type ReportFormat, type ReportLocale, type ReportSourceTarget, } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { TranslationKey } from '../../shared/i18n/errors.js';
import { BRANDING_LOGO_MAX_OUTPUT_BYTES, User, assertCompletePngEnvelope, resolveStoredUserBranding, } from '../users/index.js';
import { ReportExportSnapshot } from './report-export-snapshot.model.js';
import { getReportExportAdapterRegistry, } from './report-exports.holder.js';
import type { CreateReportExportBody, ListReportExportsQuery, } from './report-exports.schema.js';
import type { ReportExportAdapter, ReportExportDownload, ReportExportListDto, ReportExportSnapshotDetailDto, ReportExportSnapshotSummaryDto, PublicReportDto, PublicReportFile, ReportPublicFormat, } from './report-exports.types.js';
const SNAPSHOT_PURGE_DELAY_MS = 24 * 60 * 60 * 1000;
const MAX_DOWNLOAD_COUNT = 1000000;
const FORBIDDEN_PUBLIC_IDENTIFIER = /^(?:[a-f0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/iu;
const PUBLIC_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const RANKMEFAST_BRANDING: ReportBrandingSnapshot = Object.freeze({
    mode: 'rankmefast',
    companyName: 'RankMeFast',
    accentColor: '#b5321e',
    logo: null,
});
export const REPORT_EXPORT_REFUSAL_CODES = [
    'unavailable',
    'adapter_unavailable',
    'unsupported_format',
    'target_not_found',
    'invalid_branding',
    'invalid_selection',
    'source_access_denied',
    'source_changed',
    'incomplete',
    'scope_too_large',
    'invalid_document',
    'invalid_output',
] as const;
export type ReportExportRefusalCode = (typeof REPORT_EXPORT_REFUSAL_CODES)[number];
interface SnapshotLean {
    _id: Types.ObjectId;
    accountId: Types.ObjectId;
    siteId: Types.ObjectId | null;
    createdByUserId: Types.ObjectId;
    targetScope: ReportSourceTarget['scope'];
    sourceResourceId: string | null;
    sourceVersion: string;
    kind: ReportDocumentV1['kind'];
    format: ReportFormat;
    locale: ReportLocale;
    schemaVersion: number;
    kindVersion: number;
    canonicalJson: string;
    canonicalBytes: number;
    contentHash: string;
    representedItems: number;
    expiresAt: Date;
    deletedAt: Date | null;
    purgeAt: Date | null;
    downloadCount: number;
    lastDownloadedAt: Date | null;
    createdAt: Date;
}
interface CreateReportExportInput extends CreateReportExportBody {
    accountId: string;
    actorUserId: string;
    requestLocale: ReportLocale;
}
interface SnapshotActorInput {
    accountId: string;
    actorUserId: string;
    snapshotId: string;
}
interface DeleteSnapshotInput extends SnapshotActorInput {
    canManageAll: boolean;
}
function reportExportError(status: number, message: TranslationKey, code: ReportExportRefusalCode): HttpError {
    return new HttpError(status, { code: 'MESSAGE', messageKey: message }, { code });
}
export function reportExportRefusalCode(error: unknown): ReportExportRefusalCode | null {
    if (!(error instanceof HttpError))
        return null;
    const details = error.details;
    if (details && typeof details === 'object' && 'code' in details) {
        const code = (details as {
            code?: unknown;
        }).code;
        if (typeof code === 'string' &&
            (REPORT_EXPORT_REFUSAL_CODES as readonly string[]).includes(code)) {
            return code as ReportExportRefusalCode;
        }
    }
    if (error.status === 403)
        return 'source_access_denied';
    if (error.status === 404)
        return 'target_not_found';
    if (error.status === 409)
        return 'source_changed';
    return null;
}
function unavailable(): HttpError {
    return reportExportError(503, 'reportExports.errors.unavailable', 'unavailable');
}
function notFound(): HttpError {
    return reportExportError(404, 'reportExports.errors.notFound', 'target_not_found');
}
function adapterUnavailable(): HttpError {
    return reportExportError(503, 'reportExports.errors.adapterUnavailable', 'adapter_unavailable');
}
function invalidBranding(): HttpError {
    return reportExportError(400, 'reportExports.errors.invalidBranding', 'invalid_branding');
}
export function stableReportJson(value: unknown): string {
    return serializeStableReportJson(value);
}
function sha256(value: string | Uint8Array): string {
    return createHash('sha256').update(value).digest('hex');
}
function targetSiteId(target: ReportSourceTarget): string | null {
    if (target.scope === 'account_resource')
        return target.siteId ?? null;
    return target.siteId;
}
function targetResourceId(target: ReportSourceTarget): string | null {
    return 'resourceId' in target ? target.resourceId : null;
}
function snapshotTarget(snapshot: SnapshotLean): ReportSourceTarget {
    const siteId = snapshot.siteId ? String(snapshot.siteId) : undefined;
    if (snapshot.targetScope === 'site' && siteId) {
        return { scope: 'site', siteId };
    }
    if (snapshot.targetScope === 'site_resource' &&
        siteId &&
        snapshot.sourceResourceId) {
        return {
            scope: 'site_resource',
            siteId,
            resourceId: snapshot.sourceResourceId,
        };
    }
    if (snapshot.targetScope === 'account_resource' && snapshot.sourceResourceId) {
        return {
            scope: 'account_resource',
            resourceId: snapshot.sourceResourceId,
            ...(siteId ? { siteId } : {}),
        };
    }
    throw HttpError.internal({ code: 'REPORT_EXPORTS_ERRORS_CORRUPTED', messageKey: 'reportExports.errors.corrupted' });
}
function activeSnapshotFilter(accountId: string, snapshotId: string, now: Date): Record<string, unknown> {
    return {
        _id: snapshotId,
        accountId,
        deletedAt: null,
        expiresAt: { $gt: now },
    };
}
async function loadActiveSnapshot(accountId: string, snapshotId: string, now = new Date()): Promise<SnapshotLean> {
    const snapshot = await ReportExportSnapshot.findOne(activeSnapshotFilter(accountId, snapshotId, now)).lean<SnapshotLean>();
    if (!snapshot)
        throw notFound();
    return snapshot;
}
function parseSnapshotDocument(snapshot: SnapshotLean): ReportDocumentV1 {
    try {
        const raw: unknown = JSON.parse(snapshot.canonicalJson);
        const parsed = reportDocumentV1Schema.parse(raw);
        const canonicalJson = stableReportJson(parsed);
        if (canonicalJson !== snapshot.canonicalJson ||
            Buffer.byteLength(canonicalJson, 'utf8') !== snapshot.canonicalBytes ||
            sha256(canonicalJson) !== snapshot.contentHash ||
            parsed.schemaVersion !== snapshot.schemaVersion ||
            parsed.kindVersion !== snapshot.kindVersion ||
            parsed.kind !== snapshot.kind ||
            parsed.locale !== snapshot.locale ||
            parsed.completeness.representedItems !== snapshot.representedItems) {
            throw new Error('snapshot integrity mismatch');
        }
        return parsed;
    }
    catch (error) {
        throw new HttpError(500, { code: 'REPORT_EXPORTS_ERRORS_CORRUPTED', messageKey: 'reportExports.errors.corrupted' }, undefined, { cause: error });
    }
}
function toSummary(snapshot: SnapshotLean, document = parseSnapshotDocument(snapshot)): ReportExportSnapshotSummaryDto {
    return {
        id: String(snapshot._id),
        kind: snapshot.kind,
        format: snapshot.format,
        locale: snapshot.locale,
        title: document.title,
        schemaVersion: snapshot.schemaVersion,
        kindVersion: snapshot.kindVersion,
        completeness: document.completeness,
        sourceDates: document.sourceDates,
        createdAt: snapshot.createdAt.toISOString(),
        expiresAt: snapshot.expiresAt.toISOString(),
    };
}
function toDetail(snapshot: SnapshotLean): ReportExportSnapshotDetailDto {
    const document = parseSnapshotDocument(snapshot);
    return { ...toSummary(snapshot, document), document };
}
function adapterForSnapshot(snapshot: SnapshotLean): ReportExportAdapter {
    const adapter = getReportExportAdapterRegistry().get(snapshot.kind);
    if (!adapter || adapter.kindVersion !== snapshot.kindVersion) {
        throw adapterUnavailable();
    }
    return adapter;
}
async function assertSnapshotAccess(snapshot: SnapshotLean, actorUserId: string, purpose: 'read' | 'download'): Promise<ReportExportAdapter> {
    const owner = await User.exists({
        _id: snapshot.accountId,
        deletionStartedAt: null,
    });
    if (!owner)
        throw notFound();
    const adapter = adapterForSnapshot(snapshot);
    try {
        await adapter.assertAccess({
            accountId: String(snapshot.accountId),
            actorUserId,
            purpose,
            target: snapshotTarget(snapshot),
            format: snapshot.format,
            locale: snapshot.locale,
            sourceVersion: snapshot.sourceVersion,
        });
    }
    catch (error) {
        if (error instanceof HttpError && error.status === 404) {
            const now = new Date();
            await ReportExportSnapshot.updateOne({ _id: snapshot._id, deletedAt: null }, { $set: { deletedAt: now, purgeAt: now } });
            const { ReportExportShare } = await import('./report-export-share.model.js');
            await ReportExportShare.updateMany({ snapshotId: snapshot._id, revokedAt: null }, { $set: { revokedAt: now, purgeAt: now } });
            throw notFound();
        }
        throw error;
    }
    return adapter;
}
async function resolveBranding(accountId: string, mode: CreateReportExportBody['brandingMode']): Promise<ReportBrandingSnapshot> {
    if (mode === 'rankmefast')
        return RANKMEFAST_BRANDING;
    const user = await User.findOne({ _id: accountId, deletionStartedAt: null })
        .select('branding')
        .lean();
    if (!user)
        throw notFound();
    const stored = resolveStoredUserBranding(user);
    const logoBytes = Buffer.from(stored.logoPngBase64, 'base64');
    const parsed = reportBrandingSnapshotSchema.safeParse({
        mode: 'white_label',
        companyName: stored.companyName.trim(),
        accentColor: stored.accentColor.toLowerCase(),
        logo: {
            mediaType: 'image/png',
            bytesBase64: stored.logoPngBase64,
            width: stored.logoWidth,
            height: stored.logoHeight,
            sha256: sha256(logoBytes),
        },
    });
    if (!parsed.success)
        throw invalidBranding();
    if (logoBytes.length > BRANDING_LOGO_MAX_OUTPUT_BYTES ||
        logoBytes.toString('base64') !== stored.logoPngBase64) {
        throw invalidBranding();
    }
    try {
        assertCompletePngEnvelope(logoBytes);
    }
    catch {
        throw invalidBranding();
    }
    return parsed.data;
}
function assertDocumentContract(result: unknown, input: CreateReportExportInput, branding: ReportBrandingSnapshot): {
    document: ReportDocumentV1;
    sourceVersion: string;
    canonicalJson: string;
} {
    const parsed = reportExportAdapterResultSchema.safeParse(result);
    if (!parsed.success) {
        const incomplete = parsed.error.issues.some((issue) => issue.message === 'reportExports.errors.incomplete');
        throw reportExportError(422, incomplete
            ? 'reportExports.errors.incomplete'
            : 'reportExports.errors.invalidDocument', incomplete ? 'incomplete' : 'invalid_document');
    }
    const { document, sourceVersion } = parsed.data;
    if (document.kind !== input.kind ||
        document.kindVersion !== getReportCatalogDescriptor(input.kind)?.kindVersion ||
        document.locale !== (input.locale ?? input.requestLocale) ||
        stableReportJson(document.branding) !== stableReportJson(branding)) {
        throw reportExportError(422, 'reportExports.errors.invalidDocument', 'invalid_document');
    }
    return { document, sourceVersion, canonicalJson: stableReportJson(document) };
}
function assertDocumentBounds(document: ReportDocumentV1, format: ReportFormat, canonicalJson: string): void {
    const descriptor = getReportCatalogDescriptor(document.kind)!;
    const items = document.completeness.representedItems;
    const formatItemLimit = format === 'csv'
        ? descriptor.bounds.csvRows!
        : format === 'pdf'
            ? descriptor.bounds.pdfItems!
            : null;
    const tooManyForFormat = formatItemLimit !== null && items > formatItemLimit;
    if (items > descriptor.bounds.selectedItems ||
        tooManyForFormat ||
        Buffer.byteLength(canonicalJson, 'utf8') >
            Math.min(descriptor.bounds.canonicalBytes, REPORT_GLOBAL_BOUNDS.canonicalBytes)) {
        throw reportExportError(422, 'reportExports.errors.scopeTooLarge', 'scope_too_large');
    }
}
function assertFormatRenderable(document: ReportDocumentV1, format: ReportFormat): void {
    try {
        assertReportDocumentRenderable(document, format);
    }
    catch (error) {
        throwRenderabilityFailure(error, document);
    }
}
function throwRenderabilityFailure(error: unknown, document: ReportDocumentV1): never {
    if (!(error instanceof ReportRenderRefusal))
        throw error;
    const descriptor = getReportCatalogDescriptor(document.kind)!;
    throw new HttpError(422, { code: 'VALIDATION_FAILED', messageKey: error.reason === 'scope_too_large'
            ? 'reportExports.errors.scopeTooLarge'
            : 'reportExports.errors.invalidRenderedResult' }, {
        code: error.reason,
        narrowingFields: descriptor.bounds.narrowingFields,
        selectedItems: document.completeness.selectedItems,
    });
}
function throwDownloadRenderFailure(error: unknown): never {
    if (error instanceof ReportRenderRefusal && error.reason === 'scope_too_large') {
        throw reportExportError(422, 'reportExports.errors.scopeTooLarge', 'scope_too_large');
    }
    throw reportExportError(422, 'reportExports.errors.invalidRenderedResult', 'invalid_output');
}
function nativeRenderer(adapter: ReportExportAdapter, document: ReportDocumentV1, format: ReportFormat, snapshotCreatedAt: string) {
    return adapter.render.bind(adapter, { document, format, snapshotCreatedAt });
}
export async function createReportExport(input: CreateReportExportInput): Promise<ReportExportSnapshotDetailDto> {
    if (!env.PUBLIC_EXPORTS_ENABLED)
        throw unavailable();
    const descriptor = getReportCatalogDescriptor(input.kind);
    if (!descriptor)
        throw adapterUnavailable();
    if (!descriptor.formats.includes(input.format)) {
        throw reportExportError(400, 'reportExports.errors.formatUnsupported', 'unsupported_format');
    }
    if (descriptor.targetScope !== input.target.scope)
        throw notFound();
    if (!descriptor.branding.modes.includes(input.brandingMode)) {
        throw invalidBranding();
    }
    const adapter = getReportExportAdapterRegistry().get(input.kind);
    if (!adapter)
        throw adapterUnavailable();
    const locale = input.locale ?? input.requestLocale;
    const access = {
        accountId: input.accountId,
        actorUserId: input.actorUserId,
        target: input.target,
        format: input.format,
        locale,
    } as const;
    await adapter.assertAccess({ ...access, purpose: 'create' });
    const selection = adapter.selectionSchema.safeParse(input.selection);
    if (!selection.success) {
        throw reportExportError(400, 'reportExports.errors.invalidSelection', 'invalid_selection');
    }
    const branding = await resolveBranding(input.accountId, input.brandingMode);
    const result = await adapter.compose({ ...access, selection: selection.data, branding });
    const validated = assertDocumentContract(result, input, branding);
    assertDocumentBounds(validated.document, input.format, validated.canonicalJson);
    assertFormatRenderable(validated.document, input.format);
    await adapter.assertAccess({
        ...access,
        purpose: 'persist',
        sourceVersion: validated.sourceVersion,
    });
    if (!env.PUBLIC_EXPORTS_ENABLED)
        throw unavailable();
    const now = new Date();
    const contentHash = sha256(validated.canonicalJson);
    const identity = {
        accountId: input.accountId,
        siteId: targetSiteId(input.target),
        targetScope: input.target.scope,
        sourceResourceId: targetResourceId(input.target),
        sourceVersion: validated.sourceVersion,
        kind: input.kind,
        format: input.format,
        locale,
        contentHash,
        deletedAt: null,
        expiresAt: { $gt: now },
    };
    let snapshot = await ReportExportSnapshot.findOne(identity).lean<SnapshotLean>();
    if (!snapshot) {
        const created = await ReportExportSnapshot.create({
            ...identity,
            expiresAt: new Date(now.getTime() + REPORT_SNAPSHOT_TTL_DAYS * 24 * 60 * 60 * 1000),
            createdAt: now,
            createdByUserId: input.actorUserId,
            schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
            kindVersion: descriptor.kindVersion,
            canonicalJson: validated.canonicalJson,
            canonicalBytes: Buffer.byteLength(validated.canonicalJson, 'utf8'),
            representedItems: validated.document.completeness.representedItems,
        });
        snapshot = created.toObject() as SnapshotLean;
    }
    return toDetail(snapshot);
}
export async function inspectReportExport(input: SnapshotActorInput): Promise<ReportExportSnapshotDetailDto> {
    const snapshot = await loadActiveSnapshot(input.accountId, input.snapshotId);
    await assertSnapshotAccess(snapshot, input.actorUserId, 'read');
    return toDetail(snapshot);
}
export async function listReportExports(input: Omit<SnapshotActorInput, 'snapshotId'> & ListReportExportsQuery & {
    allowedSiteIds?: readonly string[] | null;
}): Promise<ReportExportListDto> {
    const now = new Date();
    const filter: Record<string, unknown> = {
        accountId: input.accountId,
        deletedAt: null,
        expiresAt: { $gt: now },
        ...(input.cursor ? { _id: { $lt: new Types.ObjectId(input.cursor) } } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
        ...(input.format ? { format: input.format } : {}),
        ...(input.allowedSiteIds !== undefined && input.allowedSiteIds !== null
            ? { siteId: { $in: input.allowedSiteIds } }
            : {}),
    };
    const snapshots = await ReportExportSnapshot.find(filter)
        .sort({ _id: -1 })
        .limit(input.limit + 1)
        .lean<SnapshotLean[]>();
    const page = snapshots.slice(0, input.limit);
    const items: ReportExportSnapshotSummaryDto[] = [];
    for (const snapshot of page) {
        try {
            await assertSnapshotAccess(snapshot, input.actorUserId, 'read');
            items.push(toSummary(snapshot));
        }
        catch (error) {
            if (error instanceof HttpError && error.status === 404)
                continue;
            throw error;
        }
    }
    return {
        items,
        nextCursor: snapshots.length > input.limit && page.length > 0
            ? String(page[page.length - 1]?._id)
            : null,
    };
}
/** Resolve a stored export to its Site before any adapter read/render/delete. */
export async function resolveOwnedReportExportSiteId(accountId: string, snapshotId: string): Promise<string | null | undefined> {
    if (!Types.ObjectId.isValid(snapshotId))
        return undefined;
    const snapshot = await ReportExportSnapshot.findOne({
        _id: snapshotId,
        accountId,
    }).select({ siteId: 1 }).lean<{
        siteId: Types.ObjectId | null;
    }>();
    if (!snapshot)
        return undefined;
    return snapshot.siteId ? String(snapshot.siteId) : null;
}
export async function deleteReportExport(input: DeleteSnapshotInput): Promise<ReportExportSnapshotSummaryDto | null> {
    const now = new Date();
    const snapshot = await ReportExportSnapshot.findOne({
        _id: input.snapshotId,
        accountId: input.accountId,
        expiresAt: { $gt: now },
    }).lean<SnapshotLean>();
    if (!snapshot)
        throw notFound();
    if (!input.canManageAll &&
        String(snapshot.createdByUserId) !== input.actorUserId) {
        throw notFound();
    }
    if (snapshot.deletedAt)
        return null;
    await ReportExportSnapshot.updateOne({ _id: snapshot._id, deletedAt: null }, {
        $set: {
            deletedAt: now,
            purgeAt: new Date(now.getTime() + SNAPSHOT_PURGE_DELAY_MS),
        },
    });
    const { ReportExportShare } = await import('./report-export-share.model.js');
    await ReportExportShare.updateMany({ snapshotId: snapshot._id, revokedAt: null }, {
        $set: {
            revokedAt: now,
            purgeAt: new Date(now.getTime() + SNAPSHOT_PURGE_DELAY_MS),
        },
    });
    return toSummary(snapshot);
}
function filenameFor(document: ReportDocumentV1, format: ReportFormat) {
    const descriptor = getReportCatalogDescriptor(document.kind)!;
    const source = document.sourceDates[0]!;
    const timestamp = (source.observedAt ?? source.to)!;
    const date = timestamp.slice(0, 10);
    return createSafeReportFilename({ stem: descriptor.slug, sourceDate: date, format });
}
export async function downloadReportExport(input: SnapshotActorInput): Promise<ReportExportDownload> {
    const snapshot = await loadActiveSnapshot(input.accountId, input.snapshotId);
    const adapter = await assertSnapshotAccess(snapshot, input.actorUserId, 'download');
    const document = parseSnapshotDocument(snapshot);
    let rendered;
    try {
        rendered = await renderReportDocument({
            document,
            format: snapshot.format,
            snapshotCreatedAt: snapshot.createdAt.toISOString(),
            renderNative: nativeRenderer(adapter, document, snapshot.format, snapshot.createdAt.toISOString()),
        });
    }
    catch (error) {
        throwDownloadRenderFailure(error);
    }
    const bytes = Buffer.from(rendered.bytes);
    const now = new Date();
    const updated = await ReportExportSnapshot.updateOne({
        ...activeSnapshotFilter(input.accountId, input.snapshotId, now),
        downloadCount: { $lt: MAX_DOWNLOAD_COUNT },
    }, { $inc: { downloadCount: 1 }, $set: { lastDownloadedAt: now } });
    if (updated.matchedCount === 0) {
        const capped = await ReportExportSnapshot.updateOne(activeSnapshotFilter(input.accountId, input.snapshotId, now), { $set: { lastDownloadedAt: now } });
        if (capped.matchedCount === 0)
            throw notFound();
    }
    const filename = filenameFor(document, snapshot.format);
    const headers = createReportDownloadHeaders({
        filename,
        format: snapshot.format,
        byteLength: bytes.byteLength,
    });
    return {
        snapshotId: String(snapshot._id),
        kind: snapshot.kind,
        format: snapshot.format,
        locale: document.locale,
        filename: filename.filename,
        contentDisposition: filename.contentDisposition,
        mediaType: rendered.mediaType,
        headers,
        bytes,
    };
}
export async function denyReportExportsForSite(siteId: string, now = new Date()): Promise<number> {
    const result = await ReportExportSnapshot.updateMany({ siteId, deletedAt: null }, { $set: { deletedAt: now, purgeAt: now } });
    const { ReportExportShare } = await import('./report-export-share.model.js');
    await ReportExportShare.updateMany({ siteId, revokedAt: null }, { $set: { revokedAt: now, purgeAt: now } });
    return result.modifiedCount;
}
export async function denyReportExportsForAccount(accountId: string, now = new Date()): Promise<number> {
    const result = await ReportExportSnapshot.updateMany({ accountId, deletedAt: null }, { $set: { deletedAt: now, purgeAt: now } });
    const { ReportExportShare } = await import('./report-export-share.model.js');
    await ReportExportShare.updateMany({ accountId, revokedAt: null }, { $set: { revokedAt: now, purgeAt: now } });
    return result.modifiedCount;
}
function isPublicFormatAllowed(kind: string, format: ReportPublicFormat): boolean {
    const descriptor = getReportCatalogDescriptor(kind);
    return Boolean(descriptor &&
        descriptor.share.eligible &&
        descriptor.share.formats.includes(format));
}
function isPublicSnapshotWithinBounds(document: ReportDocumentV1, canonicalBytes: number): boolean {
    return document.completeness.representedItems <= REPORT_GLOBAL_BOUNDS.pdfItems &&
        canonicalBytes <= REPORT_GLOBAL_BOUNDS.canonicalBytes;
}
function internalPublicHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
    if (normalized === 'localhost' ||
        normalized === 'api' ||
        normalized === 'mongo' ||
        normalized === 'postgres' ||
        normalized === 'redis' ||
        normalized.endsWith('.local') ||
        normalized === '::1')
        return true;
    const octets = normalized.split('.').map(Number);
    if (octets.length !== 4 || !octets.every(Number.isInteger))
        return false;
    const first = octets[0]!;
    const second = octets[1]!;
    return (first === 10 ||
        first === 127 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168));
}
function unsafePublicValue(value: unknown): boolean {
    if (Array.isArray(value))
        return value.some(unsafePublicValue);
    if (value !== null && typeof value === 'object') {
        return Object.values(value).some(unsafePublicValue);
    }
    if (typeof value !== 'string')
        return false;
    if (FORBIDDEN_PUBLIC_IDENTIFIER.test(value) || PUBLIC_EMAIL.test(value))
        return true;
    try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') &&
            internalPublicHostname(url.hostname);
    }
    catch {
        return false;
    }
}
async function loadPublicSnapshot(snapshotId: string, format: ReportPublicFormat, now: Date): Promise<{
    snapshot: SnapshotLean;
    document: ReportDocumentV1;
    adapter: ReportExportAdapter;
}> {
    const snapshot = await ReportExportSnapshot.findOne({
        _id: snapshotId,
        deletedAt: null,
        expiresAt: { $gt: now },
    }).lean<SnapshotLean>();
    if (!snapshot)
        throw notFound();
    if (!isPublicFormatAllowed(snapshot.kind, format))
        throw notFound();
    const accessSnapshot = {
        ...snapshot,
        format: format === 'view' ? snapshot.format : format,
    } as SnapshotLean;
    let adapter: ReportExportAdapter;
    try {
        adapter = await assertSnapshotAccess(accessSnapshot, String(snapshot.createdByUserId), format === 'view' ? 'read' : 'download');
    }
    catch {
        throw notFound();
    }
    const document = parseSnapshotDocument(snapshot);
    if (!isPublicSnapshotWithinBounds(document, snapshot.canonicalBytes))
        throw notFound();
    return { snapshot, document, adapter };
}
export async function inspectPublicReportExport(input: {
    snapshotId: string;
    formats: ReportPublicFormat[];
    shareExpiresAt: Date;
    now?: Date;
}): Promise<PublicReportDto> {
    const now = input.now ?? new Date();
    const { document } = await loadPublicSnapshot(input.snapshotId, 'view', now);
    const stripInternalIds = (value: unknown): unknown => {
        if (Array.isArray(value))
            return value.map(stripInternalIds);
        if (value === null || typeof value !== 'object')
            return value;
        const output: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value)) {
            if (key === 'id' ||
                key === 'sourceNoteKey' ||
                (key.endsWith('Id') && key !== 'ruleKey')) {
                continue;
            }
            output[key] = stripInternalIds(nested);
        }
        return output;
    };
    const publicSourceDates = stripInternalIds(document.sourceDates) as PublicReportDto['sourceDates'];
    const publicBlocks = stripInternalIds(document.blocks) as PublicReportDto['blocks'];
    const dto: PublicReportDto = {
        schemaVersion: document.schemaVersion,
        kindVersion: document.kindVersion,
        kind: document.kind,
        locale: document.locale,
        title: document.title,
        subject: document.subject,
        selection: document.selection,
        sourceDates: publicSourceDates,
        completeness: document.completeness,
        branding: document.branding,
        blocks: publicBlocks,
        formats: [...input.formats],
        expiresAt: input.shareExpiresAt.toISOString(),
    };
    if (unsafePublicValue(dto)) {
        throw reportExportError(422, 'reportExports.errors.invalidDocument', 'invalid_document');
    }
    return dto;
}
export async function downloadPublicReportExport(input: {
    snapshotId: string;
    format: 'pdf' | 'csv';
    now?: Date;
}): Promise<PublicReportFile> {
    const now = input.now ?? new Date();
    const { snapshot, document, adapter } = await loadPublicSnapshot(input.snapshotId, input.format, now);
    let rendered;
    try {
        rendered = await renderReportDocument({
            document,
            format: input.format,
            snapshotCreatedAt: snapshot.createdAt.toISOString(),
            renderNative: nativeRenderer(adapter, document, input.format, snapshot.createdAt.toISOString()),
        });
    }
    catch {
        throw notFound();
    }
    const bytes = Buffer.from(rendered.bytes);
    const filename = filenameFor(document, input.format);
    return {
        snapshotId: String(snapshot._id),
        kind: snapshot.kind,
        format: input.format,
        locale: document.locale,
        headers: createReportDownloadHeaders({
            filename,
            format: input.format,
            byteLength: bytes.byteLength,
        }),
        bytes,
    };
}
export async function cleanupReportExports(now = new Date()): Promise<number> {
    const { recordAudit } = await import('../audit/index.js');
    const expiring = await ReportExportSnapshot.find({
        $or: [{ expiresAt: { $lte: now } }, { purgeAt: { $lte: now } }],
    }).select('_id createdByUserId expiresAt').lean<Array<{
        _id: Types.ObjectId;
        createdByUserId: Types.ObjectId;
        expiresAt: Date;
    }>>();
    for (const snapshot of expiring) {
        if (snapshot.expiresAt <= now) {
            await recordAudit({
                actorUserId: String(snapshot.createdByUserId),
                action: 'report_export.expired',
                targetType: 'report_export',
                targetId: String(snapshot._id),
                metadata: { status: 'expired' },
            });
        }
        await recordAudit({
            actorUserId: String(snapshot.createdByUserId),
            action: 'report_export.purged',
            targetType: 'report_export',
            targetId: String(snapshot._id),
            metadata: { status: 'purged' },
        });
    }
    const result = await ReportExportSnapshot.deleteMany({
        $or: [{ expiresAt: { $lte: now } }, { purgeAt: { $lte: now } }],
    });
    const { ReportExportShare } = await import('./report-export-share.model.js');
    const purgingShares = await ReportExportShare.find({ purgeAt: { $lte: now } })
        .select('_id createdByUserId expiresAt')
        .lean<Array<{
        _id: Types.ObjectId;
        createdByUserId: Types.ObjectId;
        expiresAt: Date;
    }>>();
    for (const share of purgingShares) {
        if (share.expiresAt <= now) {
            await recordAudit({
                actorUserId: String(share.createdByUserId),
                action: 'report_export.expired',
                targetType: 'report_export_share',
                targetId: String(share._id),
                metadata: { status: 'expired' },
            });
        }
        await recordAudit({
            actorUserId: String(share.createdByUserId),
            action: 'report_export.purged',
            targetType: 'report_export_share',
            targetId: String(share._id),
            metadata: { status: 'purged' },
        });
    }
    await ReportExportShare.deleteMany({ purgeAt: { $lte: now } });
    return result.deletedCount;
}
export const reportExportServiceTestables = Object.freeze({
    assertFormatRenderable,
    internalPublicHostname,
    isPublicFormatAllowed,
    isPublicSnapshotWithinBounds,
    nativeRenderer,
    throwDownloadRenderFailure,
    throwRenderabilityFailure,
    unsafePublicValue,
});
