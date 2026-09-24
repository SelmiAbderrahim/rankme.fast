import { Router } from 'express';
import { health } from './health.controller.js';
/**
 * `/health` — unauthenticated liveness/readiness for external uptime monitoring.
 */
export const healthRouter: Router = Router();
healthRouter.get('/health', health);
