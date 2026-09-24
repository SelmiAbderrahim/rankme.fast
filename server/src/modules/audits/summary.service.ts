/**
 * Durable AI-summary orchestration.
 *
 * The API validates ownership/provider input, atomically claims the
 * snapshot, and enqueues a one-attempt job. The
 * worker is the only caller that spends with the provider. Summary state is
 * persisted on ReportSnapshot so polling survives refreshes and deploys.
 */
import type { Queue } from "bullmq";
import { Types } from "mongoose";
import type { Logger } from "pino";
import type { SupportedLocale } from "../../shared/i18n/index.js";
import { translate } from "../../shared/i18n/index.js";
import type { SummaryFindingInput, SummaryProvider, } from "../../shared/providers/index.js";
import { enqueueAuditSummaryJob } from "../../shared/queue/index.js";
import { HttpError } from "../../shared/utils/http-error.js";
import { Site } from "../sites/index.js";
import { AuditRun, type AuditRunHydrated } from "./audit-run.model.js";
import { ReportSnapshot, type ReportSnapshotHydrated, } from "./report-snapshot.model.js";
import { selectAuditSummaryLocale, type AuditSummaryState, type PersistedAiSummary, } from './summary.selection.js';
export type { AuditSummaryState, AuditSummaryStatus, PersistedAiSummary, } from './summary.selection.js';
export interface AuditSummaryInput {
    runId: string;
    accountId: string;
    locale: SupportedLocale;
}
export interface StartAuditSummaryDeps {
    provider: SummaryProvider | null;
    queue: Queue | null;
    now?: () => Date;
    generationId?: () => string;
}
export interface GenerateAuditSummaryDeps {
    provider: SummaryProvider | null;
    logger?: Pick<Logger, "info">;
    now?: () => Date;
    archiveVendorResponse?: (input: {
        capability: "summary";
        operation: string;
        params: Record<string, unknown>;
        payload: unknown;
        accountId: string;
        fetchedAt: Date;
    }) => Promise<void>;
}
interface OwnedSummaryContext {
    run: AuditRunHydrated;
    snapshot: ReportSnapshotHydrated;
}
function localizedTitle(ruleId: string, locale: SupportedLocale): string {
    return translate(locale, `auditRules.${ruleId}.title`);
}
function localizedWhy(ruleId: string, locale: SupportedLocale): string {
    return translate(locale, `auditRules.${ruleId}.why`);
}
function localizedFix(ruleId: string, locale: SupportedLocale): string {
    return translate(locale, `auditRules.${ruleId}.fix`);
}
export function toAuditSummaryState(snapshot: ReportSnapshotHydrated, locale: SupportedLocale): AuditSummaryState {
    return selectAuditSummaryLocale(snapshot, locale);
}
async function loadOwnedSummaryContext(input: Pick<AuditSummaryInput, "runId" | "accountId">): Promise<OwnedSummaryContext> {
    if (!Types.ObjectId.isValid(input.runId)) {
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: "audits.errors.notFound" });
    }
    const run = await AuditRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
    });
    if (!run)
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: "audits.errors.notFound" });
    const liveSite = await Site.exists({
        _id: run.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    });
    if (!liveSite)
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: "audits.errors.notFound" });
    const snapshot = await ReportSnapshot.findOne({ runId: run._id });
    if (!snapshot)
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: "audits.errors.notFound" });
    return { run, snapshot };
}
async function buildProviderInput(input: AuditSummaryInput, context: OwnedSummaryContext, correlationId?: string) {
    const site = await Site.findOne({
        _id: context.run.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    });
    if (!site)
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: "audits.errors.notFound" });
    const findings: SummaryFindingInput[] = context.snapshot.findings
        .filter((finding) => finding.bucket === "fix-now")
        .map((finding) => ({
        ruleId: finding.ruleId,
        title: localizedTitle(finding.ruleId, input.locale),
        why: localizedWhy(finding.ruleId, input.locale),
        fix: localizedFix(finding.ruleId, input.locale),
        affectedCount: finding.affectedUrls.length,
    }));
    return {
        findings,
        locale: input.locale,
        siteDomain: site.domain,
        usage: {
            accountId: input.accountId,
            siteId: String(context.run.siteId),
            jobId: input.runId,
        },
        ...(correlationId ? { correlationId } : {}),
    };
}
/** Read the durable polling state, preserving compatibility with old snapshots. */
export async function getAuditSummaryState(input: AuditSummaryInput): Promise<AuditSummaryState> {
    const { snapshot } = await loadOwnedSummaryContext(input);
    return toAuditSummaryState(snapshot, input.locale);
}
/**
 * Claim and enqueue one generation. Concurrent POSTs dedupe on the
 * snapshot claim; the loser receives the winner's state.
 */
export async function startAuditSummary(input: AuditSummaryInput, deps: StartAuditSummaryDeps): Promise<AuditSummaryState> {
    if (!deps.provider) {
        throw new HttpError(503, { code: 'AUDITS_AI_SUMMARY_ERRORS_UNAVAILABLE', messageKey: "audits.aiSummary.errors.unavailable" });
    }
    if (!deps.queue) {
        throw new HttpError(503, { code: 'AUDITS_ERRORS_QUEUE_UNAVAILABLE', messageKey: "audits.errors.queueUnavailable" });
    }
    const context = await loadOwnedSummaryContext(input);
    const paused = await Site.exists({
        _id: context.run.siteId,
        accountId: input.accountId,
        paused: true,
        deletionStartedAt: null,
    });
    if (paused)
        throw HttpError.conflict({ code: 'SITES_ERRORS_PAUSED', messageKey: "sites.errors.paused" });
    const current = toAuditSummaryState(context.snapshot, input.locale);
    if (current.status === "queued" || current.status === "running")
        return current;
    const providerInput = await buildProviderInput(input, context);
    deps.provider.preflightSummarize?.(providerInput);
    const generationId = deps.generationId?.() ?? new Types.ObjectId().toHexString();
    const requestedAt = deps.now?.() ?? new Date();
    const claimed = await ReportSnapshot.findOneAndUpdate({
        _id: context.snapshot._id,
        [`aiSummaryJobsByLocale.${input.locale}.status`]: { $nin: ["queued", "running"] },
    }, {
        $set: {
            [`aiSummaryJobsByLocale.${input.locale}`]: {
                generationId,
                locale: input.locale,
                status: "queued",
                requestedAt,
                startedAt: null,
                finishedAt: null,
            },
        },
    }, { new: true });
    if (!claimed)
        return getAuditSummaryState(input);
    try {
        await enqueueAuditSummaryJob(deps.queue, {
            accountId: input.accountId,
            runId: input.runId,
            generationId,
            locale: input.locale,
        });
    }
    catch {
        await ReportSnapshot.updateOne({
            _id: claimed._id,
            [`aiSummaryJobsByLocale.${input.locale}.generationId`]: generationId,
            [`aiSummaryJobsByLocale.${input.locale}.status`]: "queued",
        }, {
            $set: {
                [`aiSummaryJobsByLocale.${input.locale}.status`]: "failed",
                [`aiSummaryJobsByLocale.${input.locale}.finishedAt`]: deps.now?.() ?? new Date(),
            },
        });
        throw new HttpError(503, { code: 'AUDITS_ERRORS_QUEUE_UNAVAILABLE', messageKey: "audits.errors.queueUnavailable" });
    }
    return toAuditSummaryState(claimed as ReportSnapshotHydrated, input.locale);
}
/** Run the provider once. Persistence is owned by the summary processor. */
export async function generateAuditSummary(input: AuditSummaryInput & {
    generationId: string;
}, deps: GenerateAuditSummaryDeps): Promise<PersistedAiSummary> {
    if (!deps.provider) {
        throw new HttpError(503, { code: 'AUDITS_AI_SUMMARY_ERRORS_UNAVAILABLE', messageKey: "audits.aiSummary.errors.unavailable" });
    }
    const context = await loadOwnedSummaryContext(input);
    const providerInput = await buildProviderInput(input, context, input.generationId);
    deps.provider.preflightSummarize?.(providerInput);
    try {
        const result = await deps.provider.summarize(providerInput);
        const now = deps.now?.() ?? new Date();
        if (deps.archiveVendorResponse) {
            await deps.archiveVendorResponse({
                capability: "summary",
                operation: "summarize",
                params: {
                    accountId: input.accountId,
                    runId: input.runId,
                    locale: input.locale,
                },
                payload: {
                    model: result.model,
                    truncated: result.truncated,
                    profile: "audit_summary",
                    outputSchemaVersion: "1",
                },
                accountId: input.accountId,
                fetchedAt: now,
            });
        }
        deps.logger?.info({
            accountId: input.accountId,
            runId: input.runId,
            model: result.model,
            findingCount: providerInput.findings.length,
            locale: input.locale,
            outcome: "ok",
        }, "ai summary generated");
        return {
            text: result.summary,
            locale: input.locale,
            model: result.model,
            truncated: result.truncated,
            createdAt: now.toISOString(),
        };
    }
    catch (error) {
        deps.logger?.info({
            accountId: input.accountId,
            runId: input.runId,
            model: "unknown",
            findingCount: providerInput.findings.length,
            locale: input.locale,
            outcome: "error",
            error: error instanceof Error ? error.name : "unknown",
        }, "ai summary call failed");
        throw error;
    }
}
