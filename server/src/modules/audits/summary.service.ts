/**
 * Durable AI-summary orchestration.
 *
 * The API validates ownership/provider input, atomically claims the
 * snapshot, and enqueues a one-attempt job. The
 * worker is the only caller that spends with the provider. Summary state is
 * persisted on ReportSnapshot so polling survives refreshes and deploys.
 *
 * A summary covers only what the report counts as open: findings the owner
 * dismissed or marked fixed are left out (and named as dismissed), exactly as
 * the report leaves them out of its counts. Every generated summary is checked
 * against its input before it is stored.
 */
import { createHash } from "node:crypto";
import type { Queue } from "bullmq";
import { Types } from "mongoose";
import type { Logger } from "pino";
import type { SupportedLocale } from "../../shared/i18n/index.js";
import { translate } from "../../shared/i18n/index.js";
import { composeSummaryText, type SummarizeInput, type SummarizeResult, type SummaryDismissedInput, type SummaryFindingInput, type SummaryProvider, type SummaryStructuredOutput, } from "../../shared/providers/index.js";
import { enqueueAuditSummaryJob } from "../../shared/queue/index.js";
import { HttpError } from "../../shared/utils/http-error.js";
import { isNotEvaluatedFinding } from "../../shared/audit-findings.js";
import type { ActionEventsDb } from "../actions/actions.events.repo.js";
import { isResolvedAuditDecision, type AuditDecision, } from "../actions/audit-decisions.js";
import { Site } from "../sites/index.js";
import { AuditRun, type AuditRunHydrated } from "./audit-run.model.js";
import { ReportSnapshot, type ReportSnapshotHydrated, } from "./report-snapshot.model.js";
import { applyDismissals, isUncountedDecision } from "./report-dismissals.js";
import { getAuditReport } from "./report.service.js";
import { summaryActArea } from "./summary-act-area.js";
import { validateAuditSummary } from "./summary-validator.js";
import { buildDeterministicSummary, DETERMINISTIC_SUMMARY_MODEL, leaksPromptWording, } from './summary.guard.js';
import { selectAuditSummaryLocale, selectAuditSummaryProgress, type AuditSummaryFreshness, type AuditSummaryProgress, type AuditSummaryState, type PersistedAiSummary, type PersistedSummaryStructured, } from './summary.selection.js';
export type { AuditSummaryFreshness, AuditSummaryProgress, AuditSummaryState, AuditSummaryStatus, PersistedAiSummary, } from './summary.selection.js';
export interface AuditSummaryInput {
    runId: string;
    accountId: string;
    locale: SupportedLocale;
}
export interface StartAuditSummaryDeps {
    /** The decisions store; without it no finding is left out of the summary. */
    db?: ActionEventsDb;
    provider: SummaryProvider | null;
    queue: Queue | null;
    now?: () => Date;
    generationId?: () => string;
}
/** The stages a running job reports on its way to the provider call. */
export type AuditSummaryWorkStage = 'checking_priorities' | 'writing_summary';
export interface GenerateAuditSummaryDeps {
    provider: SummaryProvider | null;
    /** Called as the job moves on; the processor persists it. */
    onStage?: (stage: AuditSummaryWorkStage) => Promise<void>;
    /** Reads the owner's finding decisions; without it no finding is excluded. */
    db?: ActionEventsDb;
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
/** Profile input ceiling (`audit_summary` accepts at most 25 findings). */
export const MAX_SUMMARY_FINDINGS = 25;
const SUMMARY_PRIORITIES = ["fix-now", "watch"] as const;
interface StoredSummaryFinding {
    ruleId: string;
    bucket: string;
    affectedUrls: string[];
    meta?: Record<string, unknown> | null | undefined;
    comparisonStatus?: SummaryFindingInput['comparisonStatus'];
}
/** Evidence lines per finding (profile ceiling). */
export const MAX_SUMMARY_EVIDENCE_LINES = 4;
interface StoredHostVariant {
    scheme: string;
    host: string;
    status: number | null;
    finalUrl: string | null;
    outcome: string;
}
function readHostVariants(meta: unknown): {
    canonicalOrigin: string;
    variants: StoredHostVariant[];
} | null {
    if (typeof meta !== 'object' || meta === null)
        return null;
    const evidence = (meta as {
        hostVariants?: unknown;
    }).hostVariants;
    if (typeof evidence !== 'object' || evidence === null)
        return null;
    const { canonicalOrigin, variants } = evidence as {
        canonicalOrigin?: unknown;
        variants?: unknown;
    };
    if (typeof canonicalOrigin !== 'string' || !Array.isArray(variants))
        return null;
    return {
        canonicalOrigin,
        variants: variants.filter((v): v is StoredHostVariant => typeof v === 'object' &&
            v !== null &&
            typeof (v as StoredHostVariant).scheme === 'string' &&
            typeof (v as StoredHostVariant).outcome === 'string'),
    };
}
/** `https://www.example.com/x` → `www.example.com over https` (no raw URL: the AI input sanitizer strips links). */
function describeAddress(raw: string | null): string {
    if (!raw)
        return 'no answer';
    try {
        const url = new URL(raw);
        return `${url.host} over ${url.protocol.replace(':', '')}`;
    }
    catch {
        return 'an unreadable address';
    }
}
/**
 * Site-wide evidence for a finding with no affected pages. Today only the
 * `https-canonicalization` host-variant probe produces it: one line per
 * probed address that does NOT end on the canonical origin, so the model
 * can say what is wrong instead of reading "0 pages" as "nothing wrong".
 */
export function summaryEvidenceFor(finding: StoredSummaryFinding): string[] {
    if (finding.ruleId !== 'https-canonicalization')
        return [];
    const evidence = readHostVariants(finding.meta);
    if (!evidence)
        return [];
    const expected = describeAddress(evidence.canonicalOrigin);
    return evidence.variants
        .filter((variant) => variant.outcome === 'not-canonical')
        .slice(0, MAX_SUMMARY_EVIDENCE_LINES)
        .map((variant) => {
        const requested = `the ${variant.scheme} ${variant.host === 'www' ? 'www' : 'non-www'} address`;
        const status = variant.status === null ? 'no status' : `status ${variant.status}`;
        return `${requested} answers with ${status} and ends on ${describeAddress(variant.finalUrl)} instead of ${expected}`;
    });
}
/**
 * The actionable findings a summary covers: every Fix-now finding first,
 * then Watch findings, bounded to the profile ceiling. A finding whose check
 * could not run (`meta.insufficientData === true`, whatever bucket stored it)
 * is not a problem on the site and is never presented as one; passed
 * findings are excluded by the bucket allow-list.
 *
 * Every selected finding is an open problem. A finding with no affected
 * URLs is marked `siteWide` (never "no affected pages") and carries its
 * site-wide evidence when the audit stored some. The caller removes the
 * findings the owner dismissed or marked fixed before selecting.
 */
export function selectSummaryFindings(findings: readonly StoredSummaryFinding[], locale: SupportedLocale): SummaryFindingInput[] {
    const selected: SummaryFindingInput[] = [];
    for (const priority of SUMMARY_PRIORITIES) {
        for (const finding of findings) {
            if (finding.bucket !== priority || isNotEvaluatedFinding({ bucket: finding.bucket, meta: finding.meta ?? null }))
                continue;
            const evidence = summaryEvidenceFor(finding);
            selected.push({
                ruleId: finding.ruleId,
                priority,
                title: localizedTitle(finding.ruleId, locale),
                why: localizedWhy(finding.ruleId, locale),
                fix: localizedFix(finding.ruleId, locale),
                affectedCount: finding.affectedUrls.length,
                ...(finding.affectedUrls.length === 0 ? { siteWide: true } : {}),
                ...(evidence.length > 0 ? { evidence } : {}),
                ...(finding.comparisonStatus ? { comparisonStatus: finding.comparisonStatus } : {}),
            });
        }
    }
    return selected.slice(0, MAX_SUMMARY_FINDINGS);
}
/**
 * Model id recorded for the deterministic "nothing to fix" summary. No AI
 * call is made for it.
 */
export const NOTHING_URGENT_SUMMARY_MODEL = "deterministic:nothing-actionable";
function nothingUrgentSummary(locale: SupportedLocale, siteDomain: string, now: Date, inputHash: string): PersistedAiSummary {
    return {
        basisRuleIds: [],
        inputHash,
        text: translate(locale, "audits.aiSummary.nothingActionable", { domain: siteDomain }),
        locale,
        model: NOTHING_URGENT_SUMMARY_MODEL,
        truncated: false,
        createdAt: now.toISOString(),
    };
}
/** What a summary is built from, and the hash that identifies it. */
interface SummaryBasis {
    siteDomain: string;
    findings: SummaryFindingInput[];
    dismissed: SummaryDismissedInput[];
    /** Decisions on the report's findings, for summaries stored before input hashes. */
    decisions: Map<string, AuditDecision>;
    inputHash: string;
}
/**
 * Hash of a summary's inputs: the open findings it covers (rule, priority,
 * affected count), the dismissed findings, and every decision state on the
 * report's findings. Any dismissal, restore, fix or reopen changes it.
 */
export function summaryInputHash(input: {
    findings: readonly Pick<SummaryFindingInput, 'ruleId' | 'priority' | 'affectedCount'>[];
    dismissed: readonly Pick<SummaryDismissedInput, 'ruleId' | 'affectedCount'>[];
    decisions: ReadonlyArray<readonly [string, string, boolean]>;
}): string {
    const canonical = JSON.stringify({
        findings: input.findings.map((f) => [f.ruleId, f.priority ?? null, f.affectedCount]),
        dismissed: [...input.dismissed].map((d) => [d.ruleId, d.affectedCount]).sort(),
        decisions: [...input.decisions].map((d) => [...d]).sort(),
    });
    return createHash('sha256').update(canonical).digest('hex');
}
/**
 * The report as every reader sees it (decisions applied through the one
 * `applyDismissals`), reduced to what the summary may talk about: the open
 * Fix-now and Watch findings with their comparison status, and the findings
 * the owner dismissed. A finding resurfaced by a later audit is open again.
 */
async function summaryBasis(input: AuditSummaryInput, context: OwnedSummaryContext, db: ActionEventsDb | undefined): Promise<SummaryBasis> {
    const site = await Site.findOne({
        _id: context.run.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    });
    if (!site)
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: "audits.errors.notFound" });
    const report = await applyDismissals(await getAuditReport({ accountId: input.accountId, runId: input.runId, locale: input.locale }), { accountId: input.accountId, siteId: String(context.run.siteId), db });
    const findings = selectSummaryFindings(report.findings.filter((finding) => !isUncountedDecision(finding.decision)), input.locale);
    const dismissed = report.findings
        .filter((finding) => finding.decision?.state === 'dismissed' && isUncountedDecision(finding.decision))
        .map((finding) => ({
        ruleId: finding.ruleId as string,
        title: localizedTitle(finding.ruleId, input.locale),
        affectedCount: finding.affectedUrls.length,
    }));
    const decided = report.findings.flatMap((finding) => finding.decision ? [{ ruleId: finding.ruleId as string, decision: finding.decision }] : []);
    return {
        siteDomain: site.domain,
        findings,
        dismissed,
        decisions: new Map(decided.map(({ ruleId, decision }) => [
            ruleId,
            {
                state: decision.state,
                regressed: decision.regressed,
                decidedAt: new Date(decision.decidedAt),
                actorUserId: '',
                ordinal: 0,
            },
        ])),
        inputHash: summaryInputHash({
            findings,
            dismissed,
            decisions: decided.map(({ ruleId, decision }) => [ruleId, decision.state, decision.regressed] as const),
        }),
    };
}
function toProviderInput(input: AuditSummaryInput, context: OwnedSummaryContext, basis: SummaryBasis, correlationId?: string): SummarizeInput {
    return {
        findings: basis.findings,
        ...(basis.dismissed.length > 0 ? { dismissed: basis.dismissed } : {}),
        locale: input.locale,
        siteDomain: basis.siteDomain,
        usage: {
            accountId: input.accountId,
            siteId: String(context.run.siteId),
            jobId: input.runId,
        },
        ...(correlationId ? { correlationId } : {}),
    };
}
/** Read the durable polling state, preserving compatibility with old snapshots. */
export async function getAuditSummaryState(input: AuditSummaryInput, deps: {
    db?: ActionEventsDb;
} = {}): Promise<AuditSummaryState> {
    const context = await loadOwnedSummaryContext(input);
    const state = toAuditSummaryState(context.snapshot, input.locale);
    if (!deps.db)
        return state;
    const freshness = await summaryFreshnessFor(state, input, context, deps.db);
    return freshness ? { ...state, freshness } : state;
}
/**
 * Progress of this locale's latest summary job, read for the polling card.
 * Ownership is proved the same way as the state read.
 */
export async function getAuditSummaryProgress(input: AuditSummaryInput, now: Date = new Date()): Promise<AuditSummaryProgress | null> {
    const context = await loadOwnedSummaryContext(input);
    return selectAuditSummaryProgress(context.snapshot, input.locale, now);
}
/**
 * Whether a stored summary still describes the open findings. Read-only: a
 * stale summary is only flagged, never regenerated here, because
 * regeneration calls the AI provider and stays a user action.
 */
export async function summaryFreshnessFor(state: Pick<AuditSummaryState, 'aiSummary'>, input: AuditSummaryInput, context: OwnedSummaryContext, db: ActionEventsDb): Promise<AuditSummaryFreshness | null> {
    const summary = state.aiSummary;
    if (!summary)
        return null;
    const basis = await summaryBasis(input, context, db);
    return evaluateSummaryFreshness(summary, basis.findings.map((finding) => finding.ruleId), basis.decisions, basis.inputHash);
}
/**
 * Compare a summary with today's open findings. Summaries stored with their
 * evidence basis are compared rule by rule; older summaries carry no basis, so
 * they are stale when any rule was dismissed, fixed or reopened after they
 * were written.
 */
export function evaluateSummaryFreshness(summary: Pick<PersistedAiSummary, 'createdAt' | 'basisRuleIds' | 'inputHash'>, currentRuleIds: readonly string[], decisions: ReadonlyMap<string, AuditDecision>, currentInputHash?: string): AuditSummaryFreshness {
    const basis = summary.basisRuleIds;
    if (basis) {
        const covered = new Set(basis);
        const current = new Set(currentRuleIds);
        const changed = [
            ...basis.filter((ruleId) => !current.has(ruleId)),
            ...currentRuleIds.filter((ruleId) => !covered.has(ruleId)),
        ];
        // A summary that recorded its input hash is stale whenever that hash
        // differs: a dismissal or restore changes it even when the open rule set
        // happens to match.
        const hashChanged = summary.inputHash !== undefined &&
            currentInputHash !== undefined &&
            summary.inputHash !== currentInputHash;
        const stale = changed.length > 0 || hashChanged;
        return {
            stale,
            reason: stale ? 'triage_changed' : null,
            evidenceRuleIds: [...basis],
            changedRuleIds: changed,
        };
    }
    const writtenAt = Date.parse(summary.createdAt);
    const changed = [...decisions]
        .filter(([, decision]) => decision.decidedAt.getTime() > writtenAt &&
        (isResolvedAuditDecision(decision.state) || decision.regressed))
        .map(([ruleId]) => ruleId);
    return {
        stale: changed.length > 0,
        reason: changed.length > 0 ? 'triage_changed' : null,
        evidenceRuleIds: null,
        changedRuleIds: changed,
    };
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
    const basis = await summaryBasis(input, context, deps.db);
    const providerInput = toProviderInput(input, context, basis);
    const generationId = deps.generationId?.() ?? new Types.ObjectId().toHexString();
    if (providerInput.findings.length === 0) {
        // Nothing in Fix now or Watch: answer deterministically instead of
        // asking a model to summarize an empty list. Same atomic claim, so a
        // concurrent POST still dedupes.
        const finishedAt = deps.now?.() ?? new Date();
        const summary = nothingUrgentSummary(input.locale, providerInput.siteDomain, finishedAt, basis.inputHash);
        const settled = await ReportSnapshot.findOneAndUpdate({
            _id: context.snapshot._id,
            [`aiSummaryJobsByLocale.${input.locale}.status`]: { $nin: ["queued", "running"] },
        }, {
            $set: {
                [`aiSummaryVariantsByLocale.${input.locale}`]: {
                    ...summary,
                    createdAt: finishedAt,
                },
                [`aiSummaryJobsByLocale.${input.locale}`]: {
                    generationId,
                    locale: input.locale,
                    status: "succeeded",
                    requestedAt: finishedAt,
                    startedAt: finishedAt,
                    finishedAt,
                },
            },
        }, { new: true });
        if (!settled)
            return getAuditSummaryState(input, deps.db ? { db: deps.db } : {});
        return toAuditSummaryState(settled as ReportSnapshotHydrated, input.locale);
    }
    deps.provider.preflightSummarize?.(providerInput);
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
        return getAuditSummaryState(input, deps.db ? { db: deps.db } : {});
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
/** Generations per summary job: the first, plus one regeneration after a rejected output. */
export const SUMMARY_MAX_GENERATIONS = 2;
function withActAreas(structured: SummaryStructuredOutput): PersistedSummaryStructured {
    return {
        status: structured.status,
        items: structured.items.map((item) => ({ ...item, whereToAct: summaryActArea(item.ruleId) })),
    };
}
/**
 * The summary shown when every generation was rejected: the rule copy of the
 * top three open findings, never model text. Nothing it says can be wrong
 * that the report itself does not say.
 */
export function fallbackStructuredSummary(input: SummarizeInput): SummaryStructuredOutput {
    const fixNow = input.findings.filter((f) => f.priority !== 'watch').length;
    const watch = input.findings.filter((f) => f.priority === 'watch').length;
    return {
        status: translate(input.locale, 'audits.aiSummary.fallbackStatus', {
            domain: input.siteDomain,
            fixNow: String(fixNow),
            watch: String(watch),
        }),
        items: input.findings.slice(0, 3).map((f) => ({
            ruleId: f.ruleId,
            what: f.title,
            why: f.why,
            firstStep: f.fix,
        })),
    };
}
/**
 * Run the provider, check every output against its input, and regenerate a
 * rejected one. Persistence is owned by the summary processor.
 */
export async function generateAuditSummary(input: AuditSummaryInput & {
    generationId: string;
}, deps: GenerateAuditSummaryDeps): Promise<PersistedAiSummary> {
    if (!deps.provider) {
        throw new HttpError(503, { code: 'AUDITS_AI_SUMMARY_ERRORS_UNAVAILABLE', messageKey: "audits.aiSummary.errors.unavailable" });
    }
    const context = await loadOwnedSummaryContext(input);
    const basis = await summaryBasis(input, context, deps.db);
    await deps.onStage?.('checking_priorities');
    const providerInput = toProviderInput(input, context, basis, input.generationId);
    if (providerInput.findings.length === 0) {
        // Only reachable for a job enqueued before the API answered empty
        // selections deterministically — never spend a model call on it.
        return nothingUrgentSummary(input.locale, providerInput.siteDomain, deps.now?.() ?? new Date(), basis.inputHash);
    }
    deps.provider.preflightSummarize?.(providerInput);
    await deps.onStage?.('writing_summary');
    try {
        let result: SummarizeResult | null = null;
        let leaked = false;
        let attempts = 0;
        while (attempts < SUMMARY_MAX_GENERATIONS) {
            attempts += 1;
            const candidate = await deps.provider.summarize(providerInput);
            // The text describes the request payload instead of the site: never
            // persist it. A deterministic summary replaces it, so the owner still
            // gets an answer without another paid attempt.
            if (leaksPromptWording(candidate.summary, input.locale)) {
                leaked = true;
                break;
            }
            const validation = validateAuditSummary({ text: candidate.summary, structured: candidate.structured }, providerInput);
            if (validation.ok) {
                result = candidate;
                break;
            }
            // Content-free: only the rejection kinds, never the text.
            deps.logger?.info({ accountId: input.accountId, runId: input.runId, attempt: attempts, issues: validation.issues }, "ai summary rejected by validator");
        }
        const now = deps.now?.() ?? new Date();
        const fallback = result ? null : fallbackStructuredSummary(providerInput);
        const accepted = result as SummarizeResult;
        const outcome = fallback
            ? {
                text: leaked ? buildDeterministicSummary(input.locale, providerInput.findings) : composeSummaryText(fallback),
                structured: fallback,
                model: DETERMINISTIC_SUMMARY_MODEL,
                truncated: false,
            }
            : { text: accepted.summary, structured: accepted.structured, model: accepted.model, truncated: accepted.truncated };
        const { structured, model } = outcome;
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
                    model,
                    truncated: outcome.truncated,
                    profile: "audit_summary",
                    outputSchemaVersion: "1",
                    attempts,
                    accepted: result !== null,
                },
                accountId: input.accountId,
                fetchedAt: now,
            });
        }
        deps.logger?.info({
            accountId: input.accountId,
            runId: input.runId,
            model,
            findingCount: providerInput.findings.length,
            locale: input.locale,
            outcome: result ? "ok" : leaked ? "leak-fallback" : "fallback",
            attempts,
        }, "ai summary generated");
        return {
            text: outcome.text,
            locale: input.locale,
            model,
            truncated: outcome.truncated,
            createdAt: now.toISOString(),
            // The findings the model was given: the only evidence the text may rest on.
            basisRuleIds: providerInput.findings.map((finding) => finding.ruleId),
            inputHash: basis.inputHash,
            ...(structured ? { structured: withActAreas(structured) } : {}),
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
