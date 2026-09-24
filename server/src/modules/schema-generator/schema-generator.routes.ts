/**
 * Schema generator router. Mounted at `/api/schema-generator`
 * behind `[requireCsrf, requireAuth, requireVerified]` from `app.ts`.
 *
 * Two named per-account buckets: `schema_generator_create` on the paid
 * preview/generate path and `schema_generator_poll` on the free stored reads,
 * so a polling client can never lock itself out of markup it already paid for.
 * Both reuse the shipped intelligence-workflow windows (60 000 ms / 10 and
 * 60 000 ms / 60) rather than adding an operator env knob.
 */
import { Router } from 'express';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { createGenerationController, downloadGenerationController, getGenerationController, getSourcesController, getTypesController, listGenerationsController, previewGenerationController, } from './schema-generator.controller.js';
export function createSchemaGeneratorRouter(): Router {
    const router = Router();
    const createLimiter = createBatchRateLimiter('schema_generator_create');
    const pollLimiter = createBatchRateLimiter('schema_generator_poll');
    router.get('/types', pollLimiter, getTypesController);
    router.get('/sources', pollLimiter, getSourcesController);
    router.post('/preview', createLimiter, previewGenerationController);
    router.post('/generations', createLimiter, createGenerationController);
    router.get('/generations', pollLimiter, listGenerationsController);
    router.get('/generations/:generationId', pollLimiter, getGenerationController);
    router.get('/generations/:generationId/download', pollLimiter, downloadGenerationController);
    return router;
}
