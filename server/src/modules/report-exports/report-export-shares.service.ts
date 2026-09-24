import { sql } from 'drizzle-orm';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { getReportCatalogDescriptor } from '../../shared/report-exports/index.js';
import { OPAQUE_BEARER_TOKEN_BYTES, createOpaqueBearerToken, hashOpaqueBearerToken, isOpaqueBearerToken, } from '../../shared/security/opaque-token.js';
import { normalizedClientUrl } from '../../shared/utils/client-url.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { assertCurrentAccountWorkLease, tryRunWithTargetAccountWorkLease, } from '../legal/index.js';
import { assertCurrentSiteWorkLease, tryRunWithSiteWorkLease, } from '../sites/index.js';
import { ReportExportShare } from './report-export-share.model.js';
import { ReportExportSnapshot } from './report-export-snapshot.model.js';
import { getReportExportsDb } from './report-exports.holder.js';
import { downloadPublicReportExport, inspectPublicReportExport, inspectReportExport, } from './report-exports.service.js';
import type { CreateReportExportShareBody } from './report-export-shares.schema.js';
import type { PublicReportDto, PublicReportFile, ReportPublicFormat, ReportExportShareCenterListDto, } from './report-exports.types.js';
export const REPORT_SHARE_TOKEN_BYTES = OPAQUE_BEARER_TOKEN_BYTES;
export const REPORT_SHARE_DEFAULT_DAYS = 30;
export const REPORT_SHARE_MAX_DAYS = 90;
export const REPORT_SHARE_ACCOUNT_ACTIVE_MAX = 25;
export const REPORT_SHARE_SNAPSHOT_ACTIVE_MAX = 5;
const SHARE_PURGE_DELAY_MS = 24 * 60 * 60 * 1000;
const MAX_ACCESS_COUNT = 1000000;
interface ShareLean {
    _id: {
        toString(): string;
    };
    accountId: {
        toString(): string;
    };
    siteId: {
        toString(): string;
    } | null;
    snapshotId: {
        toString(): string;
    };
    createdByUserId: {
        toString(): string;
    };
    tokenHash: string;
    formats: ReportPublicFormat[];
    expiresAt: Date;
    revokedAt: Date | null;
    accessCount: number;
    lastAccessedAt: Date | null;
    createdAt: Date;
}
export interface ReportExportShareManagementDto {
    id: string;
    snapshotId: string;
    formats: ReportPublicFormat[];
    expiresAt: string;
    revokedAt: string | null;
    accessCount: number;
    lastAccessedAt: string | null;
    createdAt: string;
}
export interface CreatedReportExportShareDto extends ReportExportShareManagementDto {
    url: string;
}
export interface ResolvedPublicShare {
    shareId: string;
    actorUserId: string;
    snapshotId: string;
    kind: string;
    format: ReportPublicFormat;
    report?: PublicReportDto;
    file?: PublicReportFile;
}
interface CreateReportExportShareDependencies {
    /** Deterministic race seam after public-document validation. */
    afterPublicInspection?: () => Promise<void>;
    /** Deterministic race seam immediately before the guarded transaction. */
    beforeCommit?: () => Promise<void>;
}
type PublicLeaseResult<Result> = {
    acquired: true;
    value: Result;
} | {
    acquired: false;
};
export async function authenticatePublicReportShareToken(input: {
    rawToken: string;
    format: ReportPublicFormat;
    now?: Date;
}): Promise<{
    tokenHash: string;
}> {
    if (!env.PUBLIC_EXPORTS_ENABLED || !isOpaqueBearerToken(input.rawToken)) {
        throw notFound();
    }
    const tokenHash = hashOpaqueBearerToken(input.rawToken);
    const live = await ReportExportShare.exists({
        tokenHash,
        revokedAt: null,
        expiresAt: { $gt: input.now ?? new Date() },
        formats: input.format,
    });
    if (!live) {
        throw notFound();
    }
    return { tokenHash };
}
function notFound(): HttpError {
    return HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
}
function unavailable(): HttpError {
    return new HttpError(503, { code: 'REPORT_EXPORTS_ERRORS_UNAVAILABLE', messageKey: 'reportExports.errors.unavailable' }, {
        code: 'unavailable',
    });
}
function requirePublicShareDescriptor(kind: string) {
    const descriptor = getReportCatalogDescriptor(kind);
    if (!descriptor || !descriptor.share.eligible)
        throw notFound();
    return descriptor;
}
function boundedShareExpiry(requestedExpiry: Date, snapshotExpiry: Date, now: Date): Date {
    const expiresAt = requestedExpiry < snapshotExpiry
        ? requestedExpiry
        : snapshotExpiry;
    if (expiresAt <= now)
        throw notFound();
    return expiresAt;
}
function assertShareCapacity(accountActive: number, snapshotActive: number): void {
    if (accountActive >= REPORT_SHARE_ACCOUNT_ACTIVE_MAX ||
        snapshotActive >= REPORT_SHARE_SNAPSHOT_ACTIVE_MAX) {
        throw new HttpError(409, { code: 'REPORT_EXPORTS_ERRORS_SCOPE_TOO_LARGE', messageKey: 'reportExports.errors.scopeTooLarge' });
    }
}
function resolvedPublicShareKind(report: {
    kind: string;
} | undefined, file: {
    kind: string;
} | undefined): string {
    return report?.kind ?? file?.kind ?? 'unknown';
}
async function requirePublicLease<Result>(run: () => Promise<PublicLeaseResult<Result>>): Promise<Result> {
    try {
        const leased = await run();
        if (!leased.acquired)
            throw notFound();
        return leased.value;
    }
    catch {
        throw notFound();
    }
}
function toManagementDto(share: ShareLean): ReportExportShareManagementDto {
    return {
        id: share._id.toString(),
        snapshotId: share.snapshotId.toString(),
        formats: [...share.formats],
        expiresAt: share.expiresAt.toISOString(),
        revokedAt: share.revokedAt?.toISOString() ?? null,
        accessCount: share.accessCount,
        lastAccessedAt: share.lastAccessedAt?.toISOString() ?? null,
        createdAt: share.createdAt.toISOString(),
    };
}
export async function createReportExportShare(input: {
    accountId: string;
    actorUserId: string;
    snapshotId: string;
    body: CreateReportExportShareBody;
    now?: Date;
}, dependencies: CreateReportExportShareDependencies = {}): Promise<CreatedReportExportShareDto> {
    if (!env.PUBLIC_EXPORTS_ENABLED)
        throw unavailable();
    const snapshot = await inspectReportExport(input);
    const descriptor = requirePublicShareDescriptor(snapshot.kind);
    if (input.body.formats.some((format) => !descriptor.share.formats.includes(format))) {
        throw new HttpError(400, { code: 'REPORT_EXPORTS_ERRORS_FORMAT_UNSUPPORTED', messageKey: 'reportExports.errors.formatUnsupported' });
    }
    const now = input.now ?? new Date();
    const requestedExpiry = new Date(now.getTime() + input.body.expiresInDays * 86400000);
    const expiresAt = boundedShareExpiry(requestedExpiry, new Date(snapshot.expiresAt), now);
    // Refuse before persistence if the immutable canonical document cannot be
    // represented within the stricter public-view allowlist/bounds.
    await inspectPublicReportExport({
        snapshotId: input.snapshotId,
        formats: input.body.formats,
        shareExpiresAt: expiresAt,
        now,
    });
    await dependencies.afterPublicInspection?.();
    const rawToken = createOpaqueBearerToken();
    const tokenHash = hashOpaqueBearerToken(rawToken);
    const snapshotRecord = await ReportExportSnapshot.findOne({
        _id: input.snapshotId,
        accountId: input.accountId,
        deletedAt: null,
        expiresAt: { $gt: now },
    }).select('siteId').lean<{
        siteId: {
            toString(): string;
        } | null;
    }>();
    if (!snapshotRecord)
        throw notFound();
    await dependencies.beforeCommit?.();
    const share = await getReportExportsDb().transaction(async (tx) => {
        await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${input.accountId}))`);
        const [accountActive, snapshotActive] = await Promise.all([
            ReportExportShare.countDocuments({
                accountId: input.accountId,
                revokedAt: null,
                expiresAt: { $gt: now },
            }),
            ReportExportShare.countDocuments({
                snapshotId: input.snapshotId,
                revokedAt: null,
                expiresAt: { $gt: now },
            }),
        ]);
        assertShareCapacity(accountActive, snapshotActive);
        if (!env.PUBLIC_EXPORTS_ENABLED)
            throw unavailable();
        return ReportExportShare.create({
            accountId: input.accountId,
            siteId: snapshotRecord.siteId,
            snapshotId: input.snapshotId,
            createdByUserId: input.actorUserId,
            tokenHash,
            formats: input.body.formats,
            expiresAt,
            purgeAt: new Date(expiresAt.getTime() + SHARE_PURGE_DELAY_MS),
        });
    });
    const dto = toManagementDto(share.toObject() as unknown as ShareLean);
    const localePrefix = snapshot.locale === 'en' ? '' : `/${snapshot.locale}`;
    return {
        ...dto,
        url: `${normalizedClientUrl()}${localePrefix}/share/${rawToken}`,
    };
}
export async function listReportExportShares(input: {
    accountId: string;
    actorUserId: string;
    snapshotId: string;
}): Promise<ReportExportShareManagementDto[]> {
    await inspectReportExport(input);
    const rows = await ReportExportShare.find({
        accountId: input.accountId,
        snapshotId: input.snapshotId,
    }).sort({ createdAt: -1 }).lean<ShareLean[]>();
    return rows.map(toManagementDto);
}
export async function listReportExportSharesForAccount(input: {
    accountId: string;
    actorUserId: string;
    limit: number;
    cursor?: string;
    allowedSiteIds?: readonly string[] | null;
}): Promise<ReportExportShareCenterListDto> {
    const filter = {
        accountId: input.accountId,
        ...(input.cursor ? { _id: { $lt: new Types.ObjectId(input.cursor) } } : {}),
        ...(input.allowedSiteIds !== undefined && input.allowedSiteIds !== null
            ? { siteId: { $in: input.allowedSiteIds } }
            : {}),
    };
    const rows = await ReportExportShare.find(filter)
        .sort({ _id: -1 })
        .limit(input.limit + 1)
        .lean<ShareLean[]>();
    const page = rows.slice(0, input.limit);
    const items: ReportExportShareCenterListDto['items'] = [];
    for (const row of page) {
        let snapshot: ReportExportShareCenterListDto['items'][number]['snapshot'] = null;
        try {
            const summary = await inspectReportExport({
                accountId: input.accountId,
                actorUserId: input.actorUserId,
                snapshotId: row.snapshotId.toString(),
            });
            snapshot = {
                id: summary.id,
                kind: summary.kind,
                locale: summary.locale,
                title: summary.title,
                expiresAt: summary.expiresAt,
            };
        }
        catch (error) {
            if (!(error instanceof HttpError && error.status === 404))
                throw error;
        }
        items.push({ ...toManagementDto(row), snapshot });
    }
    return {
        items,
        nextCursor: rows.length > input.limit && page.length > 0
            ? page[page.length - 1]!._id.toString()
            : null,
    };
}
export async function revokeReportExportShare(input: {
    accountId: string;
    actorUserId: string;
    snapshotId: string;
    shareId: string;
    now?: Date;
}): Promise<ReportExportShareManagementDto> {
    await inspectReportExport(input);
    const now = input.now ?? new Date();
    const share = await ReportExportShare.findOneAndUpdate({
        _id: input.shareId,
        accountId: input.accountId,
        snapshotId: input.snapshotId,
    }, { $set: { revokedAt: now } }, { new: true }).lean<ShareLean>();
    if (!share)
        throw notFound();
    return toManagementDto(share);
}
export async function resolvePublicReportShare(input: {
    rawToken: string;
    format: ReportPublicFormat;
    now?: Date;
}): Promise<ResolvedPublicShare> {
    if (!env.PUBLIC_EXPORTS_ENABLED || !isOpaqueBearerToken(input.rawToken)) {
        throw notFound();
    }
    const now = input.now ?? new Date();
    const tokenHash = hashOpaqueBearerToken(input.rawToken);
    const share = await ReportExportShare.findOne({
        tokenHash,
        revokedAt: null,
        expiresAt: { $gt: now },
        formats: input.format,
    }).lean<ShareLean>();
    if (!share)
        throw notFound();
    const common = {
        shareId: share._id.toString(),
        actorUserId: share.createdByUserId.toString(),
        snapshotId: share.snapshotId.toString(),
    };
    const read = async (): Promise<ResolvedPublicShare> => {
        const report = input.format === 'view'
            ? await inspectPublicReportExport({
                snapshotId: common.snapshotId,
                formats: share.formats,
                shareExpiresAt: share.expiresAt,
                now,
            })
            : undefined;
        const file = input.format === 'pdf' || input.format === 'csv'
            ? await downloadPublicReportExport({
                snapshotId: common.snapshotId,
                format: input.format,
                now,
            })
            : undefined;
        const updated = await ReportExportShare.updateOne({
            _id: share._id,
            tokenHash,
            revokedAt: null,
            expiresAt: { $gt: now },
            accessCount: { $lt: MAX_ACCESS_COUNT },
        }, { $inc: { accessCount: 1 }, $set: { lastAccessedAt: now } });
        if (updated.matchedCount === 0) {
            const live = await ReportExportShare.exists({
                _id: share._id,
                tokenHash,
                revokedAt: null,
                expiresAt: { $gt: now },
            });
            if (!live)
                throw notFound();
        }
        await assertCurrentAccountWorkLease();
        if (share.siteId)
            await assertCurrentSiteWorkLease();
        return {
            shareId: common.shareId,
            actorUserId: common.actorUserId,
            snapshotId: common.snapshotId,
            kind: resolvedPublicShareKind(report, file),
            format: input.format,
            ...(report ? { report } : {}),
            ...(file ? { file } : {}),
        };
    };
    const accountId = share.accountId.toString();
    const siteId = share.siteId?.toString();
    return requirePublicLease(async () => siteId
        ? await tryRunWithSiteWorkLease({ accountId, siteId }, 'report-share-read', read)
        : await tryRunWithTargetAccountWorkLease(accountId, 'report-share-read', read, { assertAfterWork: true }));
}
export const reportExportShareServiceTestables = Object.freeze({
    assertShareCapacity,
    boundedShareExpiry,
    requirePublicLease,
    requirePublicShareDescriptor,
    resolvedPublicShareKind,
    toManagementDto,
});
