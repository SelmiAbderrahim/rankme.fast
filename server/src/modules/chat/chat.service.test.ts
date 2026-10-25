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
import { DICTIONARIES } from '../../shared/i18n/index.js';
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
  it('derives a bounded title from the FIRST user message only', async () => {
    const conversation = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    const long = 'q'.repeat(300);
    const first = await appendUserMessage(ACCOUNT, conversation.id, long);
    expect(first.conversation.title).toBe(`Q${'q'.repeat(59)}\u2026`);
    expect(first.conversation.title.length).toBeLessThanOrEqual(120);
    const second = await appendUserMessage(ACCOUNT, conversation.id, 'later message');
    expect(second.conversation.title).toBe(first.conversation.title);
    expect(second.conversation.messageCount).toBe(2);
  });

  it('gives two conversations from the same starter prompt different titles', async () => {
    const siteA = await insertSite(ACCOUNT, 'alpha.example.com');
    const siteB = await insertSite(ACCOUNT, 'beta.example.com');
    const starter = 'Please summarize the most important issues. Thanks!';
    const a = await createConversation({ accountId: ACCOUNT, siteId: String(siteA._id), locale: 'en' });
    const b = await createConversation({ accountId: ACCOUNT, siteId: String(siteB._id), locale: 'en' });
    const c = await createConversation({ accountId: ACCOUNT, siteId: String(siteB._id), locale: 'en' });
    const titleA = (await appendUserMessage(ACCOUNT, a.id, starter)).conversation.title;
    const titleB = (await appendUserMessage(ACCOUNT, b.id, starter)).conversation.title;
    const titleC = (await appendUserMessage(ACCOUNT, c.id, starter)).conversation.title;
    expect(titleA).toBe('Summarize the most important issues \u00b7 alpha.example.com');
    expect(titleB).toBe('Summarize the most important issues \u00b7 beta.example.com');
    expect(titleC).toBe('Summarize the most important issues \u00b7 beta.example.com \u00b7 2');
    expect(new Set([titleA, titleB, titleC]).size).toBe(3);
  });

  it('falls back to the localized untitled title for emoji-only input', async () => {
    const conversation = await createConversation({ accountId: ACCOUNT, locale: 'fr' });
    const result = await appendUserMessage(ACCOUNT, conversation.id, '\u{1F680}\u{1F680}');
    expect(result.conversation.title).toBe('Nouvelle conversation');
  });

  it('returns the linked-site domain, null when unlinked, and 404 once the site is removed', async () => {
    const site = await insertSite(ACCOUNT, 'ctx.example.com');
    const linked = await createConversation({
      accountId: ACCOUNT,
      siteId: String(site._id),
      locale: 'en',
    });
    const withDomain = await appendUserMessage(ACCOUNT, linked.id, 'hi');
    expect(withDomain.site).toEqual({ id: String(site._id), domain: 'ctx.example.com' });

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
      expect(racedDeletion.site).toBeNull();
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
    expect(noDomain.site).toBeNull();
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

describe('legacy conversation titles', () => {
  const STARTER = 'Summarize the most important fixes from my latest audit.';

  async function legacyConversation(input: {
    title: string;
    createdAt: Date;
    siteId?: unknown;
    parts?: Array<Record<string, unknown>> | null;
    messageCount?: number;
  }) {
    // Raw insert: rows written before titles were versioned have no field.
    const { insertedId } = await ChatConversation.collection.insertOne({
      accountId: ACCOUNT,
      siteId: input.siteId ?? null,
      title: input.title,
      locale: 'en',
      lastMessageAt: input.createdAt,
      messageCount: input.messageCount ?? 2,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    if (input.parts !== null) {
      await ChatMessage.create({
        conversationId: insertedId,
        accountId: ACCOUNT,
        role: 'user',
        parts: input.parts ?? [{ type: 'text', text: STARTER }],
      });
    }
    return String(insertedId);
  }

  it('retitles truncated duplicates from their first message, oldest first, unique, without touching order', async () => {
    const site = await insertSite(ACCOUNT, 'rewards.example');
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(
        await legacyConversation({
          title: 'Summarize the most im\u2026',
          createdAt: new Date(Date.UTC(2026, 9, 1 + i)),
          siteId: site._id,
        }),
      );
    }
    const kept = await createConversation({ accountId: ACCOUNT, locale: 'en' });
    await appendUserMessage(ACCOUNT, kept.id, 'Check my rankings');

    const listed = await listConversations(ACCOUNT);
    const byId = new Map(listed.map((c) => [c.id, c.title]));
    expect(byId.get(ids[0]!)).toBe('Summarize the most important fixes from my latest audit \u00b7 rewards.example');
    expect(byId.get(ids[1]!)).toBe('Summarize the most important fixes from my latest audit \u00b7 rewards.example \u00b7 2');
    expect(byId.get(ids[2]!)).toBe('Summarize the most important fixes from my latest audit \u00b7 rewards.example \u00b7 3');
    expect(byId.get(kept.id)).toBe('Check my rankings');
    // Retitling never reorders the list or bumps activity.
    expect(listed.map((c) => c.id)).toEqual([kept.id, ids[2], ids[1], ids[0]]);
    const stored = await ChatConversation.findById(ids[0]).lean();
    expect(stored).toMatchObject({ titleVersion: 1 });
    expect(stored!.updatedAt.toISOString()).toBe('2026-10-01T00:00:00.000Z');

    // Idempotent: a second read writes nothing and returns the same titles.
    const spy = vi.spyOn(ChatConversation, 'updateOne');
    const again = await listConversations(ACCOUNT);
    expect(again.map((c) => c.title)).toEqual(listed.map((c) => c.title));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('falls back to the untitled title when no readable first message is stored, and skips empty conversations', async () => {
    const noMessage = await legacyConversation({ title: 'Old', createdAt: new Date('2026-10-01'), parts: null });
    const toolOnly = await legacyConversation({
      title: 'Old',
      createdAt: new Date('2026-10-02'),
      parts: [{ type: 'tool_call', toolCallId: 't', toolName: 'list_sites' }],
    });
    const empty = await legacyConversation({ title: '', createdAt: new Date('2026-10-03'), parts: null, messageCount: 0 });
    const listed = new Map((await listConversations(ACCOUNT)).map((c) => [c.id, c.title]));
    expect(listed.get(noMessage)).toBe('New conversation');
    expect(listed.get(toolOnly)).toBe('New conversation \u00b7 2');
    expect(listed.get(empty)).toBe('');
  });

  it('a site-scoped (MCP) listing never retitles', async () => {
    const site = await insertSite(ACCOUNT, 'scoped.example');
    const id = await legacyConversation({ title: 'Summarize the most im\u2026', createdAt: new Date('2026-10-01'), siteId: site._id });
    const scoped = await listConversations(ACCOUNT, [String(site._id)]);
    expect(scoped.find((c) => c.id === id)?.title).toBe('Summarize the most im\u2026');
  });

  it('keeps titles unique against conversations hidden because their site was removed', async () => {
    const gone = await insertSite(ACCOUNT, 'gone.example');
    await ChatConversation.create({
      accountId: ACCOUNT,
      siteId: gone._id,
      title: 'Check my rankings',
      titleVersion: 1,
      locale: 'en',
      lastMessageAt: new Date(),
      messageCount: 1,
    });
    await Site.updateOne({ _id: gone._id }, { $set: { deletionStartedAt: new Date() } });
    const id = await legacyConversation({
      title: 'hi',
      createdAt: new Date('2026-10-01'),
      parts: [{ type: 'text', text: 'Check my rankings' }],
    });
    const listed = await listConversations(ACCOUNT);
    expect(listed.map((c) => c.id)).toEqual([id]);
    expect(listed[0]!.title).toBe('Check my rankings \u00b7 2');
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

    const seeded = buildChatSystemInstruction(
      { id: '6a6fa7c28d75c2fd32d84a01', domain: 'seed.example.com' },
      'en',
    );
    expect(seeded.text).toContain(
      'The user selected a site for this conversation: seed.example.com (siteId 6a6fa7c28d75c2fd32d84a01).',
    );
    // The selected site must steer tool use: reuse the id, skip discovery.
    expect(seeded.text).toContain('do not call list_sites');
  });

  it.each(['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const)(
    'tells the model, in %s, never to write internal ids and to quote rank-state counts from the tool',
    (locale) => {
      const text = buildChatSystemInstruction(null, locale).text;
      expect(text).toContain(DICTIONARIES[locale].chat.systemInstruction.noInternalIds);
      expect(text).toContain(DICTIONARIES[locale].chat.systemInstruction.rankStates);
      expect(text).toContain('list_keywords');
      expect(text).toContain('rankStates');
    },
  );

  it('names the tools the account switched off, and omits the line when none are', () => {
    const none = buildChatSystemInstruction(null, 'en');
    expect(none.text).not.toContain('Switched off');
    const some = buildChatSystemInstruction(null, 'en', ['get_ga4_summary', 'list_pages']);
    expect(some.text).toContain('Switched off in Account \u2192 MCP permissions: get_ga4_summary, list_pages.');
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
    const instruction = buildChatSystemInstruction(
      { id: '6a6fa7c28d75c2fd32d84a01', domain: 'raw.example' },
      locale,
    );
    expect(instruction).toMatchObject({ id: 'chat-assistant', version: '1' });
    expect(instruction.text).toContain(marker);
    expect(instruction.text).toContain('raw.example');
    expect(instruction.text).toContain('6a6fa7c28d75c2fd32d84a01');
    expect(instruction.text).toContain('list_sites');
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
