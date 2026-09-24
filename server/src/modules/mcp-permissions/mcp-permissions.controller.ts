/**
 * Thin controllers for /api/mcp-permissions.
 */
import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { MCP_TOOL_NAMES } from '../mcp/index.js';
import { updateMcpPermissionsSchema } from './mcp-permissions.schema.js';
import { getMcpPermissionSettings, updateMcpPermissionSettings, } from './mcp-permissions.service.js';
/** Registry tool names — the validation universe for per-tool toggles. */
export const MCP_PERMISSION_TOOL_NAMES: readonly string[] = MCP_TOOL_NAMES;
export const getMcpPermissionsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireUserId(req.user);
    res.json(await getMcpPermissionSettings(accountId, MCP_PERMISSION_TOOL_NAMES));
});
export const putMcpPermissionsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireUserId(req.user);
    const input = updateMcpPermissionsSchema.parse(req.body);
    res.json(await updateMcpPermissionSettings(accountId, input, MCP_PERMISSION_TOOL_NAMES));
});
