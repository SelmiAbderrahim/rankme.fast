import { Router } from 'express';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { getGoogleGscProvider, runGscSync, } from '../google-connections/index.js';
import { finishGscSyncRun, readPreviousSnapshotTotalsForAccount, startGscSyncRun, upsertSearchAnalytics, upsertSitemaps, } from '../gsc-snapshots/index.js';
import { getKeywordResearchDb, getSiteKeywordProvider } from '../keyword-research/index.js';
import { createPagesController } from './pages.controller.js';
import { createPagesFallbackRefreshService } from './fallback-refresh.service.js';
import { createPagesService, type PagesService } from './pages.service.js';
export interface PagesRouterDeps {
    service?: PagesService;
    rateLimit?: boolean;
}
type PagesDb = ReturnType<typeof getKeywordResearchDb>;
type PagesGscProvider = NonNullable<ReturnType<typeof getGoogleGscProvider>>;
type PagesGscSync = typeof runGscSync;
export async function readPreviousPagesGscTotals(db: PagesDb, accountId: string, siteId: string, beforeDate: string, bindingGenerationId = 'legacy'): Promise<{
    clicks: number;
    impressions: number;
} | null> {
    const previous = await readPreviousSnapshotTotalsForAccount(db, accountId, siteId, 'query', beforeDate, bindingGenerationId);
    return previous ? { clicks: previous.clicks, impressions: previous.impressions } : null;
}
export async function runTrackedPagesGscSync(db: PagesDb, provider: PagesGscProvider, input: {
    accountId: string;
    siteId: string;
    domain: string;
    propertyUrlHash: string;
    bindingGenerationId: string;
}, options: {
    now?: () => Date;
    sync?: PagesGscSync;
} = {}) {
    const now = options.now ?? (() => new Date());
    const sync = options.sync ?? runGscSync;
    const startedAt = now();
    const run = await startGscSyncRun(db, { ...input, startedAt });
    try {
        const result = await sync(input.accountId, input.siteId, input.domain, {
            gscProvider: provider,
            logger,
            persist: {
                upsertSearchAnalytics: (value) => upsertSearchAnalytics(db, value),
                upsertSitemaps: (value) => upsertSitemaps(db, value),
                readPreviousTotals: (siteId, beforeDate, bindingGenerationId) => readPreviousPagesGscTotals(db, input.accountId, siteId, beforeDate, bindingGenerationId ?? input.bindingGenerationId),
            },
        });
        const terminal = result.status === 'ok' ? 'succeeded' : result.status === 'no-data' ? 'empty' : 'failed';
        await finishGscSyncRun(db, {
            id: run.id,
            accountId: input.accountId,
            siteId: input.siteId,
            status: terminal,
            completedAt: now(),
            snapshotDate: result.snapshotDate,
            failureClass: terminal === 'failed' ? result.status : null,
        });
        return result;
    }
    catch (error) {
        await finishGscSyncRun(db, {
            id: run.id,
            accountId: input.accountId,
            siteId: input.siteId,
            status: 'failed',
            completedAt: now(),
            snapshotDate: null,
            failureClass: error instanceof Error ? error.name : 'unknown',
        });
        throw error;
    }
}
function defaultService(): PagesService {
    const db = getKeywordResearchDb();
    const provider = getSiteKeywordProvider();
    const fallbackRefresh = createPagesFallbackRefreshService({
        db,
        provider,
        providerSelection: env.PROVIDER_KEYWORD,
    });
    return createPagesService({
        db,
        cursorSecret: env.MASTER_ENCRYPTION_KEY,
        providerSelection: env.PROVIDER_KEYWORD,
        fallbackRefresh,
        telemetry: (event, fields) => logger.info(fields, event),
        syncGsc: async (input) => {
            const provider = getGoogleGscProvider();
            if (!provider)
                return { status: 'unavailable', snapshotDate: null };
            return runTrackedPagesGscSync(db, provider, input);
        },
    });
}
export function createPagesRouter(deps: PagesRouterDeps = {}): Router {
    const router = Router({ mergeParams: true });
    // Resolve holders lazily so app construction remains side-effect free and
    // tests may inject DB/providers after createApp(), matching sibling routes.
    const service: PagesService = deps.service ?? {
        list: (...args) => defaultService().list(...args),
        detail: (...args) => defaultService().detail(...args),
        refresh: (...args) => defaultService().refresh(...args),
    };
    const controller = createPagesController(service);
    const readLimiter = deps.rateLimit === false ? [] : [createBatchRateLimiter('pages_read')];
    const refreshLimiter = deps.rateLimit === false ? [] : [createBatchRateLimiter('pages_refresh')];
    router.get('/', ...readLimiter, controller.list);
    router.get('/:pageId', ...readLimiter, controller.detail);
    router.post('/refresh', ...refreshLimiter, controller.refresh);
    return router;
}
