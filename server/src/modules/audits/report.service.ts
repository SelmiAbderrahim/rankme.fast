/**
 * Report service.
 *
 * Owns three responsibilities:
 *   1. Snapshotting the rule-engine output when an audit run finishes.
 *   2. Diffing two snapshots so the report screen can show what improved
 *      or regressed between runs.
 *   3. Serving the localized report the /api/audits/:runId/report route
 *      renders — copy resolved into the caller's locale, never keys.
 */
import { Types } from 'mongoose';
import type { AuditResult } from '../../shared/providers/index.js';
import { isAuditCodeFixEligible } from '../../shared/code-fix-eligibility.js';
import { hasTranslationKey, localizeSemanticCopy, type SupportedLocale, type TranslationKey, } from '../../shared/i18n/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { AuditRun } from './audit-run.model.js';
import { AuditedPage } from './audited-page.model.js';
import { ReportSnapshot, type ReportSnapshotHydrated, } from './report-snapshot.model.js';
import { selectAuditSummaryLocale, type AuditSummaryStatus, } from './summary.selection.js';
import { countByBucket, evaluateAllRules, type AiVisibilityEvaluationInput, type FindingCounts, type GscSearchEvaluationInput, type GscSearchStatus, type GscSitemapsEvaluationInput, type GscSitemapsStatus, type IndexStatusEvaluationInput, type IndexStatusSample, type IndexStatusStatus, type LocalSeoEvaluationInput, type PageSpeedEvaluationInput, type PageSpeedSample, type PageSpeedStatus, type RuleFinding, } from './rules/index.js';
// ---------------------------------------------------------------------------
// Snapshot writing
// ---------------------------------------------------------------------------
export interface WriteReportSnapshotInput {
    runId: string;
    siteId: string;
    accountId: string;
    result: AuditResult;
    /**
     * Optional PSI+CrUX section. When absent, the page-speed rules
     * land in watch with `insufficientData` meta and the pageSpeed block on
     * the report renders as "no page-speed data yet". When `status:
     * 'unavailable'`, the report shows a localized inline note (no gauges).
     */
    pageSpeed?: PageSpeedEvaluationInput;
    /**
     * Optional Google Search Console section. Absent = the audit
     * shipped before GSC wiring; the index-status rules degrade to
     * `insufficientData` findings and the panel renders a "connect Google
     * Search Console" prompt. Status covers `not-connected`,
     * `needs-reconnect`, `quota-exceeded`, `unavailable`, or `ok`.
     */
    indexStatus?: IndexStatusEvaluationInput;
    /**
     * Optional GSC Search Analytics window. Absent = pre-feature
     * snapshot or no collector wired; the `gsc-ctr-low` rule degrades to
     * `insufficientData` and the report block renders the connect prompt.
     */
    gscSearch?: GscSearchEvaluationInput;
    /** Optional GSC sitemaps health — same degradation story. */
    gscSitemaps?: GscSitemapsEvaluationInput;
    /** Optional AI Visibility rollup — read-only existing signals. */
    aiVisibility?: AiVisibilityEvaluationInput & {
        sentiment?: {
            positive: number;
            neutral: number;
            negative: number;
        };
        notMentionedPrompts?: string[];
    };
    /**
     * Optional Local SEO rollup — NAP consistency, review/Q&A
     * health, local-pack rank. Absent = pre-feature snapshot or the account
     * never refreshed; the local-seo rules degrade to `insufficientData` and
     * the report block renders the "connect local data" prompt.
     */
    localSeo?: LocalSeoEvaluationInput;
}
/**
 * Runs the rule engine and persists ONE snapshot per runId. Idempotent — a
 * retried job overwrites the prior snapshot atomically-enough for our story
 * (worker retries are rare and rule copy is versioned by ruleId, so a
 * replay yields the same document).
 */
export async function writeReportSnapshot(input: WriteReportSnapshotInput): Promise<ReportSnapshotHydrated> {
    const findings = evaluateAllRules(input.result, input.pageSpeed ?? null, input.indexStatus ?? null, input.gscSearch ?? null, input.gscSitemaps ?? null, input.aiVisibility ?? null, input.localSeo ?? null);
    const counts = countByBucket(findings);
    const doc = await ReportSnapshot.findOneAndUpdate({ runId: input.runId }, {
        $set: {
            siteId: input.siteId,
            accountId: input.accountId,
            findings,
            counts,
            pageSpeed: input.pageSpeed ?? null,
            indexStatus: input.indexStatus ?? null,
            gscSearch: input.gscSearch ?? null,
            gscSitemaps: input.gscSitemaps ?? null,
            aiVisibility: input.aiVisibility
                ? {
                    ...input.aiVisibility,
                    sentiment: input.aiVisibility.sentiment ?? {
                        positive: 0,
                        neutral: 0,
                        negative: input.aiVisibility.negativeSentimentCount,
                    },
                    notMentionedPrompts: input.aiVisibility.notMentionedPrompts ?? [],
                }
                : null,
            localSeo: input.localSeo ?? null,
        },
    }, { upsert: true, new: true });
    return doc as ReportSnapshotHydrated;
}
// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------
export type DiffKind = 'fixed' | 'regressed' | 'new' | 'unchanged';
export interface DiffEntry {
    ruleId: string;
    url: string;
    kind: DiffKind;
}
export interface SnapshotDiff {
    entries: DiffEntry[];
    summary: Record<DiffKind, number>;
}
/** Empty diff (used when there is no previous snapshot to compare to). */
export function emptyDiff(): SnapshotDiff {
    return {
        entries: [],
        summary: { fixed: 0, regressed: 0, new: 0, unchanged: 0 },
    };
}
interface StoredFinding {
    ruleId: string;
    bucket: string;
    affectedUrls: string[];
}
function diffKey(ruleId: string, url: string): string {
    // JSON-encoded tuple keeps ruleId + url separable losslessly regardless of
    // what characters the URL contains (a naïve `||` separator collides with any
    // URL that also contains `||`).
    return JSON.stringify([ruleId, url]);
}
function decodeDiffKey(key: string): [
    string,
    string
] {
    const [ruleId, url] = JSON.parse(key) as [
        string,
        string
    ];
    return [ruleId, url];
}
function bucketByKey(findings: StoredFinding[]): Map<string, string> {
    // Key = tuple(ruleId, url) — url '' represents the site-wide bucket.
    const map = new Map<string, string>();
    for (const finding of findings) {
        if (finding.affectedUrls.length === 0) {
            map.set(diffKey(finding.ruleId, ''), finding.bucket);
        }
        for (const url of finding.affectedUrls) {
            map.set(diffKey(finding.ruleId, url), finding.bucket);
        }
    }
    return map;
}
/**
 * Per-(ruleId, url) diff. `fixed` = was fix-now/watch, now passed;
 * `regressed` = was passed, now not; `new` = present only in `next`;
 * `unchanged` = same bucket in both.
 */
export function diffSnapshots(prev: {
    findings: StoredFinding[];
} | null | undefined, next: {
    findings: StoredFinding[];
}): SnapshotDiff {
    if (!prev)
        return emptyDiff();
    const prevMap = bucketByKey(prev.findings);
    const nextMap = bucketByKey(next.findings);
    const summary: SnapshotDiff['summary'] = {
        fixed: 0,
        regressed: 0,
        new: 0,
        unchanged: 0,
    };
    const entries: DiffEntry[] = [];
    const keys = new Set<string>([...prevMap.keys(), ...nextMap.keys()]);
    for (const key of keys) {
        const [ruleId, url] = decodeDiffKey(key);
        const prevBucket = prevMap.get(key);
        const nextBucket = nextMap.get(key);
        let kind: DiffKind;
        if (prevBucket !== undefined && nextBucket !== undefined) {
            if (prevBucket === nextBucket) {
                kind = 'unchanged';
            }
            else if (nextBucket === 'passed') {
                kind = 'fixed';
            }
            else {
                kind = 'regressed';
            }
        }
        else if (nextBucket !== undefined) {
            kind = nextBucket === 'passed' ? 'unchanged' : 'new';
        }
        else {
            // Present in prev only — treat as fixed if it was actionable.
            kind = prevBucket === 'passed' ? 'unchanged' : 'fixed';
        }
        entries.push({ ruleId, url, kind });
        summary[kind] += 1;
    }
    entries.sort((a, b) => {
        if (a.ruleId !== b.ruleId)
            return a.ruleId.localeCompare(b.ruleId);
        return a.url.localeCompare(b.url);
    });
    return { entries, summary };
}
// ---------------------------------------------------------------------------
// Localized report
// ---------------------------------------------------------------------------
export interface LocalizedRuleCopy {
    title: string;
    why: string;
    fix: string;
    passedLabel: string;
    titleKey: string;
    whyKey: string;
    fixKey: string;
    passedLabelKey: string;
    /**
     * Optional GSC-state-specific explanation: resolved from
     * `meta.coverageState` / `meta.robotsTxtState` / `meta.pageFetchState`
     * so the copy can say "blocked by robots.txt" vs "Google couldn't fetch
     * the page" instead of the generic `why`.
     */
    reason?: string;
    reasonKey?: string;
}
export interface LocalizedFinding extends RuleFinding {
    copy: LocalizedRuleCopy;
    codeFixPromptAvailable?: true;
    brokenLinkTargets?: string[];
}
export interface AuditReportPageSpeedSection {
    status: PageSpeedStatus;
    samples: PageSpeedSample[];
}
export interface AuditReportIndexStatusSection {
    status: IndexStatusStatus;
    samples: IndexStatusSample[];
}
/** Wire shape of the Search Analytics section. */
export interface GscSearchSection {
    status: GscSearchStatus;
    totalClicks: number;
    totalImpressions: number;
    averageCtr: number;
    averagePosition: number;
    topQueries: Array<{
        query: string;
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
    }>;
    topPages: Array<{
        url: string;
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
    }>;
    delta: {
        clicks: number | null;
        impressions: number | null;
    };
}
/** Wire shape of the sitemaps section — dates as ISO strings. */
export interface GscSitemapsSection {
    status: GscSitemapsStatus;
    sitemaps: Array<{
        path: string;
        errors: number;
        warnings: number;
        processed: number;
        lastDownloaded: string | null;
    }>;
}
export interface AiVisibilitySection {
    status: AiVisibilityEvaluationInput['status'];
    aiOverviewCitedCount: number;
    aiOverviewTotalChecked: number;
    llmMentionedCount: number;
    llmTotalChecked: number;
    shareOfVoicePct: number | null;
    sentiment: {
        positive: number;
        neutral: number;
        negative: number;
    };
    notMentionedPrompts: string[];
}
export interface LocalSeoSection {
    status: LocalSeoEvaluationInput['status'];
    listings: Array<{
        source: string;
        consistent: boolean;
    }>;
    reviews: {
        averageRating: number | null;
        reviewCount: number;
    } | null;
    qa: {
        unansweredCount: number;
    } | null;
    localPack: {
        keyword: string;
        position: number | null;
        totalPackSize: number;
    } | null;
}
/**
 * Optional AI summary. `null` = never generated for this run —
 * the client renders the "Summarize my fixes" button but no body. The card
 * itself is only rendered when the feature is enabled at the environment
 * level (see `postSummary` controller + client `AI_SUMMARY_ENABLED` flag).
 */
export interface AuditReportAiSummary {
    text: string;
    locale: string;
    model: string;
    truncated: boolean;
    createdAt: string;
}
export type AuditReportAiSummaryStatus = AuditSummaryStatus;
export interface AuditReportAiSummaryAvailability {
    requestedLocale: SupportedLocale;
    availableLocales: SupportedLocale[];
    status: AuditReportAiSummaryStatus;
}
export interface AuditReport {
    runId: string;
    counts: FindingCounts;
    findings: LocalizedFinding[];
    diff: SnapshotDiff;
    /**
     * Page-speed section. `null` = the audit ran before PSI
     * sampling shipped or PSI is disabled. Client renders the compact
     * field-vs-lab block per rule row (labels always in plain language:
     * "what real visitors experienced" vs "our lab estimate").
     */
    pageSpeed: AuditReportPageSpeedSection | null;
    /**
     * Index-status section. `null` = the audit ran before GSC
     * wiring; UI shows a "connect Google Search Console" prompt. Otherwise
     * `status` labels the connection health and `samples[]` carries per-URL
     * verdicts the report renders as PASS / PARTIAL / FAIL / NEUTRAL badges.
     */
    indexStatus: AuditReportIndexStatusSection | null;
    /**
     * Search Analytics section. `null` = pre-feature snapshot or
     * no collector wired — the GscBlock renders a "connect Google Search
     * Console" prompt via the rule's `insufficientData` meta.
     */
    gscSearch: GscSearchSection | null;
    /** Sitemaps health section — same nullability contract. */
    gscSitemaps: GscSitemapsSection | null;
    /** AI Visibility section. */
    aiVisibility?: AiVisibilitySection | null;
    /** Local SEO section — NAP, reviews/Q&A, local-pack rank. */
    localSeo?: LocalSeoSection | null;
    /**
     * Cached AI summary. `null` = no successful generation yet;
     * aiSummaryStatus distinguishes idle, active, and failed jobs.
     */
    aiSummary: AuditReportAiSummary | null;
    /** Durable generation state; legacy snapshots infer this from aiSummary. */
    aiSummaryStatus: AuditReportAiSummaryStatus;
    /** Exact-locale availability; reads never generate or cross-locale fallback. */
    aiSummaryAvailability: AuditReportAiSummaryAvailability;
}
export interface GetAuditReportInput {
    runId: string;
    accountId: string;
    locale: SupportedLocale;
}
/**
 * Map the GSC inspection states a rule attached to its finding meta onto a
 * reason copy key. Returns null when the meta carries no state
 * (insufficientData findings, pre-feature snapshots) or no mapping fits —
 * the report then falls back to the generic `why` copy.
 */
export function resolveGscReasonKey(ruleId: string, meta: Record<string, unknown> | undefined): string | null {
    if (!meta)
        return null;
    const coverage = typeof meta.coverageState === 'string' ? meta.coverageState : '';
    if (ruleId === 'not-indexed') {
        const robots = typeof meta.robotsTxtState === 'string' ? meta.robotsTxtState : '';
        if (!coverage && !robots)
            return null;
        if (robots === 'DISALLOWED' || /robots/i.test(coverage)) {
            return 'auditRules.not-indexed.reasons.robotsBlocked';
        }
        if (/(404|unauthorized|fetch|redirect|error)/i.test(coverage)) {
            return 'auditRules.not-indexed.reasons.pageNotFetchable';
        }
        if (/unknown|discovered/i.test(coverage)) {
            return 'auditRules.not-indexed.reasons.coverageUnknown';
        }
        return null;
    }
    if (ruleId === 'index-partial') {
        const fetchState = typeof meta.pageFetchState === 'string' ? meta.pageFetchState : '';
        if (fetchState && fetchState !== 'SUCCESSFUL') {
            return 'auditRules.index-partial.reasons.pageFetchProblem';
        }
        if (coverage)
            return 'auditRules.index-partial.reasons.coverageWarning';
        return null;
    }
    return null;
}
function checkedAuditCopyKey(value: string): TranslationKey {
    if (!hasTranslationKey(value)) {
        throw new RangeError(`Unknown audit copy key: ${value}`);
    }
    return value;
}
export function localizeAuditRuleCopy(ruleId: string, locale: SupportedLocale, meta?: Record<string, unknown>): LocalizedRuleCopy {
    const reasonKey = resolveGscReasonKey(ruleId, meta);
    const titleKey = checkedAuditCopyKey(`auditRules.${ruleId}.title`);
    const whyKey = checkedAuditCopyKey(`auditRules.${ruleId}.why`);
    const fixKey = checkedAuditCopyKey(`auditRules.${ruleId}.fix`);
    const passedLabelKey = checkedAuditCopyKey(`auditRules.${ruleId}.passedLabel`);
    const title = localizeSemanticCopy(locale, titleKey);
    const why = localizeSemanticCopy(locale, whyKey);
    const fix = localizeSemanticCopy(locale, fixKey);
    const passed = localizeSemanticCopy(locale, passedLabelKey);
    const reason = reasonKey
        ? localizeSemanticCopy(locale, checkedAuditCopyKey(reasonKey))
        : null;
    return {
        title: title.message,
        why: why.message,
        fix: fix.message,
        passedLabel: passed.message,
        titleKey: title.messageKey,
        whyKey: why.messageKey,
        fixKey: fix.messageKey,
        passedLabelKey: passed.messageKey,
        ...(reason ? { reason: reason.message, reasonKey: reason.messageKey } : {}),
    };
}
/**
 * Load a report and localize copy for the caller. Diff is populated when the
 * previous run for the same site has its own snapshot; the first run of a
 * site returns an empty diff.
 */
export async function getAuditReport(input: GetAuditReportInput): Promise<AuditReport> {
    if (!Types.ObjectId.isValid(input.runId)) {
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    }
    const run = await AuditRun.findOne({ _id: input.runId, accountId: input.accountId });
    if (!run)
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    const snapshot = await ReportSnapshot.findOne({ runId: run._id });
    if (!snapshot)
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    const previousRun = await AuditRun.findOne({
        siteId: run.siteId,
        accountId: run.accountId,
        _id: { $lt: run._id },
    }).sort({ _id: -1 });
    const previousSnapshot = previousRun
        ? await ReportSnapshot.findOne({ runId: previousRun._id })
        : null;
    const diff = diffSnapshots(previousSnapshot
        ? { findings: previousSnapshot.findings as unknown as StoredFinding[] }
        : null, { findings: snapshot.findings as unknown as StoredFinding[] });
    // EVERY field that reaches the DTO must come from this plain conversion.
    // A Mongoose subdocument carries `$__parent` / `_doc` / `__parentArray`
    // back-references; `res.json()` hides them behind `toJSON`, but any consumer
    // that walks the object graph (the MCP denylist scan) hits the cycle and
    // fails. `counts` and `finding.meta` used to be handed over raw.
    const snapshotObj = snapshot.toObject() as unknown as {
        counts: FindingCounts;
        findings: Array<{
            ruleId: string;
            bucket: string;
            severity: string;
            affectedUrls: string[];
            meta?: Record<string, unknown> | null;
        }>;
        pageSpeed?: AuditReportPageSpeedSection | null;
        indexStatus?: AuditReportIndexStatusSection | null;
        gscSearch?: GscSearchSection | null;
        gscSitemaps?: {
            status: GscSitemapsStatus;
            sitemaps: Array<{
                path: string;
                errors: number;
                warnings: number;
                processed: number;
                lastDownloaded: Date | string | null;
            }>;
        } | null;
        aiVisibility?: (AiVisibilityEvaluationInput & {
            sentiment?: {
                positive: number;
                neutral: number;
                negative: number;
            };
            notMentionedPrompts?: string[];
        }) | null;
        localSeo?: LocalSeoEvaluationInput | null;
    };
    const brokenFinding = snapshotObj.findings.find((finding) => finding.ruleId === 'broken-internal-links' && finding.bucket !== 'passed');
    const storedBrokenLinkTargets = brokenFinding?.meta?.brokenLinkTargets;
    const brokenLinkTargets = Array.isArray(storedBrokenLinkTargets)
        ? storedBrokenLinkTargets.filter((url): url is string => typeof url === 'string')
        : brokenFinding
            ? (await AuditedPage.distinct('brokenLinks', { runId: run._id })).filter((url): url is string => typeof url === 'string')
            : [];
    const findings: LocalizedFinding[] = snapshotObj.findings.map((f) => ({
        ruleId: f.ruleId as RuleFinding['ruleId'],
        bucket: f.bucket as RuleFinding['bucket'],
        severity: f.severity as RuleFinding['severity'],
        affectedUrls: [...f.affectedUrls],
        ...(f.meta ? { meta: f.meta } : {}),
        copy: localizeAuditRuleCopy(f.ruleId, input.locale, f.meta ?? undefined),
        ...(isAuditCodeFixEligible(f)
            ? { codeFixPromptAvailable: true as const }
            : {}),
        ...(f.ruleId === 'broken-internal-links' && brokenLinkTargets.length > 0
            ? { brokenLinkTargets }
            : {}),
    }));
    const pageSpeed: AuditReportPageSpeedSection | null = snapshotObj.pageSpeed && snapshotObj.pageSpeed.status
        ? {
            status: snapshotObj.pageSpeed.status,
            samples: snapshotObj.pageSpeed.samples.map((s) => ({ ...s })),
        }
        : null;
    const indexStatus: AuditReportIndexStatusSection | null = snapshotObj.indexStatus && snapshotObj.indexStatus.status
        ? {
            status: snapshotObj.indexStatus.status,
            samples: snapshotObj.indexStatus.samples.map((s) => ({
                url: s.url,
                inspection: {
                    ...s.inspection,
                    richResults: {
                        verdict: s.inspection.richResults.verdict,
                        items: s.inspection.richResults.items.map((it) => ({ ...it })),
                    },
                },
            })),
        }
        : null;
    const gscSearch: GscSearchSection | null = snapshotObj.gscSearch && snapshotObj.gscSearch.status
        ? {
            status: snapshotObj.gscSearch.status,
            totalClicks: snapshotObj.gscSearch.totalClicks,
            totalImpressions: snapshotObj.gscSearch.totalImpressions,
            averageCtr: snapshotObj.gscSearch.averageCtr,
            averagePosition: snapshotObj.gscSearch.averagePosition,
            topQueries: snapshotObj.gscSearch.topQueries.map((q) => ({ ...q })),
            topPages: snapshotObj.gscSearch.topPages.map((p) => ({ ...p })),
            delta: {
                clicks: snapshotObj.gscSearch.delta?.clicks ?? null,
                impressions: snapshotObj.gscSearch.delta?.impressions ?? null,
            },
        }
        : null;
    const gscSitemaps: GscSitemapsSection | null = snapshotObj.gscSitemaps && snapshotObj.gscSitemaps.status
        ? {
            status: snapshotObj.gscSitemaps.status,
            sitemaps: snapshotObj.gscSitemaps.sitemaps.map((s) => ({
                path: s.path,
                errors: s.errors,
                warnings: s.warnings,
                processed: s.processed,
                lastDownloaded: s.lastDownloaded === null || s.lastDownloaded === undefined
                    ? null
                    : new Date(s.lastDownloaded).toISOString(),
            })),
        }
        : null;
    const selectedSummary = selectAuditSummaryLocale(snapshot, input.locale);
    const aiSummary: AuditReportAiSummary | null = selectedSummary.aiSummary;
    const aiSummaryStatus = selectedSummary.status;
    const aiVisibility: AiVisibilitySection | null = snapshotObj.aiVisibility && snapshotObj.aiVisibility.status
        ? {
            status: snapshotObj.aiVisibility.status,
            aiOverviewCitedCount: snapshotObj.aiVisibility.aiOverviewCitedCount,
            aiOverviewTotalChecked: snapshotObj.aiVisibility.aiOverviewTotalChecked,
            llmMentionedCount: snapshotObj.aiVisibility.llmMentionedCount,
            llmTotalChecked: snapshotObj.aiVisibility.llmTotalChecked,
            shareOfVoicePct: snapshotObj.aiVisibility.shareOfVoicePct,
            sentiment: snapshotObj.aiVisibility.sentiment ?? {
                positive: 0,
                neutral: 0,
                negative: snapshotObj.aiVisibility.negativeSentimentCount,
            },
            /* c8 ignore next -- notMentionedPrompts added post-launch; the ?? [] handles legacy snapshots that predate the field. */
            notMentionedPrompts: snapshotObj.aiVisibility.notMentionedPrompts ?? [],
        }
        : null;
    const localSeo: LocalSeoSection | null = snapshotObj.localSeo && snapshotObj.localSeo.status
        ? {
            status: snapshotObj.localSeo.status,
            listings: snapshotObj.localSeo.listings.map((l) => ({ ...l })),
            reviews: snapshotObj.localSeo.reviews ? { ...snapshotObj.localSeo.reviews } : null,
            qa: snapshotObj.localSeo.qa ? { ...snapshotObj.localSeo.qa } : null,
            localPack: snapshotObj.localSeo.localPack ? { ...snapshotObj.localSeo.localPack } : null,
        }
        : null;
    return {
        runId: run.id as string,
        counts: snapshotObj.counts,
        findings,
        diff,
        pageSpeed,
        indexStatus,
        gscSearch,
        gscSitemaps,
        aiVisibility,
        localSeo,
        aiSummary,
        aiSummaryStatus,
        aiSummaryAvailability: {
            requestedLocale: selectedSummary.requestedLocale,
            availableLocales: selectedSummary.availableLocales,
            status: selectedSummary.status,
        },
    };
}
export interface GetLatestSiteReportInput {
    accountId: string;
    siteId: string;
    locale: SupportedLocale;
}
export interface LatestSiteReport {
    runId: string;
    report: AuditReport;
}
/**
 * Own the site, take its newest succeeded run, load that run's localized
 * report.
 *
 * One authority for every "latest report for this site" caller. The MCP tool
 * and the public /api/v1 handler each hand-rolled this same three-step
 * sequence, which is how a defect could live in one path while the other
 * stayed healthy. A site the caller does not own, a site claimed for deletion,
 * and a site with no succeeded run are all indistinguishable 404s.
 */
export async function getLatestSiteReport(input: GetLatestSiteReportInput): Promise<LatestSiteReport> {
    const site = await Site.findOne({
        _id: input.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    const run = await AuditRun.findOne({
        siteId: site._id,
        accountId: input.accountId,
        status: 'succeeded',
    }).sort({ _id: -1 });
    if (!run)
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    const runId = String(run._id);
    const report = await getAuditReport({
        runId,
        accountId: input.accountId,
        locale: input.locale,
    });
    return { runId, report };
}
