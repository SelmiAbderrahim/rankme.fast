// Composable CLI seam for the one-shot Site-scoped Google binding backfill.
// The rollout runbook supplies the selected GA4 provider, token resolver, and
// queue-backed matcher scheduler so this file owns only connect → migrate →
// disconnect lifecycle and remains directly testable.
import type { Mongoose } from 'mongoose';
import type { Logger } from 'pino';
import type { Ga4Provider, GscConnection } from '../shared/providers/index.js';
import { GoogleConnection } from '../modules/google-connections/google-connection.model.js';
import { Site } from '../modules/sites/sites.model.js';
import { backfillSiteGoogleBindings, type BackfillSiteGoogleBindingsResult, } from './backfill-site-google-bindings.js';
export interface RunBackfillSiteGoogleBindingsDeps {
    mongoose: Mongoose;
    mongoUri: string;
    ga4Provider?: Ga4Provider;
    resolveAccessToken?: (accountId: string) => Promise<GscConnection>;
    scheduleSiteMatch?: (accountId: string, siteId: string) => Promise<unknown>;
    logger: Logger;
}
export async function runBackfillSiteGoogleBindingsCli(deps: RunBackfillSiteGoogleBindingsDeps): Promise<BackfillSiteGoogleBindingsResult> {
    await deps.mongoose.connect(deps.mongoUri);
    try {
        const result = await backfillSiteGoogleBindings({
            siteModel: Site,
            connectionModel: GoogleConnection,
            ...(deps.ga4Provider ? { ga4Provider: deps.ga4Provider } : {}),
            ...(deps.resolveAccessToken
                ? { resolveAccessToken: deps.resolveAccessToken }
                : {}),
            ...(deps.scheduleSiteMatch
                ? { scheduleSiteMatch: deps.scheduleSiteMatch }
                : {}),
            logger: deps.logger,
        });
        deps.logger.info(result, 'site Google binding backfill complete');
        return result;
    }
    finally {
        await deps.mongoose.disconnect();
    }
}
