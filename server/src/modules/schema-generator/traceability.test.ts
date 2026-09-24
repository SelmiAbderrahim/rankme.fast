/**
 * Traceability post-check and the must-reject fact classes of
 * at the unit level. The same classes are re-asserted over HTTP in
 * `schema-generator.routes.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { EvidenceFact } from './evidence.js';
import { SUPPORTED_SCHEMA_TYPES } from './schema-types.registry.js';
import {
  DETERMINISTIC_PROPERTY_NAMES,
  checkTraceability,
  isDeterministicProperty,
  requestableFactFamilies,
  requestableProperties,
} from './traceability.js';

function fact(id: string, value: string, contextOnly = false): EvidenceFact {
  return { id, kind: 'first_party', label: `label ${id}`, value, contextOnly };
}

const FACTS: EvidenceFact[] = [
  fact('page.url', 'https://example.test/guide'),
  fact('page.title', 'The complete guide'),
  fact('page.metaDescription', 'A description of the guide.'),
  fact('page.h1[0]', 'The complete guide'),
  fact('page.h2[0]', 'What is it?'),
  fact('page.h2[1]', 'Step one'),
  fact('page.faqAnswers[0]', 'It is a guide.'),
  fact('site.label', 'Example Co'),
  fact('site.domain', 'example.test'),
  fact('gsc.richResults', '{"verdict":"PASS","items":[]}', true),
  fact('inventory.schemaTypes', '{"schemaTypes":[],"hasSchemaOrgArticle":false}', true),
];

describe('requestable surface', () => {
  it('offers only ai-selected, fillable properties to the model', () => {
    for (const type of SUPPORTED_SCHEMA_TYPES) {
      for (const property of requestableProperties(type)) {
        expect(property.fill).toBe('ai-selected');
        expect(property.neverFilled).toBeUndefined();
        expect(property.evidenceFactIds.length).toBeGreaterThan(0);
      }
    }
  });

  it('never offers a deterministic property', () => {
    for (const type of SUPPORTED_SCHEMA_TYPES) {
      for (const property of requestableProperties(type)) {
        expect(isDeterministicProperty(property.name)).toBe(false);
      }
    }
  });

  it('collects the union of declared evidence families per type', () => {
    expect([...requestableFactFamilies('FAQPage')].sort()).toEqual([
      'page.faqAnswers',
      'page.h2',
    ]);
    expect([...requestableFactFamilies('BreadcrumbList')]).toEqual([]);
  });

  it('lists every assembler-owned property', () => {
    expect([...DETERMINISTIC_PROPERTY_NAMES]).toContain('datePublished');
    expect([...DETERMINISTIC_PROPERTY_NAMES]).toContain('author');
    expect([...DETERMINISTIC_PROPERTY_NAMES]).toContain('itemListElement');
  });
});

describe('accepted assignments', () => {
  it('accepts an exact copy of a declared fact', () => {
    const result = checkTraceability(
      'WebPage',
      [{ property: 'name', factId: 'page.title', value: 'The complete guide' }],
      FACTS,
    );
    expect(result.accepted).toEqual([
      { property: 'name', factId: 'page.title', value: 'The complete guide' },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.omissionOverrides.size).toBe(0);
  });

  it('accepts a copy that differs only in whitespace and Unicode normal form', () => {
    const result = checkTraceability(
      'WebPage',
      [{ property: 'name', factId: 'page.title', value: '  The   complete guide  ' }],
      FACTS,
    );
    expect(result.accepted).toHaveLength(1);
  });

  it('does not override the omission reason when one assignment survived', () => {
    const result = checkTraceability(
      'WebPage',
      [
        { property: 'name', factId: 'page.h1[0]', value: 'The complete guide' },
        { property: 'name', factId: 'page.title', value: 'paraphrased title' },
      ],
      FACTS,
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.omissionOverrides.size).toBe(0);
  });
});

describe('must-reject fact classes', () => {
  it.each([
    ['invented rating', 'aggregateRating', 'page.title', '4.8', 'not_requested'],
    ['invented price', 'offers', 'page.title', '$49', 'not_requested'],
    ['invented review', 'review', 'page.h2[0]', 'Great product', 'not_requested'],
    ['invented date', 'datePublished', 'page.title', '2020-01-01', 'not_requested'],
    ['invented author', 'author', 'page.h1[0]', 'Jane Doe', 'not_requested'],
    ['hallucinated citation', 'headline', 'page.h2[99]', 'anything', 'unknown_fact'],
    ['context-fact citation', 'headline', 'gsc.richResults', 'PASS', 'context_fact'],
    ['paraphrase', 'headline', 'page.title', 'A complete guide to it', 'value_mismatch'],
  ])('drops %s', (_label, property, factId, value, rule) => {
    const result = checkTraceability('Article', [{ property, factId, value }], FACTS);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([{ property, factId, rule }]);
  });

  it('drops a citation of a fact the registry never declares for that property', () => {
    const result = checkTraceability(
      'WebPage',
      // `site.domain` is real evidence — but not for `WebPage.name`.
      [{ property: 'name', factId: 'site.domain', value: 'example.test' }],
      FACTS,
    );
    expect(result.rejected).toEqual([
      { property: 'name', factId: 'site.domain', rule: 'undeclared_evidence' },
    ]);
  });

  it('marks a requested property whose every assignment was rejected as ambiguous', () => {
    const result = checkTraceability(
      'WebPage',
      [{ property: 'description', factId: 'page.metaDescription', value: 'reworded' }],
      FACTS,
    );
    expect(result.omissionOverrides.get('description')).toBe('evidence_ambiguous');
  });

  it('leaves a deterministic property with NO override so it stays an honest no_evidence gap', () => {
    const result = checkTraceability(
      'Article',
      [{ property: 'datePublished', factId: 'page.title', value: 'The complete guide' }],
      FACTS,
    );
    expect(result.omissionOverrides.has('datePublished')).toBe(false);
  });

  it('drops an assignment citing a context fact even when it is not on the frozen id list', () => {
    const result = checkTraceability(
      'WebPage',
      [{ property: 'name', factId: 'page.title', value: 'ctx' }],
      [fact('page.title', 'ctx', true)],
    );
    expect(result.rejected).toEqual([
      { property: 'name', factId: 'page.title', rule: 'context_fact' },
    ]);
  });
});
