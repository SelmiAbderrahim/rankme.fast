/**
 * Competitor content intelligence — confirmed-competitor management.
 *
 * Suggestions read the competitors module's already-collected DataForSEO
 * snapshot rows (READ-ONLY, via the shared Postgres schema barrel — never the
 * competitors service internals). Confirm/manual-add validates the URL through
 * the shared SSRF authority (`assertPublicUrlSafe`, SEC-URL), deduplicates by
 * registrable domain + canonical origin, and NEVER implies the customer owns
 * the domain. List/archive/restore are owned-site scoped; a cross-account
 * competitor id returns 404 (existence-leak rule).
 *
 * Management alone spends NO Firecrawl credits and makes NO vendor call — every
 * read is a Postgres row the platform already has (SEC-RATE).
 */
import { and, asc, eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { assertPublicUrlSafe } from '../../shared/security/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { competitorProfiles, competitors, type CompetitorProfileRow, type CompetitorProfileSource, } from '../../db/schema/index.js';
/** Canonical `protocol//host` origin (host lowercased, default port dropped). */
export function canonicalOrigin(u: URL): string {
    return `${u.protocol}//${u.host.toLowerCase()}`;
}
const MULTI_PART_PUBLIC_SUFFIXES = new Set([
    'co.uk',
    'com.au',
    'co.jp',
    'co.nz',
    'com.br',
    'co.za',
    'com.mx',
    'com.tr',
    'co.in',
    'com.sg',
    'com.hk',
]);
/** Deterministic public-suffix-lite eTLD+1 dedupe key. */
export function registrableDomainKey(host: string): string {
    const normalized = host.trim().toLowerCase().replace(/\.+$/, '');
    const labels = normalized.split('.').filter(Boolean);
    if (labels.length <= 2)
        return labels.join('.');
    const suffix = labels.slice(-2).join('.');
    return MULTI_PART_PUBLIC_SUFFIXES.has(suffix)
        ? labels.slice(-3).join('.')
        : suffix;
}
async function loadOwnedSite(accountId: string, siteId: string) {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    return site;
}
export interface PublicCompetitorProfile {
    id: string;
    origin: string;
    registrableDomain: string;
    source: CompetitorProfileSource;
    status: 'active' | 'archived';
    createdAt: string | null;
}
export function toPublicCompetitorProfile(row: CompetitorProfileRow): PublicCompetitorProfile {
    return {
        id: row.id,
        origin: row.origin,
        registrableDomain: row.registrableDomain,
        source: row.source,
        status: row.status,
        // `created_at` is NOT NULL DEFAULT now() — always present on a selected row.
        createdAt: row.createdAt.toISOString(),
    };
}
// ---------------------------------------------------------------------------
// Suggestions — from the competitors module's DataForSEO snapshot rows.
// ---------------------------------------------------------------------------
export interface CompetitorSuggestion {
    registrableDomain: string;
    origin: string;
    avgPosition: number | null;
    intersections: number;
    /** True when this domain is already a confirmed profile for the site. */
    alreadyConfirmed: boolean;
}
export interface SuggestCompetitorsInput {
    accountId: string;
    siteId: string;
}
/**
 * Suggest competitors from the site's existing DataForSEO competitor snapshot.
 * Read-only — no vendor call, no write. Each suggestion is a public
 * domain the customer must still confirm; ownership is never implied.
 */
export async function suggestCompetitors(db: ApplicationDb, input: SuggestCompetitorsInput): Promise<CompetitorSuggestion[]> {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const siteId = String(site._id);
    const [snapshotRows, confirmedRows] = await Promise.all([
        db
            .select({
            competitorDomain: competitors.competitorDomain,
            avgPosition: competitors.avgPosition,
            intersections: competitors.intersections,
        })
            .from(competitors)
            .where(eq(competitors.siteId, siteId))
            // Deterministic processing order so the max-intersection dedupe is stable.
            .orderBy(asc(competitors.competitorDomain), asc(competitors.fetchedAt)),
        db
            .select({ registrableDomain: competitorProfiles.registrableDomain })
            .from(competitorProfiles)
            .where(eq(competitorProfiles.siteId, siteId)),
    ]);
    const confirmed = new Set(confirmedRows.map((r) => r.registrableDomain));
    const byDomain = new Map<string, CompetitorSuggestion>();
    for (const row of snapshotRows) {
        const registrable = registrableDomainKey(row.competitorDomain);
        if (registrable.length === 0)
            continue;
        const existing = byDomain.get(registrable);
        // `intersections` is NOT NULL DEFAULT 0 — always a number on a selected row.
        const intersections = Number(row.intersections);
        if (existing && existing.intersections >= intersections)
            continue;
        byDomain.set(registrable, {
            registrableDomain: registrable,
            origin: `https://${registrable}`,
            avgPosition: row.avgPosition === null ? null : Number(row.avgPosition),
            intersections,
            alreadyConfirmed: confirmed.has(registrable),
        });
    }
    return [...byDomain.values()].sort((a, b) => b.intersections - a.intersections || a.registrableDomain.localeCompare(b.registrableDomain));
}
// ---------------------------------------------------------------------------
// Confirm / manual-add.
// ---------------------------------------------------------------------------
export interface AddCompetitorInput {
    accountId: string;
    siteId: string;
    url: string;
    source: CompetitorProfileSource;
}
export interface AddCompetitorResult {
    profile: PublicCompetitorProfile;
    duplicate: boolean;
}
export interface AddCompetitorDeps {
    /** Deterministic concurrency seam used to prove the unique-index race path. */
    afterDuplicateCheck?: () => Promise<void>;
}
/**
 * Confirm a suggestion or add a manual competitor. Order:
 *   1. own(404) — the site must belong to the account,
 *   2. SEC-URL — `assertPublicUrlSafe` (scheme/host/DNS/redirect pinning),
 *   3. portfolio ceiling — reject once the active set is full,
 *   4. dedupe by registrable domain (unique index; a resend returns the row).
 * Never implies domain ownership.
 */
export async function addCompetitor(db: ApplicationDb, input: AddCompetitorInput, deps: AddCompetitorDeps = {}): Promise<AddCompetitorResult> {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const siteId = String(site._id);
    let safe: URL;
    try {
        safe = await assertPublicUrlSafe(input.url);
    }
    catch {
        throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_URL_UNSAFE', messageKey: 'contentIntelligence.competitorContent.errors.urlUnsafe' });
    }
    const origin = canonicalOrigin(safe);
    const registrableDomain = registrableDomainKey(safe.hostname);
    const existing = await db
        .select()
        .from(competitorProfiles)
        .where(and(eq(competitorProfiles.siteId, siteId), eq(competitorProfiles.registrableDomain, registrableDomain)))
        .limit(1);
    if (existing[0]) {
        return { profile: toPublicCompetitorProfile(existing[0]), duplicate: true };
    }
    // Portfolio ceiling — count ACTIVE profiles only.
    const activeRows = await db
        .select({ id: competitorProfiles.id })
        .from(competitorProfiles)
        .where(and(eq(competitorProfiles.siteId, siteId), eq(competitorProfiles.status, 'active')));
    if (activeRows.length >= COMPETITOR_PORTFOLIO_MAX_COMPETITORS) {
        throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_PORTFOLIO_FULL', messageKey: 'contentIntelligence.competitorContent.errors.portfolioFull' });
    }
    await deps.afterDuplicateCheck?.();
    // Insert with an ON CONFLICT DO NOTHING on the (siteId, registrableDomain)
    // unique index — a lost dedupe race returns no row, which we resolve to the
    // winning row instead of surfacing a 500.
    const inserted = await db
        .insert(competitorProfiles)
        .values({
        accountId: input.accountId,
        siteId,
        origin,
        registrableDomain,
        source: input.source,
        status: 'active',
    })
        .onConflictDoNothing({
        target: [competitorProfiles.siteId, competitorProfiles.registrableDomain],
    })
        .returning();
    if (inserted.length === 0) {
        const race = await db
            .select()
            .from(competitorProfiles)
            .where(and(eq(competitorProfiles.siteId, siteId), eq(competitorProfiles.registrableDomain, registrableDomain)))
            .limit(1);
        return { profile: toPublicCompetitorProfile(race[0]!), duplicate: true };
    }
    return { profile: toPublicCompetitorProfile(inserted[0]!), duplicate: false };
}
// ---------------------------------------------------------------------------
// List / archive / restore.
// ---------------------------------------------------------------------------
export interface ListCompetitorsInput {
    accountId: string;
    siteId: string;
    status: 'active' | 'archived' | 'all';
}
export async function listCompetitors(db: ApplicationDb, input: ListCompetitorsInput): Promise<PublicCompetitorProfile[]> {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const siteId = String(site._id);
    const where = input.status === 'all'
        ? eq(competitorProfiles.siteId, siteId)
        : and(eq(competitorProfiles.siteId, siteId), eq(competitorProfiles.status, input.status));
    const rows = await db
        .select()
        .from(competitorProfiles)
        .where(where);
    return rows
        .map(toPublicCompetitorProfile)
        .sort((a, b) => a.registrableDomain.localeCompare(b.registrableDomain));
}
export interface MutateCompetitorInput {
    accountId: string;
    siteId: string;
    competitorId: string;
}
async function updateCompetitorStatus(db: ApplicationDb, input: MutateCompetitorInput, status: 'active' | 'archived'): Promise<PublicCompetitorProfile> {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const siteId = String(site._id);
    if (status === 'active') {
        const [target, activeRows] = await Promise.all([
            db
                .select({ status: competitorProfiles.status })
                .from(competitorProfiles)
                .where(and(eq(competitorProfiles.id, input.competitorId), eq(competitorProfiles.accountId, input.accountId), eq(competitorProfiles.siteId, siteId)))
                .limit(1),
            db
                .select({ id: competitorProfiles.id })
                .from(competitorProfiles)
                .where(and(eq(competitorProfiles.siteId, siteId), eq(competitorProfiles.status, 'active'))),
        ]);
        if (!target[0]) {
            throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_COMPETITOR_NOT_FOUND', messageKey: 'contentIntelligence.competitorContent.errors.competitorNotFound' });
        }
        if (target[0].status !== 'active' &&
            activeRows.length >= COMPETITOR_PORTFOLIO_MAX_COMPETITORS) {
            throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_PORTFOLIO_FULL', messageKey: 'contentIntelligence.competitorContent.errors.portfolioFull' });
        }
    }
    const rows = await db
        .update(competitorProfiles)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(competitorProfiles.id, input.competitorId), eq(competitorProfiles.accountId, input.accountId), eq(competitorProfiles.siteId, siteId)))
        .returning();
    if (rows.length === 0) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_COMPETITOR_NOT_FOUND', messageKey: 'contentIntelligence.competitorContent.errors.competitorNotFound' });
    }
    return toPublicCompetitorProfile(rows[0]!);
}
export function archiveCompetitor(db: ApplicationDb, input: MutateCompetitorInput): Promise<PublicCompetitorProfile> {
    return updateCompetitorStatus(db, input, 'archived');
}
export function restoreCompetitor(db: ApplicationDb, input: MutateCompetitorInput): Promise<PublicCompetitorProfile> {
    return updateCompetitorStatus(db, input, 'active');
}
/**
 * Load the confirmed, active competitor profiles for a set of ids — used by the
 * run service to resolve a run's selection to safe origins. Cross-account /
 * cross-site / archived ids are dropped (never surfaced), so a run can only
 * target the caller's own active portfolio.
 */
export async function loadActiveCompetitorProfiles(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
    competitorIds: readonly string[];
}): Promise<CompetitorProfileRow[]> {
    if (input.competitorIds.length === 0)
        return [];
    const rows = await db
        .select()
        .from(competitorProfiles)
        .where(and(eq(competitorProfiles.accountId, input.accountId), eq(competitorProfiles.siteId, input.siteId), eq(competitorProfiles.status, 'active')));
    const wanted = new Set(input.competitorIds);
    return rows.filter((row) => wanted.has(row.id));
}
import { COMPETITOR_PORTFOLIO_MAX_COMPETITORS } from '../../shared/safety/feature-limits.js';
