import { Types } from 'mongoose';
import { hasTranslationKey, localizeSemanticCopy, type SupportedLocale, } from '../../shared/i18n/index.js';
import { isNotEvaluatedFinding } from '../../shared/audit-findings.js';
import { AuditRun } from './audit-run.model.js';
import { AuditedPage } from './audited-page.model.js';
import { ReportSnapshot } from './report-snapshot.model.js';
export const PAGES_AUDIT_INVENTORY_MAX = 5000;
export interface AuditPageInventoryRow {
    url: string;
    title: string | null;
    isIndexable: boolean;
    nonIndexableReason: string | null;
    onPageScore: number | null;
}
export interface AuditPageInventory {
    runId: string | null;
    rows: AuditPageInventoryRow[];
    fetchedCount: number;
    truncated: boolean;
}
/** Bounded account/site-scoped projection used by Pages through this module's barrel. */
export async function readLatestCompletedPageInventory(accountId: string, siteId: string, limit = PAGES_AUDIT_INVENTORY_MAX): Promise<AuditPageInventory> {
    if (!Types.ObjectId.isValid(accountId) || !Types.ObjectId.isValid(siteId)) {
        return { runId: null, rows: [], fetchedCount: 0, truncated: false };
    }
    const run = await AuditRun.findOne({
        accountId,
        siteId,
        kind: 'site',
        status: 'succeeded',
    })
        .sort({ _id: -1 })
        .select({ _id: 1 })
        .lean();
    if (!run)
        return { runId: null, rows: [], fetchedCount: 0, truncated: false };
    const bounded = Math.min(Math.max(limit, 1), PAGES_AUDIT_INVENTORY_MAX);
    const docs = await AuditedPage.find({ runId: run._id }, {
        _id: 0,
        url: 1,
        title: 1,
        isIndexable: 1,
        nonIndexableReason: 1,
        onPageScore: 1,
    })
        .sort({ url: 1, _id: 1 })
        .limit(bounded + 1)
        .lean();
    return {
        runId: String(run._id),
        fetchedCount: docs.length,
        truncated: docs.length > bounded,
        rows: docs.slice(0, bounded).map((row) => ({
            url: row.url,
            title: row.title ?? null,
            isIndexable: row.isIndexable,
            nonIndexableReason: row.nonIndexableReason ?? null,
            onPageScore: Number.isFinite(row.onPageScore) ? row.onPageScore : null,
        })),
    };
}
/** Page facts the deep crawl recorded for one page. */
export interface AuditPageCrawlFacts {
    clickDepth?: number;
    inboundInternalLinks?: number;
    pageSizeBytes?: number;
    serverResponseMs?: number;
}
/** One open finding of the latest audit that names this page. */
export interface AuditPageIssue {
    ruleId: string;
    bucket: 'fix-now' | 'watch';
    severity: 'critical' | 'warning' | 'info';
    /** The rule's localized title, as the report shows it. */
    title: string;
}
export interface AuditPageDetail {
    runId: string;
    facts: AuditPageCrawlFacts;
    issues: AuditPageIssue[];
}
const PAGE_FACT_KEYS = ['clickDepth', 'inboundInternalLinks', 'pageSizeBytes', 'serverResponseMs'] as const;
/**
 * The latest completed audit's view of one page: the crawl facts stored for
 * it and the open findings that list it — directly, or through a resource the
 * page loads. Same findings the report shows, read from the frozen snapshot;
 * `null` when there is no completed audit or the page was not crawled.
 *
 * `isPage` decides whether a stored address is this page, so the caller's one
 * address-matching authority (the Pages module) stays the only one.
 */
export async function readLatestAuditPageDetail(accountId: string, siteId: string, isPage: (url: string) => boolean, locale: SupportedLocale): Promise<AuditPageDetail | null> {
    if (!Types.ObjectId.isValid(accountId) || !Types.ObjectId.isValid(siteId))
        return null;
    const run = await AuditRun.findOne({ accountId, siteId, kind: 'site', status: 'succeeded' })
        .sort({ _id: -1 })
        .select({ _id: 1 })
        .lean();
    if (!run)
        return null;
    const candidates = await AuditedPage.find({ runId: run._id })
        .sort({ url: 1, _id: 1 })
        .limit(PAGES_AUDIT_INVENTORY_MAX)
        .select({ url: 1, ...Object.fromEntries(PAGE_FACT_KEYS.map((fact) => [fact, 1])) })
        .lean();
    const stored = candidates.find((row) => isPage(row.url));
    if (!stored)
        return null;
    const facts: AuditPageCrawlFacts = {};
    for (const fact of PAGE_FACT_KEYS) {
        const value = stored[fact];
        if (typeof value === 'number')
            facts[fact] = value;
    }
    const snapshot = await ReportSnapshot.findOne({ runId: run._id }).select({ findings: 1 }).lean();
    const issues: AuditPageIssue[] = [];
    for (const finding of snapshot?.findings ?? []) {
        if (finding.bucket === 'passed' || isNotEvaluatedFinding(finding))
            continue;
        if (!findingNamesPage(finding, isPage))
            continue;
        // A stored id this release no longer ships has no copy to show.
        const titleKey = `auditRules.${finding.ruleId}.title`;
        if (!hasTranslationKey(titleKey))
            continue;
        issues.push({
            ruleId: finding.ruleId,
            bucket: finding.bucket,
            severity: finding.severity,
            title: localizeSemanticCopy(locale, titleKey).message,
        });
    }
    return { runId: String(run._id), facts, issues };
}
/** A finding lists the page itself, or a resource whose `usedOn` includes it. */
function findingNamesPage(finding: {
    affectedUrls: string[];
    meta?: unknown;
}, isPage: (url: string) => boolean): boolean {
    if (finding.affectedUrls.some(isPage))
        return true;
    const resources = (finding.meta as {
        resources?: unknown;
    } | null | undefined)?.resources;
    if (!Array.isArray(resources))
        return false;
    return resources.some((resource) => {
        const usedOn = (resource as {
            usedOn?: unknown;
        } | null)?.usedOn;
        return Array.isArray(usedOn) && usedOn.some((used) => typeof used === 'string' && isPage(used));
    });
}
