import type { Db } from '../../db/client.js';
import type { SupportedLocale } from '../../shared/i18n/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { AuditRun, ReportSnapshot, getAuditReport, type AuditReport, } from '../audits/index.js';
import { readLatestSnapshotDate, readSearchAnalytics, } from '../gsc-snapshots/index.js';
import { readClientReportRankProjection, readClientReportRankRows, type ClientReportRankRow, } from '../ranks/index.js';
import { Site } from '../sites/index.js';
// Direct model import avoids the require-auth ↔ users.routes barrel cycle.
import { User, resolveStoredUserBranding, type StoredUserBranding, } from '../users/users.model.js';
export interface ClientReportSectionSelection {
    audit: boolean;
    ranks: boolean;
    gsc: boolean;
}
export interface ClientAuditSection {
    snapshotDate: string;
    report: AuditReport;
}
export interface ClientRankSection {
    snapshotDate: string;
    rows: ClientReportRankRow[];
}
export interface ClientGscQueryRow {
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    snapshotDate: string;
}
export interface ClientGscSection {
    snapshotDate: string;
    windowDays: 28;
    totalClicks: number;
    totalImpressions: number;
    averageCtr: number;
    averagePosition: number;
    topQueries: ClientGscQueryRow[];
}
export interface ClientReportSnapshot {
    siteLabel: string;
    siteDomain: string;
    locale: SupportedLocale;
    branding: StoredUserBranding;
    generatedAt: string;
    sections: {
        audit: ClientAuditSection | null;
        ranks: ClientRankSection | null;
        gsc: ClientGscSection | null;
    };
}
export interface ComposeClientReportInput {
    accountId: string;
    siteId: string;
    locale: SupportedLocale;
    sections: ClientReportSectionSelection;
}
export interface ClientReportCompleteness {
    auditFindings: number;
    maxAffectedUrls: number;
    rankRows: number;
    gscQueries: number;
}
async function readAuditSection(input: ComposeClientReportInput): Promise<ClientAuditSection | null> {
    if (!input.sections.audit)
        return null;
    const snapshot = await ReportSnapshot.findOne({
        accountId: input.accountId,
        siteId: input.siteId,
    })
        .sort({ createdAt: -1 })
        .select('runId createdAt')
        .lean();
    if (!snapshot)
        return null;
    const run = await AuditRun.findOne({
        _id: snapshot.runId,
        accountId: input.accountId,
        siteId: input.siteId,
        status: 'succeeded',
    })
        .select('finishedAt')
        .lean();
    if (!run)
        return null;
    const report = await getAuditReport({
        accountId: input.accountId,
        runId: String(snapshot.runId),
        locale: input.locale,
    });
    return {
        snapshotDate: (run.finishedAt ?? snapshot.createdAt).toISOString(),
        report,
    };
}
async function readRankSection(input: ComposeClientReportInput, db: Db): Promise<ClientRankSection | null> {
    if (!input.sections.ranks)
        return null;
    const rows = await readClientReportRankRows(input.accountId, input.siteId, db);
    if (rows.length === 0)
        return null;
    return { snapshotDate: rows[0]!.checkedAt, rows };
}
async function readGscSection(input: ComposeClientReportInput, db: Db, bindingGenerationId: string | null): Promise<ClientGscSection | null> {
    if (!input.sections.gsc || !bindingGenerationId)
        return null;
    const snapshotDate = await readLatestSnapshotDate(db, input.siteId, 'query', 28, bindingGenerationId);
    if (snapshotDate === null)
        return null;
    const rows = await readSearchAnalytics(db, input.siteId, 'query', { since: snapshotDate, until: snapshotDate }, 28, bindingGenerationId);
    if (rows.length === 0)
        return null;
    let totalClicks = 0;
    let totalImpressions = 0;
    let ctrWeighted = 0;
    let positionWeighted = 0;
    for (const row of rows) {
        totalClicks += row.clicks;
        totalImpressions += row.impressions;
        ctrWeighted += row.ctr * row.impressions;
        positionWeighted += row.position * row.impressions;
    }
    const averageCtr = totalImpressions === 0 ? 0 : ctrWeighted / totalImpressions;
    const averagePosition = totalImpressions === 0 ? 0 : positionWeighted / totalImpressions;
    const topQueries = [...rows]
        .sort((a, b) => b.clicks - a.clicks || a.dimensionKey.localeCompare(b.dimensionKey))
        .slice(0, 5)
        .map((row) => ({
        query: row.dimensionKey,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        snapshotDate,
    }));
    return {
        snapshotDate,
        windowDays: 28,
        totalClicks,
        totalImpressions,
        averageCtr,
        averagePosition,
        topQueries,
    };
}
export async function composeClientReport(input: ComposeClientReportInput, db: Db): Promise<ClientReportSnapshot> {
    const site = await Site.findOne({
        _id: input.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    })
        .select('displayName domain gscPropertyUrl gscBindingGenerationId')
        .lean();
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    const [audit, ranks, gsc, user] = await Promise.all([
        readAuditSection(input),
        readRankSection(input, db),
        readGscSection(input, db, site.gscPropertyUrl ? site.gscBindingGenerationId ?? 'legacy' : null),
        User.findById(input.accountId).select('branding').lean(),
    ]);
    const dates = [audit?.snapshotDate, ranks?.snapshotDate, gsc?.snapshotDate]
        .filter((value): value is string => value !== undefined)
        .map((value) => new Date(value).getTime())
        .filter(Number.isFinite);
    if (dates.length === 0) {
        throw HttpError.conflict({ code: 'CLIENT_REPORTS_ERRORS_NO_SNAPSHOT', messageKey: 'clientReports.errors.noSnapshot' });
    }
    return {
        siteLabel: site.displayName.trim() || site.domain,
        siteDomain: site.domain,
        locale: input.locale,
        branding: resolveStoredUserBranding(user),
        generatedAt: new Date(Math.max(...dates)).toISOString(),
        sections: { audit, ranks, gsc },
    };
}
/**
 * Complete-count seam for unified exports. Legacy PDF composition keeps its
 * pinned clipping behavior; immutable exports call this and refuse instead.
 */
export async function inspectClientReportCompleteness(input: ComposeClientReportInput, snapshot: ClientReportSnapshot, db: Db): Promise<ClientReportCompleteness> {
    const auditFindings = snapshot.sections.audit?.report.findings.length ?? 0;
    const maxAffectedUrls = snapshot.sections.audit?.report.findings.reduce((maximum, finding) => Math.max(maximum, finding.affectedUrls.length), 0) ?? 0;
    const rankRows = input.sections.ranks
        ? (await readClientReportRankProjection(input.accountId, input.siteId, db)).totalRows
        : 0;
    let gscQueries = 0;
    if (input.sections.gsc) {
        const site = await Site.findOne({
            _id: input.siteId,
            accountId: input.accountId,
            deletionStartedAt: null,
        })
            .select('gscPropertyUrl gscBindingGenerationId')
            .lean();
        const bindingGenerationId = site?.gscPropertyUrl
            ? site.gscBindingGenerationId ?? 'legacy'
            : null;
        const snapshotDate = bindingGenerationId
            ? await readLatestSnapshotDate(db, input.siteId, 'query', 28, bindingGenerationId)
            : null;
        if (snapshotDate !== null) {
            gscQueries = (await readSearchAnalytics(db, input.siteId, 'query', { since: snapshotDate, until: snapshotDate }, 28, bindingGenerationId!)).length;
        }
    }
    return { auditFindings, maxAffectedUrls, rankRows, gscQueries };
}
