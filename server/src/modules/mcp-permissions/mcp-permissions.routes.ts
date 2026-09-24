import { Router } from 'express';
import { getMcpPermissionsHandler, putMcpPermissionsHandler, } from './mcp-permissions.controller.js';
/**
 * Router for /api/mcp-permissions. Mounted in app.ts behind the standard
 * verified cookie chain ([requireCsrf, requireAuth, requireVerified]).
 */
export const mcpPermissionsRouter: Router = Router();
mcpPermissionsRouter.get('/', getMcpPermissionsHandler);
mcpPermissionsRouter.put('/', putMcpPermissionsHandler);
