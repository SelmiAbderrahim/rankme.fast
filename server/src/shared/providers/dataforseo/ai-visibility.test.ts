/**
 * DataForSEO AI Optimization adapter tests (prompt 28).
 *
 * Layered like the other DataForSEO adapters:
 *   1. providerContractTests over each of the three operations — success /
 *      timeout / malformed / quota, from recorded fixtures.
 *   2. Behavioural tests: target normalization, per-platform fan-out,
 *      per-(prompt × model) fan-out for LLM Responses, keyword-volume
 *      dedup + insufficient-data null-through, empty-result normalization,
 *      unknown-status guards.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerContractTests } from '../../testing/fixtures/contract.js';
import { vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import { VendorMalformedError } from '../errors.js';
import {
  AI_MENTION_PLATFORMS,
  AI_VISIBILITY_MAX_BATCH,
  createDataForSeoAiVisibilityProvider,
  extractAnswerText,
  extractCitations,
  LLM_RESPONSES_ENGINE_SEGMENTS,
  normalizeAiVisibilityTarget,
  type DataForSeoAiVisibilityProviderConfig,
} from './ai-visibility.js';

const FIXTURES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'testing',
  'fixtures',
  'dataforseo-ai-visibility',
);

function readFixture(operation: string, kase: string): JsonBodyType {
  return JSON.parse(
    readFileSync(join(FIXTURES_ROOT, operation, `${kase}.json`), 'utf8'),
  ) as JsonBodyType;
}

const FROZEN_NOW = new Date('2026-07-11T00:00:00.000Z');

const cfg: DataForSeoAiVisibilityProviderConfig = {
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
  now: () => FROZEN_NOW,
};

const provider = createDataForSeoAiVisibilityProvider(cfg);

// ---------------------------------------------------------------------------
// Provider contract — one per operation
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'DataForSeoAiVisibilityProvider.checkMentions',
  fixtureProvider: 'dataforseo-ai-visibility',
  fixtureOperation: 'mentions',
  makeCall: () =>
    provider.checkMentions({
      domain: 'example.com',
      prompts: ['best seo audit tool'],
    }),
  assertSuccess: (rows) => {
    expect(rows).toHaveLength(AI_MENTION_PLATFORMS.length);
    // Every row is for the one prompt we passed in.
    for (const row of rows) {
      expect(row.prompt).toBe('best seo audit tool');
      expect(row.mentioned).toBe(true);
      expect(row.citedUrl).toBe('https://example.com/audit-report');
      expect(row.checkedAt).toEqual(FROZEN_NOW);
    }
    const seenModels = new Set(rows.map((r) => r.model));
    expect(seenModels.size).toBe(AI_MENTION_PLATFORMS.length);
  },
});

providerContractTests({
  title: 'DataForSeoAiVisibilityProvider.getAnswers',
  fixtureProvider: 'dataforseo-ai-visibility',
  fixtureOperation: 'responses',
  makeCall: () =>
    provider.getAnswers({
      prompts: ['best seo audit tool'],
      models: ['chatgpt'],
    }),
  assertSuccess: (rows) => {
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error('expected row');
    expect(row.prompt).toBe('best seo audit tool');
    expect(row.model).toBe('chatgpt');
    expect(row.answer).toContain('example.com');
    expect(row.citations).toEqual([
      'https://example.com/audit-report',
      'https://review.example.net/seo-tools-2026',
    ]);
    expect(row.checkedAt).toEqual(FROZEN_NOW);
  },
});

providerContractTests({
  title: 'DataForSeoAiVisibilityProvider.getAiKeywordVolume',
  fixtureProvider: 'dataforseo-ai-visibility',
  fixtureOperation: 'keyword-volume',
  makeCall: () =>
    provider.getAiKeywordVolume(
      ['best seo audit tool', 'how to fix crawl errors', 'unknown-keyword'],
      2840,
      'en',
    ),
  assertSuccess: (rows) => {
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ keyword: 'best seo audit tool', aiSearchVolume: 1400 });
    expect(rows[1]).toEqual({ keyword: 'how to fix crawl errors', aiSearchVolume: null });
    // Absent from vendor response → aiSearchVolume: null (not dropped).
    expect(rows[2]).toEqual({ keyword: 'unknown-keyword', aiSearchVolume: null });
  },
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('normalizeAiVisibilityTarget', () => {
  it('lowercases and strips scheme + trailing slash', () => {
    expect(normalizeAiVisibilityTarget('HTTPS://Example.COM/')).toBe('example.com');
    expect(normalizeAiVisibilityTarget('http://example.com')).toBe('example.com');
  });
  it('trims whitespace on bare domain', () => {
    expect(normalizeAiVisibilityTarget('  example.com  ')).toBe('example.com');
  });
});

describe('extractAnswerText', () => {
  it('joins sections[].text when message.sections is present', () => {
    expect(
      extractAnswerText(
        {
          message: {
            sections: [
              { type: 'text', text: 'Hello' },
              { type: 'text', text: 'world' },
            ],
          },
        },
        null,
      ),
    ).toBe('Hello\n\nworld');
  });
  it('falls back to message.content string', () => {
    expect(
      extractAnswerText({ message: { content: 'flat content' } }, null),
    ).toBe('flat content');
  });
  it('falls back to message.message string (Perplexity-style)', () => {
    expect(
      extractAnswerText({ message: { message: 'perplexity payload' } }, null),
    ).toBe('perplexity payload');
  });
  it('falls back to item.response when item.message empty', () => {
    expect(
      extractAnswerText(
        { response: { content: 'from response' }, message: null },
        null,
      ),
    ).toBe('from response');
  });
  it('falls back to outer envelope message when the item has nothing', () => {
    expect(
      extractAnswerText(
        { message: null },
        { content: 'outer content' },
      ),
    ).toBe('outer content');
  });
  it('returns empty string when nothing has text', () => {
    expect(extractAnswerText({ message: null }, null)).toBe('');
    expect(extractAnswerText({ message: { sections: [] } }, null)).toBe('');
    expect(extractAnswerText({ message: { sections: [{ text: '' }] } }, null)).toBe('');
    // Section with a non-string `text` slot (null / missing) — covers the
    // ternary's else branch on the sections.map guard.
    expect(extractAnswerText({ message: { sections: [{ text: null }] } }, null)).toBe('');
    expect(
      extractAnswerText({ message: { sections: [{ type: 'text' }] } }, null),
    ).toBe('');
  });
});

describe('extractCitations', () => {
  it('reads urls from item.annotations', () => {
    expect(
      extractCitations({ annotations: [{ url: 'a' }, { url: 'b' }] }, null),
    ).toEqual(['a', 'b']);
  });
  it('reads urls from the outer envelope annotations too', () => {
    expect(
      extractCitations({ annotations: [{ url: 'a' }] }, [{ url: 'z' }]),
    ).toEqual(['a', 'z']);
  });
  it('skips missing/non-string urls', () => {
    expect(
      extractCitations({ annotations: [{ url: null }, { title: 'no url' }] }, null),
    ).toEqual([]);
  });
  it('returns empty array when annotations are absent', () => {
    expect(extractCitations({}, null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// checkMentions — end-to-end behaviour
// ---------------------------------------------------------------------------

describe('DataForSeoAiVisibilityProvider — checkMentions', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('fans out one call per platform per prompt with normalized target', async () => {
    const capturedBodies: unknown[] = [];
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBodies.push(await request.json());
        return HttpResponse.json(readFixture('mentions', 'success') as JsonBodyType);
      }),
    );
    const rows = await provider.checkMentions({
      domain: 'HTTPS://Example.COM/',
      prompts: ['best seo audit tool', 'best rank tracker'],
    });
    expect(capturedBodies).toHaveLength(AI_MENTION_PLATFORMS.length * 2);
    expect(rows).toHaveLength(AI_MENTION_PLATFORMS.length * 2);
    for (const body of capturedBodies) {
      const first = (body as Array<Record<string, unknown>>)[0];
      expect(first?.language_code).toBe('en');
      expect(first?.location_code).toBe(2840);
      expect(typeof first?.platform).toBe('string');
      expect(first?.target).toEqual([
        { keyword: expect.any(String) as unknown as string },
      ]);
    }
  });

  it('normalizes an empty result to mentioned=false rows without citedUrl', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json(readFixture('mentions', 'empty') as JsonBodyType),
      ),
    );
    const rows = await provider.checkMentions({
      domain: 'example.com',
      prompts: ['ghost prompt'],
    });
    expect(rows).toHaveLength(AI_MENTION_PLATFORMS.length);
    for (const row of rows) {
      expect(row.mentioned).toBe(false);
      expect(row.citedUrl).toBeUndefined();
    }
  });

  it('omits citedUrl when the vendor item has no url', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.1,
              result: [
                {
                  domain: 'example.com',
                  keyword: 'best seo audit tool',
                  platform: 'google',
                  ai_search_volume: 1400,
                  position: 2,
                },
              ],
            },
          ],
        }),
      ),
    );
    const rows = await provider.checkMentions({
      domain: 'example.com',
      prompts: ['best seo audit tool'],
    });
    for (const row of rows) {
      expect(row.mentioned).toBe(true);
      expect(row.citedUrl).toBeUndefined();
    }
  });

  it('falls back to source_url when url is absent', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.1,
              result: [
                {
                  domain: 'example.com',
                  keyword: 'seo',
                  platform: 'google',
                  source_url: 'https://example.com/from-source',
                },
              ],
            },
          ],
        }),
      ),
    );
    const rows = await provider.checkMentions({
      domain: 'example.com',
      prompts: ['seo'],
    });
    for (const row of rows) {
      expect(row.citedUrl).toBe('https://example.com/from-source');
    }
  });

  it('handles a null result field defensively', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.1,
              result: null,
            },
          ],
        }),
      ),
    );
    const rows = await provider.checkMentions({
      domain: 'example.com',
      prompts: ['seo'],
    });
    expect(rows).toHaveLength(AI_MENTION_PLATFORMS.length);
    for (const row of rows) expect(row.mentioned).toBe(false);
  });

  it('treats an unknown task status as malformed', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'Task In Queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(
      provider.checkMentions({ domain: 'example.com', prompts: ['seo'] }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

// ---------------------------------------------------------------------------
// getAnswers — end-to-end behaviour
// ---------------------------------------------------------------------------

describe('DataForSeoAiVisibilityProvider — getAnswers', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('fans out one call per (prompt × model) and maps engines to vendor URL segments', async () => {
    const capturedPaths: string[] = [];
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', ({ request }) => {
        capturedPaths.push(new URL(request.url).pathname);
        return HttpResponse.json(readFixture('responses', 'success') as JsonBodyType);
      }),
    );
    const rows = await provider.getAnswers({
      prompts: ['best seo audit tool'],
      models: ['chatgpt', 'gemini', 'claude', 'perplexity'],
    });
    expect(rows).toHaveLength(4);
    expect(capturedPaths).toEqual([
      '/v3/ai_optimization/chat_gpt/llm_responses/live',
      '/v3/ai_optimization/gemini/llm_responses/live',
      '/v3/ai_optimization/claude/llm_responses/live',
      '/v3/ai_optimization/perplexity/llm_responses/live',
    ]);
  });

  it('rejects with VendorMalformedError for an unknown engine id', async () => {
    // No mock needed — the guard fires before an HTTP call.
    await expect(
      provider.getAnswers({ prompts: ['x'], models: ['bogus-engine'] }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('caps model output via max_output_tokens (cost bound in the request body)', async () => {
    const capturedBodies: unknown[] = [];
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBodies.push(await request.json());
        return HttpResponse.json(readFixture('responses', 'success') as JsonBodyType);
      }),
    );
    await provider.getAnswers({ prompts: ['best seo audit tool'], models: ['chatgpt'] });
    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0]).toEqual([
      {
        user_prompt: 'best seo audit tool',
        message_chain: [{ role: 'user', message: 'best seo audit tool' }],
        web_search: true,
        // The output-token cap bounds vendor spend on every request.
        max_output_tokens: 1024,
      },
    ]);
  });

  it('accepts both `chatgpt` and vendor-style `chat_gpt` engine ids', () => {
    expect(LLM_RESPONSES_ENGINE_SEGMENTS.chatgpt).toBe('chat_gpt');
    expect(LLM_RESPONSES_ENGINE_SEGMENTS.chat_gpt).toBe('chat_gpt');
  });

  it('normalizes an empty-items result to a single per-model row', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json(readFixture('responses', 'empty') as JsonBodyType),
      ),
    );
    const rows = await provider.getAnswers({
      prompts: ['ghost prompt'],
      models: ['chatgpt'],
    });
    expect(rows).toEqual([
      {
        prompt: 'ghost prompt',
        model: 'chatgpt',
        answer: '',
        citations: [],
        checkedAt: FROZEN_NOW,
      },
    ]);
  });

  it('normalizes a null result envelope to a single empty per-model row', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.0006,
              result: null,
            },
          ],
        }),
      ),
    );
    const rows = await provider.getAnswers({ prompts: ['x'], models: ['claude'] });
    expect(rows).toEqual([
      {
        prompt: 'x',
        model: 'claude',
        answer: '',
        citations: [],
        checkedAt: FROZEN_NOW,
      },
    ]);
  });

  it('reads a top-level message on the outer result when items is empty (Perplexity-ish shape)', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.0006,
              result: [
                {
                  items: [],
                  message: { role: 'ai', content: 'top-level answer' },
                  annotations: [{ url: 'https://cited.example/' }],
                },
              ],
            },
          ],
        }),
      ),
    );
    const rows = await provider.getAnswers({
      prompts: ['top-level'],
      models: ['perplexity'],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      answer: 'top-level answer',
      citations: ['https://cited.example/'],
    });
  });

  it('treats an unknown task status as malformed', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'Task In Queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(
      provider.getAnswers({ prompts: ['x'], models: ['chatgpt'] }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

// ---------------------------------------------------------------------------
// getAiKeywordVolume — end-to-end behaviour
// ---------------------------------------------------------------------------

describe('DataForSeoAiVisibilityProvider — getAiKeywordVolume', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('dedupes, lowercases, and clamps to the vendor batch ceiling', async () => {
    let captured: Record<string, unknown> = {};
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        const arr = (await request.json()) as Record<string, unknown>[];
        captured = arr[0] ?? {};
        return HttpResponse.json(readFixture('keyword-volume', 'success') as JsonBodyType);
      }),
    );
    const many = Array.from({ length: AI_VISIBILITY_MAX_BATCH + 5 }, (_, i) => `kw ${i}`);
    await provider.getAiKeywordVolume(
      [' Best SEO Audit Tool ', 'best seo audit tool', ...many],
      2840,
      'EN',
    );
    expect(captured.location_code).toBe(2840);
    expect(captured.language_code).toBe('en');
    const kws = captured.keywords as string[];
    // First is the trimmed lowercased canonical form of the duplicate.
    expect(kws[0]).toBe('best seo audit tool');
    // Ceiling honoured.
    expect(kws.length).toBe(AI_VISIBILITY_MAX_BATCH);
  });

  it('returns [] when every input is empty/whitespace', async () => {
    // No mock needed — the guard skips the HTTP call.
    await expect(
      provider.getAiKeywordVolume(['', '   ', ''], 2840, 'en'),
    ).resolves.toEqual([]);
  });

  it('handles null result and an empty items list', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.01,
              result: null,
            },
          ],
        }),
      ),
    );
    const rows = await provider.getAiKeywordVolume(['seo'], 2840, 'en');
    expect(rows).toEqual([{ keyword: 'seo', aiSearchVolume: null }]);
  });

  it('handles a null-items result envelope', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.01,
              result: [{ items: null }],
            },
          ],
        }),
      ),
    );
    const rows = await provider.getAiKeywordVolume(['seo'], 2840, 'en');
    expect(rows).toEqual([{ keyword: 'seo', aiSearchVolume: null }]);
  });

  it('treats an unknown task status as malformed', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'Task In Queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(
      provider.getAiKeywordVolume(['seo'], 2840, 'en'),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('defaults now() to Date.now when the config omits it', async () => {
    const noClock = createDataForSeoAiVisibilityProvider({
      login: 'l',
      password: 'p',
      baseUrl: 'https://dataforseo.mock/v3',
      timeoutMs: 60,
      maxRetries: 0,
      backoffBaseMs: 1,
      random: () => 0,
    });
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json(readFixture('mentions', 'success') as JsonBodyType),
      ),
    );
    const rows = await noClock.checkMentions({
      domain: 'example.com',
      prompts: ['x'],
    });
    for (const row of rows) {
      expect(row.checkedAt).toBeInstanceOf(Date);
    }
  });
});
