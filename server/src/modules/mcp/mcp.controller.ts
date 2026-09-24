/**
 * MCP request handler. Every POST /api/mcp constructs a fresh McpServer +
 * stateless Streamable-HTTP transport, registers the permitted tools,
 * connects, dispatches the single JSON-RPC request, and disposes.
 *
 * Stateless mode: `sessionIdGenerator: undefined`, `enableJsonResponse: true`.
 * No SSE, no session IDs, no resumability.
 */
import type { Request, RequestHandler, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { translate } from '../../shared/i18n/index.js';
import { setBearerLanguage } from '../../shared/middleware/bearer-language.js';
import { SERVER_VERSION } from '../../version.js';
import { getAuditStatusInputSchema, getContentAnalysisInputSchema, getLatestAuditReportInputSchema, getRankHistoryInputSchema, listActionsInputSchema, listContentAnalysesInputSchema, listKeywordsInputSchema, listSitesInputSchema, setActionStateInputSchema, startAuditInputSchema, } from './mcp.schema.js';
import { resolveContextLocale, type McpToolContext } from './mcp.tools.js';
import { MCP_TOOL_NAMES, resolveMcpToolDefinition } from './mcp.registry.js';
import { isToolAllowed, resolveEffectivePermissions, type EffectiveMcpPermissions, } from '../../shared/mcp-permissions/index.js';
import { getAccountMcpSpec } from '../mcp-permissions/index.js';
import { isMcpJsonRpcMessage, jsonRpcRequestId, LocalizedMcpTransport, respondMcpJsonRpcError, } from './mcp.transport.js';
/**
 * Envelope for the 503 unavailable path when MCP_ENABLED=false. The route
 * returns a spec-shaped JSON-RPC error with the localized message rather than
 * mounting the transport at all — keeps the kill switch cheap.
 */
function respondUnavailable(req: Request, res: Response): void {
    const locale = resolveContextLocale(req.language, undefined);
    const message = translate(locale, 'mcp.errors.unavailable');
    res.status(503).json({
        jsonrpc: '2.0',
        error: { code: -32000, message },
        id: null,
    });
}
/**
 * Build the McpServer per request. Fresh state, no cross-request leakage.
 * Registers ONLY the tools the effective permissions allow — a disallowed
 * tool is simply unregistered, so the SDK answers with its native
 * method-not-found error. The tool list is caller-derived (account defaults
 * ∩ the caller's own key scopes), so the shrunken list leaks nothing.
 */
function buildMcpServer(context: McpToolContext): McpServer {
    const server = new McpServer({ name: 'rankmefast', version: SERVER_VERSION }, { capabilities: { tools: {} } });
    for (const name of MCP_TOOL_NAMES) {
        if (!isToolAllowed(context.permissions, name))
            continue;
        const definition = resolveMcpToolDefinition(name, context.locale);
        server.registerTool(name, { description: definition.description, inputSchema: definition.inputShape }, async (input: unknown) => definition.execute(input, context));
    }
    return server;
}
/** JSON-RPC batch amplification defense: reject arrays outright this release. */
function isBatch(body: unknown): boolean {
    return Array.isArray(body);
}
function toolLocaleArgument(body: unknown): unknown {
    if (!body || typeof body !== 'object' || Array.isArray(body))
        return undefined;
    const request = body as Record<string, unknown>;
    if (request.method !== 'tools/call')
        return undefined;
    if (!request.params || typeof request.params !== 'object' || Array.isArray(request.params)) {
        return undefined;
    }
    const params = request.params as Record<string, unknown>;
    if (typeof params.name !== 'string' || !MCP_TOOL_NAMES.some((name) => name === params.name)) {
        return undefined;
    }
    if (!params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments)) {
        return undefined;
    }
    return (params.arguments as Record<string, unknown>).locale;
}
function validToolCall(body: unknown, permissions: EffectiveMcpPermissions): boolean {
    if (!body || typeof body !== 'object' || Array.isArray(body))
        return true;
    const request = body as Record<string, unknown>;
    if (request.method !== 'tools/call')
        return true;
    if (!request.params || typeof request.params !== 'object' || Array.isArray(request.params)) {
        return false;
    }
    const params = request.params as Record<string, unknown>;
    const name = MCP_TOOL_NAMES.find((candidate) => candidate === params.name);
    if (!name || !isToolAllowed(permissions, name))
        return false;
    return MCP_INPUT_SCHEMAS[name].safeParse(params.arguments ?? {}).success;
}
export const mcpControllerTestables = { toolLocaleArgument, validToolCall };
/** POST handler for /api/mcp. */
export const mcpPostHandler: RequestHandler = asyncHandler(async (req, res) => {
    if (!env.MCP_ENABLED) {
        respondUnavailable(req, res);
        return;
    }
    const accountId = requireUserId(req.user);
    const locale = resolveContextLocale(req.language, undefined);
    if (isBatch(req.body)) {
        respondMcpJsonRpcError(res, locale, 400, -32600, null);
        return;
    }
    if (!isMcpJsonRpcMessage(req.body)) {
        respondMcpJsonRpcError(res, locale, 400, -32700, jsonRpcRequestId(req.body));
        return;
    }
    const toolLocale = resolveContextLocale(locale, toolLocaleArgument(req.body));
    setBearerLanguage(req, res, toolLocale);
    // Two-level permission resolution: one Mongo read for the account defaults,
    // intersected with the authenticating key's scopes (null = unscoped legacy
    // key = fully permissive).
    let server: McpServer | undefined;
    let transport: LocalizedMcpTransport | undefined;
    try {
        const accountSpec = await getAccountMcpSpec(accountId);
        const permissions = resolveEffectivePermissions(accountSpec, req.apiKeyScopes ?? null, MCP_TOOL_NAMES);
        if (!validToolCall(req.body, permissions)) {
            respondMcpJsonRpcError(res, toolLocale, 200, -32602, jsonRpcRequestId(req.body));
            return;
        }
        server = buildMcpServer({ accountId, locale: toolLocale, permissions });
        transport = new LocalizedMcpTransport(toolLocale, {
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        transport.onerror = (error) => {
            logger.warn({ code: 'MCP_TRANSPORT_ERROR', causeName: error.constructor.name }, 'mcp transport error');
        };
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    }
    catch (error) {
        logger.warn({
            code: 'MCP_INTERNAL_ERROR',
            causeName: error instanceof Error ? error.constructor.name : typeof error,
        }, 'mcp request failed');
        if (!res.headersSent) {
            respondMcpJsonRpcError(res, toolLocale, 500, -32603, jsonRpcRequestId(req.body));
        }
    }
    finally {
        if (transport) {
            try {
                await transport.close();
            }
            catch {
                /* ignore close errors — response is already flushed */
            }
        }
        if (server) {
            try {
                await server.close();
            }
            catch {
                /* ignore */
            }
        }
    }
});
/** GET/DELETE /api/mcp — spec-shaped 405 with Allow header. */
export const mcpMethodNotAllowedHandler: RequestHandler = (req, res) => {
    const locale = resolveContextLocale(req.language, undefined);
    res.setHeader('Allow', 'POST');
    respondMcpJsonRpcError(res, locale, 405, -32600, null);
};
// Re-export the schemas here so consumers only need one import path when they
// want to introspect the tool boundary from tests.
export const MCP_INPUT_SCHEMAS = {
    list_sites: listSitesInputSchema,
    get_latest_audit_report: getLatestAuditReportInputSchema,
    list_keywords: listKeywordsInputSchema,
    get_rank_history: getRankHistoryInputSchema,
    list_content_analyses: listContentAnalysesInputSchema,
    get_content_analysis: getContentAnalysisInputSchema,
    start_audit: startAuditInputSchema,
    get_audit_status: getAuditStatusInputSchema,
    list_actions: listActionsInputSchema,
    set_action_state: setActionStateInputSchema,
} as const satisfies Record<string, z.ZodTypeAny>;
