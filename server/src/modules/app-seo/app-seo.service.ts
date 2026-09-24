import { and, eq } from 'drizzle-orm';
import mongoose, { Types, type Model } from 'mongoose';
import { env } from '../../config/env.js';
import { appChartSnapshots, appKeywords, appListingSnapshots, } from '../../db/schema/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { AppProfile, type AppProfileDocument } from './app-profile.model.js';
import type { RegisterAppProfileInput } from './app-seo.schema.js';
const NOT_FOUND_KEY = 'appSeo.errors.notFound';
const UNAVAILABLE_KEY = 'appSeo.errors.productUnavailable';
export interface AppProfileDto {
    id: string;
    siteId: string;
    playPackageId: string | null;
    appStoreId: string | null;
    paired: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface AppSeoServiceDependencies {
    db: ApplicationDb;
}
function requireEnabled(): void {
    if (!env.APP_SEO_ENABLED)
        throw new HttpError(503, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
}
/** Malformed, missing, deleting, and foreign Sites deliberately collapse to one 404. */
async function requireOwnedSite(accountId: string, siteId: string): Promise<void> {
    if (!Types.ObjectId.isValid(siteId))
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    const site = await Site.findOne({
        _id: siteId,
        accountId,
        deletionStartedAt: null,
    }).select({ _id: 1 });
    if (!site)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
}
function toDto(profile: AppProfileDocument & {
    _id: unknown;
}): AppProfileDto {
    return {
        id: String(profile._id),
        siteId: String(profile.siteId),
        playPackageId: profile.playPackageId ?? null,
        appStoreId: profile.appStoreId ?? null,
        paired: profile.paired,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
    };
}
interface ProfileDescendant {
    model: Model<unknown>;
    ids: Set<string>;
    depth: number;
}
/**
 * Delete current and future Mongo children that declare an AppProfile ref.
 * The bounded descendant walk keeps profile deletion complete as later waves
 * add review runs and their own child collections.
 */
export async function purgeAppProfileMongoChildren(profileId: string): Promise<number> {
    const idsByModel = new Map<string, Set<string>>([
        ['AppProfile', new Set([profileId])],
    ]);
    const descendants = new Map<string, ProfileDescendant>();
    let changed = true;
    while (changed) {
        changed = false;
        for (const name of mongoose.modelNames()) {
            if (name === 'AppProfile')
                continue;
            const model = mongoose.model(name) as Model<unknown>;
            const conditions: Array<Record<string, unknown>> = [];
            let depth = 1;
            model.schema.eachPath((path, schemaType) => {
                const typed = schemaType as unknown as {
                    options?: {
                        ref?: unknown;
                    };
                    caster?: {
                        options?: {
                            ref?: unknown;
                        };
                    };
                };
                const candidate = typed.options?.ref ?? typed.caster?.options?.ref;
                if (typeof candidate !== 'string')
                    return;
                const parentIds = idsByModel.get(candidate);
                if (!parentIds || parentIds.size === 0)
                    return;
                conditions.push({ [path]: { $in: [...parentIds] } });
                depth = Math.max(depth, (descendants.get(candidate)?.depth ?? 0) + 1);
            });
            if (conditions.length === 0)
                continue;
            const rows = await model.find({ $or: conditions }, { _id: 1 }).lean();
            const known = idsByModel.get(name) ?? new Set<string>();
            for (const row of rows as Array<{
                _id: unknown;
            }>) {
                const id = String(row._id);
                if (known.has(id))
                    continue;
                known.add(id);
                changed = true;
            }
            if (known.size === 0)
                continue;
            idsByModel.set(name, known);
            descendants.set(name, { model, ids: known, depth });
        }
    }
    let deleted = 0;
    const ordered = [...descendants.values()].sort((left, right) => right.depth - left.depth || left.model.modelName.localeCompare(right.model.modelName));
    for (const descendant of ordered) {
        const result = await descendant.model.deleteMany({
            _id: { $in: [...descendant.ids] },
        });
        deleted += result.deletedCount;
    }
    return deleted;
}
export async function registerAppProfile(input: {
    accountId: string;
    siteId: string;
    profile: RegisterAppProfileInput;
}): Promise<AppProfileDto> {
    // Gate order is contractual: kill switch → owner scope → create.
    requireEnabled();
    await requireOwnedSite(input.accountId, input.siteId);
    try {
        const profile = await AppProfile.create({
            accountId: input.accountId,
            siteId: input.siteId,
            playPackageId: input.profile.playPackageId ?? null,
            appStoreId: input.profile.appStoreId ?? null,
            paired: input.profile.paired,
        });
        return toDto(profile);
    }
    catch (error) {
        if (error instanceof Error && (error as {
            code?: unknown;
        }).code === 11000) {
            throw HttpError.conflict({ code: 'APP_SEO_ERRORS_DUPLICATE', messageKey: 'appSeo.errors.duplicate' });
        }
        throw error;
    }
}
/** Stored profile reads remain available while the App SEO kill switch is off. */
export async function listAppProfiles(input: {
    accountId: string;
    siteId: string;
}): Promise<AppProfileDto[]> {
    await requireOwnedSite(input.accountId, input.siteId);
    const profiles = await AppProfile.find({
        accountId: input.accountId,
        siteId: input.siteId,
    }).sort({ createdAt: -1, _id: -1 });
    return profiles.map(toDto);
}
export async function deleteAppProfile(input: {
    accountId: string;
    siteId: string;
    profileId: string;
}, deps: AppSeoServiceDependencies): Promise<void> {
    requireEnabled();
    await requireOwnedSite(input.accountId, input.siteId);
    if (!Types.ObjectId.isValid(input.profileId)) {
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    }
    const profile = await AppProfile.findOne({
        _id: input.profileId,
        accountId: input.accountId,
        siteId: input.siteId,
    }).select({ _id: 1 });
    if (!profile)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    await deps.db.transaction(async (tx) => {
        const ownerScope = [
            eq(appKeywords.accountId, input.accountId),
            eq(appKeywords.siteId, input.siteId),
            eq(appKeywords.profileId, input.profileId),
        ] as const;
        await tx
            .delete(appChartSnapshots)
            .where(and(eq(appChartSnapshots.accountId, input.accountId), eq(appChartSnapshots.siteId, input.siteId), eq(appChartSnapshots.profileId, input.profileId)));
        await tx
            .delete(appListingSnapshots)
            .where(and(eq(appListingSnapshots.accountId, input.accountId), eq(appListingSnapshots.siteId, input.siteId), eq(appListingSnapshots.profileId, input.profileId)));
        // app_rank_snapshots are FK children of app_keywords and cascade here.
        await tx.delete(appKeywords).where(and(...ownerScope));
    });
    await purgeAppProfileMongoChildren(input.profileId);
    await AppProfile.deleteOne({
        _id: input.profileId,
        accountId: input.accountId,
        siteId: input.siteId,
    });
}
