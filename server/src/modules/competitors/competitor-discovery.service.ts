import { and, eq } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { keywords } from '../../db/schema/index.js';
import { ProviderError, VendorMalformedError, VendorQuotaError, VendorTimeoutError, type CompetitorEntry, type CompetitorProvider, } from '../../shared/providers/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { listCompetitors, registrableDomainKey, } from '../competitor-content/index.js';
import { CompetitorDiscoveryAttempt, type CompetitorDiscoveryAttemptDocument, } from './competitor-discovery.model.js';
import { loadOwnedLandscapeSite, resolveLandscapeMarket, } from './landscape/landscape.service.js';
import type { LandscapeMarket } from './landscape/landscape.schemas.js';
import { localizeSemanticCopy, type SupportedLocale, type TranslationKey, type TranslationVars, } from '../../shared/i18n/index.js';
export const DISCOVERY_MAX_SUGGESTIONS = 25;
type DiscoveryOperation = 'domain_candidates' | 'serp_candidates';
type DiscoveryStatus = 'success' | 'timeout' | 'malformed' | 'quota' | 'failed';
type DiscoveryWarningCode = 'SOURCE_TIMEOUT' | 'SOURCE_MALFORMED' | 'SOURCE_QUOTA' | 'SOURCE_FAILED' | 'SOURCE_TRUNCATED';
interface DiscoveryProvenance {
    provider: 'dataforseo';
    operation: DiscoveryOperation;
    status: DiscoveryStatus;
    capturedAt: string | null;
}
interface DiscoveryWarning {
    code: DiscoveryWarningCode;
    operation: DiscoveryOperation;
    count: number;
}
interface LocalizedDiscoveryWarning extends DiscoveryWarning {
    messageKey: TranslationKey;
    messageVars?: TranslationVars;
    message: string;
}
const DISCOVERY_WARNING_KEYS = {
    SOURCE_TIMEOUT: 'competitors.discovery.warnings.sourceTimeout',
    SOURCE_MALFORMED: 'competitors.discovery.warnings.sourceMalformed',
    SOURCE_QUOTA: 'competitors.discovery.warnings.sourceQuota',
    SOURCE_FAILED: 'competitors.discovery.warnings.sourceFailed',
    SOURCE_TRUNCATED: 'competitors.discovery.warnings.sourceTruncated',
} as const satisfies Record<DiscoveryWarningCode, TranslationKey>;
export interface DiscoveryResult {
    id: string;
    state: 'completed' | 'partial' | 'failed';
    market: LandscapeMarket;
    suggestions: Array<{
        registrableDomain: string;
        origin: string;
        source: 'dataforseo';
        capturedAt: string;
        alreadyConfirmed: boolean;
    }>;
    cache: 'hit' | 'miss';
    provenance: DiscoveryProvenance[];
    coverage: {
        returned: number;
        retained: number;
        truncated: boolean;
    };
    warnings: LocalizedDiscoveryWarning[];
    lastAttempt: {
        state: 'completed' | 'partial' | 'failed';
        attemptedAt: string;
        safeErrorCode: string | null;
    };
    createdAt: string;
}
export interface CompetitorDiscoveryPreview {
    deploymentMode: 'community';
    capacityEnforced: false;
    market: LandscapeMarket;
    unitsRequired: 1;
    enabled: boolean;
    startAllowed: boolean;
    createsProfiles: false;
}
function iso(value: Date | string): string {
    return new Date(value).toISOString();
}
function serializeAttempt(doc: CompetitorDiscoveryAttemptDocument & {
    _id: unknown;
}, lastAttempt: Pick<CompetitorDiscoveryAttemptDocument, 'state' | 'attemptedAt' | 'safeErrorCode'> = doc, locale: SupportedLocale = 'en'): DiscoveryResult {
    // The schema supplies this required subdocument for every persisted row.
    const coverage = doc.coverage!;
    return {
        id: String(doc._id),
        state: doc.state,
        market: {
            locationCode: doc.market.locationCode,
            languageCode: doc.market.languageCode,
            source: doc.market.source,
            eligibleTrackedKeywords: doc.market.eligibleTrackedKeywords,
        },
        suggestions: doc.suggestions.map((suggestion) => ({
            registrableDomain: suggestion.registrableDomain,
            origin: suggestion.origin,
            source: suggestion.source,
            capturedAt: iso(suggestion.capturedAt),
            alreadyConfirmed: suggestion.alreadyConfirmed,
        })),
        cache: doc.cache,
        provenance: doc.provenance.map((source) => ({
            provider: source.provider,
            operation: source.operation,
            status: source.status,
            capturedAt: source.capturedAt ? iso(source.capturedAt) : null,
        })),
        coverage: {
            returned: coverage.returned,
            retained: coverage.retained,
            truncated: coverage.truncated,
        },
        warnings: doc.warnings.map((warning) => {
            const copy = localizeSemanticCopy(locale, DISCOVERY_WARNING_KEYS[warning.code], {
                operation: warning.operation,
                count: warning.count,
            });
            return {
                code: warning.code,
                operation: warning.operation,
                count: warning.count,
                messageKey: copy.messageKey,
                messageVars: copy.messageVars,
                message: copy.message,
            };
        }),
        lastAttempt: {
            state: lastAttempt.state,
            attemptedAt: iso(lastAttempt.attemptedAt),
            safeErrorCode: lastAttempt.safeErrorCode ?? null,
        },
        createdAt: iso(doc.createdAt),
    };
}
function errorStatus(error: unknown): {
    status: Exclude<DiscoveryStatus, 'success'>;
    warning: Exclude<DiscoveryWarningCode, 'SOURCE_TRUNCATED'>;
    safeCode: string;
} {
    if (error instanceof VendorTimeoutError) {
        return { status: 'timeout', warning: 'SOURCE_TIMEOUT', safeCode: 'SOURCE_TIMEOUT' };
    }
    if (error instanceof VendorMalformedError) {
        return { status: 'malformed', warning: 'SOURCE_MALFORMED', safeCode: 'SOURCE_MALFORMED' };
    }
    if (error instanceof VendorQuotaError) {
        return { status: 'quota', warning: 'SOURCE_QUOTA', safeCode: 'SOURCE_QUOTA' };
    }
    return {
        status: 'failed',
        warning: 'SOURCE_FAILED',
        safeCode: error instanceof ProviderError ? 'SOURCE_FAILED' : 'INTERNAL_FAILURE',
    };
}
function utcDayStart(now: Date): Date {
    const value = new Date(now);
    value.setUTCHours(0, 0, 0, 0);
    return value;
}
export async function previewCompetitorDiscovery(input: {
    db: ApplicationDb;
    accountId: string;
    siteId: string;
}): Promise<CompetitorDiscoveryPreview> {
    await loadOwnedLandscapeSite(input.accountId, input.siteId, { allowPaused: true });
    const market = await resolveLandscapeMarket(input.db, input.accountId, input.siteId);
    return {
        deploymentMode: 'community',
        capacityEnforced: false,
        market,
        unitsRequired: 1,
        enabled: env.COMPETITOR_INTELLIGENCE_ENABLED,
        startAllowed: env.COMPETITOR_INTELLIGENCE_ENABLED,
        createsProfiles: false,
    };
}
export async function getLatestCompetitorDiscovery(input: {
    db: ApplicationDb;
    accountId: string;
    siteId: string;
    locale?: SupportedLocale;
}): Promise<DiscoveryResult> {
    const locale = input.locale ?? 'en';
    await loadOwnedLandscapeSite(input.accountId, input.siteId, { allowPaused: true });
    const [good, latest] = await Promise.all([
        CompetitorDiscoveryAttempt.findOne({
            accountId: input.accountId,
            siteId: input.siteId,
            state: { $in: ['completed', 'partial'] },
        }).sort({ createdAt: -1, _id: -1 }),
        CompetitorDiscoveryAttempt.findOne({
            accountId: input.accountId,
            siteId: input.siteId,
        }).sort({ createdAt: -1, _id: -1 }),
    ]);
    if (!good)
        throw HttpError.notFound({ code: 'COMPETITORS_DISCOVERY_ERRORS_NOT_FOUND', messageKey: 'competitors.discovery.errors.notFound' });
    // `good` is selected from the same account/site set as `latest`, so a good
    // row proves that the latest query also has a result.
    return serializeAttempt(good, latest!, locale);
}
function normalizeSuggestions(entries: readonly CompetitorEntry[], capturedAt: Date, confirmed: ReadonlySet<string>) {
    const byDomain = new Map<string, CompetitorEntry>();
    for (const entry of entries) {
        const domain = registrableDomainKey(entry.domain);
        if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || !domain.includes('.')) {
            continue;
        }
        const current = byDomain.get(domain);
        if (!current || entry.intersections > current.intersections)
            byDomain.set(domain, entry);
    }
    return [...byDomain.entries()]
        .sort(([leftDomain, left], [rightDomain, right]) => right.intersections - left.intersections || leftDomain.localeCompare(rightDomain))
        .slice(0, DISCOVERY_MAX_SUGGESTIONS)
        .map(([registrableDomain]) => ({
        registrableDomain,
        origin: `https://${registrableDomain}`,
        source: 'dataforseo' as const,
        capturedAt,
        alreadyConfirmed: confirmed.has(registrableDomain),
    }));
}
async function trackedPhrases(db: ApplicationDb, accountId: string, siteId: string) {
    const rows = await db
        .select({ phrase: keywords.phrase })
        .from(keywords)
        .where(and(eq(keywords.accountId, accountId), eq(keywords.siteId, siteId), eq(keywords.active, true), eq(keywords.engine, 'google')));
    return [...new Set(rows.map((row) => row.phrase.trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right))
        .slice(0, 25);
}
export async function refreshCompetitorDiscovery(input: {
    db: ApplicationDb;
    provider: CompetitorProvider;
    accountId: string;
    siteId: string;
    idempotencyKey: string;
    now?: () => Date;
    locale?: SupportedLocale;
}): Promise<{
    discovery: DiscoveryResult;
    replayed: boolean;
}> {
    const nowFn = input.now ?? (() => new Date());
    const locale = input.locale ?? 'en';
    const site = await loadOwnedLandscapeSite(input.accountId, input.siteId, {
        allowPaused: false,
    });
    const market = await resolveLandscapeMarket(input.db, input.accountId, input.siteId);
    const replay = await CompetitorDiscoveryAttempt.findOne({
        accountId: input.accountId,
        siteId: input.siteId,
        idempotencyKey: input.idempotencyKey,
    });
    if (replay) {
        if (replay.state === 'failed') {
            throw new HttpError(503, { code: 'COMPETITORS_DISCOVERY_ERRORS_UNAVAILABLE', messageKey: 'competitors.discovery.errors.unavailable' });
        }
        return { discovery: serializeAttempt(replay, replay, locale), replayed: true };
    }
    if (!env.COMPETITOR_INTELLIGENCE_ENABLED) {
        throw new HttpError(503, { code: 'COMPETITORS_LANDSCAPE_ERRORS_UNAVAILABLE', messageKey: 'competitors.landscape.errors.unavailable' });
    }
    const attemptedAt = nowFn();
    const cached = await CompetitorDiscoveryAttempt.findOne({
        accountId: input.accountId,
        siteId: input.siteId,
        state: { $in: ['completed', 'partial'] },
        attemptedAt: { $gte: utcDayStart(attemptedAt) },
    }).sort({ attemptedAt: -1, _id: -1 });
    if (cached) {
        const copy = await CompetitorDiscoveryAttempt.create({
            accountId: input.accountId,
            siteId: input.siteId,
            idempotencyKey: input.idempotencyKey,
            state: cached.state,
            market,
            suggestions: cached.suggestions,
            cache: 'hit',
            provenance: cached.provenance,
            coverage: cached.coverage,
            warnings: cached.warnings,
            attemptedAt,
            safeErrorCode: null,
        });
        return { discovery: serializeAttempt(copy, copy, locale), replayed: false };
    }
    const profiles = await listCompetitors(input.db, {
        accountId: input.accountId,
        siteId: input.siteId,
        status: 'all',
    });
    const confirmed = new Set(profiles.map((profile) => profile.registrableDomain));
    const provenance: DiscoveryProvenance[] = [];
    const warnings: DiscoveryWarning[] = [];
    const collected: CompetitorEntry[] = [];
    let safeErrorCode: string | null = null;
    try {
        const rows = await input.provider.getCompetitors(site.domain, market.locationCode, market.languageCode, DISCOVERY_MAX_SUGGESTIONS);
        collected.push(...rows);
        provenance.push({
            provider: 'dataforseo',
            operation: 'domain_candidates',
            status: 'success',
            capturedAt: attemptedAt.toISOString(),
        });
    }
    catch (error) {
        const classified = errorStatus(error);
        safeErrorCode = classified.safeCode;
        provenance.push({
            provider: 'dataforseo',
            operation: 'domain_candidates',
            status: classified.status,
            capturedAt: null,
        });
        warnings.push({ code: classified.warning, operation: 'domain_candidates', count: 1 });
    }
    if (collected.length === 0) {
        const phrases = await trackedPhrases(input.db, input.accountId, input.siteId);
        if (phrases.length > 0) {
            try {
                const rows = await input.provider.getSerpCompetitors(phrases, market.locationCode, market.languageCode, DISCOVERY_MAX_SUGGESTIONS);
                collected.push(...rows);
                provenance.push({
                    provider: 'dataforseo',
                    operation: 'serp_candidates',
                    status: 'success',
                    capturedAt: attemptedAt.toISOString(),
                });
            }
            catch (error) {
                const classified = errorStatus(error);
                safeErrorCode = classified.safeCode;
                provenance.push({
                    provider: 'dataforseo',
                    operation: 'serp_candidates',
                    status: classified.status,
                    capturedAt: null,
                });
                warnings.push({ code: classified.warning, operation: 'serp_candidates', count: 1 });
            }
        }
    }
    const suggestions = normalizeSuggestions(collected, attemptedAt, confirmed);
    const truncated = collected.length > suggestions.length;
    if (truncated) {
        // A non-empty collected set always records the successful source first.
        const operation = provenance.at(-1)!.operation;
        warnings.push({ code: 'SOURCE_TRUNCATED', operation, count: 1 });
    }
    const hasFailure = provenance.some((source) => source.status !== 'success');
    const noSuccessfulSource = !provenance.some((source) => source.status === 'success');
    const state = noSuccessfulSource
        ? 'failed'
        : hasFailure || truncated
            ? 'partial'
            : 'completed';
    const document = await CompetitorDiscoveryAttempt.create({
        accountId: input.accountId,
        siteId: input.siteId,
        idempotencyKey: input.idempotencyKey,
        state,
        market,
        suggestions,
        cache: 'miss',
        provenance,
        coverage: {
            returned: collected.length,
            retained: suggestions.length,
            truncated,
        },
        warnings,
        attemptedAt,
        // Every failed provider leg is classified above and assigns a safe code.
        safeErrorCode: state === 'failed' ? safeErrorCode! : null,
    });
    if (state === 'failed') {
        throw new HttpError(503, { code: 'COMPETITORS_DISCOVERY_ERRORS_UNAVAILABLE', messageKey: 'competitors.discovery.errors.unavailable' });
    }
    return { discovery: serializeAttempt(document, document, locale), replayed: false };
}
export const competitorDiscoveryTestables = Object.freeze({
    errorStatus,
    normalizeSuggestions,
    serializeAttempt,
    trackedPhrases,
    utcDayStart,
});
