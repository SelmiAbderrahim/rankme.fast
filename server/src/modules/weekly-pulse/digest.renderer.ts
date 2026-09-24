/**
 * Weekly Pulse — deterministic digest projection renderer.
 *
 * `renderDigestProjection(runId, deps)`:
 *   1. Reads the frozen `weekly_pulse_runs` row.
 *   2. Loads the persisted `weekly_pulse_citations` rows for the run.
 *   3. Loads the persisted `weekly_pulse_citation_changes` rows for the run.
 *   4. Reads confirmed rank drops, next actions + transitions, audience
 *      decisions, and the first-party GSC generative-AI appearance for the
 *      site — all via injectable ports so the renderer stays 100 % pure
 *      w.r.t. IO.
 *   5. Builds bounded safe payload — IDs + safe fields (host, title, keyword,
 *      prior_rank, current_rank, action_id, verb, target, appearance_name,
 *      clicks, impressions, ctr, position). NEVER raw AI answers, source
 *      excerpts, competitor prose, prompts, cost internals, or vendor task
 *      ids.
 *   6. UPSERT into `weekly_pulse_digest_projection` (unique on `pulseRunId`)
 *      so re-render always converges on the same row — retries read the
 *      same projection.
 *
 * All deep links are derived from `APP_URL` via validated environment config so
 * a compromised env value cannot leak into email.
 *
 * Deterministic ordering (fixed):
 *   1. Header — site label, ISO week UTC, market, coverage summary.
 *   2. New citations (engine → surface → host, alphabetical stable sort).
 *   3. Lost citations.
 *   4. Unknown / partial citations.
 *   5. Confirmed rank drops (confirmed_at DESC).
 *   6. Actions completed / regressed since prior compatible run.
 *   7. Next 3 open actions (top-3 cap; NEVER AI reordered).
 *   8. GSC generative appearance section (separate, never merged).
 *   9. Brand Radar deltas (account-scoped, per tracked query).
 *  10. Deep links section.
 */
import { eq, sql } from 'drizzle-orm';
import { weeklyPulseCitationChanges, weeklyPulseCitations, weeklyPulseDigestProjections, weeklyPulseRuns, type WeeklyPulseCitationRow, type WeeklyPulseCitationChangeRow, type WeeklyPulseRunRow, } from '../../db/schema/weekly-pulse.js';
import type { GscGenerativeAppearanceStatus } from '../gsc-snapshots/index.js';
import { computeBrandDeltas, WEEKLY_PULSE_BRAND_DELTA_WINDOW_MS, type BrandDeltaEntry, type BrandRadarScanWindow, type LoadBrandRadarScansInput, } from './brand-deltas.service.js';
import { env } from '../../config/env.js';
import { hasTranslationKey, localizeSemanticCopy, semanticCopy, type SupportedLocale, type TranslationKey, type TranslationVars, } from '../../shared/i18n/index.js';
// ---------------------------------------------------------------------------
// Public projection payload shape
// ---------------------------------------------------------------------------
export interface DigestCoverage {
    supported: number;
    total: number;
    supportedCells: ReadonlyArray<{
        engine: string;
        surface: string;
    }>;
    partial: boolean;
}
export interface DigestCitationEntry {
    citationId: string | null;
    engine: string;
    surface: string;
    host: string;
    canonicalUrl: string;
    titleSafe: string | null;
}
export interface DigestRankDrop {
    keyword: string;
    priorRank: number | null;
    currentRank: number | null;
    confirmedAt: string;
}
export interface SemanticDigestActionEntry {
    actionId: string;
    messageKey: TranslationKey;
    messageVars?: TranslationVars;
    targetUrl: string | null;
    targetMessageKey?: TranslationKey;
    targetMessageVars?: TranslationVars;
    state: 'completed' | 'regressed' | 'open';
}
interface LegacyDigestActionEntry {
    actionId: string;
    verb: string;
    target: string;
    state: 'completed' | 'regressed' | 'open';
}
export type DigestActionEntry = SemanticDigestActionEntry | LegacyDigestActionEntry;
export type LocalizedDigestActionEntry = (SemanticDigestActionEntry & {
    verb: string;
    target: string;
}) | LegacyDigestActionEntry;
export interface DigestGscRow {
    rawAppearance: string;
    classificationSlug: string;
    isGenerative: boolean;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}
export interface DigestGscSection {
    status: GscGenerativeAppearanceStatus;
    window: {
        start: string;
        end: string;
    } | null;
    rows: DigestGscRow[];
}
/**
 * One tracked brand query's scan-over-scan movement. Bounded and safe: ids,
 * the stored query label, an integer count delta, and four whole
 * percentage-point sentiment deltas. NEVER a mention snippet, a mention URL,
 * a digest sentence, or a cost internal.
 */
export type DigestBrandDelta = BrandDeltaEntry;
export interface DigestDeepLinks {
    digest: string;
    aiVisibility: string;
    google: string;
    contentIntelligence: string;
    audienceResearch: string;
    nextActions: string;
}
export interface DigestHeader {
    siteId: string;
    siteLabel: string;
    isoWeek: string;
    market: unknown;
    renderedAt: string;
}
export interface DigestProjectionPayload {
    header: DigestHeader;
    coverage: DigestCoverage;
    citations_new: DigestCitationEntry[];
    citations_lost: DigestCitationEntry[];
    citations_unknown_partial: DigestCitationEntry[];
    confirmed_rank_drops: DigestRankDrop[];
    actions_completed: DigestActionEntry[];
    actions_regressed: DigestActionEntry[];
    next_actions_top3: DigestActionEntry[];
    gsc_appearance: DigestGscSection;
    /** Absent on projections frozen before Brand Radar deltas shipped. */
    brand_deltas?: DigestBrandDelta[];
    deep_links: DigestDeepLinks;
}
// ---------------------------------------------------------------------------
// Injectable ports
// ---------------------------------------------------------------------------
export interface RendererConfirmedRankDrop {
    keyword: string;
    priorRank: number | null;
    currentRank: number | null;
    confirmedAt: string;
}
export type RendererActionRow = DigestActionEntry;
export interface RendererGscAppearance {
    status: GscGenerativeAppearanceStatus;
    window: {
        start: string;
        end: string;
    } | null;
    rows: ReadonlyArray<{
        rawAppearance: string;
        classificationSlug: string;
        isGenerative: boolean;
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
    }>;
}
export interface DigestRendererDeps {
    db: ApplicationDb;
    loadConfirmedRankDrops(input: {
        accountId: string;
        siteId: string;
        isoWeek: string;
    }): Promise<readonly RendererConfirmedRankDrop[]>;
    loadActionTransitions(input: {
        accountId: string;
        siteId: string;
        isoWeek: string;
    }): Promise<readonly RendererActionRow[]>;
    loadTopOpenActions(input: {
        accountId: string;
        siteId: string;
        limit: number;
    }): Promise<readonly RendererActionRow[]>;
    loadGscAppearance(input: {
        accountId: string;
        siteId: string;
    }): Promise<RendererGscAppearance | null>;
    loadSiteLabel(input: {
        accountId: string;
        siteId: string;
    }): Promise<string>;
    /** Stored-data-only Brand Radar reader. Never spends. */
    loadBrandRadarScans(input: LoadBrandRadarScansInput): Promise<BrandRadarScanWindow>;
    now?: () => Date;
}
// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------
export class MissingPulseRunError extends Error {
    constructor(runId: string) {
        super(`weeklyPulse.errors.missingRun:${runId}`);
        this.name = 'MissingPulseRunError';
    }
}
export interface RenderedDigest {
    runId: string;
    payload: DigestProjectionPayload;
}
/**
 * Deterministic digest render + freeze. Idempotent (UPSERT). The projection
 * row is the ONLY source of truth downstream — email delivery reads this
 * row and never re-derives from the source citations.
 */
export async function renderDigestProjection(runId: string, deps: DigestRendererDeps): Promise<RenderedDigest> {
    const now = (deps.now ?? (() => new Date()))();
    const run = await loadRun(deps.db, runId);
    if (!run)
        throw new MissingPulseRunError(runId);
    const citations = await loadCitations(deps.db, runId);
    const changes = await loadChanges(deps.db, runId);
    const [confirmedRankDrops, actionTransitions, topOpenActions, gscAppearance, siteLabel] = await Promise.all([
        deps.loadConfirmedRankDrops({
            accountId: run.accountId,
            siteId: run.siteId,
            isoWeek: run.isoWeek,
        }),
        deps.loadActionTransitions({
            accountId: run.accountId,
            siteId: run.siteId,
            isoWeek: run.isoWeek,
        }),
        deps.loadTopOpenActions({
            accountId: run.accountId,
            siteId: run.siteId,
            limit: 3,
        }),
        deps.loadGscAppearance({
            accountId: run.accountId,
            siteId: run.siteId,
        }),
        deps.loadSiteLabel({
            accountId: run.accountId,
            siteId: run.siteId,
        }),
    ]);
    // Brand Radar deltas — stored reads scoped to the run's OWN SITE over its
    // seven-day window (falls back to the render clock when the run row never
    // recorded a start).
    const brandWindowEnd = run.startedAt ?? now;
    const brandDeltas = await computeBrandDeltas({ ports: { loadBrandRadarScans: deps.loadBrandRadarScans } }, {
        accountId: run.accountId,
        siteId: run.siteId,
        windowStart: new Date(brandWindowEnd.getTime() - WEEKLY_PULSE_BRAND_DELTA_WINDOW_MS),
        windowEnd: brandWindowEnd,
    });
    const payload = buildPayload({
        run,
        citations,
        changes,
        confirmedRankDrops,
        actionTransitions,
        topOpenActions,
        gscAppearance,
        brandDeltas,
        siteLabel,
        renderedAt: now,
    });
    // UPSERT — replays converge onto the same projection row.
    await deps.db
        .insert(weeklyPulseDigestProjections)
        .values({
        pulseRunId: run.id,
        renderedAt: now,
        payload: payload as unknown as object,
    })
        .onConflictDoUpdate({
        target: [weeklyPulseDigestProjections.pulseRunId],
        set: {
            renderedAt: now,
            payload: payload as unknown as object,
        },
    });
    return { runId: run.id, payload };
}
// ---------------------------------------------------------------------------
// Pure builder — testable without a DB
// ---------------------------------------------------------------------------
export interface BuildDigestPayloadInput {
    run: Pick<WeeklyPulseRunRow, 'id' | 'siteId' | 'isoWeek' | 'status' | 'marketSnapshot' | 'engineSurfaceSet'>;
    citations: readonly WeeklyPulseCitationRow[];
    changes: readonly WeeklyPulseCitationChangeRow[];
    confirmedRankDrops: readonly RendererConfirmedRankDrop[];
    actionTransitions: readonly RendererActionRow[];
    topOpenActions: readonly RendererActionRow[];
    gscAppearance: RendererGscAppearance | null;
    brandDeltas: readonly DigestBrandDelta[];
    siteLabel: string;
    renderedAt: Date;
}
/** Pure — deterministic given inputs. Consumed by tests and the DB path. */
export function buildPayload(input: BuildDigestPayloadInput): DigestProjectionPayload {
    const citationIndex = new Map<string, WeeklyPulseCitationRow>();
    for (const c of input.citations) {
        citationIndex.set(citationCellKey(c), c);
    }
    const newEntries: DigestCitationEntry[] = [];
    const lostEntries: DigestCitationEntry[] = [];
    const unknownEntries: DigestCitationEntry[] = [];
    for (const change of input.changes) {
        const citation = change.citationId
            ? input.citations.find((c) => c.id === change.citationId) ?? null
            : citationIndex.get(citationCellKey(change)) ?? null;
        const entry: DigestCitationEntry = {
            citationId: change.citationId,
            engine: change.engine,
            surface: change.surface,
            host: change.host,
            canonicalUrl: change.canonicalUrl,
            titleSafe: citation?.titleSafe ?? null,
        };
        if (change.change === 'new')
            newEntries.push(entry);
        else if (change.change === 'lost')
            lostEntries.push(entry);
        else
            unknownEntries.push(entry);
    }
    sortCitationEntries(newEntries);
    sortCitationEntries(lostEntries);
    sortCitationEntries(unknownEntries);
    const rankDrops = [...input.confirmedRankDrops]
        .map((r): DigestRankDrop => ({
        keyword: r.keyword,
        priorRank: r.priorRank,
        currentRank: r.currentRank,
        confirmedAt: r.confirmedAt,
    }))
        .sort((a, b) => (a.confirmedAt < b.confirmedAt ? 1 : a.confirmedAt > b.confirmedAt ? -1 : 0));
    const actionsCompleted: DigestActionEntry[] = [];
    const actionsRegressed: DigestActionEntry[] = [];
    for (const t of input.actionTransitions) {
        if (t.state === 'completed') {
            actionsCompleted.push({
                ...normalizeDigestActionEntry(t),
                state: 'completed',
            });
        }
        else if (t.state === 'regressed') {
            actionsRegressed.push({
                ...normalizeDigestActionEntry(t),
                state: 'regressed',
            });
        }
    }
    actionsCompleted.sort((a, b) => a.actionId.localeCompare(b.actionId));
    actionsRegressed.sort((a, b) => a.actionId.localeCompare(b.actionId));
    // Exactly 3 open actions or an honest empty state. NEVER AI
    // reordered — the top-3 comes from the caller's deterministic
    // actions service.
    const topThree = input.topOpenActions.slice(0, 3).map((t): DigestActionEntry => ({
        ...normalizeDigestActionEntry(t),
        state: 'open',
    }));
    const cells = extractCells(input.run.engineSurfaceSet);
    const supported = cells.filter((c) => c.supported);
    const coverage: DigestCoverage = {
        supported: supported.length,
        total: cells.length,
        supportedCells: supported.map((c) => ({ engine: c.engine, surface: c.surface })),
        partial: input.run.status === 'partial' || (supported.length > 0 && supported.length < cells.length),
    };
    const gscSection: DigestGscSection = input.gscAppearance
        ? {
            status: input.gscAppearance.status,
            window: input.gscAppearance.window,
            rows: input.gscAppearance.rows.map((r) => ({
                rawAppearance: r.rawAppearance,
                classificationSlug: r.classificationSlug,
                isGenerative: r.isGenerative,
                clicks: r.clicks,
                impressions: r.impressions,
                ctr: r.ctr,
                position: r.position,
            })),
        }
        : {
            status: 'unavailable',
            window: null,
            rows: [],
        };
    const deepLinks = buildDeepLinks(input.run.id, input.run.siteId);
    return {
        header: {
            siteId: input.run.siteId,
            siteLabel: input.siteLabel,
            isoWeek: input.run.isoWeek,
            market: input.run.marketSnapshot,
            renderedAt: input.renderedAt.toISOString(),
        },
        coverage,
        citations_new: newEntries,
        citations_lost: lostEntries,
        citations_unknown_partial: unknownEntries,
        confirmed_rank_drops: rankDrops,
        actions_completed: actionsCompleted,
        actions_regressed: actionsRegressed,
        next_actions_top3: topThree,
        gsc_appearance: gscSection,
        brand_deltas: [...input.brandDeltas],
        deep_links: deepLinks,
    };
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function citationCellKey(row: {
    engine: string;
    surface: string;
    promptCohortId: string;
    promptCohortVersion: number;
    canonicalUrl: string;
}): string {
    return [
        row.engine,
        row.surface,
        row.promptCohortId,
        String(row.promptCohortVersion),
        row.canonicalUrl,
    ].join('|');
}
function sortCitationEntries(entries: DigestCitationEntry[]): void {
    entries.sort((a, b) => {
        if (a.engine !== b.engine)
            return a.engine.localeCompare(b.engine);
        if (a.surface !== b.surface)
            return a.surface.localeCompare(b.surface);
        if (a.host !== b.host)
            return a.host.localeCompare(b.host);
        return a.canonicalUrl.localeCompare(b.canonicalUrl);
    });
}
function extractCells(raw: unknown): Array<{
    engine: string;
    surface: string;
    supported: boolean;
}> {
    if (!Array.isArray(raw))
        return [];
    const out: Array<{
        engine: string;
        surface: string;
        supported: boolean;
    }> = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object')
            continue;
        const r = item as Record<string, unknown>;
        if (typeof r.engine !== 'string' || typeof r.surface !== 'string')
            continue;
        out.push({
            engine: r.engine,
            surface: r.surface,
            supported: Boolean(r.supported),
        });
    }
    return out;
}
/**
 * Deep-link builder — every URL is `APP_URL` + a path known-safe at build
 * time. Never a hardcoded origin.
 */
export function buildDeepLinks(runId: string, siteId: string): DigestDeepLinks {
    const base = env.APP_URL.replace(/\/+$/, '');
    const encodedSite = encodeURIComponent(siteId);
    const encodedRun = encodeURIComponent(runId);
    return {
        digest: `${base}/dashboard/sites/${encodedSite}?tab=ai-visibility&pulse=${encodedRun}`,
        aiVisibility: `${base}/dashboard/sites/${encodedSite}?tab=ai-visibility`,
        google: `${base}/dashboard/sites/${encodedSite}?tab=google`,
        contentIntelligence: `${base}/dashboard/sites/${encodedSite}?tab=content`,
        audienceResearch: `${base}/dashboard/sites/${encodedSite}?tab=audience-research`,
        nextActions: `${base}/dashboard/next-actions`,
    };
}
async function loadRun(db: ApplicationDb, runId: string): Promise<WeeklyPulseRunRow | null> {
    const rows = await db
        .select()
        .from(weeklyPulseRuns)
        .where(eq(weeklyPulseRuns.id, runId))
        .limit(1);
    return rows[0] ?? null;
}
async function loadCitations(db: ApplicationDb, runId: string): Promise<WeeklyPulseCitationRow[]> {
    return db
        .select()
        .from(weeklyPulseCitations)
        .where(eq(weeklyPulseCitations.pulseRunId, runId))
        .orderBy(sql `${weeklyPulseCitations.engine}, ${weeklyPulseCitations.surface}, ${weeklyPulseCitations.host}`);
}
async function loadChanges(db: ApplicationDb, runId: string): Promise<WeeklyPulseCitationChangeRow[]> {
    return db
        .select()
        .from(weeklyPulseCitationChanges)
        .where(eq(weeklyPulseCitationChanges.pulseRunId, runId));
}
export async function readDigestProjection(db: ApplicationDb, runId: string): Promise<DigestProjectionPayload | null> {
    const rows = await db
        .select({ payload: weeklyPulseDigestProjections.payload })
        .from(weeklyPulseDigestProjections)
        .where(eq(weeklyPulseDigestProjections.pulseRunId, runId))
        .limit(1);
    const first = rows[0];
    if (!first)
        return null;
    return first.payload as DigestProjectionPayload;
}
function legacyActionKey(state: SemanticDigestActionEntry['state']): TranslationKey {
    if (state === 'completed')
        return 'weeklyPulse.actions.completed';
    if (state === 'regressed')
        return 'weeklyPulse.actions.regressed';
    return 'weeklyPulse.actions.open';
}
function isLegacyDigestActionEntry(entry: DigestActionEntry): entry is LegacyDigestActionEntry {
    return 'verb' in entry && 'target' in entry && !('messageKey' in entry);
}
function normalizeDigestActionEntry(value: unknown): SemanticDigestActionEntry {
    const row = value as Record<string, unknown>;
    if (typeof row.verb === 'string' &&
        typeof row.target === 'string' &&
        typeof row.messageKey !== 'string') {
        throw new Error('new weekly pulse projections require semantic action copy');
    }
    const state = row.state === 'completed' || row.state === 'regressed' ? row.state : 'open';
    const candidate = row.messageKey as TranslationKey;
    const messageKey = typeof row.messageKey === 'string' && hasTranslationKey(candidate)
        ? candidate
        : legacyActionKey(state);
    const target = typeof row.target === 'string' ? row.target : null;
    const targetUrl = typeof row.targetUrl === 'string'
        ? row.targetUrl.slice(0, 500)
        : target?.startsWith('http://') || target?.startsWith('https://')
            ? target.slice(0, 500)
            : null;
    const targetCandidate = row.targetMessageKey as TranslationKey;
    const targetMessageKey = typeof row.targetMessageKey === 'string' && hasTranslationKey(targetCandidate)
        ? targetCandidate
        : targetUrl === null
            ? 'weeklyPulse.actions.targetUnavailable'
            : undefined;
    const messageCopy = semanticCopy(messageKey, row.messageVars);
    const targetCopy = targetMessageKey
        ? semanticCopy(targetMessageKey, row.targetMessageVars)
        : null;
    return {
        actionId: typeof row.actionId === 'string' ? row.actionId.slice(0, 200) : '',
        messageKey: messageCopy.messageKey,
        ...(messageCopy.messageVars ? { messageVars: messageCopy.messageVars } : {}),
        targetUrl,
        ...(targetCopy ? { targetMessageKey: targetCopy.messageKey } : {}),
        ...(targetCopy?.messageVars ? { targetMessageVars: targetCopy.messageVars } : {}),
        state,
    };
}
export function localizeDigestActionEntry(locale: SupportedLocale, entry: DigestActionEntry): LocalizedDigestActionEntry {
    // A stored legacy projection is already rendered content. Return its exact
    // verb/target bytes so historical reads and retry fingerprints cannot drift.
    if (isLegacyDigestActionEntry(entry))
        return { ...entry };
    const normalized = normalizeDigestActionEntry(entry);
    const verb = localizeSemanticCopy(locale, normalized.messageKey, normalized.messageVars).message;
    const target = normalized.targetUrl ?? localizeSemanticCopy(locale, normalized.targetMessageKey as TranslationKey, normalized.targetMessageVars).message;
    return { ...normalized, verb, target };
}
export type LocalizedDigestProjectionPayload = Omit<DigestProjectionPayload, 'actions_completed' | 'actions_regressed' | 'next_actions_top3'> & {
    actions_completed: LocalizedDigestActionEntry[];
    actions_regressed: LocalizedDigestActionEntry[];
    next_actions_top3: LocalizedDigestActionEntry[];
};
export function localizeDigestProjection(locale: SupportedLocale, projection: DigestProjectionPayload): LocalizedDigestProjectionPayload {
    return {
        ...projection,
        actions_completed: (projection.actions_completed ?? []).map((entry) => localizeDigestActionEntry(locale, entry)),
        actions_regressed: (projection.actions_regressed ?? []).map((entry) => localizeDigestActionEntry(locale, entry)),
        next_actions_top3: (projection.next_actions_top3 ?? []).map((entry) => localizeDigestActionEntry(locale, entry)),
    };
}
