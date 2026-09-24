import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Ga4Property, Ga4Provider, Ga4WebDataStream, GscProperty, } from '../../shared/providers/index.js';
import type { GoogleGscProvider } from '../../shared/providers/google/gsc.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site, type SiteHydrated } from '../sites/index.js';
import { getConnection, listGa4PropertiesFor, listPropertiesFor, resolveAccessToken, revokeAndDelete, } from './google-connections.service.js';
export const LEGACY_GOOGLE_BINDING_GENERATION = 'legacy';
export interface GoogleCredentialPayload {
    status: 'connected' | 'needs_reconnect' | 'revoked';
    googleAccountEmail: string;
    scopes: string[];
    connectedAt: Date;
    lastUsedAt: Date | null;
}
export interface SiteGoogleConfiguration {
    connection: GoogleCredentialPayload | null;
    connectedSiteCount: number;
    gsc: {
        propertyUrl: string | null;
        source: 'auto' | 'manual' | 'legacy' | null;
        status: string;
    };
    ga4: {
        propertyId: string | null;
        propertyDisplayName: string | null;
        matchedWebStreamUri: string | null;
        source: 'auto' | 'manual' | 'legacy' | null;
        status: string;
    };
    autoMatch: {
        requestedAt: Date | null;
        completedAt: Date | null;
        failureClass: string | null;
    };
}
export interface GoogleResourceUsage {
    siteId: string;
    domain: string;
    displayName: string;
}
export interface GscPropertyOption extends GscProperty {
    inUseBy: GoogleResourceUsage[];
}
export interface Ga4PropertyOption extends Ga4Property {
    webDataStreams: Ga4WebDataStream[];
    inUseBy: GoogleResourceUsage[];
}
function credentialPayload(connection: NonNullable<Awaited<ReturnType<typeof getConnection>>>): GoogleCredentialPayload {
    return {
        status: connection.status,
        googleAccountEmail: connection.googleAccountEmail,
        scopes: [...connection.scopes],
        connectedAt: connection.connectedAt,
        lastUsedAt: connection.lastUsedAt ?? null,
    };
}
export async function loadOwnedGoogleSite(accountId: string, siteId: string): Promise<SiteHydrated> {
    const site = await Site.findOne({
        _id: siteId,
        accountId,
        deletionStartedAt: null,
    });
    if (!site) {
        throw HttpError.notFound({
            code: 'SITES_ERRORS_NOT_FOUND',
            messageKey: 'sites.errors.notFound',
        });
    }
    return site;
}
function gscStatus(site: SiteHydrated): string {
    if (site.gscPropertyUrl)
        return 'bound';
    return site.googleAutoMatch?.gscStatus ?? 'unbound';
}
function ga4Status(site: SiteHydrated): string {
    if (site.ga4PropertyId)
        return 'bound';
    return site.googleAutoMatch?.ga4Status ?? 'unbound';
}
export async function getSiteGoogleConfiguration(accountId: string, siteId: string): Promise<SiteGoogleConfiguration> {
    const [site, connection, connectedSiteCount] = await Promise.all([
        loadOwnedGoogleSite(accountId, siteId),
        getConnection(accountId),
        Site.countDocuments({
            accountId,
            deletionStartedAt: null,
            $or: [
                { gscPropertyUrl: { $type: 'string', $ne: '' } },
                { ga4PropertyId: { $type: 'string', $ne: '' } },
            ],
        }),
    ]);
    return {
        connection: connection ? credentialPayload(connection) : null,
        connectedSiteCount,
        gsc: {
            propertyUrl: site.gscPropertyUrl ?? null,
            source: site.gscBindingSource ?? null,
            status: connection ? gscStatus(site) : 'not_connected',
        },
        ga4: {
            propertyId: site.ga4PropertyId ?? null,
            propertyDisplayName: site.ga4PropertyDisplayName ?? null,
            matchedWebStreamUri: site.ga4MatchedWebStreamUri ?? null,
            source: site.ga4BindingSource ?? null,
            status: connection ? ga4Status(site) : 'not_connected',
        },
        autoMatch: {
            requestedAt: site.googleAutoMatch?.requestedAt ?? null,
            completedAt: site.googleAutoMatch?.completedAt ?? null,
            failureClass: site.googleAutoMatch?.failureClass ?? null,
        },
    };
}
function usagePayload(site: SiteHydrated): GoogleResourceUsage {
    return {
        siteId: String(site._id),
        domain: site.domain,
        displayName: site.displayName ?? '',
    };
}
export async function listSiteGscProperties(accountId: string, siteId: string, gscProvider: GoogleGscProvider, logger?: Logger): Promise<GscPropertyOption[]> {
    await loadOwnedGoogleSite(accountId, siteId);
    const [properties, sites] = await Promise.all([
        listPropertiesFor(accountId, gscProvider, logger),
        Site.find({ accountId, deletionStartedAt: null }).select('_id domain displayName gscPropertyUrl'),
    ]);
    return properties.map((property) => ({
        ...property,
        inUseBy: sites
            .filter((site) => site.gscPropertyUrl === property.siteUrl)
            .map((site) => usagePayload(site)),
    }));
}
export async function listSiteGa4Properties(accountId: string, siteId: string, ga4Provider: Ga4Provider, gscProvider: GoogleGscProvider, logger?: Logger): Promise<Ga4PropertyOption[]> {
    await loadOwnedGoogleSite(accountId, siteId);
    const properties = await listGa4PropertiesFor(accountId, ga4Provider, gscProvider, logger);
    const accessToken = await resolveAccessToken(accountId, gscProvider, logger);
    const [streams, sites] = await Promise.all([
        Promise.all(properties.map((property) => ga4Provider.listWebDataStreams({ accessToken }, property.propertyId))),
        Site.find({ accountId, deletionStartedAt: null }).select('_id domain displayName ga4PropertyId'),
    ]);
    return properties.map((property, index) => ({
        ...property,
        webDataStreams: streams[index] ?? [],
        inUseBy: sites
            .filter((site) => site.ga4PropertyId === property.propertyId)
            .map((site) => usagePayload(site)),
    }));
}
export interface SetSiteGoogleBindingsInput {
    gscPropertyUrl?: string | null;
    ga4PropertyId?: string | null;
}
export interface SetSiteGoogleBindingsDeps {
    gscProvider: GoogleGscProvider;
    ga4Provider?: Ga4Provider | null;
    logger?: Logger;
}
export interface SiteBindingChange {
    site: SiteHydrated;
    gscChanged: boolean;
    ga4Changed: boolean;
}
/** Validate live resources, then update both requested bindings in one save. */
export async function setSiteGoogleBindings(accountId: string, siteId: string, input: SetSiteGoogleBindingsInput, deps: SetSiteGoogleBindingsDeps): Promise<SiteBindingChange> {
    const site = await loadOwnedGoogleSite(accountId, siteId);
    const connection = await getConnection(accountId);
    if (!connection || connection.status !== 'connected') {
        throw HttpError.notFound({
            code: 'GOOGLE_ERRORS_NOT_CONNECTED',
            messageKey: 'google.errors.notConnected',
        });
    }
    let gscChanged = false;
    let ga4Changed = false;
    let ga4Match: Ga4Property | null = null;
    if (input.gscPropertyUrl !== undefined && input.gscPropertyUrl !== null) {
        const properties = await listPropertiesFor(accountId, deps.gscProvider, deps.logger);
        if (!properties.some((property) => property.siteUrl === input.gscPropertyUrl)) {
            throw HttpError.badRequest({
                code: 'GOOGLE_ERRORS_INVALID_PROPERTY',
                messageKey: 'google.errors.invalidProperty',
            });
        }
    }
    if (input.ga4PropertyId !== undefined && input.ga4PropertyId !== null) {
        if (!deps.ga4Provider) {
            throw HttpError.internal({
                code: 'GOOGLE_ERRORS_UNAVAILABLE',
                messageKey: 'google.errors.unavailable',
            });
        }
        const properties = await listGa4PropertiesFor(accountId, deps.ga4Provider, deps.gscProvider, deps.logger);
        ga4Match =
            properties.find((property) => property.propertyId === input.ga4PropertyId) ??
                null;
        if (!ga4Match) {
            throw HttpError.badRequest({
                code: 'GOOGLE_ERRORS_INVALID_GA4_PROPERTY',
                messageKey: 'google.errors.invalidGa4Property',
            });
        }
    }
    if (input.gscPropertyUrl !== undefined &&
        (site.gscPropertyUrl ?? null) !== input.gscPropertyUrl) {
        gscChanged = true;
        site.gscPropertyUrl = input.gscPropertyUrl;
        site.gscBindingGenerationId = input.gscPropertyUrl ? randomUUID() : null;
        site.gscBindingSource = input.gscPropertyUrl ? 'manual' : null;
        site.googleAutoMatch.gscStatus = input.gscPropertyUrl ? 'bound' : 'unbound';
    }
    if (input.ga4PropertyId !== undefined &&
        (site.ga4PropertyId ?? null) !== input.ga4PropertyId) {
        ga4Changed = true;
        site.ga4PropertyId = input.ga4PropertyId;
        site.ga4PropertyDisplayName = ga4Match?.displayName ?? null;
        site.ga4MatchedWebStreamUri = null;
        site.ga4BindingGenerationId = input.ga4PropertyId ? randomUUID() : null;
        site.ga4BindingSource = input.ga4PropertyId ? 'manual' : null;
        site.googleAutoMatch.ga4Status = input.ga4PropertyId ? 'bound' : 'unbound';
    }
    if (gscChanged || ga4Changed) {
        site.googleAutoMatch.requestId = null;
        site.googleAutoMatch.completedAt = new Date();
        site.googleAutoMatch.failureClass = null;
        await site.save();
    }
    return { site, gscChanged, ga4Changed };
}
export async function unlinkSiteGoogleBindings(accountId: string, siteId: string): Promise<SiteBindingChange> {
    const site = await loadOwnedGoogleSite(accountId, siteId);
    const gscChanged = Boolean(site.gscPropertyUrl);
    const ga4Changed = Boolean(site.ga4PropertyId);
    site.gscPropertyUrl = null;
    site.gscBindingGenerationId = null;
    site.gscBindingSource = null;
    site.ga4PropertyId = null;
    site.ga4PropertyDisplayName = null;
    site.ga4MatchedWebStreamUri = null;
    site.ga4BindingGenerationId = null;
    site.ga4BindingSource = null;
    site.googleAutoMatch = {
        requestId: null,
        gscStatus: 'unbound',
        ga4Status: 'unbound',
        requestedAt: site.googleAutoMatch?.requestedAt ?? null,
        completedAt: new Date(),
        failureClass: null,
    };
    await site.save();
    return { site, gscChanged, ga4Changed };
}
export async function revokeAccountGoogleCredential(accountId: string, gscProvider: GoogleGscProvider, logger?: Logger): Promise<number> {
    const affectedSiteCount = await Site.countDocuments({
        accountId,
        deletionStartedAt: null,
        $or: [
            { gscPropertyUrl: { $type: 'string', $ne: '' } },
            { ga4PropertyId: { $type: 'string', $ne: '' } },
        ],
    });
    await revokeAndDelete(accountId, gscProvider, logger);
    await Site.updateMany({ accountId, deletionStartedAt: null }, {
        $set: {
            gscPropertyUrl: null,
            gscBindingGenerationId: null,
            gscBindingSource: null,
            ga4PropertyId: null,
            ga4PropertyDisplayName: null,
            ga4MatchedWebStreamUri: null,
            ga4BindingGenerationId: null,
            ga4BindingSource: null,
            'googleAutoMatch.requestId': null,
            'googleAutoMatch.gscStatus': 'not_connected',
            'googleAutoMatch.ga4Status': 'not_connected',
            'googleAutoMatch.completedAt': new Date(),
            'googleAutoMatch.failureClass': null,
        },
    });
    return affectedSiteCount;
}
function normalizedOrigin(value: string): string | null {
    try {
        return new URL(value).origin;
    }
    catch {
        return null;
    }
}
function normalizedDomain(value: string): string {
    return value.toLowerCase().replace(/\.$/u, '');
}
type ResourceMatch<T> = {
    kind: 'matched';
    value: T;
} | {
    kind: 'ambiguous' | 'no_match';
};
/** Deterministic GSC matcher used by background detection and migration. */
export function matchGscPropertyForSite(siteUrl: string, domain: string, properties: readonly GscProperty[]): ResourceMatch<GscProperty> {
    const siteOrigin = normalizedOrigin(siteUrl);
    const siteDomain = normalizedDomain(domain);
    const candidates = properties
        .filter((property) => property.permissionLevel !== 'siteUnverifiedUser')
        .flatMap((property) => {
        if (property.siteUrl.startsWith('sc-domain:')) {
            const propertyDomain = normalizedDomain(property.siteUrl.slice('sc-domain:'.length));
            if (propertyDomain === siteDomain)
                return [{ property, rank: 0 }];
            if (siteDomain.endsWith(`.${propertyDomain}`)) {
                return [{ property, rank: 1000 - propertyDomain.split('.').length }];
            }
            return [];
        }
        try {
            const parsed = new URL(property.siteUrl);
            if (siteOrigin !== null &&
                parsed.origin === siteOrigin &&
                (parsed.pathname === '' || parsed.pathname === '/') &&
                parsed.search === '' &&
                parsed.hash === '') {
                return [{ property, rank: 1 }];
            }
        }
        catch {
            return [];
        }
        return [];
    })
        .sort((a, b) => a.rank - b.rank);
    const best = candidates[0];
    if (!best)
        return { kind: 'no_match' };
    if (candidates.some((candidate, index) => index > 0 && candidate.rank === best.rank)) {
        return { kind: 'ambiguous' };
    }
    return { kind: 'matched', value: best.property };
}
export interface Ga4PropertyWithStreams {
    property: Ga4Property;
    streams: readonly Ga4WebDataStream[];
}
/** Strict normalized-origin matching; multiple matching properties never guess. */
export function matchGa4PropertyForSite(siteUrl: string, candidates: readonly Ga4PropertyWithStreams[]): ResourceMatch<{
    property: Ga4Property;
    matchedUri: string;
}> {
    const siteOrigin = normalizedOrigin(siteUrl);
    if (!siteOrigin)
        return { kind: 'no_match' };
    const matches = candidates.flatMap(({ property, streams }) => {
        const stream = streams.find((candidate) => normalizedOrigin(candidate.defaultUri) === siteOrigin);
        return stream ? [{ property, matchedUri: stream.defaultUri }] : [];
    });
    if (matches.length === 0)
        return { kind: 'no_match' };
    if (matches.length > 1)
        return { kind: 'ambiguous' };
    return { kind: 'matched', value: matches[0]! };
}
export function currentGscBindingGeneration(site: SiteHydrated): string | null {
    if (!site.gscPropertyUrl)
        return null;
    return site.gscBindingGenerationId ?? LEGACY_GOOGLE_BINDING_GENERATION;
}
export function currentGa4BindingGeneration(site: SiteHydrated): string | null {
    if (!site.ga4PropertyId)
        return null;
    return site.ga4BindingGenerationId ?? LEGACY_GOOGLE_BINDING_GENERATION;
}
export const siteGoogleTestables = Object.freeze({
    ga4Status,
    gscStatus,
    usagePayload,
});
