/**
 * Request-boundary zod schemas + wire DTO shapes for /api/chat.
 */
import { z } from 'zod';
import type { SupportedLocale } from '../../shared/i18n/locales.js';
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;
export const CHAT_MESSAGE_MAX_CHARS = 8000;
export const createConversationSchema = z
    .object({
    siteId: z.string().regex(OBJECT_ID_HEX).optional(),
})
    .strict();
export type CreateConversationBody = z.infer<typeof createConversationSchema>;
export const sendMessageSchema = z
    .object({
    text: z.string().min(1).max(CHAT_MESSAGE_MAX_CHARS),
})
    .strict();
export type SendMessageBody = z.infer<typeof sendMessageSchema>;
/** Wire part union — mirrored verbatim by the client `features/assistant`. */
export type ChatMessagePartDto = {
    type: 'text';
    text: string;
} | {
    type: 'tool_call';
    toolCallId: string;
    toolName: string;
    args: unknown;
} | {
    type: 'tool_result';
    toolCallId: string;
    toolName: string;
    ok: boolean;
    structuredContent: Record<string, unknown>;
    errorCode?: string;
};
export interface ChatMessageDto {
    id: string;
    role: 'user' | 'assistant';
    status: 'complete' | 'error' | 'aborted';
    responseLocale: SupportedLocale | null;
    parts: ChatMessagePartDto[];
    tokens: {
        input: number | null;
        output: number | null;
    } | null;
    createdAt: string;
}
export interface ChatConversationDto {
    id: string;
    siteId: string | null;
    title: string;
    locale: string;
    lastMessageAt: string;
    messageCount: number;
    createdAt: string;
}
