import { APP_STORE_DESCRIPTION_MAX_CHARS, APP_STORE_NAME_MAX_CHARS, APP_STORE_SUBTITLE_MAX_CHARS, GOOGLE_PLAY_DESCRIPTION_MAX_CHARS, GOOGLE_PLAY_SHORT_DESCRIPTION_MAX_CHARS, GOOGLE_PLAY_TITLE_MAX_CHARS, } from './store-limits.js';
import type { ListingFinding, ListingRule, NormalizedListingInput } from './types.js';
function result(input: NormalizedListingInput, id: string, severity: ListingFinding['severity'], status: ListingFinding['status'], params: ListingFinding['params'] = {}): ListingFinding {
    return {
        id,
        scope: input.store,
        severity,
        status,
        copyKey: `appSeo.listing.findings.${id}`,
        params,
        provenance: 'store-observation',
    };
}
function includesPhrase(text: string, phrase: string): boolean {
    return text.toLocaleLowerCase().includes(phrase.trim().toLocaleLowerCase());
}
export const evaluateMetadataRules: ListingRule = (input, trackedPhrases) => {
    const titleLimit = input.store === 'google_play'
        ? GOOGLE_PLAY_TITLE_MAX_CHARS
        : APP_STORE_NAME_MAX_CHARS;
    const descriptionLimit = input.store === 'google_play'
        ? GOOGLE_PLAY_DESCRIPTION_MAX_CHARS
        : APP_STORE_DESCRIPTION_MAX_CHARS;
    const secondary = input.store === 'google_play' ? input.shortDescription : input.subtitle;
    const secondaryLimit = input.store === 'google_play'
        ? GOOGLE_PLAY_SHORT_DESCRIPTION_MAX_CHARS
        : APP_STORE_SUBTITLE_MAX_CHARS;
    const secondaryId = input.store === 'google_play'
        ? 'short-description-too-long'
        : 'subtitle-too-long';
    const usablePhrases = [...new Set(trackedPhrases.map((phrase) => phrase.trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
    const searchableText = `${input.title}\n${input.description ?? ''}`;
    const matchingPhrases = usablePhrases.filter((phrase) => includesPhrase(searchableText, phrase));
    return [
        result(input, 'title-too-long', 'fixNow', input.title.length > titleLimit ? 'finding' : 'passed', { actual: input.title.length, limit: titleLimit }),
        result(input, secondaryId, 'fixNow', secondary === null
            ? 'notEvaluated'
            : secondary.length > secondaryLimit
                ? 'finding'
                : 'passed', { actual: secondary?.length ?? 0, limit: secondaryLimit }),
        result(input, 'description-missing', 'fixNow', input.description === null ? 'finding' : 'passed'),
        result(input, 'description-too-long', 'fixNow', input.description === null
            ? 'notEvaluated'
            : input.description.length > descriptionLimit
                ? 'finding'
                : 'passed', { actual: input.description?.length ?? 0, limit: descriptionLimit }),
        result(input, 'desc-missing-keywords', 'watch', usablePhrases.length === 0 || input.description === null
            ? 'notEvaluated'
            : matchingPhrases.length === 0
                ? 'finding'
                : 'passed', { tracked: usablePhrases.length, matched: matchingPhrases.length }),
    ];
};
