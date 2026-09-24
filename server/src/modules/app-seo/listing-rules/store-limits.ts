import type { AppInfo } from '../../../shared/providers/app-data.js';
import type { NormalizedListingInput } from './types.js';
/**
 * Google Play Console Help, "Create and set up your app", accessed 2026-08-10:
 * https://support.google.com/googleplay/android-developer/answer/9859152?hl=en-EN
 * The public table specifies 30 / 80 / 4,000 character limits.
 */
export const GOOGLE_PLAY_TITLE_MAX_CHARS = 30;
export const GOOGLE_PLAY_SHORT_DESCRIPTION_MAX_CHARS = 80;
export const GOOGLE_PLAY_DESCRIPTION_MAX_CHARS = 4000;
/**
 * Apple App Store Connect Help, "App information" and "Platform version
 * information", accessed 2026-08-10:
 * https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/
 * https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
 * The public references specify 30 / 30 / 4,000 character limits.
 */
export const APP_STORE_NAME_MAX_CHARS = 30;
export const APP_STORE_SUBTITLE_MAX_CHARS = 30;
export const APP_STORE_DESCRIPTION_MAX_CHARS = 4000;
export const MIN_RECOMMENDED_SCREENSHOTS = 4;
export const LOW_RATING_THRESHOLD = 4;
export const STALE_UPDATE_DAYS = 180;
/** Convert only the provider-normalized AppInfo shape; never inspect a vendor envelope. */
export function normalizeAppInfoForListingRules(info: AppInfo): NormalizedListingInput {
    return {
        store: info.store,
        title: info.title.trim(),
        // The normalized provider contract does not currently expose these as
        // distinct fields. Absence is evaluated honestly, never inferred from the
        // full description.
        shortDescription: null,
        subtitle: null,
        description: info.description?.trim() || null,
        rating: info.rating,
        // The selected Apple surface may omit screenshot counts. An empty Apple
        // image list therefore cannot be treated as observed zero.
        screenshotCount: info.store === 'app_store' ? null : info.imageUrls.length,
        installLowerBound: info.store === 'google_play' ? info.installs?.lowerBound ?? null : null,
        categories: [...new Set(info.categories.map((value) => value.trim()).filter(Boolean))].sort(),
        updatedAt: info.updatedAt,
        observedAt: info.observationMeta.observedAt,
    };
}
