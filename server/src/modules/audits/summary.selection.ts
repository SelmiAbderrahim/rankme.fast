import { SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale, } from '../../shared/i18n/locales.js';
import { AI_SUMMARY_FAILURE_CODES, AI_SUMMARY_JOB_STAGES, AI_SUMMARY_JOB_STATUSES, type AiSummaryFailureCode, type AiSummaryJobStage, type AiSummaryJobStatus, type ReportSnapshotHydrated, } from './report-snapshot.model.js';
import { SUMMARY_ACT_AREAS, type SummaryActArea } from './summary-act-area.js';
export interface PersistedAiSummary {
    text: string;
    locale: SupportedLocale;
    model: string;
    truncated: boolean;
    createdAt: string;
    /**
     * Rule ids of the open findings this summary was built from, i.e. its
     * evidence references. Absent on summaries written before they were recorded.
     */
    basisRuleIds?: string[];
    /**
     * Hash of the findings, dismissals and action states the summary was built
     * from. A different current hash marks it stale.
     */
    inputHash?: string;
    /** Status sentence + top items; absent on text-only summaries. */
    structured?: PersistedSummaryStructured;
}
export interface PersistedSummaryItem {
    ruleId: string;
    what: string;
    why: string;
    firstStep: string;
    /** Workspace surface where the user acts on it, chosen by rule. */
    whereToAct: SummaryActArea;
}
export interface PersistedSummaryStructured {
    status: string;
    items: PersistedSummaryItem[];
}
/** Whether a stored summary still matches the findings that are open today. */
export interface AuditSummaryFreshness {
    stale: boolean;
    reason: 'triage_changed' | null;
    /** The summary's evidence references; null for summaries written before they were recorded. */
    evidenceRuleIds: string[] | null;
    /** Rules whose open/closed status differs from when the summary was written. */
    changedRuleIds: string[];
}
export type AuditSummaryStatus = 'idle' | AiSummaryJobStatus;
export interface AuditSummaryState {
    status: AuditSummaryStatus;
    aiSummary: PersistedAiSummary | null;
    requestedLocale: SupportedLocale;
    availableLocales: SupportedLocale[];
    /** Set by readers that can reach the decisions store; absent otherwise. */
    freshness?: AuditSummaryFreshness | null;
}
interface PlainSummaryJob {
    generationId?: unknown;
    locale?: unknown;
    status?: unknown;
    requestedAt?: unknown;
    startedAt?: unknown;
    finishedAt?: unknown;
    stage?: unknown;
    failureCode?: unknown;
}
/**
 * Progress of the latest summary job in one locale: the stage the worker
 * reported, how long it has been going (server clock), and for a failure why.
 */
export interface AuditSummaryProgress {
    stage: AiSummaryJobStage | null;
    requestedAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    elapsedMs: number;
    failureCode: AiSummaryFailureCode | null;
}
export interface PlainAuditSummarySnapshot {
    aiSummaryVariantsByLocale?: Partial<Record<SupportedLocale, unknown>> | null;
    aiSummaryJobsByLocale?: Partial<Record<SupportedLocale, PlainSummaryJob | null>> | null;
    aiSummary?: unknown;
    aiSummaryJob?: PlainSummaryJob | null;
}
function validDate(value: unknown): Date | null {
    if (value === null || value === undefined || value === '')
        return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date;
}
function serializeExactSummary(value: unknown, locale: SupportedLocale): PersistedAiSummary | null {
    if (!value || typeof value !== 'object')
        return null;
    const summary = value as Record<string, unknown>;
    const createdAt = validDate(summary.createdAt);
    if (summary.locale !== locale ||
        typeof summary.text !== 'string' ||
        typeof summary.model !== 'string' ||
        typeof summary.truncated !== 'boolean' ||
        !createdAt) {
        return null;
    }
    const basis = Array.isArray(summary.basisRuleIds)
        ? summary.basisRuleIds.filter((id): id is string => typeof id === 'string')
        : null;
    const structured = serializeStructured(summary.structured);
    return {
        text: summary.text,
        locale,
        model: summary.model,
        truncated: summary.truncated,
        createdAt: createdAt.toISOString(),
        ...(basis ? { basisRuleIds: basis } : {}),
        ...(typeof summary.inputHash === 'string' ? { inputHash: summary.inputHash } : {}),
        ...(structured ? { structured } : {}),
    };
}
function serializeStructured(value: unknown): PersistedSummaryStructured | null {
    if (!value || typeof value !== 'object')
        return null;
    const { status, items } = value as {
        status?: unknown;
        items?: unknown;
    };
    if (typeof status !== 'string' || !Array.isArray(items))
        return null;
    const valid = items.filter((item): item is PersistedSummaryItem => typeof item === 'object' &&
        item !== null &&
        ['ruleId', 'what', 'why', 'firstStep'].every((key) => typeof (item as Record<string, unknown>)[key] === 'string') &&
        (SUMMARY_ACT_AREAS as readonly unknown[]).includes((item as {
            whereToAct?: unknown;
        }).whereToAct));
    return {
        status,
        items: valid.map(({ ruleId, what, why, firstStep, whereToAct }) => ({ ruleId, what, why, firstStep, whereToAct })),
    };
}
function exactJobStatus(value: PlainSummaryJob | null | undefined, locale: SupportedLocale): AiSummaryJobStatus | null {
    if (!value ||
        value.locale !== locale ||
        typeof value.status !== 'string' ||
        !(AI_SUMMARY_JOB_STATUSES as readonly string[]).includes(value.status)) {
        return null;
    }
    return value.status as AiSummaryJobStatus;
}
export function plainAuditSummarySnapshot(snapshot: ReportSnapshotHydrated | PlainAuditSummarySnapshot): PlainAuditSummarySnapshot {
    return 'toObject' in snapshot && typeof snapshot.toObject === 'function'
        ? (snapshot.toObject() as unknown as PlainAuditSummarySnapshot)
        : (snapshot as PlainAuditSummarySnapshot);
}
/**
 * The single audit-summary read authority. It selects an exact locale variant,
 * then an exact-locale legacy value, and never falls back across locales.
 */
export function selectAuditSummaryLocale(snapshot: ReportSnapshotHydrated | PlainAuditSummarySnapshot, requestedLocale: SupportedLocale): AuditSummaryState {
    const stored = plainAuditSummarySnapshot(snapshot);
    const variant = serializeExactSummary(stored.aiSummaryVariantsByLocale?.[requestedLocale], requestedLocale);
    const legacy = serializeExactSummary(stored.aiSummary, requestedLocale);
    const aiSummary = variant ?? legacy;
    const variantStatus = exactJobStatus(stored.aiSummaryJobsByLocale?.[requestedLocale], requestedLocale);
    const legacyStatus = exactJobStatus(stored.aiSummaryJob, requestedLocale);
    const available = new Set<SupportedLocale>();
    for (const locale of SUPPORTED_LOCALES) {
        if (serializeExactSummary(stored.aiSummaryVariantsByLocale?.[locale], locale)) {
            available.add(locale);
        }
    }
    if (stored.aiSummary &&
        typeof stored.aiSummary === 'object' &&
        isSupportedLocale((stored.aiSummary as {
            locale?: unknown;
        }).locale)) {
        const locale = (stored.aiSummary as {
            locale: SupportedLocale;
        }).locale;
        if (serializeExactSummary(stored.aiSummary, locale))
            available.add(locale);
    }
    return {
        status: variantStatus ?? legacyStatus ?? (aiSummary ? 'succeeded' : 'idle'),
        aiSummary,
        requestedLocale,
        availableLocales: [...available].sort((left, right) => left.localeCompare(right)),
    };
}
/**
 * The exact-locale job's progress, or null when this locale never had a
 * job. A failed job without a recorded code reads as `internal`.
 */
export function selectAuditSummaryProgress(snapshot: ReportSnapshotHydrated | PlainAuditSummarySnapshot, locale: SupportedLocale, now: Date): AuditSummaryProgress | null {
    const stored = plainAuditSummarySnapshot(snapshot);
    const variantJob = stored.aiSummaryJobsByLocale?.[locale];
    const job = exactJobStatus(variantJob, locale) ? variantJob : stored.aiSummaryJob;
    const status = exactJobStatus(job, locale);
    const requestedAt = validDate(job?.requestedAt);
    if (!job || !status || !requestedAt)
        return null;
    const startedAt = validDate(job.startedAt);
    const finishedAt = validDate(job.finishedAt);
    const reported = (AI_SUMMARY_JOB_STAGES as readonly unknown[]).includes(job.stage)
        ? (job.stage as AiSummaryJobStage)
        : null;
    const stage = status === 'queued' ? 'queued' : status === 'running' ? (reported ?? 'reading_findings') : null;
    const failureCode = status === 'failed'
        ? (AI_SUMMARY_FAILURE_CODES as readonly unknown[]).includes(job.failureCode)
            ? (job.failureCode as AiSummaryFailureCode)
            : 'internal'
        : null;
    const end = finishedAt ?? now;
    return {
        stage,
        requestedAt: requestedAt.toISOString(),
        startedAt: startedAt?.toISOString() ?? null,
        finishedAt: finishedAt?.toISOString() ?? null,
        elapsedMs: Math.max(0, end.getTime() - requestedAt.getTime()),
        failureCode,
    };
}
