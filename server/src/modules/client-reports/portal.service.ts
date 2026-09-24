import { eq } from 'drizzle-orm';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { accountDeletionTombstones, siteDeletionTombstones, } from '../../db/schema/index.js';
import { DEFAULT_LOCALE, isSupportedLocale, type SupportedLocale, } from '../../shared/i18n/index.js';
import { normalizedClientUrl } from '../../shared/utils/client-url.js';
import { OPAQUE_BEARER_TOKEN_BYTES, createOpaqueBearerToken, hashOpaqueBearerToken, } from '../../shared/security/opaque-token.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { assertCurrentAccountWorkLease } from '../legal/index.js';
import { assertCurrentSiteWorkLease, Site, tryRunWithSiteWorkLease, } from '../sites/index.js';
import type { ClientPortalCreateBody } from './client-reports.schema.js';
import { ClientPortalToken, type ClientPortalTokenHydrated, } from './client-portal-token.model.js';
import { composeClientReport, type ClientReportSnapshot, } from './report-composer.service.js';
export const CLIENT_PORTAL_TOKEN_BYTES = OPAQUE_BEARER_TOKEN_BYTES;
export function hashClientPortalToken(token: string): string {
    return hashOpaqueBearerToken(token);
}
export interface ClientPortalManagementDto {
    id: string;
    clientLabel: string;
    siteLabel: string;
    locale: SupportedLocale;
    sections: {
        audit: boolean;
        ranks: boolean;
        gsc: boolean;
    };
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
}
export interface CreatedClientPortalDto extends ClientPortalManagementDto {
    url: string;
}
export interface ClientPortalDto {
    locale: SupportedLocale;
    site: {
        label: string;
    };
    branding: {
        companyName: string;
        accentColor: string;
        logoDataUrl: string | null;
    };
    sections: {
        audit: null | {
            snapshotDate: string;
            counts: {
                fixNow: number;
                watch: number;
                passed: number;
            };
            findings: Array<{
                ruleId: string;
                bucket: 'fix-now' | 'watch' | 'passed';
                severity: 'critical' | 'warning' | 'info';
                affectedUrls: string[];
                title: string;
                why: string;
                fix: string;
            }>;
        };
        ranks: ClientReportSnapshot['sections']['ranks'];
        gsc: ClientReportSnapshot['sections']['gsc'];
    };
}
function toManagementDto(token: ClientPortalTokenHydrated, siteLabel: string): ClientPortalManagementDto {
    return {
        id: token.id as string,
        clientLabel: token.clientLabel,
        siteLabel,
        locale: token.locale as SupportedLocale,
        sections: {
            audit: token.sections.audit,
            ranks: token.sections.ranks,
            gsc: token.sections.gsc,
        },
        expiresAt: token.expiresAt.toISOString(),
        revokedAt: token.revokedAt?.toISOString() ?? null,
        createdAt: token.createdAt.toISOString(),
    };
}
async function loadOwnedSite(accountId: string, siteId: string) {
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null })
        .select('displayName domain')
        .lean();
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    return site;
}
export async function createClientPortal(input: {
    accountId: string;
    siteId: string;
    body: ClientPortalCreateBody;
}, deps: {
    now?: () => Date;
} = {}): Promise<CreatedClientPortalDto> {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    if (!env.CLIENT_REPORTS_ENABLED) {
        throw HttpError.notFound({ code: 'CLIENT_REPORTS_ERRORS_UNAVAILABLE', messageKey: 'clientReports.errors.unavailable' });
    }
    const now = (deps.now ?? (() => new Date()))();
    const rawToken = createOpaqueBearerToken();
    const expiresAt = new Date(now.getTime() + input.body.expiresInDays * 86400000);
    const token = await ClientPortalToken.create({
        accountId: input.accountId,
        siteId: input.siteId,
        clientLabel: input.body.clientLabel,
        tokenHash: hashClientPortalToken(rawToken),
        locale: input.body.locale,
        sections: input.body.sections,
        expiresAt,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
    });
    const prefix = input.body.locale === DEFAULT_LOCALE ? '' : `/${input.body.locale}`;
    return {
        ...toManagementDto(token, site.displayName.trim() || site.domain),
        url: `${normalizedClientUrl()}${prefix}/portal/${rawToken}`,
    };
}
export async function listClientPortals(accountId: string, siteId: string): Promise<{
    portals: ClientPortalManagementDto[];
}> {
    const site = await loadOwnedSite(accountId, siteId);
    const rows = await ClientPortalToken.find({ accountId, siteId }).sort({ createdAt: -1 });
    const siteLabel = site.displayName.trim() || site.domain;
    return {
        portals: rows.map((row) => toManagementDto(row, siteLabel)),
    };
}
export async function revokeClientPortal(input: {
    accountId: string;
    siteId: string;
    portalId: string;
}, now: Date = new Date()): Promise<ClientPortalManagementDto> {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const token = await ClientPortalToken.findOneAndUpdate({ _id: input.portalId, accountId: input.accountId, siteId: input.siteId }, { $set: { revokedAt: now } }, { new: true });
    if (!token)
        throw HttpError.notFound({ code: 'CLIENT_REPORTS_ERRORS_PORTAL_NOT_FOUND', messageKey: 'clientReports.errors.portalNotFound' });
    return toManagementDto(token, site.displayName.trim() || site.domain);
}
export function buildClientPortalDto(snapshot: ClientReportSnapshot): ClientPortalDto {
    const audit = snapshot.sections.audit;
    return {
        locale: snapshot.locale,
        site: { label: snapshot.siteLabel },
        branding: {
            companyName: snapshot.branding.companyName,
            accentColor: snapshot.branding.accentColor,
            logoDataUrl: snapshot.branding.logoPngBase64.length > 0 &&
                snapshot.branding.logoWidth !== null &&
                snapshot.branding.logoHeight !== null
                ? `data:image/png;base64,${snapshot.branding.logoPngBase64}`
                : null,
        },
        sections: {
            audit: audit === null
                ? null
                : {
                    snapshotDate: audit.snapshotDate,
                    counts: {
                        fixNow: audit.report.counts.fixNow,
                        watch: audit.report.counts.watch,
                        passed: audit.report.counts.passed,
                    },
                    findings: audit.report.findings.map((finding) => ({
                        ruleId: finding.ruleId,
                        bucket: finding.bucket,
                        severity: finding.severity,
                        affectedUrls: [...finding.affectedUrls],
                        title: finding.copy.title,
                        why: finding.copy.why,
                        fix: finding.copy.fix,
                    })),
                },
            ranks: snapshot.sections.ranks === null
                ? null
                : {
                    snapshotDate: snapshot.sections.ranks.snapshotDate,
                    rows: snapshot.sections.ranks.rows.map((row) => ({
                        keyword: row.keyword,
                        engine: row.engine,
                        position: row.position,
                        checkedAt: row.checkedAt,
                    })),
                },
            gsc: snapshot.sections.gsc === null
                ? null
                : {
                    snapshotDate: snapshot.sections.gsc.snapshotDate,
                    windowDays: 28,
                    totalClicks: snapshot.sections.gsc.totalClicks,
                    totalImpressions: snapshot.sections.gsc.totalImpressions,
                    averageCtr: snapshot.sections.gsc.averageCtr,
                    averagePosition: snapshot.sections.gsc.averagePosition,
                    topQueries: snapshot.sections.gsc.topQueries.map((row) => ({
                        query: row.query,
                        clicks: row.clicks,
                        impressions: row.impressions,
                        ctr: row.ctr,
                        position: row.position,
                        snapshotDate: row.snapshotDate,
                    })),
                },
        },
    };
}
export async function readClientPortal(rawToken: string, _localeOverride: SupportedLocale | undefined, db: Db, now: Date = new Date()): Promise<ClientPortalDto> {
    const notFound = () => HttpError.notFound({ code: 'CLIENT_REPORTS_ERRORS_PORTAL_NOT_FOUND', messageKey: 'clientReports.errors.portalNotFound' });
    const tokenHash = hashClientPortalToken(rawToken);
    const token = await ClientPortalToken.findOne({
        tokenHash,
        revokedAt: null,
        expiresAt: { $gt: now },
    });
    if (!token)
        throw notFound();
    const accountId = token.accountId.toString();
    const siteId = token.siteId.toString();
    // Successful artifact content is pinned by the token. The viewer/request
    // locale remains available to error middleware but can never recompose the
    // report in another language.
    if (!isSupportedLocale(token.locale))
        throw notFound();
    const locale = token.locale;
    try {
        const leased = await tryRunWithSiteWorkLease({ accountId, siteId }, 'client-portal-read', async () => {
            // Mongo is the live-resource authority, while these permanent
            // Postgres tombstones prevent a partially-purged identity/site from
            // ever being treated as live if a document is accidentally restored.
            const [accountTombstones, siteTombstones] = await Promise.all([
                db
                    .select({ accountId: accountDeletionTombstones.accountId })
                    .from(accountDeletionTombstones)
                    .where(eq(accountDeletionTombstones.accountId, accountId))
                    .limit(1),
                db
                    .select({ siteId: siteDeletionTombstones.siteId })
                    .from(siteDeletionTombstones)
                    .where(eq(siteDeletionTombstones.siteId, siteId))
                    .limit(1),
            ]);
            if (accountTombstones.length > 0 || siteTombstones.length > 0) {
                throw notFound();
            }
            const snapshot = await composeClientReport({
                accountId,
                siteId,
                locale,
                sections: {
                    audit: token.sections.audit,
                    ranks: token.sections.ranks,
                    gsc: token.sections.gsc,
                },
            }, db);
            // Revocation remains immediate even when composition is slow. These
            // predicates also stop a stale token document from crossing accounts
            // or sites after token resolution.
            const stillLive = await ClientPortalToken.exists({
                _id: token._id,
                tokenHash,
                accountId,
                siteId,
                revokedAt: null,
                expiresAt: { $gt: now },
            });
            if (!stillLive)
                throw notFound();
            // This is the authoritative pre-response boundary. The shared helper
            // performs another site assertion and then the outer account assertion
            // while unwinding, so no fallible lifecycle check happens after the
            // service hands a DTO to Express.
            await assertCurrentAccountWorkLease();
            await assertCurrentSiteWorkLease();
            return buildClientPortalDto(snapshot);
        });
        if (!leased.acquired)
            throw notFound();
        return leased.value;
    }
    catch (error) {
        // A target that disappears after token resolution is deliberately
        // indistinguishable from a bad, expired, or revoked bearer token.
        if (error instanceof HttpError && error.status === 404)
            throw notFound();
        throw error;
    }
}
