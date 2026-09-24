import { Router } from 'express';
import { createBatchRateLimiter, type RateLimitOverrides, } from '../../shared/middleware/rate-limit.js';
import { compareTrafficSnapshotsHandler, createTrafficSnapshotHandler, getTrafficSnapshotHandler, listTrafficSnapshotsHandler, previewTrafficSnapshotsHandler, } from './traffic-snapshots.controller.js';
export function createTrafficSnapshotsRouter(rateLimitOverrides: RateLimitOverrides = {}): Router {
    const router = Router();
    router.post('/', createBatchRateLimiter('traffic-snapshots', rateLimitOverrides), createTrafficSnapshotHandler);
    router.post('/preview', previewTrafficSnapshotsHandler);
    router.get('/', listTrafficSnapshotsHandler);
    router.get('/compare', compareTrafficSnapshotsHandler);
    router.get('/:id', getTrafficSnapshotHandler);
    return router;
}
