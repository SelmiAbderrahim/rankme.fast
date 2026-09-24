import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { sendLocalizedMessage } from '../../shared/i18n/localized-response.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { MCP_TOOL_NAMES } from '../mcp/index.js';
import { withValidMcpSpecSiteLeases } from '../mcp-permissions/index.js';
import { createApiKeySchema, patchApiKeyScopesSchema } from './api-keys.schema.js';
import { getApiKeysDb } from './api-keys.holder.js';
import { createApiKey, listApiKeys, revokeApiKey, updateApiKeyScopes, } from './api-keys.service.js';
export const createApiKeyHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireUserId(req.user);
    const body = createApiKeySchema.parse(req.body);
    const create = () => createApiKey(getApiKeysDb(), {
        accountId,
        name: body.name,
        scopes: body.scopes ?? null,
    });
    const apiKey = body.scopes
        ? await withValidMcpSpecSiteLeases(accountId, body.scopes, MCP_TOOL_NAMES, 'api-key-create', create)
        : await create();
    // The full `apiKey.key` is in this response and NOWHERE else — the client
    // shows it once and the server keeps only the hash.
    res.status(201).json({ apiKey });
});
export const patchApiKeyScopesHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireUserId(req.user);
    const body = patchApiKeyScopesSchema.parse(req.body);
    const update = () => updateApiKeyScopes(getApiKeysDb(), {
        accountId,
        id: String(req.params.id),
        scopes: body.scopes,
    });
    const apiKey = body.scopes
        ? await withValidMcpSpecSiteLeases(accountId, body.scopes, MCP_TOOL_NAMES, 'api-key-scopes', update)
        : await update();
    res.status(200).json({ apiKey });
});
export const listApiKeysHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireUserId(req.user);
    const apiKeysList = await listApiKeys(getApiKeysDb(), accountId);
    res.status(200).json({ apiKeys: apiKeysList });
});
export const revokeApiKeyHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireUserId(req.user);
    await revokeApiKey(getApiKeysDb(), { accountId, id: String(req.params.id) });
    sendLocalizedMessage(req, res, 200, 'apiKeys.revoked', {});
});
