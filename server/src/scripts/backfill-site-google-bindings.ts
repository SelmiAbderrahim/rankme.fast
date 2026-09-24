/**
 * One-shot, idempotent migration from account-level Google resource picks to
 * Site bindings. OAuth credentials stay account-scoped; only GSC/GA4 resource
 * choices move. Existing snapshot rows are assigned the `legacy` generation
 * by the paired Drizzle migration, so migrated bindings keep their history.
 */
import type { Logger } from 'pino';
import type { Ga4Provider, GscConnection } from '../shared/providers/index.js';
import type { GoogleConnection } from '../modules/google-connections/google-connection.model.js';
import { matchGa4PropertyForSite, matchGscPropertyForSite, } from '../modules/google-connections/site-google.service.js';
import type { Site } from '../modules/sites/sites.model.js';
export interface BackfillSiteGoogleBindingsResult {
    normalizedSiteBindings: number;
    migratedGscBindings: number;
    migratedGa4Bindings: number;
    removedGlobalGscSelections: number;
    removedGlobalGa4Selections: number;
    queuedSites: number;
    ga4AccountsDeferred: number;
}
export interface BackfillSiteGoogleBindingsDeps {
    siteModel: typeof Site;
    connectionModel: typeof GoogleConnection;
    ga4Provider?: Ga4Provider;
    resolveAccessToken?: (accountId: string) => Promise<GscConnection>;
    scheduleSiteMatch?: (accountId: string, siteId: string) => Promise<unknown>;
    logger?: Logger;
}
const EMPTY_RESULT: BackfillSiteGoogleBindingsResult = {
    normalizedSiteBindings: 0,
    migratedGscBindings: 0,
    migratedGa4Bindings: 0,
    removedGlobalGscSelections: 0,
    removedGlobalGa4Selections: 0,
    queuedSites: 0,
    ga4AccountsDeferred: 0,
};
function markLegacyBindingMetadata(site: InstanceType<typeof Site>): boolean {
    let changed = false;
    if (site.gscPropertyUrl) {
        if (!site.gscBindingGenerationId) {
            site.gscBindingGenerationId = 'legacy';
            changed = true;
        }
        if (!site.gscBindingSource) {
            site.gscBindingSource = 'legacy';
            changed = true;
        }
        if (site.googleAutoMatch.gscStatus !== 'bound') {
            site.googleAutoMatch.gscStatus = 'bound';
            changed = true;
        }
    }
    if (site.ga4PropertyId) {
        if (!site.ga4BindingGenerationId) {
            site.ga4BindingGenerationId = 'legacy';
            changed = true;
        }
        if (!site.ga4BindingSource) {
            site.ga4BindingSource = 'legacy';
            changed = true;
        }
        if (site.googleAutoMatch.ga4Status !== 'bound') {
            site.googleAutoMatch.ga4Status = 'bound';
            changed = true;
        }
    }
    return changed;
}
export async function backfillSiteGoogleBindings(deps: BackfillSiteGoogleBindingsDeps): Promise<BackfillSiteGoogleBindingsResult> {
    const result = { ...EMPTY_RESULT };
    const boundSites = await deps.siteModel.find({
        deletionStartedAt: null,
        $or: [
            { gscPropertyUrl: { $type: 'string', $ne: '' } },
            { ga4PropertyId: { $type: 'string', $ne: '' } },
        ],
    });
    for (const site of boundSites) {
        if (markLegacyBindingMetadata(site)) {
            await site.save();
            result.normalizedSiteBindings += 1;
        }
    }
    const legacyConnections = await deps.connectionModel
        .find({
        $or: [
            { propertyUrl: { $type: 'string', $ne: '' } },
            { ga4PropertyId: { $type: 'string', $ne: '' } },
        ],
    })
        .select('+propertyUrl +ga4PropertyId +ga4PropertyDisplayName');
    for (const connection of legacyConnections) {
        const accountId = String(connection.accountId);
        const sites = await deps.siteModel.find({
            accountId: connection.accountId,
            deletionStartedAt: null,
        });
        if (connection.propertyUrl) {
            for (const site of sites) {
                if (site.gscPropertyUrl)
                    continue;
                const match = matchGscPropertyForSite(site.url, site.domain, [
                    {
                        siteUrl: connection.propertyUrl,
                        permissionLevel: 'siteOwner',
                    },
                ]);
                if (match.kind !== 'matched')
                    continue;
                site.gscPropertyUrl = match.value.siteUrl;
                site.gscBindingGenerationId = 'legacy';
                site.gscBindingSource = 'legacy';
                site.googleAutoMatch.gscStatus = 'bound';
                await site.save();
                result.migratedGscBindings += 1;
            }
            await deps.connectionModel.updateOne({ _id: connection._id }, { $unset: { propertyUrl: 1 } });
            result.removedGlobalGscSelections += 1;
        }
        let ga4MigratedSafely = !connection.ga4PropertyId;
        if (connection.ga4PropertyId &&
            connection.status === 'connected' &&
            deps.ga4Provider &&
            deps.resolveAccessToken) {
            try {
                const token = await deps.resolveAccessToken(accountId);
                const streams = await deps.ga4Provider.listWebDataStreams(token, connection.ga4PropertyId);
                for (const site of sites) {
                    if (site.ga4PropertyId)
                        continue;
                    const match = matchGa4PropertyForSite(site.url, [
                        {
                            property: {
                                propertyId: connection.ga4PropertyId,
                                displayName: connection.ga4PropertyDisplayName ?? connection.ga4PropertyId,
                            },
                            streams,
                        },
                    ]);
                    if (match.kind !== 'matched')
                        continue;
                    site.ga4PropertyId = match.value.property.propertyId;
                    site.ga4PropertyDisplayName = match.value.property.displayName;
                    site.ga4MatchedWebStreamUri = match.value.matchedUri;
                    site.ga4BindingGenerationId = 'legacy';
                    site.ga4BindingSource = 'legacy';
                    site.googleAutoMatch.ga4Status = 'bound';
                    await site.save();
                    result.migratedGa4Bindings += 1;
                }
                ga4MigratedSafely = true;
            }
            catch (error) {
                deps.logger?.warn({ accountId, err: (error as Error).message }, 'site Google binding backfill deferred GA4 selection');
            }
        }
        if (connection.ga4PropertyId && ga4MigratedSafely) {
            await deps.connectionModel.updateOne({ _id: connection._id }, { $unset: { ga4PropertyId: 1, ga4PropertyDisplayName: 1 } });
            result.removedGlobalGa4Selections += 1;
        }
        else if (connection.ga4PropertyId) {
            result.ga4AccountsDeferred += 1;
        }
        if (deps.scheduleSiteMatch) {
            for (const site of sites) {
                try {
                    const requestId = await deps.scheduleSiteMatch(accountId, String(site._id));
                    if (requestId)
                        result.queuedSites += 1;
                }
                catch (error) {
                    deps.logger?.warn({ accountId, siteId: String(site._id), err: (error as Error).message }, 'site Google binding backfill could not schedule auto-match');
                }
            }
        }
    }
    return result;
}
