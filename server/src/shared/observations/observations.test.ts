import { describe, it, expect } from 'vitest';
import {
  COVERAGE_NOTE_KEYS,
  DATAFORSEO_LOCATION_ISO,
  DEVICE_STATES,
  FRESHNESS_STATES,
  ISO_TO_DATAFORSEO_LOCATION,
  SOURCE_KINDS,
  SOURCE_LABELS,
  UNKNOWN_COUNTRY,
  buildObservationMeta,
  buildSiteMarket,
  deriveFreshness,
  isCoverageNoteKey,
  marketFromDataForSeo,
  observationMetaSchema,
  serializeObservationMeta,
  siteMarketSchema,
} from './observations.js';

describe('SiteMarket', () => {
  it('normalizes country to uppercase and language to lowercase', () => {
    const m = buildSiteMarket({
      country: 'us',
      language: 'EN-US',
    });
    expect(m).toEqual({
      country: 'US',
      region: null,
      city: null,
      language: 'en-us',
      device: 'all',
    });
  });

  it('bounds region and city, and accepts null explicitly', () => {
    const m = buildSiteMarket({
      country: 'GB',
      region: 'England',
      city: 'London',
      language: 'en',
      device: 'mobile',
    });
    expect(m.region).toBe('England');
    expect(m.city).toBe('London');
    expect(m.device).toBe('mobile');
    expect(() =>
      buildSiteMarket({
        country: 'GB',
        region: 'x'.repeat(81),
        language: 'en',
      }),
    ).toThrow();
    expect(() =>
      buildSiteMarket({
        country: 'GB',
        city: 'y'.repeat(81),
        language: 'en',
      }),
    ).toThrow();
  });

  it('rejects invalid country and language', () => {
    expect(() => buildSiteMarket({ country: 'USA', language: 'en' })).toThrow();
    expect(() => buildSiteMarket({ country: 'US', language: '???' })).toThrow();
  });

  it('rejects unknown device', () => {
    expect(() =>
      // @ts-expect-error – invalid device
      buildSiteMarket({ country: 'US', language: 'en', device: 'tv' }),
    ).toThrow();
  });

  it('rejects unrecognized fields (strict schema)', () => {
    expect(() =>
      siteMarketSchema.parse({
        country: 'US',
        region: null,
        city: null,
        language: 'en',
        device: 'all',
        extra: 'nope',
      }),
    ).toThrow();
  });
});

describe('DataForSEO location mapping', () => {
  it('maps every published code to a valid ISO country', () => {
    for (const [code, iso] of Object.entries(DATAFORSEO_LOCATION_ISO)) {
      expect(iso).toMatch(/^[A-Z]{2}$/);
      expect(Number(code)).toBeGreaterThan(0);
      expect(ISO_TO_DATAFORSEO_LOCATION[iso]).toBe(Number(code));
    }
  });

  it('marketFromDataForSeo returns UNKNOWN_COUNTRY for legacy codes', () => {
    const m = marketFromDataForSeo({
      locationCode: 99999,
      languageCode: 'en',
    });
    expect(m.country).toBe(UNKNOWN_COUNTRY);
    expect(m.device).toBe('all');
  });

  it('marketFromDataForSeo honors device and language', () => {
    const m = marketFromDataForSeo({
      locationCode: 2840,
      languageCode: 'en',
      device: 'mobile',
    });
    expect(m).toEqual({
      country: 'US',
      region: null,
      city: null,
      language: 'en',
      device: 'mobile',
    });
  });
});

describe('deriveFreshness', () => {
  const observedAt = new Date('2026-01-01T00:00:00Z');

  it('returns fresh at the freshness boundary', () => {
    const freshUntil = new Date('2026-01-02T00:00:00Z');
    expect(
      deriveFreshness({
        observedAt,
        freshUntil,
        now: freshUntil,
      }),
    ).toBe('fresh');
  });

  it('returns stale one millisecond after the boundary', () => {
    const freshUntil = new Date('2026-01-02T00:00:00Z');
    expect(
      deriveFreshness({
        observedAt,
        freshUntil,
        now: new Date(freshUntil.getTime() + 1),
      }),
    ).toBe('stale');
  });

  it('returns fresh when freshUntil is null', () => {
    expect(
      deriveFreshness({
        observedAt,
        freshUntil: null,
        now: new Date('2030-01-01T00:00:00Z'),
      }),
    ).toBe('fresh');
  });

  it('honors an explicit degraded status', () => {
    for (const status of ['partial', 'blocked', 'failed', 'unknown'] as const) {
      expect(
        deriveFreshness({
          observedAt,
          freshUntil: null,
          now: observedAt,
          status,
        }),
      ).toBe(status);
    }
  });
});

describe('buildObservationMeta', () => {
  it('accepts every source kind and every freshness state', () => {
    expect(SOURCE_KINDS.length).toBe(4);
    expect(FRESHNESS_STATES.length).toBe(6);
    for (const sourceKind of SOURCE_KINDS) {
      const m = buildObservationMeta({
        sourceKind,
        observedAt: '2026-01-01T00:00:00Z',
      });
      expect(m.sourceKind).toBe(sourceKind);
      expect(m.sampleCount).toBe(1);
      expect(m.freshness).toBe('fresh');
      expect(m.market).toBeNull();
      expect(m.sourceLabel).toBeNull();
      expect(m.coverageNoteKey).toBeNull();
    }
  });

  it('serializes Date inputs and preserves an explicit degraded status', () => {
    const meta = buildObservationMeta({
      sourceKind: 'provider_observation',
      sourceLabel: 'dataforseo',
      observedAt: new Date('2026-01-01T00:00:00Z'),
      freshUntil: new Date('2026-01-02T00:00:00Z'),
      status: 'partial',
      market: buildSiteMarket({ country: 'US', language: 'en' }),
      sampleCount: 3,
      coverageNoteKey: 'observations.coverage.partialResult',
      now: new Date('2026-06-01T00:00:00Z'),
    });
    expect(meta.freshness).toBe('partial');
    expect(meta.observedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(meta.freshUntil).toBe('2026-01-02T00:00:00.000Z');
    expect(meta.market?.country).toBe('US');
    expect(meta.sourceLabel).toBe('dataforseo');
    expect(meta.sampleCount).toBe(3);
    expect(meta.coverageNoteKey).toBe('observations.coverage.partialResult');
  });

  it('derives stale when freshUntil has passed', () => {
    const meta = buildObservationMeta({
      sourceKind: 'provider_observation',
      observedAt: '2026-01-01T00:00:00Z',
      freshUntil: '2026-01-02T00:00:00Z',
      now: new Date('2026-01-03T00:00:00Z'),
    });
    expect(meta.freshness).toBe('stale');
  });

  it('rejects invalid dates', () => {
    expect(() =>
      buildObservationMeta({
        sourceKind: 'estimate',
        observedAt: 'not-a-date',
      }),
    ).toThrow();
    expect(() =>
      buildObservationMeta({
        sourceKind: 'estimate',
        observedAt: '2026-01-01T00:00:00Z',
        freshUntil: 'nope',
      }),
    ).toThrow();
  });

  it('rejects a non-positive sampleCount', () => {
    expect(() =>
      buildObservationMeta({
        sourceKind: 'estimate',
        observedAt: '2026-01-01T00:00:00Z',
        sampleCount: 0,
      }),
    ).toThrow();
  });

  it('rejects an unknown coverage note key at the boundary', () => {
    expect(() =>
      observationMetaSchema.parse({
        sourceKind: 'estimate',
        sourceLabel: null,
        observedAt: '2026-01-01T00:00:00Z',
        freshUntil: null,
        freshness: 'fresh',
        market: null,
        sampleCount: 1,
        coverageNoteKey: 'nope.made.up',
      }),
    ).toThrow();
  });

  it('rejects an unknown source label at the boundary', () => {
    expect(() =>
      observationMetaSchema.parse({
        sourceKind: 'provider_observation',
        sourceLabel: 'shady-vendor',
        observedAt: '2026-01-01T00:00:00Z',
        freshUntil: null,
        freshness: 'fresh',
        market: null,
        sampleCount: 1,
        coverageNoteKey: null,
      }),
    ).toThrow();
  });
});

describe('type helpers', () => {
  it('isCoverageNoteKey accepts every published key', () => {
    for (const key of COVERAGE_NOTE_KEYS) {
      expect(isCoverageNoteKey(key)).toBe(true);
    }
    expect(isCoverageNoteKey('nope')).toBe(false);
    expect(isCoverageNoteKey(42)).toBe(false);
  });

  it('exposes every allowlisted source label', () => {
    expect(SOURCE_LABELS.length).toBeGreaterThan(0);
    for (const label of SOURCE_LABELS) {
      expect(typeof label).toBe('string');
    }
  });

  it('exposes every supported device value', () => {
    expect(DEVICE_STATES).toEqual(['desktop', 'mobile', 'all']);
  });

  it('serializeObservationMeta round-trips a valid object', () => {
    const meta = buildObservationMeta({
      sourceKind: 'first_party',
      sourceLabel: 'google_search_console',
      observedAt: '2026-01-01T00:00:00Z',
    });
    expect(serializeObservationMeta(meta)).toEqual(meta);
    expect(() =>
      serializeObservationMeta({ ...meta, sourceKind: 'nope' as never }),
    ).toThrow();
  });
});
