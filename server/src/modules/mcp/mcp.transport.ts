import { StreamableHTTPServerTransport, type StreamableHTTPServerTransportOptions, } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { JSONRPCMessageSchema, type JSONRPCMessage, type RequestId, } from '@modelcontextprotocol/sdk/types.js';
import type { Response } from 'express';
import { translate, type SupportedLocale } from '../../shared/i18n/index.js';
export const MCP_PROTOCOL_ERROR_CODES = [-32700, -32600, -32601, -32602, -32603] as const;
export type McpProtocolErrorCode = (typeof MCP_PROTOCOL_ERROR_CODES)[number];
type McpProtocolMessageKey = 'mcp.protocol.parseError' | 'mcp.protocol.invalidRequest' | 'mcp.protocol.methodNotFound' | 'mcp.protocol.invalidParams' | 'mcp.protocol.internalError';
const PROTOCOL_MESSAGE_KEYS: Record<McpProtocolErrorCode, McpProtocolMessageKey> = {
    [-32700]: 'mcp.protocol.parseError',
    [-32600]: 'mcp.protocol.invalidRequest',
    [-32601]: 'mcp.protocol.methodNotFound',
    [-32602]: 'mcp.protocol.invalidParams',
    [-32603]: 'mcp.protocol.internalError',
};
export interface McpJsonRpcErrorMessage {
    jsonrpc: '2.0';
    id: RequestId | null;
    error: {
        code: number;
        message: string;
        data?: unknown;
    };
}
type LocalizableMcpJsonRpcMessage = JSONRPCMessage | McpJsonRpcErrorMessage;
function isProtocolErrorCode(code: unknown): code is McpProtocolErrorCode {
    return typeof code === 'number' && MCP_PROTOCOL_ERROR_CODES.some((candidate) => candidate === code);
}
function safeProtocolData(data: unknown): {
    path: Array<string | number>;
} | undefined {
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return undefined;
    const path = (data as Record<string, unknown>).path;
    if (!Array.isArray(path) || path.length > 16)
        return undefined;
    const normalized = path.filter((segment): segment is string | number => (typeof segment === 'number' && Number.isSafeInteger(segment)) ||
        (typeof segment === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(segment)));
    return normalized.length === path.length ? { path: normalized } : undefined;
}
export function localizeMcpJsonRpcMessage(message: LocalizableMcpJsonRpcMessage, locale: SupportedLocale): LocalizableMcpJsonRpcMessage {
    if (!('error' in message) || !isProtocolErrorCode(message.error.code))
        return message;
    const data = safeProtocolData(message.error.data);
    const localized: McpJsonRpcErrorMessage = {
        jsonrpc: '2.0',
        id: message.id ?? null,
        error: {
            code: message.error.code,
            message: translate(locale, PROTOCOL_MESSAGE_KEYS[message.error.code]),
            ...(data ? { data } : {}),
        },
    };
    return localized;
}
export function isMcpJsonRpcMessage(value: unknown): value is JSONRPCMessage {
    return JSONRPCMessageSchema.safeParse(value).success;
}
export function jsonRpcRequestId(value: unknown): RequestId | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const id = (value as Record<string, unknown>).id;
    return typeof id === 'string' || typeof id === 'number' ? id : null;
}
export function respondMcpJsonRpcError(res: Response, locale: SupportedLocale, status: number, code: McpProtocolErrorCode, id: RequestId | null, data?: unknown): void {
    const localized = localizeMcpJsonRpcMessage({
        jsonrpc: '2.0',
        id,
        error: { code, message: '', ...(data === undefined ? {} : { data }) },
    }, locale);
    res.status(status).json(localized);
}
export class LocalizedMcpTransport extends StreamableHTTPServerTransport {
    constructor(private readonly locale: SupportedLocale, options: StreamableHTTPServerTransportOptions) {
        super(options);
    }
    override async send(message: JSONRPCMessage, options?: {
        relatedRequestId?: RequestId;
    }): Promise<void> {
        await super.send(localizeMcpJsonRpcMessage(message, this.locale) as JSONRPCMessage, options);
    }
}
