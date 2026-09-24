/**
 * Safe JSON-LD serializer.
 *
 * Covers the per-character encoding table, the round trip, the seven-type XSS
 * suite over real assembled documents, and the repository-wide grep that no
 * module builds JSON-LD by string concatenation.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JSON_LD_MEDIA_TYPE, MAX_JSON_LD_PAYLOAD_BYTES, serializeJsonLd } from './json-ld.js';
import {
  buildSchemaDocument,
  type AcceptedAssignment,
} from '../../modules/schema-generator/document.js';
import { EVIDENCE_LIMITS, type EvidenceFact } from '../../modules/schema-generator/evidence.js';
import { SUPPORTED_SCHEMA_TYPES } from '../../modules/schema-generator/schema-types.registry.js';

const LINE_SEPARATOR = '\u2028';
const PARAGRAPH_SEPARATOR = '\u2029';

function unescapeForParse(payload: string): string {
  return payload
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\u2028/g, LINE_SEPARATOR)
    .replace(/\\u2029/g, PARAGRAPH_SEPARATOR);
}

describe('serializeJsonLd', () => {
  it('exposes the JSON-LD media type', () => {
    expect(JSON_LD_MEDIA_TYPE).toBe('application/ld+json');
  });

  it.each([
    ['<', '\\u003c'],
    ['>', '\\u003e'],
    ['&', '\\u0026'],
    [LINE_SEPARATOR, '\\u2028'],
    [PARAGRAPH_SEPARATOR, '\\u2029'],
  ])('escapes %j as %s', (character, escaped) => {
    const payload = serializeJsonLd({ value: `a${character}b` });
    expect(payload).toContain(escaped);
    expect(payload).not.toContain(character);
  });

  it('round-trips through unescaping and JSON.parse', () => {
    const input = {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: `</script><script>alert(1)</script>${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}&{}`,
      nested: { list: ['<img onerror=alert(1)>', 'plain'] },
    };
    expect(JSON.parse(unescapeForParse(serializeJsonLd(input)))).toEqual(input);
  });

  it('leaves ordinary characters as JSON.stringify emits them', () => {
    expect(serializeJsonLd({ a: 1, b: 'plain', c: null })).toBe('{"a":1,"b":"plain","c":null}');
  });
  it('rejects an escaped payload above the server byte ceiling', () => {
    expect(() => serializeJsonLd({ value: 'x'.repeat(MAX_JSON_LD_PAYLOAD_BYTES) })).toThrow(
      'serialized JSON-LD exceeds the payload ceiling',
    );
  });
});

// ---------------------------------------------------------------------------
// SEC-OUT-1 — seven-type XSS suite over real assembled documents.
// ---------------------------------------------------------------------------

const HOSTILE = `</script><script>alert(1)</script> <img onerror=alert(1)> ${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR} &{}`;

function hostileFact(id: string, value = HOSTILE): EvidenceFact {
  return { id, kind: 'first_party', label: `label ${HOSTILE}`, value, contextOnly: false };
}

function hostileFacts(pageUrl: string): EvidenceFact[] {
  return [
    hostileFact('page.url', pageUrl),
    hostileFact('page.canonical', pageUrl),
    hostileFact('page.title'),
    hostileFact('page.metaDescription'),
    hostileFact('page.h1[0]'),
    hostileFact('page.h2[0]', `${HOSTILE}?`),
    hostileFact('page.h2[1]', `${HOSTILE} two?`),
    hostileFact('page.faqAnswers[0]'),
    hostileFact('page.language', 'en'),
    hostileFact('page.articlePublishedTime', '2026-01-01T00:00:00Z'),
    hostileFact('page.articleModifiedTime', '2026-02-01T00:00:00Z'),
    hostileFact('site.origin', 'https://example.com'),
    hostileFact('site.domain'),
    hostileFact('site.label'),
  ];
}

function hostileAssignments(facts: readonly EvidenceFact[]): AcceptedAssignment[] {
  const valueOf = (id: string) => facts.find((fact) => fact.id === id)!.value;
  return [
    { property: 'name', factId: 'page.title', value: valueOf('page.title') },
    { property: 'headline', factId: 'page.h1[0]', value: valueOf('page.h1[0]') },
    { property: 'description', factId: 'page.metaDescription', value: valueOf('page.metaDescription') },
    { property: 'mainEntity', factId: 'page.h2[0]', value: valueOf('page.h2[0]') },
    { property: 'mainEntity', factId: 'page.faqAnswers[0]', value: valueOf('page.faqAnswers[0]') },
    { property: 'step', factId: 'page.h2[0]', value: valueOf('page.h2[0]') },
    { property: 'step', factId: 'page.h2[1]', value: valueOf('page.h2[1]') },
  ];
}

describe('seven-type XSS suite', () => {
  it.each(SUPPORTED_SCHEMA_TYPES)('%s serializes inert', (type) => {
    // `WebSite.name` cites a site fact and `WebSite.description` is home-page
    // only, so that one type is fed the site root.
    const pageUrl = type === 'WebSite' ? 'https://example.com/' : 'https://example.com/guide/step-one';
    const facts = hostileFacts(pageUrl);
    const assignments: AcceptedAssignment[] = [
      ...hostileAssignments(facts),
      { property: 'name', factId: 'site.label', value: facts.find((f) => f.id === 'site.label')!.value },
    ];
    const built = buildSchemaDocument(type, assignments, facts);
    const payload = serializeJsonLd(built.document);

    expect(payload).not.toContain('</script>');
    expect(payload).not.toContain('<script');
    expect(payload).not.toContain('<');
    expect(payload).not.toContain('>');
    expect(payload).not.toContain('&');
    expect(payload).not.toContain(LINE_SEPARATOR);
    expect(payload).not.toContain(PARAGRAPH_SEPARATOR);
    expect(JSON.parse(unescapeForParse(payload))).toEqual(built.document);
    expect(built.emittedProperties.length).toBeGreaterThan(0);
  });
  it('keeps the largest bounded FAQ document below the payload ceiling', () => {
    const facts: EvidenceFact[] = [];
    const assignments: AcceptedAssignment[] = [];
    for (let index = 0; index < EVIDENCE_LIMITS.faqAnswerCount; index += 1) {
      const question = `${'<'.repeat(EVIDENCE_LIMITS.h2Chars - 1)}?`;
      const answer = '<'.repeat(EVIDENCE_LIMITS.faqAnswerChars);
      facts.push(hostileFact(`page.h2[${index}]`, question));
      facts.push(hostileFact(`page.faqAnswers[${index}]`, answer));
      assignments.push({
        property: 'mainEntity',
        factId: `page.h2[${index}]`,
        value: question,
      });
      assignments.push({
        property: 'mainEntity',
        factId: `page.faqAnswers[${index}]`,
        value: answer,
      });
    }
    const payload = serializeJsonLd(buildSchemaDocument('FAQPage', assignments, facts).document);
    expect(Buffer.byteLength(payload, 'utf8')).toBeLessThanOrEqual(MAX_JSON_LD_PAYLOAD_BYTES);
  });
});

// ---------------------------------------------------------------------------
// SEC-OUT-2 — no module builds JSON-LD by concatenation.
// ---------------------------------------------------------------------------

const LD_JSON_ALLOW_LIST = [
  'shared/security/json-ld.ts',
  // The schema-generator download controller is the only other place
  // allowed to name the media type; it streams the stored payload verbatim.
  'modules/schema-generator/schema-generator.controller.ts',
];

describe('no module builds JSON-LD by concatenation', () => {
  it('only the serializer and the download controller name the media type', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const offenders = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts'))
      .map((entry) => entry.split('\\').join('/'))
      .filter((entry) => readFileSync(join(root, entry), 'utf8').includes('application/ld+json'))
      .filter((entry) => !LD_JSON_ALLOW_LIST.includes(entry));
    expect(offenders).toEqual([]);
  });
});
