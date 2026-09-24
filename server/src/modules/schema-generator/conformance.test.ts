/**
 * Conformance layer —.
 *
 * The matrix is the full seven types × {all-required-present,
 * one-required-missing per required property, all-recommended-missing}.
 */
import { describe, expect, it } from 'vitest';
import { computeConformance } from './conformance.js';
import {
  SCHEMA_REGISTRY_VERSION,
  SUPPORTED_SCHEMA_TYPES,
  recommendedProperties,
  requiredProperties,
  schemaTypeDefinition,
  type OmissionReason,
  type SupportedSchemaType,
} from './schema-types.registry.js';

function allProperties(type: SupportedSchemaType): string[] {
  return schemaTypeDefinition(type).properties.map((property) => property.name);
}

describe('computeConformance', () => {
  it.each(SUPPORTED_SCHEMA_TYPES)('%s conforms when every property is emitted', (type) => {
    const report = computeConformance(type, allProperties(type));
    expect(report).toEqual({
      registryVersion: SCHEMA_REGISTRY_VERSION,
      status: 'conforms',
      requiredGaps: [],
      recommendedSuggestions: [],
    });
  });

  it.each(SUPPORTED_SCHEMA_TYPES)('%s conforms when only the recommended set is missing', (type) => {
    const report = computeConformance(
      type,
      requiredProperties(type).map((property) => property.name),
    );
    expect(report.status).toBe('conforms');
    expect(report.requiredGaps).toEqual([]);
    expect(report.recommendedSuggestions).toEqual(
      recommendedProperties(type).map((property) => ({
        property: property.name,
        reasonCode: 'no_evidence',
      })),
    );
    expect(report.registryVersion).toBe(SCHEMA_REGISTRY_VERSION);
  });

  const missingRequiredCases = SUPPORTED_SCHEMA_TYPES.flatMap((type) =>
    requiredProperties(type).map((property) => [type, property.name] as const),
  );

  it.each(missingRequiredCases)('%s reports a required gap when %s is missing', (type, missing) => {
    const report = computeConformance(
      type,
      allProperties(type).filter((name) => name !== missing),
    );
    expect(report.status).toBe('gaps');
    expect(report.requiredGaps).toEqual([{ property: missing, reasonCode: 'no_evidence' }]);
    expect(report.recommendedSuggestions).toEqual([]);
  });

  it('stamps refined omission reasons supplied by the assembler', () => {
    const reasons = new Map<string, OmissionReason>([
      ['description', 'not_applicable'],
      ['name', 'evidence_ambiguous'],
    ]);
    const report = computeConformance('WebSite', ['url', 'inLanguage'], reasons);
    expect(report.status).toBe('gaps');
    expect(report.requiredGaps).toEqual([{ property: 'name', reasonCode: 'evidence_ambiguous' }]);
    expect(report.recommendedSuggestions).toEqual([
      { property: 'description', reasonCode: 'not_applicable' },
    ]);
  });
});
