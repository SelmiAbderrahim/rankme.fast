import { parseConsumedPayload, competitorLandscapeJobSchema } from '../../../shared/queue/index.js';
export * from './landscape.canonical.js';
export * from './landscape.cache.js';
export * from './landscape.aggregate.js';
export * from './landscape.acceptance.js';
export * from './landscape.review.js';
export * from './landscape.holder.js';
export * from './landscape.model.js';
export * from './landscape.processor.js';
export * from './landscape.repository.js';
export * from './landscape.schemas.js';
export * from './landscape.copy.js';
export * from './landscape.service.js';
/**
 * Worker registration seam. This validates the consumer boundary and
 * pins the per-process call fan-out without registering a BullMQ Worker yet.
 */
export function createCompetitorLandscapeConsumerRegistration(workerConcurrency: number) {
    return {
        queueName: 'competitor-landscapes' as const,
        jobName: 'competitor-landscape' as const,
        concurrency: Math.min(Math.max(1, workerConcurrency), 5),
        parsePayload: (payload: unknown) => parseConsumedPayload(competitorLandscapeJobSchema, payload),
    };
}
