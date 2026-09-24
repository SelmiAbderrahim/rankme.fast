import { Router } from 'express';
import { requireAuth } from '../../shared/middleware/require-auth.js';
import { listAudit } from './audit.controller.js';
export const auditRouter: Router = Router();
auditRouter.use(requireAuth);
auditRouter.get('/', listAudit);
