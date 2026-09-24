/**
 * Chat conversation/message service.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { ChatConversation, ChatMessage } from './chat.models.js';
import { resolveOwnedConversationSiteId } from './chat.service.js';
import {
  CHAT_HISTORY_BYTE_BUDGET,
  CHAT_HISTORY_MESSAGE_LIMIT,
  CHAT_MAX_CONVERSATIONS,
  CHAT_MAX_MESSAGES_PER_CONVERSATION,
  appendAssistantMessage,
  appendUserMessage,
  assembleHistory,
  buildChatSystemInstruction,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
} from './chat.service.js';

const ACCOUNT = '64b0000000000000000000a1';
const STRANGER = '64b0000000000000000000a2';

beforeAll(async () => {
  await startMemoryMongo();
});
afterAll(async () => {
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
});

function insertSite(accountId: string, domain: string) {
  return Site.create({ accountId, url: `https://${domain}`, domain, displayName: '' });
}

describe('createConversation', () => {
  it('creates an unlinked conversation with empty title and zero messages', async () => {
    const dto = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    expect(dto).toMatchObject({ siteId: null, title: '', messageCount: 0, locale: 'en' });
    expect(dto.id).toMatch(/^[0-9a-f]{24}$/);
  });

  it('links an owned site and 404s on a non-owned or malformed siteId', async () => {
    const site = await insertSite(ACCOUNT, 'linked.example.com');
    const dto = await createConversation({
      accountId: ACCOUNT,
      siteId: String(site._id),
      locale: 'fr',
    });
    expect(dto.siteId).toBe(String(site._id));

    const strangerSite = await insertSite(STRANGER, 'stranger.example.com');
    await expect(
      createConversation({
        accountId: ACCOUNT,
        siteId: String(strangerSite._id),
        locale: 'en',
      }),
    ).rejects.toMatchObject({ status: 404, message: 'sites.errors.notFound' });

    await expect(
      createConversation({ accountId: ACCOUNT, siteId: 'not-an-id', locale: 'en' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it(`prunes the oldest conversation (and its messages) past ${CHAT_MAX_CONVERSATIONS}`, async () => {
    const docs = Array.from({ length: CHAT_MAX_CONVERSATIONS }, (_, i) => ({
      accountId: ACCOUNT,
      siteId: null,
      title: `c${i}`,
      locale: 'en',
      lastMessageAt: new Date(1_700_000_000_000 + i * 1_000),
      messageCount: 1,
    }));
    await ChatConversation.insertMany(docs);
    const oldest = await ChatConversation.findOne({ accountId: ACCOUNT }).sort({
      lastMessageAt: 1,
    });
    await ChatMessage.create({
      conversationId: oldest!._id,
      accountId: ACCOUNT,
      role: 'user',
      status: 'complete',
      parts: [{ type: 'text', text: 'old' }],
    });

    await createConversation({ accountId: ACCOUNT, locale: 'en' });

    expect(await ChatConversation.countDocuments({ accountId: ACCOUNT })).toBe(
      CHAT_MAX_CONVERSATIONS,
    );
    expect(await ChatConversation.findById(oldest!._id)).toBeNull();
    expect(await ChatMessage.countDocuments({ conversationId: oldest!._id })).toBe(0);
  });
});

describe('list / get / delete', () => {
  it('lists newest-first and scopes to the account', async () => {
    const a = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    const b = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    await appendUserMessage(ACCOUNT, a.id, 'bump a to newest');
    await createConversation({ accountId: STRANGER, locale: 'en' });

    const list = await listConversations(ACCOUNT);
    expect(list.map((c) => c.id)).toEqual([a.id, b.id]);
    expect(await listConversations(ACCOUNT, [])).toEqual([]);
  });

  it('getConversation returns ordered messages and 404s cross-account', async () => {
    const conversation = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    await appendUserMessage(ACCOUNT, conversation.id, 'first');
    await appendAssistantMessage({
      accountId: ACCOUNT,
      conversationId: conversation.id,
      parts: [{ type: 'text', text: 'reply' }],
      status: 'complete',
      responseLocale: 'fr',
      tokens: { input: 10, output: 5 },
    });

    const detail = await getConversation(ACCOUNT, conversation.id);
    expect(detail.conversation.messageCount).toBe(2);
    expect(detail.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(detail.messages[1]).toMatchObject({
      status: 'complete',
      responseLocale: 'fr',
      tokens: { input: 10, output: 5 },
    });
    expect(detail.messages[0]?.responseLocale).toBeNull();

    await expect(getConversation(STRANGER, conversation.id)).rejects.toMatchObject({
      status: 404,
      message: 'chat.errors.notFound',
    });
    await expect(getConversation(ACCOUNT, 'zz')).rejects.toBeInstanceOf(HttpError);
  });

  it('preserves explicitly unknown token counts as nullable DTO fields', async () => {
    const conversation = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    await appendAssistantMessage({
      accountId: ACCOUNT,
      conversationId: conversation.id,
      parts: [{ type: 'text', text: 'reply' }],
      status: 'complete',
      responseLocale: 'en',
      tokens: { input: null, output: null },
    });

    const detail = await getConversation(ACCOUNT, conversation.id);

    expect(detail.messages[0]?.tokens).toEqual({ input: null, output: null });
  });

  it('serializes legacy assistant messages and every user message with a null locale', async () => {
    const conversation = await createConversation({ accountId: ACCOUNT, locale: 'de' });
    await appendUserMessage(ACCOUNT, conversation.id, 'verbatim user text');
    await ChatMessage.create({
      conversationId: conversation.id,
      accountId: ACCOUNT,
      role: 'assistant',
      status: 'complete',
      parts: [{ type: 'text', text: 'legacy reply' }],
    });

    const detail = await getConversation(ACCOUNT, conversation.id);
    expect(detail.conversation.locale).toBe('de');
    expect(detail.messages.map((message) => message.responseLocale)).toEqual([
      null,
      null,
    ]);
  });

  it('deleteConversation cascades messages and 404s cross-account', async () => {
    const conversation = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    await appendUserMessage(ACCOUNT, conversation.id, 'hello');
    await expect(deleteConversation(STRANGER, conversation.id)).rejects.toMatchObject({
      status: 404,
    });
    await deleteConversation(ACCOUNT, conversation.id);
    expect(await ChatConversation.countDocuments({ accountId: ACCOUNT })).toBe(0);
    expect(await ChatMessage.countDocuments({ accountId: ACCOUNT })).toBe(0);
  });
});

describe('appendUserMessage', () => {
  it('derives the title from the FIRST user message only, truncated to 120 chars', async () => {
    const conversation = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    const long = 'q'.repeat(300);
    const first = await appendUserMessage(ACCOUNT, conversation.id, long);
    expect(first.conversation.title).toBe('q'.repeat(120));
    const second = await appendUserMessage(ACCOUNT, conversation.id, 'later message');
    expect(second.conversation.title).toBe('q'.repeat(120));
    expect(second.conversation.messageCount).toBe(2);
  });

  it('returns the linked-site domain, null when unlinked, and 404 once the site is removed', async () => {
    const site = await insertSite(ACCOUNT, 'ctx.example.com');
    const linked = await createConversation({
      accountId: ACCOUNT,
      siteId: String(site._id),
      locale: 'en',
    });
    const withDomain = await appendUserMessage(ACCOUNT, linked.id, 'hi');
    expect(withDomain.siteDomain).toBe('ctx.example.com');

    const siteExists = vi
      .spyOn(Site, 'exists')
      .mockResolvedValueOnce({ _id: site._id } as never);
    const findSite = vi
      .spyOn(Site, 'findOne')
      .mockReturnValueOnce({ select: async () => null } as never);
    try {
      const racedDeletion = await appendUserMessage(
        ACCOUNT,
        linked.id,
        'site removed between checks',
      );
      expect(racedDeletion.siteDomain).toBeNull();
    } finally {
      siteExists.mockRestore();
      findSite.mockRestore();
    }

    // Removing the site hides everything scoped to it — the same rule
    // `listConversations` applies when it filters to live site ids.
    await Site.deleteOne({ _id: site._id });
    await expect(
      appendUserMessage(ACCOUNT, linked.id, 'hi again'),
    ).rejects.toMatchObject({ status: 404, message: 'chat.errors.notFound' });

    const unlinked = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    const noDomain = await appendUserMessage(ACCOUNT, unlinked.id, 'hi');
    expect(noDomain.siteDomain).toBeNull();
  });

  it(`refuses the ${CHAT_MAX_MESSAGES_PER_CONVERSATION + 1}th message with a localized 409`, async () => {
    const conversation = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    await ChatConversation.updateOne(
      { _id: conversation.id },
      { $set: { messageCount: CHAT_MAX_MESSAGES_PER_CONVERSATION } },
    );
    await expect(
      appendUserMessage(ACCOUNT, conversation.id, 'one too many'),
    ).rejects.toMatchObject({ status: 409, message: 'chat.errors.conversationFull' });
  });
});

describe('assembleHistory', () => {
  it('elides tool parts, keeps role order, and skips text-less messages', async () => {
    const conversation = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    await appendUserMessage(ACCOUNT, conversation.id, 'question');
    await appendAssistantMessage({
      accountId: ACCOUNT,
      conversationId: conversation.id,
      parts: [
        { type: 'tool_call', toolCallId: 'c1', toolName: 'list_sites', args: {} },
        {
          type: 'tool_result',
          toolCallId: 'c1',
          toolName: 'list_sites',
          ok: true,
          structuredContent: { sites: [] },
        },
        { type: 'text', text: 'answer' },
      ],
      status: 'complete',
      responseLocale: 'en',
    });
    await appendAssistantMessage({
      accountId: ACCOUNT,
      conversationId: conversation.id,
      parts: [
        { type: 'tool_call', toolCallId: 'c2', toolName: 'list_sites', args: {} },
      ],
      status: 'error',
      responseLocale: 'fr',
    });

    const history = await assembleHistory(ACCOUNT, conversation.id);
    expect(history).toEqual([
      { role: 'user', text: 'question' },
      { role: 'assistant', text: 'answer' },
    ]);
  });

  it(`keeps only the newest ${CHAT_HISTORY_MESSAGE_LIMIT} messages`, async () => {
    const conversation = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    for (let i = 0; i < CHAT_HISTORY_MESSAGE_LIMIT + 5; i += 1) {
      await appendUserMessage(ACCOUNT, conversation.id, `m${i}`);
    }
    const history = await assembleHistory(ACCOUNT, conversation.id);
    expect(history).toHaveLength(CHAT_HISTORY_MESSAGE_LIMIT);
    expect(history[0]?.text).toBe('m5');
    expect(history.at(-1)?.text).toBe(`m${CHAT_HISTORY_MESSAGE_LIMIT + 4}`);
  });

  it('drops oldest messages until the byte budget fits, always keeping the newest', async () => {
    const conversation = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    const big = 'x'.repeat(7_000);
    for (let i = 0; i < 5; i += 1) {
      await appendUserMessage(ACCOUNT, conversation.id, `${i}${big}`);
    }
    const history = await assembleHistory(ACCOUNT, conversation.id);
    const total = history.reduce((sum, m) => sum + Buffer.byteLength(m.text), 0);
    expect(total).toBeLessThanOrEqual(CHAT_HISTORY_BYTE_BUDGET);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.at(-1)?.text.startsWith('4')).toBe(true);
  });

  it('never drops the sole (oversized) newest message', async () => {
    const conversation = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    await ChatMessage.create({
      conversationId: conversation.id,
      accountId: ACCOUNT,
      role: 'user',
      status: 'complete',
      parts: [{ type: 'text', text: 'y'.repeat(CHAT_HISTORY_BYTE_BUDGET + 100) }],
    });
    const history = await assembleHistory(ACCOUNT, conversation.id);
    expect(history).toHaveLength(1);
  });
});

describe('buildChatSystemInstruction', () => {
  it('uses the versioned chat_assistant template and seeds the linked domain', () => {
    const base = buildChatSystemInstruction(null, 'en');
    expect(base.id).toBe('chat-assistant');
    expect(base.version).toBe('1');
    expect(base.text).toContain('RankMeFast SEO assistant');
    expect(base.text).not.toContain('linked site for this conversation');

    const seeded = buildChatSystemInstruction('seed.example.com', 'en');
    expect(seeded.text).toContain(
      'The user’s linked site for this conversation is seed.example.com.',
    );
  });

  it.each([
    ['en', 'Reply in English'],
    ['ar', 'اكتب ردك باللغة العربية'],
    ['fr', 'Répondez en français'],
    ['de', 'Antworten Sie auf Deutsch'],
    ['es', 'Responde en español'],
    ['ru', 'Отвечайте на русском языке'],
    ['zh', '请使用中文回答'],
  ] as const)('builds the complete safety instruction in %s', (locale, marker) => {
    const instruction = buildChatSystemInstruction('raw.example', locale);
    expect(instruction).toMatchObject({ id: 'chat-assistant', version: '1' });
    expect(instruction.text).toContain(marker);
    expect(instruction.text).toContain('raw.example');
  });
});

describe('resolveOwnedConversationSiteId', () => {
  // The lease boundary screens the id itself so a malformed value can never
  // reach Mongo's ObjectId cast.
  it('returns null for a malformed conversation id', async () => {
    await expect(resolveOwnedConversationSiteId(ACCOUNT, 'not-an-id')).resolves.toBeNull();
  });

  it('returns null for a conversation this account does not own', async () => {
    await expect(
      resolveOwnedConversationSiteId(ACCOUNT, '6a6fa7c28d75c2fd32d84a99'),
    ).resolves.toBeNull();
  });
});
