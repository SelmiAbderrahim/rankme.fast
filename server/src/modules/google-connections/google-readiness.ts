import { Types } from 'mongoose';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { getConnection } from './google-connections.service.js';
import { SCOPE_GA4, SCOPE_GSC } from './google-connections.schema.js';
import { storedGscPropertyCoversSite } from './pages-source-state.js';

export const GOOGLE_READINESS_STATUSES = ['not_connected', 'no_property', 'property_mismatch', 'error', 'ok'] as const;
export type GoogleReadinessStatus = (typeof GOOGLE_READINESS_STATUSES)[number];
export interface GoogleProductReadiness { status: GoogleReadinessStatus; matching: boolean }
export interface SiteGoogleReadiness { gsc: GoogleProductReadiness; ga4: GoogleProductReadiness }

export interface ReadinessSiteFields {
    url: string;
    gscPropertyUrl?: string | null;
    ga4PropertyId?: string | null;
    ga4MatchedWebStreamUri?: string | null;
    googleAutoMatch?: { gscStatus?: string | null; ga4Status?: string | null } | null;
}
export interface ReadinessConnectionFields { status: string; scopes: readonly string[] }

const matching = (status?: string | null) => status === 'queued' || status === 'matching';
const unbound = (status?: string | null): GoogleReadinessStatus =>
    status === 'needs_reconnect' ? 'not_connected' : status === 'unavailable' ? 'error' : 'no_property';
function originOf(value: string): string | null {
    try { return new URL(value).origin; } catch { return null; }
}

/** Derive actionable status from stored bindings and the shared credential. */
export function deriveSiteGoogleReadiness(site: ReadinessSiteFields, connection: ReadinessConnectionFields | null): SiteGoogleReadiness {
    if (connection?.status !== 'connected') {
        return { gsc: { status: 'not_connected', matching: false }, ga4: { status: 'not_connected', matching: false } };
    }
    const gscStatus: GoogleReadinessStatus = !connection.scopes.includes(SCOPE_GSC) ? 'error'
        : site.gscPropertyUrl ? (storedGscPropertyCoversSite(site.gscPropertyUrl, site.url) ? 'ok' : 'property_mismatch')
            : unbound(site.googleAutoMatch?.gscStatus);
    const ga4Status: GoogleReadinessStatus = !site.ga4PropertyId ? unbound(site.googleAutoMatch?.ga4Status)
        : !connection.scopes.includes(SCOPE_GA4) ? 'error'
            : site.ga4MatchedWebStreamUri && originOf(site.ga4MatchedWebStreamUri) !== originOf(site.url)
                ? 'property_mismatch' : 'ok';
    return {
        gsc: { status: gscStatus, matching: matching(site.googleAutoMatch?.gscStatus) },
        ga4: { status: ga4Status, matching: matching(site.googleAutoMatch?.ga4Status) },
    };
}

export async function getSiteGoogleReadiness(accountId: string, siteId: string): Promise<SiteGoogleReadiness> {
    const canonicalId = Types.ObjectId.isValid(siteId) ? String(new Types.ObjectId(siteId)) : null;
    const readiness = canonicalId
        ? (await readSitesGoogleReadiness(accountId, [canonicalId])).get(canonicalId)
        : undefined;
    if (!readiness) throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    return readiness;
}

/** Resolve a page of owned sites with one credential read and one binding read. */
export async function readSitesGoogleReadiness(accountId: string, siteIds: readonly string[]): Promise<Map<string, SiteGoogleReadiness>> {
    if (siteIds.length === 0) return new Map();
    const [connection, sites] = await Promise.all([
        getConnection(accountId),
        Site.find({ _id: { $in: siteIds }, accountId, deletionStartedAt: null })
            .select('url gscPropertyUrl ga4PropertyId ga4MatchedWebStreamUri googleAutoMatch'),
    ]);
    return new Map(sites.map((site) => [String(site._id), deriveSiteGoogleReadiness(site, connection)]));
}

export async function withGoogleReadiness<T extends { id: string }>(accountId: string, sites: readonly T[]): Promise<Array<T & { google: SiteGoogleReadiness }>> {
    const readiness = await readSitesGoogleReadiness(accountId, sites.map((site) => site.id));
    return sites.map((site) => ({
        ...site,
        google: readiness.get(site.id) ?? deriveSiteGoogleReadiness({ url: '' }, null),
    }));
}
