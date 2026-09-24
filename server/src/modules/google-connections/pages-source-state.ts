import { createHash } from 'node:crypto';
import { getConnection } from './google-connections.service.js';
export type PagesGscFallbackReason = 'gsc_not_connected' | 'gsc_needs_reconnect' | 'gsc_revoked' | 'gsc_property_unmatched';
export interface StoredPagesGscState {
    usable: boolean;
    propertyUrl: string | null;
    propertyUrlHash: string | null;
    bindingGenerationId: string | null;
    fallbackReason: PagesGscFallbackReason | null;
}
function effectivePort(url: URL): string {
    if (url.port)
        return url.port;
    return url.protocol === 'https:' ? '443' : '80';
}
/** Pure Search Console coverage check: no token, property-list, DNS, or network access. */
export function storedGscPropertyCoversSite(propertyUrl: string, siteUrl: string): boolean {
    let site: URL;
    try {
        site = new URL(siteUrl);
    }
    catch {
        return false;
    }
    if (propertyUrl.startsWith('sc-domain:')) {
        const propertyDomain = propertyUrl.slice('sc-domain:'.length).toLowerCase().replace(/\.$/u, '');
        const host = site.hostname.toLowerCase().replace(/\.$/u, '');
        return propertyDomain.length > 0 && (host === propertyDomain || host.endsWith(`.${propertyDomain}`));
    }
    try {
        const property = new URL(propertyUrl);
        if (property.protocol !== site.protocol ||
            property.hostname !== site.hostname ||
            effectivePort(property) !== effectivePort(site)) {
            return false;
        }
        const prefixPath = property.pathname.endsWith('/') ? property.pathname : `${property.pathname}/`;
        const sitePath = site.pathname.endsWith('/') ? site.pathname : `${site.pathname}/`;
        return sitePath.startsWith(prefixPath) && (!property.search || site.search.startsWith(property.search));
    }
    catch {
        return false;
    }
}
export function hashStoredGscProperty(propertyUrl: string): string {
    return createHash('sha256').update(propertyUrl, 'utf8').digest('hex');
}
export async function resolveStoredPagesGscState(accountId: string, siteId: string, siteUrl: string): Promise<StoredPagesGscState> {
    const { Site } = await import('../sites/index.js');
    const [connection, site] = await Promise.all([
        getConnection(accountId),
        Site.findOne({ _id: siteId, accountId, deletionStartedAt: null }).select('gscPropertyUrl gscBindingGenerationId'),
    ]);
    if (!connection) {
        return { usable: false, propertyUrl: null, propertyUrlHash: null, bindingGenerationId: null, fallbackReason: 'gsc_not_connected' };
    }
    const propertyUrl = site?.gscPropertyUrl ?? null;
    if (connection.status === 'needs_reconnect') {
        return { usable: false, propertyUrl, propertyUrlHash: propertyUrl ? hashStoredGscProperty(propertyUrl) : null, bindingGenerationId: propertyUrl ? site?.gscBindingGenerationId ?? 'legacy' : null, fallbackReason: 'gsc_needs_reconnect' };
    }
    if (connection.status === 'revoked') {
        return { usable: false, propertyUrl, propertyUrlHash: propertyUrl ? hashStoredGscProperty(propertyUrl) : null, bindingGenerationId: propertyUrl ? site?.gscBindingGenerationId ?? 'legacy' : null, fallbackReason: 'gsc_revoked' };
    }
    if (!propertyUrl || !storedGscPropertyCoversSite(propertyUrl, siteUrl)) {
        return { usable: false, propertyUrl, propertyUrlHash: propertyUrl ? hashStoredGscProperty(propertyUrl) : null, bindingGenerationId: propertyUrl ? site?.gscBindingGenerationId ?? 'legacy' : null, fallbackReason: 'gsc_property_unmatched' };
    }
    return {
        usable: true,
        propertyUrl,
        propertyUrlHash: hashStoredGscProperty(propertyUrl),
        bindingGenerationId: site?.gscBindingGenerationId ?? 'legacy',
        fallbackReason: null,
    };
}
