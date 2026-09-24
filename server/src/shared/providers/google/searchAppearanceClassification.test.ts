import { describe, expect, it } from 'vitest';
import {
  classifySearchAppearance,
  listRecognizedGenerativeRawAppearances,
  listRecognizedRawAppearances,
} from './searchAppearanceClassification.js';

describe('classifySearchAppearance', () => {
  it('recognizes AI Overviews as generative', () => {
    expect(classifySearchAppearance('AI_OVERVIEWS')).toEqual({
      slug: 'ai_overviews',
      isGenerative: true,
    });
  });

  it('recognizes AI Mode as generative', () => {
    expect(classifySearchAppearance('AI_MODE')).toEqual({
      slug: 'ai_mode',
      isGenerative: true,
    });
  });

  it('recognizes non-generative labels with a stable slug', () => {
    expect(classifySearchAppearance('FAQ_RICH_RESULTS')).toEqual({
      slug: 'faq_rich_results',
      isGenerative: false,
    });
    expect(classifySearchAppearance('VIDEO')).toEqual({
      slug: 'video',
      isGenerative: false,
    });
    expect(classifySearchAppearance('PRODUCT_RESULT')).toEqual({
      slug: 'product_result',
      isGenerative: false,
    });
  });

  it('passes unknown values through as other_unknown without generative flag', () => {
    expect(classifySearchAppearance('FUTURE_GENERATIVE_SURFACE')).toEqual({
      slug: 'other_unknown',
      isGenerative: false,
    });
    expect(classifySearchAppearance('AI-ish looking but not on the list')).toEqual({
      slug: 'other_unknown',
      isGenerative: false,
    });
  });

  it('normalizes whitespace + case before matching', () => {
    expect(classifySearchAppearance(' ai_overviews ')).toEqual({
      slug: 'ai_overviews',
      isGenerative: true,
    });
    expect(classifySearchAppearance('ai_mode')).toEqual({
      slug: 'ai_mode',
      isGenerative: true,
    });
  });

  it('is pure — same input always yields the same output object shape', () => {
    const a = classifySearchAppearance('AI_OVERVIEWS');
    const b = classifySearchAppearance('AI_OVERVIEWS');
    expect(a).toEqual(b);
  });

  it('never marks an unknown label as generative even when the raw contains "AI"', () => {
    for (const candidate of [
      'AI_UNRELEASED',
      'GENERATIVE_AI_SURFACE_FUTURE',
      'AI',
      'AI_OVERVIEW',
    ]) {
      const c = classifySearchAppearance(candidate);
      expect(c.isGenerative).toBe(false);
      expect(c.slug).toBe('other_unknown');
    }
  });
});

describe('listRecognizedRawAppearances', () => {
  it('is a non-empty frozen list including both generative surfaces', () => {
    const list = listRecognizedRawAppearances();
    expect(list.length).toBeGreaterThan(0);
    expect(list).toContain('AI_OVERVIEWS');
    expect(list).toContain('AI_MODE');
    expect(Object.isFrozen(list)).toBe(true);
  });
});

describe('listRecognizedGenerativeRawAppearances', () => {
  it('lists exactly the generative-AI surfaces', () => {
    const generative = listRecognizedGenerativeRawAppearances();
    expect([...generative].sort()).toEqual(['AI_MODE', 'AI_OVERVIEWS']);
    expect(Object.isFrozen(generative)).toBe(true);
  });

  it('every generative entry passes the classifier as generative', () => {
    for (const raw of listRecognizedGenerativeRawAppearances()) {
      expect(classifySearchAppearance(raw).isGenerative).toBe(true);
    }
  });

  it('no non-generative entry is classified as generative', () => {
    const generative = new Set(listRecognizedGenerativeRawAppearances());
    for (const raw of listRecognizedRawAppearances()) {
      if (generative.has(raw)) continue;
      expect(classifySearchAppearance(raw).isGenerative).toBe(false);
    }
  });
});
