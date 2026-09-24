import { Router } from 'express';
import { mcpMethodNotAllowedHandler, mcpPostHandler } from './mcp.controller.js';
/**
 * Router for /api/mcp. The mount chain in app.ts already applies:
 *   1. per-IP API limiter
 *   2. `mcp` per-token rate-limit bucket
 *   3. bearer-key auth (populates req.user + marks token proven)
 * so the router itself just dispatches by method.
 */
export const mcpRouter: Router = Router();
mcpRouter.post('/', mcpPostHandler);
mcpRouter.get('/', mcpMethodNotAllowedHandler);
mcpRouter.delete('/', mcpMethodNotAllowedHandler);
