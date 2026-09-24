import { localizeSemanticCopy, type SupportedLocale, type TranslationKey, } from '../../../shared/i18n/index.js';
import type { LandscapeReportManifest, LandscapeReportRow, } from './landscape.schemas.js';
const WARNING_KEYS = {
    LEG_FAILED: 'competitors.landscape.warnings.legFailed',
    LEG_TIMEOUT: 'competitors.landscape.warnings.legTimeout',
    LEG_MALFORMED: 'competitors.landscape.warnings.legMalformed',
    LEG_QUOTA: 'competitors.landscape.warnings.legQuota',
    LEG_TRUNCATED: 'competitors.landscape.warnings.legTruncated',
    SHARED_POSITION_MISSING: 'competitors.landscape.warnings.sharedPositionMissing',
    DUPLICATE_LEG_CONFLICT: 'competitors.landscape.warnings.duplicateConflict',
    RANKING_URL_INVALID: 'competitors.landscape.warnings.rankingUrlInvalid',
    PARTIAL_COMPETITOR: 'competitors.landscape.warnings.partialCompetitor',
} as const satisfies Record<LandscapeReportManifest['warnings'][number]['code'], TranslationKey>;
export function localizeLandscapeManifest(manifest: LandscapeReportManifest, locale: SupportedLocale, rows: readonly LandscapeReportRow[]) {
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    return {
        ...manifest,
        warnings: manifest.warnings.map((warning) => {
            const copy = localizeSemanticCopy(locale, WARNING_KEYS[warning.code], {
                count: warning.count,
            });
            return {
                ...warning,
                messageKey: copy.messageKey,
                messageVars: { count: warning.count },
                message: copy.message,
            };
        }),
        opportunities: manifest.opportunities.map((opportunity) => {
            const count = opportunity.keywordKeys.length;
            const ownedUrl = opportunity.evidenceRowIds
                .map((id) => rowsById.get(id)?.ownedUrl ?? null)
                .find((url): url is string => url !== null);
            const title = localizeSemanticCopy(locale, opportunity.titleKey, {
                ...opportunity.titleVars,
                count,
            });
            const recommendation = localizeSemanticCopy(locale, opportunity.recommendationKey, {
                ...opportunity.recommendationVars,
                count,
                ...(ownedUrl ? { url: ownedUrl } : {}),
            });
            return {
                ...opportunity,
                titleVars: title.messageVars,
                recommendationVars: recommendation.messageVars,
                title: title.message,
                recommendation: recommendation.message,
            };
        }),
    };
}
export const landscapeCopyTestables = Object.freeze({ WARNING_KEYS });
