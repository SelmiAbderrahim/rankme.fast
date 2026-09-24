/**
 * Supported-type registry — five core invariants.
 */
import { describe, expect, it } from 'vitest';
import {
  MUST_REJECT_PROPERTY_NAMES,
  MAX_SCHEMA_PROPERTIES,
  OMISSION_REASONS,
  SCHEMA_REGISTRY_VERSION,
  SCHEMA_TYPE_REGISTRY,
  SUPPORTED_SCHEMA_TYPES,
  factFamily,
  isSupportedSchemaType,
  recommendedProperties,
  requiredProperties,
  schemaTypeDefinition,
  type SupportedSchemaType,
} from './schema-types.registry.js';

interface ExpectedProperty {
  name: string;
  class: 'required' | 'recommended';
  fill: 'deterministic' | 'ai-selected';
  evidenceFactIds: string[];
  neverFilled?: true;
}

const EXPECTED: Record<SupportedSchemaType, ExpectedProperty[]> = {
  WebPage: [
    { name: 'name', class: 'required', fill: 'ai-selected', evidenceFactIds: ['page.title', 'page.h1'] },
    { name: 'url', class: 'required', fill: 'deterministic', evidenceFactIds: ['page.canonical', 'page.url'] },
    { name: 'description', class: 'recommended', fill: 'ai-selected', evidenceFactIds: ['page.metaDescription'] },
    { name: 'inLanguage', class: 'recommended', fill: 'deterministic', evidenceFactIds: ['page.language'] },
    { name: 'isPartOf', class: 'recommended', fill: 'deterministic', evidenceFactIds: ['site.origin'] },
    { name: 'primaryImageOfPage', class: 'recommended', fill: 'deterministic', evidenceFactIds: [], neverFilled: true },
  ],
  WebSite: [
    { name: 'name', class: 'required', fill: 'ai-selected', evidenceFactIds: ['site.label', 'site.domain'] },
    { name: 'url', class: 'required', fill: 'deterministic', evidenceFactIds: ['site.origin'] },
    { name: 'description', class: 'recommended', fill: 'ai-selected', evidenceFactIds: ['page.metaDescription'] },
    { name: 'inLanguage', class: 'recommended', fill: 'deterministic', evidenceFactIds: ['page.language'] },
  ],
  Organization: [
    { name: 'name', class: 'required', fill: 'ai-selected', evidenceFactIds: ['site.label', 'site.domain'] },
    { name: 'url', class: 'required', fill: 'deterministic', evidenceFactIds: ['site.origin'] },
    { name: 'description', class: 'recommended', fill: 'ai-selected', evidenceFactIds: ['page.metaDescription'] },
    { name: 'logo', class: 'recommended', fill: 'deterministic', evidenceFactIds: [], neverFilled: true },
    { name: 'sameAs', class: 'recommended', fill: 'deterministic', evidenceFactIds: [], neverFilled: true },
  ],
  Article: [
    { name: 'headline', class: 'required', fill: 'ai-selected', evidenceFactIds: ['page.h1', 'page.title'] },
    { name: 'author', class: 'required', fill: 'deterministic', evidenceFactIds: ['site.label', 'site.domain'] },
    {
      name: 'datePublished',
      class: 'required',
      fill: 'deterministic',
      evidenceFactIds: ['page.articlePublishedTime'],
    },
    { name: 'description', class: 'recommended', fill: 'ai-selected', evidenceFactIds: ['page.metaDescription'] },
    {
      name: 'dateModified',
      class: 'recommended',
      fill: 'deterministic',
      evidenceFactIds: ['page.articleModifiedTime'],
    },
    {
      name: 'mainEntityOfPage',
      class: 'recommended',
      fill: 'deterministic',
      evidenceFactIds: ['page.canonical', 'page.url'],
    },
    { name: 'inLanguage', class: 'recommended', fill: 'deterministic', evidenceFactIds: ['page.language'] },
    { name: 'image', class: 'recommended', fill: 'deterministic', evidenceFactIds: [], neverFilled: true },
  ],
  BreadcrumbList: [
    {
      name: 'itemListElement',
      class: 'required',
      fill: 'deterministic',
      evidenceFactIds: ['page.url', 'site.origin', 'site.label', 'site.domain'],
    },
  ],
  FAQPage: [
    {
      name: 'mainEntity',
      class: 'required',
      fill: 'ai-selected',
      evidenceFactIds: ['page.h2', 'page.faqAnswers'],
    },
  ],
  HowTo: [
    { name: 'name', class: 'required', fill: 'ai-selected', evidenceFactIds: ['page.h1', 'page.title'] },
    { name: 'step', class: 'required', fill: 'ai-selected', evidenceFactIds: ['page.h2'] },
    { name: 'description', class: 'recommended', fill: 'ai-selected', evidenceFactIds: ['page.metaDescription'] },
    { name: 'totalTime', class: 'recommended', fill: 'deterministic', evidenceFactIds: [], neverFilled: true },
    { name: 'estimatedCost', class: 'recommended', fill: 'deterministic', evidenceFactIds: [], neverFilled: true },
    { name: 'supply', class: 'recommended', fill: 'deterministic', evidenceFactIds: [], neverFilled: true },
    { name: 'tool', class: 'recommended', fill: 'deterministic', evidenceFactIds: [], neverFilled: true },
  ],
};

describe('registry shape', () => {
  it('is pinned at version 1 with the seven v1 types in declaration order', () => {
    expect(SCHEMA_REGISTRY_VERSION).toBe('1');
    expect([...SUPPORTED_SCHEMA_TYPES]).toEqual([
      'WebPage',
      'WebSite',
      'Organization',
      'Article',
      'BreadcrumbList',
      'FAQPage',
      'HowTo',
    ]);
    expect(Object.keys(SCHEMA_TYPE_REGISTRY)).toEqual([...SUPPORTED_SCHEMA_TYPES]);
  });

  it('freezes the omission reason vocabulary', () => {
    expect([...OMISSION_REASONS]).toEqual(['no_evidence', 'evidence_ambiguous', 'not_applicable']);
  });

  it.each(SUPPORTED_SCHEMA_TYPES)('%s declares exactly the pinned property table', (type) => {
    expect(
      schemaTypeDefinition(type).properties.map((property) => ({
        name: property.name,
        class: property.class,
        fill: property.fill,
        evidenceFactIds: [...property.evidenceFactIds],
        ...(property.neverFilled === true ? { neverFilled: true as const } : {}),
      })),
    ).toEqual(EXPECTED[type]);
    expect(schemaTypeDefinition(type).type).toBe(type);
  });

  it.each(SUPPORTED_SCHEMA_TYPES)('%s splits required and recommended consistently', (type) => {
    expect(requiredProperties(type).map((p) => p.name)).toEqual(
      EXPECTED[type].filter((p) => p.class === 'required').map((p) => p.name),
    );
    expect(recommendedProperties(type).map((p) => p.name)).toEqual(
      EXPECTED[type].filter((p) => p.class === 'recommended').map((p) => p.name),
    );
  });
});

describe('registry invariants', () => {
  it.each(SUPPORTED_SCHEMA_TYPES)('1. %s declares at least one required property', (type) => {
    expect(requiredProperties(type).length).toBeGreaterThan(0);
  });

  it.each(SUPPORTED_SCHEMA_TYPES)('2. %s has no third evidence state', (type) => {
    for (const property of schemaTypeDefinition(type).properties) {
      if (property.neverFilled === true) expect(property.evidenceFactIds).toEqual([]);
      else expect(property.evidenceFactIds.length).toBeGreaterThan(0);
    }
  });

  it.each(SUPPORTED_SCHEMA_TYPES)('3. %s declares no must-reject property name', (type) => {
    for (const property of schemaTypeDefinition(type).properties) {
      expect(MUST_REJECT_PROPERTY_NAMES).not.toContain(property.name);
    }
  });

  it.each(SUPPORTED_SCHEMA_TYPES)('4. %s has an empty required ∩ recommended set', (type) => {
    const required = new Set(requiredProperties(type).map((p) => p.name));
    const recommended = recommendedProperties(type).map((p) => p.name);
    expect(recommended.filter((name) => required.has(name))).toEqual([]);
  });

  it.each(SUPPORTED_SCHEMA_TYPES)('5. %s declares each property name once, in a stable order', (type) => {
    const names = schemaTypeDefinition(type).properties.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(schemaTypeDefinition(type).properties.map((p) => p.name));
  });

  it.each(SUPPORTED_SCHEMA_TYPES)('6. %s stays within the server property ceiling', (type) => {
    expect(schemaTypeDefinition(type).properties.length).toBeLessThanOrEqual(MAX_SCHEMA_PROPERTIES);
  });

  it('makes Article the type that reports a datePublished gap without a fetched date', () => {
    const datePublished = requiredProperties('Article').find((p) => p.name === 'datePublished');
    expect(datePublished?.evidenceFactIds).toEqual(['page.articlePublishedTime']);
  });
});

describe('helpers', () => {
  it.each([
    ['page.h2[3]', 'page.h2'],
    ['page.faqAnswers[10]', 'page.faqAnswers'],
    ['page.title', 'page.title'],
    ['page.h1[x]', 'page.h1[x]'],
  ])('factFamily(%s) is %s', (input, expected) => {
    expect(factFamily(input)).toBe(expected);
  });

  it('recognises supported types only', () => {
    expect(isSupportedSchemaType('WebPage')).toBe(true);
    expect(isSupportedSchemaType('Product')).toBe(false);
  });
});
