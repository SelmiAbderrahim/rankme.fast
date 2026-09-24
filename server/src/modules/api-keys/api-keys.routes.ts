import { Router } from 'express';
import { createApiKeyHandler, listApiKeysHandler, patchApiKeyScopesHandler, revokeApiKeyHandler, } from './api-keys.controller.js';
/**
 * Cookie-authed key management (mounted behind [requireAuth, requireVerified]
 * in app.ts). Any verified workspace owner can mint, list, and revoke rmf_
 * bearer keys.
 */
export const apiKeysRouter: Router = Router();
apiKeysRouter.post('/', createApiKeyHandler);
apiKeysRouter.get('/', listApiKeysHandler);
apiKeysRouter.delete('/:id', revokeApiKeyHandler);
apiKeysRouter.patch('/:id/scopes', patchApiKeyScopesHandler);
