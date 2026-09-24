import { appVersion } from '../../config/version.js';
import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { runHealthCheck, type HealthDeps } from './health.service.js';
let healthDeps: HealthDeps = {};
export function configureHealthController(deps: HealthDeps): void {
    healthDeps = deps;
}
export function resetHealthController(): void {
    healthDeps = {};
}
export const health: RequestHandler = asyncHandler(async (_req, res) => {
    const result = await runHealthCheck(healthDeps);
    res.status(result.status === 'ok' ? 200 : 503).json({ ...result, version: appVersion });
});
