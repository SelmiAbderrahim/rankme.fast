import { SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale, } from '../../shared/i18n/locales.js';
import { AI_SUMMARY_JOB_STATUSES, type AiSummaryJobStatus, type ReportSnapshotHydrated, } from './report-snapshot.model.js';
export interface PersistedAiSummary {
    text: string;
    locale: SupportedLocale;
    model: string;
    truncated: boolean;
    createdAt: string;
}
export type AuditSummaryStatus = 'idle' | AiSummaryJobStatus;
export interface AuditSummaryState {
    status: AuditSummaryStatus;
    aiSummary: PersistedAiSummary | null;
    requestedLocale: SupportedLocale;
    availableLocales: SupportedLocale[];
}
interface PlainSummaryJob {
    generationId?: unknown;
    locale?: unknown;
    status?: unknown;
    requestedAt?: unknown;
    startedAt?: unknown;
    finishedAt?: unknown;
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
    return {
        text: summary.text,
        locale,
        model: summary.model,
        truncated: summary.truncated,
        createdAt: createdAt.toISOString(),
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
