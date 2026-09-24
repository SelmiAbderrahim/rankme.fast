import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { GscReconnectRequiredError, ProviderError, type Ga4Provider, } from '../../shared/providers/index.js';
import type { GoogleGscProvider } from '../../shared/providers/google/gsc.js';
import { enqueueGa4SyncJob, enqueueGoogleSiteAutoMatchJob, enqueueGscSyncJob, googleSiteAutoMatchJobSchema, parseConsumedPayload, } from '../../shared/queue/index.js';
import { Site } from '../sites/index.js';
import { getGa4SyncQueue } from './ga4-sync-queue.js';
import { getConnection, resolveAccessToken, toIsoDate, } from './google-connections.service.js';
import { SCOPE_GA4 } from './google-connections.schema.js';
import { getGscSyncQueue } from './gsc-sync-queue.js';
import { matchGa4PropertyForSite, matchGscPropertyForSite, type Ga4PropertyWithStreams, } from './site-google.service.js';
export interface GoogleSiteAutoMatchDeps {
    gscProvider: GoogleGscProvider;
    ga4Provider: Ga4Provider;
    logger?: Logger;
    now?: () => Date;
}
export interface GoogleSiteAutoMatchResult {
    status: 'matched' | 'partial' | 'manual' | 'stale' | 'not_connected';
    gscStatus: string;
    ga4Status: string;
}
function attemptsRemaining(job: Job): boolean {
    const attempts = job.opts.attempts ?? 1;
    return job.attemptsMade + 1 < attempts;
}
async function markBoth(accountId: string, siteId: string, requestId: string, gscStatus: string, ga4Status: string, now: Date, failureClass: string | null = null): Promise<void> {
    await Site.updateOne({
        _id: siteId,
        accountId,
        deletionStartedAt: null,
        'googleAutoMatch.requestId': requestId,
    }, {
        $set: {
            'googleAutoMatch.gscStatus': gscStatus,
            'googleAutoMatch.ga4Status': ga4Status,
            'googleAutoMatch.completedAt': now,
            'googleAutoMatch.failureClass': failureClass,
        },
    });
}
async function enqueueInitialSyncs(accountId: string, siteId: string, domain: string, gscMatched: boolean, ga4Matched: boolean, now: Date): Promise<void> {
    const day = toIsoDate(now);
    const gscQueue = getGscSyncQueue();
    if (gscMatched && gscQueue) {
        await enqueueGscSyncJob(gscQueue, { accountId, siteId, domain }, day);
    }
    const ga4Queue = getGa4SyncQueue();
    if (ga4Matched && ga4Queue) {
        await enqueueGa4SyncJob(ga4Queue, { accountId, siteId }, day);
    }
}
export function createGoogleSiteAutoMatchProcessor(deps: GoogleSiteAutoMatchDeps) {
    return async (job: Job): Promise<GoogleSiteAutoMatchResult> => {
        const data = parseConsumedPayload(googleSiteAutoMatchJobSchema, job.data);
        const now = deps.now?.() ?? new Date();
        const site = await Site.findOne({
            _id: data.siteId,
            accountId: data.accountId,
            deletionStartedAt: null,
            paused: { $ne: true },
            'googleAutoMatch.requestId': data.requestId,
        });
        if (!site) {
            return { status: 'stale', gscStatus: 'unbound', ga4Status: 'unbound' };
        }
        const connection = await getConnection(data.accountId);
        if (!connection || connection.status !== 'connected') {
            const status = connection?.status === 'needs_reconnect'
                ? 'needs_reconnect'
                : 'not_connected';
            await markBoth(data.accountId, data.siteId, data.requestId, site.gscPropertyUrl ? 'bound' : status, site.ga4PropertyId ? 'bound' : status, now);
            return {
                status: 'not_connected',
                gscStatus: site.gscPropertyUrl ? 'bound' : status,
                ga4Status: site.ga4PropertyId ? 'bound' : status,
            };
        }
        await Site.updateOne({
            _id: data.siteId,
            accountId: data.accountId,
            'googleAutoMatch.requestId': data.requestId,
        }, {
            $set: {
                'googleAutoMatch.gscStatus': site.gscPropertyUrl ? 'bound' : 'matching',
                'googleAutoMatch.ga4Status': site.ga4PropertyId
                    ? 'bound'
                    : connection.scopes.includes(SCOPE_GA4)
                        ? 'matching'
                        : 'scope_missing',
                'googleAutoMatch.failureClass': null,
            },
        });
        let accessToken: string;
        try {
            accessToken = await resolveAccessToken(data.accountId, deps.gscProvider, deps.logger);
        }
        catch (error) {
            const reconnect = error instanceof GscReconnectRequiredError;
            const status = reconnect ? 'needs_reconnect' : 'unavailable';
            if (error instanceof ProviderError &&
                error.retryable &&
                attemptsRemaining(job)) {
                throw error;
            }
            await markBoth(data.accountId, data.siteId, data.requestId, site.gscPropertyUrl ? 'bound' : status, site.ga4PropertyId ? 'bound' : status, now, error instanceof Error ? error.name : 'unknown');
            return {
                status: 'manual',
                gscStatus: site.gscPropertyUrl ? 'bound' : status,
                ga4Status: site.ga4PropertyId ? 'bound' : status,
            };
        }
        let gscStatus = site.gscPropertyUrl ? 'bound' : 'unavailable';
        let ga4Status = site.ga4PropertyId
            ? 'bound'
            : connection.scopes.includes(SCOPE_GA4)
                ? 'unavailable'
                : 'scope_missing';
        let gscMatch: string | null = null;
        let ga4Match: {
            propertyId: string;
            displayName: string;
            matchedUri: string;
        } | null = null;
        let retryableError: ProviderError | null = null;
        let failureClass: string | null = null;
        if (!site.gscPropertyUrl) {
            try {
                const properties = await deps.gscProvider.listProperties({ accessToken });
                const match = matchGscPropertyForSite(site.url, site.domain, properties);
                gscStatus = match.kind === 'matched' ? 'bound' : match.kind;
                gscMatch = match.kind === 'matched' ? match.value.siteUrl : null;
            }
            catch (error) {
                failureClass = error instanceof Error ? error.name : 'unknown';
                if (error instanceof ProviderError && error.retryable) {
                    retryableError = error;
                }
            }
        }
        if (!site.ga4PropertyId && connection.scopes.includes(SCOPE_GA4)) {
            try {
                const properties = await deps.ga4Provider.listProperties({ accessToken });
                const candidates: Ga4PropertyWithStreams[] = await Promise.all(properties.map(async (property) => ({
                    property,
                    streams: await deps.ga4Provider.listWebDataStreams({ accessToken }, property.propertyId),
                })));
                const match = matchGa4PropertyForSite(site.url, candidates);
                ga4Status = match.kind === 'matched' ? 'bound' : match.kind;
                ga4Match =
                    match.kind === 'matched'
                        ? {
                            propertyId: match.value.property.propertyId,
                            displayName: match.value.property.displayName,
                            matchedUri: match.value.matchedUri,
                        }
                        : null;
            }
            catch (error) {
                failureClass ??= error instanceof Error ? error.name : 'unknown';
                if (error instanceof ProviderError && error.retryable) {
                    retryableError ??= error;
                }
            }
        }
        if (retryableError && attemptsRemaining(job))
            throw retryableError;
        if (gscMatch) {
            await Site.updateOne({
                _id: data.siteId,
                accountId: data.accountId,
                deletionStartedAt: null,
                'googleAutoMatch.requestId': data.requestId,
                gscPropertyUrl: null,
            }, {
                $set: {
                    gscPropertyUrl: gscMatch,
                    gscBindingGenerationId: randomUUID(),
                    gscBindingSource: 'auto',
                    'googleAutoMatch.gscStatus': 'bound',
                },
            });
        }
        if (ga4Match) {
            await Site.updateOne({
                _id: data.siteId,
                accountId: data.accountId,
                deletionStartedAt: null,
                'googleAutoMatch.requestId': data.requestId,
                ga4PropertyId: null,
            }, {
                $set: {
                    ga4PropertyId: ga4Match.propertyId,
                    ga4PropertyDisplayName: ga4Match.displayName,
                    ga4MatchedWebStreamUri: ga4Match.matchedUri,
                    ga4BindingGenerationId: randomUUID(),
                    ga4BindingSource: 'auto',
                    'googleAutoMatch.ga4Status': 'bound',
                },
            });
        }
        await Site.updateOne({
            _id: data.siteId,
            accountId: data.accountId,
            'googleAutoMatch.requestId': data.requestId,
        }, {
            $set: {
                'googleAutoMatch.gscStatus': gscStatus,
                'googleAutoMatch.ga4Status': ga4Status,
                'googleAutoMatch.completedAt': now,
                'googleAutoMatch.failureClass': failureClass,
            },
        });
        await enqueueInitialSyncs(data.accountId, data.siteId, site.domain, Boolean(gscMatch), Boolean(ga4Match), now);
        const matchedCount = Number(Boolean(gscMatch)) + Number(Boolean(ga4Match));
        return {
            status: matchedCount === 2
                ? 'matched'
                : matchedCount === 1
                    ? 'partial'
                    : 'manual',
            gscStatus,
            ga4Status,
        };
    };
}
/** Queue a fresh match request; connection and queue failures never reject. */
export async function scheduleGoogleSiteAutoMatch(accountId: string, siteId: string, logger?: Logger): Promise<string | null> {
    try {
        const [connection, site] = await Promise.all([
            getConnection(accountId),
            Site.findOne({ _id: siteId, accountId, deletionStartedAt: null }),
        ]);
        if (!site)
            return null;
        if (!connection || connection.status !== 'connected') {
            await Site.updateOne({ _id: siteId, accountId, deletionStartedAt: null }, {
                $set: {
                    'googleAutoMatch.requestId': null,
                    'googleAutoMatch.gscStatus': site.gscPropertyUrl
                        ? 'bound'
                        : connection?.status === 'needs_reconnect'
                            ? 'needs_reconnect'
                            : 'not_connected',
                    'googleAutoMatch.ga4Status': site.ga4PropertyId
                        ? 'bound'
                        : connection?.status === 'needs_reconnect'
                            ? 'needs_reconnect'
                            : 'not_connected',
                },
            });
            return null;
        }
        const queue = getGscSyncQueue();
        const requestId = randomUUID();
        const requestedAt = new Date();
        await Site.updateOne({ _id: siteId, accountId, deletionStartedAt: null }, {
            $set: {
                'googleAutoMatch.requestId': requestId,
                'googleAutoMatch.gscStatus': site.gscPropertyUrl ? 'bound' : 'queued',
                'googleAutoMatch.ga4Status': site.ga4PropertyId
                    ? 'bound'
                    : connection.scopes.includes(SCOPE_GA4)
                        ? 'queued'
                        : 'scope_missing',
                'googleAutoMatch.requestedAt': requestedAt,
                'googleAutoMatch.completedAt': null,
                'googleAutoMatch.failureClass': null,
            },
        });
        if (!queue) {
            await Site.updateOne({ _id: siteId, accountId, 'googleAutoMatch.requestId': requestId }, {
                $set: {
                    'googleAutoMatch.gscStatus': site.gscPropertyUrl
                        ? 'bound'
                        : 'unavailable',
                    'googleAutoMatch.ga4Status': site.ga4PropertyId
                        ? 'bound'
                        : connection.scopes.includes(SCOPE_GA4)
                            ? 'unavailable'
                            : 'scope_missing',
                    'googleAutoMatch.completedAt': requestedAt,
                    'googleAutoMatch.failureClass': 'queue_unavailable',
                },
            });
            return null;
        }
        try {
            await enqueueGoogleSiteAutoMatchJob(queue, {
                accountId,
                siteId,
                requestId,
            });
            return requestId;
        }
        catch (error) {
            logger?.warn({ accountId, siteId, err: (error as Error).message }, 'google site auto-match enqueue failed');
            await Site.updateOne({ _id: siteId, accountId, 'googleAutoMatch.requestId': requestId }, {
                $set: {
                    'googleAutoMatch.gscStatus': site.gscPropertyUrl
                        ? 'bound'
                        : 'unavailable',
                    'googleAutoMatch.ga4Status': site.ga4PropertyId
                        ? 'bound'
                        : connection.scopes.includes(SCOPE_GA4)
                            ? 'unavailable'
                            : 'scope_missing',
                    'googleAutoMatch.completedAt': new Date(),
                    'googleAutoMatch.failureClass': 'queue_unavailable',
                },
            });
            return null;
        }
    }
    catch (error) {
        logger?.warn({ accountId, siteId, err: (error as Error).message }, 'google site auto-match scheduling failed');
        return null;
    }
}
