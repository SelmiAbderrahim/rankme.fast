import type { SpendPreview, SpendPreviewCoverage } from '../../shared/safety/operation-preview.js';
/**
 * Weekly Pulse — HTTP-side service.
 *
 * Five site-scoped read/write operations:
 *   GET     ...                          → subscription + setting + last run + coverage
 *   POST    .../preview                  → SpendPreview (no vendor)
 *   PUT     ...                          → mutate CALLER's subscription only
 *   GET     .../history?cursor=&limit=   → paginated stored runs
 *   GET     .../history/:pulseId         → digest projection + change list
 *
 * Purity guarantees:
 *   • Preview NEVER calls a vendor and NEVER writes. It is a read-only
 *     SpendPreview.
 *   • PUT validates preview acknowledgement; the scheduled job runs the
 *     collection at run time.
 *   • Reads never enqueue and never call a provider.
 *
 * Cross-account 404: a request for a site the caller does not own returns
 * 404 (see `better-auth-integration.md`) — never 403.
 */
import { Types } from 'mongoose';
import type { Queue } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { readSearchAppearance, buildGenerativeAppearanceRead } from '../gsc-snapshots/index.js';
import type { GscGenerativeAppearanceRead, } from '../gsc-snapshots/index.js';
import { computeSchedule, nextRunAt } from './schedule.js';
import { weeklyPulseCitationChanges, sitePulseSubscriptions, type WeeklyPulseRunRow, } from '../../db/schema/weekly-pulse.js';
import { findLatestRun, findRun, findSetting, findSubscription, listHistory, listSubscriptions, upsertSetting, upsertSubscription, } from './weekly-pulse.repo.js';
import { localizeDigestProjection, readDigestProjection, type LocalizedDigestProjectionPayload, } from './digest.renderer.js';
import type { SupportedLocale } from '../../shared/i18n/index.js';
import { pulseSchedulerKey, removePulseScheduler, upsertPulseScheduler } from './scheduler.js';
// ---------------------------------------------------------------------------
// Public views
// ---------------------------------------------------------------------------
export interface PulseSubscriptionView {
    enabled: boolean;
    locale: string;
    enabledAt: string | null;
    disabledAt: string | null;
}
export interface PulseSettingView {
    enabled: boolean;
    nextRunAt: string;
    lastRunAt: string | null;
    lastStatus: string | null;
}
export interface PulseRunSummary {
    runId: string;
    isoWeek: string;
    status: WeeklyPulseRunRow['status'];
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
}
export interface PulseStateView {
    siteId: string;
    subscription: PulseSubscriptionView | null;
    setting: PulseSettingView | null;
    lastRun: PulseRunSummary | null;
    coverage: SpendPreviewCoverage[];
    gscAppearance: GscGenerativeAppearanceRead;
}
export interface PulseHistoryPage {
    siteId: string;
    runs: PulseRunSummary[];
    nextCursor: string | null;
}
export interface PulseHistoryDetail {
    siteId: string;
    runId: string;
    isoWeek: string;
    status: WeeklyPulseRunRow['status'];
    projection: LocalizedDigestProjectionPayload | null;
    citationChanges: Array<{
        change: 'new' | 'lost' | 'unknown_partial';
        engine: string;
        surface: string;
        host: string;
        canonicalUrl: string;
        citationId: string | null;
    }>;
}
// ---------------------------------------------------------------------------
// Input contracts
// ---------------------------------------------------------------------------
export interface OwnerScope {
    accountId: string;
    siteId: string;
    userId: string;
}
export interface SetSubscriptionInput extends OwnerScope {
    enabled: boolean;
    acknowledgedPreviewAt?: string;
    locale?: string;
    resolvedLocale: string;
}
export interface WeeklyPulseServiceDeps {
    db: ApplicationDb;
    /** Wired by the app boot; tests inject a fake. When null, the enable path
     * still writes but never touches the scheduler. */
    queue: Queue | null;
    now?: () => Date;
}
// ---------------------------------------------------------------------------
// Ownership helpers (cross-account → 404)
// ---------------------------------------------------------------------------
async function loadOwnedSite(accountId: string, siteId: string) {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    return site;
}
// ---------------------------------------------------------------------------
// GET state
// ---------------------------------------------------------------------------
export async function getPulseState(input: OwnerScope, deps: WeeklyPulseServiceDeps): Promise<PulseStateView> {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const [subscription, setting, lastRun] = await Promise.all([
        findSubscription(deps.db, input.accountId, input.siteId, input.userId),
        findSetting(deps.db, input.accountId, input.siteId),
        findLatestRun(deps.db, input.accountId, input.siteId),
    ]);
    const gscAppearance = await loadGscAppearanceForSite(deps.db, input.siteId, site.gscPropertyUrl ?? null, site.gscPropertyUrl ? site.gscBindingGenerationId ?? 'legacy' : null);
    const coverage: SpendPreviewCoverage[] = [
        {
            observationType: 'weekly_pulse',
            state: 'supported',
            coverageNoteKey: 'weeklyPulse.optIn.unitDisclosure',
        },
    ];
    return {
        siteId: input.siteId,
        subscription: subscription
            ? {
                enabled: subscription.disabledAt === null,
                locale: subscription.locale,
                enabledAt: subscription.enabledAt.toISOString(),
                disabledAt: subscription.disabledAt?.toISOString() ?? null,
            }
            : null,
        setting: setting
            ? {
                enabled: setting.enabled,
                nextRunAt: setting.nextRunAt.toISOString(),
                lastRunAt: setting.lastRunAt?.toISOString() ?? null,
                lastStatus: setting.lastStatus ?? null,
            }
            : null,
        lastRun: lastRun ? summarizeRun(lastRun) : null,
        coverage,
        gscAppearance,
    };
}
// ---------------------------------------------------------------------------
// POST preview — read-only
// ---------------------------------------------------------------------------
export async function previewPulseSpend(input: OwnerScope): Promise<SpendPreview> {
    await loadOwnedSite(input.accountId, input.siteId);
    return { deploymentMode: 'community', capacityEnforced: false };
}
// ---------------------------------------------------------------------------
// PUT — mutate ONLY the caller's row
// ---------------------------------------------------------------------------
const ACK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export async function setPulseSubscription(input: SetSubscriptionInput, deps: WeeklyPulseServiceDeps): Promise<PulseStateView> {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    if (input.enabled) {
        // Spend gate on the SUBSCRIBE path only — disabling a paused site's pulse
        // (and every read) stays open.
        assertSiteNotPaused(site);
        if (!input.acknowledgedPreviewAt) {
            throw HttpError.badRequest({ code: 'WEEKLY_PULSE_ERRORS_ACKNOWLEDGE_PREVIEW_REQUIRED', messageKey: 'weeklyPulse.errors.acknowledgePreviewRequired' });
        }
        const ackTime = new Date(input.acknowledgedPreviewAt);
        if (Number.isNaN(ackTime.getTime())) {
            throw HttpError.badRequest({ code: 'WEEKLY_PULSE_ERRORS_ACKNOWLEDGE_PREVIEW_REQUIRED', messageKey: 'weeklyPulse.errors.acknowledgePreviewRequired' });
        }
        const now = (deps.now ?? (() => new Date()))();
        if (now.getTime() - ackTime.getTime() > ACK_MAX_AGE_MS) {
            throw HttpError.badRequest({ code: 'WEEKLY_PULSE_ERRORS_ACKNOWLEDGE_PREVIEW_REQUIRED', messageKey: 'weeklyPulse.errors.acknowledgePreviewRequired' });
        }
    }
    const locale = input.locale ?? input.resolvedLocale;
    await upsertSubscription(deps.db, {
        accountId: input.accountId,
        siteId: input.siteId,
        userId: input.userId,
        locale,
        disabledAt: input.enabled ? null : new Date(),
    });
    // Recompute setting.enabled = any(active subscription) after the toggle.
    const subs = await listSubscriptions(deps.db, input.accountId, input.siteId);
    const anyActive = subs.some((s) => s.disabledAt === null);
    const schedule = computeSchedule(input.siteId);
    const now = (deps.now ?? (() => new Date()))();
    await upsertSetting(deps.db, {
        accountId: input.accountId,
        siteId: input.siteId,
        enabled: anyActive,
        scheduleKey: schedule.scheduleKey,
        nextRunAt: anyActive ? nextRunAt(schedule, now) : now,
    });
    if (deps.queue) {
        if (anyActive) {
            await upsertPulseScheduler(deps.queue, {
                accountId: input.accountId,
                siteId: input.siteId,
            });
        }
        else {
            await removePulseScheduler(deps.queue, input.siteId);
        }
    }
    return getPulseState(input, deps);
}
// ---------------------------------------------------------------------------
// GET history + detail
// ---------------------------------------------------------------------------
export async function getPulseHistoryPage(input: OwnerScope & {
    limit: number;
    cursor?: string;
}, deps: WeeklyPulseServiceDeps): Promise<PulseHistoryPage> {
    await loadOwnedSite(input.accountId, input.siteId);
    const page = await listHistory(deps.db, input.accountId, input.siteId, input.limit, input.cursor);
    return {
        siteId: input.siteId,
        runs: page.runs.map(summarizeRun),
        nextCursor: page.nextCursor,
    };
}
export async function getPulseHistoryDetail(input: OwnerScope & {
    pulseId: string;
    locale?: SupportedLocale;
}, deps: WeeklyPulseServiceDeps): Promise<PulseHistoryDetail> {
    await loadOwnedSite(input.accountId, input.siteId);
    const run = await findRun(deps.db, input.accountId, input.siteId, input.pulseId);
    if (!run)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    const projection = await readDigestProjection(deps.db, run.id);
    const changes = await deps.db
        .select()
        .from(weeklyPulseCitationChanges)
        .where(eq(weeklyPulseCitationChanges.pulseRunId, run.id));
    return {
        siteId: input.siteId,
        runId: run.id,
        isoWeek: run.isoWeek,
        status: run.status,
        projection: projection
            ? localizeDigestProjection(input.locale ?? 'en', projection)
            : null,
        citationChanges: changes.map((c) => ({
            change: c.change,
            engine: c.engine,
            surface: c.surface,
            host: c.host,
            canonicalUrl: c.canonicalUrl,
            citationId: c.citationId,
        })),
    };
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function summarizeRun(run: WeeklyPulseRunRow): PulseRunSummary {
    return {
        runId: run.id,
        isoWeek: run.isoWeek,
        status: run.status,
        startedAt: run.startedAt?.toISOString() ?? null,
        finishedAt: run.finishedAt?.toISOString() ?? null,
        createdAt: run.createdAt.toISOString(),
    };
}
async function loadGscAppearanceForSite(db: ApplicationDb, siteId: string, property: string | null, bindingGenerationId: string | null): Promise<GscGenerativeAppearanceRead> {
    if (!property || !bindingGenerationId) {
        return buildGenerativeAppearanceRead([]);
    }
    try {
        const rows = await readSearchAppearance(db as unknown as Parameters<typeof readSearchAppearance>[0], siteId, property, { bindingGenerationId });
        return buildGenerativeAppearanceRead(rows);
    }
    catch {
        // Defensive: a store error from readSearchAppearance degrades the card
        // to `unavailable` rather than failing the whole state view.
        return buildGenerativeAppearanceRead([]);
    }
}
// ---------------------------------------------------------------------------
// Exposed util so tests can assert scheduler key derivation from siteId.
// ---------------------------------------------------------------------------
export function siteSchedulerKey(siteId: string): string {
    return pulseSchedulerKey(siteId);
}
// ---------------------------------------------------------------------------
// Superadmin-friendly count of eligible recipients for observability.
// Kept here so the read-only path stays private-service.
// ---------------------------------------------------------------------------
export async function countActiveRecipients(db: ApplicationDb, accountId: string, siteId: string): Promise<number> {
    const rows = await db
        .select({ n: sql<number> `count(*)::int` })
        .from(sitePulseSubscriptions)
        .where(and(eq(sitePulseSubscriptions.accountId, accountId), eq(sitePulseSubscriptions.siteId, siteId)));
    return rows[0]?.n ?? 0;
}
