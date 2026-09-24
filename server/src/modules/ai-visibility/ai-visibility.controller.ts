import type { RequestHandler } from 'express';
import { CooldownError } from '../../shared/cooldown/index.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { toSupportedLocale } from '../../shared/i18n/index.js';
import { getAiVisibilityCooldown, getAiVisibilityDb, getAiVisibilityProvider, getAiVisibilitySummaryProvider, } from './ai-visibility.holder.js';
import { addTrackedPromptBodySchema, promptIdParamsSchema, siteIdParamsSchema, trendQuerySchema, } from './ai-visibility.schema.js';
import { addPromptForSite, checkMentions, generatePromptSuggestions, getAiVisibilityOverview, getAiVisibilityTrend, readStoredSuggestions, removePromptForSite, } from './ai-visibility.service.js';
function mapCooldown(req: Parameters<RequestHandler>[0], err: CooldownError): never {
    throw HttpError.tooMany({
        code: 'AI_VISIBILITY_REFRESH_COOLDOWN',
        messageKey: 'aiVisibility.errors.refreshCooldown',
        vars: { seconds: Math.ceil(err.retryAfterMs / 1000) },
    }, { retryAfterMs: err.retryAfterMs });
}
export const listPromptsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const result = await getAiVisibilityOverview({ accountId, siteId }, { db: getAiVisibilityDb() });
    res.status(200).json(result);
});
export const addPromptHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const body = addTrackedPromptBodySchema.parse(req.body);
    const prompt = await addPromptForSite({ accountId, siteId, prompt: body.prompt }, { db: getAiVisibilityDb() });
    res.status(201).json({ prompt });
});
export const removePromptHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId, promptId } = promptIdParamsSchema.parse(req.params);
    await removePromptForSite({ accountId, siteId, promptId }, { db: getAiVisibilityDb() });
    res.status(204).end();
});
export const checkHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    try {
        const result = await checkMentions({ accountId, siteId }, {
            db: getAiVisibilityDb(),
            provider: getAiVisibilityProvider(),
            summaryProvider: getAiVisibilitySummaryProvider(),
            cooldown: getAiVisibilityCooldown(),
        });
        res.status(200).json(result);
    }
    catch (err) {
        if (err instanceof CooldownError)
            mapCooldown(req, err);
        throw err;
    }
});
/**
 * Free read of the stored set. No try/catch for `CooldownError`: a read never
 * arms or consults the debounce, so it cannot 429. It also never meters, so a
 * reload costs the user nothing.
 */
export const readStoredSuggestionsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const result = await readStoredSuggestions({ accountId, siteId, outputLocale: toSupportedLocale(req.language) }, { db: getAiVisibilityDb() });
    res.status(200).json(result);
});
/** Prompt-suggestion generation for the "Generate suggestions" button. */
export const generateSuggestionsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    try {
        const result = await generatePromptSuggestions({ accountId, siteId, outputLocale: toSupportedLocale(req.language) }, {
            db: getAiVisibilityDb(),
            provider: getAiVisibilityProvider(),
            summaryProvider: getAiVisibilitySummaryProvider(),
            cooldown: getAiVisibilityCooldown(),
        });
        res.status(201).json(result);
    }
    catch (err) {
        if (err instanceof CooldownError)
            mapCooldown(req, err);
        throw err;
    }
});
export const trendHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const { days } = trendQuerySchema.parse(req.query);
    const result = await getAiVisibilityTrend({ accountId, siteId, days }, { db: getAiVisibilityDb() });
    res.status(200).json(result);
});
