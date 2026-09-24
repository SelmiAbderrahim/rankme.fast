import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '../i18n/locales.js';
import {
  AiAvailabilityError,
  AiBudgetRefusalError,
  AiMalformedOutputError,
  AiQuotaError,
  AiSafetyError,
  AiTimeoutError,
  type GenerateStructuredInput,
} from './ai-generation.js';
import {
  createFakeAiGenerationProvider,
  makeFakeSchemaValue,
  FAKE_BRAND_DIGEST_FABRICATE_MARKER,
  FAKE_BRAND_DIGEST_FABRICATED_ROW_ID,
  type FakeAiOutcome,
} from './ai-generation-fake.js';

const schema = z.object({
  title: z.string().min(8),
  count: z.number().int().min(2),
  enabled: z.boolean(),
  tags: z.array(z.string()).min(1),
  createdAt: z.string(),
});

function input(): GenerateStructuredInput<z.infer<typeof schema>> {
  return {
    task: 'runtime.contract',
    jsonSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 8 },
        count: { type: 'integer', minimum: 2 },
        enabled: { type: 'boolean' },
        tags: { type: 'array', minItems: 1, items: { type: 'string' } },
        createdAt: { type: 'string', format: 'date-time' },
      },
      required: ['title', 'count', 'enabled', 'tags', 'createdAt'],
    },
    validationSchema: schema,
    systemInstruction: { id: 'fake', version: 'v1', text: 'not logged' },
    sanitizedInput: 'not logged',
    locale: 'en',
    maxOutputTokens: 100,
    temperature: { mode: 'deterministic' },
    correlationId: 'fake-1',
    maxCostMicros: 1_000n,
    usage: { accountId: 'account-1' },
  };
}

describe('deterministic fake AI generation provider', () => {
  it('generates a schema-valid task object keylessly and without content metadata', async () => {
    const result = await createFakeAiGenerationProvider().generateStructured(input());
    expect(schema.parse(result.object)).toEqual(result.object);
    expect(result).toMatchObject({ provider: 'fake', trust: 'untrusted', warnings: ['usage_estimated'] });
    expect(result.attempts[0]).not.toHaveProperty('prompt');
    expect(result.attempts[0]).not.toHaveProperty('completion');
  });

  it('supports task-specific refined objects', async () => {
    const custom = { title: 'custom title', count: 7, enabled: false, tags: ['one'], createdAt: 'fixed' };
    const result = await createFakeAiGenerationProvider({
      objects: { 'runtime.contract': custom },
    }).generateStructured(input());
    expect(result.object).toEqual(custom);
  });

  describe('disavow_rationale input-aware sample', () => {
    const rationaleSchema = z.object({
      rationales: z.array(
        z.object({
          rowId: z.string().min(1),
          rationale: z.string().min(1),
          citations: z.array(z.string().min(1)).max(1),
        }),
      ),
      citations: z.array(z.string()),
    });
    const rationaleInput = (
      sanitizedInput: string,
    ): GenerateStructuredInput<z.infer<typeof rationaleSchema>> => ({
      ...input(),
      task: 'disavow_rationale',
      jsonSchema: {
        type: 'object',
        properties: {
          rationales: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                rowId: { type: 'string', minLength: 1 },
                rationale: { type: 'string', minLength: 1 },
                citations: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 1,
                  items: { type: 'string', minLength: 1 },
                },
              },
              required: ['rowId', 'rationale', 'citations'],
            },
          },
          citations: { type: 'array', items: { type: 'string' } },
        },
        required: ['rationales', 'citations'],
      },
      validationSchema: rationaleSchema,
      sanitizedInput,
    });

    it('cites the first supplied stored row', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        rationaleInput(
          '<untrusted_customer_data>\n{"rows":[{"id":"row-1"}]}\n</untrusted_customer_data>',
        ),
      );
      expect(result.object.rationales[0]).toMatchObject({
        rowId: 'row-1',
        citations: ['row-1'],
      });
    });

    it('authors a distinct rationale in every locale without changing the row id', async () => {
      const rationales: string[] = [];
      for (const locale of SUPPORTED_LOCALES) {
        const result = await createFakeAiGenerationProvider().generateStructured({
          ...rationaleInput(
            '<untrusted_customer_data>\n{"rows":[{"id":"Exact-Row_1"}]}\n</untrusted_customer_data>',
          ),
          locale,
        });
        expect(result.object.rationales[0]).toMatchObject({
          rowId: 'Exact-Row_1',
          citations: ['Exact-Row_1'],
        });
        rationales.push(result.object.rationales[0]!.rationale);
      }
      expect(new Set(rationales).size).toBe(SUPPORTED_LOCALES.length);
    });

    it.each([
      ['missing rows', '<untrusted_customer_data>\n{}\n</untrusted_customer_data>'],
      ['non-string id', '<untrusted_customer_data>\n{"rows":[{"id":7}]}\n</untrusted_customer_data>'],
      ['empty id', '<untrusted_customer_data>\n{"rows":[{"id":""}]}\n</untrusted_customer_data>'],
    ])('falls back to the generic schema sample for %s', async (_label, sanitizedInput) => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        rationaleInput(sanitizedInput),
      );
      expect(result.object.rationales[0]!.rowId).toBe('fixture');
    });
  });

  it.each([
    ['timeout', AiTimeoutError],
    ['quota', AiQuotaError],
    ['unavailable', AiAvailabilityError],
    ['malformed', AiMalformedOutputError],
    ['safety', AiSafetyError],
    ['budget', AiBudgetRefusalError],
  ] as const)('injects the %s outcome', async (outcome, errorClass) => {
    await expect(
      createFakeAiGenerationProvider({ outcomes: [outcome] }).generateStructured(input()),
    ).rejects.toBeInstanceOf(errorClass);
  });

  describe('keyword_clustering input-aware sample', () => {
    const clusteringSchema = z.object({
      clusters: z.array(
        z.object({
          label: z.string().min(1),
          memberIds: z.array(z.string().min(1)).min(1),
          suggestedRoute: z.enum(['brief', 'seo']),
          intentHomogeneity: z.number().min(0).max(1),
        }),
      ),
      citations: z.array(z.string()),
    });

    function clusteringInput(
      sanitizedInput: string,
    ): GenerateStructuredInput<z.infer<typeof clusteringSchema>> {
      return {
        ...input(),
        task: 'keyword_clustering',
        jsonSchema: {
          type: 'object',
          properties: {
            clusters: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', minLength: 1 },
                  memberIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
                  suggestedRoute: { type: 'string', enum: ['brief', 'seo'] },
                  intentHomogeneity: { type: 'number', minimum: 0, maximum: 1 },
                },
                required: ['label', 'memberIds', 'suggestedRoute', 'intentHomogeneity'],
              },
            },
            citations: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
          required: ['clusters', 'citations'],
        },
        validationSchema: clusteringSchema,
        sanitizedInput,
      };
    }

    const wrap = (payload: unknown): string =>
      `<untrusted_customer_data>\n${JSON.stringify(payload)}\n</untrusted_customer_data>`;

    it('echoes the real member ids split across two deterministic clusters', async () => {
      const ids = ['kw-a', 'kw-b', 'kw-c', 'kw-d'];
      const result = await createFakeAiGenerationProvider().generateStructured(
        clusteringInput(wrap({ keywords: ids.map((id) => ({ id, phrase: id })) })),
      );
      expect(result.object.clusters).toHaveLength(2);
      expect(result.object.clusters[0]).toMatchObject({
        label: 'Related keyword group A',
        memberIds: ['kw-a', 'kw-b'],
        suggestedRoute: 'brief',
      });
      expect(result.object.clusters[1]).toMatchObject({
        label: 'Related keyword group B',
        memberIds: ['kw-c', 'kw-d'],
        suggestedRoute: 'seo',
      });
      expect(result.object.citations).toEqual([]);
    });

    it('produces a single cluster for a single resolvable id', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        clusteringInput(wrap({ keywords: [{ id: 'kw-solo', phrase: 'solo' }] })),
      );
      expect(result.object.clusters).toHaveLength(1);
      expect(result.object.clusters[0]!.memberIds).toEqual(['kw-solo']);
    });

    it('authors distinct cluster labels in every locale while preserving member ids', async () => {
      const labels: string[] = [];
      for (const locale of SUPPORTED_LOCALES) {
        const result = await createFakeAiGenerationProvider().generateStructured({
          ...clusteringInput(wrap({ keywords: [{ id: 'Exact-KW_1', phrase: 'SOURCE_TERM' }] })),
          locale,
        });
        expect(result.object.clusters[0]!.memberIds).toEqual(['Exact-KW_1']);
        labels.push(result.object.clusters[0]!.label);
      }
      expect(new Set(labels).size).toBe(SUPPORTED_LOCALES.length);
    });

    it.each([
      ['missing sanitized-input wrapper', 'not wrapped at all'],
      ['unparseable JSON body', '<untrusted_customer_data>\n{nope\n</untrusted_customer_data>'],
      ['non-array keywords', '<untrusted_customer_data>\n{"keywords":"x"}\n</untrusted_customer_data>'],
      [
        'no usable string ids',
        '<untrusted_customer_data>\n{"keywords":[{"id":42},{"id":""}]}\n</untrusted_customer_data>',
      ],
    ])('falls back to the generic schema sample on %s', async (_label, sanitized) => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        clusteringInput(sanitized),
      );
      // Generic sample: minItems=1 arrays filled with the "fixture" string —
      // hallucinated ids that the clustering pipeline strips downstream.
      expect(result.object.clusters.length).toBeGreaterThan(0);
      expect(result.object.clusters[0]!.memberIds).toEqual(['fixture']);
    });

    it('lets an explicit task object override win over the derived sample', async () => {
      const custom = {
        clusters: [
          { label: 'Override', memberIds: ['kw-x'], suggestedRoute: 'seo', intentHomogeneity: 0.5 },
        ],
        citations: [],
      };
      const result = await createFakeAiGenerationProvider({
        objects: { keyword_clustering: custom },
      }).generateStructured(
        clusteringInput(wrap({ keywords: [{ id: 'kw-real', phrase: 'real' }] })),
      );
      expect(result.object).toEqual(custom);
    });
  });

  describe('audience_research_cluster input-aware sample', () => {
    const signalSchema = z.object({
      type: z.enum(['complaint', 'request', 'question', 'competitor_gap']),
      title: z.string().min(1),
      summary: z.string().min(1),
      suggestedRoute: z.enum(['content', 'comparison_page', 'product', 'seo']),
      citedSourceIds: z.array(z.string().min(1)).min(1),
    });
    const audienceSchema = z.object({
      signals: z.array(signalSchema).min(1),
      citations: z.array(z.string()),
    });
    const audienceInput = (
      sanitizedInput: string,
    ): GenerateStructuredInput<z.infer<typeof audienceSchema>> => ({
      ...input(),
      task: 'audience_research_cluster',
      jsonSchema: {
        type: 'object',
        properties: {
          signals: {
            type: 'array', minItems: 1,
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['complaint', 'request', 'question', 'competitor_gap'] },
                title: { type: 'string', minLength: 1 },
                summary: { type: 'string', minLength: 1 },
                suggestedRoute: { type: 'string', enum: ['content', 'comparison_page', 'product', 'seo'] },
                citedSourceIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
              },
              required: ['type', 'title', 'summary', 'suggestedRoute', 'citedSourceIds'],
            },
          },
          citations: { type: 'array', items: { type: 'string' } },
        },
        required: ['signals', 'citations'],
      },
      validationSchema: audienceSchema,
      sanitizedInput,
    });
    const wrapSources = (sources: unknown): string =>
      `<untrusted_customer_data>\n${JSON.stringify({ sources })}\n</untrusted_customer_data>`;

    it('authors all seven locale variants while echoing the exact stored source id', async () => {
      const sourceId = 'source-Exact_01';
      const titles: string[] = [];
      for (const locale of SUPPORTED_LOCALES) {
        const result = await createFakeAiGenerationProvider().generateStructured({
          ...audienceInput(wrapSources([{ id: sourceId, excerpt: 'SOURCE_BYTES' }])),
          locale,
        });
        expect(result.object.signals[0]?.citedSourceIds).toEqual([sourceId]);
        expect(result.object.citations).toEqual([sourceId]);
        titles.push(result.object.signals[0]!.title);
      }
      expect(new Set(titles).size).toBe(SUPPORTED_LOCALES.length);
    });

    it.each([
      ['non-array sources', wrapSources(true)],
      ['no usable source id', wrapSources([{ id: 7 }, { id: '' }])],
    ])('uses the generic schema fallback for %s', async (_label, sanitizedInput) => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        audienceInput(sanitizedInput),
      );
      expect(result.object.signals[0]!.citedSourceIds).toEqual(['fixture']);
    });
  });

  describe('app_review_clusters input-aware sample', () => {
    const clusterSchema = z.object({
      clusters: z.array(z.object({
        label: z.string().min(1),
        sentiment: z.enum(['positive', 'neutral', 'negative', 'mixed']),
        citedReviewIds: z.array(z.string().regex(/^review-\d{3}$/)).min(2),
        quotes: z.array(z.object({
          reviewId: z.string().regex(/^review-\d{3}$/),
          quote: z.string().min(1).max(500),
        })).min(2),
      })),
      citations: z.array(z.string().regex(/^review-\d{3}$/)),
    });

    function clusterInput(
      sanitizedInput: string,
    ): GenerateStructuredInput<z.infer<typeof clusterSchema>> {
      return {
        ...input(),
        task: 'app_review_clusters',
        jsonSchema: {
          type: 'object',
          properties: {
            clusters: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', minLength: 1 },
                  sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'mixed'] },
                  citedReviewIds: {
                    type: 'array', minItems: 2,
                    items: { type: 'string', pattern: '^review-[0-9]{3}$' },
                  },
                  quotes: {
                    type: 'array', minItems: 2,
                    items: {
                      type: 'object',
                      properties: {
                        reviewId: { type: 'string', pattern: '^review-[0-9]{3}$' },
                        quote: { type: 'string', minLength: 1, maxLength: 500 },
                      },
                      required: ['reviewId', 'quote'],
                    },
                  },
                },
                required: ['label', 'sentiment', 'citedReviewIds', 'quotes'],
              },
            },
            citations: { type: 'array', items: { type: 'string', pattern: '^review-[0-9]{3}$' } },
          },
          required: ['clusters', 'citations'],
        },
        validationSchema: clusterSchema,
        sanitizedInput,
      };
    }

    const wrapped = (reviews: unknown): string =>
      `<untrusted_customer_data>\n${JSON.stringify({ reviews })}\n</untrusted_customer_data>`;

    it('echoes real stored review ids and exact bounded quotes', async () => {
      const longText = 'x'.repeat(700);
      const result = await createFakeAiGenerationProvider().generateStructured(clusterInput(wrapped([
        { id: 'review-001', text: longText, rating: 5 },
        { id: 'review-002', text: 'Second exact quote.', rating: 1 },
        { id: 'review-003', text: 'Not selected.', rating: 3 },
      ])));

      expect(result.object).toEqual({
        clusters: [{
          label: 'Recurring app feedback',
          sentiment: 'mixed',
          citedReviewIds: ['review-001', 'review-002'],
          quotes: [
            { reviewId: 'review-001', quote: 'x'.repeat(500) },
            { reviewId: 'review-002', quote: 'Second exact quote.' },
          ],
        }],
        citations: ['review-001', 'review-002'],
      });
    });

    it('authors distinct cluster labels in every locale and leaves quotes byte-stable', async () => {
      const labels: string[] = [];
      const sourceText = 'SOURCE_BYTES_Exact';
      for (const locale of SUPPORTED_LOCALES) {
        const result = await createFakeAiGenerationProvider().generateStructured({
          ...clusterInput(wrapped([
            { id: 'review-001', text: sourceText },
            { id: 'review-002', text: 'SECOND_SOURCE_BYTES' },
          ])),
          locale,
        });
        expect(result.object.clusters[0]!.quotes[0]).toEqual({
          reviewId: 'review-001',
          quote: sourceText,
        });
        labels.push(result.object.clusters[0]!.label);
      }
      expect(new Set(labels).size).toBe(SUPPORTED_LOCALES.length);
    });

    it('ignores malformed rows before selecting two valid citations', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(clusterInput(wrapped([
        null,
        { id: 42, text: 'wrong id type' },
        { id: 'not-a-review', text: 'wrong id shape' },
        { id: 'review-004', text: 42 },
        { id: 'review-005', text: '' },
        { id: 'review-006', text: 'Valid six.' },
        { id: 'review-007', text: 'Valid seven.' },
      ])));
      expect(result.object.clusters[0]!.citedReviewIds).toEqual(['review-006', 'review-007']);
    });

    it.each([
      ['unwrapped input', 'not wrapped'],
      ['invalid JSON', '<untrusted_customer_data>\n{bad\n</untrusted_customer_data>'],
      ['non-array reviews', '<untrusted_customer_data>\n{"reviews":true}\n</untrusted_customer_data>'],
      ['fewer than two usable reviews', wrapped([{ id: 'review-001', text: 'Only one.' }])],
    ])('rejects the generic invalid-citation fallback for %s', async (_label, sanitizedInput) => {
      await expect(
        createFakeAiGenerationProvider().generateStructured(clusterInput(sanitizedInput)),
      ).rejects.toBeInstanceOf(AiMalformedOutputError);
    });
  });

  describe('review_themes input-aware sample', () => {
    const themeSchema = z.object({
      label: z.string().min(1),
      summary: z.string().min(1),
      citedReviewIds: z.array(z.string().min(1)),
    });
    const themesSchema = z.object({
      complaintThemes: z.array(themeSchema),
      praiseThemes: z.array(themeSchema),
      citations: z.array(z.string()),
    });
    const themeJson = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', minLength: 1 },
          summary: { type: 'string', minLength: 1 },
          citedReviewIds: { type: 'array', items: { type: 'string', minLength: 1 } },
        },
        required: ['label', 'summary', 'citedReviewIds'],
      },
    } as const;

    function themesInput(
      sanitizedInput: string,
    ): GenerateStructuredInput<z.infer<typeof themesSchema>> {
      return {
        ...input(),
        task: 'review_themes',
        jsonSchema: {
          type: 'object',
          properties: {
            complaintThemes: themeJson,
            praiseThemes: themeJson,
            citations: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
          required: ['complaintThemes', 'praiseThemes', 'citations'],
        },
        validationSchema: themesSchema,
        sanitizedInput,
      };
    }

    const wrapReviews = (reviews: unknown): string =>
      `<untrusted_customer_data>\n${JSON.stringify({ reviews })}\n</untrusted_customer_data>`;

    it('echoes real review ids split by rating into a complaint and a praise theme', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        themesInput(
          wrapReviews([
            { id: 'rev-001', rating: 1 },
            { id: 'rev-002', rating: 3 },
            { id: 'rev-003', rating: 5 },
            { id: 'rev-004', rating: 4 },
          ]),
        ),
      );
      expect(result.object.complaintThemes[0]!.citedReviewIds).toEqual(['rev-001', 'rev-002']);
      expect(result.object.praiseThemes[0]!.citedReviewIds).toEqual(['rev-003', 'rev-004']);
    });

    it('authors distinct theme prose in every locale without changing citation ids', async () => {
      const labels: string[] = [];
      for (const locale of SUPPORTED_LOCALES) {
        const result = await createFakeAiGenerationProvider().generateStructured({
          ...themesInput(wrapReviews([{ id: 'Exact-ID-1', rating: 1 }, { id: 'Exact-ID-2', rating: 2 }])),
          locale,
        });
        expect(result.object.complaintThemes[0]!.citedReviewIds).toEqual([
          'Exact-ID-1', 'Exact-ID-2',
        ]);
        labels.push(result.object.complaintThemes[0]!.label);
      }
      expect(new Set(labels).size).toBe(SUPPORTED_LOCALES.length);
    });

    it('omits a bucket that cannot reach the two-citation bar instead of padding it', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        themesInput(
          wrapReviews([
            { id: 'rev-001', rating: 1 },
            { id: 'rev-002', rating: 5 },
            { id: 'rev-003', rating: 5 },
          ]),
        ),
      );
      expect(result.object.complaintThemes).toEqual([]);
      expect(result.object.praiseThemes).toHaveLength(1);
    });

    it('treats a missing rating as praise-side material', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        themesInput(wrapReviews([{ id: 'rev-001' }, { id: 'rev-002', rating: null }])),
      );
      expect(result.object.praiseThemes[0]!.citedReviewIds).toEqual(['rev-001', 'rev-002']);
    });

    it.each([
      ['non-array reviews', '<untrusted_customer_data>\n{"reviews":"x"}\n</untrusted_customer_data>'],
      [
        'no usable string ids',
        '<untrusted_customer_data>\n{"reviews":[{"id":7},{"id":""}]}\n</untrusted_customer_data>',
      ],
    ])('falls back to the generic schema sample on %s', async (_label, sanitized) => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        themesInput(sanitized),
      );
      expect(result.object.complaintThemes[0]!.citedReviewIds).toEqual(['fixture']);
    });
  });

  describe('brand_digest input-aware sample', () => {
    const digestSchema = z.object({
      digestSentences: z.array(
        z.object({ text: z.string().min(1), citedRowIds: z.array(z.string().min(1)) }),
      ),
      citations: z.array(z.string()),
    });

    function digestInput(
      sanitizedInput: string,
    ): GenerateStructuredInput<z.infer<typeof digestSchema>> {
      return {
        ...input(),
        task: 'brand_digest',
        jsonSchema: {
          type: 'object',
          properties: {
            digestSentences: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string', minLength: 1 },
                  citedRowIds: { type: 'array', items: { type: 'string', minLength: 1 } },
                },
                required: ['text', 'citedRowIds'],
              },
            },
            citations: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
          required: ['digestSentences', 'citations'],
        },
        validationSchema: digestSchema,
        sanitizedInput,
      };
    }

    const wrapMentions = (mentions: unknown): string =>
      `<untrusted_customer_data>\n${JSON.stringify({ mentions })}\n</untrusted_customer_data>`;

    it('echoes the real retained row ids into one cited sentence', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        digestInput(wrapMentions([{ id: 'row-001' }, { id: 'row-002' }])),
      );
      expect(result.object.digestSentences).toHaveLength(1);
      expect(result.object.digestSentences[0]!.citedRowIds).toEqual(['row-001', 'row-002']);
    });

    it('authors distinct digest prose in every locale without changing row ids', async () => {
      const sentences: string[] = [];
      for (const locale of SUPPORTED_LOCALES) {
        const result = await createFakeAiGenerationProvider().generateStructured({
          ...digestInput(wrapMentions([{ id: 'Exact-Row_1' }])),
          locale,
        });
        expect(result.object.digestSentences[0]!.citedRowIds).toEqual(['Exact-Row_1']);
        sentences.push(result.object.digestSentences[0]!.text);
      }
      expect(new Set(sentences).size).toBe(SUPPORTED_LOCALES.length);
    });

    it('caps the echoed citation list at the twenty-id output bound', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        digestInput(
          wrapMentions(Array.from({ length: 25 }, (_, i) => ({ id: `row-${i}` }))),
        ),
      );
      expect(result.object.digestSentences[0]!.citedRowIds).toHaveLength(20);
    });

    it.each([
      ['non-array mentions', '<untrusted_customer_data>\n{"mentions":"x"}\n</untrusted_customer_data>'],
      [
        'no usable string ids',
        '<untrusted_customer_data>\n{"mentions":[{"id":7},{"id":""}]}\n</untrusted_customer_data>',
      ],
      ['unparsable envelope', 'not-an-envelope'],
    ])('falls back to the generic schema sample on %s', async (_label, sanitized) => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        digestInput(sanitized),
      );
      expect(result.object.digestSentences[0]!.citedRowIds).toEqual(['fixture']);
    });

    it.each([['title'], ['snippet']])(
      'fabricates a citation when the marker rides in the %s',
      async (field) => {
        const result = await createFakeAiGenerationProvider().generateStructured(
          digestInput(
            wrapMentions([
              { id: 'row-001', [field]: `probe ${FAKE_BRAND_DIGEST_FABRICATE_MARKER}` },
            ]),
          ),
        );
        // Citation-or-drop then discards the sentence → `no_reliable_digest`.
        expect(result.object.digestSentences[0]!.citedRowIds).toEqual([
          FAKE_BRAND_DIGEST_FABRICATED_ROW_ID,
        ]);
      },
    );

    it('leaves a marker-free bank on the honest echoed-id path', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        digestInput(wrapMentions([{ id: 'row-001', title: 7, snippet: 'ordinary' }])),
      );
      expect(result.object.digestSentences[0]!.citedRowIds).toEqual(['row-001']);
    });
  });

  it('supports success after N failures and repeats the final outcome', async () => {
    const outcomes: readonly FakeAiOutcome[] = ['quota', 'unavailable', 'success'];
    const fake = createFakeAiGenerationProvider({ outcomes });
    await expect(fake.generateStructured(input())).rejects.toBeInstanceOf(AiQuotaError);
    await expect(fake.generateStructured(input())).rejects.toBeInstanceOf(AiAvailabilityError);
    await expect(fake.generateStructured(input())).resolves.toMatchObject({ provider: 'fake' });
    await expect(fake.generateStructured(input())).resolves.toMatchObject({ provider: 'fake' });
  });

  describe('schema_generator input-aware sample', () => {
    const generatorSchema = z.object({
      assignments: z.array(
        z.object({
          property: z.string().min(1),
          factId: z.string().min(1),
          value: z.string().min(1),
        }),
      ),
      omissions: z.array(
        z.object({ property: z.string().min(1), reasonCode: z.string().min(1) }),
      ),
      citations: z.array(z.string()),
    });

    const generatorInput = (
      sanitizedInput: string,
    ): GenerateStructuredInput<z.infer<typeof generatorSchema>> => ({
      ...input(),
      task: 'schema_generator',
      jsonSchema: {
        type: 'object',
        properties: {
          assignments: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                property: { type: 'string', minLength: 1 },
                factId: { type: 'string', minLength: 1 },
                value: { type: 'string', minLength: 1 },
              },
              required: ['property', 'factId', 'value'],
            },
          },
          omissions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                property: { type: 'string', minLength: 1 },
                reasonCode: { type: 'string', minLength: 1 },
              },
              required: ['property', 'reasonCode'],
            },
          },
          citations: { type: 'array', items: { type: 'string' } },
        },
        required: ['assignments', 'omissions', 'citations'],
      },
      validationSchema: generatorSchema,
      sanitizedInput,
    });

    const wrap = (payload: object) =>
      `<untrusted_customer_data>\n${JSON.stringify(payload)}\n</untrusted_customer_data>`;

    it('copies a supplied fact verbatim and omits a property with an empty menu', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        generatorInput(
          wrap({
            schemaType: 'WebPage',
            properties: [
              { name: 'name', class: 'required', evidenceFactIds: ['f0'] },
              { name: 'description', class: 'recommended', evidenceFactIds: [] },
            ],
            facts: [
              { id: 'f0', family: 'page.title', label: 'Page title', value: 'A title' },
            ],
          }),
        ),
      );
      expect(result.object.assignments).toEqual([
        { property: 'name', factId: 'f0', value: 'A title' },
      ]);
      expect(result.object.omissions).toEqual([
        { property: 'description', reasonCode: 'no_evidence' },
      ]);
    });

    it('interleaves question headings with answers when the menu spans both families', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        generatorInput(
          wrap({
            schemaType: 'FAQPage',
            properties: [
              {
                name: 'mainEntity',
                class: 'required',
                evidenceFactIds: ['f0', 'f1', 'f2', 'f3'],
              },
            ],
            facts: [
              { id: 'f0', family: 'page.h2', sourceIndex: 0, label: 'H2 #1', value: 'Not a question' },
              { id: 'f1', family: 'page.h2', sourceIndex: 1, label: 'H2 #2', value: 'What is it?' },
              { id: 'f2', family: 'page.faqAnswers', sourceIndex: 0, label: 'Answer #1', value: 'It is a thing.' },
              { id: 'f3', family: 'page.faqAnswers', sourceIndex: 1, label: 'Answer #2', value: 'Second answer.' },
            ],
          }),
        ),
      );
      // Only the question-shaped heading pairs, and only with its matching
      // source index (not the first answer in model-input order).
      expect(result.object.assignments).toEqual([
        { property: 'mainEntity', factId: 'f1', value: 'What is it?' },
        { property: 'mainEntity', factId: 'f3', value: 'Second answer.' },
      ]);
    });

    it('omits FAQ evidence when questions lack a matching numeric source index', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        generatorInput(
          wrap({
            schemaType: 'FAQPage',
            properties: [
              {
                name: 'mainEntity',
                class: 'required',
                evidenceFactIds: ['question-without-index', 'unmatched-question', 'answer'],
              },
            ],
            facts: [
              {
                id: 'question-without-index',
                family: 'page.h2',
                label: 'Question without index',
                value: 'Who is this for?',
              },
              {
                id: 'unmatched-question',
                family: 'page.h2',
                sourceIndex: 1,
                label: 'Unmatched question',
                value: 'How does it work?',
              },
              {
                id: 'answer',
                family: 'page.faqAnswers',
                sourceIndex: 2,
                label: 'Different answer',
                value: 'This answer belongs elsewhere.',
              },
            ],
          }),
        ),
      );
      expect(result.object.assignments).toEqual([]);
      expect(result.object.omissions).toEqual([
        { property: 'mainEntity', reasonCode: 'no_evidence' },
      ]);
    });

    it.each([
      ['missing properties', { facts: [] }],
      ['missing facts', { properties: [] }],
    ])('falls back to the generic schema sample for %s', async (_label, payload) => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        generatorInput(wrap(payload)),
      );
      expect(result.object.assignments[0]!.factId).toBe('fixture');
    });

    it('skips malformed property and fact rows rather than inventing values', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        generatorInput(
          wrap({
            properties: [
              { name: 7, evidenceFactIds: ['f0'] },
              { name: 'name', evidenceFactIds: 'not-an-array' },
              { name: 'headline', evidenceFactIds: ['f0', 'f1'] },
            ],
            facts: [
              { id: 'f0', family: 'page.title', label: 'Page title', value: 'A title' },
              { id: 'f1', family: 'page.h1', value: 42 },
            ],
          }),
        ),
      );
      expect(result.object.assignments).toEqual([
        { property: 'headline', factId: 'f0', value: 'A title' },
      ]);
      expect(result.object.omissions).toEqual([
        { property: 'name', reasonCode: 'no_evidence' },
      ]);
    });
  });

  describe('internal_linking input-aware sample', () => {
    const linkingSchema = z.object({
      suggestions: z.array(z.object({
        candidateId: z.string(),
        sourceUrl: z.string(),
        targetUrl: z.string(),
        anchorText: z.string().max(120),
      })),
      citations: z.array(z.string()),
    });
    const linkingInput = (payload: object): GenerateStructuredInput<z.infer<typeof linkingSchema>> => ({
      ...input(),
      task: 'internal_linking',
      jsonSchema: {
        type: 'object',
        properties: {
          suggestions: { type: 'array', items: { type: 'object' } },
          citations: { type: 'array', items: { type: 'string' } },
        },
        required: ['suggestions', 'citations'],
      },
      validationSchema: linkingSchema,
      sanitizedInput: `<untrusted_customer_data>\n${JSON.stringify(payload)}\n</untrusted_customer_data>`,
    });

    it('echoes only complete supplied pairs and bounds the target-label anchor', async () => {
      const label = 'a'.repeat(140);
      const result = await createFakeAiGenerationProvider().generateStructured(
        linkingInput({
          candidates: [
            {
              id: 'link-11111111111111111111',
              sourceUrl: 'https://example.test/source',
              targetUrl: 'https://example.test/target',
              targetLabel: label,
            },
            { id: 7 },
          ],
        }),
      );
      expect(result.object.suggestions).toEqual([
        {
          candidateId: 'link-11111111111111111111',
          sourceUrl: 'https://example.test/source',
          targetUrl: 'https://example.test/target',
          anchorText: 'a'.repeat(120),
        },
      ]);
      expect(result.object.citations).toEqual(['link-11111111111111111111']);
    });

    it('returns an empty ranked subset for an empty candidate bank', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        linkingInput({ candidates: [] }),
      );
      expect(result.object).toEqual({ suggestions: [], citations: [] });
    });

    it('falls back to the requested schema when the candidate bank is malformed', async () => {
      const fallbackSchema = z.object({ marker: z.literal('fallback') });
      const result = await createFakeAiGenerationProvider().generateStructured({
        ...input(),
        task: 'internal_linking',
        jsonSchema: {
          type: 'object',
          properties: { marker: { const: 'fallback' } },
          required: ['marker'],
        },
        validationSchema: fallbackSchema,
        sanitizedInput: '<untrusted_customer_data>\n{"candidates":"invalid"}\n</untrusted_customer_data>',
      });
      expect(result.object).toEqual({ marker: 'fallback' });
    });
  });

  describe('brief_scoring input-aware sample', () => {
    const briefSchema = z.object({
      outline: z.array(z.object({
        id: z.string(),
        heading: z.string(),
        purpose: z.string(),
        citations: z.array(z.string()),
      })),
      questions: z.array(z.object({ question: z.string(), citations: z.array(z.string()) })),
      score: z.number().nullable(),
      rationale: z.string().nullable(),
      citations: z.array(z.string()),
    });
    const briefInput = (payload: object): GenerateStructuredInput<z.infer<typeof briefSchema>> => ({
      ...input(),
      task: 'brief_scoring',
      jsonSchema: {
        type: 'object',
        properties: {
          outline: { type: 'array', items: { type: 'object' } },
          questions: { type: 'array', items: { type: 'object' } },
          score: { type: ['number', 'null'] },
          rationale: { type: ['string', 'null'] },
          citations: { type: 'array', items: { type: 'string' } },
        },
        required: ['outline', 'questions', 'score', 'rationale', 'citations'],
      },
      validationSchema: briefSchema,
      sanitizedInput: `<untrusted_customer_data>\n${JSON.stringify(payload)}\n</untrusted_customer_data>`,
    });

    it('uses only non-empty string ids from array-shaped evidence banks', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        briefInput({
          mode: 'brief',
          documents: [{ id: 'doc-1' }, null, { id: 7 }, { id: '' }],
          corpusRows: 'invalid',
          paaRows: [{ id: 'paa-1' }, { missing: true }],
          secondaryTerms: null,
        }),
      );
      expect(result.object.outline[0]?.citations).toEqual(['doc-1']);
      expect(result.object.questions[0]?.citations).toEqual(['paa-1']);
      expect(result.object.citations).toEqual(['doc-1', 'paa-1']);
    });

    it('returns a deterministic score for stored-corpus rescoring', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured(
        briefInput({
          mode: 'rescore',
          documents: [{ id: 'doc-1' }],
          corpusRows: [{ id: 'stat-1' }],
          secondaryTerms: [{ id: 'term-1' }],
        }),
      );
      expect(result.object).toEqual({
        outline: [],
        questions: [],
        score: 72,
        rationale: 'The guidance score uses only the stored corpus comparison.',
        citations: ['doc-1', 'stat-1', 'term-1'],
      });
    });

    it('authors brief and rescore prose in all seven locales without changing evidence ids', async () => {
      const headings: string[] = [];
      const purposes: string[] = [];
      const questions: string[] = [];
      const rationales: string[] = [];
      for (const locale of SUPPORTED_LOCALES) {
        const brief = await createFakeAiGenerationProvider().generateStructured({
          ...briefInput({
            mode: 'brief',
            documents: [{ id: 'Exact-Doc_1' }],
            paaRows: [{ id: 'Exact-PAA_1' }],
          }),
          locale,
        });
        expect(brief.object.outline[0]!.citations).toEqual(['Exact-Doc_1']);
        expect(brief.object.questions[0]!.citations).toEqual(['Exact-PAA_1']);
        headings.push(brief.object.outline[0]!.heading);
        purposes.push(brief.object.outline[0]!.purpose);
        questions.push(brief.object.questions[0]!.question);

        const rescore = await createFakeAiGenerationProvider().generateStructured({
          ...briefInput({ mode: 'rescore', documents: [{ id: 'Exact-Doc_1' }] }),
          locale,
        });
        expect(rescore.object.citations).toEqual(['Exact-Doc_1']);
        rationales.push(rescore.object.rationale!);
      }
      expect(new Set(headings).size).toBe(SUPPORTED_LOCALES.length);
      expect(new Set(purposes).size).toBe(SUPPORTED_LOCALES.length);
      expect(new Set(questions).size).toBe(SUPPORTED_LOCALES.length);
      expect(new Set(rationales).size).toBe(SUPPORTED_LOCALES.length);
    });

    it.each([
      ['malformed envelope', 'not wrapped'],
      [
        'unsupported mode',
        '<untrusted_customer_data>\n{"mode":"unsupported"}\n</untrusted_customer_data>',
      ],
    ])('falls back to the requested schema for %s', async (_caseName, sanitizedInput) => {
      const fallbackSchema = z.object({ marker: z.literal('fallback') });
      const result = await createFakeAiGenerationProvider().generateStructured({
        ...input(),
        task: 'brief_scoring',
        jsonSchema: {
          type: 'object',
          properties: { marker: { const: 'fallback' } },
          required: ['marker'],
        },
        validationSchema: fallbackSchema,
        sanitizedInput,
      });
      expect(result.object).toEqual({ marker: 'fallback' });
    });
  });

  describe('locale-aware baseline presentation samples', () => {
    const explanationSchema = z.object({
      explanation: z.string().min(1),
      citations: z.array(z.string()),
    });
    const contentBriefSchema = z.object({
      title: z.string().min(1),
      audience: z.string().min(1),
      outline: z.array(z.string().min(1)).min(1),
      citations: z.array(z.string()),
    });
    const draftSchema = z.object({
      title: z.string().min(1),
      body: z.string().min(1),
      citations: z.array(z.string()),
    });
    const comparisonSchema = z.object({
      comparison: z.string().min(1),
      citations: z.array(z.string()),
    });
    const labelsSchema = z.object({
      labels: z.array(z.object({ clusterId: z.string(), label: z.string().min(1) })),
      citations: z.array(z.string()),
    });
    const wrap = (payload: object) =>
      `<untrusted_customer_data>\n${JSON.stringify(payload)}\n</untrusted_customer_data>`;

    it('authors every baseline fake in all seven locales and preserves supplied tokens', async () => {
      const variants = {
        scorecard: [] as string[],
        opportunity: [] as string[],
        briefTitle: [] as string[],
        briefAudience: [] as string[],
        briefOutline: [] as string[],
        draftTitle: [] as string[],
        draftBody: [] as string[],
        comparison: [] as string[],
        clusterLabel: [] as string[],
      };
      for (const locale of SUPPORTED_LOCALES) {
        for (const task of ['content_scorecard_explanation', 'opportunity_explanation'] as const) {
          const result = await createFakeAiGenerationProvider().generateStructured({
            ...input(),
            task,
            locale,
            jsonSchema: { type: 'object' },
            validationSchema: explanationSchema,
            sanitizedInput: wrap({
              sources: [null, { id: 7 }, { id: '' }, { id: 'Exact-Source_1', text: 'SOURCE_BYTES' }],
            }),
          });
          expect(result.object.citations).toEqual(['Exact-Source_1']);
          variants[task === 'content_scorecard_explanation' ? 'scorecard' : 'opportunity']
            .push(result.object.explanation);
        }

        const brief = await createFakeAiGenerationProvider().generateStructured({
          ...input(),
          task: 'content_brief',
          locale,
          jsonSchema: { type: 'object' },
          validationSchema: contentBriefSchema,
          sanitizedInput: wrap({
            keyword: 'SOURCE_KEYWORD_BYTES',
            competitorSnippets: [{ id: 'Exact-Competitor_1', text: 'SOURCE_SNIPPET' }],
          }),
        });
        expect(brief.object.title).toContain('SOURCE_KEYWORD_BYTES');
        expect(brief.object.citations).toEqual(['Exact-Competitor_1']);
        variants.briefTitle.push(brief.object.title);
        variants.briefAudience.push(brief.object.audience);
        variants.briefOutline.push(brief.object.outline[0]!);

        const draft = await createFakeAiGenerationProvider().generateStructured({
          ...input(),
          task: 'content_first_draft',
          locale,
          jsonSchema: { type: 'object' },
          validationSchema: draftSchema,
          sanitizedInput: wrap({
            keyword: 'SOURCE_KEYWORD_BYTES',
            competitorSnippets: [{ id: 'Exact-Competitor_1', text: 'SOURCE_SNIPPET' }],
          }),
        });
        expect(draft.object.title).toContain('SOURCE_KEYWORD_BYTES');
        expect(draft.object.citations).toEqual(['Exact-Competitor_1']);
        variants.draftTitle.push(draft.object.title);
        variants.draftBody.push(draft.object.body);

        const comparison = await createFakeAiGenerationProvider().generateStructured({
          ...input(),
          task: 'competitor_comparison',
          locale,
          jsonSchema: { type: 'object' },
          validationSchema: comparisonSchema,
          sanitizedInput: wrap({
            competitorSnippets: [{ id: 'Exact-Competitor_1', text: 'SOURCE_SNIPPET' }],
          }),
        });
        expect(comparison.object.citations).toEqual(['Exact-Competitor_1']);
        variants.comparison.push(comparison.object.comparison);

        const labels = await createFakeAiGenerationProvider().generateStructured({
          ...input(),
          task: 'cluster_labels',
          locale,
          jsonSchema: { type: 'object' },
          validationSchema: labelsSchema,
          sanitizedInput: wrap({
            clusters: [{ id: 'cluster-1', keywords: ['SOURCE_KEYWORD_BYTES'] }, { id: 7 }],
          }),
        });
        expect(labels.object.labels).toHaveLength(1);
        expect(labels.object.labels[0]!.clusterId).toBe('cluster-1');
        variants.clusterLabel.push(labels.object.labels[0]!.label);
      }

      for (const values of Object.values(variants)) {
        expect(new Set(values).size).toBe(SUPPORTED_LOCALES.length);
      }
    });

    it('authors an explanation without inventing citations when the source bank is absent', async () => {
      const result = await createFakeAiGenerationProvider().generateStructured({
        ...input(),
        task: 'content_scorecard_explanation',
        jsonSchema: { type: 'object' },
        validationSchema: explanationSchema,
        sanitizedInput: wrap({}),
      });
      expect(result.object.citations).toEqual([]);
    });

    it.each([
      ['content_brief', contentBriefSchema, { competitorSnippets: [] }],
      ['content_first_draft', draftSchema, { competitorSnippets: [] }],
      ['cluster_labels', labelsSchema, { clusters: true }],
    ] as const)('falls back when %s lacks its required presentation input', async (task, validationSchema, payload) => {
      await expect(
        createFakeAiGenerationProvider().generateStructured({
          ...input(),
          task,
          jsonSchema: { type: 'object' },
          validationSchema: validationSchema as never,
          sanitizedInput: wrap(payload),
        }),
      ).rejects.toBeInstanceOf(AiMalformedOutputError);
    });
  });

  it('rejects a fake value that fails the repository Zod boundary', async () => {
    const badInput = { ...input(), jsonSchema: { type: 'object' } };
    await expect(createFakeAiGenerationProvider().generateStructured(badInput)).rejects.toBeInstanceOf(
      AiMalformedOutputError,
    );
  });

  it('covers schema unions, enums, consts, null, numbers, and defaults deterministically', () => {
    expect(makeFakeSchemaValue({ const: 'fixed' })).toBe('fixed');
    expect(makeFakeSchemaValue({ enum: ['first', 'second'] })).toBe('first');
    expect(makeFakeSchemaValue({ anyOf: [{ type: 'boolean' }] })).toBe(true);
    expect(makeFakeSchemaValue({ oneOf: [{ type: ['null', 'number'], minimum: 1.5 }] })).toBe(1.5);
    expect(makeFakeSchemaValue({ type: 'object', required: ['missing'] })).toEqual({ missing: 'fixture' });
    expect(makeFakeSchemaValue({ type: 'object', properties: { optional: { type: 'boolean' } } })).toEqual({ optional: true });
    expect(makeFakeSchemaValue({ type: 'array' })).toEqual(['fixture']);
    expect(makeFakeSchemaValue({ type: 'integer' })).toBe(0);
    expect(makeFakeSchemaValue({ type: 'number' })).toBe(0);
    expect(makeFakeSchemaValue({ type: 'null' })).toBeNull();
    expect(makeFakeSchemaValue({ type: 'string', format: 'email' })).toBe('fixture@example.test');
    expect(makeFakeSchemaValue({ type: 'string', format: 'uri' })).toBe('https://example.test/');
    expect(makeFakeSchemaValue({ type: 'string', format: 'date' })).toBe('2026-01-01');
    expect(makeFakeSchemaValue({})).toBe('fixture');
  });
});
