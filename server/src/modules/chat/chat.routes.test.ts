/**
 * rankme-ai-chat-mcp 01 — /api/chat routes incl. the SSE message stream.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import { env } from '../../config/env.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';
import {
  createAiSdkChatProvider,
  createFakeAiChatProvider,
  FAKE_CHAT_REPLIES,
  type AiChatProvider,
  type AiChatStreamInput,
} from '../../shared/providers/index.js';
import type {
  AiChatSdkCall,
  RawChatStreamPart,
} from '../../shared/providers/ai-sdk/chat-runtime.js';
import type { AiSdkProviderAdapter } from '../../shared/providers/ai-sdk/types.js';
import type { AiAttemptBatch } from '../../shared/providers/ai-sdk/runtime.js';
import { Site } from '../sites/index.js';
import { McpPermissionSettings } from '../mcp-permissions/index.js';
import { ChatConversation, ChatMessage } from './chat.models.js';
import { setChatAiProvider } from './chat.holder.js';
import { startChatHeartbeat } from './chat.controller.js';

const app = createApp();

interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

function parseSse(raw: string): SseFrame[] {
  const frames: SseFrame[] = [];
  for (const block of raw.split('\n\n')) {
    const lines = block.split('\n');
    const eventLine = lines.find((line) => line.startsWith('event: '));
    const dataLine = lines.find((line) => line.startsWith('data: '));
    if (!eventLine || !dataLine) continue;
    frames.push({
      event: eventLine.slice('event: '.length),
      data: JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>,
    });
  }
  return frames;
}

interface StreamResult {
  status: number;
  headers: Record<string, string>;
  raw: string;
  chunks: number;
  frames: SseFrame[];
}

async function streamMessage(
  user: TestUser,
  conversationId: string,
  text: string,
  responseLocale = 'en',
): Promise<StreamResult> {
  const res = await request(app)
    .post(`/api/chat/conversations/${conversationId}/messages`)
    .set('Cookie', user.cookie)
    .set('x-lang', responseLocale)
    .send({ text })
    .buffer(true)
    .parse((response, callback) => {
      let raw = '';
      let chunks = 0;
      response.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8');
        chunks += 1;
      });
      response.on('end', () => callback(null, { raw, chunks }));
    });
  const body = res.body as { raw: string; chunks: number };
  return {
    status: res.status,
    headers: res.headers as Record<string, string>,
    raw: body.raw,
    chunks: body.chunks,
    frames: parseSse(body.raw),
  };
}

async function seedUser(email: string) {
  return signupVerifiedUser(app, { email });
}

async function createConversationFor(user: TestUser, siteId?: string) {
  const res = await request(app)
    .post('/api/chat/conversations')
    .set('Cookie', user.cookie)
    .send(siteId ? { siteId } : {});
  expect(res.status).toBe(201);
  return res.body.conversation as { id: string; siteId: string | null };
}

/** Delayed-delta provider: guarantees multi-chunk SSE delivery. */
function slowProvider(deltas: readonly string[]): AiChatProvider {
  return {
    async *streamChat() {
      for (const text of deltas) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield { type: 'text_delta' as const, text };
      }
      yield {
        type: 'finish' as const,
        provider: 'fake' as const,
        model: 'slow-fake',
        finishReason: 'stop' as const,
        tokens: { input: 10, output: 4 },
        actualOrEstimatedCostMicros: 100n,
      };
    },
  };
}

describe('chat SSE heartbeat', () => {
  it('writes a comment frame on the heartbeat interval', () => {
    vi.useFakeTimers();
    try {
      const write = vi.fn();
      const heartbeat = startChatHeartbeat({ write } as unknown as Parameters<
        typeof startChatHeartbeat
      >[0]);

      vi.advanceTimersByTime(15_000);

      expect(write).toHaveBeenCalledWith(': ping\n\n');
      clearInterval(heartbeat);
    } finally {
      vi.useRealTimers();
    }
  });
});

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  installTestAuth();
});
afterAll(async () => {
  uninstallTestAuth();
  setChatAiProvider(null);
  (env as { CHAT_ENABLED: boolean }).CHAT_ENABLED = true;
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  vi.restoreAllMocks();
  setChatAiProvider(createFakeAiChatProvider());
  (env as { CHAT_ENABLED: boolean }).CHAT_ENABLED = true;
});

describe('auth gates', () => {
  it('401s every route unauthenticated', async () => {
    await request(app).post('/api/chat/conversations').send({}).expect(401);
    await request(app).get('/api/chat/conversations').expect(401);
    await request(app).get('/api/chat/conversations/x').expect(401);
    await request(app).delete('/api/chat/conversations/x').expect(401);
    await request(app)
      .post('/api/chat/conversations/x/messages')
      .send({ text: 'hi' })
      .expect(401);
  });
});

describe('conversation CRUD', () => {
  it('creates, lists, reads, and deletes conversations owner-scoped', async () => {
    const user = await seedUser('chat-crud@x.co');
    const stranger = await seedUser('chat-crud-stranger@x.co');
    const site = await Site.create({
      accountId: user.id,
      url: 'https://crud.example.com',
      domain: 'crud.example.com',
      displayName: '',
    });

    const conversation = await createConversationFor(user, String(site._id));
    expect(conversation.siteId).toBe(String(site._id));

    const list = await request(app)
      .get('/api/chat/conversations')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(list.body.conversations).toHaveLength(1);

    const detail = await request(app)
      .get(`/api/chat/conversations/${conversation.id}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(detail.body.conversation.id).toBe(conversation.id);
    expect(detail.body.messages).toEqual([]);

    await request(app)
      .get(`/api/chat/conversations/${conversation.id}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    await request(app)
      .delete(`/api/chat/conversations/${conversation.id}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    await request(app)
      .post(`/api/chat/conversations/${conversation.id}/messages`)
      .set('Cookie', stranger.cookie)
      .send({ text: 'hi' })
      .expect(404);

    await request(app)
      .delete(`/api/chat/conversations/${conversation.id}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(await ChatConversation.countDocuments({ accountId: user.id })).toBe(0);
  });

  it("rejects a stranger's siteId on create with 404 and a malformed body with 400", async () => {
    const user = await seedUser('chat-create-bad@x.co');
    const stranger = await seedUser('chat-create-victim@x.co');
    const site = await Site.create({
      accountId: stranger.id,
      url: 'https://victim.example.com',
      domain: 'victim.example.com',
      displayName: '',
    });
    await request(app)
      .post('/api/chat/conversations')
      .set('Cookie', user.cookie)
      .send({ siteId: String(site._id) })
      .expect(404);
    await request(app)
      .post('/api/chat/conversations')
      .set('Cookie', user.cookie)
      .send({ nonsense: 1 })
      .expect(400);
  });
});

describe('POST /api/chat/conversations/:id/messages (SSE)', () => {
  it('streams meta → deltas → done over multiple chunks with SSE headers and persists both messages', async () => {
    const user = await seedUser('chat-stream@x.co');
    setChatAiProvider(slowProvider(['Hello ', 'from ', 'the ', 'assistant.']));
    const conversation = await createConversationFor(user);

    const result = await streamMessage(user, conversation.id, 'How are my rankings?');
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toContain('text/event-stream');
    expect(result.headers['content-language']).toBe('en');
    expect(result.headers['cache-control']).toBe('no-cache, no-transform');
    expect(result.headers['x-accel-buffering']).toBe('no');
    expect(result.chunks).toBeGreaterThan(1);

    const events = result.frames.map((frame) => frame.event);
    expect(events[0]).toBe('meta');
    expect(events.at(-1)).toBe('done');
    expect(events.filter((event) => event === 'delta')).toHaveLength(4);
    const meta = result.frames[0]!.data;
    expect(meta.conversationId).toBe(conversation.id);
    expect(meta.responseLocale).toBe('en');

    const text = result.frames
      .filter((frame) => frame.event === 'delta')
      .map((frame) => frame.data.text)
      .join('');
    expect(text).toBe('Hello from the assistant.');

    const stored = await ChatMessage.find({ accountId: user.id }).sort({ _id: 1 });
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ role: 'user', status: 'complete' });
    expect(stored[1]).toMatchObject({
      role: 'assistant',
      status: 'complete',
      responseLocale: 'en',
    });
    expect(String(stored[0]!._id)).toBe(meta.userMessageId);
    expect(String(stored[1]!._id)).toBe(meta.assistantMessageId);
    expect(stored[1]!.tokens).toMatchObject({ input: 10, output: 4 });

    const updated = await ChatConversation.findById(conversation.id);
    expect(updated!.messageCount).toBe(2);
    expect(updated!.title).toBe('How are my rankings?');
  });

  it('runs a [tool:…] directive through the registry and streams tool events', async () => {
    const user = await seedUser('chat-tool@x.co');
    await Site.create({
      accountId: user.id,
      url: 'https://tools.example.com',
      domain: 'tools.example.com',
      displayName: '',
    });
    const conversation = await createConversationFor(user);
    const result = await streamMessage(
      user,
      conversation.id,
      'Show my sites [tool:list_sites {"locale":"de"}]',
      'ar',
    );
    const events = result.frames.map((frame) => frame.event);
    expect(events).toContain('tool_call');
    expect(events).toContain('tool_result');
    const toolResult = result.frames.find((frame) => frame.event === 'tool_result')!;
    expect(toolResult.data.toolName).toBe('list_sites');
    expect(toolResult.data.ok).toBe(true);
    const structuredContent = toolResult.data.structuredContent as {
      locale: string;
      sites: Array<{ domain: string }>;
    };
    expect(structuredContent.locale).toBe('ar');
    const sites = structuredContent.sites;
    expect(sites.map((site) => site.domain)).toEqual(['tools.example.com']);

    const assistant = await ChatMessage.findOne({ accountId: user.id, role: 'assistant' });
    const partTypes = (assistant!.parts as Array<{ type: string }>).map((p) => p.type);
    expect(partTypes).toEqual(['tool_call', 'tool_result', 'text']);
  });

  it('cannot bypass account permission defaults — a disabled tool never runs', async () => {
    const user = await seedUser('chat-perm@x.co');
    await McpPermissionSettings.create({
      accountId: user.id,
      tools: { list_sites: false },
      allowedSiteIds: [],
      allowSpend: true,
    });
    const conversation = await createConversationFor(user);
    const result = await streamMessage(
      user,
      conversation.id,
      'Try it anyway [tool:list_sites]',
    );
    const events = result.frames.map((frame) => frame.event);
    expect(events).not.toContain('tool_call');
    expect(events.at(-1)).toBe('done');
  });

  it('returns clean-JSON refusals pre-stream: 503 flag off, 409 full, 400 invalid', async () => {
    const user = await seedUser('chat-refusals@x.co');
    const conversation = await createConversationFor(user);

    (env as { CHAT_ENABLED: boolean }).CHAT_ENABLED = false;
    const flagOff = await request(app)
      .post(`/api/chat/conversations/${conversation.id}/messages`)
      .set('Cookie', user.cookie)
      .send({ text: 'hello' });
    expect(flagOff.status).toBe(503);
    expect(flagOff.body.error.message).toBe(DICTIONARIES.en.chat.errors.unavailable);
    // Reads stay available while the kill switch is off.
    await request(app)
      .get(`/api/chat/conversations/${conversation.id}`)
      .set('Cookie', user.cookie)
      .expect(200);
    (env as { CHAT_ENABLED: boolean }).CHAT_ENABLED = true;

    await ChatConversation.updateOne(
      { _id: conversation.id },
      { $set: { messageCount: 200 } },
    );
    const full = await request(app)
      .post(`/api/chat/conversations/${conversation.id}/messages`)
      .set('Cookie', user.cookie)
      .send({ text: 'hello' });
    expect(full.status).toBe(409);
    expect(full.body.error.message).toBe(
      DICTIONARIES.en.chat.errors.conversationFull,
    );
    await ChatConversation.updateOne(
      { _id: conversation.id },
      { $set: { messageCount: 0 } },
    );

    await request(app)
      .post(`/api/chat/conversations/${conversation.id}/messages`)
      .set('Cookie', user.cookie)
      .send({ text: '' })
      .expect(400);
  });

  it('localizes a pre-flush refusal in the frozen request locale', async () => {
    const user = await seedUser('chat-refusal-ar@x.co');
    const conversation = await createConversationFor(user);
    (env as { CHAT_ENABLED: boolean }).CHAT_ENABLED = false;

    const result = await request(app)
      .post(`/api/chat/conversations/${conversation.id}/messages`)
      .set('Cookie', user.cookie)
      .set('x-lang', 'ar')
      .send({ text: 'نص المستخدم كما هو' });

    expect(result.status).toBe(503);
    expect(result.headers['content-language']).toBe('ar');
    expect(result.body.error).toMatchObject({
      messageKey: 'chat.errors.unavailable',
      message: DICTIONARIES.ar.chat.errors.unavailable,
    });
    expect(await ChatMessage.countDocuments({ accountId: user.id })).toBe(0);
  });

  it('keeps alternating accepted locales and historical prose verbatim in one conversation', async () => {
    const user = await seedUser('chat-mixed-locales@x.co');
    const conversation = await createConversationFor(user);
    const captured: AiChatStreamInput[] = [];
    const fake = createFakeAiChatProvider();
    setChatAiProvider({
      streamChat(input) {
        captured.push(input);
        return fake.streamChat(input);
      },
    });

    const arabicUserText = 'أبقِ هذا النص كما هو';
    const frenchUserText = 'Garde aussi ce texte tel quel';
    const arabic = await streamMessage(
      user,
      conversation.id,
      arabicUserText,
      'ar',
    );
    const french = await streamMessage(
      user,
      conversation.id,
      frenchUserText,
      'fr',
    );

    expect(arabic.headers['content-language']).toBe('ar');
    expect(arabic.frames[0]?.data.responseLocale).toBe('ar');
    expect(french.headers['content-language']).toBe('fr');
    expect(french.frames[0]?.data.responseLocale).toBe('fr');
    const streamedText = (result: StreamResult) =>
      result.frames
        .filter((frame) => frame.event === 'delta')
        .map((frame) => frame.data.text)
        .join('');
    expect(streamedText(arabic)).toBe(FAKE_CHAT_REPLIES.ar);
    expect(streamedText(french)).toBe(FAKE_CHAT_REPLIES.fr);
    expect(captured.map((input) => input.responseLocale)).toEqual(['ar', 'fr']);
    expect(captured[1]?.messages).toEqual([
      { role: 'user', text: arabicUserText },
      { role: 'assistant', text: FAKE_CHAT_REPLIES.ar },
      { role: 'user', text: frenchUserText },
    ]);
    expect(captured[0]?.systemInstruction.text).toContain('اكتب ردك باللغة العربية');
    expect(captured[1]?.systemInstruction.text).toContain('Répondez en français');

    const detail = await request(app)
      .get(`/api/chat/conversations/${conversation.id}`)
      .set('Cookie', user.cookie)
      .set('x-lang', 'fr')
      .expect(200);
    expect(detail.body.conversation.locale).toBe('en');
    expect(
      (detail.body.messages as Array<{ responseLocale: string | null }>).map(
        (message) => message.responseLocale,
      ),
    ).toEqual([null, 'ar', null, 'fr']);
  });

  it('writes an error event (never the global handler) when the provider fails mid-stream', async () => {
    const user = await seedUser('chat-error@x.co');
    setChatAiProvider(
      createFakeAiChatProvider({ outcomes: ['error_mid_stream'] }),
    );
    const conversation = await createConversationFor(user);
    const result = await streamMessage(user, conversation.id, 'hello', 'ar');
    expect(result.status).toBe(200);
    expect(result.headers['content-language']).toBe('ar');
    expect(result.frames[0]?.data.responseLocale).toBe('ar');
    const errorFrame = result.frames.find((frame) => frame.event === 'error');
    expect(errorFrame).toBeDefined();
    expect(errorFrame!.data).toMatchObject({
      code: 'provider_transport',
      messageKey: 'chat.errors.generationFailed',
    });
    expect(errorFrame!.data.message).toBe(
      DICTIONARIES.ar.chat.errors.generationFailed,
    );
    const assistant = await ChatMessage.findOne({ accountId: user.id, role: 'assistant' });
    expect(assistant).toMatchObject({ status: 'error', responseLocale: 'ar' });
  });

  it('maps an unexpected provider failure to the generic stream error code', async () => {
    const user = await seedUser('chat-plain-error@x.co');
    setChatAiProvider({
      async *streamChat() {
        yield { type: 'text_delta' as const, text: 'Partial' };
        throw new Error('unexpected provider failure');
      },
    });
    const conversation = await createConversationFor(user);

    const result = await streamMessage(user, conversation.id, 'hello');

    const errorFrame = result.frames.find((frame) => frame.event === 'error');
    expect(errorFrame?.data.code).toBe('chat_stream_failed');
    expect(errorFrame?.data.message).toBe(
      DICTIONARIES.en.chat.errors.generationFailed,
    );
  });

  it('persists an aborted partial + an ai_usage_events attempt row when the socket dies', async () => {
    const user = await seedUser('chat-abort@x.co');
    const persistAttempts = vi.fn(async (_batch: AiAttemptBatch) => {});
    const adapter: AiSdkProviderAdapter = {
      provider: 'glm',
      model: 'glm-model',
      languageModel: {} as AiSdkProviderAdapter['languageModel'],
      inputCostMicrosPerMillion: 10,
      outputCostMicrosPerMillion: 20,
    };
    const call: AiChatSdkCall = (input) =>
      (async function* (): AsyncGenerator<RawChatStreamPart> {
        for (let i = 0; i < 50; i += 1) {
          if (input.signal.aborted) {
            throw new Error('socket gone');
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
          yield { type: 'text-delta', text: `part${i} ` };
        }
      })();
    setChatAiProvider(
      createAiSdkChatProvider({
        adapters: [adapter],
        maxAttempts: 1,
        totalTimeoutMs: 60_000,
        telemetryEnabled: false,
        call,
        persistAttempts,
      }),
    );
    const conversation = await createConversationFor(user);

    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const payload = JSON.stringify({ text: 'stream then die' });
      await new Promise<void>((resolve, reject) => {
        const clientRequest = http.request(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: `/api/chat/conversations/${conversation.id}/messages`,
            headers: {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(payload),
              cookie: user.cookie,
              'x-lang': 'fr',
            },
          },
          (response) => {
            let sawDelta = false;
            response.on('data', (chunk: Buffer) => {
              if (!sawDelta && chunk.toString('utf8').includes('event: delta')) {
                sawDelta = true;
                clientRequest.destroy();
                resolve();
              }
            });
            response.on('error', () => {});
          },
        );
        clientRequest.on('error', () => {});
        clientRequest.setTimeout(10_000, () => reject(new Error('no delta seen')));
        clientRequest.write(payload);
        clientRequest.end();
      });

      // Wait for the server-side finally paths to persist.
      const deadline = Date.now() + 10_000;
      let assistant = null;
      while (Date.now() < deadline) {
        assistant = await ChatMessage.findOne({
          accountId: user.id,
          role: 'assistant',
        });
        if (assistant) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(assistant).not.toBeNull();
      expect(assistant).toMatchObject({ status: 'aborted', responseLocale: 'fr' });
      const textPart = (assistant!.parts as Array<{ type: string; text?: string }>).find(
        (part) => part.type === 'text',
      );
      expect(textPart?.text).toContain('part0');
      // The runtime persisted the estimated-cost attempt for the cut stream.
      expect(persistAttempts).toHaveBeenCalledTimes(1);
      expect(persistAttempts.mock.calls[0]![0].attempts[0]).toMatchObject({
        errorCode: 'request_cancelled',
        costSource: 'estimated',
      });
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it('enforces the named chat rate bucket', async () => {
    (env as { RATE_LIMIT_CHAT_MAX: number }).RATE_LIMIT_CHAT_MAX = 2;
    const limitedApp = createApp();
    try {
      const user = await signupVerifiedUser(limitedApp, { email: 'chat-429@x.co' });
      await request(limitedApp)
        .get('/api/chat/conversations')
        .set('Cookie', user.cookie)
        .expect(200);
      await request(limitedApp)
        .get('/api/chat/conversations')
        .set('Cookie', user.cookie)
        .expect(200);
      await request(limitedApp)
        .get('/api/chat/conversations')
        .set('Cookie', user.cookie)
        .expect(429);
    } finally {
      (env as { RATE_LIMIT_CHAT_MAX: number }).RATE_LIMIT_CHAT_MAX = 20;
    }
  });
});
