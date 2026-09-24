import type { SpendPreview } from '../../shared/safety/operation-preview.js';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { appListingSnapshots, type AppListingSnapshotRow, } from '../../db/schema/index.js';
import { observationMetaSchema } from '../../shared/observations/observations.js';
import type { ObservationMeta } from '../../shared/observations/types.js';
import { appInfoSchema, type AppInfo, type AppStoreKind, } from '../../shared/providers/app-data.js';
import { enqueueAppSeoListingJob } from '../../shared/queue/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { loadOwnedSite } from '../sites/sites.guard.js';
import { AppProfile } from './app-profile.model.js';
import { getAppSeoTrackingQueue } from './keywords.queue-holder.js';
import { listingEngineOutputSchema, type ListingEngineOutput, } from './listing-rules/index.js';
import type { AppListingRunInput } from './listing.schema.js';
import { hasTranslationKey, localizeSemanticCopy, type SupportedLocale, type TranslationKey, } from '../../shared/i18n/index.js';
const NOT_FOUND_KEY = 'appSeo.errors.notFound';
const UNAVAILABLE_KEY = 'appSeo.listing.errors.unavailable';
export interface AppListingStoreSnapshotDto {
    store: AppStoreKind;
    listing: AppInfo;
    observationMeta: ObservationMeta;
}
export interface AppListingReportDto {
    capturedAt: string;
    engineVersion: ListingEngineOutput['engineVersion'];
    findings: Array<ListingEngineOutput['findings'][number] & {
        titleKey: TranslationKey;
        whyKey: TranslationKey;
        fixKey: TranslationKey;
        passedLabelKey: TranslationKey;
        notEvaluatedKey: TranslationKey;
        messageVars?: Record<string, string | number>;
        title: string;
        why: string;
        fix: string;
        passedText: string;
        notEvaluatedText: string;
    }>;
    notObserved: Array<ListingEngineOutput['notObserved'][number] & {
        messageKey: TranslationKey;
        message: string;
    }>;
    stores: Record<AppStoreKind, AppListingStoreSnapshotDto | null>;
}
export interface AppListingHistoryItemDto {
    capturedAt: string;
    engineVersion: ListingEngineOutput['engineVersion'];
    stores: AppStoreKind[];
    partial: boolean;
    findingCounts: Record<'fixNow' | 'watch' | 'advisory', number>;
}
function listingAuditsEnabled(): boolean {
    return env.APP_SEO_ENABLED && env.APP_LISTING_AUDITS_ENABLED;
}
function requireListingAuditsEnabled(): void {
    if (!listingAuditsEnabled()) {
        throw new HttpError(503, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
    }
}
async function requireOwnedProfile(input: {
    accountId: string;
    siteId: string;
    profileId: string;
    allowPaused: boolean;
}) {
    await loadOwnedSite(input.accountId, input.siteId, {
        allowPaused: input.allowPaused,
    });
    if (!Types.ObjectId.isValid(input.profileId)) {
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    }
    const profile = await AppProfile.findOne({
        _id: input.profileId,
        accountId: input.accountId,
        siteId: input.siteId,
    });
    if (!profile)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    return profile;
}
export function previewAppListingRun(): SpendPreview {
    return { deploymentMode: 'community', capacityEnforced: false };
}
export async function createAppListingRun(input: {
    accountId: string;
    siteId: string;
    run: AppListingRunInput;
}): Promise<{
    preview: SpendPreview;
    queued: boolean;
    runId: string | null;
    capturedAt: string | null;
}> {
    // Contractual order: feature flags → owner-scoped 404 → preview → enqueue.
    // One run covers every registered store.
    requireListingAuditsEnabled();
    await requireOwnedProfile({
        accountId: input.accountId,
        siteId: input.siteId,
        profileId: input.run.profileId,
        allowPaused: false,
    });
    const preview = previewAppListingRun();
    if (!input.run.confirm) {
        return { preview, queued: false, runId: null, capturedAt: null };
    }
    const queue = getAppSeoTrackingQueue();
    if (!queue)
        throw new HttpError(503, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
    const runId = randomUUID();
    const capturedAt = new Date().toISOString();
    await enqueueAppSeoListingJob(queue, {
        accountId: input.accountId,
        siteId: input.siteId,
        profileId: input.run.profileId,
        runId,
        capturedAt,
        locationCode: input.run.locationCode,
        languageCode: input.run.languageCode.toLocaleLowerCase(),
    });
    return { preview, queued: true, runId, capturedAt };
}
function checkedListingKey(value: string): TranslationKey {
    const key = value as TranslationKey;
    if (!value.startsWith('appSeo.listing.') || !hasTranslationKey(key)) {
        throw new RangeError('Stored app listing copy key is invalid');
    }
    return key;
}
export function localizeAppListingFinding(locale: SupportedLocale, finding: ListingEngineOutput['findings'][number]) {
    const titleKey = checkedListingKey(`${finding.copyKey}.title`);
    const whyKey = checkedListingKey(`${finding.copyKey}.why`);
    const fixKey = checkedListingKey(`${finding.copyKey}.fix`);
    const passedLabelKey = checkedListingKey(`${finding.copyKey}.passed`);
    const notEvaluatedKey = checkedListingKey(`${finding.copyKey}.notEvaluated`);
    const title = localizeSemanticCopy(locale, titleKey, finding.params);
    return {
        ...finding,
        params: title.messageVars ?? {},
        ...(title.messageVars ? { messageVars: title.messageVars } : {}),
        titleKey,
        whyKey,
        fixKey,
        passedLabelKey,
        notEvaluatedKey,
        title: title.message,
        why: localizeSemanticCopy(locale, whyKey, title.messageVars).message,
        fix: localizeSemanticCopy(locale, fixKey, title.messageVars).message,
        passedText: localizeSemanticCopy(locale, passedLabelKey, title.messageVars).message,
        notEvaluatedText: localizeSemanticCopy(locale, notEvaluatedKey, title.messageVars).message,
    };
}
function toListingReport(rows: AppListingSnapshotRow[], locale: SupportedLocale = 'en'): AppListingReportDto | null {
    const first = rows[0];
    if (!first)
        return null;
    const output = listingEngineOutputSchema.parse(first.findings);
    const stores: Record<AppStoreKind, AppListingStoreSnapshotDto | null> = {
        google_play: null,
        app_store: null,
    };
    for (const row of rows) {
        const listing = appInfoSchema.parse(row.listing);
        const observationMeta = observationMetaSchema.parse(row.observationMeta);
        if (listing.store !== row.store) {
            throw new RangeError('Stored app listing does not match its store scope');
        }
        stores[row.store] = { store: row.store, listing, observationMeta };
    }
    return {
        capturedAt: first.capturedAt.toISOString(),
        engineVersion: output.engineVersion,
        findings: output.findings.map((finding) => localizeAppListingFinding(locale, finding)),
        notObserved: output.notObserved.map((note) => {
            const messageKey = checkedListingKey(note.copyKey);
            const copy = localizeSemanticCopy(locale, messageKey);
            return { ...note, messageKey, message: copy.message };
        }),
        stores,
    };
}
export async function readLatestAppListing(input: {
    accountId: string;
    siteId: string;
    profileId: string;
    locale?: SupportedLocale;
}, db: ApplicationDb) {
    await requireOwnedProfile({ ...input, allowPaused: true });
    const latest = await db
        .select({ capturedAt: appListingSnapshots.capturedAt })
        .from(appListingSnapshots)
        .where(and(eq(appListingSnapshots.accountId, input.accountId), eq(appListingSnapshots.siteId, input.siteId), eq(appListingSnapshots.profileId, input.profileId)))
        .orderBy(desc(appListingSnapshots.capturedAt))
        .limit(1);
    const capturedAt = latest[0]?.capturedAt;
    const rows = capturedAt
        ? await db
            .select()
            .from(appListingSnapshots)
            .where(and(eq(appListingSnapshots.accountId, input.accountId), eq(appListingSnapshots.siteId, input.siteId), eq(appListingSnapshots.profileId, input.profileId), eq(appListingSnapshots.capturedAt, capturedAt)))
        : [];
    return {
        report: toListingReport(rows, input.locale ?? 'en'),
        listingEnabled: listingAuditsEnabled(),
    };
}
export async function readAppListingHistory(input: {
    accountId: string;
    siteId: string;
    profileId: string;
    limit: number;
}, db: ApplicationDb) {
    await requireOwnedProfile({ ...input, allowPaused: true });
    const rows = await db
        .select()
        .from(appListingSnapshots)
        .where(and(eq(appListingSnapshots.accountId, input.accountId), eq(appListingSnapshots.siteId, input.siteId), eq(appListingSnapshots.profileId, input.profileId)))
        .orderBy(desc(appListingSnapshots.capturedAt))
        .limit(input.limit * 2);
    const groups = new Map<string, AppListingSnapshotRow[]>();
    for (const row of rows) {
        const key = row.capturedAt.toISOString();
        const group = groups.get(key) ?? [];
        group.push(row);
        groups.set(key, group);
    }
    const items: AppListingHistoryItemDto[] = [];
    for (const [capturedAt, group] of groups) {
        if (items.length >= input.limit)
            break;
        const output = listingEngineOutputSchema.parse(group[0]?.findings);
        const findingCounts = { fixNow: 0, watch: 0, advisory: 0 };
        for (const finding of output.findings) {
            if (finding.status === 'finding')
                findingCounts[finding.severity] += 1;
        }
        items.push({
            capturedAt,
            engineVersion: output.engineVersion,
            stores: [...new Set(group.map((row) => row.store))].sort(),
            partial: output.notObserved.some((note) => note.field === 'listing'),
            findingCounts,
        });
    }
    return {
        items,
        listingEnabled: listingAuditsEnabled(),
    };
}
export const appListingServiceTestables = Object.freeze({
    listingAuditsEnabled,
    requireListingAuditsEnabled,
    requireOwnedProfile,
    toListingReport,
});
