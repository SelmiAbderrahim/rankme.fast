/**
 * /api/chat controllers.
 *
 * JSON routes are conventional thin handlers. The message POST is the SSE
 * endpoint: the canonical order is parse → ownership (404) → CHAT_ENABLED
 * (503) → persist the user message
 * → ONLY THEN open the event stream. Every failure after `flushHeaders()`
 * is written as an `error` event + `res.end()` — it can never reach the
 * global error handler. The assistant message is persisted exactly once at
 * stream end (partial + `aborted` status on disconnect).
 */
import type { RequestHandler, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { env } from '../../config/env.js';
import { translate } from '../../shared/i18n/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { allowedTeamSiteIds } from '../../shared/middleware/team-site-access.js';
import { resolveAiTaskProfile } from '../../shared/ai-profiles/index.js';
import { AiGenerationError } from '../../shared/providers/index.js';
import { getChatAiProvider } from './chat.holder.js';
import { createConversationSchema, sendMessageSchema, type ChatMessagePartDto, type ChatMessageStatus, } from './chat.schema.js';
import { appendAssistantMessage, appendUserMessage, assembleHistory, assertConversationWritable, buildChatSystemInstruction, createConversation, deleteConversation, getConversation, listConversations, } from './chat.service.js';
import { buildChatTools } from './chat.tools.js';
/**
 * A finished stream still counts as cut off when the model hit its output
 * limit or stopped for an error, or when nothing answered the user after the
 * last tool result (an empty final section).
 */
export function finishedStatus(finishReason: string, parts: readonly ChatMessagePartDto[]): ChatMessageStatus {
    if (finishReason === 'length' || finishReason === 'error')
        return 'incomplete';
    const last = parts.at(-1);
    if (last === undefined || last.type !== 'text' || last.text.trim().length === 0)
        return 'incomplete';
    return 'complete';
}
/** SSE heartbeat cadence — a comment frame that keeps proxies from idling. */
export const CHAT_SSE_HEARTBEAT_MS = 15000;
export function startChatHeartbeat(res: Response): ReturnType<typeof setInterval> {
    return setInterval(() => {
        res.write(': ping\n\n');
    }, CHAT_SSE_HEARTBEAT_MS);
}
export const createConversationHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const body = createConversationSchema.parse(req.body);
    if (!body.siteId && req.teamSiteAccessMode === 'selected') {
        throw HttpError.notFound({ code: 'CHAT_ERRORS_NOT_FOUND', messageKey: 'chat.errors.notFound' });
    }
    const conversation = await createConversation({
        accountId,
        siteId: body.siteId,
        locale: req.language,
    });
    res.status(201).json({ conversation });
});
export const listConversationsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    res.json({
        conversations: await listConversations(accountId, allowedTeamSiteIds(req)),
    });
});
export const getConversationHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    res.json(await getConversation(accountId, String(req.params.id)));
});
export const deleteConversationHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    await deleteConversation(accountId, String(req.params.id));
    res.json({ ok: true });
});
function writeSse(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
export const sendMessageHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const conversationId = String(req.params.id);
    const body = sendMessageSchema.parse(req.body);
    // The middleware-validated language is frozen when this turn is accepted.
    // Later UI changes cannot relabel or override provider/tool work already paid for.
    const responseLocale = req.language;
    const abortController = new AbortController();
    // `res` close is the reliable disconnect signal: on modern Node, `req`
    // 'close' fires when the request MESSAGE completes (the body was already
    // parsed), not when the connection dies. `res` 'close' fires when the
    // socket terminates — prematurely (Stop button / navigation) or after a
    // normal `res.end()`, where the abort is a harmless no-op. It is
    // registered before the first await so a Stop that lands while the user
    // message is still being persisted is not missed.
    res.on('close', () => abortController.abort());
    // Pre-flush refusals — all clean JSON through the global error handler.
    await assertConversationWritable(accountId, conversationId); // 404 / 409
    if (!env.CHAT_ENABLED)
        throw new HttpError(503, { code: 'CHAT_ERRORS_UNAVAILABLE', messageKey: 'chat.errors.unavailable' });
    // Allocate both ids in display order. The message list uses ObjectId order,
    // and the assistant id is the stable operation identity for this turn.
    const userMessageId = String(new Types.ObjectId());
    const assistantMessageId = String(new Types.ObjectId());
    const appended = await appendUserMessage(accountId, conversationId, body.text, userMessageId);
    const history = await assembleHistory(accountId, conversationId);
    const { tools, disabledTools } = await buildChatTools(accountId, responseLocale, allowedTeamSiteIds(req), appended.site?.id ?? null);
    const profile = resolveAiTaskProfile('chat_assistant');
    // From here on the response is a stream — no status codes remain.
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Content-Language', responseLocale);
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const heartbeat = startChatHeartbeat(res);
    writeSse(res, 'meta', {
        conversationId,
        userMessageId: appended.message.id,
        assistantMessageId,
        responseLocale,
    });
    const parts: ChatMessagePartDto[] = [];
    let textBuffer = '';
    const flushTextPart = (): void => {
        if (textBuffer.length > 0) {
            parts.push({ type: 'text', text: textBuffer });
            textBuffer = '';
        }
    };
    let tokens: {
        input: number | null;
        output: number | null;
    } | undefined;
    const persistAssistant = async (status: ChatMessageStatus): Promise<void> => {
        flushTextPart();
        try {
            await appendAssistantMessage({
                accountId,
                conversationId,
                parts,
                status,
                responseLocale,
                tokens,
                messageId: assistantMessageId,
            });
        }
        catch {
            // Persistence must never crash the (already-streaming) response.
        }
    };
    try {
        // Stopped before the stream opened: the user message is already saved,
        // so close the turn as aborted instead of paying for a reply nobody reads.
        abortController.signal.throwIfAborted();
        const provider = getChatAiProvider();
        for await (const event of provider.streamChat({
            messages: history,
            responseLocale,
            systemInstruction: buildChatSystemInstruction(appended.site, responseLocale, disabledTools),
            tools,
            maxOutputTokens: env.AI_CHAT_MAX_OUTPUT_TOKENS,
            temperature: profile.temperature,
            maxSteps: env.AI_CHAT_MAX_STEPS,
            maxCostMicros: profile.maxCostMicros,
            usage: { accountId, siteId: appended.conversation.siteId },
            task: 'chat_assistant',
            correlationId: String(req.id),
            signal: abortController.signal,
        })) {
            if (event.type === 'text_delta') {
                textBuffer += event.text;
                writeSse(res, 'delta', { text: event.text });
            }
            else if (event.type === 'tool_call') {
                flushTextPart();
                parts.push({
                    type: 'tool_call',
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    args: event.args,
                });
                writeSse(res, 'tool_call', {
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    args: event.args,
                });
            }
            else if (event.type === 'tool_result') {
                parts.push({
                    type: 'tool_result',
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    ok: event.ok,
                    structuredContent: event.structuredContent,
                });
                writeSse(res, 'tool_result', {
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    ok: event.ok,
                    structuredContent: event.structuredContent,
                });
            }
            else {
                tokens = { input: event.tokens.input, output: event.tokens.output };
                flushTextPart();
                const status = finishedStatus(event.finishReason, parts);
                await persistAssistant(status);
                writeSse(res, 'done', {
                    finishReason: event.finishReason,
                    status,
                    tokens,
                });
            }
        }
    }
    catch (error) {
        const cancelled = abortController.signal.aborted ||
            (error instanceof AiGenerationError && error.code === 'request_cancelled');
        if (cancelled) {
            // Client disconnect / Stop: keep the partial text.
            await persistAssistant('aborted');
        }
        else {
            // A stream that drops after some answer text was cut off, not empty.
            flushTextPart();
            await persistAssistant(parts.some((part) => part.type === 'text') ? 'incomplete' : 'error');
            const code = error instanceof AiGenerationError ? error.code : 'chat_stream_failed';
            writeSse(res, 'error', {
                code,
                messageKey: 'chat.errors.generationFailed',
                message: translate(responseLocale, 'chat.errors.generationFailed'),
            });
        }
    }
    finally {
        clearInterval(heartbeat);
        res.end();
    }
});
