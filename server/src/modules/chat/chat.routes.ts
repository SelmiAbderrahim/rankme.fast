import { Router, type Request } from 'express';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { requireTeamResourceSiteAccess } from '../../shared/middleware/team-site-access.js';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { createConversationHandler, deleteConversationHandler, getConversationHandler, listConversationsHandler, sendMessageHandler, } from './chat.controller.js';
import { resolveOwnedConversationSiteId } from './chat.service.js';
export function resolveChatConversationSiteId(req: Request): Promise<string | null> {
    return resolveOwnedConversationSiteId(requireAccountId(req), String(req.params.id));
}
/**
 * Router for /api/chat. Mounted in app.ts behind the standard verified
 * cookie chain. One named per-account `chat` bucket covers every route (each
 * message POST opens an SSE stream and spends an AI generation, so the bucket
 * is deliberately tight).
 */
export function createChatRouter(): Router {
    const limiter = createBatchRateLimiter('chat');
    const router = Router();
    router.use('/conversations/:id', requireTeamResourceSiteAccess(resolveChatConversationSiteId, 'chat.errors.notFound'));
    router.post('/conversations', limiter, createConversationHandler);
    router.get('/conversations', limiter, listConversationsHandler);
    router.get('/conversations/:id', limiter, getConversationHandler);
    router.delete('/conversations/:id', limiter, deleteConversationHandler);
    router.post('/conversations/:id/messages', limiter, sendMessageHandler);
    return router;
}
