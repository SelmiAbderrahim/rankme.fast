/**
 * JSON-LD document assembler — deterministic fills and the rule
 * that AI output never reaches the payload directly.
 */
import { describe, expect, it } from 'vitest';
import { serializeJsonLd } from '../../shared/security/json-ld.js';
import {
  BREADCRUMB_MAX_ITEMS,
  FAQ_MAX_PAIRS,
  HOWTO_MAX_STEPS,
  SCHEMA_CONTEXT,
  buildSchemaDocument,
  normalizeFactValue,
  type AcceptedAssignment,
} from './document.js';
import type { EvidenceFact } from './evidence.js';
import type { OmissionReason } from './schema-types.registry.js';

function fact(id: string, value: string, contextOnly = false): EvidenceFact {
  return { id, kind: 'first_party', label: `Label for ${id}`, value, contextOnly };
}

const PAGE_FACTS: EvidenceFact[] = [
  fact('page.url', 'https://example.com/guides/getting-started'),
  fact('page.canonical', 'https://example.com/guides/getting-started/'),
  fact('page.title', 'Getting started with rank tracking'),
  fact('page.metaDescription', 'A short plain-language walk-through.'),
  fact('page.h1[0]', 'Getting started'),
  fact('page.h2[0]', 'How do I add a site?'),
  fact('page.h2[1]', 'Add your first site'),
  fact('page.h2[2]', 'Run your first audit'),
  fact('page.faqAnswers[0]', 'Open the sites tab and paste your domain.'),
  fact('page.language', 'en'),
  fact('page.articlePublishedTime', '2026-01-04T09:00:00Z'),
  fact('page.articleModifiedTime', '2026-02-04T09:00:00Z'),
  fact('site.origin', 'https://example.com'),
  fact('site.domain', 'example.com'),
  fact('site.label', 'Example Docs'),
  fact('detector.structuredData', '{"present":false,"errors":0}', true),
  fact('gsc.richResults', '{"verdict":"NEUTRAL","items":[]}', true),
  fact('inventory.schemaTypes', '{"schemaTypes":[],"hasSchemaOrgArticle":false}', true),
];

describe('normalizeFactValue', () => {
  it('collapses whitespace, trims, and normalizes to NFC', () => {
    expect(normalizeFactValue('  a\n\t b  ')).toBe('a b');
    expect(normalizeFactValue('é')).toBe('é');
  });
});

describe('deterministic fills', () => {
  it('prefers the canonical URL and wraps isPartOf/inLanguage for WebPage', () => {
    const built = buildSchemaDocument(
      'WebPage',
      [
        { property: 'name', factId: 'page.title', value: 'Getting started with rank tracking' },
        { property: 'description', factId: 'page.metaDescription', value: 'A short plain-language walk-through.' },
      ],
      PAGE_FACTS,
    );
    expect(built.document).toEqual({
      '@context': SCHEMA_CONTEXT,
      '@type': 'WebPage',
      name: 'Getting started with rank tracking',
      url: 'https://example.com/guides/getting-started/',
      description: 'A short plain-language walk-through.',
      inLanguage: 'en',
      isPartOf: { '@type': 'WebSite', url: 'https://example.com' },
    });
    expect(built.omissions).toEqual([
      { property: 'primaryImageOfPage', reasonCode: 'no_evidence', class: 'recommended' },
    ]);
    expect(built.evidence).toContainEqual({
      property: 'url',
      factId: 'page.canonical',
      factLabel: 'Label for page.canonical',
      value: 'https://example.com/guides/getting-started/',
    });
  });

  it('falls back to page.url when no canonical fact exists', () => {
    const built = buildSchemaDocument(
      'WebPage',
      [],
      PAGE_FACTS.filter((entry) => entry.id !== 'page.canonical'),
    );
    expect(built.document.url).toBe('https://example.com/guides/getting-started');
  });

  it('omits every deterministic property when its facts are absent', () => {
    const built = buildSchemaDocument('WebPage', [], [fact('page.title', 'Only a title')]);
    expect(built.emittedProperties).toEqual([]);
    expect(built.omissions.map((entry) => entry.property)).toEqual([
      'name',
      'url',
      'description',
      'inLanguage',
      'isPartOf',
      'primaryImageOfPage',
    ]);
  });

  it('fills Article author as an Organization and never as a person', () => {
    const built = buildSchemaDocument(
      'Article',
      [{ property: 'headline', factId: 'page.h1[0]', value: 'Getting started' }],
      PAGE_FACTS,
    );
    expect(built.document.author).toEqual({ '@type': 'Organization', name: 'Example Docs' });
    expect(built.document.datePublished).toBe('2026-01-04T09:00:00Z');
    expect(built.document.dateModified).toBe('2026-02-04T09:00:00Z');
    expect(built.document.mainEntityOfPage).toBe('https://example.com/guides/getting-started/');
    expect(built.omissions).toEqual([
      { property: 'description', reasonCode: 'no_evidence', class: 'recommended' },
      { property: 'image', reasonCode: 'no_evidence', class: 'recommended' },
    ]);
  });

  it('falls back to the site domain when the site has no label', () => {
    const built = buildSchemaDocument(
      'Article',
      [],
      PAGE_FACTS.filter((entry) => entry.id !== 'site.label'),
    );
    expect(built.document.author).toEqual({ '@type': 'Organization', name: 'example.com' });
  });

  it('omits the author entirely when the site has neither a label nor a domain', () => {
    const built = buildSchemaDocument(
      'Article',
      [],
      PAGE_FACTS.filter((entry) => entry.id !== 'site.label' && entry.id !== 'site.domain'),
    );
    expect(built.document.author).toBeUndefined();
    expect(built.omissions).toContainEqual({
      property: 'author',
      reasonCode: 'no_evidence',
      class: 'required',
    });
  });

  it('reports datePublished as a required gap without a fetched publication date', () => {
    const built = buildSchemaDocument(
      'Article',
      [{ property: 'headline', factId: 'page.h1[0]', value: 'Getting started' }],
      PAGE_FACTS.filter((entry) => entry.id !== 'page.articlePublishedTime'),
    );
    expect(built.document.datePublished).toBeUndefined();
    expect(built.omissions).toContainEqual({
      property: 'datePublished',
      reasonCode: 'no_evidence',
      class: 'required',
    });
  });
});

describe('WebSite description scope', () => {
  it('fills the description on the home page', () => {
    const built = buildSchemaDocument(
      'WebSite',
      [
        { property: 'name', factId: 'site.label', value: 'Example Docs' },
        { property: 'description', factId: 'page.metaDescription', value: 'A short plain-language walk-through.' },
      ],
      [...PAGE_FACTS.filter((entry) => entry.id !== 'page.url'), fact('page.url', 'https://example.com/')],
    );
    expect(built.document.description).toBe('A short plain-language walk-through.');
    expect(built.omissions).toEqual([]);
  });

  it('marks the description not_applicable away from the home page', () => {
    const built = buildSchemaDocument(
      'WebSite',
      [
        { property: 'name', factId: 'site.label', value: 'Example Docs' },
        { property: 'description', factId: 'page.metaDescription', value: 'A short plain-language walk-through.' },
      ],
      PAGE_FACTS,
    );
    expect(built.document.description).toBeUndefined();
    expect(built.omissions).toEqual([
      { property: 'description', reasonCode: 'not_applicable', class: 'recommended' },
    ]);
  });

  it.each([
    ['a missing page.url fact', PAGE_FACTS.filter((entry) => entry.id !== 'page.url')],
    ['an unparseable page.url fact', [...PAGE_FACTS.filter((e) => e.id !== 'page.url'), fact('page.url', 'not a url')]],
  ])('treats %s as not-the-home-page', (_label, facts) => {
    const built = buildSchemaDocument(
      'WebSite',
      [{ property: 'description', factId: 'page.metaDescription', value: 'A short plain-language walk-through.' }],
      facts,
    );
    expect(built.document.description).toBeUndefined();
  });
});

describe('BreadcrumbList derivation', () => {
  it('derives an origin item plus one item per path segment', () => {
    const built = buildSchemaDocument('BreadcrumbList', [], PAGE_FACTS);
    expect(built.document.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Example Docs', item: 'https://example.com' },
      { '@type': 'ListItem', position: 2, name: 'Guides', item: 'https://example.com/guides' },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Getting Started',
        item: 'https://example.com/guides/getting-started',
      },
    ]);
    expect(built.evidence).toEqual([
      {
        property: 'itemListElement',
        factId: 'page.url',
        factLabel: 'Label for page.url',
        value: 'https://example.com/guides/getting-started',
      },
      {
        property: 'itemListElement',
        factId: 'site.origin',
        factLabel: 'Label for site.origin',
        value: 'https://example.com',
      },
      {
        property: 'itemListElement',
        factId: 'site.label',
        factLabel: 'Label for site.label',
        value: 'Example Docs',
      },
    ]);
  });

  it('humanizes underscores and hyphens per word', () => {
    const built = buildSchemaDocument('BreadcrumbList', [], [
      fact('page.url', 'https://example.com/help_center/rank-tracking_basics'),
      fact('site.origin', 'https://example.com'),
      fact('site.label', 'Example Docs'),
    ]);
    expect((built.document.itemListElement as { name: string }[]).map((item) => item.name)).toEqual([
      'Example Docs',
      'Help Center',
      'Rank Tracking Basics',
    ]);
  });

  it(`caps the list at ${BREADCRUMB_MAX_ITEMS} items`, () => {
    const built = buildSchemaDocument('BreadcrumbList', [], [
      fact('page.url', `https://example.com/${Array.from({ length: 12 }, (_, i) => `s${i}`).join('/')}`),
      fact('site.origin', 'https://example.com/'),
      fact('site.domain', 'example.com'),
    ]);
    const items = built.document.itemListElement as { position: number; item: string }[];
    expect(items).toHaveLength(BREADCRUMB_MAX_ITEMS);
    expect(items.at(-1)).toEqual({
      '@type': 'ListItem',
      position: 8,
      name: 'S6',
      item: 'https://example.com/s0/s1/s2/s3/s4/s5/s6',
    });
  });

  it('reports a required gap on a root-path page', () => {
    const built = buildSchemaDocument('BreadcrumbList', [], [
      fact('page.url', 'https://example.com/'),
      fact('site.origin', 'https://example.com'),
      fact('site.label', 'Example Docs'),
    ]);
    expect(built.document.itemListElement).toBeUndefined();
    expect(built.omissions).toEqual([
      { property: 'itemListElement', reasonCode: 'no_evidence', class: 'required' },
    ]);
  });

  it('falls back to the parsed origin and hostname without site facts', () => {
    const built = buildSchemaDocument('BreadcrumbList', [], [
      fact('page.url', 'https://docs.example.com/a/b'),
    ]);
    expect((built.document.itemListElement as { name: string; item: string }[])[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      name: 'docs.example.com',
      item: 'https://docs.example.com',
    });
  });

  it.each([
    ['no page.url fact', [] as EvidenceFact[]],
    ['an unparseable page.url fact', [fact('page.url', '://nope')]],
  ])('omits the list with %s', (_label, facts) => {
    const built = buildSchemaDocument('BreadcrumbList', [], facts);
    expect(built.document.itemListElement).toBeUndefined();
  });
});

describe('FAQPage pairing', () => {
  const questionAssignment: AcceptedAssignment = {
    property: 'mainEntity',
    factId: 'page.h2[0]',
    value: 'How do I add a site?',
  };
  const answerAssignment: AcceptedAssignment = {
    property: 'mainEntity',
    factId: 'page.faqAnswers[0]',
    value: 'Open the sites tab and paste your domain.',
  };
  // Deliberately reversed: the assembler joins evidence indices, never model order.
  const pairAssignments: AcceptedAssignment[] = [answerAssignment, questionAssignment];

  it('admits a pair only when both halves have evidence', () => {
    const built = buildSchemaDocument('FAQPage', pairAssignments, PAGE_FACTS);
    expect(built.document.mainEntity).toEqual([
      {
        '@type': 'Question',
        name: 'How do I add a site?',
        acceptedAnswer: { '@type': 'Answer', text: 'Open the sites tab and paste your domain.' },
      },
    ]);
    expect(built.evidence.map((row) => row.factId)).toEqual(['page.h2[0]', 'page.faqAnswers[0]']);
  });

  it.each([
    ['the question heading is not question-shaped', [
      { property: 'mainEntity', factId: 'page.h2[1]', value: 'Add your first site' },
      { property: 'mainEntity', factId: 'page.faqAnswers[0]', value: 'Open the sites tab and paste your domain.' },
    ]],
    ['no answer fact is cited', [questionAssignment]],
    ['only an answer fact is cited', [answerAssignment]],
  ])('omits mainEntity when %s', (_label, assignments) => {
    const built = buildSchemaDocument('FAQPage', assignments, PAGE_FACTS);
    expect(built.document.mainEntity).toBeUndefined();
    expect(built.omissions).toEqual([
      { property: 'mainEntity', reasonCode: 'no_evidence', class: 'required' },
    ]);
  });

  it('rejects real question and answer facts whose source indices differ', () => {
    const mismatchedFacts = [
      ...PAGE_FACTS,
      fact('page.faqAnswers[1]', 'An answer for a different heading.'),
    ];
    const built = buildSchemaDocument(
      'FAQPage',
      [
        questionAssignment,
        {
          property: 'mainEntity',
          factId: 'page.faqAnswers[1]',
          value: 'An answer for a different heading.',
        },
      ],
      mismatchedFacts,
    );
    expect(built.document.mainEntity).toBeUndefined();
  });

  it('ignores otherwise valid FAQ facts that have no source index', () => {
    const facts = [
      fact('page.h2', 'How does this work?'),
      fact('page.faqAnswers', 'It needs an indexed source pair.'),
    ];
    const built = buildSchemaDocument(
      'FAQPage',
      [
        { property: 'mainEntity', factId: 'page.h2', value: 'How does this work?' },
        {
          property: 'mainEntity',
          factId: 'page.faqAnswers',
          value: 'It needs an indexed source pair.',
        },
      ],
      facts,
    );
    expect(built.document.mainEntity).toBeUndefined();
  });

  it(`caps the list at ${FAQ_MAX_PAIRS} pairs`, () => {
    const facts: EvidenceFact[] = [];
    const assignments: AcceptedAssignment[] = [];
    for (let index = 0; index < FAQ_MAX_PAIRS + 2; index += 1) {
      facts.push(fact(`page.h2[${index}]`, `Question ${index}?`));
      facts.push(fact(`page.faqAnswers[${index}]`, `Answer ${index}`));
      assignments.push({ property: 'mainEntity', factId: `page.h2[${index}]`, value: `Question ${index}?` });
      assignments.push({ property: 'mainEntity', factId: `page.faqAnswers[${index}]`, value: `Answer ${index}` });
    }
    const built = buildSchemaDocument('FAQPage', assignments, facts);
    expect(built.document.mainEntity).toHaveLength(FAQ_MAX_PAIRS);
  });
});

describe('HowTo steps', () => {
  const stepAssignments: AcceptedAssignment[] = [
    { property: 'name', factId: 'page.h1[0]', value: 'Getting started' },
    { property: 'step', factId: 'page.h2[1]', value: 'Add your first site' },
    { property: 'step', factId: 'page.h2[2]', value: 'Run your first audit' },
  ];

  it('deduplicates and numbers steps by stored heading order, never model order', () => {
    const built = buildSchemaDocument(
      'HowTo',
      [
        stepAssignments[0]!,
        stepAssignments[2]!,
        stepAssignments[1]!,
        stepAssignments[1]!,
        // A hostile assignment naming a position is simply ignored — `position`
        // is not a registry property.
        { property: 'position', factId: 'page.h2[0]', value: '99' },
      ],
      PAGE_FACTS,
    );
    expect(built.document.step).toEqual([
      { '@type': 'HowToStep', position: 1, name: 'Add your first site' },
      { '@type': 'HowToStep', position: 2, name: 'Run your first audit' },
    ]);
    expect(built.document).not.toHaveProperty('position');
    expect(built.omissions.map((entry) => entry.property)).toEqual([
      'description',
      'totalTime',
      'estimatedCost',
      'supply',
      'tool',
    ]);
  });

  it('omits step when fewer than two headings are cited', () => {
    const built = buildSchemaDocument(
      'HowTo',
      [
        stepAssignments[1]!,
        stepAssignments[1]!,
        { property: 'step', factId: 'page.h2', value: 'Unindexed heading' },
      ],
      [...PAGE_FACTS, fact('page.h2', 'Unindexed heading')],
    );
    expect(built.document.step).toBeUndefined();
  });

  it(`caps steps at ${HOWTO_MAX_STEPS}`, () => {
    const facts: EvidenceFact[] = [];
    const assignments: AcceptedAssignment[] = [];
    for (let index = 0; index < HOWTO_MAX_STEPS + 3; index += 1) {
      facts.push(fact(`page.h2[${index}]`, `Step ${index}`));
      assignments.push({ property: 'step', factId: `page.h2[${index}]`, value: `Step ${index}` });
    }
    const built = buildSchemaDocument('HowTo', assignments, facts);
    expect(built.document.step).toHaveLength(HOWTO_MAX_STEPS);
  });
});

describe('assignment re-checks', () => {
  it.each([
    ['a fact family the registry does not declare for the property', {
      property: 'name',
      factId: 'site.label',
      value: 'Example Docs',
    }],
    ['a hallucinated fact id', { property: 'name', factId: 'page.title[9]', value: 'anything' }],
    ['a paraphrase of the cited fact', {
      property: 'name',
      factId: 'page.title',
      value: 'Getting started with tracking ranks',
    }],
    ['a context-only fact', { property: 'name', factId: 'detector.structuredData', value: '{}' }],
  ])('drops an assignment citing %s', (_label, assignment) => {
    const built = buildSchemaDocument('WebPage', [assignment as AcceptedAssignment], PAGE_FACTS);
    expect(built.document.name).toBeUndefined();
    expect(built.omissions).toContainEqual({
      property: 'name',
      reasonCode: 'no_evidence',
      class: 'required',
    });
  });

  it('accepts a value that differs from the fact only by whitespace, and emits the fact', () => {
    const built = buildSchemaDocument(
      'WebPage',
      [{ property: 'name', factId: 'page.title', value: '  Getting started   with rank tracking ' }],
      PAGE_FACTS,
    );
    expect(built.document.name).toBe('Getting started with rank tracking');
  });

  it('honours refined omission reasons from the AI post-check', () => {
    const overrides = new Map<string, OmissionReason>([['name', 'evidence_ambiguous']]);
    const built = buildSchemaDocument('WebPage', [], PAGE_FACTS, overrides);
    expect(built.omissions).toContainEqual({
      property: 'name',
      reasonCode: 'evidence_ambiguous',
      class: 'required',
    });
  });
});

describe('determinism', () => {
  it('serializes byte-identically across two runs over identical facts', () => {
    const assignments: AcceptedAssignment[] = [
      { property: 'name', factId: 'page.title', value: 'Getting started with rank tracking' },
      { property: 'description', factId: 'page.metaDescription', value: 'A short plain-language walk-through.' },
    ];
    const first = serializeJsonLd(buildSchemaDocument('WebPage', assignments, PAGE_FACTS).document);
    const second = serializeJsonLd(buildSchemaDocument('WebPage', assignments, PAGE_FACTS).document);
    expect(first).toBe(second);
  });

  it('emits properties in registry declaration order', () => {
    const built = buildSchemaDocument(
      'Article',
      [
        { property: 'description', factId: 'page.metaDescription', value: 'A short plain-language walk-through.' },
        { property: 'headline', factId: 'page.h1[0]', value: 'Getting started' },
      ],
      PAGE_FACTS,
    );
    expect(Object.keys(built.document)).toEqual([
      '@context',
      '@type',
      'headline',
      'author',
      'datePublished',
      'description',
      'dateModified',
      'mainEntityOfPage',
      'inLanguage',
    ]);
    expect(built.emittedProperties).toEqual([
      'headline',
      'author',
      'datePublished',
      'description',
      'dateModified',
      'mainEntityOfPage',
      'inLanguage',
    ]);
  });
});
