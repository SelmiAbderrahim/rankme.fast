import { describe, expect, it, vi } from 'vitest';
import {
  VendorAuthError,
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
  VendorUnavailableError,
} from '../errors.js';
import {
  createAnthropicSummaryProvider,
  parseGeneratedPrompts,
  DEFAULT_SUMMARY_MODEL,
} from './anthropic.js';
import type { GeneratePromptsInput } from './types.js';
import type { SupportedLocale } from '../../i18n/index.js';

interface FetchCall {
  input: unknown;
  init?: RequestInit;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeFetch(response: Response | Error): {
  fn: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fn: typeof fetch = async (input, init) => {
    calls.push({ input, init: init as RequestInit });
    if (response instanceof Error) throw response;
    return response;
  };
  return { fn, calls };
}

const FINDINGS = [
  {
    ruleId: 'title-missing-or-weak',
    title: 'Page titles missing or weak',
    why: 'Titles drive clicks.',
    fix: 'Write a unique title per page.',
    affectedCount: 3,
  },
  {
    ruleId: 'broken-internal-links',
    title: 'Broken internal links',
    why: 'Broken links waste crawl budget.',
    fix: 'Repair the URLs listed.',
    affectedCount: 0,
  },
];

function baseInput() {
  return {
    findings: FINDINGS,
    locale: 'en' as SupportedLocale,
    siteDomain: 'example.com',
  };
}

describe('createAnthropicSummaryProvider', () => {
  it('sends the request and returns text on stop_reason=end_turn', async () => {
    const { fn, calls } = makeFetch(
      jsonResponse({
        content: [{ type: 'text', text: 'Fix titles first.' }],
        stop_reason: 'end_turn',
      }),
    );
    const provider = createAnthropicSummaryProvider({
      apiKey: 'sk-test',
      fetchFn: fn,
    });
    const result = await provider.summarize(baseInput());
    expect(result).toEqual({
      summary: 'Fix titles first.',
      truncated: false,
      model: DEFAULT_SUMMARY_MODEL,
    });
    const call = calls[0];
    expect(call).toBeDefined();
    expect(String(call?.input)).toBe('https://api.anthropic.com/v1/messages');
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(call?.init?.body)) as {
      model: string;
      max_tokens: number;
      system: string;
      messages: { content: string }[];
    };
    expect(body.model).toBe(DEFAULT_SUMMARY_MODEL);
    expect(body.max_tokens).toBe(1024);
    expect(body.system).toContain('English');
    expect(body.messages[0]?.content).toContain('example.com');
    expect(body.messages[0]?.content).toContain('title-missing-or-weak');
  });

  it('accepts a custom model override', async () => {
    const { fn, calls } = makeFetch(
      jsonResponse({ content: [{ type: 'text', text: 'ok' }] }),
    );
    const provider = createAnthropicSummaryProvider({
      apiKey: 'k',
      model: 'claude-opus-4-8',
      fetchFn: fn,
    });
    const result = await provider.summarize(baseInput());
    expect(result.model).toBe('claude-opus-4-8');
    const body = JSON.parse(String(calls[0]?.init?.body)) as { model: string };
    expect(body.model).toBe('claude-opus-4-8');
  });

  it('falls back to the default model when override is whitespace', async () => {
    const { fn } = makeFetch(
      jsonResponse({ content: [{ type: 'text', text: 'ok' }] }),
    );
    const provider = createAnthropicSummaryProvider({
      apiKey: 'k',
      model: '   ',
      fetchFn: fn,
    });
    const result = await provider.summarize(baseInput());
    expect(result.model).toBe(DEFAULT_SUMMARY_MODEL);
  });

  it.each([
    ['en', 'English'],
    ['ar', 'Arabic'],
    ['fr', 'French'],
    ['de', 'German'],
    ['es', 'Spanish'],
    ['ru', 'Russian'],
    ['zh', 'Chinese (Simplified)'],
  ] as const)('passes locale %s through to system prompt (%s)', async (locale, name) => {
    const { fn, calls } = makeFetch(
      jsonResponse({ content: [{ type: 'text', text: 'x' }] }),
    );
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await provider.summarize({ ...baseInput(), locale });
    const body = JSON.parse(String(calls[0]?.init?.body)) as { system: string };
    expect(body.system).toContain(name);
  });

  it('maps an unknown locale to itself as a fallback label', async () => {
    const { fn, calls } = makeFetch(
      jsonResponse({ content: [{ type: 'text', text: 'x' }] }),
    );
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await provider.summarize({
      ...baseInput(),
      locale: 'xx' as unknown as SupportedLocale,
    });
    const body = JSON.parse(String(calls[0]?.init?.body)) as { system: string };
    expect(body.system).toContain('xx');
  });

  it('marks truncated when stop_reason=max_tokens', async () => {
    const { fn } = makeFetch(
      jsonResponse({
        content: [{ type: 'text', text: 'shortened text' }],
        stop_reason: 'max_tokens',
      }),
    );
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    const result = await provider.summarize(baseInput());
    expect(result.truncated).toBe(true);
  });

  it('rejects with VendorUnavailableError on stop_reason=refusal', async () => {
    const { fn } = makeFetch(
      jsonResponse({
        content: [{ type: 'text', text: 'x' }],
        stop_reason: 'refusal',
      }),
    );
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await expect(provider.summarize(baseInput())).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
  });

  it('rejects with VendorUnavailableError when response has no text', async () => {
    const { fn } = makeFetch(
      jsonResponse({ content: [{ type: 'image', text: 'x' }] }),
    );
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await expect(provider.summarize(baseInput())).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
  });

  it('rejects with VendorUnavailableError when the body has no content field', async () => {
    const { fn } = makeFetch(jsonResponse({ stop_reason: 'end_turn' }));
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await expect(provider.summarize(baseInput())).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
  });

  it('defaults to the global fetch when fetchFn is omitted', async () => {
    // Stub global fetch so we don't actually hit the network; we only care
    // that the branch `opts.fetchFn ?? fetch` selects the global.
    const orig = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return jsonResponse({ content: [{ type: 'text', text: 'ok' }] });
    }) as typeof fetch;
    try {
      const provider = createAnthropicSummaryProvider({ apiKey: 'k' });
      const result = await provider.summarize(baseInput());
      expect(result.summary).toBe('ok');
      expect(called).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('rejects with VendorQuotaError on 429 (with retry-after-ms header)', async () => {
    const { fn } = makeFetch(
      new Response(JSON.stringify({ error: 'rate' }), {
        status: 429,
        headers: { 'retry-after-ms': '2500' },
      }),
    );
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    try {
      await provider.summarize(baseInput());
      throw new Error('unreachable');
    } catch (err) {
      expect(err).toBeInstanceOf(VendorQuotaError);
      expect((err as VendorQuotaError).retryAfterSeconds).toBe(3);
    }
  });

  it('falls back to retry-after seconds header on 429', async () => {
    const { fn } = makeFetch(
      new Response('', { status: 429, headers: { 'retry-after': '7' } }),
    );
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    try {
      await provider.summarize(baseInput());
      throw new Error('unreachable');
    } catch (err) {
      expect(err).toBeInstanceOf(VendorQuotaError);
      expect((err as VendorQuotaError).retryAfterSeconds).toBe(7);
    }
  });

  it('yields no retryAfterSeconds when 429 lacks both headers', async () => {
    const { fn } = makeFetch(new Response('', { status: 429 }));
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    try {
      await provider.summarize(baseInput());
      throw new Error('unreachable');
    } catch (err) {
      expect(err).toBeInstanceOf(VendorQuotaError);
      expect((err as VendorQuotaError).retryAfterSeconds).toBeUndefined();
    }
  });

  it('ignores malformed retry-after headers on 429', async () => {
    const { fn } = makeFetch(
      new Response('', {
        status: 429,
        headers: { 'retry-after-ms': 'nope', 'retry-after': 'later' },
      }),
    );
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    try {
      await provider.summarize(baseInput());
      throw new Error('unreachable');
    } catch (err) {
      expect((err as VendorQuotaError).retryAfterSeconds).toBeUndefined();
    }
  });

  it.each([401, 403])('rejects with VendorAuthError on %s', async (status) => {
    const { fn } = makeFetch(new Response('unauth', { status }));
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await expect(provider.summarize(baseInput())).rejects.toBeInstanceOf(
      VendorAuthError,
    );
  });

  it('rejects with VendorUnavailableError on 5xx', async () => {
    const { fn } = makeFetch(new Response('boom', { status: 502 }));
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await expect(provider.summarize(baseInput())).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
  });

  it('rejects with VendorMalformedError on 4xx other than 401/403/408/429 (400)', async () => {
    const { fn } = makeFetch(new Response('bad', { status: 400 }));
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    const rejection = await provider.summarize(baseInput()).catch((err) => err);
    expect(rejection).toBeInstanceOf(VendorMalformedError);
    expect((rejection as VendorMalformedError).retryable).toBe(false);
  });

  it('rejects with VendorTimeoutError on HTTP 408', async () => {
    const { fn } = makeFetch(new Response('req-timeout', { status: 408 }));
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await expect(provider.summarize(baseInput())).rejects.toBeInstanceOf(
      VendorTimeoutError,
    );
  });

  it('rejects with VendorMalformedError on non-JSON 200 body', async () => {
    const { fn } = makeFetch(
      new Response('not-json{', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await expect(provider.summarize(baseInput())).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('rejects with VendorMalformedError on a schema-violating 200 body', async () => {
    // `content` present but not an array — zod safeParse rejects.
    const { fn } = makeFetch(jsonResponse({ content: 'not-an-array' }));
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await expect(provider.summarize(baseInput())).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('surfaces VendorTimeoutError when the vendor stalls mid-body', async () => {
    const fn: typeof fetch = async (_input, init) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"content"'));
          if (signal) {
            const onAbort = () => controller.error(new DOMException('aborted', 'AbortError'));
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort);
          }
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    vi.useFakeTimers();
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn, timeoutMs: 40 });
    const assertion = expect(provider.summarize(baseInput())).rejects.toBeInstanceOf(VendorTimeoutError);
    await vi.advanceTimersByTimeAsync(40);
    await assertion;
    vi.useRealTimers();
  });

  it('rejects with VendorTimeoutError when AbortError is raised', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    const { fn } = makeFetch(err);
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await expect(provider.summarize(baseInput())).rejects.toBeInstanceOf(
      VendorTimeoutError,
    );
  });

  it('rejects with VendorUnavailableError on generic network error', async () => {
    const { fn } = makeFetch(new Error('boom'));
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await expect(provider.summarize(baseInput())).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
  });

  it('caps prompt findings at 25 to protect context size', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      ruleId: `r-${i}`,
      title: `title ${i}`,
      why: 'w',
      fix: 'f',
      affectedCount: i,
    }));
    const { fn, calls } = makeFetch(
      jsonResponse({ content: [{ type: 'text', text: 'ok' }] }),
    );
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await provider.summarize({ ...baseInput(), findings: many });
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      messages: { content: string }[];
    };
    const content = body.messages[0]?.content ?? '';
    expect(content).toContain('r-24');
    expect(content).not.toContain('r-25');
  });

  it('empties call abort timer after success', async () => {
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    const { fn } = makeFetch(
      jsonResponse({ content: [{ type: 'text', text: 'ok' }] }),
    );
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await provider.summarize(baseInput());
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

function generateInput(overrides: Partial<GeneratePromptsInput> = {}): GeneratePromptsInput {
  return {
    siteDomain: 'example.com',
    locale: 'en',
    count: 5,
    seeds: {
      keywords: ['seo audit', 'rank tracker'],
      titles: ['website uptime monitoring'],
      competitors: ['rival.example'],
      gscQueries: ['how do i improve my ranking'],
    },
    ...overrides,
  };
}

/** Minimal well-formed taxonomy row for the model-reply fixtures. */
function row(promptText: string, evidenceRef = 'seo audit') {
  return {
    promptText,
    funnelStage: 'consideration',
    promptType: 'problemFirst',
    intent: 'commercial',
    branded: false,
    evidenceSource: 'keyword',
    evidenceRef,
  };
}

describe('generatePrompts', () => {
  it('requests buyer questions and parses the JSON array reply', async () => {
    const { fn, calls } = makeFetch(
      jsonResponse({
        content: [
          {
            type: 'text',
            text: JSON.stringify([row('best seo audit tool?'), row('is rank tracking worth it?')]),
          },
        ],
        stop_reason: 'end_turn',
      }),
    );
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    const result = await provider.generatePrompts(generateInput());
    expect(result).toEqual({
      prompts: [row('best seo audit tool?'), row('is rank tracking worth it?')],
      model: DEFAULT_SUMMARY_MODEL,
    });
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      system: string;
      messages: { content: string }[];
    };
    expect(body.system).toContain('JSON array of objects');
    expect(body.system).toContain('English');
    const content = body.messages[0]?.content ?? '';
    expect(content).toContain('Site: example.com');
    expect(content).toContain('seo audit; rank tracker');
    expect(content).toContain('website uptime monitoring');
    expect(content).toContain('rival.example');
    expect(content).toContain('Return exactly 5 questions');
    expect(content).toContain('how do i improve my ranking');
  });

  it('marks empty seed groups as (none) and clamps the requested count', async () => {
    const { fn, calls } = makeFetch(
      jsonResponse({ content: [{ type: 'text', text: JSON.stringify([row('q')]) }] }),
    );
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await provider.generatePrompts(
      generateInput({
        count: 99,
        seeds: { keywords: [], titles: [], competitors: [], gscQueries: [] },
      }),
    );
    const content =
      (JSON.parse(String(calls[0]?.init?.body)) as { messages: { content: string }[] })
        .messages[0]?.content ?? '';
    expect(content).toContain('Seed keywords: (none)');
    expect(content).toContain('Return exactly 10 questions');
    expect(content).toContain('Search Console queries: (none)');
  });

  it('returns an empty prompt list when the model answers with prose instead of JSON', async () => {
    const { fn } = makeFetch(
      jsonResponse({ content: [{ type: 'text', text: 'Here are some ideas you might like.' }] }),
    );
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await expect(provider.generatePrompts(generateInput())).resolves.toEqual({
      prompts: [],
      model: DEFAULT_SUMMARY_MODEL,
    });
  });

  it('propagates transport errors through the shared taxonomy mapping', async () => {
    const { fn } = makeFetch(jsonResponse({ error: 'rate limited' }, { status: 429 }));
    const provider = createAnthropicSummaryProvider({ apiKey: 'k', fetchFn: fn });
    await expect(provider.generatePrompts(generateInput())).rejects.toBeInstanceOf(
      VendorQuotaError,
    );
  });
});

describe('parseGeneratedPrompts', () => {
  it('parses a fenced JSON array embedded in prose', () => {
    expect(
      parseGeneratedPrompts(
        `Sure! \`\`\`json\n${JSON.stringify([row('one question'), row('two question')])}\n\`\`\``,
        5,
      ),
    ).toEqual([row('one question'), row('two question')]);
  });

  it('returns [] when no array brackets exist', () => {
    expect(parseGeneratedPrompts('no array here', 5)).toEqual([]);
  });

  it('returns [] on invalid JSON between brackets', () => {
    expect(parseGeneratedPrompts('[not, valid, json]', 5)).toEqual([]);
  });

  it('returns [] when a row is a bare string instead of a taxonomy object', () => {
    expect(parseGeneratedPrompts('["ok", 42]', 5)).toEqual([]);
  });

  it('returns [] when a row is missing a taxonomy field', () => {
    const { promptType, ...incomplete } = row('missing a field');
    void promptType;
    expect(parseGeneratedPrompts(JSON.stringify([incomplete]), 5)).toEqual([]);
  });

  it('returns [] when a taxonomy field is outside its enum', () => {
    expect(
      parseGeneratedPrompts(JSON.stringify([{ ...row('bad enum'), intent: 'nope' }]), 5),
    ).toEqual([]);
  });

  it('trims, drops empties and case-insensitive duplicates, clamps length, and caps count', () => {
    const long = 'y'.repeat(300);
    expect(
      parseGeneratedPrompts(
        JSON.stringify(
          [' First? ', '', 'first?', long, 'second', 'third', 'fourth'].map((text) =>
            row(text),
          ),
        ),
        3,
      ),
    ).toEqual([
      row('First?'),
      { ...row(long), promptText: long.slice(0, 280) },
      row('second'),
    ]);
  });

  it('never returns more than ten prompts regardless of count', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => row(`question ${i}`));
    expect(parseGeneratedPrompts(JSON.stringify(twelve), 99)).toHaveLength(10);
  });
});
