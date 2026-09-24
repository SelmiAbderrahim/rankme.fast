import { afterEach, describe, expect, it } from 'vitest';
import {
  createFakeCompetitorProvider,
  createFakeKeywordProvider,
  createFakeTrendsProvider,
} from '../../shared/providers/index.js';
import {
  getKeywordProvider,
  getKeywordDiscoveryContentSourceProvider,
  getKeywordResearchAiProviderOrder,
  getKeywordResearchAiRunner,
  getKeywordResearchCompetitorProvider,
  getKeywordResearchDb,
  getKeywordResearchTrendsProvider,
  getSiteKeywordProvider,
  setKeywordProvider,
  setKeywordDiscoveryContentSourceProvider,
  setKeywordResearchAiRunner,
  setKeywordResearchCompetitorProvider,
  setKeywordResearchDb,
  setKeywordResearchTrendsProvider,
} from './keyword-research.holder.js';
import { createAiProfileRunner } from '../../shared/ai-profiles/index.js';
import { createFakeAiGenerationProvider } from '../../shared/providers/ai-generation-fake.js';
import { createFakeContentSourceProvider } from '../../shared/providers/content-source-fake.js';

afterEach(() => {
  setKeywordResearchDb(null);
  setKeywordProvider(null);
  setKeywordDiscoveryContentSourceProvider(null);
  setKeywordResearchCompetitorProvider(null);
  setKeywordResearchAiRunner(null, ['fake']);
  setKeywordResearchTrendsProvider(null);
});

describe('holder', () => {
  it('getKeywordResearchDb throws when unset', () => {
    expect(() => getKeywordResearchDb()).toThrow(
      /keyword-research db not configured/,
    );
  });

  it('getKeywordProvider throws when unset', () => {
    expect(() => getKeywordProvider()).toThrow(/keyword provider not configured/);
  });

  it('fails closed when the keyword discovery source is unset and roundtrips once set', () => {
    expect(() => getKeywordDiscoveryContentSourceProvider()).toThrow(
      /keyword discovery content source not configured/,
    );
    const contentSource = createFakeContentSourceProvider();
    setKeywordDiscoveryContentSourceProvider(contentSource);
    expect(getKeywordDiscoveryContentSourceProvider()).toBe(contentSource);
  });

  it('roundtrips db + provider', () => {
    const db = {} as never;
    const provider = createFakeKeywordProvider();
    setKeywordResearchDb(db);
    setKeywordProvider(provider);
    expect(getKeywordResearchDb()).toBe(db);
    expect(getKeywordProvider()).toBe(provider);
    expect(getSiteKeywordProvider()).toBe(provider);
  });

  it('rejects a keyword provider without site discovery support', () => {
    const provider = createFakeKeywordProvider();
    setKeywordProvider({
      getMetrics: provider.getMetrics,
      getRelated: provider.getRelated,
      classifyIntent: provider.classifyIntent,
      getIdeas: provider.getIdeas,
      getLongTailSuggestions: provider.getLongTailSuggestions,
      getOverview: provider.getOverview,
      getHistoricalVolume: provider.getHistoricalVolume,
    });
    expect(() => getSiteKeywordProvider()).toThrow(/does not support site keyword discovery/);
  });

  it('getKeywordResearchCompetitorProvider throws when unset', () => {
    expect(() => getKeywordResearchCompetitorProvider()).toThrow(
      /competitor provider not configured/,
    );
  });

  it('roundtrips the keyword-research competitor provider', () => {
    const competitor = createFakeCompetitorProvider();
    setKeywordResearchCompetitorProvider(competitor);
    expect(getKeywordResearchCompetitorProvider()).toBe(competitor);
  });

  it('getKeywordResearchTrendsProvider throws when unset and roundtrips once set', () => {
    expect(() => getKeywordResearchTrendsProvider()).toThrow(
      /trends provider not configured/,
    );
    const trends = createFakeTrendsProvider();
    setKeywordResearchTrendsProvider(trends);
    expect(getKeywordResearchTrendsProvider()).toBe(trends);
  });

  it('getKeywordResearchAiRunner throws when unset', () => {
    expect(() => getKeywordResearchAiRunner()).toThrow(/AI runner not configured/);
  });

  it('roundtrips the AI runner + provider order; empty order falls back to fake', () => {
    const runner = createAiProfileRunner({ provider: createFakeAiGenerationProvider() });
    setKeywordResearchAiRunner(runner, ['openai', 'anthropic']);
    expect(getKeywordResearchAiRunner()).toBe(runner);
    expect(getKeywordResearchAiProviderOrder()).toEqual(['openai', 'anthropic']);
    setKeywordResearchAiRunner(runner, []);
    expect(getKeywordResearchAiProviderOrder()).toEqual(['fake']);
  });
});
