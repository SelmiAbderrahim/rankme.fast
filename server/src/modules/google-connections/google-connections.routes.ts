import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { GoogleGscProvider } from '../../shared/providers/google/gsc.js';
import type { Ga4Provider } from '../../shared/providers/types.js';
import type { Logger } from 'pino';
import { HttpError } from '../../shared/utils/http-error.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { createGoogleConnectionsController } from './google-connections.controller.js';
import { getGoogleGa4Provider } from './google-ga4-holder.js';
import { getGoogleGscProvider } from './google-gsc-holder.js';
export interface GoogleConnectionsRouterDeps {
    /** Explicit override. When omitted the router reads from `getGoogleGscProvider()`. */
    gscProvider?: GoogleGscProvider;
    /** Explicit override. When omitted the router reads from `getGoogleGa4Provider()`. */
    ga4Provider?: Ga4Provider;
    logger?: Logger;
}
/**
 * Build the router mounted at `/api/sites/:siteId/google`.
 *
 * The GSC provider is resolved lazily per request when `deps.gscProvider`
 * is omitted so tests can `setGoogleGscProvider(...)` after createApp().
 * Requests before a provider is wired 503 — never crash.
 */
export function createGoogleConnectionsRouter(deps: GoogleConnectionsRouterDeps = {}): Router {
    const router = Router({ mergeParams: true });
    const resolver = (): GoogleGscProvider => {
        const provider = deps.gscProvider ?? getGoogleGscProvider();
        if (!provider) {
            throw HttpError.internal({ code: 'GOOGLE_ERRORS_UNAVAILABLE', messageKey: 'google.errors.unavailable' });
        }
        return provider;
    };
    const withProvider = (build: (ctrl: ReturnType<typeof createGoogleConnectionsController>) => RequestHandler): RequestHandler => {
        return asyncHandler(async (req, res, next) => {
            const provider = resolver();
            const ctrl = createGoogleConnectionsController({
                gscProvider: provider,
                ga4Provider: deps.ga4Provider ?? getGoogleGa4Provider(),
                ...(deps.logger ? { logger: deps.logger } : {}),
            });
            await Promise.resolve(build(ctrl)(req, res, next));
        });
    };
    router.post('/connect/complete', withProvider((c) => c.complete));
    router.get('/configuration', withProvider((c) => c.configuration));
    router.get('/search-properties', withProvider((c) => c.searchProperties));
    router.patch('/bindings', withProvider((c) => c.setBindings));
    router.delete('/bindings', withProvider((c) => c.unlinkBindings));
    router.post('/credential/revoke', withProvider((c) => c.revokeCredential));
    router.get('/search-summary', withProvider((c) => c.searchSummary));
    router.post('/search-refresh', withProvider((c) => c.searchRefresh));
    router.get('/search-analytics', withProvider((c) => c.searchAnalytics));
    router.get('/sitemaps', withProvider((c) => c.sitemaps));
    // First-party generative-AI appearance surface: Google's own free data.
    router.get('/generative-appearance', withProvider((c) => c.generativeAppearance));
    router.get('/analytics-properties', withProvider((c) => c.analyticsProperties));
    router.get('/analytics-summary', withProvider((c) => c.analyticsSummary));
    router.get('/analytics-detail', withProvider((c) => c.analyticsDetail));
    router.post('/analytics-refresh', withProvider((c) => c.analyticsRefresh));
    return router;
}
/** Convenience: pre-built router that reads from the holder. */
export const googleConnectionsRouter: Router = createGoogleConnectionsRouter();
