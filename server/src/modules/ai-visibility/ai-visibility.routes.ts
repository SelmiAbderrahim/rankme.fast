import { Router } from 'express';
import { addPromptHandler, checkHandler, generateSuggestionsHandler, listPromptsHandler, readStoredSuggestionsHandler, removePromptHandler, trendHandler, } from './ai-visibility.controller.js';
export const aiVisibilityRouter: Router = Router();
aiVisibilityRouter.get('/:siteId/ai-visibility', listPromptsHandler);
aiVisibilityRouter.post('/:siteId/ai-visibility/prompts', addPromptHandler);
aiVisibilityRouter.delete('/:siteId/ai-visibility/prompts/:promptId', removePromptHandler);
aiVisibilityRouter.post('/:siteId/ai-visibility/check', checkHandler);
// GET reads the stored set; POST generates a fresh set. Keeping the GET verb
// and path means the existing cross-account 404 e2e assertion keeps passing
// unchanged.
aiVisibilityRouter.get('/:siteId/ai-visibility/suggestions', readStoredSuggestionsHandler);
aiVisibilityRouter.post('/:siteId/ai-visibility/suggestions', generateSuggestionsHandler);
aiVisibilityRouter.get('/:siteId/ai-visibility/trend', trendHandler);
