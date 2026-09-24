import { describe, it, expect } from 'vitest';
import {
  COVERAGE_NOTE_KEYS,
  DATAFORSEO_LOCATION_ISO,
  DEVICE_STATES,
  FRESHNESS_STATES,
  SOURCE_KINDS,
  SOURCE_LABELS,
  UNKNOWN_COUNTRY,
  isCoverageNoteKey,
  observationMetaSchema,
  parseObservationMeta,
  parseSiteMarket,
  siteMarketSchema,
} from './observations';

const CANONICAL_META = {
  sourceKind: 'provider_observation' as const,
  sourceLabel: 'dataforseo' as const,
  observedAt: '2026-01-01T00:00:00.000Z',
  freshUntil: '2026-01-02T00:00:00.000Z',
  freshness: 'fresh' as const,
  market: {
    country: 'US',
    region: null,
    city: null,
    language: 'en',
    device: 'desktop' as const,
  },
  sampleCount: 1,
  coverageNoteKey: null,
};

describe('client observations mirror', () => {
  it('parses a canonical wire payload identical to the server shape', () => {
    const parsed = parseObservationMeta(CANONICAL_META);
    expect(parsed).toEqual(CANONICAL_META);
  });

  it('rejects unknown source kinds, freshness, labels, and note keys', () => {
    expect(() =>
      parseObservationMeta({ ...CANONICAL_META, sourceKind: 'nope' }),
    ).toThrow();
    expect(() =>
      parseObservationMeta({ ...CANONICAL_META, freshness: 'nope' }),
    ).toThrow();
    expect(() =>
      parseObservationMeta({ ...CANONICAL_META, sourceLabel: 'shady' }),
    ).toThrow();
    expect(() =>
      parseObservationMeta({ ...CANONICAL_META, coverageNoteKey: 'made-up' }),
    ).toThrow();
  });

  it('rejects non-positive sampleCount and invalid dates', () => {
    expect(() =>
      parseObservationMeta({ ...CANONICAL_META, sampleCount: 0 }),
    ).toThrow();
    expect(() =>
      parseObservationMeta({ ...CANONICAL_META, observedAt: 'nope' }),
    ).toThrow();
    expect(() =>
      parseObservationMeta({ ...CANONICAL_META, freshUntil: 'nope' }),
    ).toThrow();
  });

  it('rejects unrecognized fields (strict schema)', () => {
    expect(() =>
      observationMetaSchema.parse({ ...CANONICAL_META, extra: 'no' }),
    ).toThrow();
  });

  it('accepts every published source kind, freshness state, and note key', () => {
    expect(SOURCE_KINDS.length).toBe(4);
    expect(FRESHNESS_STATES.length).toBe(6);
    for (const sourceKind of SOURCE_KINDS) {
      expect(parseObservationMeta({ ...CANONICAL_META, sourceKind }).sourceKind).toBe(
        sourceKind,
      );
    }
    for (const freshness of FRESHNESS_STATES) {
      expect(parseObservationMeta({ ...CANONICAL_META, freshness }).freshness).toBe(
        freshness,
      );
    }
    for (const key of COVERAGE_NOTE_KEYS) {
      expect(
        parseObservationMeta({ ...CANONICAL_META, coverageNoteKey: key })
          .coverageNoteKey,
      ).toBe(key);
    }
  });

  it('parseSiteMarket normalizes and bounds', () => {
    const m = parseSiteMarket({
      country: 'gb',
      region: 'England',
      city: 'London',
      language: 'EN',
      device: 'mobile',
    });
    expect(m.country).toBe('GB');
    expect(m.language).toBe('en');
    expect(() =>
      siteMarketSchema.parse({
        country: 'US',
        region: null,
        city: null,
        language: 'en',
        device: 'tv',
      }),
    ).toThrow();
  });

  it('DATAFORSEO_LOCATION_ISO matches every ISO country the picker exposes', () => {
    for (const iso of Object.values(DATAFORSEO_LOCATION_ISO)) {
      expect(iso).toMatch(/^[A-Z]{2}$/);
    }
    expect(UNKNOWN_COUNTRY).toBe('ZZ');
  });

  it('isCoverageNoteKey narrows correctly', () => {
    expect(isCoverageNoteKey('observations.coverage.freshCache')).toBe(true);
    expect(isCoverageNoteKey('nope')).toBe(false);
    expect(isCoverageNoteKey(1)).toBe(false);
  });

  it('SOURCE_LABELS and DEVICE_STATES are exposed', () => {
    expect(SOURCE_LABELS.includes('google_search_console')).toBe(true);
    expect(DEVICE_STATES).toEqual(['desktop', 'mobile', 'all']);
  });
});
