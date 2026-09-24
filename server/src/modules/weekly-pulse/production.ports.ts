/**
 * Weekly Pulse production adapters.
 *
 * Every reader in this module is backed by an existing RankMeFast store. The
 * collection path never enqueues a rank check, runs an Actions mutation, or
 * calls Google; the only paid operation remains the AiVisibilityProvider call
 * owned by `collection.service.ts` after the processor's weekly run claim.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, isNotNull, isNull, lte, } from 'drizzle-orm';
import type { Logger } from 'pino';
import { user as authUsers } from '../../db/schema/auth.js';
import { actionEvents } from '../../db/schema/action-events.js';
import { aiTrackedPrompts } from '../../db/schema/ai-visibility.js';
import { audienceResearchSignalDecisionEvents } from '../../db/schema/audience-research-signal-decision-events.js';
import { gscSearchAppearance } from '../../db/schema/gsc-search-appearance.js';
import { keywords, RANK_ENGINES, } from '../../db/schema/keywords.js';
import { rankDropConfirmations } from '../../db/schema/rank-drop-confirmations.js';
import { teamMembers } from '../../db/schema/team-members.js';
import { canTeamUserAccessSite } from '../../shared/team-site-access/repository.js';
import { weeklyPulseRuns } from '../../db/schema/weekly-pulse.js';
import { isEmailTransportConfigured, sendEmail, } from '../communication/index.js';
import { buildGenerativeAppearanceRead, } from '../gsc-snapshots/index.js';
import { listActionsForSite, registerBuiltInActionAdapters, type ActionItem, type ListActionsResult, } from '../actions/index.js';
import { Site } from '../sites/sites.model.js';
import { marketFromDataForSeo, } from '../../shared/observations/observations.js';
import type { ActionRow, AudienceDecision, CollectionPorts, ConfirmedRankDrop, CoverageSnapshot, PromptCohortSnapshot, SiteMarketSnapshot, } from './collection.service.js';
import { deliverPulseDigest, type DeliverPulseDigestOutcome, } from './delivery.service.js';
import { readDigestProjection, renderDigestProjection, type DigestRendererDeps, type RendererGscAppearance, } from './digest.renderer.js';
import { loadBrandRadarScans } from './brand-deltas.port.js';
import type { BrandRadarScanWindow, LoadBrandRadarScansInput, } from './brand-deltas.service.js';
import type { ResolvedSite } from './pulse.processor.js';
/** A pulse compares the seven days ending at its collection clock. */
export const WEEKLY_PULSE_COMPARISON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ACTION_READ_LIMIT = 50;
const LOCAL_EVIDENCE_LIMIT = 100;
const TEXT_BOUND = 500;
type ListActions = (input: {
    accountId: string;
    siteId: string;
    locale: 'en';
    db: ApplicationDb;
    filters?: {
        state?: readonly ('open' | 'planned' | 'dismissed' | 'completed')[];
    };
    limit?: number;
}) => Promise<ListActionsResult>;
export interface WeeklyPulseProductionPortsDeps {
    db: ApplicationDb;
    logger: Logger;
    /** Test seam; production uses the deterministic Actions public service. */
    listActions?: ListActions;
    /** Test seams for proving the projection/delivery hand-off. */
    renderDigest?: typeof renderDigestProjection;
    deliverDigest?: typeof deliverPulseDigest;
    sendDigestEmail?: typeof sendEmail;
    emailTransportAvailable?: typeof isEmailTransportConfigured;
    loadStoredBrandRadarScans?: (input: LoadBrandRadarScansInput) => Promise<BrandRadarScanWindow>;
}
export interface WeeklyPulseProductionPorts {
    collection: CollectionPorts;
    resolveSite(input: {
        accountId: string;
        siteId: string;
    }): Promise<ResolvedSite | null>;
    loadBrandRadarScans(input: LoadBrandRadarScansInput): Promise<BrandRadarScanWindow>;
    projectAndDeliver(runId: string): Promise<DeliverPulseDigestOutcome>;
}
/**
 * Build the complete production adapter bag once at worker boot. Keeping this
 * composition here makes it difficult to accidentally regress the worker to
 * `async () => []` placeholders when a source module changes.
 */
export function createWeeklyPulseProductionPorts(deps: WeeklyPulseProductionPortsDeps): WeeklyPulseProductionPorts {
    if (!deps.listActions)
        registerBuiltInActionAdapters();
    const listActions = deps.listActions ?? (listActionsForSite as ListActions);
    const collection = createCollectionPorts(deps.db, listActions);
    const loadStoredBrandRadarScans = deps.loadStoredBrandRadarScans ?? loadBrandRadarScans;
    return {
        collection,
        resolveSite: (input) => resolveSite(input),
        loadBrandRadarScans: loadStoredBrandRadarScans,
        projectAndDeliver: async (runId) => {
            // A BullMQ retry must use the already-frozen projection. Re-rendering
            // would let source records that changed after collection rewrite an
            // historical email.
            const frozen = await readDigestProjection(deps.db, runId);
            if (!frozen) {
                const render = deps.renderDigest ?? renderDigestProjection;
                await render(runId, createDigestRendererDeps({
                    db: deps.db,
                    listActions,
                    loadBrandRadarScans: loadStoredBrandRadarScans,
                }));
            }
            const deliver = deps.deliverDigest ?? deliverPulseDigest;
            const outcome = await deliver(runId, {
                db: deps.db,
                sendEmail: deps.sendDigestEmail ?? sendEmail,
                resolveRecipient: (input) => resolveRecipient(deps.db, input),
                transportAvailable: deps.emailTransportAvailable ?? isEmailTransportConfigured,
                logger: deps.logger,
            });
            deps.logger.info({
                runId,
                attempted: outcome.attempted,
                delivered: outcome.delivered,
                suppressed: outcome.suppressed,
                errors: outcome.errors,
            }, 'weekly-pulse projection and delivery settled');
            return outcome;
        },
    };
}
function createCollectionPorts(db: ApplicationDb, listActions: ListActions): CollectionPorts {
    return {
        loadSiteMarket: (input) => loadSiteMarket(db, input),
        loadPromptCohort: (input) => loadPromptCohort(db, input),
        loadCoverage: (input) => loadCoverage(db, input),
        loadConfirmedRankDrops: (input) => loadConfirmedRankDrops(db, input),
        loadTopOpenActions: (input) => loadTopOpenActions(db, listActions, input),
        loadActionTransitions: (input) => loadActionTransitions(db, listActions, input),
        loadAudienceDecisions: (input) => loadAudienceDecisions(db, input),
    };
}
async function loadActiveGoogleKeyword(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
}) {
    const rows = await db
        .select({
        id: keywords.id,
        locationCode: keywords.locationCode,
        languageCode: keywords.languageCode,
        device: keywords.device,
    })
        .from(keywords)
        .where(and(eq(keywords.accountId, input.accountId), eq(keywords.siteId, input.siteId), eq(keywords.active, true), eq(keywords.engine, RANK_ENGINES[0])))
        // The oldest active Google target is the site's stable primary market.
        // Adding another keyword must not silently change pulse compatibility.
        .orderBy(asc(keywords.createdAt), asc(keywords.id))
        .limit(1);
    return rows[0] ?? null;
}
async function loadSiteMarket(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
}): Promise<SiteMarketSnapshot | null> {
    const keyword = await loadActiveGoogleKeyword(db, input);
    if (!keyword)
        return null;
    return {
        value: marketFromDataForSeo({
            locationCode: keyword.locationCode,
            languageCode: keyword.languageCode,
            device: keyword.device,
        }),
    };
}
async function loadPromptCohort(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
}): Promise<PromptCohortSnapshot | null> {
    const rows = await db
        .select({
        id: aiTrackedPrompts.id,
        prompt: aiTrackedPrompts.prompt,
    })
        .from(aiTrackedPrompts)
        .where(and(eq(aiTrackedPrompts.accountId, input.accountId), eq(aiTrackedPrompts.siteId, input.siteId)))
        .orderBy(asc(aiTrackedPrompts.createdAt), asc(aiTrackedPrompts.id));
    if (rows.length === 0)
        return null;
    const digest = createHash('sha256')
        .update(JSON.stringify(rows))
        .digest('hex');
    return {
        id: `tracked-prompts:${digest}`,
        version: 1,
        prompts: rows.map((row) => row.prompt),
    };
}
async function loadCoverage(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
}): Promise<CoverageSnapshot> {
    const keyword = await loadActiveGoogleKeyword(db, input);
    if (!keyword)
        return { cells: [] };
    const market = marketFromDataForSeo({
        locationCode: keyword.locationCode,
        languageCode: keyword.languageCode,
        device: keyword.device,
    });
    // The shipped DataForSEO adapter currently supports historical Mentions in
    // US/English for exactly Google and ChatGPT. Other markets are an honest
    // unsupported state; they are never silently remapped to US/en.
    const supported = market.country === 'US' && market.language.split('-')[0] === 'en';
    const reason = supported ? null : 'unsupported_market';
    return {
        cells: [
            { engine: 'google', surface: 'mentions', supported, reason },
            { engine: 'chat_gpt', surface: 'mentions', supported, reason },
        ],
    };
}
function windowStart(windowEnd: Date): Date {
    return new Date(windowEnd.getTime() - WEEKLY_PULSE_COMPARISON_WINDOW_MS);
}
async function loadConfirmedRankDrops(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
    windowEnd: Date;
}): Promise<readonly ConfirmedRankDrop[]> {
    const rows = await db
        .select({
        keyword: keywords.phrase,
        priorRank: rankDropConfirmations.previousPosition,
        currentRank: rankDropConfirmations.confirmationPosition,
        confirmedAt: rankDropConfirmations.confirmationObservedAt,
    })
        .from(rankDropConfirmations)
        .innerJoin(keywords, eq(keywords.id, rankDropConfirmations.keywordId))
        .where(and(eq(rankDropConfirmations.accountId, input.accountId), eq(rankDropConfirmations.siteId, input.siteId), eq(rankDropConfirmations.state, 'confirmed'), isNotNull(rankDropConfirmations.confirmationObservedAt), gt(rankDropConfirmations.confirmationObservedAt, windowStart(input.windowEnd)), lte(rankDropConfirmations.confirmationObservedAt, input.windowEnd)))
        .orderBy(desc(rankDropConfirmations.confirmationObservedAt), desc(rankDropConfirmations.id))
        .limit(LOCAL_EVIDENCE_LIMIT);
    return rows.map((row) => ({
        keyword: row.keyword,
        priorRank: row.priorRank,
        currentRank: row.currentRank,
        // The `isNotNull` predicate plus the schema's confirmed-row CHECK makes
        // this non-null.
        confirmedAt: (row.confirmedAt as Date).toISOString(),
    }));
}
function bounded(value: string): string {
    return value.slice(0, TEXT_BOUND);
}
function actionRow(item: ActionItem, state: ActionRow['state']): ActionRow {
    return {
        actionId: item.id,
        messageKey: item.copy.nextStep.messageKey,
        ...(item.copy.nextStep.messageVars
            ? { messageVars: item.copy.nextStep.messageVars }
            : {}),
        targetUrl: item.affectedUrls[0] ? bounded(item.affectedUrls[0]) : null,
        ...(!item.affectedUrls[0]
            ? {
                targetMessageKey: item.copy.problem.messageKey,
                ...(item.copy.problem.messageVars
                    ? { targetMessageVars: item.copy.problem.messageVars }
                    : {}),
            }
            : {}),
        state,
    };
}
async function loadTopOpenActions(db: ApplicationDb, listActions: ListActions, input: {
    accountId: string;
    siteId: string;
    limit: number;
}): Promise<readonly ActionRow[]> {
    const result = await listActions({
        accountId: input.accountId,
        siteId: input.siteId,
        locale: 'en',
        db,
        filters: { state: ['open'] },
        limit: Math.min(input.limit, 3),
    });
    return result.items.slice(0, Math.min(input.limit, 3)).map((item) => actionRow(item, 'open'));
}
async function loadActionTransitions(db: ApplicationDb, listActions: ListActions, input: {
    accountId: string;
    siteId: string;
    windowEnd: Date;
}): Promise<readonly ActionRow[]> {
    const events = await db
        .select()
        .from(actionEvents)
        .where(and(eq(actionEvents.accountId, input.accountId), eq(actionEvents.siteId, input.siteId), gt(actionEvents.createdAt, windowStart(input.windowEnd)), lte(actionEvents.createdAt, input.windowEnd)))
        .orderBy(desc(actionEvents.createdAt), desc(actionEvents.ordinal))
        .limit(LOCAL_EVIDENCE_LIMIT);
    const terminal = new Map<string, 'completed' | 'regressed'>();
    for (const event of events) {
        if (terminal.has(event.actionId))
            continue;
        if (event.newState === 'completed')
            terminal.set(event.actionId, 'completed');
        else if (event.eventKind === 'reopen' || event.priorState === 'completed') {
            terminal.set(event.actionId, 'regressed');
        }
    }
    if (terminal.size === 0)
        return [];
    const actions = await listActions({
        accountId: input.accountId,
        siteId: input.siteId,
        locale: 'en',
        db,
        limit: ACTION_READ_LIMIT,
    });
    const byId = new Map(actions.items.map((item) => [item.id, item]));
    return Array.from(terminal, ([actionId, state]) => {
        const item = byId.get(actionId);
        if (item)
            return actionRow(item, state);
        return {
            actionId,
            messageKey: state === 'completed'
                ? 'weeklyPulse.actions.completed'
                : 'weeklyPulse.actions.regressed',
            targetUrl: null,
            targetMessageKey: 'weeklyPulse.actions.targetUnavailable',
            state,
        };
    });
}
async function loadAudienceDecisions(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
    windowEnd: Date;
}): Promise<readonly AudienceDecision[]> {
    const rows = await db
        .select({
        id: audienceResearchSignalDecisionEvents.id,
        decidedAt: audienceResearchSignalDecisionEvents.decidedAt,
    })
        .from(audienceResearchSignalDecisionEvents)
        .where(and(eq(audienceResearchSignalDecisionEvents.accountId, input.accountId), eq(audienceResearchSignalDecisionEvents.siteId, input.siteId), eq(audienceResearchSignalDecisionEvents.decision, 'accepted'), gt(audienceResearchSignalDecisionEvents.decidedAt, windowStart(input.windowEnd)), lte(audienceResearchSignalDecisionEvents.decidedAt, input.windowEnd)))
        .orderBy(desc(audienceResearchSignalDecisionEvents.decidedAt), desc(audienceResearchSignalDecisionEvents.id))
        .limit(LOCAL_EVIDENCE_LIMIT);
    return rows.map((row) => ({
        id: row.id,
        acceptedAt: row.decidedAt.toISOString(),
    }));
}
async function resolveSite(input: {
    accountId: string;
    siteId: string;
}): Promise<ResolvedSite | null> {
    const site = await Site.findOne({
        _id: input.siteId,
        accountId: input.accountId,
        paused: { $ne: true },
        deletionStartedAt: null,
    }).lean();
    return site ? { siteDomain: site.domain } : null;
}
async function loadOwnedSiteLabel(input: {
    accountId: string;
    siteId: string;
}): Promise<string> {
    const site = await Site.findOne({
        _id: input.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    }, { displayName: 1, domain: 1 }).lean();
    if (!site)
        return input.siteId;
    const displayName = site.displayName?.trim();
    return displayName || site.domain;
}
async function loadGscAppearance(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
}): Promise<RendererGscAppearance | null> {
    const site = await Site.findOne({
        _id: input.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    }, { gscPropertyUrl: 1, gscBindingGenerationId: 1 }).lean();
    if (!site)
        return null;
    if (!site.gscPropertyUrl) {
        return { status: 'reconnect_required', window: null, rows: [] };
    }
    const bindingGenerationId = site.gscBindingGenerationId ?? 'legacy';
    const latest = await db
        .select({ snapshotDate: gscSearchAppearance.snapshotDate })
        .from(gscSearchAppearance)
        .where(and(eq(gscSearchAppearance.accountId, input.accountId), eq(gscSearchAppearance.siteId, input.siteId), eq(gscSearchAppearance.bindingGenerationId, bindingGenerationId), eq(gscSearchAppearance.property, site.gscPropertyUrl), eq(gscSearchAppearance.windowDays, 28)))
        .orderBy(desc(gscSearchAppearance.snapshotDate))
        .limit(1);
    const snapshotDate = latest[0]?.snapshotDate;
    if (!snapshotDate)
        return { status: 'unavailable', window: null, rows: [] };
    const rows = await db
        .select()
        .from(gscSearchAppearance)
        .where(and(eq(gscSearchAppearance.accountId, input.accountId), eq(gscSearchAppearance.siteId, input.siteId), eq(gscSearchAppearance.bindingGenerationId, bindingGenerationId), eq(gscSearchAppearance.property, site.gscPropertyUrl), eq(gscSearchAppearance.snapshotDate, snapshotDate), eq(gscSearchAppearance.windowDays, 28)))
        .orderBy(desc(gscSearchAppearance.classifiedGenerative), desc(gscSearchAppearance.clicks), asc(gscSearchAppearance.rawAppearance));
    const read = buildGenerativeAppearanceRead(rows);
    return {
        status: read.status,
        // A latest snapshot date was found, so buildGenerativeAppearanceRead
        // always supplies the queried window (even when no row is generative).
        window: {
            start: read.window!.start,
            end: read.window!.end,
        },
        rows: read.rows,
    };
}
async function runWindowEnd(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
    isoWeek: string;
}): Promise<Date> {
    const rows = await db
        .select({
        startedAt: weeklyPulseRuns.startedAt,
        finishedAt: weeklyPulseRuns.finishedAt,
    })
        .from(weeklyPulseRuns)
        .where(and(eq(weeklyPulseRuns.accountId, input.accountId), eq(weeklyPulseRuns.siteId, input.siteId), eq(weeklyPulseRuns.isoWeek, input.isoWeek)))
        .limit(1);
    return rows[0]?.startedAt ?? rows[0]?.finishedAt ?? new Date(0);
}
function createDigestRendererDeps(input: {
    db: ApplicationDb;
    listActions: ListActions;
    loadBrandRadarScans(input: LoadBrandRadarScansInput): Promise<BrandRadarScanWindow>;
}): DigestRendererDeps {
    return {
        db: input.db,
        loadConfirmedRankDrops: async (scope) => loadConfirmedRankDrops(input.db, {
            accountId: scope.accountId,
            siteId: scope.siteId,
            windowEnd: await runWindowEnd(input.db, scope),
        }),
        loadActionTransitions: async (scope) => loadActionTransitions(input.db, input.listActions, {
            accountId: scope.accountId,
            siteId: scope.siteId,
            windowEnd: await runWindowEnd(input.db, scope),
        }),
        loadTopOpenActions: (scope) => loadTopOpenActions(input.db, input.listActions, scope),
        loadGscAppearance: (scope) => loadGscAppearance(input.db, scope),
        loadSiteLabel: (scope) => loadOwnedSiteLabel(scope),
        loadBrandRadarScans: input.loadBrandRadarScans,
    };
}
async function resolveRecipient(db: ApplicationDb, input: {
    accountId: string;
    userId: string;
    siteId?: string;
}): Promise<{
    email: string;
    membership: 'active' | 'removed';
} | {
    email: null;
    membership: 'active' | 'removed';
} | null> {
    const identities = await db
        .select({ email: authUsers.email })
        .from(authUsers)
        .where(and(eq(authUsers.id, input.userId), eq(authUsers.emailVerified, true)))
        .limit(1);
    const identity = identities[0];
    if (!identity)
        return null;
    if (input.userId === input.accountId) {
        return { email: identity.email, membership: 'active' };
    }
    if (input.siteId) {
        const active = await canTeamUserAccessSite(db, {
            teamId: input.accountId,
            userId: input.userId,
            siteId: input.siteId,
        });
        return {
            email: identity.email,
            membership: active ? 'active' : 'removed',
        };
    }
    const memberships = await db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, input.accountId), eq(teamMembers.userId, input.userId), isNotNull(teamMembers.acceptedAt), isNull(teamMembers.revokedAt)))
        .limit(1);
    return {
        email: identity.email,
        membership: memberships.length > 0 ? 'active' : 'removed',
    };
}
