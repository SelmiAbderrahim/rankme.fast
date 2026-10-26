/** Worker-side processor for durable, locale-isolated audit-summary jobs. */
import { UnrecoverableError, type Job } from 'bullmq';
import type { Logger } from 'pino';
import { SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale, } from '../../shared/i18n/locales.js';
import type { SummaryProvider } from '../../shared/providers/index.js';
import { ProviderError, VendorTimeoutError } from '../../shared/providers/errors.js';
import type { ActionEventsDb } from '../actions/actions.events.repo.js';
import { auditSummaryJobIdentitySchema, auditSummaryJobSchema, legacyAuditSummaryJobSchema, } from '../../shared/queue/index.js';
import { ReportSnapshot, type AiSummaryFailureCode } from './report-snapshot.model.js';
import { generateAuditSummary, type GenerateAuditSummaryDeps, } from './summary.service.js';
import { plainAuditSummarySnapshot } from './summary.selection.js';
export interface AuditSummaryProcessorDeps {
    provider: SummaryProvider | null;
    /** The decisions store: findings the owner dismissed or fixed are left out of the summary. */
    db?: ActionEventsDb;
    logger?: Pick<Logger, 'info'>;
    now?: () => Date;
    archiveVendorResponse?: GenerateAuditSummaryDeps['archiveVendorResponse'];
}
export type AuditSummaryJobOutcome = 'succeeded' | 'failed' | 'stale';
interface ResolvedAuditSummaryPayload {
    accountId: string;
    runId: string;
    generationId: string;
    locale: SupportedLocale;
}
function validLegacySummaryLocale(value: unknown): SupportedLocale | null {
    if (!value || typeof value !== 'object')
        return null;
    const summary = value as Record<string, unknown>;
    if (!isSupportedLocale(summary.locale) ||
        typeof summary.text !== 'string' ||
        typeof summary.model !== 'string' ||
        typeof summary.truncated !== 'boolean' ||
        summary.createdAt === null ||
        summary.createdAt === undefined ||
        Number.isNaN(new Date(summary.createdAt as string | number | Date).getTime())) {
        return null;
    }
    return summary.locale;
}
function matchingLocaleCandidates(snapshot: ReturnType<typeof plainAuditSummarySnapshot>, generationId: string): SupportedLocale[] {
    const candidates = new Set<SupportedLocale>();
    const legacyJobMatches = snapshot.aiSummaryJob?.generationId === generationId;
    if (legacyJobMatches && isSupportedLocale(snapshot.aiSummaryJob?.locale)) {
        candidates.add(snapshot.aiSummaryJob.locale);
    }
    if (legacyJobMatches) {
        const summaryLocale = validLegacySummaryLocale(snapshot.aiSummary);
        if (summaryLocale)
            candidates.add(summaryLocale);
    }
    return SUPPORTED_LOCALES.filter((locale) => candidates.has(locale));
}
async function materializeCompatibilityJob(input: ResolvedAuditSummaryPayload, snapshot: ReturnType<typeof plainAuditSummarySnapshot>): Promise<boolean> {
    const existing = snapshot.aiSummaryJobsByLocale?.[input.locale];
    if (existing?.generationId === input.generationId && existing.locale === input.locale) {
        return true;
    }
    const legacy = snapshot.aiSummaryJob;
    if (legacy?.generationId !== input.generationId ||
        typeof legacy.status !== 'string' ||
        !['queued', 'running', 'succeeded', 'failed'].includes(legacy.status)) {
        return false;
    }
    const requestedAt = new Date(legacy.requestedAt as string | number | Date);
    if (Number.isNaN(requestedAt.getTime()))
        return false;
    const path = `aiSummaryJobsByLocale.${input.locale}`;
    const claimed = await ReportSnapshot.updateOne({
        runId: input.runId,
        accountId: input.accountId,
        'aiSummaryJob.generationId': input.generationId,
        [`${path}.generationId`]: { $exists: false },
    }, {
        $set: {
            [path]: {
                generationId: input.generationId,
                locale: input.locale,
                status: legacy.status,
                requestedAt,
                startedAt: legacy.startedAt ?? null,
                finishedAt: legacy.finishedAt ?? null,
            },
        },
    });
    return claimed.modifiedCount > 0;
}
async function resolveConsumedPayload(data: unknown): Promise<ResolvedAuditSummaryPayload | null> {
    const strict = auditSummaryJobSchema.safeParse(data);
    const identity = auditSummaryJobIdentitySchema.safeParse(data);
    if (!identity.success) {
        throw new UnrecoverableError('Invalid audit summary payload identity');
    }
    const snapshotDocument = await ReportSnapshot.findOne({
        runId: identity.data.runId,
        accountId: identity.data.accountId,
    });
    if (!snapshotDocument)
        return null;
    const snapshot = plainAuditSummarySnapshot(snapshotDocument);
    let locale: SupportedLocale;
    if (strict.success) {
        locale = strict.data.locale;
    }
    else {
        const legacy = legacyAuditSummaryJobSchema.safeParse(data);
        const candidates = legacy.success && legacy.data.locale === undefined
            ? matchingLocaleCandidates(snapshot, identity.data.generationId)
            : [];
        if (candidates.length !== 1) {
            throw new UnrecoverableError('Audit summary payload locale is missing or ambiguous');
        }
        locale = candidates[0]!;
    }
    const resolved = { ...identity.data, locale };
    if (!(await materializeCompatibilityJob(resolved, snapshot)))
        return null;
    return resolved;
}
/** Narrow a generation error to a code the card can explain. */
export function auditSummaryFailureCode(error: unknown): AiSummaryFailureCode {
    if (error instanceof VendorTimeoutError)
        return 'timeout';
    if (error instanceof ProviderError)
        return 'provider_unavailable';
    return 'internal';
}
/** Mark an open job failed, recording why. Only the transition from queued/running counts. */
async function failSummaryJob(input: ResolvedAuditSummaryPayload, failureCode: AiSummaryFailureCode, finishedAt: Date): Promise<void> {
    const path = `aiSummaryJobsByLocale.${input.locale}`;
    await ReportSnapshot.updateOne({
        runId: input.runId,
        accountId: input.accountId,
        [`${path}.generationId`]: input.generationId,
        [`${path}.locale`]: input.locale,
        [`${path}.status`]: { $in: ['queued', 'running'] },
    }, {
        $set: {
            [`${path}.status`]: 'failed',
            [`${path}.finishedAt`]: finishedAt,
            [`${path}.failureCode`]: failureCode,
        },
    });
}
export function createAuditSummaryProcessor(deps: AuditSummaryProcessorDeps) {
    const now = deps.now ?? (() => new Date());
    return async (job: Job): Promise<AuditSummaryJobOutcome> => {
        const payload = await resolveConsumedPayload(job.data);
        if (!payload)
            return 'stale';
        const path = `aiSummaryJobsByLocale.${payload.locale}`;
        const filter = {
            runId: payload.runId,
            accountId: payload.accountId,
            [`${path}.generationId`]: payload.generationId,
            [`${path}.locale`]: payload.locale,
        };
        const initial = await ReportSnapshot.findOne(filter);
        if (!initial)
            return 'stale';
        const stored = plainAuditSummarySnapshot(initial);
        const initialStatus = stored.aiSummaryJobsByLocale?.[payload.locale]?.status;
        if (initialStatus === 'queued') {
            const claimed = await ReportSnapshot.findOneAndUpdate({ ...filter, [`${path}.status`]: 'queued' }, {
                $set: {
                    [`${path}.status`]: 'running',
                    [`${path}.startedAt`]: now(),
                },
            }, { new: true });
            if (!claimed)
                return 'stale';
        }
        else if (initialStatus !== 'running') {
            return 'stale';
        }
        const setStage = async (stage: string): Promise<void> => {
            await ReportSnapshot.updateOne({ ...filter, [`${path}.status`]: 'running' }, { $set: { [`${path}.stage`]: stage } });
        };
        try {
            await setStage('reading_findings');
            const summary = await generateAuditSummary(payload, {
                provider: deps.provider,
                onStage: setStage,
                ...(deps.db ? { db: deps.db } : {}),
                logger: deps.logger,
                now,
                ...(deps.archiveVendorResponse
                    ? { archiveVendorResponse: deps.archiveVendorResponse }
                    : {}),
            });
            const updated = await ReportSnapshot.updateOne({
                ...filter,
                [`${path}.status`]: { $in: ['queued', 'running'] },
            }, {
                $set: {
                    [`aiSummaryVariantsByLocale.${payload.locale}`]: {
                        ...summary,
                        createdAt: new Date(summary.createdAt),
                    },
                    [`${path}.status`]: 'succeeded',
                    [`${path}.finishedAt`]: now(),
                },
            });
            return updated.modifiedCount > 0 ? 'succeeded' : 'stale';
        }
        catch (error) {
            await failSummaryJob(payload, auditSummaryFailureCode(error), now());
            throw error;
        }
    };
}
/**
 * Terminal hook can update only a valid payload's exact locale path. A job
 * that never reached the processor (for example a lease refusal) is failed
 * here; one the processor already failed is left alone.
 */
export async function onAuditSummaryJobExhausted(job: Job, error: Error): Promise<void> {
    const parsed = auditSummaryJobSchema.safeParse(job.data);
    if (!parsed.success)
        return;
    await failSummaryJob(parsed.data, auditSummaryFailureCode(error), new Date());
}
export const auditSummaryProcessorTestables = Object.freeze({
    failSummaryJob,
    matchingLocaleCandidates,
});
