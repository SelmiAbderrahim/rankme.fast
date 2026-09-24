import { describe, expect, it, vi } from 'vitest';
import type { AiVisibilityProvider } from '../../shared/providers/index.js';
import {
  runCollection,
  UnsupportedPulseError,
  type CollectionPorts,
} from './collection.service.js';

function makeProvider(overrides: Partial<AiVisibilityProvider> = {}): AiVisibilityProvider {
  return {
    checkMentions: vi.fn(async () => []),
    getAnswers: vi.fn(async () => {
      throw new Error('getAnswers must NOT be called by the weekly pulse');
    }),
    getAiKeywordVolume: vi.fn(async () => []),
    ...overrides,
  };
}

function makePorts(overrides: Partial<CollectionPorts> = {}): CollectionPorts {
  return {
    loadSiteMarket: vi.fn(async () => ({ value: { locale: 'en-US' } })),
    loadPromptCohort: vi.fn(async () => ({
      id: 'cohort-1',
      version: 1,
      prompts: ['best crm for smbs'],
    })),
    loadCoverage: vi.fn(async () => ({
      cells: [
        { engine: 'google', surface: 'mentions' as const, supported: true, reason: null },
        {
          engine: 'chat_gpt',
          surface: 'mentions' as const,
          supported: false,
          reason: 'no historical coverage',
        },
      ],
    })),
    loadConfirmedRankDrops: vi.fn(async () => [
      { keyword: 'k1', priorRank: 3, currentRank: 12, confirmedAt: '2026-07-13T00:00:00Z' },
    ]),
    loadTopOpenActions: vi.fn(async () => [
      { actionId: 'a1', verb: 'add', target: 'schema', state: 'open' as const },
    ]),
    loadActionTransitions: vi.fn(async () => [
      { actionId: 'a0', verb: 'add', target: 't', state: 'completed' as const },
    ]),
    loadAudienceDecisions: vi.fn(async () => [{ id: 'd1', acceptedAt: '2026-07-13T00:00:00Z' }]),
    ...overrides,
  };
}

const baseInput = {
  accountId: '000000000000000000000001',
  siteId: '000000000000000000000002',
  siteDomain: 'example.com',
  windowEnd: new Date('2026-07-14T09:00:00Z'),
};

describe('runCollection', () => {
  it('throws UnsupportedPulseError when SiteMarket is missing', async () => {
    const provider = makeProvider();
    const ports = makePorts({ loadSiteMarket: vi.fn(async () => null) });
    await expect(runCollection({ aiVisibility: provider, ports }, baseInput)).rejects.toBeInstanceOf(
      UnsupportedPulseError,
    );
  });

  it('throws UnsupportedPulseError when cohort is missing', async () => {
    const provider = makeProvider();
    const ports = makePorts({ loadPromptCohort: vi.fn(async () => null) });
    await expect(runCollection({ aiVisibility: provider, ports }, baseInput)).rejects.toBeInstanceOf(
      UnsupportedPulseError,
    );
  });

  it('NEVER calls LLM Responses provider', async () => {
    const provider = makeProvider();
    const ports = makePorts();
    await runCollection({ aiVisibility: provider, ports }, baseInput);
    expect(provider.getAnswers).not.toHaveBeenCalled();
  });

  it('NEVER calls the AI keyword volume endpoint', async () => {
    const provider = makeProvider();
    const ports = makePorts();
    await runCollection({ aiVisibility: provider, ports }, baseInput);
    expect(provider.getAiKeywordVolume).not.toHaveBeenCalled();
  });

  it('skips unsupported cells and calls checkMentions for supported ones', async () => {
    const provider = makeProvider({
      checkMentions: vi.fn(async () => [
        {
          prompt: 'best crm for smbs',
          model: 'google',
          mentioned: true,
          citedUrl: 'https://example.com/blog/crm',
          checkedAt: new Date(),
        },
      ]),
    });
    const ports = makePorts();
    const result = await runCollection({ aiVisibility: provider, ports }, baseInput);
    expect(provider.checkMentions).toHaveBeenCalledTimes(1);
    const google = result.cells.find((c) => c.engine === 'google')!;
    const chat = result.cells.find((c) => c.engine === 'chat_gpt')!;
    expect(google.citations).toHaveLength(1);
    expect(google.citations[0]!.host).toBe('example.com');
    expect(google.complete).toBe(true);
    expect(chat.citations).toHaveLength(0);
    expect(chat.complete).toBe(false);
  });

  it('normalizes the provider chatgpt slug onto the stored chat_gpt engine', async () => {
    const provider = makeProvider({
      checkMentions: vi.fn(async () => [
        {
          prompt: 'best crm for smbs',
          model: 'ChatGPT',
          mentioned: true,
          citedUrl: 'https://example.com/blog/chatgpt',
          checkedAt: new Date('2026-07-14T10:00:00.000Z'),
        },
      ]),
    });
    const ports = makePorts({
      loadCoverage: vi.fn(async () => ({
        cells: [
          {
            engine: 'chat_gpt',
            surface: 'mentions' as const,
            supported: true,
            reason: null,
          },
        ],
      })),
    });
    const result = await runCollection({ aiVisibility: provider, ports }, baseInput);
    expect(result.cells[0]).toMatchObject({
      engine: 'chat_gpt',
      complete: true,
      citations: [{ canonicalUrl: 'https://example.com/blog/chatgpt' }],
    });
  });

  it('de-dupes citations per canonical_url', async () => {
    const later = new Date('2026-07-14T11:00:00.000Z');
    const earlier = new Date('2026-07-13T11:00:00.000Z');
    const provider = makeProvider({
      checkMentions: vi.fn(async () => [
        {
          prompt: 'best crm for smbs',
          model: 'google',
          mentioned: true,
          citedUrl: 'https://example.com/blog/crm',
          checkedAt: later,
        },
        {
          prompt: 'best crm for smbs',
          model: 'google',
          mentioned: true,
          citedUrl: 'https://example.com/blog/crm',
          checkedAt: earlier,
        },
        {
          prompt: 'best crm for smbs',
          model: 'google',
          mentioned: true,
          citedUrl: 'https://example.com/blog/crm',
          checkedAt: later,
        },
      ]),
    });
    const ports = makePorts();
    const result = await runCollection({ aiVisibility: provider, ports }, baseInput);
    const google = result.cells.find((c) => c.engine === 'google')!;
    expect(google.citations).toHaveLength(1);
    expect(google.citations[0]).toMatchObject({
      mentionCount: 3,
      firstSeenAt: earlier,
    });
  });

  it('skips non-mentioned rows and rows with no citedUrl', async () => {
    const provider = makeProvider({
      checkMentions: vi.fn(async () => [
        {
          prompt: 'p',
          model: 'google',
          mentioned: false,
          checkedAt: new Date(),
        },
        {
          prompt: 'p',
          model: 'google',
          mentioned: true,
          checkedAt: new Date(),
        },
      ]),
    });
    const ports = makePorts();
    const result = await runCollection({ aiVisibility: provider, ports }, baseInput);
    const google = result.cells.find((c) => c.engine === 'google')!;
    expect(google.citations).toHaveLength(0);
  });

  it('classifies provider errors into cell.error', async () => {
    const providerTimeout = makeProvider({
      checkMentions: vi.fn(async () => {
        throw Object.assign(new Error('boom'), { name: 'VendorTimeoutError' });
      }),
    });
    const result = await runCollection(
      { aiVisibility: providerTimeout, ports: makePorts() },
      baseInput,
    );
    expect(result.cells.find((c) => c.engine === 'google')?.error).toBe('timeout');

    for (const [name, kind] of [
      ['VendorQuotaError', 'quota'],
      ['VendorMalformedError', 'malformed'],
      ['VendorAuthError', 'auth'],
      ['SomeOtherError', 'unavailable'],
    ] as const) {
      const provider = makeProvider({
        checkMentions: vi.fn(async () => {
          throw Object.assign(new Error('boom'), { name });
        }),
      });
      const r = await runCollection({ aiVisibility: provider, ports: makePorts() }, baseInput);
      expect(r.cells.find((c) => c.engine === 'google')?.error).toBe(kind);
    }
  });

  it('surface="citations" is treated as unsupported archival slot (partial+no error)', async () => {
    const provider = makeProvider();
    const ports = makePorts({
      loadCoverage: vi.fn(async () => ({
        cells: [
          {
            engine: 'google',
            surface: 'citations' as const,
            supported: true,
            reason: null,
          },
        ],
      })),
    });
    const result = await runCollection({ aiVisibility: provider, ports }, baseInput);
    expect(result.cells[0]!.complete).toBe(false);
    expect(result.cells[0]!.error).toBeNull();
    expect(provider.checkMentions).not.toHaveBeenCalled();
  });

  it('classifies a nameless provider rejection as `unavailable`', async () => {
    // A vendor adapter that rejects with a bare object (no `name`) must not
    // crash the cell classifier — it degrades to the retryable `unavailable`
    // bucket rather than throwing out of the whole collection.
    const provider = makeProvider({
      checkMentions: vi.fn(async () => {
        throw { status: 503 };
      }),
    });
    const result = await runCollection({ aiVisibility: provider, ports: makePorts() }, baseInput);
    const google = result.cells.find((c) => c.engine === 'google')!;
    expect(google.error).toBe('unavailable');
    expect(google.complete).toBe(false);
    expect(google.citations).toEqual([]);
  });

  it('safeHost gracefully handles invalid URLs → empty host', async () => {
    const provider = makeProvider({
      checkMentions: vi.fn(async () => [
        {
          prompt: 'p',
          model: 'google',
          mentioned: true,
          citedUrl: 'not-a-url',
          checkedAt: new Date(),
        },
      ]),
    });
    const result = await runCollection({ aiVisibility: provider, ports: makePorts() }, baseInput);
    const google = result.cells.find((c) => c.engine === 'google')!;
    expect(google.citations[0]!.host).toBe('');
  });
});

describe('UnsupportedPulseError', () => {
  it('carries messageKey', () => {
    const e = new UnsupportedPulseError('weeklyPulse.errors.x');
    expect(e.messageKey).toBe('weeklyPulse.errors.x');
    expect(e.name).toBe('UnsupportedPulseError');
  });
});
