/**
 * AI Assistant chat storage — Mongo documents.
 *
 * Conversations + messages are shape-loose per-account documents (typed
 * parts union, optional tool payloads) — Mongo per the drizzle-postgres
 * scope rule. Spend/usage stays in Postgres (`usage_counters`,
 * `ai_usage_events`); nothing here is billed state.
 */
import mongoose, { type InferSchemaType } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
export const CHAT_TITLE_MAX_CHARS = 120;
const chatConversationSchema = new mongoose.Schema({
    // Better Auth user id (ObjectId-compatible hex) — string, matching the
    // other account-scoped Mongo docs.
    accountId: { type: String, required: true },
    // Optional owned-site linkage; seeds the system prompt with the domain.
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', default: null },
    // Derived from the first user message (≤120 chars); empty until then.
    title: { type: String, default: '', maxlength: CHAT_TITLE_MAX_CHARS },
    locale: { type: String, required: true },
    lastMessageAt: { type: Date, required: true },
    messageCount: { type: Number, required: true, default: 0 },
}, { timestamps: true });
chatConversationSchema.index({ accountId: 1, lastMessageAt: -1 });
export type ChatConversationDocument = InferSchemaType<typeof chatConversationSchema>;
export const ChatConversation = mongoose.model('ChatConversation', chatConversationSchema);
/**
 * One stored message part. Discriminated on `type`:
 *   text        → { text }
 *   tool_call   → { toolCallId, toolName, args }
 *   tool_result → { toolCallId, toolName, ok, structuredContent, errorCode? }
 * `structuredContent` is denylist-scanned BEFORE persistence (chat.tools.ts).
 */
const chatMessagePartSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['text', 'tool_call', 'tool_result'] as const,
        required: true,
    },
    text: { type: String },
    toolCallId: { type: String },
    toolName: { type: String },
    args: { type: mongoose.Schema.Types.Mixed },
    ok: { type: Boolean },
    structuredContent: { type: mongoose.Schema.Types.Mixed },
    errorCode: { type: String },
}, { _id: false });
const chatMessageSchema = new mongoose.Schema({
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ChatConversation',
        required: true,
        index: true,
    },
    accountId: { type: String, required: true },
    role: { type: String, enum: ['user', 'assistant'] as const, required: true },
    status: {
        type: String,
        enum: ['complete', 'error', 'aborted'] as const,
        required: true,
        default: 'complete',
    },
    // Additive per-turn provenance. Legacy and user messages omit it.
    responseLocale: {
        type: String,
        enum: SUPPORTED_LOCALES,
        default: undefined,
    },
    parts: { type: [chatMessagePartSchema], required: true },
    tokens: {
        type: new mongoose.Schema({
            input: { type: Number, default: null },
            output: { type: Number, default: null },
        }, { _id: false }),
        default: undefined,
    },
}, { timestamps: true });
export type ChatMessageDocument = InferSchemaType<typeof chatMessageSchema>;
export const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
