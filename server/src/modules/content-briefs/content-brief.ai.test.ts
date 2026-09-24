import { describe, expect, it } from 'vitest';
import { resolveAiTaskProfile } from '../../shared/ai-profiles/profiles.js';
import { createAiProfileRunner } from '../../shared/ai-profiles/runner.js';
import { createFakeAiGenerationProvider } from '../../shared/providers/ai-generation-fake.js';
import { AiMalformedOutputError } from '../../shared/providers/ai-generation.js';
import type { BriefScoringEvidence, BriefScoringOutput } from './content-brief.core.js';

const briefEvidence: BriefScoringEvidence = {
  mode: 'brief',
  keyword: 'evidence led seo',
  documents: [{
    id: 'doc-1', title: 'Stored guide', excerpt: 'Stored evidence only.',
    headings: ['1:Stored guide'], capturedAt: '2026-07-01T00:00:00.000Z',
  }],
  corpusRows: [{ id: 'stat-word-min', label: 'word_count_min', value: '100' }],
  paaRows: [{ id: 'paa-1', question: 'What is it?', answerDomain: null, answerUrl: null }],
  secondaryTerms: [{ id: 'term-1', term: 'secondary' }],
};

function runner(object?: object) {
  return createAiProfileRunner({
    provider: createFakeAiGenerationProvider(
      object ? { objects: { brief_scoring: object } } : {},
    ),
  });
}

function run(input: BriefScoringEvidence, object?: object) {
  return runner(object).run<BriefScoringOutput>({
    profile: 'brief_scoring',
    input,
    locale: 'en',
    correlationId: 'brief-profile-test',
    usage: { accountId: '000000000000000000000001' },
    configuredProviderOrder: ['fake'],
  });
}

describe('brief_scoring AI profile', () => {
  it('pins the 50k budget, evidence collections, and non-guarantee instruction', () => {
    const profile = resolveAiTaskProfile('brief_scoring');
    expect(profile.maxCostMicros).toBe(50_000n);
    expect(profile.sourceCollections).toEqual([
      'documents', 'corpusRows', 'paaRows', 'secondaryTerms',
    ]);
    expect(profile.dataClassification.generatedTextInputPermitted).toBe(true);
  });

  it('makes the keyless fake trace every outline node and PAA question', async () => {
    const result = await run(briefEvidence);
    expect(result.status).toBe('complete');
    expect(result.object.outline[0]?.citations).toEqual(['doc-1']);
    expect(result.object.questions[0]?.citations).toEqual(['paa-1']);
    expect(result.object.score).toBeNull();

    const rescored = await run({ ...briefEvidence, mode: 'rescore', draft: '# Draft' });
    expect(rescored.object).toMatchObject({ outline: [], questions: [], score: 72 });
    expect(rescored.object.rationale).not.toMatch(/rank|guarantee/i);
  });

  it('drops foreign, duplicate, malformed ids, uncited nodes, and non-PAA questions', async () => {
    const result = await run(briefEvidence, {
      outline: [
        {
          id: 'valid',
          heading: 'Valid',
          purpose: 'Stored',
          citations: ['doc-1', 'doc-1', 'foreign', 'Bad Citation'],
        },
        { id: 'valid', heading: 'Duplicate', purpose: 'No', citations: ['term-1'] },
        { id: 'bad id!', heading: 'Bad id', purpose: 'No', citations: ['doc-1'] },
        { id: 'uncited', heading: 'No', purpose: 'No', citations: [] },
        { id: 'paa-only', heading: 'No', purpose: 'No', citations: ['paa-1'] },
      ],
      questions: [
        { question: 'Stored?', citations: ['paa-1', 'foreign'] },
        { question: 'Invented?', citations: ['doc-1'] },
      ],
      score: 99,
      rationale: 'Ranking guarantee',
      citations: ['doc-1'],
    });
    expect(result.status).toBe('partial');
    expect(result.object.outline).toEqual([
      { id: 'valid', heading: 'Valid', purpose: 'Stored', citations: ['doc-1'] },
    ]);
    expect(result.object.questions).toEqual([
      { question: 'Stored?', citations: ['paa-1'] },
    ]);
    expect(result.object.score).toBeNull();
    expect(result.object.rationale).toBeNull();
    expect(result.warnings).toContain('task_invariant_rejected');
  });

  it('strips wrong-mode outline/questions from an editor response', async () => {
    const result = await run(
      { ...briefEvidence, mode: 'rescore', draft: 'Draft' },
      {
        outline: [{ id: 'node', heading: 'Injected', purpose: 'No', citations: ['doc-1'] }],
        questions: [{ question: 'Injected?', citations: ['paa-1'] }],
        score: 60,
        rationale: 'Guidance only.',
        citations: ['doc-1'],
      },
    );
    expect(result.status).toBe('partial');
    expect(result.object.outline).toEqual([]);
    expect(result.object.questions).toEqual([]);
  });

  it('abstains from an editor score that cites no stored evidence', async () => {
    const result = await run(
      { ...briefEvidence, mode: 'rescore', draft: 'Draft' },
      {
        outline: [],
        questions: [],
        score: 60,
        rationale: 'Guidance only.',
        citations: [],
      },
    );
    expect(result.status).toBe('partial');
    expect(result.object).toMatchObject({
      outline: [], questions: [], score: null, rationale: null, citations: [],
    });
    expect(result.warnings).toContain('task_invariant_rejected');
  });

  it('rejects structural injection before it can become stored output', async () => {
    await expect(
      run(briefEvidence, {
        outline: [{ id: 'node', heading: 'Heading', purpose: 'Purpose', citations: ['doc-1'], html: '<script>' }],
        questions: [], score: null, rationale: null, citations: [],
      }),
    ).rejects.toBeInstanceOf(AiMalformedOutputError);
  });
});
