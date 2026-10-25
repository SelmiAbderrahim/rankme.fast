/**
 * AI Assistant conversation/message business logic.
 *
 * Ownership is 404 (never 403); retention prunes the oldest conversations at
 * the cap and refuses over-full conversations with a localized 409; history
 * assembly is bounded by a message count AND a byte budget so the model
 * input stays inside the priced 6k-token allowance.
 */
import { Types } from 'mongoose';
import { HttpError } from '../../shared/utils/http-error.js';
import { isSupportedLocale, translate, type SupportedLocale, } from '../../shared/i18n/index.js';
import type { AiChatHistoryMessage } from '../../shared/providers/index.js';
import { resolveAiTaskProfile } from '../../shared/ai-profiles/index.js';
import type { AiSystemInstruction } from '../../shared/providers/index.js';
import { Site } from '../sites/index.js';
import { CHAT_TITLE_VERSION, ChatConversation, ChatMessage, type ChatMessageDocument, } from './chat.models.js';
import { buildConversationTitle } from './chat.title.js';
import type { ChatConversationDto, ChatMessageDto, ChatMessagePartDto, ChatMessageStatus, } from './chat.schema.js';
/** Max retained conversations per account — creating past it prunes oldest. */
export const CHAT_MAX_CONVERSATIONS = 100;
/** Max messages in one conversation — the next send is a localized 409. */
export const CHAT_MAX_MESSAGES_PER_CONVERSATION = 200;
/** History assembly: newest-first message window handed to the model. */
export const CHAT_HISTORY_MESSAGE_LIMIT = 20;
/** History assembly: total UTF-8 byte budget (~6k tokens at 4 bytes/token). */
export const CHAT_HISTORY_BYTE_BUDGET = 24000;
function asObjectId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
        throw HttpError.notFound({ code: 'CHAT_ERRORS_NOT_FOUND', messageKey: 'chat.errors.notFound' });
    }
    return new Types.ObjectId(id);
}
interface ConversationDoc {
    _id: Types.ObjectId;
    siteId?: Types.ObjectId | null;
    title: string;
    locale: string;
    lastMessageAt: Date;
    messageCount: number;
    createdAt: Date;
}
function toConversationDto(doc: ConversationDoc): ChatConversationDto {
    return {
        id: String(doc._id),
        siteId: doc.siteId ? String(doc.siteId) : null,
        title: doc.title,
        locale: doc.locale,
        lastMessageAt: doc.lastMessageAt.toISOString(),
        messageCount: doc.messageCount,
        createdAt: doc.createdAt.toISOString(),
    };
}
function toMessageDto(doc: ChatMessageDocument & {
    _id: Types.ObjectId;
}): ChatMessageDto {
    return {
        id: String(doc._id),
        role: doc.role,
        status: doc.status,
        responseLocale: doc.role === 'assistant' && isSupportedLocale(doc.responseLocale)
            ? doc.responseLocale
            : null,
        parts: doc.parts as unknown as ChatMessagePartDto[],
        tokens: doc.tokens
            ? { input: doc.tokens.input ?? null, output: doc.tokens.output ?? null }
            : null,
        createdAt: doc.createdAt.toISOString(),
    };
}
export interface CreateConversationInput {
    accountId: string;
    siteId?: string | undefined;
    locale: string;
}
export async function createConversation(input: CreateConversationInput): Promise<ChatConversationDto> {
    let siteObjectId: Types.ObjectId | null = null;
    if (input.siteId) {
        const site = await Site.findOne({
            _id: asObjectId(input.siteId),
            accountId: input.accountId,
            deletionStartedAt: null,
        });
        if (!site)
            throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
        siteObjectId = site._id as Types.ObjectId;
    }
    // Retention: prune the oldest conversations (and their messages) so the
    // account never exceeds the cap AFTER this create.
    const existing = await ChatConversation.countDocuments({
        accountId: input.accountId,
    });
    if (existing >= CHAT_MAX_CONVERSATIONS) {
        const overflow = existing - CHAT_MAX_CONVERSATIONS + 1;
        const oldest = await ChatConversation.find({ accountId: input.accountId })
            .sort({ lastMessageAt: 1 })
            .limit(overflow)
            .select('_id')
            .lean();
        const oldestIds = oldest.map((doc) => doc._id);
        await ChatMessage.deleteMany({ conversationId: { $in: oldestIds } });
        await ChatConversation.deleteMany({ _id: { $in: oldestIds } });
    }
    const doc = await ChatConversation.create({
        accountId: input.accountId,
        siteId: siteObjectId,
        title: '',
        locale: input.locale,
        lastMessageAt: new Date(),
        messageCount: 0,
    });
    return toConversationDto(doc as unknown as ConversationDoc);
}
type ListedConversation = InstanceType<typeof ChatConversation> & {
    createdAt: Date;
};
/**
 * Conversations titled before the current builder (for example six identical
 * "Summarize the most im…" starters) get a title from their stored first
 * message, oldest first, unique on the account. No model call. Idempotent:
 * each row is written once, guarded on its old version.
 */
async function retitleLegacyConversations(visible: ListedConversation[], all: ListedConversation[], domains: ReadonlyMap<string, string>): Promise<void> {
    const legacy = visible
        .filter((doc) => doc.messageCount > 0 && doc.titleVersion < CHAT_TITLE_VERSION)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (legacy.length === 0)
        return;
    const pending = new Set(legacy.map((doc) => String(doc._id)));
    const taken = all.filter((doc) => !pending.has(String(doc._id))).map((doc) => doc.title);
    for (const doc of legacy) {
        const first = await ChatMessage.findOne({ conversationId: doc._id, role: 'user' })
            .sort({ createdAt: 1 })
            .lean();
        const text = first?.parts.find((part) => part.type === 'text')?.text ?? '';
        const title = buildConversationTitle({
            text,
            locale: doc.locale,
            // Visible conversations only link live sites, so the domain is known.
            siteDomain: doc.siteId ? domains.get(String(doc.siteId))! : null,
            existingTitles: taken,
        });
        await ChatConversation.updateOne(
        // Rows written before versioning have no field at all.
        { _id: doc._id, titleVersion: { $ne: CHAT_TITLE_VERSION } }, { $set: { title, titleVersion: CHAT_TITLE_VERSION } }, { timestamps: false });
        doc.title = title;
        taken.push(title);
    }
}
export async function listConversations(accountId: string, allowedSiteIds: readonly string[] | null = null): Promise<ChatConversationDto[]> {
    const docs = await ChatConversation.find({
        accountId,
        ...(allowedSiteIds === null ? {} : { siteId: { $in: allowedSiteIds } }),
    }).sort({
        lastMessageAt: -1,
    });
    const linkedIds = docs.flatMap((doc) => (doc.siteId ? [doc.siteId] : []));
    const liveSites = await Site.find({
        _id: { $in: linkedIds },
        accountId,
        deletionStartedAt: null,
    }).select({ _id: 1, domain: 1 });
    const domains = new Map(liveSites.map((site) => [String(site._id), site.domain]));
    const visible = docs.filter((doc) => !doc.siteId || domains.has(String(doc.siteId)));
    // Uniqueness is account-wide, so a scoped (MCP) listing never retitles.
    if (allowedSiteIds === null)
        await retitleLegacyConversations(visible, docs, domains);
    return visible.map((doc) => toConversationDto(doc as unknown as ConversationDoc));
}
async function loadOwnedConversation(accountId: string, conversationId: string) {
    const doc = await ChatConversation.findOne({
        _id: asObjectId(conversationId),
        accountId,
    });
    if (!doc)
        throw HttpError.notFound({ code: 'CHAT_ERRORS_NOT_FOUND', messageKey: 'chat.errors.notFound' });
    if (doc.siteId) {
        const site = await Site.exists({
            _id: doc.siteId,
            accountId,
            deletionStartedAt: null,
        });
        if (!site)
            throw HttpError.notFound({ code: 'CHAT_ERRORS_NOT_FOUND', messageKey: 'chat.errors.notFound' });
    }
    return doc;
}
/** Resource-id resolver used by the HTTP lifecycle lease boundary. */
export async function resolveOwnedConversationSiteId(accountId: string, conversationId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(conversationId))
        return null;
    const doc = await ChatConversation.findOne({ _id: conversationId, accountId }, { siteId: 1 }).lean();
    return doc?.siteId ? String(doc.siteId) : null;
}
export interface ConversationDetail {
    conversation: ChatConversationDto;
    messages: ChatMessageDto[];
}
export async function getConversation(accountId: string, conversationId: string): Promise<ConversationDetail> {
    const doc = await loadOwnedConversation(accountId, conversationId);
    const messages = await ChatMessage.find({ conversationId: doc._id }).sort({
        _id: 1,
    });
    return {
        conversation: toConversationDto(doc as unknown as ConversationDoc),
        messages: messages.map((message) => toMessageDto(message as unknown as ChatMessageDocument & {
            _id: Types.ObjectId;
        })),
    };
}
export async function deleteConversation(accountId: string, conversationId: string): Promise<void> {
    const doc = await loadOwnedConversation(accountId, conversationId);
    await ChatMessage.deleteMany({ conversationId: doc._id });
    await ChatConversation.deleteOne({ _id: doc._id });
}
/**
 * Pre-flight for the send route: ownership (404) + conversation-full (409),
 * WITHOUT persisting anything — so the kill switch can still refuse before
 * any write.
 */
export async function assertConversationWritable(accountId: string, conversationId: string): Promise<void> {
    const doc = await loadOwnedConversation(accountId, conversationId);
    if (doc.messageCount >= CHAT_MAX_MESSAGES_PER_CONVERSATION) {
        throw HttpError.conflict({ code: 'CHAT_ERRORS_CONVERSATION_FULL', messageKey: 'chat.errors.conversationFull' });
    }
}
export interface AppendUserMessageResult {
    conversation: ChatConversationDto;
    message: ChatMessageDto;
    /** Linked site, when the conversation has one (system prompt seed). */
    site: {
        id: string;
        domain: string;
    } | null;
}
export async function appendUserMessage(accountId: string, conversationId: string, text: string, messageId?: string): Promise<AppendUserMessageResult> {
    const doc = await loadOwnedConversation(accountId, conversationId);
    if (doc.messageCount >= CHAT_MAX_MESSAGES_PER_CONVERSATION) {
        throw HttpError.conflict({ code: 'CHAT_ERRORS_CONVERSATION_FULL', messageKey: 'chat.errors.conversationFull' });
    }
    const message = await ChatMessage.create({
        ...(messageId ? { _id: new Types.ObjectId(messageId) } : {}),
        conversationId: doc._id,
        accountId,
        role: 'user',
        status: 'complete',
        parts: [{ type: 'text', text }],
    });
    let linkedSite: {
        id: string;
        domain: string;
    } | null = null;
    if (doc.siteId) {
        const site = await Site.findOne({
            _id: doc.siteId,
            accountId,
            deletionStartedAt: null,
        }).select('domain');
        linkedSite = site ? { id: String(doc.siteId), domain: site.domain } : null;
    }
    if (doc.messageCount === 0) {
        const used = await ChatConversation.find({ accountId, _id: { $ne: doc._id } }, { title: 1 }).lean();
        doc.title = buildConversationTitle({
            text,
            locale: doc.locale,
            siteDomain: linkedSite?.domain ?? null,
            existingTitles: used.map((row) => row.title),
        });
        doc.titleVersion = CHAT_TITLE_VERSION;
    }
    doc.messageCount += 1;
    doc.lastMessageAt = new Date();
    await doc.save();
    return {
        conversation: toConversationDto(doc as unknown as ConversationDoc),
        message: toMessageDto(message as unknown as ChatMessageDocument & {
            _id: Types.ObjectId;
        }),
        site: linkedSite,
    };
}
export interface AppendAssistantMessageInput {
    accountId: string;
    conversationId: string;
    parts: ChatMessagePartDto[];
    status: ChatMessageStatus;
    responseLocale: SupportedLocale;
    tokens?: {
        input: number | null;
        output: number | null;
    } | undefined;
    /** Pre-allocated message id (the SSE `meta` event announced it upfront). */
    messageId?: string | undefined;
}
export async function appendAssistantMessage(input: AppendAssistantMessageInput): Promise<ChatMessageDto> {
    const doc = await loadOwnedConversation(input.accountId, input.conversationId);
    const message = await ChatMessage.create({
        ...(input.messageId ? { _id: new Types.ObjectId(input.messageId) } : {}),
        conversationId: doc._id,
        accountId: input.accountId,
        role: 'assistant',
        status: input.status,
        responseLocale: input.responseLocale,
        parts: input.parts,
        ...(input.tokens ? { tokens: input.tokens } : {}),
    });
    doc.messageCount += 1;
    doc.lastMessageAt = new Date();
    await doc.save();
    return toMessageDto(message as unknown as ChatMessageDocument & {
        _id: Types.ObjectId;
    });
}
/**
 * Assemble the model-facing history: the newest `CHAT_HISTORY_MESSAGE_LIMIT`
 * messages, oldest-first, dropping oldest-first again until the total text
 * fits `CHAT_HISTORY_BYTE_BUDGET`. Tool parts are elided — only text reaches
 * the model as history (tool results returned live within the same turn).
 */
export async function assembleHistory(accountId: string, conversationId: string): Promise<AiChatHistoryMessage[]> {
    const doc = await loadOwnedConversation(accountId, conversationId);
    const newest = await ChatMessage.find({ conversationId: doc._id })
        .sort({ _id: -1 })
        .limit(CHAT_HISTORY_MESSAGE_LIMIT)
        .lean();
    const ordered = [...newest].reverse();
    const history: AiChatHistoryMessage[] = [];
    for (const message of ordered) {
        const text = (message.parts as unknown as ChatMessagePartDto[])
            .filter((part): part is Extract<ChatMessagePartDto, {
            type: 'text';
        }> => part.type === 'text')
            .map((part) => part.text)
            .join('');
        if (text.length === 0)
            continue;
        history.push({ role: message.role, text });
    }
    let total = history.reduce((sum, message) => sum + Buffer.byteLength(message.text, 'utf8'), 0);
    while (history.length > 1 && total > CHAT_HISTORY_BYTE_BUDGET) {
        const dropped = history[0]!;
        history.shift();
        total -= Buffer.byteLength(dropped.text, 'utf8');
    }
    return history;
}
/** Versioned system instruction from the chat_assistant profile (+ site seed). */
export function buildChatSystemInstruction(site: {
    id: string;
    domain: string;
} | null, responseLocale: SupportedLocale, disabledTools: readonly string[] = []): AiSystemInstruction {
    const profile = resolveAiTaskProfile('chat_assistant');
    const base = translate(responseLocale, 'chat.systemInstruction.base');
    const linked = site
        ? [translate(responseLocale, 'chat.systemInstruction.linkedSite', { siteDomain: site.domain, siteId: site.id })]
        : [];
    const dataTools = translate(responseLocale, 'chat.systemInstruction.dataTools');
    // Keyword counts are quoted from the tool, never recomputed.
    const rankStates = translate(responseLocale, 'chat.systemInstruction.rankStates');
    const noInternalIds = translate(responseLocale, 'chat.systemInstruction.noInternalIds');
    const disabled = disabledTools.length > 0
        ? [translate(responseLocale, 'chat.systemInstruction.disabledTools', { tools: disabledTools.join(', ') })]
        : [];
    const text = [base, dataTools, rankStates, noInternalIds, ...disabled, ...linked].join(' ');
    return {
        id: profile.systemInstruction.templateId,
        version: profile.systemInstruction.version,
        text,
    };
}
